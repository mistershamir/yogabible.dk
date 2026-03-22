/**
 * Facebook Leads Backfill — Yoga Bible
 *
 * One-time function to pull historical leads from Facebook Graph API
 * and process them through the same pipeline as the live webhook.
 *
 * GET /.netlify/functions/facebook-leads-backfill?since=2026-02-27&dry_run=true
 *   dry_run=true  → fetch + report only, no writes/emails/SMS
 *   dry_run=false → full processing (saves to Firestore, sends emails/SMS)
 *
 * Requires admin auth.
 */

const crypto = require('crypto');
const https = require('https');
const { getDb } = require('./shared/firestore');
const { requireAuth } = require('./shared/auth');
const { sendAdminNotification } = require('./shared/email-service');
const { sendWelcomeSMS } = require('./shared/sms-service');
const { sendWelcomeEmail } = require('./shared/lead-emails');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const GRAPH_API_VERSION = 'v25.0';
const PAGE_ID = '878172732056415';
const TOKEN_SECRET = process.env.UNSUBSCRIBE_SECRET || 'yb-appt-secret';

// Default: Feb 27 2026 00:00:00 UTC
const DEFAULT_SINCE_TS = 1772150400;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  const user = await requireAuth(event, ['admin']);
  if (user.error) return user.error;

  const params = event.queryStringParameters || {};
  const dryRun = params.dry_run !== 'false'; // default to dry_run for safety
  const sinceTs = params.since
    ? Math.floor(new Date(params.since).getTime() / 1000)
    : DEFAULT_SINCE_TS;

  if (isNaN(sinceTs)) {
    return jsonResponse(400, { ok: false, error: 'Invalid since date. Use YYYY-MM-DD format.' });
  }

  const sinceDate = new Date(sinceTs * 1000).toISOString();
  console.log(`[backfill] Starting — since=${sinceDate}, dry_run=${dryRun}`);

  try {
    // 1. Fetch all lead forms for the page
    const forms = await fetchForms();
    console.log(`[backfill] Found ${forms.length} lead form(s)`);

    const results = {
      dry_run: dryRun,
      since: sinceDate,
      forms_checked: forms.length,
      leads_found: 0,
      leads_skipped_duplicate: 0,
      leads_skipped_no_email: 0,
      leads_processed: 0,
      errors: [],
      processed: []
    };

    // 2. For each form, fetch leads created since the cutoff
    for (const form of forms) {
      const leads = await fetchLeadsForForm(form.id, sinceTs);
      console.log(`[backfill] Form "${form.name}" (${form.id}): ${leads.length} lead(s)`);

      for (const rawLead of leads) {
        results.leads_found++;
        try {
          const outcome = await processBackfillLead(rawLead, form, dryRun);
          if (outcome === 'duplicate') {
            results.leads_skipped_duplicate++;
          } else if (outcome === 'no_email') {
            results.leads_skipped_no_email++;
          } else {
            results.leads_processed++;
            results.processed.push({
              leadgen_id: rawLead.id,
              email: outcome.email,
              name: `${outcome.first_name} ${outcome.last_name}`.trim(),
              created_time: rawLead.created_time,
              firestore_id: outcome.firestoreId || null
            });
          }
        } catch (err) {
          console.error(`[backfill] Error on lead ${rawLead.id}:`, err.message);
          results.errors.push({ leadgen_id: rawLead.id, error: err.message });
        }
      }
    }

    console.log(`[backfill] Done — processed=${results.leads_processed}, duplicates=${results.leads_skipped_duplicate}, errors=${results.errors.length}`);
    return jsonResponse(200, { ok: true, ...results });

  } catch (err) {
    console.error('[backfill] Fatal error:', err.message);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};

// ─── Process a single backfill lead ─────────────────────────────────────────

