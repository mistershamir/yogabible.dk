/**
 * Netlify Function: POST /.netlify/functions/mb-book
 * Books a client into a Mindbody class.
 *
 * Body:
 *   clientId (string) - Mindbody client ID
 *   classId (number) - Mindbody class ID
 *   test (boolean) - if true, validates without booking
 */

const { mbFetch, jsonResponse, corsHeaders } = require('./shared/mb-api');

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    const body = JSON.parse(event.body || '{}');

    if (!body.clientId || !body.classId) {
      return jsonResponse(400, { error: 'clientId and classId are required' });
    }

    const data = await mbFetch('/class/addclienttoclass', {
      method: 'POST',
      body: JSON.stringify({
        ClientId: body.clientId,
        ClassId: body.classId,
        Test: body.test || false,
        SendEmail: true
      })
    });

    return jsonResponse(200, {
      success: true,
      visit: data.Visit || null,
      message: 'Class booked successfully'
    });
  } catch (err) {
    console.error('mb-book error:', err);
    return jsonResponse(err.status || 500, { error: err.message });
  }
};
