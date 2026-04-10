/**
 * Send Acceptance Email — Yoga Bible
 * Sends acceptance/welcome email to approved applicants.
 * Creates Firebase account if one doesn't exist, includes password-set link.
 *
 * POST /.netlify/functions/send-acceptance-email
 * Body: { applicationId }
 */

const { requireAuth } = require('./shared/auth');
const { getDb, getAuth } = require('./shared/firestore');
const { sendRawEmail, getSignatureHtml, getEnglishNoteHtml } = require('./shared/email-service');
const { jsonResponse, optionsResponse } = require('./shared/utils');
const { CONFIG } = require('./shared/config');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();
  if (event.httpMethod !== 'POST') return jsonResponse(405, { ok: false, error: 'Method not allowed' });

  const authResult = await requireAuth(event, ['admin', 'marketing']);
  if (authResult.error) return authResult.error;

  try {
    const payload = JSON.parse(event.body || '{}');

    if (!payload.applicationId) {
      return jsonResponse(400, { ok: false, error: 'applicationId is required' });
    }

    const db = getDb();
    const auth = getAuth();

    // Look up application
    const appDoc = await db.collection('applications').doc(payload.applicationId).get();
    if (!appDoc.exists) {
      return jsonResponse(404, { ok: false, error: 'Application not found' });
    }

    const app = appDoc.data();
    if (!app.email) {
      return jsonResponse(400, { ok: false, error: 'Application has no email address' });
    }

    const firstName = app.first_name || '';
    const fullName = [firstName, app.last_name || ''].filter(Boolean).join(' ');
    const programName = app.course_name || app.program_type || 'Yoga Teacher Training';

    // Check if Firebase account exists, create if not
    let isNewAccount = false;
    let passwordResetLink = null;
    let firebaseUid = null;

    try {
      const existingUser = await auth.getUserByEmail(app.email);
      firebaseUid = existingUser.uid;
      // Account exists — no need to create
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        // Create new Firebase account
        const newUser = await auth.createUser({
          email: app.email,
          displayName: fullName || undefined
        });
        firebaseUid = newUser.uid;
        isNewAccount = true;
      } else {
        throw err;
      }
    }

    // Generate password reset link (works for both new and existing accounts)
    // For new accounts this lets them set their first password
    // For existing accounts this lets them reset if needed
    if (isNewAccount) {
      passwordResetLink = await auth.generatePasswordResetLink(app.email);
    }

    // ── Auto-assign role based on application type ──
    // Determines role + roleDetails from the application data
    if (firebaseUid) {
      const programType = (app.program_type || '').toLowerCase();
      let role = 'member';
      const roleDetails = {};

      if (programType === 'ytt' || programType === 'education') {
        role = 'trainee';
        roleDetails.program = '200h'; // default YTT program
        roleDetails.method = 'triangle'; // default method
        if (app.cohort_label || app.cohort) {
          roleDetails.cohort = app.cohort_label || app.cohort;
        }
      } else if (programType === 'course' || programType === 'bundle') {
        role = 'student';
        // Map course name to courseType if possible
        const courseNameLower = (app.course_name || '').toLowerCase();
        const courseTypeMap = {
          'inversions': 'inversions', 'splits': 'splits', 'spagat': 'splits',
          'backbends': 'backbends', 'rygbøjninger': 'backbends',
          'handstands': 'handstands', 'håndstand': 'handstands',
          'arm balances': 'armbalances', 'armbalancer': 'armbalances',
          'prenatal': 'prenatal', 'gravid': 'prenatal'
        };
        const matchedType = Object.keys(courseTypeMap).find(k => courseNameLower.includes(k));
        if (matchedType) {
          roleDetails.courseTypes = [courseTypeMap[matchedType]];
        }
      } else if (programType === 'mentorship') {
        role = 'student';
        roleDetails.mentorship = true;
      }

      // Write role to Firestore users collection (merge to preserve existing data)
      const userRef = db.collection('users').doc(firebaseUid);
      const userDoc = await userRef.get();
      const existingRole = userDoc.exists ? (userDoc.data().role || 'member') : 'member';

      // Only upgrade role, never downgrade (don't overwrite teacher/instructor/admin/owner with trainee).
      // Must stay in sync with src/js/course-admin.js ROLE_PRIORITY.
      // NOTE: previously missing `owner` and `instructor` meant those roles returned
      // `undefined` → 0 and could be silently overwritten by any incoming role.
      const rolePriority = { member: 0, student: 1, trainee: 2, teacher: 3, marketing: 4, instructor: 5, admin: 6, owner: 7 };
      const incomingPriority = rolePriority[role];
      const existingPriority = rolePriority[existingRole];
      // Use nullish coalescing so legitimate 0 (member) doesn't get clobbered,
      // and unknown roles default to -1 (never overwrite a known role).
      const safeIncoming = incomingPriority !== undefined ? incomingPriority : -1;
      const safeExisting = existingPriority !== undefined ? existingPriority : -1;
      if (safeIncoming >= safeExisting) {
        await userRef.set({
          role: role,
          roleDetails: roleDetails,
          updatedAt: new Date()
        }, { merge: true });
      }

      // Log the role change for audit
      await db.collection('role_changes').add({
        userId: firebaseUid,
        email: app.email,
        previousRole: existingRole,
        newRole: role,
        roleDetails: roleDetails,
        source: 'acceptance_email',
        applicationId: payload.applicationId,
        changedAt: new Date()
      });
    }

    // Build acceptance email HTML
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

    // Send email
    const subject = 'Tillykke! Din ansogning er godkendt — ' + programName;
    const result = await sendRawEmail({
      to: app.email,
      subject,
      html,
      text
    });

    // Log to email_log
    await db.collection('email_log').add({
      to: app.email,
      subject,
      template_id: 'acceptance_email',
      application_id: payload.applicationId,
      sent_at: new Date(),
      status: 'sent',
      new_account_created: isNewAccount
    });

    // Update application (link Firebase UID + mark email sent)
    const appUpdate = {
      acceptance_email_sent: true,
      acceptance_email_sent_at: new Date(),
      updated_at: new Date()
    };
    if (firebaseUid) {
      appUpdate.firebase_uid = firebaseUid;
    }
    await db.collection('applications').doc(payload.applicationId).update(appUpdate);

    return jsonResponse(200, {
      ok: true,
      newAccountCreated: isNewAccount,
      firebaseUid: firebaseUid || null,
      ...result
    });
  } catch (err) {
    console.error('[send-acceptance-email] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};
