/**
 * Application Status Lookup Endpoint — Yoga Bible
 * Replaces handleStatusLookup from Apps Script
 *
 * POST /.netlify/functions/status
 * Body: { email, application_id }
 */

const { getSheetData } = require('./shared/google-sheets');
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

    const data = await getSheetData('Applications (RAW)');
    if (!data || data.length < 2) {
      return jsonResponse(404, { ok: false, message: 'No application found with these details' });
    }

    const headers = data[0];
    const emailCol = headers.indexOf('email');
    const idCol = headers.indexOf('application_id');
    const statusCol = headers.indexOf('status');

    for (let i = 1; i < data.length; i++) {
      if (data[i][emailCol] === email && data[i][idCol] === applicationId) {
        const status = data[i][statusCol] || 'Pending';
        return jsonResponse(200, { ok: true, message: `Application status: ${status}`, status });
      }
    }

    return jsonResponse(404, { ok: false, message: 'No application found with these details' });
  } catch (error) {
    console.error('Status lookup error:', error);
    return jsonResponse(500, { ok: false, message: 'System error' });
  }
};
