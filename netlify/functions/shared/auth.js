/**
 * Auth Middleware — Yoga Bible
 * Verifies Firebase ID tokens and checks user roles for Netlify Functions.
 *
 * Usage in a function:
 *   const { requireAuth } = require('./shared/auth');
 *   const user = await requireAuth(event, ['admin', 'marketing']);
 *   if (user.error) return user.error; // Returns 401/403 response
 *   // user.uid, user.email, user.role available
 */

const { getAuth, getDb } = require('./firestore');
const { jsonResponse } = require('./utils');

/**
 * Verify Firebase token and check role.
 * @param {Object} event - Netlify function event
 * @param {string[]} [allowedRoles] - Roles that can access this endpoint. Empty = any authenticated user.
 * @returns {Promise<{uid: string, email: string, role: string, error?: Object}>}
 */
async function requireAuth(event, allowedRoles = []) {
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    return { error: jsonResponse(401, { ok: false, error: 'Authentication required' }) };
  }

  let decodedToken;
  try {
    const auth = getAuth();
    decodedToken = await auth.verifyIdToken(token);
  } catch (err) {
    console.error('[auth] Token verification failed:', err.message);
    return { error: jsonResponse(401, { ok: false, error: 'Invalid or expired token' }) };
  }

  const uid = decodedToken.uid;
  const email = decodedToken.email || '';

  // Look up user role in Firestore
  let role = 'user';
  try {
    const db = getDb();
    const userDoc = await db.collection('users').doc(uid).get();
    if (userDoc.exists) {
      role = userDoc.data().role || 'user';
    }
  } catch (err) {
    console.error('[auth] Firestore user lookup failed:', err.message);
  }

  // Check role if specific roles required
  if (allowedRoles.length > 0 && !allowedRoles.includes(role)) {
    return {
      error: jsonResponse(403, {
        ok: false,
        error: 'Insufficient permissions. Required: ' + allowedRoles.join(' or ')
      })
    };
  }

  return { uid, email, role };
}

/**
 * Optional auth — returns user info if authenticated, null if not.
 * Does not block the request.
 * @param {Object} event
 * @returns {Promise<{uid: string, email: string, role: string} | null>}
 */
async function optionalAuth(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!token) return null;

  try {
    const auth = getAuth();
    const decodedToken = await auth.verifyIdToken(token);
    const uid = decodedToken.uid;
    const email = decodedToken.email || '';

    const db = getDb();
    const userDoc = await db.collection('users').doc(uid).get();
    const role = userDoc.exists ? (userDoc.data().role || 'user') : 'user';

    return { uid, email, role };
  } catch (err) {
    return null;
  }
}

module.exports = { requireAuth, optionalAuth };
