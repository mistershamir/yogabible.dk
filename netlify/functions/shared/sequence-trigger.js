/**
 * Sequence Trigger — Auto-enroll leads into sequences
 *
 * Shared utility for enrolling leads into automated sequences based on triggers.
 * Called by lead.js (new lead capture) and leads.js (status changes).
 *
 * Collections:
 *   sequences             — Sequence definitions (trigger, steps, exit_conditions)
 *   sequence_enrollments  — Per-lead enrollment state (current_step, status, history)
 */

const { getDb } = require('./firestore');
const { detectLeadCountry } = require('./country-detect');

// =========================================================================
// Known Sequence IDs
// =========================================================================

const QUICK_FOLLOWUP_ID = 'Ue0CYOsPJlnj5SF9PtA0';
const BROADCAST_ID = 'Ma2caW2hiQqtkPFesK27';
const ONBOARDING_ID = 'Un1xmmriIpUyy2Kui97N';
const EXISTING_JULY_ID = 'Yoq6RCVqTYlF10OPmkSw';

// July International Conversion — looked up by name on first use
var JULY_INTL_SEQUENCE_ID = null;

// =========================================================================
// Condition Matching
// =========================================================================

/**
 * Check if a lead matches all trigger conditions.
 * @param {Object} conditions - Trigger conditions from the sequence definition
 * @param {Object} leadData - The lead document data
 * @param {string} [skipKey] - A condition key to skip (e.g. 'new_status' handled separately)
 * @returns {boolean}
 */
function matchesTriggerConditions(conditions, leadData, skipKey) {
  if (!conditions || Object.keys(conditions).length === 0) return true;

  for (const [key, value] of Object.entries(conditions)) {
    if (skipKey && key === skipKey) continue;
    if (!value) continue;

    switch (key) {
      case 'lead_type':
        if (leadData.type !== value) return false;
        break;

      case 'source_contains':
        if (!leadData.source || !leadData.source.toLowerCase().includes(value.toLowerCase())) {
          return false;
        }
        break;

      case 'program':
      case 'ytt_program_type': {
        // Multi-format leads have comma-separated values (e.g. "4-week,8-week")
        // Use .includes() so "4-week,8-week" matches condition "4-week"
        const leadProgram = leadData.ytt_program_type || leadData.program || '';
        if (!leadProgram.includes(value)) return false;
        break;
      }

      case 'status':
        if (leadData.status !== value) return false;
        break;

      default:
        // Unknown condition key — skip silently
        break;
    }
  }

  return true;
}

// =========================================================================
// Trigger: New Lead
// =========================================================================

/**
 * Enroll a newly captured lead into matching sequences.
 * Called after a new lead is saved by lead.js and facebook-leads-webhook.js.
 *
 * @param {string} leadId - Firestore document ID of the lead
 * @param {Object} leadData - The lead document data
 * @returns {Promise<{enrolled: number, sequences: string[]}>}
 */
