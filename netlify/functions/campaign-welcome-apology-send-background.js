/**
 * Campaign: Welcome Apology — SEND (background)
 *
 * POST /.netlify/functions/campaign-welcome-apology-send-background
 *   Headers: X-Internal-Secret: <AI_INTERNAL_SECRET>
 *   Body:    { "confirm": "YES" }
 *
 * Background function (15-min timeout). Drains the audience identified by
 * the welcome-apology preview and sends each eligible lead the bilingual
 * apology email with their resolved schedule URL.
 *
 * Per-lead processing order:
 *   1. substitute (first_name, program, schedule_url)
 *   2. prepareTrackedEmail (lead-level pixel + click wrap)
 *   3. sendSingleViaResend → wraps signature + unsubscribe footer
 *
 * Idempotency: skips leads already present in email_log with this campaign_id.
 */

const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');
const { sendSingleViaResend } = require('./shared/resend-service');
const { prepareTrackedEmail } = require('./shared/email-tracking');
const {
  CAMPAIGN_ID, SOURCE_TAG, SKIPPED_REASON, DA, EN,
  detectLang, substitute, skipReasonFor, resolveScheduleForLead
} = require('./shared/campaign-welcome-apology-shared');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'POST required' });
  }

  const secret = process.env.AI_INTERNAL_SECRET;
  const provided = event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'] || '';
  if (!secret || provided !== secret) {
    return jsonResponse(401, { ok: false, error: 'Unauthorized' });
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) { /* ignore */ }
  if (body.confirm !== 'YES') {
    return jsonResponse(400, { ok: false, error: 'Refusing to send without { "confirm": "YES" }' });
  }

  const db = getDb();
  const startedAt = new Date();
  const runRef = await db.collection('campaign_runs').add({
    campaign_id: CAMPAIGN_ID,
    started_at: startedAt,
    status: 'running'
  });

  // Idempotency — skip leads that already received the apology.
  const alreadySent = new Set();
  try {
    const logSnap = await db.collection('email_log')
      .where('campaign_id', '==', CAMPAIGN_ID)
      .where('status', '==', 'sent')
      .get();
    logSnap.forEach((d) => {
      const lid = d.data().lead_id;
      if (lid) alreadySent.add(lid);
    });
  } catch (e) {
    console.warn('[welcome-apology send] email_log scan failed (proceeding):', e.message);
  }

  const audienceSnap = await db.collection('deferred_welcomes')
    .where('skipped_reason', '==', SKIPPED_REASON)
    .get();

  const results = {
    audience_total: audienceSnap.size,
    sent: 0,
    failed: 0,
    da: 0,
    en: 0,
    skipped_already_sent: 0,
    skipped: {},
    errors: []
  };
  const seenLeadIds = new Set();

  for (const doc of audienceSnap.docs) {
    const row = doc.data();
    const leadId = row.lead_id;
    if (!leadId) {
      results.skipped['no_lead_id'] = (results.skipped['no_lead_id'] || 0) + 1;
      continue;
    }
    if (seenLeadIds.has(leadId)) continue; // multiple deferred_welcomes for the same lead — only send once
    seenLeadIds.add(leadId);

    if (alreadySent.has(leadId)) {
      results.skipped_already_sent++;
      continue;
    }

    const leadDoc = await db.collection('leads').doc(leadId).get();
    const lead = leadDoc.exists ? leadDoc.data() : null;

    const skipReason = skipReasonFor(lead);
    if (skipReason) {
      results.skipped[skipReason] = (results.skipped[skipReason] || 0) + 1;
      continue;
    }

    const schedule = await resolveScheduleForLead(lead, leadId);
    if (!schedule) {
      results.skipped['no_open_cohort'] = (results.skipped['no_open_cohort'] || 0) + 1;
      continue;
    }

    const lang = detectLang(lead);
    const template = lang === 'da' ? DA : EN;

    try {
      const withVars = substitute(template.bodyHtml, {
        first_name: lead.first_name || (lang === 'da' ? 'der' : 'there'),
        program: schedule.programName || '',
        schedule_url: schedule.scheduleUrl
      });
      const trackedHtml = prepareTrackedEmail(withVars, leadId, SOURCE_TAG);

      await sendSingleViaResend({
        to: lead.email,
        subject: template.subject,
        bodyHtml: trackedHtml,
        bodyPlain: '',
        leadId,
        campaignId: CAMPAIGN_ID,
        lang
      });

      try {
        await db.collection('leads').doc(leadId).update({
          last_contact: new Date(),
          updated_at: new Date()
        });
      } catch (_) { /* non-fatal */ }

      results.sent++;
      if (lang === 'da') results.da++; else results.en++;
    } catch (err) {
      results.failed++;
      results.errors.push({ lead_id: leadId, email: lead.email, error: err.message });
      console.error('[welcome-apology send] error for', leadId, ':', err.message);
    }
  }

  await runRef.update({
    status: 'completed',
    finished_at: new Date(),
    results
  });

  return jsonResponse(200, {
    ok: true,
    campaign_id: CAMPAIGN_ID,
    run_id: runRef.id,
    results
  });
};
