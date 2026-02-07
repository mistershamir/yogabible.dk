/**
 * Netlify Function: POST/DELETE /.netlify/functions/mb-book
 * Books or cancels a client from a Mindbody class.
 *
 * POST body (book):
 *   clientId (string) - Mindbody client ID
 *   classId (number) - Mindbody class ID
 *   test (boolean) - if true, validates without booking
 *
 * DELETE body (cancel):
 *   clientId (string) - Mindbody client ID
 *   classId (number) - Mindbody class ID
 *   lateCancel (boolean) - if true, marks as late cancel
 */

const { mbFetch, jsonResponse, corsHeaders } = require('./shared/mb-api');

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  // POST: Book class
  if (event.httpMethod === 'POST') {
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
      console.error('mb-book POST error:', err);
      return jsonResponse(err.status || 500, { error: err.message });
    }
  }

  // DELETE: Cancel booking
  if (event.httpMethod === 'DELETE') {
    try {
      const body = JSON.parse(event.body || '{}');

      if (!body.clientId || !body.classId) {
        return jsonResponse(400, { error: 'clientId and classId are required' });
      }

      const data = await mbFetch('/class/removeclientfromclass', {
        method: 'POST',
        body: JSON.stringify({
          ClientId: body.clientId,
          ClassId: body.classId,
          LateCancel: body.lateCancel || false,
          SendEmail: true
        })
      });

      return jsonResponse(200, {
        success: true,
        message: 'Booking cancelled successfully'
      });
    } catch (err) {
      console.error('mb-book DELETE error:', err);
      return jsonResponse(err.status || 500, { error: err.message });
    }
  }

  return jsonResponse(405, { error: 'Method not allowed' });
};
