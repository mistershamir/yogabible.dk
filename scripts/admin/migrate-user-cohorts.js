/**
 * Netlify Function: /.netlify/functions/migrate-user-cohorts
 *
 * One-time (idempotent) migration: normalizes user.roleDetails to the
 * catalogue-driven schema used by the live-admin access control.
 *
 *  1. roleDetails.cohort (string) → array [cohort]
 *  2. Infer roleDetails.courseId from legacy program/method/cohort when missing
 *
 * Query params:
 *   - dry_run=true    → no writes, return what WOULD change
 *
 * Protected by X-Internal-Secret header matching AI_INTERNAL_SECRET.
 *
 * Returns: { migrated, couldNotInfer, skipped, details: [...] }
 */

const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

// Admin/test accounts — skip entirely (no migration, no couldNotInfer count).
var ADMIN_SKIP_EMAILS = [
  'info@yogabible.com',
  'info@hotyogacph.dk',
  'shamir@hotyogacph.dk'
];

// Per-email overrides for unusual legacy cohort values that cannot be
// inferred from program/method alone. Each entry supplies the
// authoritative catalogue-aligned values.
var EMAIL_OVERRIDES = {
  'avasuleimans@gmail.com': {
    courseId: 'YTT200-4W',
    cohortId: '2026-04',
    cohortLabel: 'April 2026',
    cohortBuildId: '2026-04-4W'
  }
};

// Legacy cohort value → authoritative mapping.
// "2026-spring" → 18-Week March–June 2026 (catalogue cohort_id: 2026-03-06)
var LEGACY_COHORT_MAP = {
  '2026-spring': {
    courseId: 'YTT200-18W',
    cohortId: '2026-03-06',
    cohortLabel: 'March–June 2026',
    cohortBuildId: '2026-03-06-18W'
  }
};

/**
 * If a cohort value is a full ISO timestamp like "2026-02-28T23:00:00.000Z-4W",
 * strip the ISO suffix and return just { datePart, suffix }.
 * Returns null when no ISO timestamp is present.
 */
function stripIsoFromCohort(cohort) {
  if (typeof cohort !== 'string') return null;
  // Matches YYYY-MM-DDTHH:MM:SS(.sss)?Z followed by optional suffix like "-4W"
  var m = cohort.match(/^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z(-.*)?$/);
  if (!m) return null;
  return { datePart: m[1], suffix: m[2] || '' };
}

/**
 * Best-effort rebuild of a buildCohortId-format string when a cohort
 * value contains an ISO timestamp.
 *   "2026-02-28T23:00:00.000Z-4W"  →  "2026-02-4W"  (month portion only)
 *
 * The catalogue cohort_id for 4-week intensives uses "YYYY-MM" (no day),
 * so we prefer the year-month portion of the ISO date.
 */
function rebuildIsoCohort(cohort) {
  var stripped = stripIsoFromCohort(cohort);
  if (!stripped) return null;
  var yearMonth = stripped.datePart.slice(0, 7); // "2026-02"
  return yearMonth + (stripped.suffix || '');
}

