/**
 * Audit Leads — Yoga Bible
 *
 * Fetches recent leads from Meta Graph API, cross-references with Firestore,
 * and processes any missing leads with the full welcome email pipeline.
 *
 * GET  /.netlify/functions/audit-leads?secret=...&since=2026-03-24
 *   → dry run: shows which leads Meta has vs what's in Firestore
 *
 * POST /.netlify/functions/audit-leads?secret=...&since=2026-03-24
 *   → processes missing leads: saves to Firestore + sends welcome emails/SMS
 *
 * Query params:
 *   secret  — AI_INTERNAL_SECRET (required)
 *   since   — ISO date string (default: 3 days ago)
 *   form_id — optional: audit a single form instead of all forms
 */

const crypto = require('crypto');
const https = require('https');
const { getDb } = require('./shared/firestore');
const { sendAdminNotification } = require('./shared/email-service');
const { sendWelcomeSMS } = require('./shared/sms-service');
const { sendWelcomeEmail } = require('./shared/lead-emails');
const { triggerNewLeadSequences } = require('./shared/sequence-trigger');
const { detectLeadCountry } = require('./shared/country-detect');
const { getDisplayProgram } = require('./shared/config');

const GRAPH_API_VERSION = 'v25.0';
const PAGE_ID = '878172732056415';
const TOKEN_SECRET = process.env.UNSUBSCRIBE_SECRET || 'yb-appt-secret';

// ─── Form ID → Program Type Map (mirrors facebook-leads-webhook.js) ─────────
const FORM_ID_MAP = {
  '1974647360148367': '18-week',
  '961808297026346':  'from-answer',
  '827004866473769':  '4-week-jul',
  '25716246641411656':'4-week-jul',
  '4318151781759438': '4-week-jul',
  '2450631555377690': '4-week-jul',
  '1668412377638315': '4-week-jul',
  '960877763097239':  '4-week-jul',
  '1344364364192542': '4-week-jul'
};

