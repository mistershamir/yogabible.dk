/**
 * Schedule Token Validator — Yoga Bible
 * Validates HMAC token for personalized schedule pages.
 *
 * GET /.netlify/functions/schedule-token?tid={leadId}&tok={token}
 * Returns { ok: true, firstName, format } or { ok: false }
 */

const crypto = require('crypto');
const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const TOKEN_SECRET = process.env.UNSUBSCRIBE_SECRET || 'yb-appt-secret';

function generateToken(leadId, email) {
  const hmac = crypto.createHmac('sha256', TOKEN_SECRET);
  hmac.update(leadId + ':' + email.toLowerCase().trim());
  return hmac.digest('hex');
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { ok: false, error: 'Method not allowed' });
  }

  const { tid, tok } = event.queryStringParameters || {};

  if (!tid || !tok) {
    return jsonResponse(400, { ok: false, error: 'Missing parameters' });
  }

  try {
    const db = getDb();
    const doc = await db.collection('leads').doc(tid).get();

    if (!doc.exists) {
      return jsonResponse(200, { ok: false });
    }

    const lead = doc.data();
    const email = lead.email || '';

    if (!email) {
      return jsonResponse(200, { ok: false });
    }

    const expected = generateToken(tid, email);
    if (expected !== tok) {
      return jsonResponse(200, { ok: false });
    }

    // Return only non-sensitive data
    return jsonResponse(200, {
      ok: true,
      firstName: lead.first_name || lead.firstName || '',
      format: lead.ytt_program_type || ''
    });
  } catch (err) {
    console.error('[schedule-token] Error:', err.message);
    return jsonResponse(500, { ok: false, error: 'Server error' });
  }
};
