/**
 * Fix Overdue Enrollments — reset non-QF stuck enrollments to normal cadence
 *
 * GET  → dry run (show what would happen)
 * POST → apply (reset next_send_at for non-QF enrollments)
 *
 * Leaves Quick Follow-up enrollments untouched so they send immediately.
 * Resets all other overdue step-1 enrollments to start their delay from NOW,
 * so leads get emails at the intended cadence instead of all at once.
 */

const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

var QUICK_FOLLOWUP_ID = 'Ue0CYOsPJlnj5SF9PtA0';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  var secret = process.env.AI_INTERNAL_SECRET;
  if (!secret || event.headers['x-internal-secret'] !== secret) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  var isDryRun = event.httpMethod === 'GET';
  var db = getDb();
  var now = new Date();

  // Find all active enrollments that are overdue
  var snap = await db.collection('sequence_enrollments')
    .where('status', '==', 'active')
    .where('next_send_at', '<=', now)
    .get();

  if (snap.empty) {
    return jsonResponse(200, { ok: true, overdue_count: 0, note: 'No overdue enrollments found' });
  }

  // Load sequence definitions (for step delays)
  var seqCache = {};

  var qfEnrollments = [];
  var nonQfEnrollments = [];

  for (var i = 0; i < snap.docs.length; i++) {
    var doc = snap.docs[i];
    var d = doc.data();
    var enrollment = { id: doc.id, ...d };

    if (d.sequence_id === QUICK_FOLLOWUP_ID) {
      qfEnrollments.push(enrollment);
    } else {
      // Load sequence if not cached
      if (!seqCache[d.sequence_id]) {
        var seqDoc = await db.collection('sequences').doc(d.sequence_id).get();
        seqCache[d.sequence_id] = seqDoc.exists ? seqDoc.data() : null;
      }
      nonQfEnrollments.push(enrollment);
    }
  }

  if (isDryRun) {
    return jsonResponse(200, {
      ok: true,
      mode: 'DRY_RUN',
      total_overdue: snap.size,
      qf_enrollments: {
        count: qfEnrollments.length,
        action: 'LEAVE ALONE — will send on next processor run',
        leads: qfEnrollments.map(function (e) {
          return { id: e.id, email: e.lead_email, name: e.lead_name };
        })
      },
      non_qf_enrollments: {
        count: nonQfEnrollments.length,
        action: 'RESET next_send_at to step delay from NOW',
        leads: nonQfEnrollments.map(function (e) {
          var seq = seqCache[e.sequence_id];
          var stepIndex = (e.current_step || 1) - 1;
          var step = seq && seq.steps && seq.steps[stepIndex];
          var delayMin = (step && step.delay_minutes) || 0;
          var newSendAt = new Date(now.getTime() + delayMin * 60 * 1000);
          return {
            id: e.id,
            email: e.lead_email,
            name: e.lead_name,
            sequence: e.sequence_name || e.sequence_id,
            current_step: e.current_step,
            delay_minutes: delayMin,
            new_next_send_at: newSendAt.toISOString()
          };
        })
      },
      note: 'POST to apply — resets non-QF enrollments so they follow normal cadence from now'
    });
  }

  // Apply: reset non-QF enrollments
  var reset = [];
  for (var j = 0; j < nonQfEnrollments.length; j++) {
    var e = nonQfEnrollments[j];
    var seq = seqCache[e.sequence_id];
    var stepIndex = (e.current_step || 1) - 1;
    var step = seq && seq.steps && seq.steps[stepIndex];
    var delayMin = (step && step.delay_minutes) || 0;
    var newSendAt = new Date(now.getTime() + delayMin * 60 * 1000);

    await db.collection('sequence_enrollments').doc(e.id).update({
      next_send_at: newSendAt,
      updated_at: now
    });

    reset.push({
      id: e.id,
      email: e.lead_email,
      name: e.lead_name,
      sequence: e.sequence_name || e.sequence_id,
      delay_minutes: delayMin,
      new_next_send_at: newSendAt.toISOString()
    });
  }

  return jsonResponse(200, {
    ok: true,
    mode: 'APPLIED',
    qf_untouched: qfEnrollments.length,
    non_qf_reset: reset.length,
    reset_details: reset,
    note: 'QF enrollments left alone (will send next run). Non-QF enrollments reset to normal cadence from now.',
    timestamp: now.toISOString()
  });
};
