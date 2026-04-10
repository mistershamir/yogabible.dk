/**
 * Netlify Function: POST /.netlify/functions/activate-applicant
 *
 * Creates a Yoga Bible member area account from an application:
 *  1. Creates Firebase Auth user (or finds existing)
 *  2. Creates Firestore user doc with role + roleDetails (incl. cohort)
 *  3. Finds or creates Mindbody client
 *  4. Assigns role: trainee (for YTT) or student (for courses)
 *  5. Sends welcome email with password-reset link
 *  6. Marks application as Enrolled + stores firebase_uid
 *
 * Body: { applicationId: "firestore-doc-id" }
 * Requires: admin role
 */

const { getDb, getAuth } = require('./shared/firestore');
const { requireAuth } = require('./shared/auth');
const { jsonResponse, optionsResponse, detectYTTProgramType } = require('./shared/utils');
const { mbFetch } = require('./shared/mb-api');
const { sendCustomEmail } = require('./shared/email-service');

// Ordering: lowest → highest priority.
// Must stay in sync with src/js/course-admin.js ROLE_PRIORITY
// and netlify/functions/applications.js protectedRoles.
const ROLE_PRIORITY = ['member', 'student', 'trainee', 'teacher', 'marketing', 'instructor', 'admin', 'owner'];

function getRolePriority(role) {
  var idx = ROLE_PRIORITY.indexOf(role);
  return idx === -1 ? 0 : idx;
}

function mapYTTToProgram(yttProgramType) {
  if (yttProgramType === '300h') return '300h';
  return '200h';
}

function mapYTTToMethod(yttProgramType, courseName) {
  var name = (courseName || '').toLowerCase();
  if (name.includes('vinyasa')) return 'vinyasa';
  if (yttProgramType === '50h' || yttProgramType === '30h') return null;
  return 'triangle';
}

function detectCourseTypes(courseName, bundleType) {
  var types = [];
  var str = (bundleType || courseName || '').toLowerCase();
  if (str.includes('inversions')) types.push('inversions');
  if (str.includes('splits') || str.includes('spagat')) types.push('splits');
  if (str.includes('backbends') || str.includes('rygbøjninger') || str.includes('backbend')) types.push('backbends');
  return types;
}

/**
 * Build a cohort identifier from application data.
 * Format: "YYYY-MM-{format}" e.g. "2026-01-18W", "2026-04-4W"
 */
function buildCohortId(app) {
  var cohortId = app.cohort_id || '';
  var yttType = app.ytt_program_type || '';

  // If we have a cohort_id from the catalog, use it as-is (e.g., "2026-03")
  if (cohortId) {
    // Append the program format shorthand
    var suffix = '';
    if (yttType === '18-week') suffix = '-18W';
    else if (yttType === '4-week') suffix = '-4W';
    else if (yttType === '8-week') suffix = '-8W';
    else if (yttType === '300h') suffix = '-300H';
    else if (yttType === '50h') suffix = '-50H';
    else if (yttType === '30h') suffix = '-30H';
    return cohortId + suffix;
  }

  return '';
}

/**
 * Find or create Mindbody client (avoid duplicates).
 */
async function findOrCreateMBClient({ email, firstName, lastName, phone }) {
  try {
    var queryString = new URLSearchParams({ searchText: email, limit: '10' }).toString();
    var searchData = await mbFetch('/client/clients?' + queryString);
    var matches = (searchData.Clients || []).filter(function (c) {
      return c.Email && c.Email.toLowerCase() === email.toLowerCase();
    });

    if (matches.length > 0) {
      return { found: true, created: false, clientId: matches[0].Id };
    }

    var newClient = {
      FirstName: firstName || 'Unknown',
      LastName: lastName || firstName || 'Unknown',
      Email: email,
      SendAccountEmails: true
    };
    if (phone) newClient.MobilePhone = phone;

    var createData = await mbFetch('/client/addclient', {
      method: 'POST',
      body: JSON.stringify(newClient)
    });
    var created = createData.Client || {};
    return { found: false, created: true, clientId: created.Id || null };
  } catch (err) {
    return { found: false, created: false, clientId: null, error: err.message };
  }
}

/**
 * Send welcome email with password-reset link.
 */
