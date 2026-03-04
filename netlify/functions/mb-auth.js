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
    // 1. Validate credentials against Mindbody's user token endpoint
    const mbRes = await fetch(`${MB_BASE}/usertoken/issue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Api-Key': process.env.MB_API_KEY,
        'SiteId': process.env.MB_SITE_ID
      },
      body: JSON.stringify({ Username: email, Password: password })
    });

    let mbData;
    try {
      mbData = await mbRes.json();
    } catch (e) {
      console.error('[mb-auth] MB response not JSON — HTTP', mbRes.status);
      mbData = {};
    }

    if (!mbData.AccessToken) {
      // Log what Mindbody actually returned so we can diagnose failures
      console.warn('[mb-auth] No AccessToken for', email,
        '— HTTP', mbRes.status,
        '— Response:', JSON.stringify(mbData).substring(0, 300));

      // Look up email in MB client list to determine specific failure reason
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

    // 2. MB credentials valid — sync Firebase account with the same password
    const fb = getAdmin();

    // Pull display name from MB token response
    const displayName = mbData.User
      ? ((mbData.User.FirstName || '') + ' ' + (mbData.User.LastName || '')).trim()
      : '';

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
