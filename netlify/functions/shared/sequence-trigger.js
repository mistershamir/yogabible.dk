/**
 * Sequence Auto-Enrollment Triggers — Yoga Bible
 * Shared module for automatically enrolling leads into sequences
 * based on trigger conditions (new_lead, status_change).
 *
 * Used by: lead.js (new lead capture), leads.js (status updates)
 */

const { getDb } = require('./firestore');

const SEQ_COLLECTION = 'sequences';
const ENROLL_COLLECTION = 'sequence_enrollments';

/**
 * Check for sequences with new_lead trigger that match this lead,
 * and auto-enroll if conditions match.
 *
 * @param {string} leadId - Firestore lead document ID
 * @param {object} leadData - Lead data (type, ytt_program_type, source, etc.)
 */
async function triggerNewLeadSequences(leadId, leadData) {
  try {
    const db = getDb();

    // Find active sequences with new_lead trigger
    const seqSnap = await db.collection(SEQ_COLLECTION)
      .where('active', '==', true)
      .get();

    const matchingSequences = [];
    seqSnap.forEach(doc => {
      const seq = { id: doc.id, ...doc.data() };
      if (seq.trigger && seq.trigger.type === 'new_lead') {
        if (matchesTriggerConditions(seq.trigger.conditions, leadData)) {
          matchingSequences.push(seq);
        }
      }
    });

    if (matchingSequences.length === 0) return { enrolled: 0 };

    // Check existing enrollments to avoid duplicates
    const existingSnap = await db.collection(ENROLL_COLLECTION)
      .where('lead_id', '==', leadId)
      .where('status', 'in', ['active', 'paused'])
      .get();

    const existingSeqIds = new Set();
    existingSnap.forEach(doc => {
      existingSeqIds.add(doc.data().sequence_id);
    });

    // Enroll in matching sequences
    let enrolled = 0;
    for (const seq of matchingSequences) {
      if (existingSeqIds.has(seq.id)) continue; // Already enrolled
      if (!seq.steps || seq.steps.length === 0) continue; // No steps

      const firstStep = seq.steps[0];
      const delayMs = ((firstStep.delay_days || 0) * 86400000) + ((firstStep.delay_hours || 0) * 3600000);
      const nextSend = new Date(Date.now() + delayMs);

      await db.collection(ENROLL_COLLECTION).add({
        sequence_id: seq.id,
        sequence_name: seq.name || '',
        lead_id: leadId,
        lead_email: leadData.email || '',
        lead_name: `${leadData.first_name || ''} ${leadData.last_name || ''}`.trim(),
        current_step: 1,
        status: 'active',
        exit_reason: null,
        next_send_at: nextSend.toISOString(),
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        step_history: [],
        trigger: 'new_lead'
      });

      enrolled++;
      console.log(`[sequence-trigger] Auto-enrolled lead ${leadId} in sequence "${seq.name}" (${seq.id})`);
    }

    return { enrolled, sequences: matchingSequences.map(s => s.name) };
  } catch (err) {
    console.error('[sequence-trigger] New lead trigger error:', err.message);
    return { enrolled: 0, error: err.message };
  }
}

/**
 * Check for sequences with status_change trigger that match this lead's
 * new status, and auto-enroll if conditions match.
 *
 * @param {string} leadId - Firestore lead document ID
 * @param {object} leadData - Full lead data after update
 * @param {string} oldStatus - Previous status before the update
 * @param {string} newStatus - New status after the update
 */