async function sendWelcomeEmail(auth, app, isNewAccount) {
  var email = app.email;
  var firstName = app.first_name || '';
  var resetLink = await auth.generatePasswordResetLink(email);

  var subject = 'Din Yoga Bible medlemsprofil er klar';

  var bodyHtml =
    '<p>Hej ' + (firstName || 'der') + ',</p>' +
    '<p>Vi har oprettet en <strong>Yoga Bible medlemsprofil</strong> til dig. ' +
    'Her kan du tilgå dit kursusindhold, live sessions, optagelser og meget mere.</p>' +
    '<p style="margin:24px 0;">' +
    '<a href="' + resetLink + '" style="display:inline-block;background:#f75c03;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:16px;">' +
    'Opret din adgangskode' +
    '</a></p>' +
    '<p style="color:#6F6A66;font-size:14px;">Linket udløber efter 24 timer. Hvis du allerede har en adgangskode, kan du logge ind direkte på <a href="https://yogabible.dk/member" style="color:#f75c03;">yogabible.dk/member</a>.</p>' +
    '<hr style="border:none;border-top:1px solid #E8E4E0;margin:24px 0;">' +
    '<p style="color:#6F6A66;font-size:13px;">' +
    '🇬🇧 <em>Your Yoga Bible member profile has been created. Click the button above to set your password. ' +
    'If the link has expired, go to <a href="https://yogabible.dk/member" style="color:#f75c03;">yogabible.dk/member</a> and use "Forgot password".</em></p>';

  var bodyPlain =
    'Hej ' + (firstName || 'der') + ',\n\n' +
    'Vi har oprettet en Yoga Bible medlemsprofil til dig.\n\n' +
    'Opret din adgangskode her: ' + resetLink + '\n\n' +
    'Linket udløber efter 24 timer.\n\n' +
    '---\n' +
    'Your Yoga Bible member profile has been created. Set your password: ' + resetLink;

  await sendCustomEmail({
    to: email,
    subject: subject,
    bodyHtml: bodyHtml,
    bodyPlain: bodyPlain,
    includeSignature: true,
    includeUnsubscribe: false
  });

  return resetLink;
}

