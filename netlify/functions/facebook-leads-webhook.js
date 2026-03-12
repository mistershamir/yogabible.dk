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

const GRAPH_API_VERSION = 'v21.0';
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

  // Parse name — Meta may send full_name or separate first_name/last_name
  // Danish forms use: fornavn (first name), efternavn (last name)
  const fullName = fields.full_name || fields.name || '';
  const nameParts = fullName.trim().split(/\s+/);
  const firstName = fields.first_name || fields.fornavn || nameParts[0] || '';
  const lastName = fields.last_name || fields.efternavn || nameParts.slice(1).join(' ') || '';
  const email = (fields.email || fields['e-mail'] || '').toLowerCase().trim();
  const phone = fields.phone_number || fields.phone || fields.telefonnummer || '';
  const city = fields.city || fields.location || fields.by || '';

  // Parse custom questions — Meta sends these as field_data with the question text as key
  // We do a fuzzy match since Meta may vary casing/encoding of Danish characters
  const programAnswer = findFieldByKeyword(fields, ['program', 'interesseret', 'hvilket']) || '';
  const housingAnswer = findFieldByKeyword(fields, ['bolig', 'housing', 'hjælp med bolig', 'hjaelp']) || '';
  const program = fields.program || fields.which_program || fields.interested_in || programAnswer || '';

  // Parse tracking parameters (set in Meta form settings)
  const metaCampaignName = fields.campaign_name || '';
  const metaAdsetName = fields.adset_name || '';
  const metaAdName = fields.ad_name || '';
  const metaFormNameParam = fields.form_name || '';
  const metaPlatform = fields.platform || '';
  const metaLang = fields.lang || 'da';
  const metaCohort = fields.cohort || '';

  console.log(`[fb-leads] Parsed fields — program="${program}", housing="${housingAnswer}", platform="${metaPlatform}", lang="${metaLang}"`);

  if (!email) {
    console.warn('[fb-leads] Lead has no email — skipping:', leadgen_id);
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

  // Resolve accommodation from housing question
  const accommodationValue = housingAnswer
    ? normalizeHousingAnswer(housingAnswer)
    : normalizeYesNo(fields.housing || fields.accommodation || 'No');

  // Check if already an applicant in Firestore
  const db = getDb();
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
    city_country: city,
    housing_months: '',
    service: '',
    subcategories: '',
    message: fields.message || fields.comments || '',
    source: 'Facebook Ad',
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
  '961808297026346':  'from-answer'     // General YTT form — program determined by Q2 answer
  // Add new forms below:
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

function fetchLeadFromGraph(leadgenId) {
  const token = process.env.FB_PAGE_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${leadgenId}?fields=field_data,form_id,ad_id,ad_name,created_time&access_token=${token}`;

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