async function triggerNewLeadSequences(leadId, leadData) {
  try {
    const db = getDb();

    // ── 4-week-jul international routing ──────────────────────────────────
    // International leads for the July Vinyasa Plus cohort get a dedicated
    // conversion sequence instead of Broadcast + Onboarding + existing July.
    // Danish leads follow the standard flow unchanged.
    const leadProgram = leadData.ytt_program_type || leadData.program || '';
    const isJulyLead = leadProgram.includes('4-week-jul');
    const leadCountry = isJulyLead ? detectLeadCountry(leadData) : null;
    const isJulyInternational = isJulyLead && leadCountry !== 'DK';

    // Sequences to skip for July international leads (they get July Intl Conversion instead)
    const julyIntlSkipIds = isJulyInternational
      ? new Set([BROADCAST_ID, ONBOARDING_ID, EXISTING_JULY_ID])
      : null;

    // Find active sequences with new_lead trigger
    const sequencesSnap = await db.collection('sequences')
      .where('active', '==', true)
      .where('trigger.type', '==', 'new_lead')
      .get();

    if (sequencesSnap.empty && !isJulyInternational) {
      return { enrolled: 0, sequences: [] };
    }

    const enrolledNames = [];

    for (const seqDoc of (sequencesSnap.docs || [])) {
      const sequence = { id: seqDoc.id, ...seqDoc.data() };

      // Skip Broadcast/Onboarding/existing July for international July leads
      if (julyIntlSkipIds && julyIntlSkipIds.has(sequence.id)) {
        console.log(`[sequence-trigger] Skipping "${sequence.name}" for July international lead ${leadId} (country: ${leadCountry})`);
        continue;
      }

      // Check trigger conditions against lead data
      if (!matchesTriggerConditions(sequence.trigger?.conditions, leadData)) {
        continue;
      }

      // Check enrollment_closes — skip if enrollment window has passed
      if (sequence.enrollment_closes) {
        const closesDate = new Date(sequence.enrollment_closes);
        if (new Date() > closesDate) {
          console.log(`[sequence-trigger] Skipping sequence "${sequence.name}" — enrollment closed on ${sequence.enrollment_closes}`);
          continue;
        }
      }

      // Check for existing active/paused enrollment in this sequence
      const existingSnap = await db.collection('sequence_enrollments')
        .where('sequence_id', '==', sequence.id)
        .where('lead_id', '==', leadId)
        .where('status', 'in', ['active', 'paused'])
        .get();

      if (!existingSnap.empty) {
        console.log(`[sequence-trigger] Lead ${leadId} already enrolled in "${sequence.name}", skipping`);
        continue;
      }

      // Calculate first step delay
      const firstStepDelay = sequence.steps?.[0]?.delay_minutes || 0;
      const now = new Date();
      const nextSendAt = new Date(now.getTime() + firstStepDelay * 60 * 1000);

      // Create enrollment
      await db.collection('sequence_enrollments').add({
        sequence_id: sequence.id,
        sequence_name: sequence.name || '',
        lead_id: leadId,
        lead_email: leadData.email || '',
        lead_name: leadData.name || leadData.first_name || '',
        current_step: 1,
        status: 'active',
        exit_reason: null,
        next_send_at: nextSendAt,
        started_at: now,
        updated_at: now,
        step_history: [],
        trigger: 'new_lead'
      });

      enrolledNames.push(sequence.name || sequence.id);
      console.log(`[sequence-trigger] Enrolled lead ${leadId} into "${sequence.name}"`);
    }

    // ── Enroll July international leads in dedicated conversion sequence ──
    if (isJulyInternational) {
      try {
        const julyIntlName = await enrollInJulyInternationalSequence(db, leadId, leadData);
        if (julyIntlName) {
          enrolledNames.push(julyIntlName);
        }
      } catch (julyErr) {
        console.error(`[sequence-trigger] July International enrollment error for lead ${leadId}:`, julyErr.message);
      }
    }

    return { enrolled: enrolledNames.length, sequences: enrolledNames };
  } catch (err) {
    console.error(`[sequence-trigger] Error in triggerNewLeadSequences for lead ${leadId}:`, err);
    return { enrolled: 0, sequences: [] };
  }
}

// =========================================================================
// Trigger: Status Change
// =========================================================================

/**
 * Enroll a lead into sequences triggered by status changes, and check exit conditions.
 * Called when a lead's status is updated by leads.js.
 *
 * @param {string} leadId - Firestore document ID of the lead
 * @param {Object} leadData - The lead document data (with new status)
 * @param {string} oldStatus - Previous status value
 * @param {string} newStatus - New status value
 * @returns {Promise<{enrolled: number, sequences: string[]}>}
 */
