/**
 * Batch Enroll Educational — One-time / on-demand function
 *
 * POST /.netlify/functions/batch-enroll-educational
 * Auth: X-Internal-Secret header
 *
 * Finds all leads who completed the broadcast sequence but are NOT enrolled
 * in the educational sequence, and enrolls them (checking exit conditions).
 *
 * Query param: ?dry_run=true — preview without enrolling
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const BROADCAST_SEQUENCE_ID = 'Ma2caW2hiQqtkPFesK27';
const EXIT_CONDITIONS = ['converted', 'existing applicant', 'unsubscribed', 'lost', 'closed', 'archived'];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'POST only' });

  var secret = process.env.AI_INTERNAL_SECRET;
  var provided = (event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'] || '').trim();
  if (!secret || provided !== secret) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  var dryRun = (event.queryStringParameters || {}).dry_run === 'true';
  var db = getDb();

  // 1. Find the educational sequence by name
  var eduSnap = await db.collection('sequences')
    .where('name', '==', 'YTT Educational Nurture — 2026')
    .where('active', '==', true)
    .limit(1)
    .get();

  if (eduSnap.empty) {
    return jsonResponse(404, { error: 'Educational sequence not found or not active. Create it first.' });
  }

  var eduSeqId = eduSnap.docs[0].id;
  var eduSeq = eduSnap.docs[0].data();

  // 2. Find all broadcast enrollments that are completed
  var broadcastCompleted = await db.collection('sequence_enrollments')
    .where('sequence_id', '==', BROADCAST_SEQUENCE_ID)
    .where('status', '==', 'completed')
    .get();

  if (broadcastCompleted.empty) {
    return jsonResponse(200, { ok: true, message: 'No completed broadcast enrollments found', enrolled: 0 });
  }

  // 3. Find all existing educational enrollments (active/paused) to skip
  var existingEduSnap = await db.collection('sequence_enrollments')
    .where('sequence_id', '==', eduSeqId)
    .where('status', 'in', ['active', 'paused'])
    .get();

  var alreadyEnrolled = new Set();
  existingEduSnap.forEach(function (doc) {
    alreadyEnrolled.add(doc.data().lead_id);
  });

  // 4. Process each completed broadcast lead
  var enrolled = [];
  var skipped = [];
  var now = new Date().toISOString();

  // Calculate first step send time
  var firstStep = eduSeq.steps && eduSeq.steps[0];
  var firstDelay = (firstStep && firstStep.delay_minutes) || 10080; // 7 days default
  var nextSendAt = new Date(Date.now() + firstDelay * 60 * 1000).toISOString();

  for (var i = 0; i < broadcastCompleted.docs.length; i++) {
    var enrollDoc = broadcastCompleted.docs[i];
    var enrollment = enrollDoc.data();
    var leadId = enrollment.lead_id;

    // Skip if already enrolled in educational
    if (alreadyEnrolled.has(leadId)) {
      skipped.push({ lead_id: leadId, reason: 'Already enrolled in educational' });
      continue;
    }

    // Load lead and check exit conditions
    var leadDoc = await db.collection('leads').doc(leadId).get();
    if (!leadDoc.exists) {
      skipped.push({ lead_id: leadId, reason: 'Lead not found' });
      continue;
    }

    var lead = leadDoc.data();
    var leadStatus = (lead.status || '').toLowerCase();

    // Check exit conditions
    var shouldSkip = false;
    for (var e = 0; e < EXIT_CONDITIONS.length; e++) {
      if (leadStatus === EXIT_CONDITIONS[e]) {
        shouldSkip = true;
        break;
      }
    }
    if (lead.converted === true || lead.unsubscribed === true) {
      shouldSkip = true;
    }

    if (shouldSkip) {
      skipped.push({ lead_id: leadId, email: lead.email, reason: 'Exit condition: ' + lead.status });
      continue;
    }

    if (!dryRun) {
      await db.collection('sequence_enrollments').add({
        sequence_id: eduSeqId,
        sequence_name: eduSeq.name || 'YTT Educational Nurture — 2026',
        lead_id: leadId,
        lead_email: lead.email || '',
        lead_name: ((lead.first_name || '') + ' ' + (lead.last_name || '')).trim(),
        current_step: 1,
        status: 'active',
        exit_reason: null,
        next_send_at: nextSendAt,
        started_at: now,
        updated_at: now,
        step_history: [],
        trigger: 'batch_enroll_broadcast_completed',
        created_at: serverTimestamp()
      });
    }

    enrolled.push({ lead_id: leadId, email: lead.email || '', name: lead.first_name || '' });
  }

  return jsonResponse(200, {
    ok: true,
    dry_run: dryRun,
    educational_sequence_id: eduSeqId,
    broadcast_completed_total: broadcastCompleted.size,
    enrolled_count: enrolled.length,
    enrolled: enrolled,
    skipped_count: skipped.length,
    skipped: skipped,
    timestamp: new Date().toISOString()
  });
};
