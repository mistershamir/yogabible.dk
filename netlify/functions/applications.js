/**
 * Applications CRUD API — Yoga Bible (Admin)
 * Authenticated endpoint for managing applications.
 *
 * GET    /.netlify/functions/applications          — List all
 * GET    /.netlify/functions/applications?id=X     — Get single
 * PUT    /.netlify/functions/applications          — Update
 * DELETE /.netlify/functions/applications          — Delete (admin only)
 */

const { getDb, getAuth } = require('./shared/firestore');
const { requireAuth } = require('./shared/auth');
const { jsonResponse, optionsResponse } = require('./shared/utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  const user = await requireAuth(event, ['admin', 'marketing']);
  if (user.error) return user.error;

  const params = event.queryStringParameters || {};
  const db = getDb();

  try {
    switch (event.httpMethod) {
      case 'GET':
        return params.id ? getOne(db, params.id) : getAll(db, params);
      case 'PUT':
        return update(db, event, user);
      case 'DELETE':
        if (user.role !== 'admin') {
          return jsonResponse(403, { ok: false, error: 'Only admins can delete applications' });
        }
        return remove(db, event);
      default:
        return jsonResponse(405, { ok: false, error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('[applications] Error:', error);
    return jsonResponse(500, { ok: false, error: error.message });
  }
};

async function getAll(db, params) {
  let query = db.collection('applications');

  if (params.status) query = query.where('status', '==', params.status);
  if (params.type) query = query.where('type', '==', params.type);
  if (params.ytt_program_type) query = query.where('ytt_program_type', '==', params.ytt_program_type);
  if (params.course_id) query = query.where('course_id', '==', params.course_id);
  if (params.payment_choice) query = query.where('payment_choice', '==', params.payment_choice);
  if (params.archived === 'true') query = query.where('archived', '==', true);

  query = query.orderBy('created_at', 'desc');

  const limit = Math.min(parseInt(params.limit) || 500, 1000);
  query = query.limit(limit);

  const snapshot = await query.get();
  const applications = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  return jsonResponse(200, { ok: true, applications, count: applications.length });
}

async function getOne(db, id) {
  const doc = await db.collection('applications').doc(id).get();
  if (!doc.exists) {
    return jsonResponse(404, { ok: false, error: 'Application not found' });
  }
  return jsonResponse(200, { ok: true, application: { id: doc.id, ...doc.data() } });
}

async function update(db, event, user) {
  const data = JSON.parse(event.body || '{}');
  if (!data.id) {
    return jsonResponse(400, { ok: false, error: 'Application ID is required' });
  }

  const docRef = db.collection('applications').doc(data.id);
  const doc = await docRef.get();
  if (!doc.exists) {
    return jsonResponse(404, { ok: false, error: 'Application not found' });
  }

  const updates = { updated_at: new Date(), updated_by: user.email };
  const allowed = [
    'status', 'notes', 'payment_choice', 'track',
    'cohort_id', 'cohort_label', 'bundle_type',
    'first_name', 'last_name', 'email', 'phone',
    'program_type', 'ytt_program_type', 'course_name', 'course_id',
    'archived'
  ];

  for (const key of allowed) {
    if (data[key] !== undefined) {
      updates[key] = data[key];
    }
  }

  const existingApp = doc.data();
  await docRef.update(updates);

  // Role revocation: when status changes to Rejected or Withdrawn, revoke user role
  if (data.status && (data.status === 'Rejected' || data.status === 'Withdrawn')) {
    const appEmail = data.email || existingApp.email;
    if (appEmail) {
      await revokeApplicationRole(db, appEmail, data.id).catch(err => {
        console.error('[applications] Role revocation failed:', err.message);
      });
    }
  }

  // Catalogue-sync: keep user doc's roleDetails in sync when course_id or cohort_id change
  // on an already-enrolled application, OR when the app transitions to Accepted.
  const mergedApp = { ...existingApp, ...updates };
  const isAlreadyEnrolled = existingApp.firebase_uid || existingApp.status === 'Enrolled';
  const courseChanged = data.course_id !== undefined && data.course_id !== existingApp.course_id;
  const cohortChanged = data.cohort_id !== undefined && data.cohort_id !== existingApp.cohort_id;
  const becameAccepted = data.status === 'Accepted' && existingApp.status !== 'Accepted';

  if ((isAlreadyEnrolled && (courseChanged || cohortChanged)) || becameAccepted) {
    await syncUserFromApplication(db, { id: data.id, ...mergedApp }).catch(err => {
      console.error('[applications] User sync failed:', err.message);
    });
  }

  const updated = await docRef.get();
  return jsonResponse(200, { ok: true, application: { id: updated.id, ...updated.data() } });
}

// =========================================================================
// User sync — push catalogue fields (courseId, cohortId, cohort[]) into user doc
// =========================================================================

function buildCohortIdFromApp(app) {
  const cohortId = app.cohort_id || '';
  const yttType = app.ytt_program_type || '';
  if (!cohortId) return '';
  let suffix = '';
  if (yttType === '18-week') suffix = '-18W';
  else if (yttType === '4-week') suffix = '-4W';
  else if (yttType === '8-week') suffix = '-8W';
  else if (yttType === '300h') suffix = '-300H';
  else if (yttType === '50h') suffix = '-50H';
  else if (yttType === '30h') suffix = '-30H';
  return cohortId + suffix;
}

async function syncUserFromApplication(db, app) {
  const email = (app.email || '').toLowerCase().trim();
  if (!email) return;

  // Find the user by firebase_uid first, fall back to email lookup
  let userRef = null;
  if (app.firebase_uid) {
    userRef = db.collection('users').doc(app.firebase_uid);
  } else {
    const snap = await db.collection('users').where('email', '==', email).limit(1).get();
    if (snap.empty) return;
    userRef = snap.docs[0].ref;
  }

  const userDoc = await userRef.get();
  if (!userDoc.exists) return;
  const userData = userDoc.data() || {};
  const existingDetails = userData.roleDetails || {};

  const updates = {};
  let changed = false;

  if (app.course_id && existingDetails.courseId !== app.course_id) {
    updates.courseId = app.course_id;
    changed = true;
  }
  if (app.cohort_id && existingDetails.cohortId !== app.cohort_id) {
    updates.cohortId = app.cohort_id;
    changed = true;
  }
  if (app.cohort_label && existingDetails.cohortLabel !== app.cohort_label) {
    updates.cohortLabel = app.cohort_label;
    changed = true;
  }

  const newCohortBuildId = buildCohortIdFromApp(app);
  if (newCohortBuildId) {
    const existingCohorts = Array.isArray(existingDetails.cohort)
      ? existingDetails.cohort.slice()
      : (typeof existingDetails.cohort === 'string' && existingDetails.cohort ? [existingDetails.cohort] : []);
    if (existingCohorts.indexOf(newCohortBuildId) === -1) {
      existingCohorts.push(newCohortBuildId);
      updates.cohort = existingCohorts;
      changed = true;
    } else if (!Array.isArray(existingDetails.cohort)) {
      // Already contains it but as a string — normalize to array
      updates.cohort = existingCohorts;
      changed = true;
    }
  }

  if (!changed) return;

  const mergedDetails = Object.assign({}, existingDetails, updates);
  await userRef.update({ roleDetails: mergedDetails, updated_at: new Date() });
  console.log('[user-sync] Updated user:', userRef.id,
    'with courseId:', mergedDetails.courseId || '(none)',
    'cohorts:', JSON.stringify(mergedDetails.cohort || []));
}

// =========================================================================
// Role Revocation — reset user role when application is rejected/withdrawn
// =========================================================================

async function revokeApplicationRole(db, email, revokedAppId) {
  const normalizedEmail = (email || '').toLowerCase().trim();
  if (!normalizedEmail) return;

  // Check if user has OTHER active (non-revoked) applications
  const otherApps = await db.collection('applications')
    .where('email', '==', normalizedEmail)
    .get();

  const activeStatuses = ['Approved', 'Enrolled', 'New', 'Pending', 'Under Review', 'Completed'];
  const hasOtherActive = otherApps.docs.some(doc => {
    if (doc.id === revokedAppId) return false; // Skip the one being revoked
    const app = doc.data();
    if (app.archived) return false;
    return activeStatuses.includes(app.status);
  });

  if (hasOtherActive) {
    console.log(`[applications:revoke] ${normalizedEmail}: has other active applications — skipping revocation`);
    return;
  }

  // No other active applications — revoke role
  const auth = getAuth();
  let firebaseUser;
  try {
    firebaseUser = await auth.getUserByEmail(normalizedEmail);
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      console.log(`[applications:revoke] No Firebase user for ${normalizedEmail} — skipping`);
      return;
    }
    throw err;
  }

  const uid = firebaseUser.uid;
  const userRef = db.collection('users').doc(uid);
  const userDoc = await userRef.get();

  if (!userDoc.exists) {
    console.log(`[applications:revoke] No Firestore user doc for ${uid} — skipping`);
    return;
  }

  const userData = userDoc.data();
  const previousRole = userData.role || 'member';
  const previousDetails = userData.roleDetails || {};

  // Don't revoke protected roles (assigned manually, not via applications)
  const protectedRoles = ['admin', 'owner', 'instructor', 'teacher', 'marketing'];
  if (protectedRoles.includes(previousRole)) {
    console.log(`[applications:revoke] ${normalizedEmail}: role is ${previousRole} — not revoking (protected role)`);
    return;
  }

  // Reset to member
  await userRef.update({
    role: 'member',
    roleDetails: {},
    updated_at: new Date()
  });

  // Audit trail
  await db.collection('role_audit').add({
    uid,
    email: normalizedEmail,
    previousRole,
    previousRoleDetails: previousDetails,
    newRole: 'member',
    newRoleDetails: {},
    trigger: 'revocation',
    revokedApplicationId: revokedAppId,
    created_at: new Date()
  });

  console.log(`[applications:revoke] ${normalizedEmail}: ${previousRole} → member (application ${revokedAppId} revoked)`);
}

async function remove(db, event) {
  const data = JSON.parse(event.body || '{}');
  if (!data.id) {
    return jsonResponse(400, { ok: false, error: 'Application ID is required' });
  }

  const docRef = db.collection('applications').doc(data.id);
  const doc = await docRef.get();
  if (!doc.exists) {
    return jsonResponse(404, { ok: false, error: 'Application not found' });
  }

  await docRef.delete();
  return jsonResponse(200, { ok: true, message: 'Application deleted' });
}