const PROGRAM_ANSWER_MAP = {
  '4 ugers intensiv':       '4-week',
  '4 ugers intensiv — april': '4-week',
  'vinyasa plus 4 uger':    '4-week-jul',
  'vinyasa plus 4 uger — juli': '4-week-jul',
  '8 ugers semi-intensiv':  '8-week',
  '8 ugers semi-intensiv — maj-juni': '8-week',
  '18 ugers fleksibel':     '18-week-aug',
  '18 ugers fleksibel — august-december': '18-week-aug',
  'ved ikke endnu':          'undecided'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  // Auth via secret
  const params = event.queryStringParameters || {};
  if (params.secret !== process.env.AI_INTERNAL_SECRET) {
    return jsonResp(401, { error: 'Invalid secret' });
  }

  // ─── Patch Mode: fix fields on existing leads by leadgen_id ──────────────────
  // POST with ?secret=...&mode=patch and JSON body:
  // { "leadgen_ids": ["123..."], "updates": { "source": "Facebook Ad", "program": "..." } }
  if (params.mode === 'patch' && event.httpMethod === 'POST') {
    return handlePatchLeads(event);
  }

  // ─── Re-fetch Mode: recover leads by leadgen_id from Graph API ──────────────
  // POST with ?secret=...&mode=refetch and JSON body:
  // { "leadgen_ids": ["1323569482954788", "2808798966135506", ...] }
  if (params.mode === 'refetch' && event.httpMethod === 'POST') {
    return handleRefetchRecovery(event);
  }

  // ─── Manual Recovery Mode ───────────────────────────────────────────────────
  // POST with ?secret=...&mode=recover and JSON body with leads array:
  // { "leads": [{ "email": "...", "first_name": "...", "last_name": "...",
  //   "phone": "...", "city": "...", "country": "FI", "lang": "fi",
  //   "form_id": "1668412377638315", "accommodation": "kyllä",
  //   "yoga_experience": "...", "english_comfort": "..." }] }
  if (params.mode === 'recover' && event.httpMethod === 'POST') {
    return handleManualRecovery(event);
  }

  const dryRun = event.httpMethod === 'GET';
  const sinceTs = params.since
    ? Math.floor(new Date(params.since).getTime() / 1000)
    : Math.floor((Date.now() - 3 * 24 * 60 * 60 * 1000) / 1000); // 3 days ago

  const targetFormId = params.form_id || null;

  console.log(`[audit-leads] Starting — since=${new Date(sinceTs * 1000).toISOString()}, dry_run=${dryRun}, form_id=${targetFormId || 'all'}`);

  try {
    // 1. Build form list from FORM_ID_MAP (doesn't require pages_manage_ads permission)
    //    Each unique form ID gets a name based on its mapping
    const FORM_NAMES = {
      '1974647360148367': '18-week YTT',
      '961808297026346':  'General YTT (multi-program)',
      '827004866473769':  'July Vinyasa Plus — EN/UK',
      '25716246641411656': 'July Vinyasa Plus — NO',
      '4318151781759438': 'July Vinyasa Plus — SE',
      '2450631555377690': 'July Vinyasa Plus — DE',
      '1668412377638315': 'July Vinyasa Plus — FI',
      '960877763097239':  'July Vinyasa Plus — NL',
      '1344364364192542': 'July Vinyasa Plus — DK'
    };

    let forms;
    if (targetFormId) {
      forms = [{ id: targetFormId, name: FORM_NAMES[targetFormId] || `Form ${targetFormId}` }];
    } else {
      forms = Object.entries(FORM_NAMES).map(([id, name]) => ({ id, name }));
    }

    console.log(`[audit-leads] Checking ${forms.length} known form(s)`);

    const results = {
      dry_run: dryRun,
      since: new Date(sinceTs * 1000).toISOString(),
      known_forms: forms.map(f => ({ id: f.id, name: f.name })),
      forms_checked: forms.length,
      leads_in_meta: 0,
      leads_already_in_firestore: 0,
      leads_missing: 0,
      leads_processed: 0,
      leads_no_email: 0,
      errors: [],
      missing: [],
      processed: []
    };

    // 2. For each form, fetch leads and cross-reference
    for (const form of forms) {
      let leads;
      try {
        leads = await fetchLeadsForForm(form.id, sinceTs);
      } catch (err) {
        results.errors.push({ form_id: form.id, form_name: form.name, error: err.message });
        continue;
      }

      console.log(`[audit-leads] Form "${form.name}" (${form.id}): ${leads.length} lead(s) in Meta`);

      for (const rawLead of leads) {
        results.leads_in_meta++;

        // Parse email from field data
        const fields = {};
        for (const field of (rawLead.field_data || [])) {
          fields[field.name] = Array.isArray(field.values) ? field.values[0] : field.values;
        }
        const email = (
          fields.email || fields['e-mail'] || fields['e-mailadresse'] ||
          findFieldByKeyword(fields, ['email', 'e-mail', 'mail', 'sähköposti']) || ''
        ).toLowerCase().trim();

        if (!email) {
          results.leads_no_email++;
          continue;
        }

        // Check Firestore by leadgen_id
        const db = getDb();
        const existing = await db.collection('leads')
          .where('meta_leadgen_id', '==', rawLead.id)
          .limit(1)
          .get();

        if (!existing.empty) {
          results.leads_already_in_firestore++;
          continue;
        }

        // Also check by email (might have been imported differently)
        const byEmail = await db.collection('leads')
          .where('email', '==', email)
          .limit(1)
          .get();

        if (!byEmail.empty) {
          results.leads_already_in_firestore++;
          continue;
        }

        // This lead is MISSING from Firestore
        results.leads_missing++;
        const leadSummary = {
          leadgen_id: rawLead.id,
          email,
          form_id: form.id,
          form_name: form.name,
          created_time: rawLead.created_time,
          ad_name: rawLead.ad_name || '',
          fields: Object.keys(fields)
        };
        results.missing.push(leadSummary);

        // Process if not dry run
        if (!dryRun) {
          try {
            const outcome = await processLead(rawLead, form, fields, email);
            results.leads_processed++;
            results.processed.push({
              leadgen_id: rawLead.id,
              email,
              name: `${outcome.first_name} ${outcome.last_name}`.trim(),
              program_type: outcome.program_type,
              lang: outcome.lang,
              country: outcome.country,
              firestore_id: outcome.firestoreId
            });
          } catch (err) {
            console.error(`[audit-leads] Error processing ${rawLead.id}:`, err.message);
            results.errors.push({ leadgen_id: rawLead.id, email, error: err.message });
          }
        }
      }
    }

    console.log(`[audit-leads] Done — meta=${results.leads_in_meta}, in_firestore=${results.leads_already_in_firestore}, missing=${results.leads_missing}, processed=${results.leads_processed}`);
    return jsonResp(200, { ok: true, ...results });

  } catch (err) {
    console.error('[audit-leads] Fatal error:', err.message);
    return jsonResp(500, { ok: false, error: err.message });
  }
};

// ─── Manual Recovery — process leads from CSV/manual input ───────────────────

