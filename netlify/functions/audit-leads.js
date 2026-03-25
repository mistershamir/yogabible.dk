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

  const dryRun = event.httpMethod === 'GET';
  const sinceTs = params.since
    ? Math.floor(new Date(params.since).getTime() / 1000)
    : Math.floor((Date.now() - 3 * 24 * 60 * 60 * 1000) / 1000); // 3 days ago

  const targetFormId = params.form_id || null;

  console.log(`[audit-leads] Starting — since=${new Date(sinceTs * 1000).toISOString()}, dry_run=${dryRun}, form_id=${targetFormId || 'all'}`);

  try {
    // 1. Fetch forms from the page
    const allForms = await fetchForms();
    const forms = targetFormId
      ? allForms.filter(f => f.id === targetFormId)
      : allForms;

    console.log(`[audit-leads] Found ${allForms.length} form(s) on page, checking ${forms.length}`);

    const results = {
      dry_run: dryRun,
      since: new Date(sinceTs * 1000).toISOString(),
      all_forms: allForms.map(f => ({ id: f.id, name: f.name, status: f.status })),
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

function fetchForms() {
  const token = process.env.FB_PAGE_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${PAGE_ID}/leadgen_forms?fields=id,name,status&limit=100&access_token=${token}`;
  return graphGet(url).then(data => data.data || []);
}

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
