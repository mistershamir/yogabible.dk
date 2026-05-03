/**
 * Campaign: June 2026 4-Week Cohort Announcement — Preview (sync)
 *
 * GET /.netlify/functions/campaign-june-2026?mode=preview
 * Auth: X-Internal-Secret header (AI_INTERNAL_SECRET env var)
 *
 * Returns counts (DA vs EN), 3 samples per language, and a sample
 * fully-processed body so we can verify schedule-token injection +
 * lead-level tracking before triggering the send-background function.
 *
 * Filters:
 *   lead_type === 'ytt'
 *   status NOT IN ['Not too keen','Lost','Converted','Existing Applicant',
 *                  'Unsubscribed','Closed','Archived']
 *   not unsubscribed, not email_bounced, has email
 *
 * Language split: lead.lang === 'da' → DA, all others → EN.
 *
 * To send: POST /.netlify/functions/campaign-june-2026-send-background
 *          with header X-Internal-Secret and body { "confirm": "YES" }.
 */

const crypto = require('crypto');
const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');
const { substituteVars } = require('./shared/email-service');
const { prepareTrackedEmail } = require('./shared/email-tracking');
const {
  CAMPAIGN_ID, SOURCE_TAG, DA, EN, EXCLUDE_STATUSES,
  injectScheduleTokens, isEligible, detectLang
} = require('./shared/campaign-june-2026-shared');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  var secret = process.env.AI_INTERNAL_SECRET;
  var provided = event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'] || '';
  if (!secret || provided !== secret) {
    return jsonResponse(401, { ok: false, error: 'Unauthorized' });
  }

  var db = getDb();
  var snap = await db.collection('leads').where('lead_type', '==', 'ytt').get();

  var daLeads = [];
  var enLeads = [];
  var skipped = { status_excluded: 0, unsubscribed: 0, bounced: 0, no_email: 0 };

  snap.forEach(function (doc) {
    var d = doc.data();
    if (!d.email) { skipped.no_email++; return; }
    if (d.unsubscribed) { skipped.unsubscribed++; return; }
    if (d.email_bounced) { skipped.bounced++; return; }
    var status = (d.status || '').trim();
    if (EXCLUDE_STATUSES.has(status)) { skipped.status_excluded++; return; }

    var lang = detectLang(d);
    var entry = {
      id: doc.id,
      email: d.email,
      first_name: d.first_name || '',
      status: status || '(none)',
      lang: d.lang || '(unset)',
      ytt_program_type: d.ytt_program_type || '',
      cohort_label: d.cohort_label || ''
    };
    if (lang === 'da') daLeads.push(entry); else enLeads.push(entry);
  });

  var daSamples = daLeads.slice(0, 3);
  var enSamples = enLeads.slice(0, 3);

  // Build a sample fully-processed body from the first eligible lead per language
  function processSample(sample, template) {
    if (!sample) return null;
    var withVars = substituteVars(template.bodyHtml, {
      '{{first_name}}': sample.first_name || 'there'
    });
    var withTokens = injectScheduleTokens(withVars, sample.id, sample.email);
    var tracked = prepareTrackedEmail(withTokens, sample.id, SOURCE_TAG);
    return {
      lead_id: sample.id,
      after_schedule_tokens: withTokens,
      after_lead_tracking: tracked
    };
  }

  return jsonResponse(200, {
    ok: true,
    mode: 'preview',
    campaign_id: CAMPAIGN_ID,
    counts: {
      total_eligible: daLeads.length + enLeads.length,
      da: daLeads.length,
      en: enLeads.length
    },
    skipped: skipped,
    samples_da: daSamples,
    samples_en: enSamples,
    subjects: { da: DA.subject, en: EN.subject },
    sample_processed_da: processSample(daLeads[0], DA),
    sample_processed_en: processSample(enLeads[0], EN)
  });
};
