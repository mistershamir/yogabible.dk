/**
 * Sequence Automation API — Yoga Bible (Admin)
 * Multi-step drip sequence engine with enrollment tracking.
 *
 * GET    /.netlify/functions/sequences                                — list all sequences
 * GET    /.netlify/functions/sequences?id=X                           — get single sequence with enrollment stats
 * POST   /.netlify/functions/sequences                                — create new sequence
 * PUT    /.netlify/functions/sequences?id=X                           — update sequence
 * DELETE /.netlify/functions/sequences?id=X                           — soft-delete (set active: false)
 *
 * POST   /.netlify/functions/sequences?action=enroll                  — enroll leads { sequence_id, lead_ids[] }
 * POST   /.netlify/functions/sequences?action=unenroll                — { enrollment_ids[] }
 * GET    /.netlify/functions/sequences?action=enrollments&sequence_id=X — get enrollments for a sequence
 * POST   /.netlify/functions/sequences?action=pause                   — { enrollment_id }
 * POST   /.netlify/functions/sequences?action=resume                  — { enrollment_id }
 * POST   /.netlify/functions/sequences?action=process                 — process all due sequence steps (scheduler)
 */

const crypto = require('crypto');
const { getDb, serverTimestamp } = require('./shared/firestore');
const { requireAuth } = require('./shared/auth');
const { jsonResponse, optionsResponse, buildUnsubscribeUrl } = require('./shared/utils');
const { sendSingleViaResend } = require('./shared/resend-service');
const { detectLeadCountry } = require('./shared/country-detect');
const { prepareTrackedEmail } = require('./shared/email-tracking');
const { createSequenceSyncPost } = require('./shared/social-sync');
const { checkDailySendLimit } = require('./shared/send-limiter');
const { resolveCohortForLead, buildScheduleUrl } = require('./shared/cohort-resolver');

const TOKEN_SECRET = process.env.UNSUBSCRIBE_SECRET || 'yb-appt-secret';

// Form ID → language map (same as facebook-leads-webhook.js)
// The old webhook defaulted ALL leads to lang='da', so this is the only
// reliable way to determine language for Meta form leads
const FORM_LANG_MAP = {
  '827004866473769':  'en',     // july-vinyasa-plus-en (UK)
  '25716246641411656':'en',     // july-vinyasa-plus-no
  '4318151781759438': 'en',     // july-vinyasa-plus-se
  '2450631555377690': 'de',     // july-vinyasa-plus-de
  '1668412377638315': 'en',     // july-vinyasa-plus-fi
  '960877763097239':  'en',     // july-vinyasa-plus-nl
  '1344364364192542': 'da',     // july-vinyasa-plus-dk
  '961808297026346':  'da'      // july 4w intensive dk (second form)
};

const SEQUENCES_COL = 'sequences';
const ENROLLMENTS_COL = 'sequence_enrollments';
const ALLOWED_FIELDS = ['name', 'description', 'active', 'trigger', 'exit_conditions', 'steps', 'enrollment_closes'];
const BROADCAST_SEQUENCE_ID = 'Ma2caW2hiQqtkPFesK27';
// July International Conversion — looked up by name on first use
var JULY_INTL_SEQUENCE_ID = null;
// Educational sequence ID — looked up by name on first use
var EDUCATIONAL_SEQUENCE_ID = null;
const GATEWAYAPI_ENDPOINT = 'https://gatewayapi.eu/rest/mtsms';

