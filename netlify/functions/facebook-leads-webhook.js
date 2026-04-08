/**
 * Facebook Lead Ads Webhook — Yoga Bible
 *
 * Replaces Zapier for Facebook instant form lead capture.
 * Meta sends a webhook when someone submits a Facebook Lead Ad form.
 * We fetch the full lead from the Graph API and process it identically
 * to how lead.js handles the lead_meta action.
 *
 * GET  /.netlify/functions/facebook-leads-webhook  → Meta webhook verification
 * POST /.netlify/functions/facebook-leads-webhook  → Receive leadgen events
 *
 * --- Setup ---
 * 1. In Meta App Dashboard → Webhooks → Page → Subscribe to "leadgen" topic
 * 2. Callback URL: https://yogabible.dk/.netlify/functions/facebook-leads-webhook
 * 3. Verify token: match the META_VERIFY_TOKEN env var value
 * 4. Add FB_PAGE_ACCESS_TOKEN env var (Page token with leads_retrieval + pages_manage_metadata perms)
 *
 * --- How it works ---
 * Meta sends:  { entry: [{ changes: [{ field: "leadgen", value: { leadgen_id, form_id, ad_id, ad_name, page_id } }] }] }
 * We then GET: https://graph.facebook.com/v21.0/{leadgen_id}?fields=field_data,...&access_token=PAGE_TOKEN
 * That returns: { field_data: [{ name: "email", values: ["..."] }, { name: "full_name", values: ["..."] }, ...] }
 */

const crypto = require('crypto');
const https = require('https');
const { getDb } = require('./shared/firestore');
const { sendAdminNotification } = require('./shared/email-service');
const { sendWelcomeSMS } = require('./shared/sms-service');
const { sendWelcomeEmail } = require('./shared/lead-emails');
const { sendLeadEvent } = require('./shared/meta-events');
const { triggerNewLeadSequences } = require('./shared/sequence-trigger');
const { detectLeadCountry } = require('./shared/country-detect');

const GRAPH_API_VERSION = 'v25.0';
const TOKEN_SECRET = process.env.UNSUBSCRIBE_SECRET || 'yb-appt-secret';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  if (event.httpMethod === 'GET') {
    return handleVerification(event);
  }

  if (event.httpMethod === 'POST') {
    return handleLeadEvent(event);
  }

  return { statusCode: 405, body: 'Method not allowed' };
};

// ─── Webhook Verification ────────────────────────────────────────────────────

function handleVerification(event) {
  const params = event.queryStringParameters || {};
  const mode = params['hub.mode'];
  const token = params['hub.verify_token'];
  const challenge = params['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    console.log('[fb-leads] Webhook verified successfully');
    return { statusCode: 200, body: challenge };
  }

  console.error('[fb-leads] Webhook verification failed — token mismatch');
  return { statusCode: 403, body: 'Verification failed' };
}

// ─── Lead Event Handler ──────────────────────────────────────────────────────

