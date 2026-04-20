/**
 * Re-enroll wrongly exited leads into YTT Broadcast Nurture
 *
 * POST /.netlify/functions/reenroll-broadcast
 * Auth: X-Internal-Secret header
 *
 * Finds leads exited with "Not too keen" or "Interested In Next Round"
 * and re-enrolls them in the broadcast sequence at step 1.
 * Skips leads already actively enrolled in broadcast.
 */

const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

var BROADCAST_ID = 'Ma2caW2hiQqtkPFesK27';
var EXIT_REASONS_TO_REENROLL = ['Not too keen', 'Interested In Next Round'];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  var secret = process.env.AI_INTERNAL_SECRET;
  var provided = (event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'] || '').trim();
  if (!secret || provided !== secret) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  var db = getDb();
  var isDryRun = event.httpMethod === 'GET';

  // 1. Get the broadcast sequence for its name and first step delay
  var broadcastDoc = await db.collection('sequences').doc(BROADCAST_ID).get();
  if (!broadcastDoc.exists) {
    return jsonResponse(404, { error: 'Broadcast sequence not found' });
  }
  var broadcast = broadcastDoc.data();
  var firstStepDelay = (broadcast.steps && broadcast.steps[0]) ? (broadcast.steps[0].delay_minutes || 0) : 0;

  // 2. Get ALL enrollments (we need to find exited ones + check for active broadcast)
  var enrollmentsSnap = await db.collection('sequence_enrollments').get();

  // Build maps
  var allEnrollments = [];
  enrollmentsSnap.forEach(function (doc) {
    allEnrollments.push(Object.assign({ _id: doc.id }, doc.data()));
  });

  // Find leads already active in broadcast
  var activeBroadcastLeads = new Set();
  allEnrollments.forEach(function (e) {
    if (e.sequence_id === BROADCAST_ID) {
      activeBroadcastLeads.add(e.lead_id);
    }
  });

  // Find wrongly exited enrollments (any sequence, matching exit reasons)
  var wronglyExited = allEnrollments.filter(function (e) {
    if (e.status !== 'exited') return false;
    var reason = (e.exit_reason || '').toLowerCase();
    return EXIT_REASONS_TO_REENROLL.some(function (r) {
      return reason.includes(r.toLowerCase());
    });
  });

  // Deduplicate by lead_id (a lead may have been exited from multiple sequences)
  var leadsToReenroll = {};
  wronglyExited.forEach(function (e) {
    if (!leadsToReenroll[e.lead_id]) {
      leadsToReenroll[e.lead_id] = {
        lead_id: e.lead_id,
        lead_email: e.lead_email || '',
        lead_name: e.lead_name || '',
        exited_from: []
      };
    }
    leadsToReenroll[e.lead_id].exited_from.push({
      sequence_name: e.sequence_name || e.sequence_id,
      exit_reason: e.exit_reason
    });
  });

  // Filter out leads already active in broadcast
  var candidates = [];
  var alreadyActive = [];
  Object.keys(leadsToReenroll).forEach(function (lid) {
    if (activeBroadcastLeads.has(lid)) {
      alreadyActive.push(leadsToReenroll[lid]);
    } else {
      candidates.push(leadsToReenroll[lid]);
    }
  });

  if (isDryRun) {
    return jsonResponse(200, {
      ok: true,
      mode: 'DRY_RUN',
      broadcast_sequence: broadcast.name,
      first_step_delay_minutes: firstStepDelay,
      wrongly_exited_total: wronglyExited.length,
      unique_leads_to_reenroll: candidates.length,
      already_active_in_broadcast: alreadyActive.length,
      candidates: candidates.slice(0, 50),
      skipped_already_active: alreadyActive.slice(0, 10),
      note: 'POST to this endpoint to apply re-enrollment'
    });
  }

  // 3. Re-enroll each candidate
  var now = new Date();
  var nextSendAt = new Date(now.getTime() + firstStepDelay * 60 * 1000);
  var enrolled = [];
  var errors = [];

  for (var i = 0; i < candidates.length; i++) {
    var lead = candidates[i];
    try {
      var enrollDocId = BROADCAST_ID + '_' + lead.lead_id;
      await db.collection('sequence_enrollments').doc(enrollDocId).set({
        sequence_id: BROADCAST_ID,
        sequence_name: broadcast.name || '',
        lead_id: lead.lead_id,
        lead_email: lead.lead_email,
        lead_name: lead.lead_name,
        current_step: 1,
        status: 'active',
        exit_reason: null,
        next_send_at: nextSendAt,
        started_at: now,
        updated_at: now,
        step_history: [],
        trigger: 'manual',
        reenroll_reason: 'Wrongly exited with status: ' + lead.exited_from.map(function (e) { return e.exit_reason; }).join(', ')
      });
      enrolled.push({
        lead_id: lead.lead_id,
        lead_email: lead.lead_email,
        lead_name: lead.lead_name,
        previously_exited_from: lead.exited_from.map(function (e) { return e.sequence_name; })
      });
    } catch (err) {
      errors.push({ lead_id: lead.lead_id, error: err.message });
    }
  }

  return jsonResponse(200, {
    ok: true,
    mode: 'APPLIED',
    broadcast_sequence: broadcast.name,
    re_enrolled: enrolled.length,
    errors: errors.length,
    skipped_already_active: alreadyActive.length,
    first_step_sends_at: nextSendAt.toISOString(),
    enrolled_leads: enrolled,
    error_details: errors.length ? errors : undefined,
    timestamp: now.toISOString()
  });
};