async function processBackfillLead(rawLead, form, dryRun) {
  // Parse field_data into flat key/value object
  const fields = {};
  for (const field of (rawLead.field_data || [])) {
    fields[field.name] = Array.isArray(field.values) ? field.values[0] : field.values;
  }

  const fullName = fields.full_name || fields.name || '';
  const nameParts = fullName.trim().split(/\s+/);
  const firstName = fields.first_name || nameParts[0] || '';
  const lastName = fields.last_name || nameParts.slice(1).join(' ') || '';
  const email = (fields.email || '').toLowerCase().trim();
  const phone = fields.phone_number || fields.phone || '';
  const city = fields.city || fields.location || '';
  const program = fields.program || fields.which_program || fields.interested_in || '';

  if (!email) return 'no_email';

  const db = getDb();

  // Check if already imported (by leadgen_id)
  const existingByLeadgenId = await db.collection('leads')
    .where('meta_leadgen_id', '==', rawLead.id)
    .limit(1)
    .get();
  if (!existingByLeadgenId.empty) return 'duplicate';

  // Check if existing applicant
  const existingAppSnap = await db.collection('applications')
    .where('email', '==', email)
    .limit(1)
    .get();
  const existingAppId = existingAppSnap.empty ? null : (existingAppSnap.docs[0].data().application_id || 'Unknown');

  const adName = rawLead.ad_name || form.name || '';

  const lead = {
    email,
    first_name: firstName,
    last_name: lastName,
    phone,
    type: 'ytt',
    ytt_program_type: detectYTTType(program, adName),
    program: program || adName || 'Facebook Lead Form',
    course_id: '',
    cohort_label: '',
    preferred_month: '',
    accommodation: normalizeYesNo(fields.housing || fields.accommodation || 'No'),
    city_country: city,
    housing_months: '',
    service: '',
    subcategories: '',
    message: fields.message || fields.comments || '',
    source: `Meta Lead – Facebook – ${adName || form.id || 'Ad'} (backfill)`,
    meta_form_id: rawLead.form_id || form.id || '',
    meta_ad_id: rawLead.ad_id || '',
    meta_campaign: adName,
    meta_leadgen_id: rawLead.id || '',
    meta_page_id: PAGE_ID,
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
    // Use original Facebook created_time, fall back to now
    created_at: rawLead.created_time ? new Date(rawLead.created_time) : new Date(),
    updated_at: new Date()
  };

  if (dryRun) {
    return { email, first_name: firstName, last_name: lastName, firestoreId: null };
  }

  // Save to Firestore
  const docRef = await db.collection('leads').add(lead);
  console.log(`[backfill] Saved lead ${docRef.id} (${email})`);

  const scheduleToken = crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(docRef.id + ':' + email)
    .digest('hex');

  // Fire notifications — same as live webhook
  await Promise.all([
    process.env.GMAIL_APP_PASSWORD
      ? sendAdminNotification(lead).catch(e => console.error('[backfill] Admin email failed:', e.message))
      : Promise.resolve(),
    process.env.GMAIL_APP_PASSWORD && email
      ? sendWelcomeEmail(lead, 'lead_meta', { leadId: docRef.id, token: scheduleToken })
          .catch(e => console.error('[backfill] Welcome email failed:', e.message))
      : Promise.resolve(),
    process.env.GATEWAYAPI_TOKEN && phone
      ? sendWelcomeSMS(lead, docRef.id).catch(e => console.error('[backfill] SMS failed:', e.message))
      : Promise.resolve()
  ]);

  return { email, first_name: firstName, last_name: lastName, firestoreId: docRef.id };
}

// ─── Graph API ───────────────────────────────────────────────────────────────

function fetchForms() {
  const token = process.env.FB_PAGE_ACCESS_TOKEN;
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${PAGE_ID}/leadgen_forms?fields=id,name,status&limit=100&access_token=${token}`;
  return graphGet(url).then(data => data.data || []);
}

function fetchLeadsForForm(formId, sinceTs) {
  const token = process.env.FB_PAGE_ACCESS_TOKEN;
  // Fetch all leads created after sinceTs, with full field data
  const fields = 'id,created_time,field_data,ad_id,ad_name,form_id';
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function detectYTTType(program, formName) {
  const combined = `${program} ${formName}`.toLowerCase();
  if (combined.includes('300')) return '300h';
  if (combined.includes('50h') || combined.includes('50 hour')) return '50h';
  if (combined.includes('30h') || combined.includes('30 hour')) return '30h';
  if (combined.includes('18') || combined.includes('fleksib') || combined.includes('flexible')) return '18-week';
  if (combined.includes('8') && (combined.includes('uge') || combined.includes('week') || combined.includes('semi'))) return '8-week';
  if (combined.includes('4') && (combined.includes('uge') || combined.includes('week') || combined.includes('intensi'))) return '4-week';
  return '4-week';
}

function normalizeYesNo(val) {
  if (!val) return 'No';
  const v = String(val).toLowerCase().trim();
  return (v === 'yes' || v === 'ja' || v === 'true' || v === '1') ? 'Yes' : 'No';
}
