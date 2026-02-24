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

  const updated = await docRef.get();
  return jsonResponse(200, { ok: true, application: { id: updated.id, ...updated.data() } });
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

  // Don't revoke teacher/marketing/admin roles (those are assigned manually, not via applications)
  if (['teacher', 'marketing', 'admin'].includes(previousRole)) {
    console.log(`[applications:revoke] ${normalizedEmail}: role is ${previousRole} — not revoking (manually assigned)`);
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