async function handlePatchLeads(event) {
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return jsonResp(400, { error: 'Invalid JSON body' });
  }

  const leadgenIds = body.leadgen_ids || [];
  const updates = body.updates || {};

  if (!leadgenIds.length || !Object.keys(updates).length) {
    return jsonResp(400, { error: 'Provide leadgen_ids array and updates object' });
  }

  // Only allow safe field updates
  const allowedFields = ['source', 'program', 'cohort_label', 'ytt_program_type', 'notes', 'country', 'lang', 'meta_lang'];
  const safeUpdates = {};
  for (const key of Object.keys(updates)) {
    if (allowedFields.includes(key)) {
      safeUpdates[key] = updates[key];
    }
  }
  safeUpdates.updated_at = new Date();

  const db = getDb();
  const results = { patched: [], not_found: [], errors: [] };

  for (const leadgenId of leadgenIds) {
    try {
      const snap = await db.collection('leads')
        .where('meta_leadgen_id', '==', leadgenId)
        .limit(1)
        .get();

      if (snap.empty) {
        results.not_found.push(leadgenId);
        continue;
      }

      const doc = snap.docs[0];
      const oldData = doc.data();
      await doc.ref.update(safeUpdates);

      results.patched.push({
        leadgen_id: leadgenId,
        firestore_id: doc.id,
        email: oldData.email,
        name: `${oldData.first_name || ''} ${oldData.last_name || ''}`.trim(),
        changed: Object.keys(safeUpdates).filter(k => k !== 'updated_at').map(k => ({
          field: k,
          from: oldData[k] || '(empty)',
          to: safeUpdates[k]
        }))
      });
    } catch (err) {
      results.errors.push({ leadgen_id: leadgenId, error: err.message });
    }
  }

  return jsonResp(200, { ok: true, mode: 'patch', ...results });
}

