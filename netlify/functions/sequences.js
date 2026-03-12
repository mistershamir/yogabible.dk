/**
 * Sequence Automation API — Yoga Bible
 * Configurable email/SMS drip sequences with enrollment management.
 *
 * GET    /.netlify/functions/sequences                          — list all sequences
 * GET    /.netlify/functions/sequences?id=X                     — get single sequence with enrollment stats
 * POST   /.netlify/functions/sequences                          — create new sequence
 * PUT    /.netlify/functions/sequences?id=X                     — update sequence
 * DELETE /.netlify/functions/sequences?id=X                     — soft-delete (set active: false)
 *
 * POST   /.netlify/functions/sequences?action=enroll            — enroll leads in a sequence
 * POST   /.netlify/functions/sequences?action=unenroll          — remove leads from a sequence
 * GET    /.netlify/functions/sequences?action=enrollments&sequence_id=X — get enrollments
 * POST   /.netlify/functions/sequences?action=pause             — pause an enrollment
 * POST   /.netlify/functions/sequences?action=resume            — resume an enrollment
 * POST   /.netlify/functions/sequences?action=process           — process due sequence steps
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const { requireAuth } = require('./shared/auth');
const { jsonResponse, optionsResponse, buildUnsubscribeUrl } = require('./shared/utils');
const nodemailer = require('nodemailer');

const SEQ_COLLECTION = 'sequences';
const ENROLL_COLLECTION = 'sequence_enrollments';

const ALLOWED_SEQ_FIELDS = [
  'name', 'description', 'active', 'trigger', 'exit_conditions', 'steps'
];

// ─── Gmail transporter ─────────────────────────────────────────────────────────

let _transporter = null;
function getTransporter() {
  if (_transporter) return _transporter;
  _transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD
    }
  });
  return _transporter;
}

// ─── Variable substitution ──────────────────────────────────────────────────────

function substituteVars(text, vars) {
  if (!text) return text;
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return vars[key] !== undefined ? String(vars[key]) : match;
  });
}

// ─── SMS sender (GatewayAPI) ────────────────────────────────────────────────────

async function sendSMS(phone, message) {
  const token = process.env.GATEWAYAPI_TOKEN;
  if (!token) throw new Error('GATEWAYAPI_TOKEN not set');

  const resp = await fetch('https://gatewayapi.eu/rest/mtsms', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify({
      sender: 'YogaBible',
      message: message,
      recipients: [{ msisdn: phone.replace(/[^\d]/g, '') }]
    })
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error('SMS send failed: ' + errText);
  }
  return { ok: true };
}

// ═════════════════════════════════════════════════════════════════════════════════
// HANDLER
// ═════════════════════════════════════════════════════════════════════════════════

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  const user = await requireAuth(event, ['admin']);
  if (user.error) return user.error;

  const params = event.queryStringParameters || {};
  const db = getDb();

  try {
    // Route by action parameter first
    if (params.action) {
      switch (params.action) {
        case 'enroll':
          return enrollLeads(db, event);
        case 'unenroll':
          return unenrollLeads(db, event);
        case 'enrollments':
          return getEnrollments(db, params);
        case 'pause':
          return pauseEnrollment(db, event);
        case 'resume':
          return resumeEnrollment(db, event);
        case 'process':
          return processSequences(db);
        default:
          return jsonResponse(400, { ok: false, error: 'Unknown action: ' + params.action });
      }
    }

    // Standard CRUD
    switch (event.httpMethod) {
      case 'GET':
        return params.id ? getOne(db, params.id) : getAll(db);
      case 'POST':
        return create(db, event, user);
      case 'PUT':
        return update(db, event, params);
      case 'DELETE':
        return softDelete(db, params);
      default:
        return jsonResponse(405, { ok: false, error: 'Method not allowed' });
    }
  } catch (err) {
    console.error('[sequences] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};


// ═════════════════════════════════════════════════════════════════════════════════
// SEQUENCE CRUD
// ═════════════════════════════════════════════════════════════════════════════════

async function getAll(db) {
  const snap = await db.collection(SEQ_COLLECTION).orderBy('created_at', 'desc').get();
  const items = [];
  for (const doc of snap.docs) {
    const data = { id: doc.id, ...doc.data() };
    // Get enrollment counts
    const enrollSnap = await db.collection(ENROLL_COLLECTION)
      .where('sequence_id', '==', doc.id)
      .get();
    let active = 0, completed = 0, paused = 0, exited = 0;
    enrollSnap.forEach(e => {
      const s = e.data().status;
      if (s === 'active') active++;
      else if (s === 'completed') completed++;
      else if (s === 'paused') paused++;
      else if (s === 'exited') exited++;
    });
    data.stats = {
      total_enrolled: enrollSnap.size,
      active,
      completed,
      paused,
      exited
    };
    items.push(data);
  }
  return jsonResponse(200, { ok: true, items });
}


async function getOne(db, id) {
  const doc = await db.collection(SEQ_COLLECTION).doc(id).get();
  if (!doc.exists) return jsonResponse(404, { ok: false, error: 'Not found' });

  const data = { id: doc.id, ...doc.data() };

  // Get enrollment stats
  const enrollSnap = await db.collection(ENROLL_COLLECTION)
    .where('sequence_id', '==', id)
    .get();
  let active = 0, completed = 0, paused = 0, exited = 0;
  enrollSnap.forEach(e => {
    const s = e.data().status;
    if (s === 'active') active++;
    else if (s === 'completed') completed++;
    else if (s === 'paused') paused++;
    else if (s === 'exited') exited++;
  });
  data.stats = {
    total_enrolled: enrollSnap.size,
    active,
    completed,
    paused,
    exited
  };

  return jsonResponse(200, { ok: true, item: data });
}


async function create(db, event, user) {
  const body = JSON.parse(event.body || '{}');
  const data = {};

  for (const field of ALLOWED_SEQ_FIELDS) {
    if (body[field] !== undefined) data[field] = body[field];
  }

  if (!data.name) {
    return jsonResponse(400, { ok: false, error: 'name is required' });
  }

  // Defaults
  data.active = data.active !== false;
  data.trigger = data.trigger || { type: 'manual', conditions: {} };
  data.exit_conditions = data.exit_conditions || ['converted', 'unsubscribed'];
  data.steps = data.steps || [];
  data.created_at = serverTimestamp();
  data.updated_at = serverTimestamp();
  data.created_by = user.email;

  const ref = await db.collection(SEQ_COLLECTION).add(data);
  return jsonResponse(201, { ok: true, id: ref.id });
}


async function update(db, event, params) {
  if (!params.id) return jsonResponse(400, { ok: false, error: 'id query param is required' });

  const body = JSON.parse(event.body || '{}');
  const docRef = db.collection(SEQ_COLLECTION).doc(params.id);
  const doc = await docRef.get();
  if (!doc.exists) return jsonResponse(404, { ok: false, error: 'Not found' });

  const data = {};
  for (const field of ALLOWED_SEQ_FIELDS) {
    if (body[field] !== undefined) data[field] = body[field];
  }
  data.updated_at = serverTimestamp();

  await docRef.update(data);
  return jsonResponse(200, { ok: true, id: params.id });
}


async function softDelete(db, params) {
  if (!params.id) return jsonResponse(400, { ok: false, error: 'id query param is required' });

  const docRef = db.collection(SEQ_COLLECTION).doc(params.id);
  const doc = await docRef.get();
  if (!doc.exists) return jsonResponse(404, { ok: false, error: 'Not found' });

  await docRef.update({ active: false, updated_at: serverTimestamp() });
  return jsonResponse(200, { ok: true, deleted: params.id });
}


// ═════════════════════════════════════════════════════════════════════════════════
// ENROLLMENT MANAGEMENT
// ═════════════════════════════════════════════════════════════════════════════════

async function enrollLeads(db, event) {
  const body = JSON.parse(event.body || '{}');
  const { sequence_id, lead_ids } = body;

  if (!sequence_id || !lead_ids || !Array.isArray(lead_ids) || lead_ids.length === 0) {
    return jsonResponse(400, { ok: false, error: 'sequence_id and lead_ids[] are required' });
  }

  // Verify sequence exists
  const seqDoc = await db.collection(SEQ_COLLECTION).doc(sequence_id).get();
  if (!seqDoc.exists) return jsonResponse(404, { ok: false, error: 'Sequence not found' });
  const seq = seqDoc.data();

  // Check for existing enrollments to avoid duplicates
  const existingSnap = await db.collection(ENROLL_COLLECTION)
    .where('sequence_id', '==', sequence_id)
    .where('lead_id', 'in', lead_ids.slice(0, 10)) // Firestore 'in' limit is 10
    .get();
  const existingLeadIds = new Set();
  existingSnap.forEach(d => existingLeadIds.add(d.data().lead_id));

  const enrolled = [];
  const skipped = [];

  for (const leadId of lead_ids) {
    if (existingLeadIds.has(leadId)) {
      skipped.push(leadId);
      continue;
    }

    // Get lead data
    const leadDoc = await db.collection('leads').doc(leadId).get();
    if (!leadDoc.exists) {
      skipped.push(leadId);
      continue;
    }
    const lead = leadDoc.data();

    // Calculate next_send_at based on first step delay
    const firstStep = (seq.steps && seq.steps.length > 0) ? seq.steps[0] : null;
    const delayMs = firstStep
      ? ((firstStep.delay_days || 0) * 86400000) + ((firstStep.delay_hours || 0) * 3600000)
      : 0;
    const nextSendAt = new Date(Date.now() + delayMs).toISOString();

    await db.collection(ENROLL_COLLECTION).add({
      sequence_id,
      lead_id: leadId,
      lead_email: lead.email || '',
      lead_name: [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email || '',
      lead_phone: lead.phone || '',
      current_step: 1,
      status: 'active',
      exit_reason: null,
      next_send_at: nextSendAt,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      step_history: []
    });
    enrolled.push(leadId);
  }

  return jsonResponse(200, {
    ok: true,
    enrolled: enrolled.length,
    skipped: skipped.length,
    enrolled_ids: enrolled,
    skipped_ids: skipped
  });
}


async function unenrollLeads(db, event) {
  const body = JSON.parse(event.body || '{}');
  const { enrollment_ids } = body;

  if (!enrollment_ids || !Array.isArray(enrollment_ids)) {
    return jsonResponse(400, { ok: false, error: 'enrollment_ids[] is required' });
  }

  let removed = 0;
  for (const id of enrollment_ids) {
    const docRef = db.collection(ENROLL_COLLECTION).doc(id);
    const doc = await docRef.get();
    if (doc.exists) {
      await docRef.update({
        status: 'exited',
        exit_reason: 'manual_unenroll',
        updated_at: new Date().toISOString()
      });
      removed++;
    }
  }

  return jsonResponse(200, { ok: true, removed });
}


async function getEnrollments(db, params) {
  if (!params.sequence_id) {
    return jsonResponse(400, { ok: false, error: 'sequence_id is required' });
  }

  const snap = await db.collection(ENROLL_COLLECTION)
    .where('sequence_id', '==', params.sequence_id)
    .orderBy('started_at', 'desc')
    .get();

  const items = [];
  snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
  return jsonResponse(200, { ok: true, items });
}


async function pauseEnrollment(db, event) {
  const body = JSON.parse(event.body || '{}');
  if (!body.enrollment_id) return jsonResponse(400, { ok: false, error: 'enrollment_id is required' });

  const docRef = db.collection(ENROLL_COLLECTION).doc(body.enrollment_id);
  const doc = await docRef.get();
  if (!doc.exists) return jsonResponse(404, { ok: false, error: 'Enrollment not found' });

  await docRef.update({ status: 'paused', updated_at: new Date().toISOString() });
  return jsonResponse(200, { ok: true, id: body.enrollment_id });
}


async function resumeEnrollment(db, event) {
  const body = JSON.parse(event.body || '{}');
  if (!body.enrollment_id) return jsonResponse(400, { ok: false, error: 'enrollment_id is required' });

  const docRef = db.collection(ENROLL_COLLECTION).doc(body.enrollment_id);
  const doc = await docRef.get();
  if (!doc.exists) return jsonResponse(404, { ok: false, error: 'Enrollment not found' });

  await docRef.update({ status: 'active', updated_at: new Date().toISOString() });
  return jsonResponse(200, { ok: true, id: body.enrollment_id });
}


// ═════════════════════════════════════════════════════════════════════════════════
// PROCESS DUE STEPS
// ═════════════════════════════════════════════════════════════════════════════════

async function processSequences(db) {
  const now = new Date().toISOString();

  // Get all active enrollments that are due
  const dueSnap = await db.collection(ENROLL_COLLECTION)
    .where('status', '==', 'active')
    .where('next_send_at', '<=', now)
    .get();

  if (dueSnap.empty) {
    return jsonResponse(200, { ok: true, processed: 0, message: 'No due enrollments' });
  }

  let processed = 0;
  let errors = 0;
  const results = [];

  for (const enrollDoc of dueSnap.docs) {
    const enrollment = { id: enrollDoc.id, ...enrollDoc.data() };
    const enrollRef = db.collection(ENROLL_COLLECTION).doc(enrollDoc.id);

    try {
      // Get the sequence
      const seqDoc = await db.collection(SEQ_COLLECTION).doc(enrollment.sequence_id).get();
      if (!seqDoc.exists || !seqDoc.data().active) {
        await enrollRef.update({ status: 'exited', exit_reason: 'sequence_inactive', updated_at: now });
        continue;
      }
      const seq = seqDoc.data();

      // Get current lead data to check exit conditions
      const leadDoc = await db.collection('leads').doc(enrollment.lead_id).get();
      const lead = leadDoc.exists ? leadDoc.data() : {};

      // Check exit conditions
      const leadStatus = (lead.status || '').toLowerCase();
      const exitConditions = seq.exit_conditions || [];
      const shouldExit = exitConditions.some(cond => {
        const c = cond.toLowerCase();
        return leadStatus === c ||
          (c === 'converted' && lead.converted === true) ||
          (c === 'unsubscribed' && lead.unsubscribed === true);
      });

      if (shouldExit) {
        await enrollRef.update({
          status: 'exited',
          exit_reason: 'exit_condition_met',
          updated_at: now
        });
        results.push({ enrollment_id: enrollment.id, action: 'exited', reason: 'exit_condition' });
        continue;
      }

      // Get current step
      const stepIndex = (enrollment.current_step || 1) - 1;
      if (stepIndex >= (seq.steps || []).length) {
        await enrollRef.update({ status: 'completed', updated_at: now });
        results.push({ enrollment_id: enrollment.id, action: 'completed' });
        continue;
      }

      const step = seq.steps[stepIndex];

      // Check step condition
      if (step.condition) {
        const condMet = checkStepCondition(step.condition, lead);
        if (!condMet) {
          // Skip this step, advance to next
          const nextStepIndex = stepIndex + 1;
          if (nextStepIndex >= seq.steps.length) {
            await enrollRef.update({ status: 'completed', updated_at: now });
          } else {
            const nextStep = seq.steps[nextStepIndex];
            const delayMs = ((nextStep.delay_days || 0) * 86400000) + ((nextStep.delay_hours || 0) * 3600000);
            await enrollRef.update({
              current_step: nextStepIndex + 1,
              next_send_at: new Date(Date.now() + delayMs).toISOString(),
              updated_at: now
            });
          }
          results.push({ enrollment_id: enrollment.id, action: 'skipped_step', step: enrollment.current_step });
          continue;
        }
      }

      // Build template variables from lead data
      const vars = {
        first_name: lead.first_name || '',
        last_name: lead.last_name || '',
        name: [lead.first_name, lead.last_name].filter(Boolean).join(' ') || '',
        email: lead.email || enrollment.lead_email || '',
        phone: lead.phone || '',
        program: lead.program || lead.ytt_program_type || '',
        unsubscribe_url: buildUnsubscribeUrl(lead.email || enrollment.lead_email)
      };

      // Send based on channel
      const channel = step.channel || 'email';
      const sentChannels = [];

      if (channel === 'email' || channel === 'email+sms') {
        if (vars.email) {
          const subject = substituteVars(step.subject || '', vars);
          const bodyHtml = substituteVars(step.body_html || '', vars);

          try {
            const transporter = getTransporter();
            await transporter.sendMail({
              from: `"Yoga Bible" <${process.env.GMAIL_USER}>`,
              to: vars.email,
              subject: subject,
              html: bodyHtml,
              text: bodyHtml.replace(/<[^>]+>/g, '')
            });
            sentChannels.push('email');

            // Log to email_log
            await db.collection('email_log').add({
              lead_id: enrollment.lead_id,
              to: vars.email,
              subject: subject,
              template_id: 'sequence_' + enrollment.sequence_id + '_step_' + enrollment.current_step,
              sent_at: now,
              status: 'sent',
              source: 'sequence'
            });
          } catch (emailErr) {
            console.error('[sequences] Email send failed:', emailErr.message);
            errors++;
          }
        }
      }

      if (channel === 'sms' || channel === 'email+sms') {
        const phone = lead.phone || enrollment.lead_phone;
        if (phone && step.sms_text) {
          const smsText = substituteVars(step.sms_text, vars);
          try {
            await sendSMS(phone, smsText);
            sentChannels.push('sms');

            // Log SMS
            await db.collection('sms_log').add({
              lead_id: enrollment.lead_id,
              to: phone,
              message: smsText,
              sent_at: now,
              status: 'sent',
              source: 'sequence'
            });
          } catch (smsErr) {
            console.error('[sequences] SMS send failed:', smsErr.message);
            errors++;
          }
        }
      }

      // Update step history
      const stepHistory = enrollment.step_history || [];
      stepHistory.push({
        step: enrollment.current_step,
        sent_at: now,
        channels: sentChannels
      });

      // Advance to next step or complete
      const nextStepIndex = stepIndex + 1;
      if (nextStepIndex >= seq.steps.length) {
        await enrollRef.update({
          status: 'completed',
          step_history: stepHistory,
          updated_at: now
        });
        results.push({ enrollment_id: enrollment.id, action: 'sent_and_completed', step: enrollment.current_step, channels: sentChannels });
      } else {
        const nextStep = seq.steps[nextStepIndex];
        const delayMs = ((nextStep.delay_days || 0) * 86400000) + ((nextStep.delay_hours || 0) * 3600000);
        await enrollRef.update({
          current_step: nextStepIndex + 1,
          next_send_at: new Date(Date.now() + delayMs).toISOString(),
          step_history: stepHistory,
          updated_at: now
        });
        results.push({ enrollment_id: enrollment.id, action: 'sent', step: enrollment.current_step, channels: sentChannels });
      }

      processed++;
    } catch (stepErr) {
      console.error('[sequences] Process error for enrollment', enrollment.id, ':', stepErr.message);
      errors++;
      results.push({ enrollment_id: enrollment.id, action: 'error', error: stepErr.message });
    }
  }

  return jsonResponse(200, {
    ok: true,
    processed,
    errors,
    total_due: dueSnap.size,
    results
  });
}


// ─── Helpers ────────────────────────────────────────────────────────────────────

function checkStepCondition(condition, lead) {
  if (!condition) return true;

  // status_not: skip step if lead has this status
  if (condition.status_not) {
    if ((lead.status || '').toLowerCase() === condition.status_not.toLowerCase()) {
      return false;
    }
  }

  // status_is: only send if lead has this status
  if (condition.status_is) {
    if ((lead.status || '').toLowerCase() !== condition.status_is.toLowerCase()) {
      return false;
    }
  }

  // has_phone: only send if lead has a phone number
  if (condition.has_phone && !lead.phone) {
    return false;
  }

  return true;
}
