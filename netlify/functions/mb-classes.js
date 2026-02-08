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

    var qsParams = {
      StartDateTime: startDate,
      EndDateTime: endDate,
      Limit: '200'
    };

    if (params.clientId) {
      qsParams.ClientId = params.clientId;
    }

    const queryString = new URLSearchParams(qsParams).toString();

    console.log('mb-classes query:', queryString);

    const data = await mbFetch('/class/classes?' + queryString);

    // Transform for frontend consumption
    const classes = (data.Classes || []).map(function(cls) {
      // Check if this client is already booked
      var isBooked = false;
      if (params.clientId && cls.Clients) {
        isBooked = cls.Clients.some(function(c) {
          return String(c.Id) === String(params.clientId);
        });
      }

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
        spotsLeft: cls.MaxCapacity ? cls.MaxCapacity - (cls.TotalBooked || 0) : null,
        isAvailable: cls.IsAvailable,
        isCanceled: cls.IsCanceled,
        isBooked: isBooked,
        substituteTeacher: cls.Substitute || false,
        classDescriptionId: cls.ClassDescription ? cls.ClassDescription.Id : null,
        programId: cls.ClassDescription && cls.ClassDescription.Program ? cls.ClassDescription.Program.Id : null,
        programName: cls.ClassDescription && cls.ClassDescription.Program ? cls.ClassDescription.Program.Name : ''
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
