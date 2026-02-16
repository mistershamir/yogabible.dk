/**
 * Application Status Lookup — Yoga Bible
 * Public endpoint for applicants to check status.
 *
 * POST /.netlify/functions/status
 * Body: { email, application_id }
 */

const { getDb } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();
  if (event.httpMethod !== 'POST') return jsonResponse(405, { ok: false, error: 'Method not allowed' });

  try {
    const payload = JSON.parse(event.body || '{}');
    const email = (payload.email || '').toLowerCase().trim();
    const applicationId = (payload.application_id || '').trim();

    if (!email || !applicationId) {
      return jsonResponse(400, { ok: false, message: 'Email and application ID required' });
    }

    const db = getDb();
    const snap = await db.collection('applications')
      .where('email', '==', email)
      .where('application_id', '==', applicationId)
      .limit(1)
      .get();

    if (snap.empty) {
      return jsonResponse(404, { ok: false, message: 'No application found with these details' });
    }

    const status = snap.docs[0].data().status || 'Pending';
    return jsonResponse(200, { ok: true, message: `Application status: ${status}`, status });
  } catch (error) {
    console.error('Status lookup error:', error);
    return jsonResponse(500, { ok: false, message: 'System error' });
  }
};