async function handleRefetchRecovery(event) {
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return jsonResp(400, { error: 'Invalid JSON body' });
  }

  const leadgenIds = body.leadgen_ids || [];
  if (!leadgenIds.length) {
    return jsonResp(400, { error: 'Provide leadgen_ids array', example: { leadgen_ids: ['1323569482954788'] } });
  }

  const results = { processed: [], skipped: [], errors: [] };
  const db = getDb();
  const token = process.env.FB_PAGE_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;

  for (const leadgenId of leadgenIds) {
    try {
      // Check if already in Firestore
      const existing = await db.collection('leads')
        .where('meta_leadgen_id', '==', leadgenId)
        .limit(1)
        .get();
      if (!existing.empty) {
        results.skipped.push({ leadgen_id: leadgenId, reason: 'Already in Firestore' });
        continue;
      }

      // Fetch full lead data from Graph API
      const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${leadgenId}?fields=field_data,form_id,ad_id,ad_name,created_time,platform&access_token=${token}`;
      const rawLead = await graphGet(url);

      // Parse field_data
      const fields = {};
      for (const field of (rawLead.field_data || [])) {
        fields[field.name] = Array.isArray(field.values) ? field.values[0] : field.values;
      }

      // Parse identity (same logic as facebook-leads-webhook with e-post fix)
      const fullName = fields.full_name || fields.name || fields['for- og efternavn'] || findFieldByKeyword(fields, ['fulde navn', 'full name', 'navn']) || '';
      const nameParts = fullName.trim().split(/\s+/);
      const firstName = fields.first_name || fields.fornavn || fields.fornavne || findFieldByKeyword(fields, ['fornavn', 'first name', 'förnamn', 'vorname', 'etunimi', 'voornaam']) || nameParts[0] || '';
      const lastName = fields.last_name || fields.efternavn || findFieldByKeyword(fields, ['efternavn', 'last name', 'efternamn', 'nachname', 'sukunimi', 'achternaam', 'etternavn']) || nameParts.slice(1).join(' ') || '';
      const email = (fields.email || fields['e-mail'] || fields['e-mailadresse'] || fields['e-post'] || findFieldByKeyword(fields, ['email', 'e-mail', 'e-post', 'epost', 'mail', 'sähköposti']) || '').toLowerCase().trim();
      const phone = fields.phone_number || fields.phone || fields.telefonnummer || fields.telefon || fields.mobil || findFieldByKeyword(fields, ['telefon', 'phone', 'mobil', 'puhelinnumero', 'telefoonnummer']) || '';
      const city = fields.city || fields.location || fields.by || findFieldByKeyword(fields, ['by', 'city', 'stad', 'ort', 'stadt', 'kaupunki', 'plaats', 'sted']) || '';
      const country = fields.country || fields.land || findFieldByKeyword(fields, ['country', 'land', 'maa']) || '';

      if (!email) {
        results.errors.push({ leadgen_id: leadgenId, error: 'Still no email after re-fetch', fields: Object.keys(fields) });
        continue;
      }

      // Check if email already exists
      const byEmail = await db.collection('leads').where('email', '==', email).limit(1).get();
      if (!byEmail.empty) {
        results.skipped.push({ leadgen_id: leadgenId, email, reason: 'Email already in Firestore' });
        continue;
      }

      // Parse custom questions
      const yogaExpAnswer = findFieldByKeyword(fields, ['yoga experience', 'yogaerfaring', 'yogaerfarenhet', 'yogaerfahrung', 'joogakokemust', 'yoga-ervaring']) || '';
      const accommodationAnswer = findFieldByKeyword(fields, ['stay in copenhagen', 'oppholdet', 'vistelse', 'aufenthalt', 'oleskeluu', 'verblijf', 'overnatning', 'hjælpe', 'hjelpe', 'helfen', 'auttaa', 'helpen']) || '';
      const englishComfortAnswer = findFieldByKeyword(fields, ['english', 'engelsk', 'engelska', 'englisch', 'englanniksi', 'engels']) || '';
      const metaLang = fields.lang || 'da';
      const formId = rawLead.form_id || '';

      // Resolve program type
      let resolvedType;
      const formMapType = FORM_ID_MAP[formId];
      if (formMapType && formMapType !== 'from-answer') {
        resolvedType = formMapType;
      } else {
        resolvedType = detectYTTType('', rawLead.ad_name || '', formId);
      }

      const lead = {
        email,
        first_name: firstName,
        last_name: lastName,
        phone,
        type: 'ytt',
        ytt_program_type: resolvedType,
        program: getDisplayProgram({ ytt_program_type: resolvedType, lang: metaLang }, metaLang) || 'Facebook Lead Form',
        course_id: '',
        cohort_label: '',
        preferred_month: '',
        accommodation: normalizeAccommodationAnswer(accommodationAnswer) || 'No',
        yoga_experience: normalizeYogaExperience(yogaExpAnswer),
        english_comfort: normalizeEnglishComfort(englishComfortAnswer),
        city_country: country ? (city ? city + ', ' + country : country) : city,
        country: country || '',
        housing_months: '',
        service: '',
        subcategories: '',
        message: '',
        source: (rawLead.platform || '').toLowerCase() === 'instagram' ? 'Instagram Ad' : 'Facebook Ad',
        meta_form_id: formId,
        meta_form_name: '',
        meta_ad_id: rawLead.ad_id || '',
        meta_campaign: rawLead.ad_name || '',
        meta_leadgen_id: leadgenId,
        meta_page_id: PAGE_ID,
        meta_platform: (rawLead.platform || '').toLowerCase(),
        meta_lang: metaLang,
        lang: metaLang,
        converted: false,
        converted_at: null,
        application_id: null,
        status: 'New',
        notes: '(recovered via audit-leads refetch)',
        unsubscribed: false,
        call_attempts: 0,
        sms_status: '',
        last_contact: null,
        followup_date: null,
        multi_format: '',
        all_formats: '',
        created_at: rawLead.created_time ? new Date(rawLead.created_time) : new Date(),
        updated_at: new Date()
      };

      // Detect country
      lead.country = detectLeadCountry(lead);

      // Save to Firestore — use deterministic doc ID for atomic dedup
      const leadDocId = email.toLowerCase().trim().replace(/[\/\.#\[\]]/g, '_');
      const leadDocRef = db.collection('leads').doc(leadDocId);
      const existingDoc = await leadDocRef.get();
      if (existingDoc.exists) {
        results.skipped.push({ leadgen_id: leadgenId, email, reason: 'Lead doc already exists (atomic check)' });
        continue;
      }
      await leadDocRef.set(lead);
      const docRef = { id: leadDocId };
      console.log(`[audit-leads] Refetch recovery: saved ${docRef.id} (${email}) — type=${resolvedType}, lang=${metaLang}, country=${lead.country}`);

      // Generate schedule token + email action + save token to doc
      const scheduleToken = crypto
        .createHmac('sha256', TOKEN_SECRET)
        .update(docRef.id + ':' + email)
        .digest('hex');
      await leadDocRef.update({ schedule_token: scheduleToken }).catch(e => {
        console.warn('[audit-leads] Failed to save schedule_token:', e.message);
      });
      const emailAction = yttTypeToAction(resolvedType);

      // Send notifications
      await Promise.all([
        sendAdminNotification(lead).catch(e => console.error('[audit-leads] Admin email failed:', e.message)),
        sendWelcomeEmail(lead, emailAction, { leadId: docRef.id, token: scheduleToken })
          .catch(e => console.error('[audit-leads] Welcome email failed:', e.message)),
        phone && process.env.GATEWAYAPI_TOKEN
          ? sendWelcomeSMS(lead, docRef.id).catch(e => console.error('[audit-leads] SMS failed:', e.message))
          : Promise.resolve(),
        triggerNewLeadSequences(docRef.id, lead).catch(e => console.error('[audit-leads] Sequence trigger failed:', e.message))
      ]);

      results.processed.push({
        leadgen_id: leadgenId,
        email,
        name: `${firstName} ${lastName}`.trim(),
        program_type: resolvedType,
        lang: metaLang,
        country: lead.country,
        firestore_id: docRef.id,
        email_action: emailAction
      });
    } catch (err) {
      console.error(`[audit-leads] Refetch error for ${leadgenId}:`, err.message);
      results.errors.push({ leadgen_id: leadgenId, error: err.message });
    }
  }

  return jsonResp(200, { ok: true, mode: 'refetch_recovery', ...results });
}

async function handleManualRecovery(event) {
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return jsonResp(400, { error: 'Invalid JSON body' });
  }

  const leads = body.leads || [];
  if (!leads.length) {
    return jsonResp(400, {
      error: 'No leads provided',
      example: {
        leads: [{
          email: 'aino@example.com',
          first_name: 'Aino',
          last_name: 'Heikkinen',
          phone: '+358440414142',
          city: 'Turku',
          country: 'FI',
          lang: 'fi',
          form_id: '1668412377638315',
          accommodation: 'kyllä',
          yoga_experience: '',
          english_comfort: '_ei_ongelmaa'
        }]
      }
    });
  }

  const results = { processed: [], skipped: [], errors: [] };
  const db = getDb();

  for (const input of leads) {
    const email = (input.email || '').toLowerCase().trim();
    if (!email) {
      results.errors.push({ input, error: 'No email' });
      continue;
    }

    // Check if already in Firestore
    const existing = await db.collection('leads')
      .where('email', '==', email)
      .limit(1)
      .get();
    if (!existing.empty) {
      results.skipped.push({ email, reason: 'Already in Firestore' });
      continue;
    }

    try {
      const firstName = input.first_name || '';
      const lastName = input.last_name || '';
      const phone = input.phone || '';
      const city = input.city || '';
      const country = input.country || '';
      const lang = input.lang || 'da';
      const formId = input.form_id || '';

      // Resolve program type from form_id or fallback
      let resolvedType;
      if (formId && FORM_ID_MAP[formId] && FORM_ID_MAP[formId] !== 'from-answer') {
        resolvedType = FORM_ID_MAP[formId];
      } else {
        resolvedType = input.program_type || '4-week-jul';
      }

      // Normalize Q answers
      const accommodationValue = normalizeAccommodationAnswer(input.accommodation || '');
      const yogaExperience = normalizeYogaExperience(input.yoga_experience || '');
      const englishComfort = normalizeEnglishComfort(input.english_comfort || '');

      const lead = {
        email,
        first_name: firstName,
        last_name: lastName,
        phone,
        type: 'ytt',
        ytt_program_type: resolvedType,
        program: input.program || 'Facebook Lead Form (manual recovery)',
        course_id: '',
        cohort_label: '',
        preferred_month: '',
        accommodation: accommodationValue || 'No',
        yoga_experience: yogaExperience,
        english_comfort: englishComfort,
        city_country: country ? (city ? city + ', ' + country : country) : city,
        country: country || '',
        housing_months: '',
        service: '',
        subcategories: '',
        message: '',
        source: 'Meta Lead – Facebook – manual recovery via audit-leads',
        meta_form_id: formId,
        meta_form_name: '',
        meta_ad_id: '',
        meta_campaign: input.campaign || '',
        meta_leadgen_id: '',
        meta_page_id: PAGE_ID,
        meta_lang: lang,
        lang: lang,
        converted: false,
        converted_at: null,
        application_id: null,
        status: 'New',
        notes: '(recovered via audit-leads manual recovery)',
        unsubscribed: false,
        call_attempts: 0,
        sms_status: '',
        last_contact: null,
        followup_date: null,
        multi_format: '',
        all_formats: '',
        created_at: input.created_at ? new Date(input.created_at) : new Date(),
        updated_at: new Date()
      };

      // Detect country
      lead.country = detectLeadCountry(lead);

      // Save to Firestore
      const docRef = await db.collection('leads').add(lead);
      console.log(`[audit-leads] Manual recovery: saved ${docRef.id} (${email}) — type=${resolvedType}, lang=${lang}, country=${lead.country}`);

      // Generate schedule token
      const scheduleToken = crypto
        .createHmac('sha256', TOKEN_SECRET)
        .update(docRef.id + ':' + email)
        .digest('hex');

      // Map program type → email action
      const emailAction = yttTypeToAction(resolvedType);

      // Send notifications
      await Promise.all([
        sendAdminNotification(lead).catch(e => console.error('[audit-leads] Admin email failed:', e.message)),
        sendWelcomeEmail(lead, emailAction, { leadId: docRef.id, token: scheduleToken })
          .catch(e => console.error('[audit-leads] Welcome email failed:', e.message)),
        phone && process.env.GATEWAYAPI_TOKEN
          ? sendWelcomeSMS(lead, docRef.id).catch(e => console.error('[audit-leads] SMS failed:', e.message))
          : Promise.resolve(),
        triggerNewLeadSequences(docRef.id, lead).catch(e => console.error('[audit-leads] Sequence trigger failed:', e.message))
      ]);

      results.processed.push({
        email,
        name: `${firstName} ${lastName}`.trim(),
        program_type: resolvedType,
        lang,
        country: lead.country,
        firestore_id: docRef.id,
        email_action: emailAction
      });
    } catch (err) {
      console.error(`[audit-leads] Manual recovery error for ${email}:`, err.message);
      results.errors.push({ email, error: err.message });
    }
  }

  return jsonResp(200, { ok: true, mode: 'manual_recovery', ...results });
}

// ─── Process a missing lead (full pipeline, mirrors facebook-leads-webhook) ──

async function processLead(rawLead, form, fields, email) {
  const formName = form.name || '';
  const adName = rawLead.ad_name || '';

  // Parse identity fields (same logic as facebook-leads-webhook.js)
  const fullName = fields.full_name || fields.name || fields['for- og efternavn'] || findFieldByKeyword(fields, ['fulde navn', 'full name', 'navn']) || '';
  const nameParts = fullName.trim().split(/\s+/);
  const firstName = fields.first_name || fields.fornavn || fields.fornavne || findFieldByKeyword(fields, ['fornavn', 'first name', 'first_name', 'förnamn', 'vorname', 'etunimi', 'voornaam']) || nameParts[0] || '';
  const lastName = fields.last_name || fields.efternavn || findFieldByKeyword(fields, ['efternavn', 'last name', 'last_name', 'efternamn', 'nachname', 'sukunimi', 'achternaam', 'etternavn']) || nameParts.slice(1).join(' ') || '';
  const phone = fields.phone_number || fields.phone || fields.telefonnummer || fields.telefon || fields.mobil || findFieldByKeyword(fields, ['telefon', 'phone', 'mobil', 'puhelinnumero', 'telefoonnummer']) || '';
  const city = fields.city || fields.location || fields.by || findFieldByKeyword(fields, ['by', 'city', 'location', 'hvor bor', 'stad', 'ort', 'stadt', 'kaupunki', 'plaats', 'sted']) || '';
  const country = fields.country || fields.land || findFieldByKeyword(fields, ['country', 'land', 'maa', 'pays']) || '';

  // Parse custom questions
  const programAnswer = findFieldByKeyword(fields, ['program', 'interesseret', 'hvilket']) || '';
  const housingAnswer = findFieldByKeyword(fields, ['bolig', 'housing', 'hjælp med bolig', 'hjaelp']) || '';
  const yogaExpAnswer = findFieldByKeyword(fields, ['yoga experience', 'yogaerfaring', 'yogaerfarenhet', 'yogaerfahrung', 'joogakokemust', 'yoga-ervaring']) || '';
  const accommodationAnswer = findFieldByKeyword(fields, ['stay in copenhagen', 'oppholdet', 'vistelse', 'aufenthalt', 'oleskeluu', 'verblijf', 'overnatning']) || '';
  const englishComfortAnswer = findFieldByKeyword(fields, ['english', 'engelsk', 'engelska', 'englisch', 'englanniksi', 'engels']) || '';

  // Hidden field values
  const metaLang = fields.lang || 'da';
  const metaCohort = fields.cohort || '';

  // Resolve program type
  let resolvedType;
  const formMapType = FORM_ID_MAP[form.id];
  if (formMapType === 'from-answer') {
    resolvedType = mapProgramAnswer(programAnswer) || detectYTTType(programAnswer, adName || formName, '');
  } else if (formMapType) {
    resolvedType = formMapType;
  } else {
    resolvedType = detectYTTType(programAnswer || '', adName || formName, form.id);
  }

  // Normalize Q1-Q3
  const accommodationValue = accommodationAnswer
    ? normalizeAccommodationAnswer(accommodationAnswer)
    : housingAnswer
      ? normalizeHousingAnswer(housingAnswer)
      : normalizeYesNo(fields.housing || fields.accommodation || 'No');
  const yogaExperience = normalizeYogaExperience(yogaExpAnswer);
  const englishComfort = normalizeEnglishComfort(englishComfortAnswer);

  // Check existing applicant
  const db = getDb();
  const existingSnap = await db.collection('applications')
    .where('email', '==', email)
    .limit(1)
    .get();
  const existingAppId = existingSnap.empty ? null : (existingSnap.docs[0].data().application_id || 'Unknown');

  const lead = {
    email,
    first_name: firstName,
    last_name: lastName,
    phone,
    type: 'ytt',
    ytt_program_type: resolvedType,
    program: programAnswer || adName || formName || 'Facebook Lead Form',
    course_id: '',
    cohort_label: metaCohort || '',
    preferred_month: '',
    accommodation: accommodationValue,
    yoga_experience: yogaExperience,
    english_comfort: englishComfort,
    city_country: country ? (city ? city + ', ' + country : country) : city,
    country: country || '',
    housing_months: '',
    service: '',
    subcategories: '',
    message: fields.message || fields.comments || fields.besked || findFieldByKeyword(fields, ['besked', 'message', 'kommentar']) || '',
    source: `Meta Lead – Facebook – ${adName || form.name || form.id} (audit-recovery)`,
    meta_form_id: form.id || '',
    meta_form_name: formName || '',
    meta_ad_id: rawLead.ad_id || '',
    meta_campaign: adName || '',
    meta_leadgen_id: rawLead.id || '',
    meta_page_id: PAGE_ID,
    meta_lang: metaLang || 'da',
    lang: metaLang || 'da',
    converted: false,
    converted_at: null,
    application_id: null,
    status: existingAppId ? 'Existing Applicant' : 'New',
    notes: existingAppId
      ? `EXISTING APPLICANT (App ID: ${existingAppId})`
      : '(recovered via audit-leads)',
    unsubscribed: false,
    call_attempts: 0,
    sms_status: '',
    last_contact: null,
    followup_date: null,
    multi_format: '',
    all_formats: '',
    created_at: rawLead.created_time ? new Date(rawLead.created_time) : new Date(),
    updated_at: new Date()
  };

  // Detect country
  lead.country = detectLeadCountry(lead);

  // Save to Firestore
  const docRef = await db.collection('leads').add(lead);
  console.log(`[audit-leads] Saved lead ${docRef.id} (${email}) — type=${resolvedType}, lang=${metaLang}, country=${lead.country}`);

  // Generate schedule token
  const scheduleToken = crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(docRef.id + ':' + email)
    .digest('hex');

  // Map program type → email action
  const emailAction = yttTypeToAction(resolvedType);

  // Send notifications in parallel
  await Promise.all([
    process.env.GMAIL_APP_PASSWORD
      ? sendAdminNotification(lead).catch(e => console.error('[audit-leads] Admin email failed:', e.message))
      : Promise.resolve(),
    email
      ? sendWelcomeEmail(lead, emailAction, { leadId: docRef.id, token: scheduleToken })
          .catch(e => console.error('[audit-leads] Welcome email failed:', e.message))
      : Promise.resolve(),
    process.env.GATEWAYAPI_TOKEN && phone
      ? sendWelcomeSMS(lead, docRef.id).catch(e => console.error('[audit-leads] SMS failed:', e.message))
      : Promise.resolve(),
    triggerNewLeadSequences(docRef.id, lead).catch(e => console.error('[audit-leads] Sequence trigger failed:', e.message))
  ]);

  return {
    first_name: firstName,
    last_name: lastName,
    program_type: resolvedType,
    lang: metaLang,
    country: lead.country,
    firestoreId: docRef.id
  };
}

// ─── Graph API ───────────────────────────────────────────────────────────────

function fetchLeadsForForm(formId, sinceTs) {
  const token = process.env.FB_PAGE_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;
  const fields = 'id,created_time,field_data,ad_id,ad_name,form_id,platform';
  const filtering = encodeURIComponent(JSON.stringify([
    { field: 'time_created', operator: 'GREATER_THAN', value: sinceTs }
  ]));
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${formId}/leads?fields=${fields}&filtering=${filtering}&limit=100&access_token=${token}`;
  return fetchAllPages(url);
}

async function fetchAllPages(url) {
  const results = [];
  let nextUrl = url;
  while (nextUrl) {
    const data = await graphGet(nextUrl);
    results.push(...(data.data || []));
    nextUrl = data.paging && data.paging.next ? data.paging.next : null;
  }
  return results;
}

function graphGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let body = '';
      res.on('data', chunk => (body += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed.error) reject(new Error(`Graph API: ${parsed.error.message}`));
          else resolve(parsed);
        } catch (e) {
          reject(new Error('Failed to parse Graph API response'));
        }
      });
    }).on('error', reject);
  });
}