async function handleLeadEvent(event) {
  if (!verifySignature(event)) {
    console.error('[fb-leads] Invalid webhook signature');
    return { statusCode: 401, body: 'Invalid signature' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  // Process each entry (Meta may batch multiple pages/changes)
  const entries = payload.entry || [];
  for (const entry of entries) {
    const changes = entry.changes || [];
    for (const change of changes) {
      if (change.field === 'leadgen') {
        await processLeadgenChange(change.value).catch(err => {
          console.error('[fb-leads] Error processing leadgen change:', err.message);
        });
      }
    }
  }

  // Always respond 200 — Meta retries on any other status code
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
}

// ─── Core Lead Processing ────────────────────────────────────────────────────

async function processLeadgenChange(value) {
  const { leadgen_id, form_id, ad_id, ad_name, page_id } = value;
  console.log(`[fb-leads] Processing lead: leadgen_id=${leadgen_id}, form=${form_id}, ad="${ad_name}"`);

  // Fetch full lead data + form name from Facebook Graph API in parallel
  const [leadData, formName] = await Promise.all([
    fetchLeadFromGraph(leadgen_id),
    form_id ? fetchFormNameFromGraph(form_id) : Promise.resolve('')
  ]);
  console.log(`[fb-leads] Form name resolved: "${formName}"`);

  // Convert field_data array → flat key/value object
  // e.g. [{ name: "email", values: ["anna@example.com"] }] → { email: "anna@example.com" }
  const fields = {};
  for (const field of (leadData.field_data || [])) {
    fields[field.name] = Array.isArray(field.values) ? field.values[0] : field.values;
  }

  // Log all raw field names for debugging (helps identify new form field names)
  console.log(`[fb-leads] Raw field names: ${Object.keys(fields).join(', ')}`);

  // Parse name — Meta may send full_name or separate first_name/last_name
  // Danish forms use: fornavn (first name), efternavn (last name)
  // Also handle "for- og efternavn" (first and last name combined field)
  const fullName = fields.full_name || fields.name || fields['for- og efternavn'] || findFieldByKeyword(fields, ['fulde navn', 'full name', 'navn']) || '';
  const nameParts = fullName.trim().split(/\s+/);
  const firstName = fields.first_name || fields.fornavn || fields.fornavne || findFieldByKeyword(fields, ['fornavn', 'first name', 'first_name', 'förnamn', 'vorname', 'etunimi', 'voornaam']) || nameParts[0] || '';
  const lastName = fields.last_name || fields.efternavn || findFieldByKeyword(fields, ['efternavn', 'last name', 'last_name', 'efternamn', 'nachname', 'sukunimi', 'achternaam', 'etternavn']) || nameParts.slice(1).join(' ') || '';
  const email = (fields.email || fields['e-mail'] || fields['e-mailadresse'] || fields['e-post'] || findFieldByKeyword(fields, ['email', 'e-mail', 'e-post', 'epost', 'mail', 'sähköposti']) || '').toLowerCase().trim();
  const phone = fields.phone_number || fields.phone || fields.telefonnummer || fields.telefon || fields.mobil || findFieldByKeyword(fields, ['telefon', 'phone', 'mobil', 'puhelinnumero', 'telefoonnummer']) || '';
  const city = fields.city || fields.location || fields.by || findFieldByKeyword(fields, ['by', 'city', 'location', 'hvor bor', 'stad', 'ort', 'stadt', 'kaupunki', 'plaats', 'sted']) || '';
  const country = fields.country || fields.land || findFieldByKeyword(fields, ['country', 'land', 'maa', 'pays']) || '';

  // Parse custom questions — Meta sends these as field_data with the question text as key
  // We do a fuzzy match since Meta may vary casing/encoding of Danish characters
  const programAnswer = findFieldByKeyword(fields, ['program', 'interesseret', 'hvilket']) || '';
  const housingAnswer = findFieldByKeyword(fields, ['bolig', 'housing', 'hjælp med bolig', 'hjaelp']) || '';
  const program = fields.program || fields.which_program || fields.interested_in || programAnswer || '';

  // July Vinyasa Plus international form questions (Q1–Q3)
  const yogaExpAnswer = findFieldByKeyword(fields, ['yoga experience', 'yogaerfaring', 'yogaerfarenhet', 'yogaerfahrung', 'joogakokemust', 'yoga-ervaring']) || '';
  const accommodationAnswer = findFieldByKeyword(fields, ['stay in copenhagen', 'oppholdet', 'vistelse', 'aufenthalt', 'oleskeluu', 'verblijf', 'overnatning']) || '';
  const englishComfortAnswer = findFieldByKeyword(fields, ['english', 'engelsk', 'engelska', 'englisch', 'englanniksi', 'engels']) || '';

  // Parse tracking parameters (set in Meta form settings)
  const metaCampaignName = fields.campaign_name || '';
  const metaAdsetName = fields.adset_name || '';
  const metaAdName = fields.ad_name || '';
  const metaFormNameParam = fields.form_name || '';
  // Language detection priority:
  // 1. Form ID map (bulletproof — Meta hidden fields sometimes don't arrive)
  // 2. Form's lang field (if Meta passes it in field_data)
  // 3. Country detection from form fields
  // 4. Default 'da' (domestic market)
  var metaLang = FORM_LANG_MAP[form_id] || fields.lang || '';
  if (!metaLang) {
    var detectedCountry = detectLeadCountry({
      country: country,
      city_country: country ? (city ? city + ', ' + country : country) : city,
      phone: phone
    });
    if (detectedCountry === 'DK') {
      metaLang = 'da';
    } else if (['DE', 'AT', 'CH'].includes(detectedCountry)) {
      metaLang = 'de';
    } else if (detectedCountry !== 'OTHER') {
      metaLang = 'en';
    } else {
      metaLang = 'da';
    }
  }
  const metaCohort = fields.cohort || '';

  // Platform detection: Graph API returns "facebook", "instagram", or "messenger"
  // Priority: Graph API response (most reliable) → form field fallback → page_id heuristic
  const graphPlatform = (leadData.platform || '').toLowerCase();
  const fieldPlatform = (fields.platform || '').toLowerCase();
  const metaPlatform = graphPlatform || fieldPlatform || '';

  console.log(`[fb-leads] Parsed fields — program="${program}", housing="${housingAnswer}", platform="${metaPlatform}" (graph="${graphPlatform}", field="${fieldPlatform}"), lang="${metaLang}", city="${city}", country="${country}", yogaExp="${yogaExpAnswer}", accommodation="${accommodationAnswer}", englishComfort="${englishComfortAnswer}"`);

  if (!email) {
    console.warn('[fb-leads] Lead has no email — skipping:', leadgen_id);
    return;
  }

  // ── Dedup: check if a lead with this email already exists ─────────────
  // Meta retries webhook delivery on non-200 responses, and users sometimes
  // submit forms multiple times. Without this check, each retry/resubmit
  // creates a new lead doc → triggers welcome email + sequence enrollments.
  const db = getDb();
  const existingLeadSnap = await db.collection('leads')
    .where('email', '==', email)
    .limit(1)
    .get();

  if (!existingLeadSnap.empty) {
    const existingId = existingLeadSnap.docs[0].id;
    const existingData = existingLeadSnap.docs[0].data();
    const ageMinutes = (Date.now() - (existingData.created_at?.toDate?.() || new Date(existingData.created_at)).getTime()) / 60000;
    console.log(`[fb-leads] Duplicate email ${email} — existing lead ${existingId} (${Math.round(ageMinutes)} min old). Skipping.`);
    // If the existing lead was created very recently (< 60 min), it's almost certainly
    // a Meta retry or double-submit. Skip entirely.
    // If older, still skip lead creation but log for awareness.
    return;
  }

  // Resolve program type: FORM_ID_MAP first, then answer mapping, then keyword fallback
  let resolvedType;
  const formMapType = FORM_ID_MAP[form_id];
  if (formMapType === 'from-answer') {
    // This form has a program question — use the answer
    resolvedType = mapProgramAnswer(programAnswer) || detectYTTType(program, ad_name || formName || '', '');
    console.log(`[fb-leads] Program answer "${programAnswer}" → type "${resolvedType}"`);
  } else {
    resolvedType = detectYTTType(program, ad_name || formName || '', form_id);
  }

  // Resolve accommodation from housing question (international forms or Danish forms)
  const accommodationValue = accommodationAnswer
    ? normalizeAccommodationAnswer(accommodationAnswer)
    : housingAnswer
      ? normalizeHousingAnswer(housingAnswer)
      : normalizeYesNo(fields.housing || fields.accommodation || 'No');

  // Normalize Q1 (yoga experience) and Q3 (english comfort)
  const yogaExperience = normalizeYogaExperience(yogaExpAnswer);
  const englishComfort = normalizeEnglishComfort(englishComfortAnswer);

  // Check if already an applicant in Firestore
  const existingSnap = await db.collection('applications')
    .where('email', '==', email)
    .limit(1)
    .get();
  const existingAppId = existingSnap.empty ? null : (existingSnap.docs[0].data().application_id || 'Unknown');

  const lead = {
    // Identity
    email,
    first_name: firstName,
    last_name: lastName,
    phone,
    // Program info — use form name for detection when ad_name is missing
    type: 'ytt',
    ytt_program_type: resolvedType,
    program: program || ad_name || formName || 'Facebook Lead Form',
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
    message: fields.message || fields.comments || fields.besked || findFieldByKeyword(fields, ['besked', 'message', 'kommentar', 'comment']) || '',
    source: metaPlatform === 'instagram' ? 'Instagram Ad' : 'Facebook Ad',
    // Meta metadata (useful for reporting)
    meta_form_id: form_id || '',
    meta_form_name: formName || metaFormNameParam || '',
    meta_ad_id: ad_id || '',
    meta_campaign: metaCampaignName || ad_name || '',
    meta_adset_name: metaAdsetName || '',
    meta_ad_name: metaAdName || ad_name || '',
    meta_leadgen_id: leadgen_id || '',
    meta_page_id: page_id || '',
    meta_platform: metaPlatform || '',
    meta_lang: metaLang || 'da',
    lang: metaLang || 'da',
    // Status
    converted: false,
    converted_at: null,
    application_id: null,
    status: existingAppId ? 'Existing Applicant' : 'New',
    notes: existingAppId ? `EXISTING APPLICANT (App ID: ${existingAppId})` : '',
    unsubscribed: false,
    call_attempts: 0,
    sms_status: '',
    last_contact: null,
    followup_date: null,
    multi_format: '',
    all_formats: '',
    created_at: new Date(),
    updated_at: new Date()
  };

  // Detect and normalize country for nurture sequence country blocks
  lead.country = detectLeadCountry(lead);

  // Save to Firestore leads collection
  const docRef = await db.collection('leads').add(lead);
  console.log(`[fb-leads] Lead saved: ${docRef.id} (${email})`);

  // Tokenized link for the lead's schedule/booking page
  const scheduleToken = crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(docRef.id + ':' + email)
    .digest('hex');

  // Map ytt_program_type → correct email template action
  const emailAction = yttTypeToAction(lead.ytt_program_type);
  console.log(`[fb-leads] Email action for type "${lead.ytt_program_type}": ${emailAction}`);

  // Fire notifications + Meta CAPI event in parallel — same as lead.js
  await Promise.all([
    process.env.GMAIL_APP_PASSWORD
      ? sendAdminNotification(lead).catch(e => console.error('[fb-leads] Admin email failed:', e.message))
      : Promise.resolve(),
    process.env.GMAIL_APP_PASSWORD && email
      ? sendWelcomeEmail(lead, emailAction, { leadId: docRef.id, token: scheduleToken })
          .catch(e => console.error('[fb-leads] Welcome email failed:', e.message))
      : Promise.resolve(),
    process.env.GATEWAYAPI_TOKEN && phone
      ? sendWelcomeSMS(lead, docRef.id).catch(e => console.error('[fb-leads] SMS failed:', e.message))
      : Promise.resolve(),
    // Report Lead event back to Meta CAPI + Offline Event Set for closed-loop attribution
    sendLeadEvent(lead, docRef.id).catch(e => console.error('[fb-leads] Meta CAPI event failed:', e.message)),
    // Auto-enroll in matching sequences
    triggerNewLeadSequences(docRef.id, lead).catch(e => console.error('[fb-leads] Sequence trigger failed:', e.message))
  ]);
}

// ─── Graph API ───────────────────────────────────────────────────────────────

function fetchFormNameFromGraph(formId) {
  const token = process.env.FB_PAGE_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${formId}?fields=name&access_token=${token}`;

  return new Promise((resolve) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.name || '');
        } catch (e) {
          resolve('');
        }
      });
    }).on('error', () => resolve(''));
  });
}

// ─── Form ID → Program Type Map ──────────────────────────────────────────────
// Checked FIRST before keyword matching — add new form IDs here as you create them.
// Form ID is shown as meta_form_id in admin notification emails.
//
// How to find a form ID:
//   1. It appears in the admin notification email as "meta_form_id"
//   2. Or: Meta Ads Manager → Instant Forms → click the form → check the URL
//
// Program types: '18-week' | '8-week' | '4-week' | '4-week-jul' | '18-week-aug' | '300h' | '50h' | '30h' | 'undecided'
// 'from-answer' = use the answer to the program question (multi-program forms)
const FORM_ID_MAP = {
  '1974647360148367': '18-week',        // 18 Ugers Fleksibelt YTT — March–June 2026 cohort
  '961808297026346':  'from-answer',    // General YTT form — program determined by Q2 answer
  // July Vinyasa Plus — International instant forms
  '827004866473769':  '4-week-jul',     // july-vinyasa-plus-en  (UK / English)
  '25716246641411656':'4-week-jul',     // july-vinyasa-plus-no  (Norway)
  '4318151781759438': '4-week-jul',     // july-vinyasa-plus-se  (Sweden)
  '2450631555377690': '4-week-jul',     // july-vinyasa-plus-de  (Germany/Austria)
  '1668412377638315': '4-week-jul',     // july-vinyasa-plus-fi  (Finland)
  '960877763097239':  '4-week-jul',     // july-vinyasa-plus-nl  (Netherlands)
  '1344364364192542': '4-week-jul'      // july-vinyasa-plus-dk  (Denmark)
};

// Form ID → Language override — bulletproof, doesn't rely on Meta passing hidden fields
// Meta tracking parameters sometimes don't arrive in field_data, so we map form_id directly.
const FORM_LANG_MAP = {
  '827004866473769':  'en',     // july-vinyasa-plus-en (UK)
  '25716246641411656':'en',     // july-vinyasa-plus-no
  '4318151781759438': 'en',     // july-vinyasa-plus-se
  '2450631555377690': 'de',     // july-vinyasa-plus-de
  '1668412377638315': 'en',     // july-vinyasa-plus-fi
  '960877763097239':  'en',     // july-vinyasa-plus-nl
  '1344364364192542': 'da',     // july-vinyasa-plus-dk
  '961808297026346':  'da'      // general dk form (multi-program, asks which course)
};

// ─── Program Answer → Type Map ───────────────────────────────────────────────
// Maps the user's answer to "Hvilket program er du mest interesseret i?" → ytt_program_type
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

// ─── Housing Answer Normalization ────────────────────────────────────────────
// Maps Danish housing question answers to our internal yes/no/self values
function normalizeHousingAnswer(val) {
  if (!val) return 'No';
  const v = String(val).toLowerCase().trim();
  if (v === 'ja') return 'Yes';
  if (v === 'nej') return 'No';
  if (v.includes('finder selv')) return 'Self';
  // Fallback to generic yes/no
  return normalizeYesNo(val);
}

// ─── Q1: Yoga Experience Normalization ──────────────────────────────────────
// Normalizes answers from all 6 language variants → regular / beginner / previous_ytt
function normalizeYogaExperience(val) {
  if (!val) return '';
  const v = String(val).toLowerCase().trim();
  // Option 3: previous YTT (EN/NO/SE/DE/FI/NL/DA)
  if (v.includes('ytt before') || v.includes('yogalærerutdanning') || v.includes('yogalärarutbildning') ||
      v.includes('yogalehrerausbildung') || v.includes('joogaopettajakoulutuksen') || v.includes('yogadocentenopleiding') ||
      v.includes('yogalæreruddannelse')) {
    return 'previous_ytt';
  }
  // Option 2: beginner / fairly new (EN/NO/SE/DE/FI/NL/DA)
  if (v.includes('new to yoga') || v.includes('ganske ny') || v.includes('ganska ny') ||
      v.includes('neu im yoga') || v.includes('melko uusi') || v.includes('vrij nieuw') ||
      v.includes('ret ny inden for yoga')) {
    return 'beginner';
  }
  // Option 1: regular practitioner (EN/NO/SE/DE/FI/NL/DA)
  if (v.includes('regularly') || v.includes('regelmessig') || v.includes('regelbundet') ||
      v.includes('regelmäßig') || v.includes('säännöllisesti') || v.includes('regelmatig') ||
      v.includes('regelmæssigt')) {
    return 'regular';
  }
  return '';
}

// ─── Q2: Accommodation / Practicalities Normalization ───────────────────────
// Normalizes answers from all 6 language variants →
// accommodation / accommodation_plus / self_arranged / lives_in_denmark
function normalizeAccommodationAnswer(val) {
  if (!val) return '';
  const v = String(val).toLowerCase().trim();
  // Option 4a: lives in Copenhagen — DA form only (can access studio physically)
  if (v.includes('bor i københavn')) {
    return 'lives_in_copenhagen';
  }
  // Option 4b: lives in Denmark (EN/NO/SE/DE/FI/NL international forms)
  if (v.includes('live in denmark') || v.includes('bor i danmark') || v.includes('lebe in dänemark') ||
      v.includes('tanskassa') || v.includes('asun tanskassa') || v.includes('woon in denemarken')) {
    return 'lives_in_denmark';
  }
  // Option 3: self-arranged / no thanks (EN/NO/SE/DE/FI/NL/DA)
  if (v.includes('no thanks') || v.includes('nei takk') || v.includes('nej tack') ||
      v.includes('nein danke') || v.includes('ei kiitos') || v.includes('nee bedankt') ||
      v.includes('nej tak') ||
      v.includes('sort everything') || v.includes('ordner alt') || v.includes('ordnar allt') ||
      v.includes('organisiere alles') || v.includes('hoidan itse') || v.includes('regel alles') ||
      v.includes('klarer det selv')) {
    return 'self_arranged';
  }
  // Option 2: accommodation + other practicalities (EN/NO/SE/DE/FI/NL/DA)
  if ((v.includes('accommodation') || v.includes('overnatting') || v.includes('boende') ||
       v.includes('unterkunft') || v.includes('majoituksen') || v.includes('accommodatie') ||
       v.includes('overnatning')) &&
      (v.includes('practical') || v.includes('praktisk') || v.includes('praktiska') ||
       v.includes('praktischen') || v.includes('käytännön') || v.includes('zaken') || v.includes('andre') ||
       v.includes('praktiske'))) {
    return 'accommodation_plus';
  }
  // Option 1: accommodation only (EN/NO/SE/DE/FI/NL/DA)
  if (v.includes('help with accommodation') || v.includes('hjelp med overnatting') ||
      v.includes('hjälp med boende') || v.includes('hilfe bei der unterkunft') ||
      v.includes('apua majoituksen') || v.includes('hulp met accommodatie') ||
      v.includes('hjælp med overnatning')) {
    return 'accommodation';
  }
  return '';
}

// ─── Q3: English Language Comfort Normalization ─────────────────────────────
// Normalizes answers from 5 non-EN language variants →
// comfortable / needs_patience / unsure (NOT on English form)
function normalizeEnglishComfort(val) {
  if (!val) return '';
  const v = String(val).toLowerCase().trim();
  // Option 3: unsure (NO/SE/DE/FI/NL)
  if (v.includes('usikker') || v.includes('osäker') || v.includes('nicht sicher') ||
      v.includes('en ole varma') || v.includes('niet zeker')) {
    return 'unsure';
  }
  // Option 2: needs patience (NO/SE/DE/FI/NL)
  if (v.includes('tålmodighet') || v.includes('tålamod') || v.includes('geduld') ||
      v.includes('kärsivällisyyttä') || v.includes('geduld nodig')) {
    return 'needs_patience';
  }
  // Option 1: comfortable / no problem (NO/SE/DE/FI/NL)
  if (v.includes('ikke noe problem') || v.includes('inga problem') || v.includes('kein problem') ||
      v.includes('ei ongelmaa') || v.includes('geen probleem')) {
    return 'comfortable';
  }
  return '';
}

function fetchLeadFromGraph(leadgenId) {
  const token = process.env.FB_PAGE_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${leadgenId}?fields=field_data,form_id,ad_id,ad_name,created_time,platform&access_token=${token}`;

  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(`Graph API error: ${parsed.error.message}`));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error('Failed to parse Graph API response'));
        }
      });
    }).on('error', reject);
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Find a field value by keyword matching on field names.
 * Meta form custom questions arrive with the question text as the field name,
 * which may include Danish characters and varying formats.
 */
