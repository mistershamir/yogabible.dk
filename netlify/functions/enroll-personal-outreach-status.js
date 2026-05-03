/**
 * Read the status / final result of an enroll-personal-outreach-background run.
 *
 * GET /.netlify/functions/enroll-personal-outreach-status?run=<runId>
 *   → returns the backfill_runs/<runId> doc verbatim.
 *
 * GET /.netlify/functions/enroll-personal-outreach-status
 *   → returns the most recent run (by started_at desc).
 *
 * Auth: X-Internal-Secret header.
 *
 * Doc shape (set by enroll-personal-outreach-background.js):
 *   { run_id, mode: 'preview'|'apply', status: 'running'|'completed'|'error',
 *     phase, started_at, updated_at, completed_at?, sequence_id?,
 *     already_enrolled_at_start?, raw_counts?, totals?, segments?, error? }
 */

const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const RUNS_COL = 'backfill_runs';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  const secret = process.env.AI_INTERNAL_SECRET;
  const provided = (event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'] || '').trim();
  if (!secret || provided !== secret) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  const db = getDb();
  const params = event.queryStringParameters || {};
  const runId = params.run;

  if (runId) {
    const snap = await db.collection(RUNS_COL).doc(runId).get();
    if (!snap.exists) return jsonResponse(404, { error: 'run_not_found', run_id: runId });
    return jsonResponse(200, normalize(snap.id, snap.data()));
  }

  // No id → most recent
  const recent = await db.collection(RUNS_COL).orderBy('started_at', 'desc').limit(1).get();
  if (recent.empty) return jsonResponse(404, { error: 'no_runs_yet' });
  const doc = recent.docs[0];
  return jsonResponse(200, normalize(doc.id, doc.data()));
};

function normalize(id, data) {
  const out = Object.assign({ id }, data);
  // Convert Firestore Timestamps to ISO so the response is curl-friendly.
  for (const key of Object.keys(out)) {
    const v = out[key];
    if (v && typeof v === 'object' && typeof v.toDate === 'function') {
      out[key] = v.toDate().toISOString();
    }
  }
  return out;
}