// =========================================================================
// Handler
// =========================================================================

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();
  if (event.httpMethod !== 'POST') return jsonResponse(405, { ok: false, error: 'POST only' });

  var user = await requireAuth(event, ['admin']);
  if (user.error) return user.error;

  var body = JSON.parse(event.body || '{}');
  var applicationId = body.applicationId;
  if (!applicationId) {
    return jsonResponse(400, { ok: false, error: 'Missing applicationId' });
  }

  var db = getDb();
  var auth = getAuth();

  try {
    // 1. Load the application
    var appDoc = await db.collection('applications').doc(applicationId).get();
    if (!appDoc.exists) {
      return jsonResponse(404, { ok: false, error: 'Application not found' });
    }
    var app = { id: appDoc.id, ...appDoc.data() };
    var email = (app.email || '').toLowerCase().trim();

    if (!email) {
      return jsonResponse(400, { ok: false, error: 'Application has no email' });
    }

    var report = { actions: [] };

    // 2. Create or find Firebase user
    var isNewAccount = false;
    var firebaseUid = null;

    try {
      var fbUser = await auth.getUserByEmail(email);
      firebaseUid = fbUser.uid;
      report.actions.push('Firebase account already exists');
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        var fullName = [app.first_name, app.last_name].filter(Boolean).join(' ');
        var newUser = await auth.createUser({
          email: email,
          displayName: fullName || undefined
        });
        firebaseUid = newUser.uid;
        isNewAccount = true;
        report.actions.push('Created Firebase account');
      } else {
        throw err;
      }
    }

    // 3. Create or update Firestore user doc
    var userRef = db.collection('users').doc(firebaseUid);
    var userDoc = await userRef.get();

    // Determine role + roleDetails
    var appType = app.type || '';
    var targetRole = 'member';
    var targetDetails = {};
    var cohortId = buildCohortId(app);

    if (appType === 'education' || appType === 'ytt') {
      targetRole = 'trainee';
      var program = mapYTTToProgram(app.ytt_program_type);
      var method = mapYTTToMethod(app.ytt_program_type, app.course_name);
      targetDetails = { program: program };
      if (method) targetDetails.method = method;
      if (cohortId) targetDetails.cohort = cohortId;
    } else if (appType === 'course' || appType === 'bundle') {
      targetRole = 'student';
      var courseTypes = detectCourseTypes(app.course_name, app.bundle_type);
      if (courseTypes.length) targetDetails.courseTypes = courseTypes;
    } else if (appType === 'mentorship') {
      targetRole = 'student';
      targetDetails.mentorship = true;
    }

    var previousRole = 'none';
    var actualNewRole = targetRole;

    if (!userDoc.exists) {
      // New user doc — safe to set role directly (no existing role to overwrite)
      await userRef.set({
        uid: firebaseUid,
        email: email,
        displayName: [app.first_name, app.last_name].filter(Boolean).join(' '),
        firstName: app.first_name || '',
        lastName: app.last_name || '',
        phone: app.phone || '',
        role: targetRole,
        roleDetails: targetDetails,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      report.actions.push('Created user doc with role: ' + targetRole);
    } else {
      // Existing user — merge role (never downgrade)
      var existingData = userDoc.data();
      var currentRole = existingData.role || 'member';
      var currentDetails = existingData.roleDetails || {};
      var currentPriority = getRolePriority(currentRole);
      var targetPriority = getRolePriority(targetRole);
      previousRole = currentRole;

      var finalRole = currentRole;
      var finalDetails = Object.assign({}, currentDetails);
      var changed = false;

      if (targetPriority > currentPriority) {
        finalRole = targetRole;
        finalDetails = Object.assign({}, currentDetails, targetDetails);
        changed = true;
      } else if (currentRole === targetRole) {
        // Merge details
        if (targetDetails.program && !currentDetails.program) { finalDetails.program = targetDetails.program; changed = true; }
        if (targetDetails.method && !currentDetails.method) { finalDetails.method = targetDetails.method; changed = true; }
        if (targetDetails.cohort && currentDetails.cohort !== targetDetails.cohort) { finalDetails.cohort = targetDetails.cohort; changed = true; }
        if (targetDetails.courseTypes) {
          var existing = currentDetails.courseTypes || [];
          var merged = existing.slice();
          targetDetails.courseTypes.forEach(function (ct) { if (merged.indexOf(ct) === -1) { merged.push(ct); changed = true; } });
          finalDetails.courseTypes = merged;
        }
      }

      if (changed) {
        await userRef.update({ role: finalRole, roleDetails: finalDetails, updatedAt: new Date() });
        actualNewRole = finalRole;
        report.actions.push('Updated role: ' + currentRole + ' → ' + finalRole);
      } else {
        actualNewRole = currentRole;
        report.actions.push('Role unchanged: ' + currentRole);
      }
    }

    // 4. Find or create Mindbody client
    var mbResult = await findOrCreateMBClient({
      email: email,
      firstName: app.first_name || '',
      lastName: app.last_name || '',
      phone: app.phone || ''
    });
    if (mbResult.clientId) {
      report.actions.push(mbResult.created ? 'Created MB client' : 'MB client exists');
      await db.collection('applications').doc(applicationId).update({
        mb_client_id: mbResult.clientId
      });
    }

    // 5. Send welcome email (only for new accounts)
    if (isNewAccount) {
      await sendWelcomeEmail(auth, app, isNewAccount);
      report.actions.push('Sent welcome email with password-reset link');
    } else {
      report.actions.push('Account already existed — no welcome email sent');
    }

    // 6. Update application status
    await db.collection('applications').doc(applicationId).update({
      status: 'Enrolled',
      firebase_uid: firebaseUid,
      activated_at: new Date(),
      activated_by: user.email,
      updated_at: new Date(),
      updated_by: user.email
    });
    report.actions.push('Application status → Enrolled');

    // 7. Audit trail
    await db.collection('role_audit').add({
      uid: firebaseUid,
      email: email,
      previousRole: previousRole,
      newRole: actualNewRole,
      requestedRole: targetRole,
      newRoleDetails: targetDetails,
      trigger: 'activate-applicant',
      applicationId: applicationId,
      applicationType: appType,
      cohort: cohortId || null,
      admin_email: user.email,
      created_at: new Date()
    });

    console.log('[activate-applicant]', email, '→', targetRole, cohortId || '(no cohort)', 'by', user.email);

    return jsonResponse(200, {
      ok: true,
      isNewAccount: isNewAccount,
      role: targetRole,
      cohort: cohortId || null,
      report: report
    });

  } catch (err) {
    console.error('[activate-applicant]', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};