// ─── Helpers (mirrored from facebook-leads-webhook.js) ───────────────────────

function findFieldByKeyword(fields, keywords) {
  for (const [key, value] of Object.entries(fields)) {
    const lowerKey = key.toLowerCase();
    for (const kw of keywords) {
      if (lowerKey.includes(kw.toLowerCase())) return value;
    }
  }
  return '';
}

function mapProgramAnswer(answer) {
  if (!answer) return '';
  const lower = answer.toLowerCase().trim();
  if (PROGRAM_ANSWER_MAP[lower]) return PROGRAM_ANSWER_MAP[lower];
  for (const [key, type] of Object.entries(PROGRAM_ANSWER_MAP)) {
    if (lower.includes(key) || key.includes(lower)) return type;
  }
  return '';
}

function detectYTTType(program, formName, formId) {
  if (formId && FORM_ID_MAP[formId] && FORM_ID_MAP[formId] !== 'from-answer') {
    return FORM_ID_MAP[formId];
  }
  const combined = `${program} ${formName}`.toLowerCase();
  if (combined.includes('ved ikke') || combined.includes("don't know") || combined.includes('not sure')) return 'undecided';
  if (combined.includes('300')) return '300h';
  if (combined.includes('50h') || combined.includes('50 hour')) return '50h';
  if (combined.includes('30h') || combined.includes('30 hour')) return '30h';
  if (combined.includes('vinyasa plus') || (combined.includes('4') && combined.includes('jul'))) return '4-week-jul';
  if (combined.includes('18') || combined.includes('fleksib') || combined.includes('flexible')) return '18-week';
  if (combined.includes('8') && (combined.includes('uge') || combined.includes('week') || combined.includes('semi'))) return '8-week';
  if (combined.includes('4') && (combined.includes('uge') || combined.includes('week') || combined.includes('intensi'))) return '4-week';
  return '4-week';
}

