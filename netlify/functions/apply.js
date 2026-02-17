/**
 * Apply (Application Builder) — Yoga Bible
 * Public endpoint for application form submissions.
 *
 * POST /.netlify/functions/apply
 * Body: { action: "apply_builder", applicant: {...}, selections: {...} }
 *
 * Returns: { ok: true, application_id: "YB-260216-1234" }
 */

const { getDb, getAuth } = require('./shared/firestore');
const {
  jsonResponse, optionsResponse, generateApplicationId,
  detectYTTProgramType
} = require('./shared/utils');
const { sendAdminNotification } = require('./shared/email-service');
const { sendApplicationConfirmation } = require('./shared/lead-emails');

// =========================================================================
// Auto Role Assignment
// =========================================================================

const ROLE_PRIORITY = ['member', 'student', 'trainee', 'teacher', 'marketing', 'admin'];

function getRolePriority(role) {
  const idx = ROLE_PRIORITY.indexOf(role);
  return idx === -1 ? 0 : idx;
}

/**
 * Map YTT program type to trainee program code.
 */
function mapYTTToProgram(yttProgramType) {
  if (yttProgramType === '300h') return '300h';
  // '18-week', '4-week', '8-week', '50h', '30h', 'other' → all 200h
  return '200h';
}

/**
 * Map YTT program to training method (Triangle Method or Vinyasa Plus).
 * Specialty modules (50h, 30h) don't get a method tag.
 */
function mapYTTToMethod(yttProgramType, courseName) {
  const name = (courseName || '').toLowerCase();
  // Vinyasa Plus detection — check course name first
  if (name.includes('vinyasa')) return 'vinyasa';
  // Specialty modules don't get a method
  if (yttProgramType === '50h' || yttProgramType === '30h') return null;
  // Default: Triangle Method
  return 'triangle';
}

/**
 * Detect course types from course name or bundle type string.
 * Returns an array of course type keys.
 */
function detectCourseTypes(courseName, bundleType) {
  const types = [];
  // For bundles, parse the bundle_type string
  const str = (bundleType || courseName || '').toLowerCase();
  if (str.includes('inversions')) types.push('inversions');
  if (str.includes('splits') || str.includes('spagat')) types.push('splits');
  if (str.includes('backbends') || str.includes('rygbøjninger') || str.includes('backbend')) types.push('backbends');
  return types;
}

/**
 * Auto-assign user role after application submission.
 * Looks up Firebase user by email and upgrades their role if appropriate.
 * Never downgrades. Merges courseTypes when trainee applies for courses.
 */
