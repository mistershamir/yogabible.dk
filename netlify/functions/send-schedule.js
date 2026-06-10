/**
 * Send Schedule Email — Yoga Bible
 * Manually sends a tokenized schedule email to a lead from the admin panel.
 *
 * POST /.netlify/functions/send-schedule
 * Body: { leadId, cohortId }
 * Auth: Firebase ID token (admin or marketing role)
 */

const crypto = require('crypto');
const admin = require('firebase-admin');
const { requireAuth } = require('./shared/auth');
const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');
const { buildScheduleEmail } = require('./shared/lead-emails');
const { prepareTrackedEmail } = require('./shared/email-tracking');
const { sendSingleViaResend } = require('./shared/resend-service');

const SITE_URL = 'https://www.yogabible.dk';

function generateScheduleToken(leadId, email) {
  const secret = process.env.UNSUBSCRIBE_SECRET;
  if (!secret) throw new Error('UNSUBSCRIBE_SECRET env var not set');
  return crypto
    .createHmac('sha256', secret)
    .update(leadId + ':' + email.toLowerCase().trim())
    .digest('hex');
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();
  if (event.httpMethod !== 'POST') return jsonResponse(405, { ok: false, error: 'Method not allowed' });

  const authResult = await requireAuth(event, ['admin', 'marketing']);
  if (authResult.error) return authResult.error;

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return jsonResponse(400, { ok: false, error: 'Invalid JSON body' });
  }

  const { leadId, cohortId } = payload;
  if (!leadId || !cohortId) {
    return jsonResponse(400, { ok: false, error: 'leadId and cohortId are required' });
  }

  const db = getDb();

  // Load lead and cohort in parallel
  let lead, cohort;
  try {
    const [leadSnap, cohortSnap] = await Promise.all([
      db.collection('leads').doc(leadId).get(),
      db.collection('cohort_registry').doc(cohortId).get()
    ]);

    if (!leadSnap.exists) return jsonResponse(404, { ok: false, error: 'Lead not found' });
    if (!cohortSnap.exists) return jsonResponse(404, { ok: false, error: 'Cohort not found' });

    lead = Object.assign({ id: leadSnap.id }, leadSnap.data());
    cohort = Object.assign({ id: cohortSnap.id }, cohortSnap.data());
  } catch (err) {
    console.error('[send-schedule] Firestore load error:', err.message);
    return jsonResponse(500, { ok: false, error: 'Failed to load data' });
  }

  if (!lead.email) {
    return jsonResponse(400, { ok: false, error: 'Lead has no email address' });
  }

  if (cohort.schedule_ready !== true) {
    return jsonResponse(400, { ok: false, error: 'Schedule page is not ready for this cohort' });
  }

  // Determine language
  const lang = lead.lang || lead.meta_lang || lead.language || 'da';
  const isDa = lang === 'da' || lang === 'dk';

  // Build tokenized schedule URL
  let token;
  try {
    token = generateScheduleToken(leadId, lead.email);
  } catch (err) {
    return jsonResponse(500, { ok: false, error: err.message });
  }

  const schedulePath = isDa ? cohort.schedule_path_da : cohort.schedule_path_en;
  if (!schedulePath) {
    return jsonResponse(400, { ok: false, error: 'No schedule path for this cohort/language' });
  }

  const scheduleUrl = SITE_URL + schedulePath + '?tid=' + encodeURIComponent(leadId) + '&tok=' + encodeURIComponent(token);

  // Build email
  const firstName = lead.first_name || lead.name || '';
  const { subject, html: bodyHtml } = buildScheduleEmail(firstName, cohort, scheduleUrl, isDa);

  // Apply lead tracking (wraps links + injects pixel)
  const sourceTag = 'manual:send-schedule';
  const trackedHtml = prepareTrackedEmail(bodyHtml, leadId, sourceTag);

  // Send via Resend
  try {
    await sendSingleViaResend({
      to: lead.email,
      subject,
      bodyHtml: trackedHtml,
      leadId,
      campaignId: sourceTag,
      lang
    });
  } catch (err) {
    console.error('[send-schedule] Resend error:', err.message);
    return jsonResponse(500, { ok: false, error: 'Failed to send email: ' + err.message });
  }

  // Update lead with last_schedule_sent_at
  try {
    await db.collection('leads').doc(leadId).update({
      last_schedule_sent_at: admin.firestore.FieldValue.serverTimestamp(),
      last_schedule_cohort_id: cohortId
    });
  } catch (err) {
    console.warn('[send-schedule] Lead update failed (email was sent):', err.message);
  }

  return jsonResponse(200, {
    ok: true,
    leadId,
    cohortId,
    to: lead.email,
    subject
  });
};
