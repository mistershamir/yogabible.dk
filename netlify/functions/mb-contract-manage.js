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

      // API reference docs confirm: /sale/suspendcontract with ResumeDate is the working format.
      // /client/suspendcontract returns "Duration and DurationUnit are required" with InvalidParameter code.
      // Try multiple approaches with full diagnostic capture.
      var attempts = [
        // 1: /sale/ with ResumeDate format (documented as WORKING in api-reference.md)
        {
          label: 'sale-resumeDate',
          path: '/sale/suspendcontract',
          body: {
            ClientId: body.clientId,
            ClientContractId: ccId,
            SuspendDate: body.startDate,
            ResumeDate: body.endDate,
            SendNotifications: true
          }
        },
        // 2: /client/ with ResumeDate format
        {
          label: 'client-resumeDate',
          path: '/client/suspendcontract',
          body: {
            ClientId: body.clientId,
            ClientContractId: ccId,
            SuspendDate: body.startDate,
            ResumeDate: body.endDate,
            SendNotifications: true
          }
        },
        // 3: /client/ with Duration + DurationUnit + ResumeDate (all fields combined)
        {
          label: 'client-all-fields',
          path: '/client/suspendcontract',
          body: {
            ClientId: body.clientId,
            ClientContractId: ccId,
            SuspendDate: body.startDate,
            ResumeDate: body.endDate,
            Duration: durationDays,
            DurationUnit: 'Days',
            SendNotifications: true
          }
        },
        // 4: /sale/ with Duration + DurationUnit (in case /sale/ needs different fields)
        {
          label: 'sale-duration',
          path: '/sale/suspendcontract',
          body: {
            ClientId: body.clientId,
            ClientContractId: ccId,
            SuspendDate: body.startDate,
            Duration: durationDays,
            DurationUnit: 'Days',
            SendNotifications: true
          }
        },
      ];

      var allResults = [];
      for (var ai = 0; ai < attempts.length; ai++) {
        var attempt = attempts[ai];
        try {
          console.log('[mb-contract-manage] Attempt ' + attempt.label + ': POST ' + attempt.path);
          console.log('[mb-contract-manage] Body:', JSON.stringify(attempt.body));
          var suspResult = await mbFetch(attempt.path, {
            method: 'POST',
            body: JSON.stringify(attempt.body)
          });

          console.log('[mb-contract-manage] SUCCESS (' + attempt.label + '):', JSON.stringify(suspResult).substring(0, 500));
          return jsonResponse(200, {
            success: true,
            action: 'suspend',
            suspendDate: body.startDate,
            resumeDate: body.endDate,
            durationDays: durationDays,
            endpointUsed: attempt.path,
            method: attempt.label,
            message: 'Contract suspension scheduled'
          });
        } catch (suspErr) {
          var mbData = suspErr.data || {};
          var mbErrorMsg = suspErr.message || 'Unknown error';
          if (mbData.Message) mbErrorMsg = mbData.Message;
          if (mbData.Error && mbData.Error.Message) mbErrorMsg = mbData.Error.Message;
          if (mbData.Errors && mbData.Errors.length) mbErrorMsg = mbData.Errors.map(function(e) { return e.Message || e.message || JSON.stringify(e); }).join('; ');

          var errInfo = {
            label: attempt.label,
            status: suspErr.status,
            message: mbErrorMsg,
            fullResponse: JSON.stringify(mbData).substring(0, 500)
          };
          console.error('[mb-contract-manage] Failed ' + attempt.label + ':', JSON.stringify(errInfo));
          allResults.push(errInfo);

          // If we got a non-JSON/404 response, skip to next path quickly
          // But if we got a real JSON error, still continue to next attempt
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
