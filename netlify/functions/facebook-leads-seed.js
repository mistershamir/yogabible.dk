/**
 * ONE-TIME SEED — Facebook backfill leads (Feb 27-28 2026)
 * DELETE THIS FILE after running.
 *
 * GET /.netlify/functions/facebook-leads-seed?dry_run=true   → preview only
 * GET /.netlify/functions/facebook-leads-seed?dry_run=false  → write + send emails/SMS
 */

const crypto = require('crypto');
const { getDb } = require('./shared/firestore');
const { requireAuth } = require('./shared/auth');
const { sendAdminNotification } = require('./shared/email-service');
const { sendWelcomeSMS } = require('./shared/sms-service');
const { sendWelcomeEmail } = require('./shared/lead-emails');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const TOKEN_SECRET = process.env.UNSUBSCRIBE_SECRET || 'yb-appt-secret';

const LEADS = [
  {
    first_name: 'Coco',
    last_name: 'Luna',
    email: 'cocogregersen@gmail.com',
    phone: '+4581915322',
    city_country: 'Copenhagen',
    message: 'Ja, men ikke så ofte',
    created_at: new Date('2026-02-27T19:44:00Z'),
    meta_leadgen_id: 'seed-1974647360148367-1'
  },
  {
    first_name: 'Dennis',
    last_name: 'Kallestrup',
    email: 'kallestrup1@gmail.com',
    phone: '+4528723298',
    city_country: 'Herning',
    message: 'Nej, jeg er nybegynder',
    created_at: new Date('2026-02-28T06:16:00Z'),
    meta_leadgen_id: 'seed-1974647360148367-2'
  },
  {
    first_name: 'Lene',
    last_name: 'Hylleberg',
    email: 'hyllebremer@gmail.com',
    phone: '+4520856515',
    city_country: 'Frederiksberg',
    message: 'Ja, men ikke så ofte',
    created_at: new Date('2026-02-28T08:30:00Z'),
    meta_leadgen_id: 'seed-1974647360148367-3'
  },
  {
    first_name: 'Anne Christine',
    last_name: 'Barratt',
    email: 'Annecb11@gmail.com',
    phone: '+4571101550',
    city_country: 'Brønshøj',
    message: 'Ja, jeg praktiserer regelmæssigt',
    created_at: new Date('2026-02-28T09:49:00Z'),
    meta_leadgen_id: 'seed-1974647360148367-4'
  },
  {
    first_name: 'Louise',
    last_name: 'Klüwer',
    email: 'louisekluwer@gmail.com',
    phone: '+4520875208',
    city_country: 'Copenhagen',
    message: 'Ja, jeg praktiserer regelmæssigt',
    created_at: new Date('2026-02-28T14:12:00Z'),
    meta_leadgen_id: 'seed-1974647360148367-5'
  }
];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  const user = await requireAuth(event, ['admin']);
  if (user.error) return user.error;

  const dryRun = (event.queryStringParameters || {}).dry_run !== 'false';
  const db = getDb();
  const results = [];

  for (const l of LEADS) {
    // Skip if already exists
    const dupe = await db.collection('leads')
      .where('meta_leadgen_id', '==', l.meta_leadgen_id)
      .limit(1).get();
    if (!dupe.empty) {
      results.push({ email: l.email, status: 'skipped (duplicate)' });
      continue;
    }

    const lead = {
      email: l.email.toLowerCase().trim(),
      first_name: l.first_name,
      last_name: l.last_name,
      phone: l.phone,
      type: 'ytt',
      ytt_program_type: '18-week',
      program: '18 UGERS FLEKSIBELT PROGRAM – Marts–Juni 2026',
      course_id: '',
      cohort_label: 'March-June 2026',
      preferred_month: '',
      accommodation: 'No',
      city_country: l.city_country,
      housing_months: '',
      service: '',
      subcategories: '',
      message: l.message,
      source: 'Meta Lead – Facebook – Meta Lead 18w DA (backfill)',
      meta_form_id: '1974647360148367',
      meta_ad_id: '',
      meta_campaign: 'Meta Lead 18w DA',
      meta_leadgen_id: l.meta_leadgen_id,
      meta_page_id: '878172732056415',
      converted: false,
      converted_at: null,
      application_id: null,
      status: 'New',
      notes: '',
      unsubscribed: false,
      call_attempts: 0,
      sms_status: '',
      last_contact: null,
      followup_date: null,
      multi_format: '',
      all_formats: '',
      created_at: l.created_at,
      updated_at: new Date()
    };

    if (dryRun) {
      results.push({ email: l.email, status: 'would insert (dry run)' });
      continue;
    }

    const docRef = await db.collection('leads').add(lead);

    const scheduleToken = crypto
      .createHmac('sha256', TOKEN_SECRET)
      .update(docRef.id + ':' + lead.email)
      .digest('hex');

    await Promise.all([
      process.env.GMAIL_APP_PASSWORD
        ? sendAdminNotification(lead).catch(e => console.error('[seed] admin email:', e.message))
        : Promise.resolve(),
      process.env.GMAIL_APP_PASSWORD
        ? sendWelcomeEmail(lead, 'lead_meta', { leadId: docRef.id, token: scheduleToken })
            .catch(e => console.error('[seed] welcome email:', e.message))
        : Promise.resolve(),
      process.env.GATEWAYAPI_TOKEN && l.phone
        ? sendWelcomeSMS(lead, docRef.id).catch(e => console.error('[seed] SMS:', e.message))
        : Promise.resolve()
    ]);

    results.push({ email: l.email, status: 'inserted', firestore_id: docRef.id });
  }

  return jsonResponse(200, { ok: true, dry_run: dryRun, results });
};
