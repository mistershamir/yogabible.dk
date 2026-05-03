/**
 * Campaign: July 2026 Accommodation Urgency — SEND (background)
 *
 * POST /.netlify/functions/campaign-july-accommodation-send-background
 *   Headers: X-Internal-Secret: <AI_INTERNAL_SECRET>
 *   Body:    { "confirm": "YES" }
 *
 * Background function (15-min timeout). Per-lead processing order:
 *   1. substituteVars (first_name)
 *   2. injectScheduleTokens (per-lead tid + HMAC tok)
 *   3. prepareTrackedEmail (lead-level pixel + click wrap)
 *   4. sendSingleViaResend → wraps signature + unsubscribe footer +
 *      campaign-level tracking
 *
 * Idempotent: skips leads already in email_log for campaign_id
 * 'july-2026-accommodation' with status='sent'. Writes progress to
 * campaign_runs/{auto-id}.
 */

const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');
const { sendSingleViaResend } = require('./shared/resend-service');
const { substituteVars } = require('./shared/email-service');
const { prepareTrackedEmail } = require('./shared/email-tracking');
const {
  CAMPAIGN_ID, SOURCE_TAG, DA, EN,
  injectScheduleTokens, isEligible, detectLang
} = require('./shared/campaign-july-accommodation-shared');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'POST required' });
  }

  var secret = process.env.AI_INTERNAL_SECRET;
  var provided = event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'] || '';
  if (!secret || provided !== secret) {
    return jsonResponse(401, { ok: false, error: 'Unauthorized' });
  }

  var body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) { /* ignore */ }
  if (body.confirm !== 'YES') {
    return jsonResponse(400, { ok: false, error: 'Refusing to send without { "confirm": "YES" }' });
  }

  var db = getDb();
  var startedAt = new Date();
  var runRef = await db.collection('campaign_runs').add({
    campaign_id: CAMPAIGN_ID,
    started_at: startedAt,
    status: 'running'
  });

  var alreadySent = new Set();
  try {
    var logSnap = await db.collection('email_log')
      .where('campaign_id', '==', CAMPAIGN_ID)
      .where('status', '==', 'sent')
      .get();
    logSnap.forEach(function (d) {
      var lid = d.data().lead_id;
      if (lid) alreadySent.add(lid);
    });
  } catch (e) {
    console.warn('[campaign-july-accommodation] email_log scan failed (proceeding):', e.message);
  }

  var snap = await db.collection('leads').where('type', '==', 'ytt').get();
  var recipients = [];
  snap.forEach(function (doc) {
    var d = doc.data();
    if (!isEligible(d)) return;
    if (alreadySent.has(doc.id)) return;
    recipients.push({ id: doc.id, lead: d });
  });

  var results = { sent: 0, failed: 0, da: 0, en: 0, skipped_already_sent: alreadySent.size, errors: [] };

  for (var i = 0; i < recipients.length; i++) {
    var r = recipients[i];
    var lang = detectLang(r.lead);
    var template = lang === 'da' ? DA : EN;

    try {
      var withVars = substituteVars(template.bodyHtml, {
        first_name: r.lead.first_name || (lang === 'da' ? 'der' : 'there')
      });
      var withTokens = injectScheduleTokens(withVars, r.id, r.lead.email);
      var trackedHtml = prepareTrackedEmail(withTokens, r.id, SOURCE_TAG);

      await sendSingleViaResend({
        to: r.lead.email,
        subject: template.subject,
        bodyHtml: trackedHtml,
        bodyPlain: '',
        leadId: r.id,
        campaignId: CAMPAIGN_ID,
        lang: lang
      });

      try {
        await db.collection('leads').doc(r.id).update({
          last_contact: new Date(),
          updated_at: new Date()
        });
      } catch (_) { /* non-fatal */ }

      results.sent++;
      if (lang === 'da') results.da++; else results.en++;
    } catch (err) {
      results.failed++;
      results.errors.push({ id: r.id, email: r.lead.email, error: err.message });
      console.error('[campaign-july-accommodation] send error for', r.id, ':', err.message);
    }

    if ((i + 1) % 50 === 0) {
      try {
        await runRef.update({ progress: { processed: i + 1, total: recipients.length, partial: results } });
      } catch (_) { /* non-fatal */ }
    }
  }

  await runRef.update({
    status: 'completed',
    finished_at: new Date(),
    total_attempted: recipients.length,
    results: results
  });

  return jsonResponse(200, {
    ok: true,
    campaign_id: CAMPAIGN_ID,
    run_id: runRef.id,
    total_attempted: recipients.length,
    results: results
  });
};
