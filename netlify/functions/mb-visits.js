/**
 * Netlify Function: GET /.netlify/functions/mb-visits
 * Fetches client visit history from Mindbody.
 * Includes future bookings (30 days ahead) so upcoming classes show as "Booked".
 *
 * Query params:
 *   clientId (required) - Mindbody client ID
 *   startDate (YYYY-MM-DD) - defaults to 90 days ago
 *   endDate (YYYY-MM-DD) - defaults to 30 days from now
 */

const { mbFetch, jsonResponse, corsHeaders } = require('./shared/mb-api');

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    var params = event.queryStringParameters || {};

    if (!params.clientId) {
      return jsonResponse(400, { error: 'clientId is required' });
    }

    var now = new Date();
    var startDate = params.startDate || new Date(now.getTime() - 90 * 86400000).toISOString().split('T')[0];
    // Include 30 days into the future to capture upcoming bookings
    var endDate = params.endDate || new Date(now.getTime() + 30 * 86400000).toISOString().split('T')[0];

    var queryString = new URLSearchParams({
      clientId: params.clientId,
      startDate: startDate,
      endDate: endDate,
      limit: '200'
    }).toString();

    var data = await mbFetch('/client/clientvisits?' + queryString);

    var nowISO = now.toISOString();

    var visits = (data.Visits || []).map(function(v) {
      var isFuture = v.StartDateTime && v.StartDateTime > nowISO;

      return {
        id: v.Id,
        classId: v.ClassId,
        name: v.Name || 'Visit',
        startDateTime: v.StartDateTime,
        endDateTime: v.EndDateTime,
        instructor: v.Staff ? v.Staff.Name : '',
        location: v.Location ? v.Location.Name : '',
        status: v.AppointmentStatus || v.Status || '',
        serviceName: v.Service ? v.Service.Name : '',
        signedIn: v.SignedIn || false,
        lateCancelled: v.LateCancelled || false,
        isFuture: isFuture,
        classDescriptionId: v.ClassDescription ? v.ClassDescription.Id : null
      };
    });

    return jsonResponse(200, { visits: visits, total: visits.length });
  } catch (err) {
    console.error('mb-visits error:', err);
    return jsonResponse(err.status || 500, { error: err.message });
  }
};