async function autoAssignRole({ email, type, yttProgramType, courseName, bundleType, applicationId, mentorshipSelected }) {
  try {
    const auth = getAuth();
    let firebaseUser;
    try {
      firebaseUser = await auth.getUserByEmail(email);
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        console.log(`[apply:role] No Firebase user for ${email} — skipping role assignment`);
        return { assigned: false, reason: 'no-firebase-user' };
      }
      throw err;
    }

    const uid = firebaseUser.uid;
    const db = getDb();
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      console.log(`[apply:role] No Firestore user doc for UID ${uid} — skipping`);
      return { assigned: false, reason: 'no-firestore-doc' };
    }

    const userData = userDoc.data();
    const currentRole = userData.role || 'member';
    const currentDetails = userData.roleDetails || {};

    // Determine target role + details from application
    let targetRole = null;
    let targetDetails = {};

    if (type === 'education') {
      targetRole = 'trainee';
      const program = mapYTTToProgram(yttProgramType);
      const method = mapYTTToMethod(yttProgramType, courseName);
      targetDetails = { program };
      if (method) targetDetails.method = method;
    } else if (type === 'course' || type === 'bundle') {
      targetRole = 'student';
      const courseTypes = detectCourseTypes(courseName, bundleType);
      if (courseTypes.length) targetDetails.courseTypes = courseTypes;
    } else if (type === 'mentorship') {
      targetRole = 'student';
      targetDetails.mentorship = true;
    }

    if (!targetRole) {
      console.log(`[apply:role] Unknown type "${type}" — skipping role assignment`);
      return { assigned: false, reason: 'unknown-type' };
    }

    // Priority check — never downgrade
    const currentPriority = getRolePriority(currentRole);
    const targetPriority = getRolePriority(targetRole);

    let finalRole = currentRole;
    let finalDetails = Object.assign({}, currentDetails);
    let changed = false;

    if (targetPriority > currentPriority) {
      // Upgrade role — preserve existing courseTypes if upgrading from student to trainee
      finalRole = targetRole;
      finalDetails = Object.assign({}, targetDetails);
      // Carry forward courseTypes from student → trainee upgrade
      if (currentRole === 'student' && targetRole === 'trainee' && currentDetails.courseTypes) {
        finalDetails.courseTypes = currentDetails.courseTypes;
      }
      if (currentRole === 'student' && targetRole === 'trainee' && currentDetails.mentorship) {
        finalDetails.mentorship = true;
      }
      changed = true;
    } else if (currentRole === targetRole) {
      // Same role — merge details
      if (targetRole === 'trainee') {
        // Merge new fields into existing trainee details
        if (targetDetails.program && !currentDetails.program) { finalDetails.program = targetDetails.program; changed = true; }
        if (targetDetails.method && !currentDetails.method) { finalDetails.method = targetDetails.method; changed = true; }
      }
      if (targetRole === 'student') {
        // Merge courseTypes arrays
        const existing = currentDetails.courseTypes || [];
        const incoming = targetDetails.courseTypes || [];
        const merged = existing.slice();
        incoming.forEach(ct => { if (merged.indexOf(ct) === -1) { merged.push(ct); changed = true; } });
        finalDetails.courseTypes = merged;
        if (targetDetails.mentorship && !currentDetails.mentorship) { finalDetails.mentorship = true; changed = true; }
      }
    } else if (currentPriority > targetPriority) {
      // Current role is higher — but still merge courseTypes if applicable
      if (currentRole === 'trainee' && (type === 'course' || type === 'bundle')) {
        const existing = currentDetails.courseTypes || [];
        const incoming = detectCourseTypes(courseName, bundleType);
        const merged = existing.slice();
        incoming.forEach(ct => { if (merged.indexOf(ct) === -1) { merged.push(ct); changed = true; } });
        if (merged.length) finalDetails.courseTypes = merged;
      }
      if (currentRole === 'trainee' && type === 'mentorship' && !currentDetails.mentorship) {
        finalDetails.mentorship = true;
        changed = true;
      }
    }

    if (!changed) {
      console.log(`[apply:role] ${email}: no role change needed (current: ${currentRole})`);
      await userRef.update({ lastApplicationId: applicationId, updated_at: new Date() });
      return { assigned: false, reason: 'no-change-needed', currentRole };
    }

    // Apply the update
    await userRef.update({
      role: finalRole,
      roleDetails: finalDetails,
      lastApplicationId: applicationId,
      updated_at: new Date()
    });

    console.log(`[apply:role] ${email}: ${currentRole} → ${finalRole} (${JSON.stringify(finalDetails)})`);

    // Audit trail
    await db.collection('role_audit').add({
      uid,
      email,
      previousRole: currentRole,
      previousRoleDetails: currentDetails,
      newRole: finalRole,
      newRoleDetails: finalDetails,
      trigger: 'application',
      applicationId,
      applicationType: type,
      yttProgramType: yttProgramType || '',
      created_at: new Date()
    });

    return { assigned: true, previousRole: currentRole, newRole: finalRole, newRoleDetails: finalDetails };
  } catch (err) {
    console.error('[apply:role] Error during auto role assignment:', err.message);
    return { assigned: false, reason: 'error', error: err.message };
  }
}