function inferCourseIdFromDetails(details) {
  var prog = details.program || '';
  var method = details.method || '';
  var cohort = details.cohort;
  if (Array.isArray(cohort)) cohort = cohort[0] || '';

  // Explicit: 200h + vinyasa → Vinyasa Plus
  if (prog === '200h' && method === 'vinyasa') return 'YTT200-4W-VP';

  // Cohort suffix is the next strongest signal
  var c = (cohort || '').toUpperCase();
  if (c.indexOf('-4WVP') !== -1 || c.indexOf('-VP') !== -1) return 'YTT200-4W-VP';
  if (c.indexOf('-18W') !== -1) return 'YTT200-18W';
  if (c.indexOf('-8W') !== -1) return 'YTT200-8W';
  if (c.indexOf('-4W') !== -1) return 'YTT200-4W';
  if (c.indexOf('-300H') !== -1) return 'YTT300-ADV';
  if (c.indexOf('-500H') !== -1) return 'YTT500-ADV';

  // 300h prog with no cohort hint → advanced
  if (prog === '300h') return 'YTT300-ADV';

  return '';
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'GET or POST only' });
  }

  var secret = event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'];
  if (!process.env.AI_INTERNAL_SECRET || secret !== process.env.AI_INTERNAL_SECRET) {
    return jsonResponse(401, { ok: false, error: 'Unauthorized' });
  }

  var params = event.queryStringParameters || {};
  var dryRun = params.dry_run === 'true' || params.dry_run === '1';

  try {
    var db = getDb();
    var snap = await db.collection('users').get();

    var summary = { migrated: 0, couldNotInfer: 0, skipped: 0, adminSkipped: 0, details: [] };

    var writes = [];

    snap.forEach(function (doc) {
      var uid = doc.id;
      var data = doc.data() || {};
      var details = data.roleDetails || {};
      var email = (data.email || '').toLowerCase().trim();

      // Skip admin/test accounts entirely
      if (email && ADMIN_SKIP_EMAILS.indexOf(email) !== -1) {
        summary.adminSkipped++;
        return;
      }

      // Only trainees/teachers have program/cohort semantics
      if (!details.program && !details.cohort && !details.courseId) {
        summary.skipped++;
        return;
      }

      var updates = {};
      var actions = [];

      // 0a. Per-email override takes highest priority (handles unique legacy cases)
      var emailOverride = email ? EMAIL_OVERRIDES[email] : null;
      if (emailOverride) {
        if (!details.courseId || details.courseId !== emailOverride.courseId) {
          updates.courseId = emailOverride.courseId; actions.push('override.courseId:' + emailOverride.courseId);
        }
        if (!details.cohortId || details.cohortId !== emailOverride.cohortId) {
          updates.cohortId = emailOverride.cohortId; actions.push('override.cohortId:' + emailOverride.cohortId);
        }
        if (!details.cohortLabel) {
          updates.cohortLabel = emailOverride.cohortLabel; actions.push('override.cohortLabel');
        }
        updates.cohort = [emailOverride.cohortBuildId];
        actions.push('override.cohort:' + emailOverride.cohortBuildId);
      } else {
        // 0b. Legacy cohort string mapping (e.g. "2026-spring" → 18W)
        var cohortForMap = Array.isArray(details.cohort) ? details.cohort[0] : details.cohort;
        var legacyMap = cohortForMap ? LEGACY_COHORT_MAP[cohortForMap] : null;
        if (legacyMap) {
          if (!details.courseId) { updates.courseId = legacyMap.courseId; actions.push('legacyMap.courseId:' + legacyMap.courseId); }
          if (!details.cohortId) { updates.cohortId = legacyMap.cohortId; actions.push('legacyMap.cohortId:' + legacyMap.cohortId); }
          if (!details.cohortLabel) { updates.cohortLabel = legacyMap.cohortLabel; actions.push('legacyMap.cohortLabel'); }
          updates.cohort = [legacyMap.cohortBuildId];
          actions.push('legacyMap.cohort:' + legacyMap.cohortBuildId);
        } else {
          // 1a. ISO timestamp in cohort value → rebuild "YYYY-MM<suffix>"
          var cohortStr = Array.isArray(details.cohort) ? details.cohort[0] : details.cohort;
          var rebuilt = rebuildIsoCohort(cohortStr);
          if (rebuilt) {
            updates.cohort = [rebuilt];
            actions.push('iso→' + rebuilt);
            // Refresh cohort for subsequent inference steps
            details = Object.assign({}, details, { cohort: rebuilt });
          } else if (typeof details.cohort === 'string' && details.cohort) {
            // 1b. Wrap plain cohort string in array
            updates.cohort = [details.cohort];
            actions.push('cohort:string→array');
          }

          // 2. Infer courseId when missing
          if (!details.courseId && !updates.courseId) {
            var inferred = inferCourseIdFromDetails(details);
            if (inferred) {
              updates.courseId = inferred;
              actions.push('courseId:' + inferred);
            } else {
              summary.couldNotInfer++;
              summary.details.push({ uid: uid, email: email, status: 'could_not_infer', existing: details });
              return;
            }
          }
        }
      }

      if (Object.keys(updates).length === 0) {
        summary.skipped++;
        return;
      }

      summary.migrated++;
      summary.details.push({ uid: uid, email: email, status: 'migrated', actions: actions, updates: updates });

      if (!dryRun) {
        var mergedDetails = Object.assign({}, data.roleDetails || {}, updates);
        writes.push({ ref: doc.ref, details: mergedDetails });
      }
    });

    if (!dryRun && writes.length) {
      // Batch in chunks of 450 (Firestore max 500 per batch)
      var batchSize = 450;
      for (var i = 0; i < writes.length; i += batchSize) {
        var batch = db.batch();
        writes.slice(i, i + batchSize).forEach(function (w) {
          batch.update(w.ref, { roleDetails: w.details, updated_at: new Date() });
        });
        await batch.commit();
      }
    }

    console.log('[migrate-user-cohorts]', dryRun ? '(dry run)' : '(write)',
      'migrated:', summary.migrated,
      'couldNotInfer:', summary.couldNotInfer,
      'skipped:', summary.skipped,
      'adminSkipped:', summary.adminSkipped);

    return jsonResponse(200, { ok: true, dryRun: dryRun, ...summary });

  } catch (err) {
    console.error('[migrate-user-cohorts]', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};
