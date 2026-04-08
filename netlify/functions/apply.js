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
const { sendAdminNotification, sendRawEmail, getSignatureHtml, getEnglishNoteHtml } = require('./shared/email-service');
const { CONFIG } = require('./shared/config');
const { mbFetch } = require('./shared/mb-api');
const { createMilestonePost } = require('./shared/social-sync');

// =========================================================================
// Mindbody Client — find or create (avoid duplicates)
// =========================================================================

/**
 * Look up a Mindbody client by email. If not found, create one.
 * Returns { found: bool, created: bool, clientId: string|number|null }
 */
async function findOrCreateMBClient({ email, firstName, lastName, phone }) {
  try {
    // 1. Search by email
    const queryString = new URLSearchParams({ searchText: email, limit: '10' }).toString();
    const searchData = await mbFetch(`/client/clients?${queryString}`);
    const matches = (searchData.Clients || []).filter(c =>
      c.Email && c.Email.toLowerCase() === email.toLowerCase()
    );

    if (matches.length > 0) {
      console.log(`[apply:mb] Found existing MB client for ${email} (ID: ${matches[0].Id})`);
      return { found: true, created: false, clientId: matches[0].Id };
    }

    // 2. Not found → create
    const newClient = {
      FirstName: firstName || 'Unknown',
      LastName: lastName || firstName || 'Unknown',
      Email: email,
      SendAccountEmails: true
    };
    if (phone) newClient.MobilePhone = phone;

    const createData = await mbFetch('/client/addclient', {
      method: 'POST',
      body: JSON.stringify(newClient)
    });
    const created = createData.Client || {};
    console.log(`[apply:mb] Created MB client for ${email} (ID: ${created.Id})`);
    return { found: false, created: true, clientId: created.Id || null };
  } catch (err) {
    // Don't let MB failure block the entire application
    console.error(`[apply:mb] Error for ${email}:`, err.message);
    return { found: false, created: false, clientId: null, error: err.message };
  }
}

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
// Auto-Acceptance Email (sent immediately on application submission)
// =========================================================================

