/**
 * Netlify Function: GET /.netlify/functions/mb-classes
 * Fetches class schedule from Mindbody API.
 *
 * Query params:
 *   startDate (YYYY-MM-DD) - defaults to today
 *   endDate (YYYY-MM-DD) - defaults to 7 days from startDate
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
    const params = event.queryStringParameters || {};

    // Default to this week
    const now = new Date();
    const startDate = params.startDate || now.toISOString().split('T')[0];
    const endDate = params.endDate || new Date(now.getTime() + 7 * 86400000).toISOString().split('T')[0];

    const queryString = new URLSearchParams({
      startDate,
      endDate,
      limit: '200'
    }).toString();

    const data = await mbFetch(`/class/classes?${queryString}`);

    // Transform for frontend consumption
    const classes = (data.Classes || []).map(function(cls) {
      return {
        id: cls.Id,
        name: cls.ClassDescription ? cls.ClassDescription.Name : cls.Name || 'Class',
        description: cls.ClassDescription ? cls.ClassDescription.Description : '',
        startDateTime: cls.StartDateTime,
        endDateTime: cls.EndDateTime,
        instructor: cls.Staff ? cls.Staff.Name : 'TBA',
        instructorId: cls.Staff ? cls.Staff.Id : null,
        location: cls.Location ? cls.Location.Name : '',
        locationId: cls.Location ? cls.Location.Id : null,
        maxCapacity: cls.MaxCapacity,
        totalBooked: cls.TotalBooked,
        isAvailable: cls.IsAvailable,
        isCanceled: cls.IsCanceled,
        substituteTeacher: cls.Substitute || false,
        classDescriptionId: cls.ClassDescription ? cls.ClassDescription.Id : null
      };
    });

    return jsonResponse(200, {
      classes,
      startDate,
      endDate,
      total: classes.length
    });
  } catch (err) {
    console.error('mb-classes error:', err);
    return jsonResponse(err.status || 500, { error: err.message });
  }
};
