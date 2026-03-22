/**
 * Fix Quick Follow-up — enable skip_throttle + flush stuck enrollments
 *
 * GET  /.netlify/functions/fix-quick-followup → dry run (show what would happen)
 * POST /.netlify/functions/fix-quick-followup → apply fixes + send emails
 * Auth: X-Internal-Secret header
 *
 * 1. Sets skip_throttle: true on the QF sequence document
 * 2. For each stuck enrollment: verifies no QF email was ever sent to that lead
 * 3. Resets next_send_at to now + 5 minutes (staggered) so the processor picks them up
 */

const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

var QUICK_FOLLOWUP_ID = 'Ue0CYOsPJlnj5SF9PtA0';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  var secret = process.env.AI_INTERNAL_SECRET;
  var provided = (event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'] || '').trim();
  if (!secret || provided !== secret) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  var db = getDb();
  var isDryRun = event.httpMethod === 'GET';
  var now = new Date();

  // 1. Load QF sequence
  var seqDoc = await db.collection('sequences').doc(QUICK_FOLLOWUP_ID).get();
  if (!seqDoc.exists) {
    return jsonResponse(404, { error: 'Quick Follow-up sequence not found' });
  }
  var seq = seqDoc.data();

  // 2. Get all QF enrollments
  var enrollSnap = await db.collection('sequence_enrollments')
    .where('sequence_id', '==', QUICK_FOLLOWUP_ID)
    .get();

  // 3. Get ALL email_log entries for QF sequence to verify no emails were sent
  var emailLogSnap = await db.collection('email_log')
    .where('source', '==', 'sequence')
    .where('sequence_id', '==', QUICK_FOLLOWUP_ID)
    .get();

  var sentEmails = {};
  emailLogSnap.forEach(function (doc) {
    var d = doc.data();
    if (d.lead_id) {
      if (!sentEmails[d.lead_id]) sentEmails[d.lead_id] = [];
      sentEmails[d.lead_id].push({
        to: d.to,
        subject: d.subject,
        status: d.status,
        sent_at: d.sent_at ? (d.sent_at.toDate ? d.sent_at.toDate().toISOString() : String(d.sent_at)) : null
      });
    }
  });

  // 4. Find stuck enrollments (active, step 1, empty step_history)
  var stuck = [];
  var alreadySent = [];
  var completed = [];
  var other = [];

  enrollSnap.forEach(function (doc) {
    var d = doc.data();
    var enrollment = { id: doc.id, lead_id: d.lead_id, lead_email: d.lead_email, lead_name: d.lead_name, status: d.status, current_step: d.current_step, step_history: d.step_history || [] };

    if (d.status === 'completed') {
      completed.push(enrollment);
      return;
    }
    if (d.status !== 'active') {
      other.push(enrollment);
      return;
    }

    // Check if this lead already received a QF email
    var leadSentEmails = sentEmails[d.lead_id];
    if (leadSentEmails && leadSentEmails.length > 0) {
      alreadySent.push({ enrollment: enrollment, emails: leadSentEmails });
      return;
    }

    // Also check step_history for any sent steps
    if (d.step_history && d.step_history.length > 0 && d.step_history.some(function (h) { return h.result === 'sent'; })) {
      alreadySent.push({ enrollment: enrollment, note: 'step_history shows sent' });
      return;
    }

    stuck.push(enrollment);
  });

  if (isDryRun) {
    return jsonResponse(200, {
      ok: true,
      mode: 'DRY_RUN',
      sequence: {
        name: seq.name,
        skip_throttle_current: seq.skip_throttle || false,
        will_set_skip_throttle: true
      },
      stuck_enrollments: {
        count: stuck.length,
        leads: stuck.map(function (e) {
          return { lead_id: e.lead_id, email: e.lead_email, name: e.lead_name };
        })
      },
      already_sent: {
        count: alreadySent.length,
        details: alreadySent
      },
      completed: {
        count: completed.length,
        details: completed.map(function (e) {
          return { lead_id: e.lead_id, email: e.lead_email, name: e.lead_name };
        })
      },
      other: { count: other.length },
      note: 'POST to apply: set skip_throttle + reset next_send_at for stuck enrollments'
    });
  }

  // 5. Set skip_throttle on the sequence document
  await db.collection('sequences').doc(QUICK_FOLLOWUP_ID).update({
    skip_throttle: true,
    updated_at: now.toISOString()
  });

  // 6. Reset next_send_at for each stuck enrollment (stagger by 30 seconds each)
  var reset = [];
  for (var i = 0; i < stuck.length; i++) {
    var e = stuck[i];
    var sendAt = new Date(now.getTime() + (i + 1) * 30 * 1000); // stagger 30s apart
    await db.collection('sequence_enrollments').doc(e.id).update({
      next_send_at: sendAt,
      updated_at: now
    });
    reset.push({
      enrollment_id: e.id,
      lead_email: e.lead_email,
      lead_name: e.lead_name,
      new_next_send_at: sendAt.toISOString()
    });
  }

  return jsonResponse(200, {
    ok: true,
    mode: 'APPLIED',
    skip_throttle_set: true,
    stuck_reset: reset.length,
    already_sent_skipped: alreadySent.length,
    completed_skipped: completed.length,
    reset_details: reset,
    note: 'Enrollments will be picked up by the next processor run (every 30 min). The skip_throttle flag ensures they won\'t be throttled.',
    timestamp: now.toISOString()
  });
};