async function sendAutoAcceptanceEmail({ email, firstName, programName, isNewAccount, passwordResetLink, applicationId }) {
  const siteUrl = CONFIG.SITE_URL || 'https://yogabible.dk';
  const orange = '#f75c03';

  let html = '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.65;font-size:16px;">';

  // Congratulations header
  html += '<div style="text-align:center;padding:24px 0 16px;">';
  html += '<div style="font-size:48px;margin-bottom:8px;">&#127881;</div>';
  html += '<h1 style="margin:0;font-size:24px;color:' + orange + ';">Tillykke, ' + (firstName || 'der') + '!</h1>';
  html += '</div>';

  // Danish content
  html += '<p>Vi er glade for at kunne meddele, at din ans&oslash;gning til <strong>' + programName + '</strong> er blevet godkendt.</p>';
  html += '<p>Du har nu adgang til din personlige profil og vores medlemsomr&aring;de, hvor du kan:</p>';

  html += '<ul style="padding-left:20px;margin:12px 0;">';
  html += '<li style="margin:6px 0;">Se dine hold og pass</li>';
  html += '<li style="margin:6px 0;">Tilg&aring; ugentlige skemaer</li>';
  html += '<li style="margin:6px 0;">L&aelig;se kursusmateriale og ressourcer</li>';
  html += '<li style="margin:6px 0;">Udfylde ansvarsfraskrivelse og dokumenter</li>';
  html += '</ul>';

  // Password set link for new accounts
  if (isNewAccount && passwordResetLink) {
    html += '<div style="margin:20px 0;padding:16px;background:#FFF3E0;border-left:3px solid ' + orange + ';border-radius:4px;">';
    html += '<strong>Opret din adgangskode:</strong><br>';
    html += '<p style="margin:8px 0 0;">Da dette er din f&oslash;rste gang, skal du oprette en adgangskode for at logge ind:</p>';
    html += '<a href="' + passwordResetLink + '" style="display:inline-block;margin-top:12px;padding:12px 24px;background:' + orange + ';color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">Opret adgangskode &rarr;</a>';
    html += '</div>';
  }

  // CTA buttons
  html += '<div style="margin:24px 0;text-align:center;">';
  html += '<a href="' + siteUrl + '/profile" style="display:inline-block;margin:6px;padding:12px 24px;background:' + orange + ';color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">G&aring; til din profil &rarr;</a>';
  html += '<a href="' + siteUrl + '/member" style="display:inline-block;margin:6px;padding:12px 24px;background:#0F0F0F;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">Medlemsomr&aring;de &rarr;</a>';
  html += '</div>';

  html += '<p style="color:#666;font-size:14px;">Har du sp&oslash;rgsm&aring;l? Svar bare p&aring; denne e-mail, s&aring; vender vi hurtigt tilbage.</p>';

  // English note
  html += getEnglishNoteHtml();

  // Brief English summary
  html += '<div style="margin-top:12px;padding:14px;background:#F5F3F0;border-radius:6px;font-size:14px;color:#666;">';
  html += '<strong>In English:</strong> Congratulations! Your application for ' + programName + ' has been approved. ';
  if (isNewAccount && passwordResetLink) {
    html += 'Please <a href="' + passwordResetLink + '" style="color:' + orange + ';">set your password</a> to log in. ';
  }
  html += 'Visit your <a href="' + siteUrl + '/profile" style="color:' + orange + ';">profile</a> and <a href="' + siteUrl + '/member" style="color:' + orange + ';">member area</a> to get started.';
  html += '</div>';

  // Signature
  html += getSignatureHtml();
  html += '</div>';

  // Plain text version
  let text = 'Tillykke, ' + (firstName || 'der') + '!\n\n';
  text += 'Din ansogning til ' + programName + ' er blevet godkendt.\n\n';
  text += 'Du har nu adgang til din profil og medlemsomraade:\n';
  text += '- Profil: ' + siteUrl + '/profile\n';
  text += '- Medlemsomraade: ' + siteUrl + '/member\n';
  if (isNewAccount && passwordResetLink) {
    text += '\nOpret din adgangskode: ' + passwordResetLink + '\n';
  }
  text += '\nHar du sporgsmal? Svar bare paa denne e-mail.\n';
  text += '\nCongratulations! Your application for ' + programName + ' has been approved.\n';
  text += 'Profile: ' + siteUrl + '/profile\n';
  text += 'Member area: ' + siteUrl + '/member\n';

  const subject = 'Tillykke! Din ansogning er godkendt \u2014 ' + programName;
  const result = await sendRawEmail({ to: email, subject, html, text });

  // Log to email_log
  const db = getDb();
  await db.collection('email_log').add({
    to: email,
    subject,
    template_id: 'acceptance_email_auto',
    application_id: applicationId,
    sent_at: new Date(),
    status: 'sent',
    new_account_created: isNewAccount
  });

  console.log(`[apply] Acceptance email sent to ${email} (new account: ${isNewAccount})`);
  return result;
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
      status: 'Approved',
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

    // ── Auto-Accept: Create account if needed → assign role → send acceptance email ──

    const auth = getAuth();
    let isNewAccount = false;
    let passwordResetLink = null;
    const fullName = [appDoc.first_name, appDoc.last_name].filter(Boolean).join(' ');

    // 1. Ensure Firebase account exists (create if not)
    try {
      await auth.getUserByEmail(appDoc.email);
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        const newUser = await auth.createUser({
          email: appDoc.email,
          displayName: fullName || undefined
        });
        isNewAccount = true;
        passwordResetLink = await auth.generatePasswordResetLink(appDoc.email);
        console.log(`[apply] Created Firebase account for ${appDoc.email} (uid: ${newUser.uid})`);

        // Ensure Firestore user doc exists for new accounts (so autoAssignRole can work)
        const userRef = db.collection('users').doc(newUser.uid);
        const userDoc = await userRef.get();
        if (!userDoc.exists) {
          await userRef.set({
            uid: newUser.uid,
            email: appDoc.email,
            displayName: fullName,
            firstName: appDoc.first_name,
            lastName: appDoc.last_name,
            phone: appDoc.phone,
            role: 'member',
            roleDetails: {},
            createdAt: new Date(),
            updatedAt: new Date()
          }, { merge: true });
          console.log(`[apply] Created Firestore user doc for ${appDoc.email}`);
        }
      } else {
        console.error('[apply] Firebase user lookup error:', err.message);
      }
    }

    // 2. Ensure Mindbody client exists (find or create — avoid duplicates)
    const mbResult = await findOrCreateMBClient({
      email: appDoc.email,
      firstName: appDoc.first_name,
      lastName: appDoc.last_name,
      phone: appDoc.phone
    });

    // Store MB client ID on the application doc for reference
    if (mbResult.clientId) {
      const appSnapshot = await db.collection('applications')
        .where('application_id', '==', applicationId)
        .limit(1)
        .get();
      if (!appSnapshot.empty) {
        await appSnapshot.docs[0].ref.update({
          mb_client_id: mbResult.clientId,
          mb_client_created: mbResult.created
        });
      }
    }

    // 3. Auto-assign role (now guaranteed to have a Firebase account)
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

    // 4. Send acceptance email + admin notification
    if (process.env.GMAIL_APP_PASSWORD) {
      await Promise.all([
        sendAdminNotification({
          ...leadDoc,
          notes: `NEW APPLICATION (AUTO-APPROVED): ${applicationId}\nType: ${type}\nProgram: ${appDoc.course_name || 'N/A'}\nCohort: ${appDoc.cohort_label || 'N/A'}${roleResult.assigned ? `\nRole: ${roleResult.newRole} (${JSON.stringify(roleResult.newRoleDetails || {})})` : ''}${isNewAccount ? '\nNew Firebase account created' : ''}${mbResult.clientId ? `\nMB Client: ${mbResult.clientId}${mbResult.created ? ' (new)' : ' (existing)'}` : '\nMB Client: failed'}`
        }).catch(err => {
          console.error('[apply] Admin notification failed:', err.message);
        }),
        sendAutoAcceptanceEmail({
          email: appDoc.email,
          firstName: appDoc.first_name,
          programName: appDoc.course_name || appDoc.ytt_program_type || 'Yoga Bible',
          isNewAccount,
          passwordResetLink,
          applicationId
        }).catch(err => {
          console.error('[apply] Acceptance email failed:', err.message);
        })
      ]);
    }

    // 5. Update application with acceptance email flag
    // Find the doc we just created by application_id
    const appSnapshot = await db.collection('applications')
      .where('application_id', '==', applicationId)
      .limit(1)
      .get();
    if (!appSnapshot.empty) {
      await appSnapshot.docs[0].ref.update({
        acceptance_email_sent: true,
        acceptance_email_sent_at: new Date(),
        updated_at: new Date()
      });
    }

    // 6. Social media: create milestone post (non-blocking)
    createMilestonePost('application_received', {
      program: appDoc.ytt_program_type || appDoc.course_name || 'YTT',
      applicationId
    }).catch(err => {
      console.error('[apply] Social milestone error (non-blocking):', err.message);
    });

    return jsonResponse(200, {
      ok: true,
      application_id: applicationId,
      message: 'Application approved and accepted',
      role_upgraded: roleResult.assigned || false,
      new_account_created: isNewAccount,
      mb_client_id: mbResult.clientId || null,
      mb_client_created: mbResult.created || false
    });
  } catch (error) {
    console.error('[apply] Error:', error);
    return jsonResponse(500, { ok: false, error: 'Server error: ' + error.message });
  }
};