function findFieldByKeyword(fields, keywords) {
  for (const [key, value] of Object.entries(fields)) {
    const lowerKey = key.toLowerCase();
    for (const kw of keywords) {
      if (lowerKey.includes(kw.toLowerCase())) return value;
    }
  }
  return '';
}

/**
 * Map a program answer string → ytt_program_type using PROGRAM_ANSWER_MAP.
 * Does fuzzy matching: lowercases and checks if the answer starts with any key.
 */
function mapProgramAnswer(answer) {
  if (!answer) return '';
  const lower = answer.toLowerCase().trim();
  // Exact match first
  if (PROGRAM_ANSWER_MAP[lower]) return PROGRAM_ANSWER_MAP[lower];
  // Partial match — check if answer starts with or contains a known key
  for (const [key, type] of Object.entries(PROGRAM_ANSWER_MAP)) {
    if (lower.includes(key) || key.includes(lower)) return type;
  }
  return '';
}

/**
 * Detect YTT program type.
 * Priority: 1) FORM_ID_MAP (exact match, excluding 'from-answer') → 2) keyword matching on program/formName.
 */
function detectYTTType(program, formName, formId) {
  // 1. Exact form ID match — most reliable
  if (formId && FORM_ID_MAP[formId] && FORM_ID_MAP[formId] !== 'from-answer') {
    console.log(`[fb-leads] detectYTTType: matched form_id ${formId} → ${FORM_ID_MAP[formId]}`);
    return FORM_ID_MAP[formId];
  }
  // 2. Keyword matching fallback
  const combined = `${program} ${formName}`.toLowerCase();
  if (combined.includes('ved ikke') || combined.includes('don\'t know') || combined.includes('not sure')) return 'undecided';
  if (combined.includes('300')) return '300h';
  if (combined.includes('50h') || combined.includes('50 hour')) return '50h';
  if (combined.includes('30h') || combined.includes('30 hour')) return '30h';
  if (combined.includes('vinyasa plus') || (combined.includes('4') && combined.includes('jul'))) return '4-week-jul';
  if (combined.includes('18') || combined.includes('fleksib') || combined.includes('flexible')) return '18-week';
  if (combined.includes('8') && (combined.includes('uge') || combined.includes('week') || combined.includes('semi'))) return '8-week';
  if (combined.includes('4') && (combined.includes('uge') || combined.includes('week') || combined.includes('intensi'))) return '4-week';
  return '4-week';
}

/**
 * Map ytt_program_type → sendWelcomeEmail action string.
 * Mirrors the routing in lead.js / lead-emails.js.
 */
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
    default:             return 'lead_meta'; // generic fallback
  }
}

function normalizeYesNo(val) {
  if (!val) return 'No';
  const v = String(val).toLowerCase().trim();
  return (v === 'yes' || v === 'ja' || v === 'true' || v === '1') ? 'Yes' : 'No';
}

/**
 * Verify Meta's x-hub-signature-256 header.
 * Uses META_APP_SECRET — same secret used by the Instagram webhook.
 */
function verifySignature(event) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) {
    console.warn('[fb-leads] META_APP_SECRET not set — skipping signature verification');
    return true;
  }

  const sigHeader = event.headers['x-hub-signature-256'] || event.headers['X-Hub-Signature-256'] || '';
  const signature = sigHeader.replace('sha256=', '');
  if (!signature) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(event.body || '')
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch (e) {
    return false;
  }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };
}