async function triggerStatusChangeSequences(leadId, leadData, oldStatus, newStatus) {
  try {
    if (!newStatus || newStatus === oldStatus) return { enrolled: 0 };

    const db = getDb();

    // Find active sequences with status_change trigger
    const seqSnap = await db.collection(SEQ_COLLECTION)
      .where('active', '==', true)
      .get();

    const matchingSequences = [];
    seqSnap.forEach(doc => {
      const seq = { id: doc.id, ...doc.data() };
      if (seq.trigger && seq.trigger.type === 'status_change') {
        const conditions = seq.trigger.conditions || {};
        // Check if the new status matches the trigger's target status
        if (conditions.new_status && conditions.new_status.toLowerCase() !== newStatus.toLowerCase()) {
          return;
        }
        // Check other conditions
        if (matchesTriggerConditions(conditions, leadData, 'new_status')) {
          matchingSequences.push(seq);
        }
      }
    });

    if (matchingSequences.length === 0) return { enrolled: 0 };

    // Check existing enrollments
    const existingSnap = await db.collection(ENROLL_COLLECTION)
      .where('lead_id', '==', leadId)
      .where('status', 'in', ['active', 'paused'])
      .get();

    const existingSeqIds = new Set();
    existingSnap.forEach(doc => {
      existingSeqIds.add(doc.data().sequence_id);
    });

    // Enroll
    let enrolled = 0;
    for (const seq of matchingSequences) {
      if (existingSeqIds.has(seq.id)) continue;
      if (!seq.steps || seq.steps.length === 0) continue;

      const firstStep = seq.steps[0];
      const delayMs = ((firstStep.delay_days || 0) * 86400000) + ((firstStep.delay_hours || 0) * 3600000);
      const nextSend = new Date(Date.now() + delayMs);

      await db.collection(ENROLL_COLLECTION).add({
        sequence_id: seq.id,
        sequence_name: seq.name || '',
        lead_id: leadId,
        lead_email: leadData.email || '',
        lead_name: `${leadData.first_name || ''} ${leadData.last_name || ''}`.trim(),
        current_step: 1,
        status: 'active',
        exit_reason: null,
        next_send_at: nextSend.toISOString(),
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        step_history: [],
        trigger: 'status_change',
        trigger_from: oldStatus,
        trigger_to: newStatus
      });

      enrolled++;
      console.log(`[sequence-trigger] Auto-enrolled lead ${leadId} in sequence "${seq.name}" (status: ${oldStatus} → ${newStatus})`);
    }

    // Also check exit conditions on existing enrollments
    // If the new status matches an exit condition, exit those enrollments
    await checkExitConditions(db, leadId, newStatus);

    return { enrolled, sequences: matchingSequences.map(s => s.name) };
  } catch (err) {
    console.error('[sequence-trigger] Status change trigger error:', err.message);
    return { enrolled: 0, error: err.message };
  }
}

/**
 * Check if a lead's new status triggers exit conditions on active enrollments.
 */
async function checkExitConditions(db, leadId, newStatus) {
  try {
    const enrollSnap = await db.collection(ENROLL_COLLECTION)
      .where('lead_id', '==', leadId)
      .where('status', '==', 'active')
      .get();

    if (enrollSnap.empty) return;

    const statusLower = (newStatus || '').toLowerCase();
    const exitStatuses = ['converted', 'unsubscribed', 'not interested', 'lost', 'closed'];

    // If the status is an exit-worthy status, check each enrollment's exit conditions
    if (!exitStatuses.some(s => statusLower.includes(s))) return;

    for (const doc of enrollSnap.docs) {
      const enrollment = doc.data();
      const seqDoc = await db.collection(SEQ_COLLECTION).doc(enrollment.sequence_id).get();
      if (!seqDoc.exists) continue;

      const seq = seqDoc.data();
      const exitConditions = seq.exit_conditions || [];

      const shouldExit = exitConditions.some(cond => {
        const condLower = cond.toLowerCase();
        return statusLower.includes(condLower) || condLower.includes(statusLower);
      });

      if (shouldExit) {
        await doc.ref.update({
          status: 'exited',
          exit_reason: `Lead status changed to "${newStatus}"`,
          updated_at: new Date().toISOString()
        });
        console.log(`[sequence-trigger] Exited lead ${leadId} from sequence "${enrollment.sequence_name}" (status: ${newStatus})`);
      }
    }
  } catch (err) {
    console.error('[sequence-trigger] Exit condition check error:', err.message);
  }
}

/**
 * Check if a lead matches trigger conditions.
 * @param {object} conditions - Trigger conditions from the sequence definition
 * @param {object} leadData - Lead data to check against
 * @param {string} skipKey - Optional key to skip (e.g., 'new_status' which is checked separately)
 */
function matchesTriggerConditions(conditions, leadData, skipKey) {
  if (!conditions) return true;

  for (const [key, value] of Object.entries(conditions)) {
    if (skipKey && key === skipKey) continue;
    if (!value) continue;

    const valueLower = String(value).toLowerCase();

    switch (key) {
      case 'lead_type':
        if (String(leadData.type || '').toLowerCase() !== valueLower) return false;
        break;
      case 'source_contains':
        if (!String(leadData.source || '').toLowerCase().includes(valueLower)) return false;
        break;
      case 'program':
      case 'ytt_program_type':
        if (!String(leadData.ytt_program_type || leadData.program || '').toLowerCase().includes(valueLower)) return false;
        break;
      case 'status':
        if (String(leadData.status || 'New').toLowerCase() !== valueLower) return false;
        break;
      // Add more condition types as needed
    }
  }

  return true;
}

module.exports = {
  triggerNewLeadSequences,
  triggerStatusChangeSequences,
  checkExitConditions
};
