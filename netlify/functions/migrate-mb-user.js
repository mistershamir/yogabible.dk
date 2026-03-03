/**
 * Netlify Function: /.netlify/functions/migrate-mb-user
 *
 * Migrates an existing Mindbody user to Firebase auth.
 * Called when a login attempt fails — checks if the email exists in Mindbody,
 * and if so, creates a Firebase account for them so they can set a new password.
 *
 * POST { email: "user@example.com" }
 *
 * Returns:
 *   { found: false }                              — email not in Mindbody
 *   { found: true, hasFirebaseAccount: true }     — already has Firebase account (wrong password)
 *   { found: true, created: true, name: "..." }   — Firebase account just created
 *
 * Requires env var: FIREBASE_SERVICE_ACCOUNT_HYC (JSON string of service account)
 */

'use strict';

const { jsonResponse, optionsResponse } = require('./shared/utils');
const { mbFetch } = require('./shared/mb-api');
const crypto = require('crypto');

let admin;

function getAdmin() {
  if (admin) return admin;
  admin = require('firebase-admin');
  if (!admin.apps.length) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_HYC || '{}');
    admin.initializeApp({ credential: admin.credential.cert(sa) });
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
  if (!email) {
    return jsonResponse(400, { error: 'email is required' });
  }

  try {
    // 1. Check if email exists in Mindbody
    const qs = new URLSearchParams({ searchText: email, limit: '10' }).toString();
    const clientData = await mbFetch(`/client/clients?${qs}`);
    const clients = (clientData.Clients || []).filter(function (c) {
      return c.Email && c.Email.toLowerCase() === email;
    });

    if (clients.length === 0) {
      return jsonResponse(200, { found: false });
    }

    const mbClient = clients[0];
    const displayName = ((mbClient.FirstName || '') + ' ' + (mbClient.LastName || '')).trim();

    const fb = getAdmin();

    // 2. Check if a Firebase account already exists for this email
    let firebaseUser = null;
    try {
      firebaseUser = await fb.auth().getUserByEmail(email);
    } catch (err) {
      if (err.code !== 'auth/user-not-found') throw err;
    }

    if (firebaseUser) {
      // Firebase account exists — user just entered the wrong password.
      // Signal the client to send a password reset email.
      return jsonResponse(200, { found: true, hasFirebaseAccount: true });
    }

    // 3. No Firebase account — create one.
    //    Use a random temp password so the email/password provider is active
    //    (required for sendPasswordResetEmail to work on the client side).
    const tempPassword = crypto.randomBytes(32).toString('hex');

    await fb.auth().createUser({
      email: email,
      password: tempPassword,
      displayName: displayName || undefined,
      emailVerified: false
    });

    return jsonResponse(200, {
      found: true,
      created: true,
      name: displayName
    });

  } catch (err) {
    console.error('migrate-mb-user error:', err.message);
    return jsonResponse(500, { error: 'Internal server error' });
  }
};
