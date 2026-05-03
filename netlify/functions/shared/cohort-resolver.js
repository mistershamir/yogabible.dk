/**
 * Cohort Resolver
 *
 * Reads `cohort_registry` docs and resolves the best cohort to promote for
 * a given lead. Used by the sequence processor for `content_type: "dynamic"`
 * steps in the Personal Outreach sequence.
 *
 * Selection rules:
 *   1. Only `active === true` cohorts whose `enrollment_closes > today`
 *   2. Match by `program_type` exact OR by `also_matches.includes(programType)`
 *   3. Sort ascending by `start_date` — nearest cohort wins
 *   4. Multi-format leads: pick the result with the earliest `start_date`
 *      across all of the lead's interest types
 *   5. `isUrgent` is true when the chosen cohort starts in fewer than 3 days
 */

const { getDb } = require('./firestore');

const COL = 'cohort_registry';
const CACHE_TTL_MS = 60 * 1000;

let _cache = null;
let _cacheLoadedAt = 0;

function _today() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

async function _loadActiveCohorts() {
  if (_cache && (Date.now() - _cacheLoadedAt) < CACHE_TTL_MS) {
    return _cache;
  }
  const db = getDb();
  const snap = await db.collection(COL).where('active', '==', true).get();
  _cache = snap.docs.map((d) => Object.assign({ _docId: d.id }, d.data()));
  _cacheLoadedAt = Date.now();
  return _cache;
}

function _matches(cohort, programType) {
  if (!programType) return false;
  if (cohort.program_type === programType) return true;
  if (Array.isArray(cohort.also_matches) && cohort.also_matches.indexOf(programType) >= 0) return true;
  return false;
}

function _enroll(cohort) {
  // enrollment_closes interpreted as start-of-day in UTC.
  return cohort.enrollment_closes ? new Date(cohort.enrollment_closes) : null;
}

function _start(cohort) {
  return cohort.start_date ? new Date(cohort.start_date) : null;
}

/**
 * Look up a single cohort by its document id.
 */
async function resolveCohortById(cohortId) {
  if (!cohortId) return null;
  const cohorts = await _loadActiveCohorts();
  return cohorts.find((c) => c._docId === cohortId || c.id === cohortId) || null;
}

/**
 * Resolve the nearest open cohort for a single program type.
 * Returns { cohort, isUrgent, daysUntilStart } or null.
 */
async function resolveCohort(programType) {
  const cohorts = await _loadActiveCohorts();
  const today = _today();

  const candidates = cohorts.filter((c) => {
    const closes = _enroll(c);
    if (!closes || closes <= today) return false;
    return _matches(c, programType);
  });

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const sa = _start(a);
    const sb = _start(b);
    if (!sa) return 1;
    if (!sb) return -1;
    return sa - sb;
  });

  const chosen = candidates[0];
  const startDate = _start(chosen);
  const daysUntilStart = startDate
    ? Math.ceil((startDate - today) / (24 * 60 * 60 * 1000))
    : null;
  const isUrgent = daysUntilStart != null && daysUntilStart < 3;

  return { cohort: chosen, isUrgent, daysUntilStart };
}

/**
 * Resolve the best cohort across all of a lead's interest types.
 * Falls back to ['4-week'] when ytt_program_type is empty so generic YTT
 * inquiries still match an open cohort.
 */
async function resolveCohortForLead(lead) {
  const raw = (lead && (lead.ytt_program_type || lead.program_type || '')) || '';
  let types = raw.split(',').map((t) => t.trim()).filter(Boolean);
  if (types.length === 0) types = ['4-week'];

  const results = [];
  for (const t of types) {
    const r = await resolveCohort(t);
    if (r) results.push(r);
  }
  if (results.length === 0) return null;

  results.sort((a, b) => {
    const sa = _start(a.cohort);
    const sb = _start(b.cohort);
    if (!sa) return 1;
    if (!sb) return -1;
    return sa - sb;
  });

  return results[0];
}

/**
 * Build a tokenised schedule URL for a cohort + lang.
 * Caller passes a pre-generated HMAC token (see sequences.js generateScheduleToken).
 */
function buildScheduleUrl(cohort, lang, leadId, token) {
  if (!cohort) return '';
  const isDanish = lang === 'da' || lang === 'dk';
  const path = isDanish ? cohort.schedule_path_da : cohort.schedule_path_en;
  if (!path) return '';
  const base = 'https://www.yogabible.dk' + path;
  const sep = base.indexOf('?') >= 0 ? '&' : '?';
  if (leadId && token) {
    return base + sep + 'tid=' + encodeURIComponent(leadId) + '&tok=' + encodeURIComponent(token);
  }
  return base;
}

/**
 * Reset the in-process cache. Use after writing to cohort_registry from a
 * long-running process so subsequent reads pick up the change immediately.
 */
function resetCohortCache() {
  _cache = null;
  _cacheLoadedAt = 0;
}

module.exports = {
  resolveCohortById,
  resolveCohort,
  resolveCohortForLead,
  buildScheduleUrl,
  resetCohortCache
};
