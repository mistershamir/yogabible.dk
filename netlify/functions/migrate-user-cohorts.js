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

    var summary = { migrated: 0, couldNotInfer: 0, skipped: 0, details: [] };

    var writes = [];

    snap.forEach(function (doc) {
      var uid = doc.id;
      var data = doc.data() || {};
      var details = data.roleDetails || {};

      // Only trainees/teachers have program/cohort semantics
      if (!details.program && !details.cohort && !details.courseId) {
        summary.skipped++;
        return;
      }

      var updates = {};
      var actions = [];

      // 1. Wrap cohort string in array
      if (typeof details.cohort === 'string' && details.cohort) {
        updates.cohort = [details.cohort];
        actions.push('cohort:string→array');
      }

      // 2. Infer courseId when missing
      if (!details.courseId) {
        var inferred = inferCourseIdFromDetails(details);
        if (inferred) {
          updates.courseId = inferred;
          actions.push('courseId:' + inferred);
        } else {
          summary.couldNotInfer++;
          summary.details.push({ uid: uid, email: data.email || '', status: 'could_not_infer', existing: details });
          return;
        }
      }

      if (Object.keys(updates).length === 0) {
        summary.skipped++;
        return;
      }

      summary.migrated++;
      summary.details.push({ uid: uid, email: data.email || '', status: 'migrated', actions: actions, updates: updates });

      if (!dryRun) {
        var mergedDetails = Object.assign({}, details, updates);
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
      'skipped:', summary.skipped);

    return jsonResponse(200, { ok: true, dryRun: dryRun, ...summary });

  } catch (err) {
    console.error('[migrate-user-cohorts]', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};
