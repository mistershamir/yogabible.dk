/**
 * Campaign: Welcome Apology — Preview (sync)
 *
 * GET /.netlify/functions/campaign-welcome-apology
 *   Headers: X-Internal-Secret: <AI_INTERNAL_SECRET>
 *   Query:   ?samples=N  (default 5 — number of fully-processed samples per lang)
 *
 * Returns per-lead plan for the welcome-apology campaign. Audience is every
 * deferred_welcomes row with skipped_reason == 'index_outage_backlog'.
 *
 * For each row: loads lead doc, computes skip reason (if any), resolves the
 * cohort, builds the tokenised schedule URL, and reports what would be sent.
 *
 * To send: POST /.netlify/functions/campaign-welcome-apology-send-background
 *          with header X-Internal-Secret and body { "confirm": "YES" }.
 */

const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');
const { prepareTrackedEmail } = require('./shared/email-tracking');
const {
  CAMPAIGN_ID, SOURCE_TAG, SKIPPED_REASON, DA, EN,
  detectLang, substitute, skipReasonFor, resolveScheduleForLead
} = require('./shared/campaign-welcome-apology-shared');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  const secret = process.env.AI_INTERNAL_SECRET;
  const provided = event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'] || '';
  if (!secret || provided !== secret) {
    return jsonResponse(401, { ok: false, error: 'Unauthorized' });
  }

  const params = event.queryStringParameters || {};
  const sampleCount = Math.max(1, Math.min(20, parseInt(params.samples || '5', 10)));

  const db = getDb();

  // Audience: every row we tagged when shutting down the stale backlog.
  const audienceSnap = await db.collection('deferred_welcomes')
    .where('skipped_reason', '==', SKIPPED_REASON)
    .get();

  // Idempotency: which leads already received the apology?
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
    console.warn('[welcome-apology preview] email_log scan failed:', e.message);
  }

  const counts = {
    audience_total: audienceSnap.size,
    eligible_da: 0,
    eligible_en: 0,
    already_sent: 0,
    skipped: {} // skip_reason → count
  };
  const eligibleDa = [];
  const eligibleEn = [];
  const skippedList = [];

  for (const doc of audienceSnap.docs) {
    const row = doc.data();
    const leadId = row.lead_id;
    if (!leadId) {
      counts.skipped['no_lead_id'] = (counts.skipped['no_lead_id'] || 0) + 1;
      skippedList.push({ row_id: doc.id, email: row.email, reason: 'no_lead_id' });
      continue;
    }

    if (alreadySent.has(leadId)) {
      counts.already_sent++;
      continue;
    }

    const leadDoc = await db.collection('leads').doc(leadId).get();
    const lead = leadDoc.exists ? leadDoc.data() : null;

    const skipReason = skipReasonFor(lead);
    if (skipReason) {
      counts.skipped[skipReason] = (counts.skipped[skipReason] || 0) + 1;
      skippedList.push({ row_id: doc.id, lead_id: leadId, email: row.email, reason: skipReason });
      continue;
    }

    const schedule = await resolveScheduleForLead(lead, leadId);
    if (!schedule) {
      counts.skipped['no_open_cohort'] = (counts.skipped['no_open_cohort'] || 0) + 1;
      skippedList.push({
        row_id: doc.id, lead_id: leadId, email: lead.email, reason: 'no_open_cohort',
        ytt_program_type: lead.ytt_program_type || null
      });
      continue;
    }

    const lang = detectLang(lead);
    const template = lang === 'da' ? DA : EN;
    const entry = {
      lead_id: leadId,
      email: lead.email,
      first_name: lead.first_name || '',
      lang,
      program_in_email: schedule.programName,
      cohort_id: schedule.cohortDocId,
      cohort_fallback: schedule.fallback,
      schedule_url: schedule.scheduleUrl,
      subject: template.subject
    };
    if (lang === 'da') {
      counts.eligible_da++;
      eligibleDa.push(entry);
    } else {
      counts.eligible_en++;
      eligibleEn.push(entry);
    }
  }

  // Fully-processed sample bodies — verify cohort URL + tracking wrap actually look right.
  function processSample(sample) {
    if (!sample) return null;
    const template = sample.lang === 'da' ? DA : EN;
    const withVars = substitute(template.bodyHtml, {
      first_name: sample.first_name || (sample.lang === 'da' ? 'der' : 'there'),
      program: sample.program_in_email || '',
      schedule_url: sample.schedule_url
    });
    const tracked = prepareTrackedEmail(withVars, sample.lead_id, SOURCE_TAG);
    return {
      lead_id: sample.lead_id,
      email: sample.email,
      lang: sample.lang,
      subject: template.subject,
      processed_html: tracked
    };
  }

  return jsonResponse(200, {
    ok: true,
    mode: 'preview',
    campaign_id: CAMPAIGN_ID,
    source_tag: SOURCE_TAG,
    subjects: { da: DA.subject, en: EN.subject },
    counts,
    eligible_da: eligibleDa,
    eligible_en: eligibleEn,
    skipped: skippedList,
    samples_processed: {
      da: eligibleDa.slice(0, sampleCount).map(processSample),
      en: eligibleEn.slice(0, sampleCount).map(processSample)
    }
  });
};
