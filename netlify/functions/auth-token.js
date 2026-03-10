/**
 * Netlify Function: /.netlify/functions/auth-token
 *
 * Exchanges a Firebase ID token for a custom token.
 * Used by the Framer-embedded login modal to pass auth state
 * to the profile page iframe via postMessage.
 *
 * POST { idToken: "..." }  →  { customToken: "..." }
 *
 * Requires env: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 */

const { jsonResponse, optionsResponse } = require('./shared/utils');
const { getAuth } = require('./shared/firestore');

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

    var auth = getAuth();
    var decoded = await auth.verifyIdToken(idToken);
    var customToken = await auth.createCustomToken(decoded.uid);

    return jsonResponse(200, { customToken: customToken });
  } catch (err) {
    console.error('auth-token error:', err.message);
    return jsonResponse(401, { error: 'Invalid or expired token' });
  }
};
