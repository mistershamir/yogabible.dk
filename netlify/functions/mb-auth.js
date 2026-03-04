/**
 * Netlify Function: /.netlify/functions/mb-auth
 *
 * Validates a user's credentials against Mindbody, then creates or updates
 * their Firebase account with the same password. This allows existing Mindbody
 * users to log in with their current password — no password reset email needed.
 *
 * Called by the login form when Firebase auth fails with user-not-found or
 * invalid-credential, to transparently migrate legacy Mindbody users.
 *
 * POST { email: "user@example.com", password: "their-mindbody-password" }
 *
 * Returns:
 *   { success: false, reason: 'wrong_password' }  — email found in MB, password invalid
 *   { success: false, reason: 'email_not_found' }  — email not in MB client list
 *   { success: false }                             — lookup failed (fallback)
 *   { success: true, customToken: '...' }          — Firebase synced, ready to sign in
 *
 * Security note: password is received over HTTPS, validated against MB,
 * passed to Firebase Admin SDK for hashing — never logged or stored in plain text.
 *
 * Requires env: MB_API_KEY, MB_SITE_ID, FIREBASE_SERVICE_ACCOUNT_HYC
 */

'use strict';

const { jsonResponse, optionsResponse } = require('./shared/utils');
const { mbFetch } = require('./shared/mb-api');

const MB_BASE = 'https://api.mindbodyonline.com/public/v6';

let admin;

function getAdmin() {
  if (admin) return admin;
  admin = require('firebase-admin');
  if (!admin.apps.length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_HYC) {
      // HYC deployment: full service account JSON in one env var
      const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_HYC);
      admin.initializeApp({ credential: admin.credential.cert(sa) });
    } else {
      // YB deployment: individual env vars
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
        })
      });
    }
  }
  return admin;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return jsonResponse(400, { error: 'Invalid JSON' });
  }

  const email = (body.email || '').toLowerCase().trim();
  const password = body.password || '';

  if (!email || !password) {
    return jsonResponse(400, { error: 'email and password are required' });
  }

  try {
    // ── Strategy: try CLIENT login first, then STAFF login as fallback ──
    // /client/validatelogin  → validates client accounts (the main user base)
    // /usertoken/issue       → validates staff/admin accounts (owners, teachers)
    // Same email can have both account types with different passwords.

    let displayName = '';
    let validated = false;

    // 1a. Try CLIENT credentials via /client/validatelogin
    try {
      const clientRes = await mbFetch('/client/validatelogin', {
        method: 'POST',
        body: JSON.stringify({ Username: email, Password: password })
      });
      if (clientRes && clientRes.ValidatedLogin) {
        const cl = clientRes.ValidatedLogin;
        displayName = ((cl.FirstName || '') + ' ' + (cl.LastName || '')).trim();
        console.log('[mb-auth] CLIENT validated:', email, '— ID:', cl.Id, '— Name:', displayName);
        validated = true;
      }
    } catch (e) {
      console.log('[mb-auth] Client validatelogin failed for', email,
        '— status:', e.status, '— message:', e.message);
    }

    // 1b. If client login failed, try STAFF credentials via /usertoken/issue
    if (!validated) {
      try {
        const staffRes = await fetch(`${MB_BASE}/usertoken/issue`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Api-Key': process.env.MB_API_KEY,
            'SiteId': process.env.MB_SITE_ID
          },
          body: JSON.stringify({ Username: email, Password: password })
        });
        const staffData = await staffRes.json().catch(() => ({}));
        if (staffData.AccessToken) {
          displayName = staffData.User
            ? ((staffData.User.FirstName || '') + ' ' + (staffData.User.LastName || '')).trim()
            : '';
          console.log('[mb-auth] STAFF validated:', email, '— Name:', displayName);
          validated = true;
        }
      } catch (e) {
        console.log('[mb-auth] Staff usertoken failed for', email, '—', e.message);
      }
    }

    // 1c. Neither worked — determine why and return failure
    if (!validated) {
      let reason = 'unknown';
      try {
        const qs = new URLSearchParams({ searchText: email, limit: '10' }).toString();
        const clientData = await mbFetch('/client/clients?' + qs);
        const clients = (clientData.Clients || []).filter(c =>
          c.Email && c.Email.toLowerCase() === email
        );
        reason = clients.length > 0 ? 'wrong_password' : 'email_not_found';
        console.log('[mb-auth] Client lookup for', email, '→', reason,
          clients.length > 0 ? '(client ID: ' + clients[0].Id + ')' : '');
      } catch (lookupErr) {
        console.error('[mb-auth] Client lookup failed:', lookupErr.message);
      }

      return jsonResponse(200, { success: false, reason });
    }

    // 2. MB credentials valid (client or staff) — sync Firebase account
    const fb = getAdmin();
    console.log('[mb-auth] Syncing Firebase for', email);

    let firebaseUser = null;
    try {
      firebaseUser = await fb.auth().getUserByEmail(email);
    } catch (err) {
      if (err.code !== 'auth/user-not-found') throw err;
    }

    let uid;
    if (firebaseUser) {
      // Account exists (wrong password on Firebase side) — update to match MB password
      await fb.auth().updateUser(firebaseUser.uid, { password });
      uid = firebaseUser.uid;
    } else {
      // No Firebase account yet — create one with the same password
      const newUser = await fb.auth().createUser({
        email,
        password,
        displayName: displayName || undefined,
        emailVerified: false
      });
      uid = newUser.uid;
    }

    // Generate a custom token so the client can sign in immediately without
    // relying on password propagation (avoids timing/project-mismatch issues)
    let customToken = null;
    try {
      customToken = await fb.auth().createCustomToken(uid);
    } catch (e) {
      console.warn('mb-auth: could not generate custom token:', e.message);
    }

    return jsonResponse(200, { success: true, customToken });

  } catch (err) {
    console.error('mb-auth error:', err.message);
    return jsonResponse(500, { error: 'Internal server error' });
  }
};