// =========================================================================
// Handler
// =========================================================================

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'Method not allowed' });
  }

  try {
    let payload;
    const contentType = (event.headers['content-type'] || '').toLowerCase();

    // Support text/plain;charset=utf-8 which the apply form sends
    if (contentType.includes('text/plain') || contentType.includes('application/json')) {
      payload = JSON.parse(event.body || '{}');
    } else {
      payload = JSON.parse(event.body || '{}');
    }

    if (!payload.applicant || !payload.applicant.email) {
      return jsonResponse(400, { ok: false, error: 'Applicant email is required' });
    }

    const applicant = payload.applicant;
    const selections = payload.selections || {};
    const applicationId = generateApplicationId();

    // Determine type
    let type = 'unknown';
    let yttProgramType = '';
    if (selections.ytt) {
      type = 'education';
      yttProgramType = detectYTTProgramType(
        selections.ytt.course_name,
        selections.ytt.course_id,
        selections.ytt.cohort_label
      );
    } else if (selections.course) {
      type = selections.course.bundle_type ? 'bundle' : 'course';
    }
    if (applicant.mentorship_selected) {
      type = type === 'unknown' ? 'mentorship' : type;
    }

    // Build application document
    const appDoc = {
      application_id: applicationId,
      email: (applicant.email || '').toLowerCase().trim(),
      first_name: (applicant.first_name || '').trim(),
      last_name: (applicant.last_name || '').trim(),
      phone: (applicant.phone || '').trim(),
      type,
      ytt_program_type: yttProgramType,
      hear_about: applicant.hear_about || '',
      hear_about_other: applicant.hear_about_other || '',
      source: payload.source || 'Apply page',
      status: 'New',
      notes: [],
      mentorship_selected: !!applicant.mentorship_selected,
      created_at: new Date(),
      updated_at: new Date()
    };

    // YTT-specific fields
    if (selections.ytt) {
      appDoc.course_id = selections.ytt.course_id || '';
      appDoc.course_name = selections.ytt.course_name || '';
      appDoc.cohort_id = selections.ytt.cohort_id || '';
      appDoc.cohort_label = selections.ytt.cohort_label || '';
      appDoc.track = selections.ytt.track || '';
      appDoc.payment_choice = selections.ytt.payment_choice || '';
    }

    // Course-specific fields
    if (selections.course) {
      appDoc.course_id = appDoc.course_id || selections.course.course_id || '';
      appDoc.course_name = appDoc.course_name || selections.course.course_name || '';
      appDoc.cohort_id = appDoc.cohort_id || selections.course.cohort_id || '';
      appDoc.cohort_label = appDoc.cohort_label || selections.course.cohort_label || '';
      appDoc.bundle_type = selections.course.bundle_type || '';
      appDoc.bundle_payment_url = selections.course.bundle_payment_url || '';
      if (!appDoc.payment_choice) {
        appDoc.payment_choice = selections.course.payment_choice || '';
      }
    }

    // Accommodation
    if (selections.accommodation) {
      appDoc.accommodation_need = selections.accommodation.need || 'no';
      appDoc.accommodation_months = selections.accommodation.months || [];
      appDoc.accommodation_payment = selections.accommodation.payment_choice || '';
    }

    // Write to Firestore
    const db = getDb();
    await db.collection('applications').add(appDoc);

    console.log(`[apply] New application: ${applicationId} (${appDoc.email})`);

    // Also create a lead entry for tracking
    const leadDoc = {
      email: appDoc.email,
      first_name: appDoc.first_name,
      last_name: appDoc.last_name,
      phone: appDoc.phone,
      type: appDoc.type,
      ytt_program_type: appDoc.ytt_program_type,
      program: appDoc.course_name || '',
      course_id: appDoc.course_id || '',
      cohort_label: appDoc.cohort_label || '',
      preferred_month: '',
      accommodation: appDoc.accommodation_need === 'yes' ? 'Yes' : 'No',
      city_country: '',
      housing_months: (appDoc.accommodation_months || []).join(', '),
      service: applicant.mentorship_selected ? 'Mentorship' : '',
      subcategories: '',
      message: '',
      source: payload.source || 'Apply page',
      status: 'New',
      notes: `Application submitted (ID: ${applicationId})`,
      converted: true,
      converted_at: new Date(),
      application_id: applicationId,
      unsubscribed: false,
      call_attempts: 0,
      sms_status: '',
      last_contact: null,
      followup_date: null,
      created_at: new Date(),
      updated_at: new Date()
    };
    await db.collection('leads').add(leadDoc);

    // Auto-assign user role based on application type
    const roleResult = await autoAssignRole({
      email: appDoc.email,
      type,
      yttProgramType,
      courseName: appDoc.course_name || '',
      bundleType: appDoc.bundle_type || '',
      applicationId,
      mentorshipSelected: !!applicant.mentorship_selected
    }).catch(err => {
      console.error('[apply] Role assignment failed:', err.message);
      return { assigned: false, reason: 'error' };
    });

    // Send notifications — must await before returning (Netlify kills Lambda after response)
    if (process.env.GMAIL_APP_PASSWORD) {
      await Promise.all([
        sendAdminNotification({
          ...leadDoc,
          notes: `NEW APPLICATION: ${applicationId}\nType: ${type}\nProgram: ${appDoc.course_name || 'N/A'}\nCohort: ${appDoc.cohort_label || 'N/A'}${roleResult.assigned ? `\nRole auto-assigned: ${roleResult.newRole} (${JSON.stringify(roleResult.newRoleDetails || {})})` : ''}`
        }).catch(err => {
          console.error('[apply] Admin notification failed:', err.message);
        }),
        sendApplicationConfirmation(appDoc.email, applicationId, appDoc.first_name).catch(err => {
          console.error('[apply] Application confirmation email failed:', err.message);
        })
      ]);
    }

    return jsonResponse(200, {
      ok: true,
      application_id: applicationId,
      message: 'Application received successfully',
      role_upgraded: roleResult.assigned || false
    });
  } catch (error) {
    console.error('[apply] Error:', error);
    return jsonResponse(500, { ok: false, error: 'Server error: ' + error.message });
  }
};