async function triggerStatusChangeSequences(leadId, leadData, oldStatus, newStatus) {
  try {
    if (newStatus === oldStatus) {
      return { enrolled: 0, sequences: [] };
    }

    const db = getDb();

    // Find active sequences with status_change trigger
    const sequencesSnap = await db.collection('sequences')
      .where('active', '==', true)
      .where('trigger.type', '==', 'status_change')
      .get();

    const enrolledNames = [];

    for (const seqDoc of sequencesSnap.docs) {
      const sequence = { id: seqDoc.id, ...seqDoc.data() };
      const conditions = sequence.trigger?.conditions || {};

      // Check that new_status condition matches
      if (conditions.new_status && conditions.new_status !== newStatus) {
        continue;
      }

      // Check remaining conditions (skip new_status since we handled it)
      if (!matchesTriggerConditions(conditions, leadData, 'new_status')) {
        continue;
      }

      // Check enrollment_closes — skip if enrollment window has passed
      if (sequence.enrollment_closes) {
        const closesDate = new Date(sequence.enrollment_closes);
        if (new Date() > closesDate) {
          console.log(`[sequence-trigger] Skipping sequence "${sequence.name}" — enrollment closed on ${sequence.enrollment_closes}`);
          continue;
        }
      }

      // Check for existing active/paused enrollment in this sequence
      const existingSnap = await db.collection('sequence_enrollments')
        .where('sequence_id', '==', sequence.id)
        .where('lead_id', '==', leadId)
        .where('status', 'in', ['active', 'paused'])
        .get();

      if (!existingSnap.empty) {
        console.log(`[sequence-trigger] Lead ${leadId} already enrolled in "${sequence.name}", skipping`);
        continue;
      }

      // Calculate first step delay
      const firstStepDelay = sequence.steps?.[0]?.delay_minutes || 0;
      const now = new Date();
      const nextSendAt = new Date(now.getTime() + firstStepDelay * 60 * 1000);

      // Create enrollment
      await db.collection('sequence_enrollments').add({
        sequence_id: sequence.id,
        sequence_name: sequence.name || '',
        lead_id: leadId,
        lead_email: leadData.email || '',
        lead_name: leadData.name || leadData.first_name || '',
        current_step: 1,
        status: 'active',
        exit_reason: null,
        next_send_at: nextSendAt,
        started_at: now,
        updated_at: now,
        step_history: [],
        trigger: 'status_change',
        trigger_from: oldStatus,
        trigger_to: newStatus
      });

      enrolledNames.push(sequence.name || sequence.id);
      console.log(`[sequence-trigger] Enrolled lead ${leadId} into "${sequence.name}" (status: ${oldStatus} → ${newStatus})`);
    }

    // Check exit conditions for any currently active enrollments
    await checkExitConditions(db, leadId, newStatus);

    return { enrolled: enrolledNames.length, sequences: enrolledNames };
  } catch (err) {
    console.error(`[sequence-trigger] Error in triggerStatusChangeSequences for lead ${leadId}:`, err);
    return { enrolled: 0, sequences: [] };
  }
}

// =========================================================================
// Exit Conditions
// =========================================================================

/**
 * Check if any active enrollments for this lead should be exited based on the new status.
 * Loads the sequence definition for each enrollment and checks exit_conditions.
 *
 * @param {Object} db - Firestore database instance
 * @param {string} leadId - Firestore document ID of the lead
 * @param {string} newStatus - The lead's new status
 */
