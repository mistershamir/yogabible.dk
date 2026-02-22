/**
 * Migrate Existing Applications — Yoga Bible (Admin-only, one-time)
 *
 * POST /.netlify/functions/migrate-applications
 *
 * Auto-approves all existing applications that aren't already approved:
 *  1. Sets status to 'Approved'
 *  2. Creates Firebase account if needed
 *  3. Creates Firestore user doc if needed
 *  4. Finds or creates Mindbody client (avoids duplicates)
 *  5. Assigns roles (trainee/student) via same logic as apply.js
 *  6. Does NOT send any emails (silent migration)
 *
 * Returns a detailed report of what was done.
 *
 * GET /.netlify/functions/migrate-applications?dry_run=true — Preview only
 */

const { getDb, getAuth } = require('./shared/firestore');
const { requireAuth } = require('./shared/auth');
const { jsonResponse, optionsResponse, detectYTTProgramType } = require('./shared/utils');
const { mbFetch } = require('./shared/mb-api');

// =========================================================================
// Role logic — duplicated from apply.js for self-contained migration
// =========================================================================

const ROLE_PRIORITY = ['member', 'student', 'trainee', 'teacher', 'marketing', 'admin'];

function getRolePriority(role) {
  const idx = ROLE_PRIORITY.indexOf(role);
  return idx === -1 ? 0 : idx;
}

function mapYTTToProgram(yttProgramType) {
  if (yttProgramType === '300h') return '300h';
  return '200h';
}

function mapYTTToMethod(yttProgramType, courseName) {
  const name = (courseName || '').toLowerCase();
  if (name.includes('vinyasa')) return 'vinyasa';
  if (yttProgramType === '50h' || yttProgramType === '30h') return null;
  return 'triangle';
}

function detectCourseTypes(courseName, bundleType) {
  const types = [];
  const str = (bundleType || courseName || '').toLowerCase();
  if (str.includes('inversions')) types.push('inversions');
  if (str.includes('splits') || str.includes('spagat')) types.push('splits');
  if (str.includes('backbends') || str.includes('rygbøjninger') || str.includes('backbend')) types.push('backbends');
  return types;
}

// =========================================================================
// Mindbody Client — find or create (avoid duplicates)
// =========================================================================

async function findOrCreateMBClient({ email, firstName, lastName, phone }) {
  try {
    const queryString = new URLSearchParams({ searchText: email, limit: '10' }).toString();
    const searchData = await mbFetch(`/client/clients?${queryString}`);
    const matches = (searchData.Clients || []).filter(c =>
      c.Email && c.Email.toLowerCase() === email.toLowerCase()
    );

    if (matches.length > 0) {
      return { found: true, created: false, clientId: matches[0].Id };
    }

    // Not found → create
    const newClient = {
      FirstName: firstName || 'Unknown',
      LastName: lastName || firstName || 'Unknown',
      Email: email,
      SendAccountEmails: false // Silent migration — don't trigger MB emails
    };
    if (phone) newClient.MobilePhone = phone;

    const createData = await mbFetch('/client/addclient', {
      method: 'POST',
      body: JSON.stringify(newClient)
    });
    const created = createData.Client || {};
    return { found: false, created: true, clientId: created.Id || null };
  } catch (err) {
    return { found: false, created: false, clientId: null, error: err.message };
  }
}

/**
 * Auto-assign role for a single user. Same logic as apply.js but standalone.
 */
