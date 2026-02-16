/**
 * Netlify Function: /.netlify/functions/auth-token
 *
 * Exchanges a Firebase ID token for a custom token.
 * Used by the Framer-embedded login modal to pass auth state
 * to the profile page iframe via postMessage.
 *
 * POST { idToken: "..." }  →  { customToken: "..." }
 *
 * Requires env var: FIREBASE_SERVICE_ACCOUNT_HYC (JSON string of service account)
 */

const { jsonResponse, optionsResponse } = require('./shared/utils');

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

  try {
    var body = JSON.parse(event.body || '{}');
    var idToken = body.idToken;

    if (!idToken) {
      return jsonResponse(400, { error: 'idToken is required' });
    }

    var fb = getAdmin();
    var decoded = await fb.auth().verifyIdToken(idToken);
    var customToken = await fb.auth().createCustomToken(decoded.uid);

    return jsonResponse(200, { customToken: customToken });
  } catch (err) {
    console.error('auth-token error:', err.message);
    return jsonResponse(401, { error: 'Invalid or expired token' });
  }
};