function yttTypeToAction(programType) {
  switch (programType) {
    case '18-week':      return 'lead_schedule_18w';
    case '18-week-aug':  return 'lead_schedule_18w-aug';
    case '8-week':       return 'lead_schedule_8w';
    case '4-week':       return 'lead_schedule_4w';
    case '4-week-jul':   return 'lead_schedule_4w-jul';
    case '300h':         return 'lead_schedule_300h';
    case '50h':          return 'lead_schedule_50h';
    case '30h':          return 'lead_schedule_30h';
    case 'undecided':    return 'lead_undecided';
    default:             return 'lead_meta';
  }
}

function normalizeYesNo(val) {
  if (!val) return 'No';
  const v = String(val).toLowerCase().trim();
  return (v === 'yes' || v === 'ja' || v === 'true' || v === '1') ? 'Yes' : 'No';
}

function normalizeHousingAnswer(val) {
  if (!val) return 'No';
  const v = String(val).toLowerCase().trim();
  if (v === 'ja') return 'Yes';
  if (v === 'nej') return 'No';
  if (v.includes('finder selv')) return 'Self';
  return normalizeYesNo(val);
}

function normalizeAccommodationAnswer(val) {
  if (!val) return 'No';
  const v = String(val).toLowerCase().trim();
  // "Yes, I need accommodation" variants
  if (v.includes('yes') || v.includes('ja') || v.includes('kyllä') || v.includes('behöver') || v.includes('brauche') || v.includes('tarvitsen') || v.includes('heb nodig')) {
    if (v.includes('plus') || v.includes('extra') || v.includes('before') || v.includes('before') || v.includes('tidlig')) return 'accommodation_plus';
    return 'accommodation';
  }
  // "I'll arrange my own"
  if (v.includes('self') || v.includes('selv') || v.includes('själv') || v.includes('selbst') || v.includes('itse') || v.includes('zelf') || v.includes('own')) return 'self_arranged';
  // "I live in Denmark/Copenhagen"
  if (v.includes('live') || v.includes('bor') || v.includes('wohne') || v.includes('asun') || v.includes('woon')) return 'lives_in_denmark';
  return 'No';
}

