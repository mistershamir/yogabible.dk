/**
 * Deactivate Sequence — Admin tool
 *
 * POST /.netlify/functions/deactivate-sequence?id=<sequenceId>&reason=<text>
 * Auth: X-Internal-Secret header (AI_INTERNAL_SECRET env var)
 *
 * 1. sequences/{id} → active: false, deactivatedAt: serverTimestamp(), deactivatedReason: <reason>
 * 2. sequence_enrollments where sequence_id == id AND status == 'active'
 *    → status: 'exited', exit_reason: 'Sequence deactivated — <reason>'
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'Method not allowed' });
  }

  var secret = process.env.AI_INTERNAL_SECRET;
  var provided = event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'] || '';
  if (!secret || provided !== secret) {
    return jsonResponse(401, { ok: false, error: 'Unauthorized' });
  }

  var params = event.queryStringParameters || {};
  var sequenceId = params.id;
  var reason = params.reason || 'Deactivated via admin tool';

  if (!sequenceId) {
    return jsonResponse(400, { ok: false, error: 'id query parameter is required' });
  }

  var db = getDb();
  var seqRef = db.collection('sequences').doc(sequenceId);
  var seqSnap = await seqRef.get();
  if (!seqSnap.exists) {
    return jsonResponse(404, { ok: false, error: 'Sequence not found: ' + sequenceId });
  }

  await seqRef.update({
    active: false,
    deactivatedAt: serverTimestamp(),
    deactivatedReason: reason,
    updated_at: serverTimestamp()
  });

  var nowIso = new Date().toISOString();
  var snap = await db.collection('sequence_enrollments')
    .where('sequence_id', '==', sequenceId)
    .where('status', '==', 'active')
    .get();

  var exited = 0;
  var errors = [];
  for (var i = 0; i < snap.docs.length; i++) {
    try {
      await snap.docs[i].ref.update({
        status: 'exited',
        exit_reason: 'Sequence deactivated — ' + reason,
        updated_at: nowIso
      });
      exited++;
    } catch (err) {
      errors.push({ enrollment_id: snap.docs[i].id, error: err.message });
    }
  }

  return jsonResponse(200, {
    ok: true,
    sequence_id: sequenceId,
    reason: reason,
    enrollments_exited: exited,
    errors: errors
  });
};
