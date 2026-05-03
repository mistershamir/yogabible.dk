/**
 * Shared constants + helpers for the June 2026 announcement campaign.
 * Imported by both campaign-june-2026.js (preview) and
 * campaign-june-2026-send-background.js (send).
 */

const crypto = require('crypto');

const CAMPAIGN_ID = 'june-2026-announcement';
const SOURCE_TAG = 'campaign:june-2026-announcement';

// Must match sequences.js + schedule-visit.js verification secret exactly.
const TOKEN_SECRET = process.env.UNSUBSCRIBE_SECRET || 'yb-appt-secret';

const EXCLUDE_STATUSES = new Set([
  'Not too keen', 'Lost', 'Converted', 'Existing Applicant',
  'Unsubscribed', 'Closed', 'Archived'
]);

const DA = {
  subject: 'Nyt juni-hold er åbent',
  bodyHtml:
    '<p>Hej {{first_name}},</p>' +
    '<p>Kort besked — vi har lige åbnet et nyt 4-ugers intensivt hold i juni.</p>' +
    '<p>Det er vores Complete Program: Hatha, Vinyasa, Yin, Hot Yoga og Meditation. Fuldtid, mandag til fredag, Yoga Alliance RYT-200 certificering.</p>' +
    '<p>Hvis juni passer bedre end de andre hold, kan du se skemaet her:</p>' +
    '<p><a href="https://yogabible.dk/skema/4-uger-juni/" style="color:#f75c03;">Se juni-skemaet</a></p>' +
    '<p>Skriv eller ring hvis du har spørgsmål.</p>'
};

const EN = {
  subject: 'New June cohort now open',
  bodyHtml:
    '<p>Hi {{first_name}},</p>' +
    '<p>Quick note — we\'ve just opened a new 4-week intensive cohort in June.</p>' +
    '<p>It\'s our Complete Program: Hatha, Vinyasa, Yin, Hot Yoga, and Meditation. Full-time, Monday to Friday, Yoga Alliance RYT-200 certification.</p>' +
    '<p>If June works better for you than the other cohorts, you can see the schedule here:</p>' +
    '<p><a href="https://yogabible.dk/en/schedule/4-weeks-june/" style="color:#f75c03;">See the June schedule</a></p>' +
    '<p>Write or call if you have questions.</p>'
};

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

function isEligible(lead) {
  if (!lead) return false;
  if (lead.type !== 'ytt') return false;
  if (!lead.email) return false;
  if (lead.unsubscribed) return false;
  if (lead.email_bounced) return false;
  var status = (lead.status || '').trim();
  if (EXCLUDE_STATUSES.has(status)) return false;
  return true;
}

// Empty/missing lang → Danish (older Meta DK leads from before lang detection
// was added — confirmed 243/252 are Danish). Explicit 'da' or 'dk' → Danish.
// Everything else (en/de/no/sv/fi/nl…) → English.
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
  generateScheduleToken,
  injectScheduleTokens,
  isEligible,
  detectLang
};
