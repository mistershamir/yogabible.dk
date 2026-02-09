/**
 * Netlify Function: POST /.netlify/functions/mb-contract-manage
 * Manages client contracts: terminate or suspend (pause).
 */

const { mbFetch, getStaffToken, clearTokenCache, jsonResponse, corsHeaders } = require('./shared/mb-api');

var TERMINATE_PATHS = ['/sale/terminatecontract', '/contract/terminatecontract', '/client/terminatecontract'];

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    var body = JSON.parse(event.body || '{}');

    if (!body.clientId || !body.clientContractId || !body.action) {
      return jsonResponse(400, { error: 'clientId, clientContractId, and action are required' });
    }

    // Ensure auth token is cached before making API calls
    await getStaffToken();

    // ── TERMINATE ──
    if (body.action === 'terminate') {
      if (!body.terminationDate) {
        return jsonResponse(400, { error: 'terminationDate is required for termination' });
      }

      var terminateBody = {
        ClientId: body.clientId,
        ClientContractId: body.clientContractId,
        TerminationDate: body.terminationDate,
        SendNotifications: true
      };

      if (body.terminationCode) {
        terminateBody.TerminationCode = body.terminationCode;
      }

      console.log('[mb-contract-manage] Terminating contract:', JSON.stringify({
        ClientId: terminateBody.ClientId,
        ClientContractId: terminateBody.ClientContractId,
        TerminationDate: terminateBody.TerminationDate
      }));

      var lastTermErr = null;

      for (var ti = 0; ti < TERMINATE_PATHS.length; ti++) {
        try {
          await mbFetch(TERMINATE_PATHS[ti], { method: 'POST', body: JSON.stringify(terminateBody) });
          return jsonResponse(200, { success: true, action: 'terminate', terminationDate: body.terminationDate, endpointUsed: TERMINATE_PATHS[ti] });
        } catch (termErr) {
          var errMsg = (termErr.message || '').toLowerCase();
          if (errMsg.indexOf('termination') > -1 || errMsg.indexOf('code') > -1) {
            delete terminateBody.TerminationCode;
            try {
              await mbFetch(TERMINATE_PATHS[ti], { method: 'POST', body: JSON.stringify(terminateBody) });
              return jsonResponse(200, { success: true, action: 'terminate', terminationDate: body.terminationDate, endpointUsed: TERMINATE_PATHS[ti] });
            } catch (retryErr) { lastTermErr = retryErr; }
          } else if (errMsg.indexOf('non-json') > -1 || termErr.status === 404 || termErr.status === 405) {
            lastTermErr = termErr;
          } else {
            throw termErr;
          }
        }
      }
      if (lastTermErr) throw lastTermErr;
    }

    // ── SUSPEND (PAUSE) ──
    if (body.action === 'suspend') {
      if (!body.startDate || !body.endDate) {
        return jsonResponse(400, { error: 'startDate and endDate are required for suspension' });
      }

      var start = new Date(body.startDate);
      var end = new Date(body.endDate);
      var durationDays = Math.round((end - start) / 86400000);

      if (isNaN(durationDays) || durationDays < 1) {
        return jsonResponse(400, { error: 'Invalid dates — could not calculate duration' });
      }
      if (durationDays < 14) {
        return jsonResponse(400, { error: 'Suspension must be at least 14 days' });
      }
      if (durationDays > 93) {
        return jsonResponse(400, { error: 'Suspension cannot exceed 3 months (93 days)' });
      }

      var ccId = Number(body.clientContractId);

      // /client/suspendcontract is the confirmed active endpoint (returns JSON).
      // /sale/ and /contract/ both return 404 HTML.
      var suspendPath = '/client/suspendcontract';
      var suspendBody = {
        ClientId: body.clientId,
        ClientContractId: ccId,
        SuspendDate: body.startDate,
        Duration: durationDays,
        DurationUnit: 'Days'
      };

      console.log('[mb-contract-manage] Suspend on ' + suspendPath + ':', JSON.stringify(suspendBody));

      try {
        var suspResult = await mbFetch(suspendPath, {
          method: 'POST',
          body: JSON.stringify(suspendBody)
        });

        console.log('[mb-contract-manage] SUCCESS:', JSON.stringify(suspResult).substring(0, 500));
        return jsonResponse(200, {
          success: true,
          action: 'suspend',
          suspendDate: body.startDate,
          resumeDate: body.endDate,
          durationDays: durationDays,
          endpointUsed: suspendPath,
          message: 'Contract suspension scheduled'
        });
      } catch (suspErr) {
        // Extract the FULL error from MB — check all possible fields
        var mbData = suspErr.data || {};
        var mbErrorMsg = suspErr.message || 'Unknown error';
        var mbFullResponse = JSON.stringify(mbData);

        // MB can put errors in various places
        if (mbData.Message) mbErrorMsg = mbData.Message;
        if (mbData.Error && mbData.Error.Message) mbErrorMsg = mbData.Error.Message;
        if (mbData.Errors && mbData.Errors.length) mbErrorMsg = mbData.Errors.map(function(e) { return e.Message || e.message || JSON.stringify(e); }).join('; ');
        if (mbData.error) mbErrorMsg = typeof mbData.error === 'string' ? mbData.error : JSON.stringify(mbData.error);

        console.error('[mb-contract-manage] Suspend FAILED. Status:', suspErr.status);
        console.error('[mb-contract-manage] Error message:', mbErrorMsg);
        console.error('[mb-contract-manage] Full MB response:', mbFullResponse.substring(0, 1000));

        // Return EVERYTHING to the frontend for diagnosis
        return jsonResponse(suspErr.status || 400, {
          error: mbErrorMsg,
          _mbStatus: suspErr.status,
          _mbFullResponse: mbFullResponse.substring(0, 800),
          _sentBody: suspendBody,
          _path: suspendPath
        });
      }
    }

    return jsonResponse(400, { error: 'Invalid action. Use "terminate" or "suspend".' });

  } catch (err) {
    console.error('[mb-contract-manage] Error:', err.message, err.data ? JSON.stringify(err.data) : '');
    var errorMsg = err.message || 'Contract management failed';
    if (err.data && err.data.Error && err.data.Error.Message) {
      errorMsg = err.data.Error.Message;
    }
    return jsonResponse(err.status || 500, { error: errorMsg });
  }
};
