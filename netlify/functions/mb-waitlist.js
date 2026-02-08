/**
 * Netlify Function: GET /.netlify/functions/mb-waitlist
 * Fetches and manages waitlist entries for full classes.
 *
 * GET query params:
 *   classScheduleId (optional) - filter by specific class schedule
 *   clientId (optional) - filter by client
 *   classDescriptionId (optional) - filter by class type
 *
 * POST body (add to waitlist):
 *   clientId (string) - Mindbody client ID
 *   classScheduleId (number) - the class schedule ID to waitlist for
 *
 * DELETE body (remove from waitlist):
 *   waitlistEntryId (number) - the waitlist entry ID to remove
 */

const { mbFetch, jsonResponse, corsHeaders } = require('./shared/mb-api');

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  // GET: Fetch waitlist entries
  if (event.httpMethod === 'GET') {
    try {
      var params = event.queryStringParameters || {};
      var qsParams = { Limit: '200' };

      if (params.classScheduleId) qsParams.ClassScheduleIds = params.classScheduleId;
      if (params.clientId) qsParams.ClientIds = params.clientId;
      if (params.classDescriptionId) qsParams.ClassDescriptionIds = params.classDescriptionId;

      var queryString = new URLSearchParams(qsParams).toString();
      console.log('mb-waitlist GET query:', queryString);

      var data = await mbFetch('/class/waitlistentries?' + queryString);

      var entries = (data.WaitlistEntries || []).map(function(w) {
        return {
          id: w.Id,
          classId: w.ClassId,
          classDate: w.ClassDate ? w.ClassDate.DateTime || w.ClassDate : null,
          clientId: w.Client ? w.Client.Id : null,
          clientName: w.Client ? ((w.Client.FirstName || '') + ' ' + (w.Client.LastName || '')).trim() : '',
          enrollmentDate: w.EnrollmentDate || null,
          requestDate: w.RequestDateTime || null,
          classScheduleId: w.ClassSchedule ? w.ClassSchedule.Id : null,
          className: w.ClassDescription ? w.ClassDescription.Name : '',
          webSignup: w.Web || false
        };
      });

      return jsonResponse(200, { waitlistEntries: entries, total: entries.length });
    } catch (err) {
      console.error('mb-waitlist GET error:', err);
      return jsonResponse(err.status || 500, { error: err.message });
    }
  }

  // POST: Add client to waitlist
  if (event.httpMethod === 'POST') {
    try {
      var body = JSON.parse(event.body || '{}');

      if (!body.clientId || !body.classScheduleId) {
        return jsonResponse(400, { error: 'clientId and classScheduleId are required' });
      }

      var data = await mbFetch('/class/addclienttowaitlist', {
        method: 'POST',
        body: JSON.stringify({
          ClientId: body.clientId,
          ClassScheduleId: body.classScheduleId
        })
      });

      return jsonResponse(200, {
        success: true,
        waitlistEntry: data.WaitlistEntry || null,
        message: 'Added to waitlist'
      });
    } catch (err) {
      console.error('mb-waitlist POST error:', err);
      var errorMsg = err.message || 'Failed to add to waitlist';
      if (err.data && err.data.Error && err.data.Error.Message) {
        errorMsg = err.data.Error.Message;
      }
      return jsonResponse(err.status || 500, { error: errorMsg });
    }
  }

  // DELETE: Remove from waitlist
  if (event.httpMethod === 'DELETE') {
    try {
      var body = JSON.parse(event.body || '{}');

      if (!body.waitlistEntryId) {
        return jsonResponse(400, { error: 'waitlistEntryId is required' });
      }

      var data = await mbFetch('/class/removeclientfromwaitlist', {
        method: 'POST',
        body: JSON.stringify({
          WaitlistEntryIds: [body.waitlistEntryId]
        })
      });

      return jsonResponse(200, { success: true, message: 'Removed from waitlist' });
    } catch (err) {
      console.error('mb-waitlist DELETE error:', err);
      var errorMsg = err.message || 'Failed to remove from waitlist';
      if (err.data && err.data.Error && err.data.Error.Message) {
        errorMsg = err.data.Error.Message;
      }
      return jsonResponse(err.status || 500, { error: errorMsg });
    }
  }

  return jsonResponse(405, { error: 'Method not allowed' });
};