async function assignRoleForMigration(db, auth, { email, type, yttProgramType, courseName, bundleType, applicationId, mentorshipSelected }) {
  let firebaseUser;
  try {
    firebaseUser = await auth.getUserByEmail(email);
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      return { assigned: false, reason: 'no-firebase-user' };
    }
    throw err;
  }

  const uid = firebaseUser.uid;
  const userRef = db.collection('users').doc(uid);
  const userDoc = await userRef.get();

  if (!userDoc.exists) {
    return { assigned: false, reason: 'no-firestore-doc' };
  }

  const userData = userDoc.data();
  const currentRole = userData.role || 'member';
  const currentDetails = userData.roleDetails || {};

  // Determine target role + details
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
    return { assigned: false, reason: 'unknown-type' };
  }

  // Priority check — never downgrade
  const currentPriority = getRolePriority(currentRole);
  const targetPriority = getRolePriority(targetRole);

  let finalRole = currentRole;
  let finalDetails = Object.assign({}, currentDetails);
  let changed = false;

  if (targetPriority > currentPriority) {
    finalRole = targetRole;
    finalDetails = Object.assign({}, targetDetails);
    if (currentRole === 'student' && targetRole === 'trainee' && currentDetails.courseTypes) {
      finalDetails.courseTypes = currentDetails.courseTypes;
    }
    if (currentRole === 'student' && targetRole === 'trainee' && currentDetails.mentorship) {
      finalDetails.mentorship = true;
    }
    changed = true;
  } else if (currentRole === targetRole) {
    if (targetRole === 'trainee') {
      if (targetDetails.program && !currentDetails.program) { finalDetails.program = targetDetails.program; changed = true; }
      if (targetDetails.method && !currentDetails.method) { finalDetails.method = targetDetails.method; changed = true; }
    }
    if (targetRole === 'student') {
      const existing = currentDetails.courseTypes || [];
      const incoming = targetDetails.courseTypes || [];
      const merged = existing.slice();
      incoming.forEach(ct => { if (merged.indexOf(ct) === -1) { merged.push(ct); changed = true; } });
      finalDetails.courseTypes = merged;
      if (targetDetails.mentorship && !currentDetails.mentorship) { finalDetails.mentorship = true; changed = true; }
    }
  } else if (currentPriority > targetPriority) {
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
    await userRef.update({ lastApplicationId: applicationId, updated_at: new Date() });
    return { assigned: false, reason: 'no-change-needed', currentRole };
  }

  await userRef.update({
    role: finalRole,
    roleDetails: finalDetails,
    lastApplicationId: applicationId,
    updated_at: new Date()
  });

  // Audit trail
  await db.collection('role_audit').add({
    uid,
    email,
    previousRole: currentRole,
    previousRoleDetails: currentDetails,
    newRole: finalRole,
    newRoleDetails: finalDetails,
    trigger: 'migration',
    applicationId,
    applicationType: type,
    yttProgramType: yttProgramType || '',
    created_at: new Date()
  });

  return { assigned: true, previousRole: currentRole, newRole: finalRole, newRoleDetails: finalDetails };
}