async function checkExitConditions(db, leadId, newStatus) {
  try {
    // If db is a string, treat it as leadId (called externally without db)
    if (typeof db === 'string') {
      newStatus = leadId;
      leadId = db;
      db = getDb();
    }

    // Find all active enrollments for this lead
    const enrollmentsSnap = await db.collection('sequence_enrollments')
      .where('lead_id', '==', leadId)
      .where('status', '==', 'active')
      .get();

    if (enrollmentsSnap.empty) return;

    for (const enrollDoc of enrollmentsSnap.docs) {
      const enrollment = enrollDoc.data();

      // Load the sequence definition to get exit_conditions
      const seqDoc = await db.collection('sequences').doc(enrollment.sequence_id).get();
      if (!seqDoc.exists) continue;

      const sequence = seqDoc.data();
      const exitConditions = sequence.exit_conditions || [];

      // Check if the new status matches any exit condition (case-insensitive partial match)
      const statusLower = newStatus.toLowerCase();
      const shouldExit = exitConditions.some(condition => {
        if (typeof condition === 'string') {
          return statusLower.includes(condition.toLowerCase());
        }
        if (condition.status) {
          return statusLower.includes(condition.status.toLowerCase());
        }
        return false;
      });

      if (shouldExit) {
        await enrollDoc.ref.update({
          status: 'exited',
          exit_reason: `Lead status changed to "${newStatus}"`,
          updated_at: new Date()
        });
        console.log(`[sequence-trigger] Exited lead ${leadId} from "${enrollment.sequence_name}" — status changed to "${newStatus}"`);
      }
    }
  } catch (err) {
    console.error(`[sequence-trigger] Error in checkExitConditions for lead ${leadId}:`, err);
  }
}

// =========================================================================
// July International Conversion — Manual Enrollment
// =========================================================================

/**
 * Enroll an international July lead into the dedicated conversion sequence.
 * Looks up the sequence by name on first call, then caches the ID.
 *
 * @param {Object} db - Firestore database instance
 * @param {string} leadId - Lead document ID
 * @param {Object} leadData - Lead document data
 * @returns {Promise<string|null>} Sequence name if enrolled, null if skipped
 */
async function enrollInJulyInternationalSequence(db, leadId, leadData) {
  if (!JULY_INTL_SEQUENCE_ID) {
    var snap = await db.collection('sequences')
      .where('name', '==', 'July Vinyasa Plus — International Conversion 2026')
      .where('active', '==', true)
      .limit(1)
      .get();

    if (snap.empty) {
      console.log('[sequence-trigger] July International Conversion sequence not found or not active — skipping');
      return null;
    }
    JULY_INTL_SEQUENCE_ID = snap.docs[0].id;
  }

  var seqDoc = await db.collection('sequences').doc(JULY_INTL_SEQUENCE_ID).get();
  if (!seqDoc.exists || !seqDoc.data().active) {
    console.log('[sequence-trigger] July International Conversion sequence not active — skipping');
    return null;
  }

  var sequence = seqDoc.data();

  // Check enrollment_closes
  if (sequence.enrollment_closes) {
    var closesDate = new Date(sequence.enrollment_closes);
    if (new Date() > closesDate) {
      console.log('[sequence-trigger] July International Conversion enrollment closed on ' + sequence.enrollment_closes);
      return null;
    }
  }

  // Check not already enrolled
  var existingSnap = await db.collection('sequence_enrollments')
    .where('sequence_id', '==', JULY_INTL_SEQUENCE_ID)
    .where('lead_id', '==', leadId)
    .where('status', 'in', ['active', 'paused'])
    .get();

  if (!existingSnap.empty) {
    console.log('[sequence-trigger] Lead ' + leadId + ' already enrolled in July International Conversion');
    return null;
  }

  var firstStepDelay = sequence.steps && sequence.steps[0] ? (sequence.steps[0].delay_minutes || 0) : 0;
  var now = new Date();
  var nextSendAt = new Date(now.getTime() + firstStepDelay * 60 * 1000);

  await db.collection('sequence_enrollments').add({
    sequence_id: JULY_INTL_SEQUENCE_ID,
    sequence_name: sequence.name || 'July Vinyasa Plus — International Conversion 2026',
    lead_id: leadId,
    lead_email: leadData.email || '',
    lead_name: leadData.name || leadData.first_name || '',
    current_step: 1,
    status: 'active',
    exit_reason: null,
    next_send_at: nextSendAt,
    started_at: now,
    updated_at: now,
    step_history: [],
    trigger: 'new_lead_july_international'
  });

  console.log('[sequence-trigger] Enrolled international lead ' + leadId + ' into July International Conversion');
  return sequence.name;
}

module.exports = {
  triggerNewLeadSequences,
  triggerStatusChangeSequences,
  checkExitConditions
};
