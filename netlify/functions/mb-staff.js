/**
 * Netlify Function: GET /.netlify/functions/mb-staff
 * Fetches staff/teacher details from Mindbody API.
 *
 * Query params:
 *   staffId (optional) - specific staff ID to fetch
 *   If no staffId, returns all active staff.
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
    var queryString = 'Limit=200';

    if (params.staffId) {
      queryString += '&StaffIds=' + params.staffId;
    }

    var data = await mbFetch('/staff/staff?' + queryString);
    var staff = (data.StaffMembers || []).map(function(s) {
      return {
        id: s.Id,
        name: (s.FirstName || '') + ' ' + (s.LastName || ''),
        firstName: s.FirstName || '',
        lastName: s.LastName || '',
        bio: s.Bio || '',
        imageUrl: s.ImageUrl || '',
        email: s.Email || '',
        isMale: s.IsMale || false
      };
    });

    return jsonResponse(200, { staff: staff, total: staff.length });
  } catch (err) {
    console.error('mb-staff error:', err);
    return jsonResponse(err.status || 500, { error: err.message });
  }
};
