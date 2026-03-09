/**
 * Netlify Function: GET /.netlify/functions/member-documents
 *
 * Returns training documents the authenticated user has permission to view.
 * Permission filtering is done server-side with the Firebase Admin SDK,
 * so it bypasses Firestore security rules entirely and is always reliable.
 *
 * Query params: none
 * Auth: Firebase ID token in Authorization: Bearer header
 */

const { getDb, getAuth } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

// Mirror of roles-permissions.js computePermissions — kept in sync manually.
// Server-side source of truth for what each role can access.
const PROGRAMS = ['100h', '200h', '300h', '500h'];
const METHODS  = ['triangle', 'vinyasa'];

function computePermissions(role, roleDetails) {
  roleDetails = roleDetails || {};
  const perms = new Set(['gated-content']);

  if (role === 'admin') {
    PROGRAMS.forEach(p => perms.add('materials:' + p));
    METHODS.forEach(m => perms.add('method:' + m));
    ['live-streaming', 'recordings', 'admin:content', 'admin:courses', 'admin:users', 'lead:manage'].forEach(p => perms.add(p));

  } else if (role === 'teacher') {
    PROGRAMS.forEach(p => perms.add('materials:' + p));
    ['live-streaming', 'recordings'].forEach(p => perms.add(p));
    if (roleDetails.teacherType) perms.add('teacher:' + roleDetails.teacherType);
    METHODS.forEach(m => perms.add('method:' + m));

  } else if (role === 'trainee') {
    ['live-streaming', 'recordings'].forEach(p => perms.add(p));
    if (roleDetails.program) perms.add('materials:' + roleDetails.program);
    if (roleDetails.method)  perms.add('method:'    + roleDetails.method);
    if (roleDetails.cohort)  perms.add('cohort:'    + roleDetails.cohort);
    if (roleDetails.mentorship) perms.add('mentorship');
    if (Array.isArray(roleDetails.courseTypes)) {
      roleDetails.courseTypes.forEach(ct => perms.add('course:' + ct));
    }
  }

  return [...perms];
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();
  if (event.httpMethod !== 'GET') return jsonResponse(405, { ok: false, error: 'GET only' });

  // Verify Firebase ID token
  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return jsonResponse(401, { ok: false, error: 'Authentication required' });

  let uid;
  try {
    const decoded = await getAuth().verifyIdToken(token);
    uid = decoded.uid;
  } catch (err) {
    return jsonResponse(401, { ok: false, error: 'Invalid or expired token' });
  }

  const db = getDb();

  // Get user role + roleDetails
  let role = 'member', roleDetails = {};
  try {
    const userDoc = await db.collection('users').doc(uid).get();
    if (userDoc.exists) {
      role = userDoc.data().role || 'member';
      roleDetails = userDoc.data().roleDetails || {};
    }
  } catch (err) {
    console.error('[member-documents] User lookup failed:', err.message);
  }

  const userPerms = computePermissions(role, roleDetails);

  // Fetch all documents ordered by display order
  let snap;
  try {
    snap = await db.collection('documents').orderBy('order').get();
  } catch (err) {
    console.error('[member-documents] Firestore query failed:', err.message);
    return jsonResponse(500, { ok: false, error: 'Failed to load documents' });
  }

  const docs = [];
  snap.forEach(function(doc) {
    const d = doc.data();
    if (d.active === false) return;                 // skip inactive
    const required = d.requiredPermissions || [];
    if (required.length > 0 && !required.every(p => userPerms.includes(p))) return; // permission check
    docs.push({
      id: doc.id,
      title_da:       d.title_da       || '',
      title_en:       d.title_en       || '',
      description_da: d.description_da || '',
      description_en: d.description_en || '',
      fileUrl:        d.fileUrl        || '',
      category:       d.category       || 'manual',
      order:          d.order          || 0
    });
  });

  return jsonResponse(200, { ok: true, documents: docs });
};
