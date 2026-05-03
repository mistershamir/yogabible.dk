/**
 * Shared constants + helpers for the July 2026 accommodation campaign.
 * Imported by campaign-july-accommodation.js (preview/debug) and
 * campaign-july-accommodation-send-background.js (send).
 *
 * Audience: leads with type==='ytt' AND ytt_program_type contains
 * '4-week-jul' AND not living in Copenhagen/Denmark.
 */

const crypto = require('crypto');

const CAMPAIGN_ID = 'july-2026-accommodation';
const SOURCE_TAG = 'campaign:july-2026-accommodation';

const TOKEN_SECRET = process.env.UNSUBSCRIBE_SECRET || 'yb-appt-secret';

const EXCLUDE_STATUSES = new Set([
  'Not too keen', 'Lost', 'Converted', 'Existing Applicant',
  'Unsubscribed', 'Closed', 'Archived'
]);

// Possible field names where accommodation preference might live.
// Until we confirm via debug mode, we check all of them and treat the
// lead as ineligible if ANY of these fields holds a "lives in DK" marker.
const ACCOMMODATION_FIELDS = [
  'accommodation',
  'housing',
  'accommodation_preference',
  'housing_preference',
  'accommodation_status',
  'accommodation_needed',
  'lives_in'
];

const LIVES_LOCAL_VALUES = new Set([
  'lives_in_copenhagen',
  'lives_in_denmark',
  'copenhagen',
  'denmark'
]);

const DA = {
  subject: 'Bolig til juli-holdet',
  bodyHtml:
    '<p>Hej {{first_name}},</p>' +
    '<p>Kort besked — jeg har lige talt med vores boligpartner om juli-holdet.</p>' +
    '<p>De har et begrænset antal studielejligheder ledige i juli, og de anbefaler at reservere snart hvis du har brug for et sted at bo under uddannelsen.</p>' +
    '<p>Jeg kan hjælpe med at sætte det op — skriv til mig her eller ring på <a href="tel:+4553881209" style="color:#f75c03;">53 88 12 09</a> så finder vi en løsning der passer dig.</p>'
};

const EN = {
  subject: 'Accommodation for the July cohort',
  bodyHtml:
    '<p>Hi {{first_name}},</p>' +
    '<p>Quick note — I\'ve just spoken with our accommodation partner about the July cohort.</p>' +
    '<p>They have a limited number of studio apartments available in July, and they recommend reserving soon if you need a place to stay during the training.</p>' +
    '<p>I can help set it up — reply here or call me at <a href="tel:+4553881209" style="color:#f75c03;">+45 53 88 12 09</a> and we\'ll find something that works for you.</p>'
};

function generateScheduleToken(leadId, email) {
  var hmac = crypto.createHmac('sha256', TOKEN_SECRET);
  hmac.update(leadId + ':' + (email || '').toLowerCase().trim());
  return hmac.digest('hex');
}

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

// Check whether the lead "lives in DK / Copenhagen" by inspecting all
// possible accommodation field names. If ANY of them holds a DK-local
// value, the lead is excluded.
function livesLocally(lead) {
  if (!lead) return false;
  for (var i = 0; i < ACCOMMODATION_FIELDS.length; i++) {
    var v = lead[ACCOMMODATION_FIELDS[i]];
    if (typeof v === 'string' && LIVES_LOCAL_VALUES.has(v.trim().toLowerCase())) {
      return true;
    }
  }
  return false;
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
  if (lead.unsubscribed) return false;
  if (lead.email_bounced) return false;
  var status = (lead.status || '').trim();
  if (EXCLUDE_STATUSES.has(status)) return false;
  if (livesLocally(lead)) return false;
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
  ACCOMMODATION_FIELDS,
  LIVES_LOCAL_VALUES,
  generateScheduleToken,
  injectScheduleTokens,
  livesLocally,
  programMatchesJulyFourWeek,
  isEligible,
  detectLang
};
