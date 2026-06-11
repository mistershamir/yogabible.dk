/**
 * Shared constants + helpers for the July 2026 "last call" campaign.
 * Imported by campaign-july-last-call.js (preview) and
 * campaign-july-last-call-send-background.js (send).
 *
 * Audience: leads with type==='ytt' AND ytt_program_type contains
 * '4-week-jul'. Last-call nudge before enrollment closes July 3
 * (cohort starts July 6, 2026).
 */

const crypto = require('crypto');

const CAMPAIGN_ID = 'july-2026-last-call';
const SOURCE_TAG = 'campaign:july-2026-last-call';

// Must match sequences.js + schedule-visit.js verification secret exactly.
const TOKEN_SECRET = process.env.UNSUBSCRIBE_SECRET || 'yb-appt-secret';

const EXCLUDE_STATUSES = new Set([
  'Not too keen', 'Lost', 'Converted', 'Existing Applicant',
  'Unsubscribed', 'Closed', 'Archived'
]);

// Internal/test inboxes — never include in any campaign send.
const TEST_EMAILS = new Set([
  'info@vibroyoga.dk',
  'info@yogabible.dk',
  'shamir@hotyogacph.dk'
]);

const DA = {
  subject: 'Juli-holdet — er du med?',
  bodyHtml:
    '<p>Hej {{first_name}},</p>' +
    '<p>Kort besked — vores 4-ugers Vinyasa Plus hold starter den 6. juli, og tilmeldingen lukker snart.</p>' +
    '<p>Er du stadig interesseret, eller er det ikke aktuelt lige nu? Et kort ja eller nej er helt fint.</p>' +
    '<p>Hvis du er klar, kan du se skemaet her:</p>' +
    '<p><a href="https://yogabible.dk/skema/4-uger-juli/" style="color:#f75c03;">Se juli-skemaet</a></p>'
};

const EN = {
  subject: 'July cohort — are you in?',
  bodyHtml:
    '<p>Hi {{first_name}},</p>' +
    '<p>Quick note — our 4-week Vinyasa Plus cohort starts July 6, and registration closes soon.</p>' +
    '<p>Are you still interested, or is it not the right time? A simple yes or no is completely fine.</p>' +
    '<p>If you\'re ready, you can see the schedule here:</p>' +
    '<p><a href="https://yogabible.dk/en/schedule/4-weeks-july-plan/" style="color:#f75c03;">See the July schedule</a></p>'
};

function isTestEmail(email) {
  if (!email || typeof email !== 'string') return false;
  return TEST_EMAILS.has(email.trim().toLowerCase());
}

function generateScheduleToken(leadId, email) {
  var hmac = crypto.createHmac('sha256', TOKEN_SECRET);
  hmac.update(leadId + ':' + (email || '').toLowerCase().trim());
  return hmac.digest('hex');
}

// Mirrors sequences.js injectScheduleTokens.
function injectScheduleTokens(html, leadId, email) {
  if (!html || !leadId || !email) return html;
  var token = generateScheduleToken(leadId, email);
  return html.replace(
    /(https?:\/\/(?:www\.)?yogabible\.dk)(\/(?:skema|en\/schedule|tidsplan)\/[^"'<\s]*)/g,
    function (match, domain, path) {
      if (path.indexOf('tid=') !== -1 && path.indexOf('tok=') !== -1) return match;
      var sep = path.indexOf('?') !== -1 ? '&' : '?';
      return domain + path + sep + 'tid=' + encodeURIComponent(leadId) + '&tok=' + encodeURIComponent(token);
    }
  );
}

function programMatchesJulyFourWeek(lead) {
  var p = (lead && lead.ytt_program_type ? String(lead.ytt_program_type) : '').toLowerCase();
  return p.indexOf('4-week-jul') !== -1;
}

function isEligible(lead) {
  if (!lead) return false;
  if (lead.type !== 'ytt') return false;
  if (!programMatchesJulyFourWeek(lead)) return false;
  if (!lead.email) return false;
  if (isTestEmail(lead.email)) return false;
  if (lead.unsubscribed) return false;
  if (lead.email_bounced) return false;
  var status = (lead.status || '').trim();
  if (EXCLUDE_STATUSES.has(status)) return false;
  return true;
}

// Empty/missing lang → Danish. Explicit 'da'/'dk' → Danish. Else English.
function detectLang(lead) {
  if (!lead) return 'da';
  var l = (lead.lang || '').toString().trim().toLowerCase();
  if (l === '' || l === 'da' || l === 'dk') return 'da';
  return 'en';
}

module.exports = {
  CAMPAIGN_ID,
  SOURCE_TAG,
  DA,
  EN,
  EXCLUDE_STATUSES,
  TEST_EMAILS,
  generateScheduleToken,
  injectScheduleTokens,
  programMatchesJulyFourWeek,
  isEligible,
  isTestEmail,
  detectLang
};
