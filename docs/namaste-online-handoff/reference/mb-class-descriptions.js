/**
 * Netlify Function: GET /.netlify/functions/mb-class-descriptions
 * Fetches class type descriptions from Mindbody.
 * Returns the full library of class types with name, description, program, etc.
 *
 * Query params:
 *   classDescriptionId (optional) - specific class description ID
 *   programId (optional) - filter by program
 *   startDate (optional) - only descriptions with classes after this date
 *   endDate (optional) - only descriptions with classes before this date
 *   limit (optional) - max results (default 200)
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
    var qsParams = { Limit: params.limit || '200' };

    if (params.classDescriptionId) qsParams.ClassDescriptionId = params.classDescriptionId;
    if (params.programId) qsParams.ProgramIds = params.programId;
    if (params.startDate) qsParams.StartClassDateTime = params.startDate;
    if (params.endDate) qsParams.EndClassDateTime = params.endDate;

    var queryString = new URLSearchParams(qsParams).toString();
    console.log('mb-class-descriptions query:', queryString);

    var data = await mbFetch('/class/classdescriptions?' + queryString);

    var descriptions = (data.ClassDescriptions || []).map(function(cd) {
      return {
        id: cd.Id,
        name: cd.Name || '',
        description: cd.Description || '',
        notes: cd.Notes || '',
        category: cd.Category || '',
        subcategory: cd.Subcategory || '',
        programId: cd.Program ? cd.Program.Id : null,
        programName: cd.Program ? cd.Program.Name : '',
        sessionTypeId: cd.SessionType ? cd.SessionType.Id : null,
        sessionTypeName: cd.SessionType ? cd.SessionType.Name : '',
        imageUrl: cd.ImageURL || '',
        lastUpdated: cd.LastUpdated || null,
        active: cd.Active !== false,
        level: cd.Level ? cd.Level.Name : ''
      };
    });

    return jsonResponse(200, { classDescriptions: descriptions, total: descriptions.length });
  } catch (err) {
    console.error('mb-class-descriptions error:', err);
    return jsonResponse(err.status || 500, { error: err.message });
  }
};
