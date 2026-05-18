/**
 * Shared constants + helpers for the welcome-apology one-off campaign.
 *
 * Background:
 *   On 2026-05-18 we discovered the deferred_welcomes Firestore composite
 *   index was missing, causing every welcome ice breaker since 2026-05-03
 *   to silently never fire. 85 rows piled up unsent. After tagging them
 *   `status: skipped_stale, skipped_reason: index_outage_backlog`, this
 *   campaign reaches out to those leads with an apology + their schedule.
 *
 * Audience source: deferred_welcomes where skipped_reason == 'index_outage_backlog'.
 *
 * Per-lead resolution:
 *   - Load lead doc by deferred_welcomes.lead_id
 *   - Resolve cohort via resolveCohortForLead (falls back to nearest open)
 *   - Build tokenised schedule URL via buildScheduleUrl
 *   - Skip leads whose cohort resolver returns null (no open cohorts)
 *   - Skip TEST_EMAIL_BLOCKLIST, unsubscribed, bounced, no email
 *
 * Imported by both campaign-welcome-apology.js (preview) and
 * campaign-welcome-apology-send-background.js (send).
 */

const crypto = require('crypto');
const { resolveCohortForLead, buildScheduleUrl } = require('./cohort-resolver');

const CAMPAIGN_ID = 'welcome-apology';
const SOURCE_TAG = 'campaign:welcome-apology';
const SKIPPED_REASON = 'index_outage_backlog';

const TOKEN_SECRET = process.env.UNSUBSCRIBE_SECRET || 'yb-appt-secret';

// Mirrors sequences.js TEST_EMAIL_BLOCKLIST — internal/QA inboxes.
const TEST_EMAIL_BLOCKLIST = new Set([
  'info@vibroyoga.dk',
  'info@yogabible.dk',
  'shamir@hotyogacph.dk'
]);

const DA = {
  subject: 'Beklager forsinkelsen — her er dit skema',
  bodyHtml:
    '<p>Hej {{first_name}},</p>' +
    '<p>Du burde have fået skemaet for den uddannelse du viste interesse for noget før, ' +
    'men det skete desværre ikke på grund af en teknisk fejl hos os. Det beklager jeg.</p>' +
    '<p>Her er det nu — {{program}}:</p>' +
    '<p><a href="{{schedule_url}}" style="color:#f75c03;">Se skemaet her</a></p>' +
    '<p>Ring mig gerne på <a href="tel:+4553881209" style="color:#f75c03;">53 88 12 09</a> ' +
    'hvis du har spørgsmål.</p>' +
    '<p>Shamir</p>'
};

const EN = {
  subject: "Sorry for the delay — here's your schedule",
  bodyHtml:
    '<p>Hi {{first_name}},</p>' +
    '<p>You should have received the schedule for the training you were interested in some time ago, ' +
    "but unfortunately it didn't go through due to a technical issue on our end. " +
    'I apologise for that.</p>' +
    '<p>Here it is now — {{program}}:</p>' +
    '<p><a href="{{schedule_url}}" style="color:#f75c03;">See the schedule here</a></p>' +
    '<p>Feel free to call me at <a href="tel:+4553881209" style="color:#f75c03;">+45 53 88 12 09</a> ' +
    'if you have any questions.</p>' +
    '<p>Shamir</p>'
};

function generateScheduleToken(leadId, email) {
  const hmac = crypto.createHmac('sha256', TOKEN_SECRET);
  hmac.update(leadId + ':' + (email || '').toLowerCase().trim());
  return hmac.digest('hex');
}

// Empty/missing lang → Danish (consistent with campaign-june-2026-shared).
function detectLang(lead) {
  if (!lead) return 'da';
  const l = (lead.lang || '').toString().trim().toLowerCase();
  if (l === '' || l === 'da' || l === 'dk') return 'da';
  return 'en';
}

function substitute(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => (vars[key] != null ? String(vars[key]) : ''));
}

/**
 * Decide whether a lead should be skipped, and why.
 * Returns null if eligible, or a skip-reason string otherwise.
 */
function skipReasonFor(lead) {
  if (!lead) return 'lead_doc_missing';
  if (!lead.email) return 'no_email';
  if (lead.unsubscribed) return 'unsubscribed';
  if (lead.email_bounced) return 'email_bounced';
  if (TEST_EMAIL_BLOCKLIST.has((lead.email || '').toLowerCase().trim())) {
    return 'test_email_blocklist';
  }
  // Apology copy ("the training you were interested in" + a YTT schedule URL)
  // only fits YTT leads. Non-YTT leads (course / waitlist / bundle) need a
  // different reach-out.
  if (lead.type !== 'ytt' && !lead.ytt_program_type) {
    return 'non_ytt';
  }
  return null;
}

/**
 * Resolve schedule URL + display program for a lead.
 * Returns { scheduleUrl, programName, cohortDocId, fallback } or null when
 * the cohort resolver returns null (no open cohorts at all).
 */
async function resolveScheduleForLead(lead, leadId) {
  const resolved = await resolveCohortForLead(lead);
  if (!resolved || !resolved.cohort) return null;

  const lang = detectLang(lead);
  const token = generateScheduleToken(leadId, lead.email);
  const scheduleUrl = buildScheduleUrl(resolved.cohort, lang, leadId, token);
  if (!scheduleUrl) return null;

  // Build program label from the cohort doc — guarantees it reflects the
  // actual cohort being promoted (important when the fallback path is used),
  // and avoids raw program slugs that sometimes appear on lead.program.
  const cohort = resolved.cohort;
  const name = lang === 'da' ? (cohort.name_da || cohort.name_en) : (cohort.name_en || cohort.name_da);
  const label = lang === 'da' ? (cohort.cohort_label_da || cohort.cohort_label_en) : (cohort.cohort_label_en || cohort.cohort_label_da);
  const programName = name && label ? `${name} (${label})` : (name || label || '');

  return {
    scheduleUrl,
    programName,
    cohortDocId: resolved.cohort._docId || null,
    fallback: !!resolved.fallback
  };
}

module.exports = {
  CAMPAIGN_ID,
  SOURCE_TAG,
  SKIPPED_REASON,
  TEST_EMAIL_BLOCKLIST,
  DA,
  EN,
  generateScheduleToken,
  detectLang,
  substitute,
  skipReasonFor,
  resolveScheduleForLead
};
