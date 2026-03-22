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

const { getDb, serverTimestamp } = require('./shared/firestore');
const { requireAuth } = require('./shared/auth');
const { jsonResponse, optionsResponse, buildUnsubscribeUrl } = require('./shared/utils');
const { sendSingleViaResend } = require('./shared/resend-service');

const SEQUENCES_COL = 'sequences';
const ENROLLMENTS_COL = 'sequence_enrollments';
const ALLOWED_FIELDS = ['name', 'description', 'active', 'trigger', 'exit_conditions', 'steps', 'enrollment_closes'];
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

  // Calculate first step send time
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

      // Check if already enrolled in this sequence
      var existingSnap = await db.collection(ENROLLMENTS_COL)
        .where('sequence_id', '==', payload.sequence_id)
        .where('lead_id', '==', leadId)
        .where('status', 'in', ['active', 'paused'])
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

      var ref = await db.collection(ENROLLMENTS_COL).add(enrollData);
      enrolled.push({ lead_id: leadId, enrollment_id: ref.id });
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
      updateData.next_send_at = calculateNextSendAt(new Date().toISOString(), step);
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
  var now = new Date().toISOString();
  var processed = 0;
  var errors = [];
  var sentSummary = []; // Track sent items for digest email

  try {
    // Find all active enrollments that are due
    const snapshot = await db.collection(ENROLLMENTS_COL)
      .where('status', '==', 'active')
      .where('next_send_at', '<=', now)
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
              next_send_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
              updated_at: now
            });
            console.log('[sequences] Throttled step for lead ' + enrollment.lead_id + ' — recent email within 48h');
            continue;
          }
        }

        // Substitute template variables
        var vars = {
          '{{first_name}}': lead.first_name || '',
          '{{last_name}}': lead.last_name || '',
          '{{email}}': lead.email || '',
          '{{phone}}': lead.phone || '',
          '{{program}}': lead.program || lead.ytt_program_type || '',
          '{{unsubscribe_url}}': buildUnsubscribeUrl(lead.email || '')
        };

        var stepHistory = { step: enrollment.current_step, sent_at: now, channel: step.channel, result: 'skipped' };
        var emailSent = false;
        var smsSent = false;

        // Language branching — determine lead language for content selection
        var leadLang = (lead.lang || lead.meta_lang || lead.language || 'da').toLowerCase().substring(0, 2);
        var isDanish = ['da', 'dk'].includes(leadLang);

        // Select language-appropriate email content (English if available, else fallback to Danish)
        var selectedSubject = (!isDanish && step.email_subject_en) ? step.email_subject_en : step.email_subject;
        var selectedBody = (!isDanish && step.email_body_en) ? step.email_body_en : step.email_body;

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

        // Send email
        if (wantsEmail) {
          if (lead.email && hasEmailContent) {
            var emailResult = await sendSequenceEmail(
              lead.email,
              substituteVars(selectedSubject, vars),
              substituteVars(selectedBody, vars)
            );

            if (emailResult.success) {
              emailSent = true;
            } else {
              stepHistory.result = 'email_failed';
              stepHistory.error = emailResult.error;
            }

            // Log to email_log — use new Date() to match Timestamp format
            // used by lead-emails.js, email-service.js, etc.
            await db.collection('email_log').add({
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
            });
          }
        }

        // Send SMS
        if (wantsSms) {
          if (lead.phone && hasSmsContent) {
            var smsResult = await sendSequenceSMS(
              lead.phone,
              substituteVars(step.sms_message, vars)
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
              message: substituteVars(step.sms_message, vars),
              sent_at: new Date(),
              status: smsResult.success ? 'sent' : 'failed',
              source: 'sequence',
              sequence_id: seqId,
              created_at: serverTimestamp()
            });
          }
        }

        // Set accurate step result
        if (emailSent || smsSent) {
          stepHistory.result = 'sent';
          sentSummary.push({
            lead: enrollment.lead_name || enrollment.lead_email,
            email: lead.email,
            step: enrollment.current_step,
            sequence: enrollment.sequence_name || seqId,
            subject: hasEmailContent ? substituteVars(step.email_subject, vars) : null,
            channel: step.channel,
            emailSent: emailSent,
            smsSent: smsSent
          });
        }

        // Advance enrollment
        var nextStep = (enrollment.current_step || 1) + 1;
        var updateData = {
          current_step: nextStep,
          updated_at: now,
          step_history: [...(enrollment.step_history || []), stepHistory]
        };

        if (nextStep > sequence.steps.length) {
          // Last step done
          updateData.status = 'completed';
          updateData.next_send_at = null;
        } else {
          var upcoming = sequence.steps[nextStep - 1];
          updateData.next_send_at = calculateNextSendAt(now, upcoming);
        }

        await db.collection(ENROLLMENTS_COL).doc(enrollId).update(updateData);
        processed++;

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

function calculateNextSendAt(fromISO, step) {
  var date = new Date(fromISO);
  var delayDays = (step && step.delay_days) || 0;
  var delayHours = (step && step.delay_hours) || 0;
  var delayMinutes = (step && step.delay_minutes) || 0;

  // Support delay_minutes (used by seed scripts & sequence-trigger.js)
  // as well as delay_days + delay_hours (used by admin UI step builder)
  if (delayMinutes > 0 && delayDays === 0 && delayHours === 0) {
    date = new Date(date.getTime() + delayMinutes * 60 * 1000);
  } else {
    date.setDate(date.getDate() + delayDays);
    date.setHours(date.getHours() + delayHours);
  }

  return date.toISOString();
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
    return '<tr>' +
      '<td style="padding:6px 10px;border-bottom:1px solid #eee">' + (item.lead || '—') + '</td>' +
      '<td style="padding:6px 10px;border-bottom:1px solid #eee">' + (item.email || '—') + '</td>' +
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

async function sendSequenceEmail(to, subject, bodyHtml) {
  try {
    var result = await sendSingleViaResend({
      to,
      subject,
      bodyHtml,
      bodyPlain: ''
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