// ── Handler ─────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  const params = event.queryStringParameters || {};
  const action = params.action || null;

  // The process action supports internal secret auth (for scheduler/agent)
  if (action === 'process') {
    const internalSecret = event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'] || '';
    if (internalSecret && internalSecret === process.env.AI_INTERNAL_SECRET) {
      // Authenticated via internal secret — proceed
    } else {
      const user = await requireAuth(event, ['admin']);
      if (user.error) return user.error;
    }
    return handleProcess();
  }

  // All other endpoints require admin auth
  const user = await requireAuth(event, ['admin']);
  if (user.error) return user.error;

  const db = getDb();

  try {
    // Action-based routes (POST with ?action=)
    if (action) {
      if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
        return jsonResponse(405, { ok: false, error: 'Method not allowed' });
      }

      switch (action) {
        case 'enroll':
          return handleEnroll(db, event);
        case 'unenroll':
          return handleUnenroll(db, event);
        case 'enrollments':
          return handleGetEnrollments(db, params);
        case 'pause':
          return handlePauseResume(db, event, 'paused');
        case 'resume':
          return handlePauseResume(db, event, 'active');
        default:
          return jsonResponse(400, { ok: false, error: 'Unknown action: ' + action });
      }
    }

    // CRUD routes
    switch (event.httpMethod) {
      case 'GET':
        return params.id ? getOne(db, params.id) : getAll(db);
      case 'POST':
        return create(db, event);
      case 'PUT':
        return update(db, event, params);
      case 'DELETE':
        return softDelete(db, params);
      default:
        return jsonResponse(405, { ok: false, error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('[sequences] Error:', error);
    return jsonResponse(500, { ok: false, error: error.message });
  }
};

// =========================================================================
// CRUD — Sequences
// =========================================================================

async function getAll(db) {
  const snapshot = await db.collection(SEQUENCES_COL).orderBy('created_at', 'desc').get();
  const sequences = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  // Fetch all enrollments in one query and aggregate stats per sequence
  const enrollSnap = await db.collection(ENROLLMENTS_COL).get();
  var statsMap = {};
  enrollSnap.docs.forEach(d => {
    var data = d.data();
    var seqId = data.sequence_id;
    if (!seqId) return;
    if (!statsMap[seqId]) statsMap[seqId] = { total: 0, active: 0, paused: 0, completed: 0, exited: 0 };
    statsMap[seqId].total++;
    var status = data.status || 'active';
    if (statsMap[seqId][status] !== undefined) statsMap[seqId][status]++;
  });

  for (var i = 0; i < sequences.length; i++) {
    sequences[i].enrollment_stats = statsMap[sequences[i].id] || { total: 0, active: 0, paused: 0, completed: 0, exited: 0 };
  }

  return jsonResponse(200, { ok: true, sequences, count: sequences.length });
}

async function getOne(db, id) {
  const doc = await db.collection(SEQUENCES_COL).doc(id).get();
  if (!doc.exists) {
    return jsonResponse(404, { ok: false, error: 'Sequence not found' });
  }

  const sequence = { id: doc.id, ...doc.data() };

  // Fetch enrollment stats
  const enrollSnap = await db.collection(ENROLLMENTS_COL)
    .where('sequence_id', '==', id)
    .get();

  var stats = { total: 0, active: 0, paused: 0, completed: 0, exited: 0 };
  enrollSnap.docs.forEach(d => {
    stats.total++;
    var status = d.data().status || 'active';
    if (stats[status] !== undefined) stats[status]++;
  });

  sequence.enrollment_stats = stats;

  return jsonResponse(200, { ok: true, sequence });
}

async function create(db, event) {
  const payload = JSON.parse(event.body || '{}');

  if (!payload.name) {
    return jsonResponse(400, { ok: false, error: 'name is required' });
  }
  if (!payload.steps || !Array.isArray(payload.steps) || payload.steps.length === 0) {
    return jsonResponse(400, { ok: false, error: 'steps array is required and must not be empty' });
  }

  var data = {};
  for (var i = 0; i < ALLOWED_FIELDS.length; i++) {
    var field = ALLOWED_FIELDS[i];
    if (payload[field] !== undefined) data[field] = payload[field];
  }

  // Defaults
  if (data.active === undefined) data.active = true;
  if (!data.trigger) data.trigger = { type: 'manual', conditions: {} };
  if (!data.exit_conditions) data.exit_conditions = ['converted', 'unsubscribed', 'lost'];

  data.created_at = serverTimestamp();
  data.updated_at = serverTimestamp();

  const ref = await db.collection(SEQUENCES_COL).add(data);
  return jsonResponse(201, { ok: true, id: ref.id });
}

async function update(db, event, params) {
  if (!params.id) {
    return jsonResponse(400, { ok: false, error: 'id query parameter is required' });
  }

  const doc = await db.collection(SEQUENCES_COL).doc(params.id).get();
  if (!doc.exists) {
    return jsonResponse(404, { ok: false, error: 'Sequence not found' });
  }

  const payload = JSON.parse(event.body || '{}');

  var data = {};
  for (var i = 0; i < ALLOWED_FIELDS.length; i++) {
    var field = ALLOWED_FIELDS[i];
    if (payload[field] !== undefined) data[field] = payload[field];
  }

  data.updated_at = serverTimestamp();

  await db.collection(SEQUENCES_COL).doc(params.id).update(data);
  return jsonResponse(200, { ok: true, id: params.id });
}

async function softDelete(db, params) {
  if (!params.id) {
    return jsonResponse(400, { ok: false, error: 'id query parameter is required' });
  }

  const doc = await db.collection(SEQUENCES_COL).doc(params.id).get();
  if (!doc.exists) {
    return jsonResponse(404, { ok: false, error: 'Sequence not found' });
  }

  await db.collection(SEQUENCES_COL).doc(params.id).update({
    active: false,
    updated_at: serverTimestamp()
  });

  return jsonResponse(200, { ok: true, id: params.id, message: 'Sequence deactivated' });
}

// =========================================================================
// Enrollment Actions
// =========================================================================

async function handleEnroll(db, event) {
  const payload = JSON.parse(event.body || '{}');

  if (!payload.sequence_id) {
    return jsonResponse(400, { ok: false, error: 'sequence_id is required' });
  }
  if (!payload.lead_ids || !Array.isArray(payload.lead_ids) || payload.lead_ids.length === 0) {
    return jsonResponse(400, { ok: false, error: 'lead_ids array is required' });
  }

  // Load the sequence
  const seqDoc = await db.collection(SEQUENCES_COL).doc(payload.sequence_id).get();
  if (!seqDoc.exists) {
    return jsonResponse(404, { ok: false, error: 'Sequence not found' });
  }

  const sequence = seqDoc.data();
  if (!sequence.active) {
    return jsonResponse(400, { ok: false, error: 'Cannot enroll into an inactive sequence' });
  }

  var enrolled = [];
  var errors = [];
  var now = new Date().toISOString();

  // Calculate first step send time (returns Date object for Firestore Timestamp)
  var firstStep = sequence.steps && sequence.steps[0];
  var nextSendAt = calculateNextSendAt(now, firstStep);

  for (var i = 0; i < payload.lead_ids.length; i++) {
    var leadId = payload.lead_ids[i];
    try {
      // Load lead info
      var leadDoc = await db.collection('leads').doc(leadId).get();
      if (!leadDoc.exists) {
        errors.push({ lead_id: leadId, error: 'Lead not found' });
        continue;
      }

      var lead = leadDoc.data();

      // Check if already enrolled in this sequence (any status — prevents re-enrollment)
      var enrollDocId = payload.sequence_id + '_' + leadId;
      var existingSnap = await db.collection(ENROLLMENTS_COL)
        .where('sequence_id', '==', payload.sequence_id)
        .where('lead_id', '==', leadId)
        .limit(1)
        .get();

      if (!existingSnap.empty) {
        errors.push({ lead_id: leadId, error: 'Already enrolled in this sequence' });
        continue;
      }

      var enrollData = {
        sequence_id: payload.sequence_id,
        sequence_name: sequence.name || '',
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
        trigger: 'manual',
        created_at: serverTimestamp()
      };

      await db.collection(ENROLLMENTS_COL).doc(enrollDocId).set(enrollData);
      enrolled.push({ lead_id: leadId, enrollment_id: enrollDocId });
    } catch (err) {
      console.error('[sequences] Enroll error for lead ' + leadId + ':', err.message);
      errors.push({ lead_id: leadId, error: err.message });
    }
  }

  return jsonResponse(200, { ok: true, enrolled, errors, count: enrolled.length });
}

async function handleUnenroll(db, event) {
  const payload = JSON.parse(event.body || '{}');

  if (!payload.enrollment_ids || !Array.isArray(payload.enrollment_ids) || payload.enrollment_ids.length === 0) {
    return jsonResponse(400, { ok: false, error: 'enrollment_ids array is required' });
  }

  var unenrolled = [];
  var errors = [];

  for (var i = 0; i < payload.enrollment_ids.length; i++) {
    var enrollId = payload.enrollment_ids[i];
    try {
      var doc = await db.collection(ENROLLMENTS_COL).doc(enrollId).get();
      if (!doc.exists) {
        errors.push({ enrollment_id: enrollId, error: 'Enrollment not found' });
        continue;
      }

      await db.collection(ENROLLMENTS_COL).doc(enrollId).update({
        status: 'exited',
        exit_reason: 'Manual unenrollment',
        updated_at: new Date().toISOString()
      });

      unenrolled.push(enrollId);
    } catch (err) {
      errors.push({ enrollment_id: enrollId, error: err.message });
    }
  }

  return jsonResponse(200, { ok: true, unenrolled, errors, count: unenrolled.length });
}

async function handleGetEnrollments(db, params) {
  // Support ?all=true for fetching enrollments across all sequences (nurture dashboard)
  if (!params.sequence_id && !params.all) {
    return jsonResponse(400, { ok: false, error: 'sequence_id query parameter is required (or use all=true)' });
  }

  var query = db.collection(ENROLLMENTS_COL);

  if (params.sequence_id) {
    query = query.where('sequence_id', '==', params.sequence_id);
  }

  if (params.status) {
    query = query.where('status', '==', params.status);
  }

  const snapshot = await query.get();
  const enrollments = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  return jsonResponse(200, { ok: true, enrollments, count: enrollments.length });
}

async function handlePauseResume(db, event, newStatus) {
  const payload = JSON.parse(event.body || '{}');

  if (!payload.enrollment_id) {
    return jsonResponse(400, { ok: false, error: 'enrollment_id is required' });
  }

  const doc = await db.collection(ENROLLMENTS_COL).doc(payload.enrollment_id).get();
  if (!doc.exists) {
    return jsonResponse(404, { ok: false, error: 'Enrollment not found' });
  }

  var enrollment = doc.data();

  // Validate state transitions
  if (newStatus === 'paused' && enrollment.status !== 'active') {
    return jsonResponse(400, { ok: false, error: 'Can only pause active enrollments' });
  }
  if (newStatus === 'active' && enrollment.status !== 'paused') {
    return jsonResponse(400, { ok: false, error: 'Can only resume paused enrollments' });
  }

  var updateData = {
    status: newStatus,
    updated_at: new Date().toISOString()
  };

  // When resuming, recalculate next_send_at from now
  if (newStatus === 'active') {
    var seqDoc = await db.collection(SEQUENCES_COL).doc(enrollment.sequence_id).get();
    if (seqDoc.exists) {
      var sequence = seqDoc.data();
      var currentStepIndex = (enrollment.current_step || 1) - 1;
      var step = sequence.steps && sequence.steps[currentStepIndex];
      updateData.next_send_at = calculateNextSendAt(new Date(), step);
    }
  }

  await db.collection(ENROLLMENTS_COL).doc(payload.enrollment_id).update(updateData);

  return jsonResponse(200, { ok: true, enrollment_id: payload.enrollment_id, status: newStatus });
}

// =========================================================================
// Process — Execute Due Steps
// =========================================================================

// Exported for direct invocation by process-sequences (avoids HTTP hop + timeout)
exports.handleProcess = handleProcess;

async function handleProcess() {
  const db = getDb();
  var nowDate = new Date();
  var now = nowDate.toISOString();
  var processed = 0;
  var errors = [];
  var sentSummary = []; // Track sent items for digest email
  var invocationId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');

  try {
    // Resolve July International sequence ID (for completion → educational chaining)
    await resolveJulyIntlSequenceId(db);

    // Find all active enrollments that are due
    // IMPORTANT: Use Date object (not ISO string) for the query so Firestore
    // matches Timestamp fields. sequence-trigger.js and fix scripts store
    // next_send_at as Date objects (→ Firestore Timestamps).
    const snapshot = await db.collection(ENROLLMENTS_COL)
      .where('status', '==', 'active')
      .where('next_send_at', '<=', nowDate)
      .get();

    if (snapshot.empty) {
      return jsonResponse(200, { ok: true, processed: 0, errors: [] });
    }

    // Cache sequences to avoid repeated lookups
    var sequenceCache = {};

    for (var i = 0; i < snapshot.docs.length; i++) {
      var enrollDoc = snapshot.docs[i];
      var enrollment = enrollDoc.data();
      var enrollId = enrollDoc.id;

      try {
        // ── Atomic claim: prevent concurrent processors from picking up the same enrollment ──
        // Uses a Firestore transaction to verify the enrollment is still due and claim it
        // by bumping next_send_at to a future time. If another processor already claimed it,
        // the transaction will see the updated next_send_at and skip.
        var LOCK_DURATION_MS = 30 * 60 * 1000; // 30 minutes
        var claimed = false;
        try {
          await db.runTransaction(async function (txn) {
            var freshRef = db.collection(ENROLLMENTS_COL).doc(enrollId);
            var freshDoc = await txn.get(freshRef);
            if (!freshDoc.exists) throw new Error('not_found');
            var fresh = freshDoc.data();

            // Verify still active and still due
            if (fresh.status !== 'active') throw new Error('not_active');
            var freshNext = fresh.next_send_at;
            if (freshNext && freshNext.toDate) freshNext = freshNext.toDate();
            else if (typeof freshNext === 'string') freshNext = new Date(freshNext);
            if (!freshNext || freshNext > nowDate) throw new Error('not_due');

            // Claim: bump next_send_at so other processors skip this enrollment
            txn.update(freshRef, {
              next_send_at: new Date(Date.now() + LOCK_DURATION_MS),
              processing_lock: { invocation_id: invocationId, locked_at: new Date() }
            });
          });
          claimed = true;
        } catch (claimErr) {
          // Another processor already claimed this, or it's no longer due
          if (!['not_found', 'not_active', 'not_due'].includes(claimErr.message)) {
            console.log('[sequences] Claim failed for ' + enrollId + ': ' + claimErr.message);
          }
          continue;
        }
        if (!claimed) continue;
        // Load sequence (cached)
        var seqId = enrollment.sequence_id;
        if (!sequenceCache[seqId]) {
          var seqDoc = await db.collection(SEQUENCES_COL).doc(seqId).get();
          if (!seqDoc.exists) {
            errors.push({ enrollment_id: enrollId, error: 'Sequence not found: ' + seqId });
            continue;
          }
          sequenceCache[seqId] = seqDoc.data();
        }

        var sequence = sequenceCache[seqId];

        // Check if sequence is still active
        if (!sequence.active) {
          await db.collection(ENROLLMENTS_COL).doc(enrollId).update({
            status: 'exited',
            exit_reason: 'Sequence deactivated',
            updated_at: now
          });
          continue;
        }

        // Load lead
        var leadDoc = await db.collection('leads').doc(enrollment.lead_id).get();
        if (!leadDoc.exists) {
          errors.push({ enrollment_id: enrollId, error: 'Lead not found: ' + enrollment.lead_id });
          await db.collection(ENROLLMENTS_COL).doc(enrollId).update({
            status: 'exited',
            exit_reason: 'Lead not found',
            updated_at: now
          });
          continue;
        }

        var lead = leadDoc.data();

        // Skip bounced emails — exit enrollment to stop wasting sends
        if (lead.email_bounced) {
          await db.collection(ENROLLMENTS_COL).doc(enrollId).update({
            status: 'exited',
            exit_reason: 'Email bounced',
            updated_at: now
          });
          console.log('[sequences] Skipping bounced lead ' + enrollment.lead_id);
          continue;
        }

        // Check exit conditions
        if (sequence.exit_conditions && Array.isArray(sequence.exit_conditions)) {
          var leadStatus = (lead.status || '').toLowerCase();
          var shouldExit = false;
          var exitReason = null;

          for (var e = 0; e < sequence.exit_conditions.length; e++) {
            var condition = sequence.exit_conditions[e].toLowerCase();
            if (condition === 'converted' && (lead.converted === true || lead.converted === 'true' || leadStatus === 'converted')) {
              shouldExit = true;
              exitReason = 'Lead converted';
              break;
            }
            if (condition === 'unsubscribed' && (lead.unsubscribed === true || leadStatus === 'unsubscribed')) {
              shouldExit = true;
              exitReason = 'Lead unsubscribed';
              break;
            }
            if (condition === 'lost' && leadStatus === 'lost') {
              shouldExit = true;
              exitReason = 'Lead lost';
              break;
            }
            if (leadStatus === condition) {
              shouldExit = true;
              exitReason = 'Lead status: ' + lead.status;
              break;
            }
          }

          if (shouldExit) {
            await db.collection(ENROLLMENTS_COL).doc(enrollId).update({
              status: 'exited',
              exit_reason: exitReason,
              updated_at: now
            });
            continue;
          }
        }

        // Get current step
        var stepIndex = (enrollment.current_step || 1) - 1;
        var step = sequence.steps && sequence.steps[stepIndex];

        if (!step) {
          // No more steps — mark completed
          await db.collection(ENROLLMENTS_COL).doc(enrollId).update({
            status: 'completed',
            updated_at: now
          });
          processed++;
          continue;
        }

        // Check step condition (e.g., "status:New")
        if (step.condition) {
          var condParts = step.condition.split(':');
          if (condParts.length === 2) {
            var condField = condParts[0].trim();
            var condValue = condParts[1].trim();
            var leadValue = lead[condField] || '';

            if (String(leadValue).toLowerCase() !== condValue.toLowerCase()) {
              // Condition not met — skip this step, advance to next
              var nextStepNum = (enrollment.current_step || 1) + 1;
              if (nextStepNum > sequence.steps.length) {
                await db.collection(ENROLLMENTS_COL).doc(enrollId).update({
                  status: 'completed',
                  updated_at: now
                });
              } else {
                var nextStep = sequence.steps[nextStepNum - 1];
                await db.collection(ENROLLMENTS_COL).doc(enrollId).update({
                  current_step: nextStepNum,
                  next_send_at: calculateNextSendAt(now, nextStep),
                  updated_at: now
                });
              }
              processed++;
              continue;
            }
          }
        }

        // Frequency throttle: check if lead received an email in the last 48 hours
        // Uses Date object (not ISO string) to match Firestore Timestamp format
        // used by lead-emails.js, email-service.js, and other senders.
        // Sequences with skip_throttle: true bypass this check (e.g., quick follow-ups
        // that are designed to arrive shortly after signup).
        if (!sequence.skip_throttle && (step.channel === 'email' || step.channel === 'both')) {
          var throttleCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
          var recentEmailSnap = await db.collection('email_log')
            .where('lead_id', '==', enrollment.lead_id)
            .where('sent_at', '>=', throttleCutoff)
            .where('status', '==', 'sent')
            .limit(1)
            .get();

          if (!recentEmailSnap.empty) {
            // Postpone this step by 24 hours
            await db.collection(ENROLLMENTS_COL).doc(enrollId).update({
              next_send_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
              updated_at: now
            });
            console.log('[sequences] Throttled step for lead ' + enrollment.lead_id + ' — recent email within 48h');
            continue;
          }
        }

        var stepHistory = { step: enrollment.current_step, sent_at: now, channel: step.channel, result: 'skipped' };
        var emailSent = false;
        var smsSent = false;

        // Language branching — simple two-source logic:
        //   1. Meta leads: FORM_LANG_MAP determines language from form_id
        //   2. Website leads: lang field (set by /en/ path detection) determines language
        //   3. Default: Danish

        var formLang = FORM_LANG_MAP[lead.meta_form_id];
        var rawLang = formLang || (lead.lang || lead.meta_lang || lead.language || 'da').toLowerCase().trim();
        var leadLang = rawLang.substring(0, 2);
        var isDanish = ['da', 'dk'].includes(leadLang);
        var isGerman = leadLang === 'de';

        // Substitute template variables (after lang detection so unsubscribe URL is lang-aware)
        var vars = {
          '{{first_name}}': lead.first_name || '',
          '{{last_name}}': lead.last_name || '',
          '{{email}}': lead.email || '',
          '{{phone}}': lead.phone || '',
          '{{program}}': lead.program || lead.ytt_program_type || '',
          '{{unsubscribe_url}}': buildUnsubscribeUrl(lead.email || '', leadLang)
        };

        // Dynamic-cohort steps (Personal Outreach): resolve the nearest open
        // cohort for this lead. If none, mark enrollment complete and skip.
        var cohortContext = null;
        if (step.content_type === 'dynamic') {
          cohortContext = await resolveCohortForLead(lead);
          if (!cohortContext) {
            await db.collection(ENROLLMENTS_COL).doc(enrollId).update({
              status: 'completed',
              completed_at: new Date(),
              exit_reason: 'no_active_cohort',
              processing_lock: null,
              updated_at: now
            });
            console.log('[sequences] No active cohort for lead ' + enrollment.lead_id + ' — completing enrollment ' + enrollId);
            processed++;
            continue;
          }
        }

        // Schedule-view-aware variant selection (Personal Outreach Step 2).
        // Pick the "_viewed" variant when the lead viewed any schedule page
        // after the previous email in this enrollment was sent.
        var useViewedVariant = false;
        if (step.schedule_view_aware === true) {
          var prevSentAt = enrollment.last_email_sent_at;
          var prevSentDate = prevSentAt && prevSentAt.toDate ? prevSentAt.toDate()
            : (prevSentAt ? new Date(prevSentAt) : null);
          if (prevSentDate) {
            try {
              var leadDocSnap = await db.collection('leads').doc(enrollment.lead_id).get();
              var schedEng = (leadDocSnap.exists && leadDocSnap.data().schedule_engagement) || {};
              var pageMap = schedEng.pages || {};
              for (var slug in pageMap) {
                var lv = pageMap[slug] && pageMap[slug].last_visit;
                var lvDate = lv && lv.toDate ? lv.toDate() : (lv ? new Date(lv) : null);
                if (lvDate && lvDate > prevSentDate) {
                  useViewedVariant = true;
                  break;
                }
              }
            } catch (svErr) {
              console.warn('[sequences] schedule_engagement lookup failed for lead ' + enrollment.lead_id + ':', svErr.message);
            }
          }
        }

        // Select language-appropriate email content.
        // For schedule-view-aware steps the field name carries an extra
        // "_viewed" suffix when the lead has already viewed the schedule.
        var selectedSubject, selectedBody;
        var langSuffix = isGerman ? '_de' : (isDanish ? '' : '_en');
        var variantSuffix = useViewedVariant ? '_viewed' : '';

        if (step.schedule_view_aware === true) {
          selectedSubject = step['email_subject' + variantSuffix + langSuffix];
          selectedBody = step['email_body' + variantSuffix + langSuffix];
          // Fall back across language and variant combinations if a particular
          // pair is missing — variant first, then language.
          if (!selectedSubject) {
            selectedSubject = step['email_subject' + langSuffix] || step['email_subject' + variantSuffix] || step.email_subject;
            selectedBody = step['email_body' + langSuffix] || step['email_body' + variantSuffix] || step.email_body || selectedBody;
          }
        } else if (isGerman && step.email_subject_de) {
          selectedSubject = step.email_subject_de;
          selectedBody = step.email_body_de || step.email_body_en || step.email_body;
        } else if (!isDanish) {
          selectedSubject = step.email_subject_en || step.email_subject;
          selectedBody = step.email_body_en || step.email_body;
        } else {
          selectedSubject = step.email_subject;
          selectedBody = step.email_body;
        }

        // Fallback: if DA content is null (e.g. international-only sequences),
        // use EN content. This catches leads with wrong lang='da' enrolled in
        // sequences that only have EN content.
        if (!selectedSubject && step.email_subject_en) {
          selectedSubject = step.email_subject_en;
          selectedBody = step.email_body_en || selectedBody;
        }

        // Replace {{country_block}} with country-specific content (EN emails only)
        // German and Danish leads never see country blocks — their content is baked in
        if (selectedBody && selectedBody.includes('{{country_block}}')) {
          if (!isDanish && !isGerman && step.country_blocks) {
            var detectedCountry = detectLeadCountry(lead);
            var countryCode = (!detectedCountry || detectedCountry === 'OTHER' || detectedCountry === 'DK') ? 'UK' : detectedCountry;
            var block = step.country_blocks[countryCode] || step.country_blocks['UK'] || '';
            selectedBody = selectedBody.replace('{{country_block}}', block);
          } else {
            // DA/DE emails or no country_blocks — remove placeholder
            selectedBody = selectedBody.replace('{{country_block}}', '');
          }
        }

        // Inject cohort variables for dynamic steps. injectScheduleTokens (later)
        // will tokenise the {{schedule_url}} value since it points at /skema/*
        // or /en/schedule/* — the same URL shapes it matches.
        if (cohortContext) {
          var c = cohortContext.cohort;
          var pickDa = isDanish;
          var pick = function (da, en) { return (pickDa ? da : en) || en || da || ''; };
          vars['{{cohort_name}}'] = pick(c.name_da, c.name_en);
          vars['{{cohort_label}}'] = pick(c.cohort_label_da, c.cohort_label_en);
          vars['{{method}}'] = pick(c.method_da, c.method_en);
          vars['{{schedule_url}}'] = buildScheduleUrl(c, pickDa ? 'da' : 'en');
          vars['{{checkout_url}}'] = c.checkout_url || '';
          vars['{{prep_phase_price}}'] = pick(c.prep_phase_price_da, c.prep_phase_price_en);
          vars['{{full_price}}'] = pick(c.full_price_da, c.full_price_en);
          vars['{{start_date}}'] = pick(c.start_date_formatted_da, c.start_date_formatted_en);
        }

        // Check if step has sendable content — don't advance past empty steps
        var wantsEmail = (step.channel === 'email' || step.channel === 'both');
        var wantsSms = (step.channel === 'sms' || step.channel === 'both');
        var hasEmailContent = !!(selectedSubject && selectedBody);
        var hasSmsContent = !!step.sms_message;

        if ((wantsEmail && !hasEmailContent) && (wantsSms && !hasSmsContent)) {
          // Step has no sendable content at all — hold here, don't advance
          console.log('[sequences] Step ' + enrollment.current_step + ' for enrollment ' + enrollId + ' has no content — holding');
          continue;
        }
        if (wantsEmail && !wantsSms && !hasEmailContent) {
          // Email-only step with no email content — hold
          console.log('[sequences] Step ' + enrollment.current_step + ' for enrollment ' + enrollId + ' is email-only but email_body is empty — holding');
          continue;
        }
        if (wantsSms && !wantsEmail && !hasSmsContent) {
          // SMS-only step with no SMS content — hold
          console.log('[sequences] Step ' + enrollment.current_step + ' for enrollment ' + enrollId + ' is sms-only but sms_message is empty — holding');
          continue;
        }

        // Per-recipient daily send limit — prevent runaway sends
        if (wantsEmail && lead.email) {
          var underLimit = await checkDailySendLimit(lead.email, 'email', 8);
          if (!underLimit) {
            console.log('[sequences] Daily email limit reached for ' + lead.email + ' — skipping');
            // Reset next_send_at to retry tomorrow
            await db.collection(ENROLLMENTS_COL).doc(enrollId).update({
              next_send_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
              processing_lock: null,
              updated_at: now
            });
            continue;
          }
        }

        // Send email
        if (wantsEmail) {
          if (lead.email && hasEmailContent) {
            // ── Already-sent guard ──────────────────────────────────────
            // If email was already sent for this exact step (e.g. previous
            // run sent the email but the Firestore enrollment update failed),
            // skip re-sending to prevent duplicate emails.
            var stepTemplateId = 'sequence:' + seqId + ':step' + enrollment.current_step;
            var alreadySentSnap = await db.collection('email_log')
              .where('lead_id', '==', enrollment.lead_id)
              .where('template_id', '==', stepTemplateId)
              .where('status', 'in', ['sent', 'pending'])
              .limit(1)
              .get();

            if (!alreadySentSnap.empty) {
              console.log('[sequences] Step ' + enrollment.current_step + ' already sent for lead ' + enrollment.lead_id + ' (found in email_log) — skipping re-send');
              emailSent = true;
              stepHistory.result = 'already_sent';
            } else {
            // Inject schedule tracking tokens into any schedule URLs in the body
            var finalBody = injectScheduleTokens(
              substituteVars(selectedBody, vars),
              enrollment.lead_id,
              lead.email
            );
            // Inject email engagement tracking (pixel + link wrapping)
            var sourceTag = 'seq:' + seqId + ':' + enrollment.current_step;
            finalBody = prepareTrackedEmail(finalBody, enrollment.lead_id, sourceTag);

            var emailResult = await sendSequenceEmail(
              lead.email,
              substituteVars(selectedSubject, vars),
              finalBody,
              leadLang
            );

            if (emailResult.success) {
              emailSent = true;
            } else {
              stepHistory.result = 'email_failed';
              stepHistory.error = emailResult.error;
            }

            // Log to email_log — use new Date() to match Timestamp format
            // used by lead-emails.js, email-service.js, etc.
            var emailLogEntry = {
              lead_id: enrollment.lead_id,
              to: lead.email,
              subject: substituteVars(selectedSubject, vars),
              template_id: 'sequence:' + seqId + ':step' + enrollment.current_step,
              sent_at: new Date(),
              status: emailResult.success ? 'sent' : 'failed',
              source: 'sequence',
              sequence_id: seqId,
              lang: isDanish ? 'da' : leadLang,
              created_at: serverTimestamp()
            };
            if (cohortContext) {
              emailLogEntry.cohort_id = cohortContext.cohort.id || cohortContext.cohort._docId;
              emailLogEntry.urgency = cohortContext.isUrgent ? 'urgent' : 'normal';
            }
            if (step.schedule_view_aware === true) {
              emailLogEntry.variant = useViewedVariant ? 'viewed' : 'not_viewed';
            }
            await db.collection('email_log').add(emailLogEntry);
            } // end else (not already sent)
          }
        }

        // ── SMS DISABLED in sequences ─────────────────────────────────────
        // All sequence SMS is disabled. Only the welcome SMS (sent by
        // sms-service.js on lead creation) is allowed. Sequence steps
        // with channel 'sms' or 'both' will only send the email part.
        // To re-enable: remove this block and uncomment the SMS block below.
        if (wantsSms && !wantsEmail) {
          // SMS-only step — skip entirely, advance to next
          console.log('[sequences] SMS-only step ' + enrollment.current_step + ' for ' + enrollment.lead_id + ' — SMS disabled in sequences, skipping');
        }
        wantsSms = false;
        hasSmsContent = false;

        /* ── DISABLED: Sequence SMS sending ──────────────────────────────
        // Send SMS — with language branching (sms_message_en, sms_message_de)
        if (wantsSms) {
          var selectedSms;
          if (isGerman && step.sms_message_de) {
            selectedSms = step.sms_message_de;
          } else if (!isDanish && step.sms_message_en) {
            selectedSms = step.sms_message_en;
          } else {
            selectedSms = step.sms_message;
          }
          hasSmsContent = !!selectedSms;

          if (lead.phone && hasSmsContent) {
            // ── Already-sent guard (SMS) ────────────────────────────────
            // Same race condition as email: if SMS sent but Firestore
            // update fails, enrollment stays "due" → re-sends next cycle.
            var smsTemplateId = 'sequence:' + seqId + ':step' + enrollment.current_step;
            var alreadySentSmsSnap = await db.collection('sms_log')
              .where('lead_id', '==', enrollment.lead_id)
              .where('source', '==', 'sequence')
              .where('sequence_id', '==', seqId)
              .where('status', '==', 'sent')
              .limit(5)
              .get();

            // Check if any logged SMS matches this exact step
            var smsAlreadySent = false;
            alreadySentSmsSnap.forEach(function(doc) {
              var logData = doc.data();
              // sms_log doesn't have template_id — match by message content
              if (logData.message === substituteVars(step.sms_message, vars) ||
                  logData.message === substituteVars(selectedSms, vars)) {
                smsAlreadySent = true;
              }
            });

            if (smsAlreadySent) {
              console.log('[sequences] SMS step ' + enrollment.current_step + ' already sent for lead ' + enrollment.lead_id + ' — skipping re-send');
              smsSent = true;
              if (!stepHistory.result || stepHistory.result === 'skipped') stepHistory.result = 'already_sent';
            } else {
            var smsResult = await sendSequenceSMS(
              lead.phone,
              substituteVars(selectedSms, vars)
            );

            if (smsResult.success) {
              smsSent = true;
            } else {
              stepHistory.result = wantsEmail && emailSent ? 'sms_failed' : 'failed';
              stepHistory.sms_error = smsResult.error;
            }

            // Log to sms_log — use new Date() for consistency
            await db.collection('sms_log').add({
              lead_id: enrollment.lead_id,
              to: lead.phone,
              message: substituteVars(selectedSms, vars),
              sent_at: new Date(),
              status: smsResult.success ? 'sent' : 'failed',
              source: 'sequence',
              sequence_id: seqId,
              created_at: serverTimestamp()
            });
            } // end else (not already sent SMS)
          }
        }
        ── END DISABLED SMS block ──────────────────────────────────── */

        // Set accurate step result
        if (emailSent || smsSent) {
          stepHistory.result = 'sent';
          sentSummary.push({
            lead: enrollment.lead_name || enrollment.lead_email,
            email: lead.email,
            step: enrollment.current_step,
            sequence: enrollment.sequence_name || seqId,
            subject: hasEmailContent ? substituteVars(selectedSubject, vars) : null,
            channel: step.channel,
            emailSent: emailSent,
            smsSent: smsSent,
            lang: leadLang,
            country: (isDanish ? 'DK' : (detectLeadCountry(lead) || null)),
            origin: isDanish ? 'DK' : 'INT'
          });

          // Social sync: create matching social post for broadcast sequences (non-blocking)
          if (emailSent && sequence.name && sequence.name.toLowerCase().indexOf('broadcast') >= 0) {
            createSequenceSyncPost(seqId, enrollment.current_step,
              substituteVars(step.email_subject || step.email_subject_en || '', vars)
            ).catch(function (err) {
              console.warn('[sequences] Social sync error (non-blocking):', err.message);
            });
          }
        }

        // Advance enrollment and clear processing lock
        var nextStep = (enrollment.current_step || 1) + 1;
        var updateData = {
          current_step: nextStep,
          updated_at: now,
          step_history: [...(enrollment.step_history || []), stepHistory],
          processing_lock: null
        };

        // Track when the most recent email actually went out — Step 2 of the
        // Personal Outreach sequence reads this to decide which variant to send.
        if (emailSent) {
          updateData.last_email_sent_at = new Date();
        }

        if (nextStep > sequence.steps.length) {
          // Last step done
          updateData.status = 'completed';
          updateData.next_send_at = null;
        } else {
          var upcoming = sequence.steps[nextStep - 1];
          // Urgency override: when the resolved cohort starts in <3 days,
          // halve the delay for non-final upcoming steps so the lead hears
          // back faster. The final step (cleanup ask) keeps its full delay.
          var compress = !!(cohortContext && cohortContext.isUrgent && nextStep < sequence.steps.length);
          updateData.next_send_at = calculateNextSendAt(now, upcoming, compress);
          if (compress) updateData.urgency_applied = true;
        }

        await db.collection(ENROLLMENTS_COL).doc(enrollId).update(updateData);
        processed++;

        // Auto-enroll in educational sequence when broadcast or July International completes
        if (updateData.status === 'completed') {
          var shouldEnrollEducational = seqId === BROADCAST_SEQUENCE_ID || isJulyInternationalSequence(seqId);
          if (shouldEnrollEducational) {
            try {
              await enrollInEducationalSequence(db, enrollment.lead_id, lead, now);
            } catch (eduErr) {
              console.error('[sequences] Educational auto-enroll error for lead ' + enrollment.lead_id + ':', eduErr.message);
            }
          }
        }

      } catch (enrollErr) {
        console.error('[sequences] Process error for enrollment ' + enrollId + ':', enrollErr.message);
        errors.push({ enrollment_id: enrollId, error: enrollErr.message });
      }
    }

    // Send single digest email to admin if anything was sent
    if (sentSummary.length > 0) {
      try {
        await sendProcessingDigest(sentSummary, errors);
      } catch (digestErr) {
        console.error('[sequences] Digest email error:', digestErr.message);
      }
    }

    return jsonResponse(200, { ok: true, processed, errors });

  } catch (error) {
    console.error('[sequences] Process error:', error);
    return jsonResponse(500, { ok: false, error: error.message });
  }
}

// =========================================================================
// Helpers
// =========================================================================

/**
 * Check if a sequence ID is the July International Conversion sequence.
 * Looks up by name on first call and caches the ID.
 */
function isJulyInternationalSequence(seqId) {
  // If already resolved, compare directly
  if (JULY_INTL_SEQUENCE_ID) return seqId === JULY_INTL_SEQUENCE_ID;
  // Not yet resolved — will be resolved lazily below
  return false;
}

/**
 * Resolve the July International sequence ID from Firestore (called once).
 */
async function resolveJulyIntlSequenceId(db) {
  if (JULY_INTL_SEQUENCE_ID) return;
  try {
    var snap = await db.collection(SEQUENCES_COL)
      .where('name', '==', 'July Vinyasa Plus — International Conversion 2026')
      .where('active', '==', true)
      .limit(1)
      .get();
    if (!snap.empty) {
      JULY_INTL_SEQUENCE_ID = snap.docs[0].id;
    }
  } catch (e) {
    // Silently ignore — sequence may not exist yet
  }
}

/**
 * Auto-enroll a lead into the educational nurture sequence after broadcast completion.
 * Checks: educational sequence exists + is active, lead not already enrolled, exit conditions.
 */
async function enrollInEducationalSequence(db, leadId, lead, now) {
  if (!EDUCATIONAL_SEQUENCE_ID) {
    // Educational sequence not yet created — look it up by name
    var eduSnap = await db.collection(SEQUENCES_COL)
      .where('name', '==', 'YTT Educational Nurture — 2026')
      .where('active', '==', true)
      .limit(1)
      .get();

    if (eduSnap.empty) {
      console.log('[sequences] Educational sequence not found or not active — skipping auto-enroll');
      return;
    }
    EDUCATIONAL_SEQUENCE_ID = eduSnap.docs[0].id;
  }

  // Load the educational sequence
  var seqDoc = await db.collection(SEQUENCES_COL).doc(EDUCATIONAL_SEQUENCE_ID).get();
  if (!seqDoc.exists || !seqDoc.data().active) {
    console.log('[sequences] Educational sequence not active — skipping');
    return;
  }

  var sequence = seqDoc.data();

  // Check exit conditions before enrolling
  var leadStatus = (lead.status || '').toLowerCase();
  var exitConditions = sequence.exit_conditions || [];
  for (var i = 0; i < exitConditions.length; i++) {
    var condition = exitConditions[i].toLowerCase();
    if (leadStatus === condition || (condition === 'converted' && lead.converted) || (condition === 'unsubscribed' && lead.unsubscribed)) {
      console.log('[sequences] Lead ' + leadId + ' has exit status "' + lead.status + '" — not enrolling in educational');
      return;
    }
  }

  // Check not already enrolled (any status — prevents re-enrollment after completion)
  var existingSnap = await db.collection(ENROLLMENTS_COL)
    .where('sequence_id', '==', EDUCATIONAL_SEQUENCE_ID)
    .where('lead_id', '==', leadId)
    .limit(1)
    .get();

  if (!existingSnap.empty) {
    console.log('[sequences] Lead ' + leadId + ' already enrolled in educational sequence');
    return;
  }

  // Calculate first step send time
  var firstStep = sequence.steps && sequence.steps[0];
  var nextSendAt = calculateNextSendAt(now, firstStep);

  var eduEnrollDocId = EDUCATIONAL_SEQUENCE_ID + '_' + leadId;
  await db.collection(ENROLLMENTS_COL).doc(eduEnrollDocId).set({
    sequence_id: EDUCATIONAL_SEQUENCE_ID,
    sequence_name: sequence.name || 'YTT Educational Nurture — 2026',
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
    trigger: 'broadcast_completed'
  });

  console.log('[sequences] Auto-enrolled lead ' + leadId + ' into educational sequence');
}

function calculateNextSendAt(fromISO, step, urgent) {
  var date = new Date(fromISO);
  var delayDays = (step && step.delay_days) || 0;
  var delayHours = (step && step.delay_hours) || 0;
  var delayMinutes = (step && step.delay_minutes) || 0;

  // Urgency override (Personal Outreach with cohort starting <3 days):
  // halve the delay so the lead hears back faster.
  if (urgent) {
    delayDays = Math.floor(delayDays / 2);
    delayHours = Math.floor(delayHours / 2);
    delayMinutes = Math.floor(delayMinutes / 2);
  }

  // Support delay_minutes (used by seed scripts & sequence-trigger.js)
  // as well as delay_days + delay_hours (used by admin UI step builder)
  if (delayMinutes > 0 && delayDays === 0 && delayHours === 0) {
    date = new Date(date.getTime() + delayMinutes * 60 * 1000);
  } else {
    date.setDate(date.getDate() + delayDays);
    date.setHours(date.getHours() + delayHours);
  }

  // Return Date object so Firestore stores it as a Timestamp.
  // The processor query uses a Date object for comparison — types must match.
  return date;
}

function generateScheduleToken(leadId, email) {
  var hmac = crypto.createHmac('sha256', TOKEN_SECRET);
  hmac.update(leadId + ':' + (email || '').toLowerCase().trim());
  return hmac.digest('hex');
}

/**
 * Inject schedule tracking tokens into any yogabible.dk schedule URLs in the email body.
 * Matches: yogabible.dk/skema/*, yogabible.dk/en/schedule/*, yogabible.dk/tidsplan/*
 * Adds ?tid=LEAD_ID&tok=TOKEN (or &tid=&tok= if URL already has query params).
 */
function injectScheduleTokens(html, leadId, email) {
  if (!html || !leadId || !email) return html;
  var token = generateScheduleToken(leadId, email);
  // Match schedule URLs on yogabible.dk (with or without www, http/https)
  // Covers: /skema/*, /en/schedule/*, /tidsplan/*
  return html.replace(
    /(https?:\/\/(?:www\.)?yogabible\.dk)(\/(?:skema|en\/schedule|tidsplan)\/[^"'<\s]*)/g,
    function (match, domain, path) {
      // Don't double-inject if tokens already present
      if (path.indexOf('tid=') !== -1 && path.indexOf('tok=') !== -1) return match;
      var sep = path.indexOf('?') !== -1 ? '&' : '?';
      return domain + path + sep + 'tid=' + encodeURIComponent(leadId) + '&tok=' + encodeURIComponent(token);
    }
  );
}

function substituteVars(template, vars) {
  var result = template || '';
  for (var key in vars) {
    result = result.split(key).join(vars[key]);
  }
  return result;
}

async function sendProcessingDigest(sentSummary, errors) {
  var rows = sentSummary.map(function(item) {
    var channels = [];
    if (item.emailSent) channels.push('Email');
    if (item.smsSent) channels.push('SMS');
    var originBadge = item.origin === 'INT'
      ? '<span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:bold;background:#1877F2;color:#fff;">INT</span>'
      : '<span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:bold;background:#34A853;color:#fff;">DK</span>';
    var countryLabel = item.country || '—';
    var langLabel = (item.lang || 'da').toUpperCase();
    return '<tr>' +
      '<td style="padding:6px 10px;border-bottom:1px solid #eee">' + (item.lead || '—') + '</td>' +
      '<td style="padding:6px 10px;border-bottom:1px solid #eee">' + (item.email || '—') + '</td>' +
      '<td style="padding:6px 10px;border-bottom:1px solid #eee">' + originBadge + ' ' + countryLabel + ' <span style="color:#999;font-size:11px;">(' + langLabel + ')</span></td>' +
      '<td style="padding:6px 10px;border-bottom:1px solid #eee">' + (item.sequence || '—') + '</td>' +
      '<td style="padding:6px 10px;border-bottom:1px solid #eee">Step ' + item.step + '</td>' +
      '<td style="padding:6px 10px;border-bottom:1px solid #eee">' + channels.join(' + ') + '</td>' +
      '<td style="padding:6px 10px;border-bottom:1px solid #eee">' + (item.subject || '—') + '</td>' +
      '</tr>';
  }).join('');

  var errorSection = '';
  if (errors.length > 0) {
    errorSection = '<h3 style="color:#c00;margin-top:20px">Errors (' + errors.length + ')</h3><ul>' +
      errors.map(function(e) { return '<li>' + e.enrollment_id + ': ' + e.error + '</li>'; }).join('') +
      '</ul>';
  }

  var html = '<h2>Sequence Processing Digest</h2>' +
    '<p>' + sentSummary.length + ' message(s) sent at ' + new Date().toLocaleString('da-DK', { timeZone: 'Europe/Copenhagen' }) + '</p>' +
    '<table style="border-collapse:collapse;width:100%;font-size:14px">' +
    '<tr style="background:#f5f3f0">' +
    '<th style="padding:8px 10px;text-align:left">Lead</th>' +
    '<th style="padding:8px 10px;text-align:left">Email</th>' +
    '<th style="padding:8px 10px;text-align:left">Origin</th>' +
    '<th style="padding:8px 10px;text-align:left">Sequence</th>' +
    '<th style="padding:8px 10px;text-align:left">Step</th>' +
    '<th style="padding:8px 10px;text-align:left">Channel</th>' +
    '<th style="padding:8px 10px;text-align:left">Subject</th>' +
    '</tr>' + rows + '</table>' + errorSection;

  await sendSingleViaResend({
    to: 'shamir@hotyogacph.dk',
    subject: 'Sequence Digest: ' + sentSummary.length + ' sent',
    bodyHtml: html,
    bodyPlain: sentSummary.length + ' messages sent'
  });
}

async function sendSequenceEmail(to, subject, bodyHtml, lang) {
  try {
    var result = await sendSingleViaResend({
      to,
      subject,
      bodyHtml,
      bodyPlain: '',
      lang: lang || 'da'
    });
    return { success: true, messageId: result.messageId };
  } catch (err) {
    console.error('[sequences] Email send error:', err.message);
    return { success: false, error: err.message };
  }
}

async function sendSequenceSMS(phone, message) {
  var token = process.env.GATEWAYAPI_TOKEN;
  if (!token) {
    return { success: false, error: 'GATEWAYAPI_TOKEN not set' };
  }

  // Normalize phone
  var clean = String(phone || '').replace(/^'/, '').replace(/\s+/g, '').replace(/[^\d+]/g, '');
  if (!clean) return { success: false, error: 'Invalid phone number' };

  if (!clean.startsWith('+')) {
    if (clean.startsWith('00')) {
      clean = '+' + clean.substring(2);
    } else if (clean.length <= 8) {
      clean = '+45' + clean;
    } else {
      clean = '+' + clean;
    }
  }

  var msisdn = clean.replace('+', '');
  if (msisdn.length < 8) return { success: false, error: 'Invalid phone number' };

  try {
    var response = await fetch(GATEWAYAPI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Token ' + token
      },
      body: JSON.stringify({
        sender: 'YogaBible',
        message: message,
        recipients: [{ msisdn: msisdn }]
      })
    });

    if (response.status === 200) {
      var result = await response.json();
      return { success: true, messageId: result.ids ? result.ids[0] : null };
    } else {
      var errorText = await response.text();
      console.error('[sequences] SMS error:', response.status, errorText);
      return { success: false, error: 'SMS send failed: ' + response.status };
    }
  } catch (err) {
    console.error('[sequences] SMS error:', err.message);
    return { success: false, error: err.message };
  }
}
