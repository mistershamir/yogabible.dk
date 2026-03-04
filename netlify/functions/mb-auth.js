/**
 * Netlify Function: /.netlify/functions/mb-auth
 *
 * Validates credentials and migrates Mindbody users to Firebase.
 *
 * IMPORTANT: Mindbody V6 has NO client password validation endpoint.
 * /usertoken/issue only validates STAFF accounts. For clients, we can only
 * check if they exist in Mindbody — not verify their password. So the flow is:
 *
 * 1. Try staff auth (/usertoken/issue) — works for admin/staff accounts
 * 2. If staff auth fails, look up email in Mindbody client list
 *    a. If found + no Firebase account → auto-create Firebase account, send
 *       back 'needs_setup' so frontend can trigger password reset email
 *    b. If found + has Firebase account → 'wrong_password' (they have an
 *       account, just wrong password — or they need to reset)
 *    c. If not found → 'email_not_found'
 *
 * POST { email: "user@example.com", password: "their-password" }
 *
 * Returns:
 *   { success: true, customToken: '...' }                  — staff login OK
 *   { success: false, reason: 'needs_setup', name: '...' } — MB client, no Firebase yet
 *   { success: false, reason: 'wrong_password' }           — has Firebase, wrong password
 *   { success: false, reason: 'email_not_found' }          — not in MB at all
 *
 * Requires env: MB_API_KEY, MB_SITE_ID, FIREBASE_SERVICE_ACCOUNT_HYC
 */

'use strict';

const { jsonResponse, optionsResponse } = require('./shared/utils');
const { mbFetch } = require('./shared/mb-api');
const crypto = require('crypto');

const MB_BASE = 'https://api.mindbodyonline.com/public/v6';

let admin;

function getAdmin() {
  if (admin) return admin;
  admin = require('firebase-admin');
  if (!admin.apps.length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_HYC) {
      const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_HYC);
      admin.initializeApp({ credential: admin.credential.cert(sa) });
    } else {
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
    // ── 1. Try STAFF auth (the only password-validation endpoint in V6) ──
    let staffValidated = false;
    let displayName = '';
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
        console.log('[mb-auth] STAFF validated:', email);
        staffValidated = true;
      }
    } catch (e) {
      console.log('[mb-auth] Staff usertoken failed:', e.message);
    }

    // ── 2. Staff login succeeded — sync Firebase and return token ──
    if (staffValidated) {
      const fb = getAdmin();
      let firebaseUser = null;
      try {
        firebaseUser = await fb.auth().getUserByEmail(email);
      } catch (err) {
        if (err.code !== 'auth/user-not-found') throw err;
      }

      let uid;
      if (firebaseUser) {
        await fb.auth().updateUser(firebaseUser.uid, { password });
        uid = firebaseUser.uid;
      } else {
        const newUser = await fb.auth().createUser({
          email, password,
          displayName: displayName || undefined,
          emailVerified: false
        });
        uid = newUser.uid;
      }

      let customToken = null;
      try {
        customToken = await fb.auth().createCustomToken(uid);
      } catch (e) {
        console.warn('[mb-auth] Custom token generation failed:', e.message);
      }

      return jsonResponse(200, { success: true, customToken });
    }

    // ── 3. Staff auth failed — check if this email is a Mindbody CLIENT ──
    // (V6 has no client password validation, so we can only check existence)
    let reason = 'email_not_found';
    let clientName = '';
    try {
      const qs = new URLSearchParams({ searchText: email, limit: '10' }).toString();
      const clientData = await mbFetch('/client/clients?' + qs);
      const clients = (clientData.Clients || []).filter(c =>
        c.Email && c.Email.toLowerCase() === email
      );

      if (clients.length > 0) {
        const cl = clients[0];
        clientName = ((cl.FirstName || '') + ' ' + (cl.LastName || '')).trim();
        console.log('[mb-auth] Client found:', email, '— ID:', cl.Id, '— Name:', clientName);

        // Check if they already have a Firebase account
        const fb = getAdmin();
        let hasFirebase = false;
        try {
          await fb.auth().getUserByEmail(email);
          hasFirebase = true;
        } catch (err) {
          if (err.code !== 'auth/user-not-found') throw err;
        }

        if (hasFirebase) {
          // They have a Firebase account — it's just a wrong password
          reason = 'wrong_password';
        } else {
          // No Firebase account yet — auto-create one so password reset works
          const tempPassword = crypto.randomBytes(32).toString('hex');
          await fb.auth().createUser({
            email,
            password: tempPassword,
            displayName: clientName || undefined,
            emailVerified: false
          });
          console.log('[mb-auth] Created Firebase account for MB client:', email);
          reason = 'needs_setup';
        }
      }
    } catch (lookupErr) {
      console.error('[mb-auth] Client lookup failed:', lookupErr.message);
    }

    return jsonResponse(200, {
      success: false,
      reason,
      ...(reason === 'needs_setup' ? { name: clientName } : {})
    });

  } catch (err) {
    console.error('[mb-auth] Error:', err.message);
    return jsonResponse(500, { error: 'Internal server error' });
  }
};
