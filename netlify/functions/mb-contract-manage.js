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

      // BREAKTHROUGH: SuspensionType:"None" caused 500 (different from 400 InvalidParameter).
      // MB admin shows valid types: Illness, Injury, Vacation.
      // When a type is selected, form shows "Suspension Length" + "Month(s)" + "No Of Iterations".
      // Try real suspension types with Duration in both days and months.
      var allResults = [];

      var suspTypeAttempts = [
        // 1: Vacation type + duration in days (user's 14-day pause)
        {
          label: 'vacation-days',
          body: {
            ClientId: body.clientId,
            ClientContractId: ccId,
            SuspendDate: body.startDate,
            Duration: durationDays,
            DurationUnit: 'Day',
            SuspensionType: 'Vacation'
          }
        },
        // 2: Vacation type + duration in months (1 month, like admin UI default)
        {
          label: 'vacation-month',
          body: {
            ClientId: body.clientId,
            ClientContractId: ccId,
            SuspendDate: body.startDate,
            Duration: 1,
            DurationUnit: 'Month',
            SuspensionType: 'Vacation'
          }
        },
        // 3: Illness type + days
        {
          label: 'illness-days',
          body: {
            ClientId: body.clientId,
            ClientContractId: ccId,
            SuspendDate: body.startDate,
            Duration: durationDays,
            DurationUnit: 'Day',
            SuspensionType: 'Illness'
          }
        },
      ];

      for (var ai = 0; ai < suspTypeAttempts.length; ai++) {
        var attempt = suspTypeAttempts[ai];
        try {
          console.log('[mb-contract-manage] Attempt ' + attempt.label + ':', JSON.stringify(attempt.body));
          var suspResult = await mbFetch('/client/suspendcontract', {
            method: 'POST',
            body: JSON.stringify(attempt.body)
          });

          console.log('[mb-contract-manage] SUCCESS (' + attempt.label + ')');
          return jsonResponse(200, {
            success: true,
            action: 'suspend',
            suspendDate: body.startDate,
            resumeDate: body.endDate,
            durationDays: durationDays,
            method: attempt.label,
            message: 'Contract suspension scheduled'
          });
        } catch (suspErr) {
          var mbData = suspErr.data || {};
          var mbErrorMsg = suspErr.message || 'Unknown error';
          if (mbData.Error && mbData.Error.Message) mbErrorMsg = mbData.Error.Message;

          allResults.push({
            label: attempt.label,
            status: suspErr.status,
            message: mbErrorMsg,
            fullResponse: JSON.stringify(mbData).substring(0, 500)
          });
          console.error('[mb-contract-manage] Failed ' + attempt.label + ':', mbErrorMsg);
        }
      }

      // All failed — return diagnostic data
      var lastJsonErr = null;
      for (var ri = allResults.length - 1; ri >= 0; ri--) {
        if (allResults[ri].status && allResults[ri].status !== 404) {
          lastJsonErr = allResults[ri];
          break;
        }
      }
      var lastErr = lastJsonErr || allResults[allResults.length - 1] || {};
      return jsonResponse(400, {
        error: lastErr.message || 'All suspend attempts failed',
        _attempts: allResults
      });
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