// =========================================================================
// Handler
// =========================================================================

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  // Admin only
  const user = await requireAuth(event, ['admin']);
  if (user.error) return user.error;

  const params = event.queryStringParameters || {};
  const dryRun = params.dry_run === 'true';

  const db = getDb();
  const auth = getAuth();

  try {
    // Fetch ALL applications
    const snapshot = await db.collection('applications').get();
    const apps = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    console.log(`[migrate] Found ${apps.length} total applications (dry_run: ${dryRun})`);

    const report = {
      total: apps.length,
      already_approved: 0,
      newly_approved: 0,
      accounts_created: 0,
      user_docs_created: 0,
      mb_clients_found: 0,
      mb_clients_created: 0,
      mb_clients_failed: 0,
      roles_assigned: 0,
      roles_unchanged: 0,
      errors: [],
      details: []
    };

    // Statuses that should NOT be changed (already terminal or approved)
    const skipStatuses = ['Rejected', 'Withdrawn'];

    for (const app of apps) {
      const detail = {
        id: app.id,
        application_id: app.application_id || 'N/A',
        email: app.email,
        type: app.type,
        original_status: app.status,
        actions: []
      };

      try {
        const email = (app.email || '').toLowerCase().trim();
        if (!email) {
          detail.actions.push('SKIPPED: no email');
          report.details.push(detail);
          continue;
        }

        // Skip rejected/withdrawn — admin intentionally set those
        if (skipStatuses.includes(app.status)) {
          detail.actions.push(`SKIPPED: status is ${app.status} (intentional)`);
          report.details.push(detail);
          continue;
        }

        // 1. Approve if not already
        if (app.status === 'Approved' || app.status === 'Enrolled' || app.status === 'Completed') {
          report.already_approved++;
          detail.actions.push(`Already ${app.status}`);
        } else {
          report.newly_approved++;
          detail.actions.push(`Status: ${app.status || 'New'} → Approved`);
          if (!dryRun) {
            await db.collection('applications').doc(app.id).update({
              status: 'Approved',
              updated_at: new Date(),
              updated_by: 'migration-script'
            });
          }
        }

        // 2. Ensure Firebase account exists
        let isNewAccount = false;
        let firebaseUid = null;
        try {
          const fbUser = await auth.getUserByEmail(email);
          firebaseUid = fbUser.uid;
          detail.actions.push('Firebase account exists');
        } catch (err) {
          if (err.code === 'auth/user-not-found') {
            const fullName = [app.first_name, app.last_name].filter(Boolean).join(' ');
            if (!dryRun) {
              const newUser = await auth.createUser({
                email,
                displayName: fullName || undefined
              });
              firebaseUid = newUser.uid;
              // Generate password reset link (stored for potential manual re-send, not emailed)
              await auth.generatePasswordResetLink(email);
            }
            isNewAccount = true;
            report.accounts_created++;
            detail.actions.push('Created Firebase account');
          } else {
            throw err;
          }
        }

        // 3. Ensure Firestore user doc exists
        if (firebaseUid) {
          const userRef = db.collection('users').doc(firebaseUid);
          const userDoc = await userRef.get();
          if (!userDoc.exists) {
            if (!dryRun) {
              await userRef.set({
                uid: firebaseUid,
                email,
                displayName: [app.first_name, app.last_name].filter(Boolean).join(' '),
                firstName: app.first_name || '',
                lastName: app.last_name || '',
                phone: app.phone || '',
                role: 'member',
                roleDetails: {},
                createdAt: new Date(),
                updatedAt: new Date()
              });
            }
            report.user_docs_created++;
            detail.actions.push('Created Firestore user doc');
          }
        }

        // 4. Ensure Mindbody client exists (find or create — avoid duplicates)
        if (!dryRun) {
          const mbResult = await findOrCreateMBClient({
            email,
            firstName: app.first_name || '',
            lastName: app.last_name || '',
            phone: app.phone || ''
          });
          if (mbResult.found) {
            report.mb_clients_found++;
            detail.actions.push(`MB client exists (ID: ${mbResult.clientId})`);
          } else if (mbResult.created) {
            report.mb_clients_created++;
            detail.actions.push(`Created MB client (ID: ${mbResult.clientId})`);
          } else {
            report.mb_clients_failed++;
            detail.actions.push(`MB client failed: ${mbResult.error || 'unknown'}`);
          }
          // Store MB client ID on application doc
          if (mbResult.clientId) {
            await db.collection('applications').doc(app.id).update({
              mb_client_id: mbResult.clientId,
              mb_client_created: mbResult.created
            });
          }
        } else {
          detail.actions.push('MB client: would check/create (dry run)');
        }

        // 5. Assign role
        if (!dryRun && firebaseUid) {
          const roleResult = await assignRoleForMigration(db, auth, {
            email,
            type: app.type || 'unknown',
            yttProgramType: app.ytt_program_type || '',
            courseName: app.course_name || '',
            bundleType: app.bundle_type || '',
            applicationId: app.application_id || app.id,
            mentorshipSelected: !!app.mentorship_selected
          });

          if (roleResult.assigned) {
            report.roles_assigned++;
            detail.actions.push(`Role: ${roleResult.previousRole} → ${roleResult.newRole} (${JSON.stringify(roleResult.newRoleDetails || {})})`);
          } else {
            report.roles_unchanged++;
            detail.actions.push(`Role unchanged: ${roleResult.reason} (${roleResult.currentRole || 'N/A'})`);
          }
        } else if (dryRun) {
          detail.actions.push('Role assignment: would run (dry run)');
        }

        // 6. Mark acceptance_email_sent = false (no email sent during migration)
        if (!dryRun && !app.acceptance_email_sent) {
          await db.collection('applications').doc(app.id).update({
            acceptance_email_sent: false,
            migrated_at: new Date()
          });
          detail.actions.push('Marked migrated (no email sent)');
        }

      } catch (err) {
        detail.actions.push(`ERROR: ${err.message}`);
        report.errors.push({ id: app.id, email: app.email, error: err.message });
      }

      report.details.push(detail);
    }

    // Migration audit entry
    if (!dryRun) {
      await db.collection('role_audit').add({
        trigger: 'bulk-migration',
        admin_email: user.email,
        total_applications: report.total,
        newly_approved: report.newly_approved,
        accounts_created: report.accounts_created,
        user_docs_created: report.user_docs_created,
        mb_clients_found: report.mb_clients_found,
        mb_clients_created: report.mb_clients_created,
        mb_clients_failed: report.mb_clients_failed,
        roles_assigned: report.roles_assigned,
        errors_count: report.errors.length,
        created_at: new Date()
      });
    }

    console.log(`[migrate] Done. Approved: ${report.newly_approved}, Accounts: ${report.accounts_created}, MB clients: ${report.mb_clients_created} new / ${report.mb_clients_found} existing, Roles: ${report.roles_assigned}, Errors: ${report.errors.length}`);

    return jsonResponse(200, {
      ok: true,
      dry_run: dryRun,
      summary: {
        total: report.total,
        already_approved: report.already_approved,
        newly_approved: report.newly_approved,
        accounts_created: report.accounts_created,
        user_docs_created: report.user_docs_created,
        mb_clients_found: report.mb_clients_found,
        mb_clients_created: report.mb_clients_created,
        mb_clients_failed: report.mb_clients_failed,
        roles_assigned: report.roles_assigned,
        roles_unchanged: report.roles_unchanged,
        errors: report.errors.length
      },
      details: report.details,
      errors: report.errors
    });
  } catch (error) {
    console.error('[migrate] Fatal error:', error);
    return jsonResponse(500, { ok: false, error: error.message });
  }
};