function normalizeYogaExperience(val) {
  if (!val) return '';
  const v = String(val).toLowerCase().trim();
  if (v.includes('ytt before') || v.includes('yogalærerutdanning') || v.includes('yogalärarutbildning') ||
      v.includes('yogalehrerausbildung') || v.includes('joogaopettajakoulutuk') || v.includes('yogadocentenopleiding')) {
    return 'previous_ytt';
  }
  if (v.includes('beginner') || v.includes('nybegynner') || v.includes('nybörjare') ||
      v.includes('anfänger') || v.includes('aloittelija') || v.includes('beginner')) {
    return 'beginner';
  }
  if (v.includes('regular') || v.includes('regelm') || v.includes('regelbund') ||
      v.includes('säännöllis') || v.includes('regelmatig') || v.includes('jevnlig')) {
    return 'regular';
  }
  return '';
}

function normalizeEnglishComfort(val) {
  if (!val) return '';
  const v = String(val).toLowerCase().trim();
  if (v.includes('usikker') || v.includes('osäker') || v.includes('nicht sicher') ||
      v.includes('en ole varma') || v.includes('niet zeker')) {
    return 'unsure';
  }
  if (v.includes('tålmodighet') || v.includes('tålamod') || v.includes('geduld') ||
      v.includes('kärsivällisyyttä') || v.includes('geduld nodig')) {
    return 'needs_patience';
  }
  if (v.includes('ikke noe problem') || v.includes('inga problem') || v.includes('kein problem') ||
      v.includes('ei ongelmaa') || v.includes('geen probleem')) {
    return 'comfortable';
  }
  return '';
}

function jsonResp(status, data) {
  return {
    statusCode: status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(data, null, 2)
  };
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };
}
