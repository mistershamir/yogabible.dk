/**
 * fix-admin-role.js — One-time diagnostic & fix for admin role overwrite issue
 *
 * GET:  Diagnose — shows user doc, role_audit, role_changes for the email
 * POST: Fix — sets role to 'admin', suspended to false, logs to role_audit
 *
 * Protected by X-Internal-Secret header.
 *
 * Usage:
 *   curl "https://yogabible.dk/.netlify/functions/fix-admin-role?email=shamir@hotyogacph.dk" \
 *     -H "X-Internal-Secret: $AI_INTERNAL_SECRET"
 *
 *   curl -X POST "https://yogabible.dk/.netlify/functions/fix-admin-role" \
 *     -H "X-Internal-Secret: $AI_INTERNAL_SECRET" \
 *     -H "Content-Type: application/json" \
 *     -d '{"email":"shamir@hotyogacph.dk","targetRole":"admin"}'
 */

const { getDb, getAuth } = require('./shared/firestore');
const { jsonResponse } = require('./shared/utils');

exports.handler = async (event) => {
  // Auth check
  const secret = event.headers['x-internal-secret'] || '';
  if (secret !== process.env.AI_INTERNAL_SECRET) {
    return jsonResponse(403, { error: 'Forbidden' });
  }

  const db = getDb();
  const auth = getAuth();

  if (event.httpMethod === 'GET') {
    return diagnose(db, auth, event);
  } else if (event.httpMethod === 'POST') {
    return fix(db, auth, event);
  }
  return jsonResponse(405, { error: 'Method not allowed' });
};

async function diagnose(db, auth, event) {
  const email = (event.queryStringParameters || {}).email || '';
  if (!email) return jsonResponse(400, { error: 'Missing ?email= parameter' });

  const report = { email, firebaseUsers: [], firestoreDocs: [], roleAudit: [], roleChanges: [] };

  // 1. Check Firebase Auth for all users with this email
  try {
    const user = await auth.getUserByEmail(email);
    report.firebaseUsers.push({
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      providers: user.providerData.map(p => p.providerId),
      disabled: user.disabled,
      createdAt: user.metadata.creationTime
    });
  } catch (err) {
    report.firebaseUsers.push({ error: err.message });
  }

  // 2. Check Firestore users collection — search by email
  const usersSnap = await db.collection('users')
    .where('email', '==', email)
    .get();

  usersSnap.forEach(doc => {
    const d = doc.data();
    report.firestoreDocs.push({
      docId: doc.id,
      email: d.email,
      role: d.role || '(undefined — defaults to member)',
      roleDetails: d.roleDetails || {},
      suspended: d.suspended || false,
      suspendedAt: d.suspendedAt || null,
      updatedAt: d.updatedAt || d.updated_at || null,
      createdAt: d.createdAt || null,
      firstName: d.firstName,
      lastName: d.lastName
    });
  });

  // 3. Also check if there's a doc by UID (in case email doesn't match)
  if (report.firebaseUsers.length && report.firebaseUsers[0].uid) {
    const uid = report.firebaseUsers[0].uid;
    const uidDoc = await db.collection('users').doc(uid).get();
    if (uidDoc.exists) {
      const d = uidDoc.data();
      const alreadyFound = report.firestoreDocs.some(fd => fd.docId === uid);
      if (!alreadyFound) {
        report.firestoreDocs.push({
          docId: uid,
          email: d.email,
          role: d.role || '(undefined)',
          roleDetails: d.roleDetails || {},
          suspended: d.suspended || false,
          note: 'Found by UID but email in doc differs — possible duplicate!'
        });
      }
    }
  }

  // 4. Recent role_audit entries
  try {
    const auditSnap = await db.collection('role_audit')
      .where('email', '==', email)
      .orderBy('created_at', 'desc')
      .limit(10)
      .get();
    auditSnap.forEach(doc => {
      const d = doc.data();
      report.roleAudit.push({
        id: doc.id,
        previousRole: d.previousRole,
        newRole: d.newRole,
        trigger: d.trigger,
        created_at: d.created_at,
        applicationId: d.applicationId || null
      });
    });
  } catch (err) {
    report.roleAudit.push({ error: err.message + ' (may need composite index)' });
  }

  // 5. Recent role_changes entries
  if (report.firebaseUsers.length && report.firebaseUsers[0].uid) {
    try {
      const changesSnap = await db.collection('role_changes')
        .where('userId', '==', report.firebaseUsers[0].uid)
        .orderBy('changedAt', 'desc')
        .limit(10)
        .get();
      changesSnap.forEach(doc => {
        const d = doc.data();
        report.roleChanges.push({
          id: doc.id,
          previousRole: d.previousRole,
          newRole: d.newRole,
          action: d.action,
          source: d.source,
          changedAt: d.changedAt,
          changedBy: d.changedBy
        });
      });
    } catch (err) {
      report.roleChanges.push({ error: err.message + ' (may need composite index)' });
    }
  }

  return jsonResponse(200, report);
}

async function fix(db, auth, event) {
  const body = JSON.parse(event.body || '{}');
  const email = body.email;
  const targetRole = body.targetRole || 'admin';

  if (!email) return jsonResponse(400, { error: 'Missing email in body' });

  // Find Firebase user
  let firebaseUser;
  try {
    firebaseUser = await auth.getUserByEmail(email);
  } catch (err) {
    return jsonResponse(404, { error: 'No Firebase user found for ' + email });
  }

  const uid = firebaseUser.uid;
  const userRef = db.collection('users').doc(uid);
  const userDoc = await userRef.get();

  if (!userDoc.exists) {
    return jsonResponse(404, { error: 'No Firestore user doc for UID ' + uid });
  }

  const before = userDoc.data();
  const changes = {};

  if ((before.role || 'member') !== targetRole) {
    changes.role = targetRole;
  }
  if (before.suspended === true) {
    changes.suspended = false;
    changes.suspendedAt = null;
  }

  if (Object.keys(changes).length === 0) {
    return jsonResponse(200, {
      ok: true,
      message: 'No changes needed',
      current: { role: before.role, suspended: before.suspended }
    });
  }

  changes.updatedAt = new Date();
  await userRef.update(changes);

  // Audit
  await db.collection('role_audit').add({
    uid,
    email,
    previousRole: before.role || 'member',
    newRole: changes.role || before.role,
    previousSuspended: before.suspended || false,
    newSuspended: changes.suspended !== undefined ? changes.suspended : (before.suspended || false),
    trigger: 'fix-admin-role-script',
    created_at: new Date()
  });

  return jsonResponse(200, {
    ok: true,
    uid,
    before: { role: before.role, suspended: before.suspended },
    after: { role: changes.role || before.role, suspended: changes.suspended !== undefined ? changes.suspended : before.suspended },
    changes
  });
}
