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

      // Try /contract/ path first (confirmed to return JSON, not 404 HTML like /sale/).
      // Then /client/ as fallback. Max 4 sequential API calls.
      var suspendPaths = ['/contract/suspendcontract', '/client/suspendcontract'];
      var suspendBodies = [
        // Primary: with ClientId, Duration as int, "Days" plural
        { label: 'A', data: { ClientId: body.clientId, ClientContractId: ccId, SuspendDate: body.startDate, Duration: durationDays, DurationUnit: 'Days' } },
        // Alt: singular "Day"
        { label: 'B', data: { ClientId: body.clientId, ClientContractId: ccId, SuspendDate: body.startDate, Duration: durationDays, DurationUnit: 'Day' } },
      ];

      var allResults = [];

      for (var sp = 0; sp < suspendPaths.length; sp++) {
        var spath = suspendPaths[sp];
        for (var sb = 0; sb < suspendBodies.length; sb++) {
          var svariant = suspendBodies[sb];
          try {
            console.log('[mb-contract-manage] Suspend ' + svariant.label + ' on ' + spath + ':', JSON.stringify(svariant.data));
            var suspResult = await mbFetch(spath, {
              method: 'POST',
              body: JSON.stringify(svariant.data)
            });

            console.log('[mb-contract-manage] SUCCESS:', JSON.stringify(suspResult).substring(0, 300));
            return jsonResponse(200, {
              success: true,
              action: 'suspend',
              suspendDate: body.startDate,
              resumeDate: body.endDate,
              durationDays: durationDays,
              endpointUsed: spath,
              bodyVariant: svariant.label,
              message: 'Contract suspension scheduled'
            });
          } catch (suspErr) {
            var suspMsg = (suspErr.message || '').toLowerCase();
            var errDetail = {
              variant: svariant.label,
              path: spath,
              status: suspErr.status,
              message: suspErr.message,
              fullData: suspErr.data ? JSON.stringify(suspErr.data).substring(0, 500) : null
            };
            console.log('[mb-contract-manage] Failed ' + svariant.label + ':', JSON.stringify(errDetail));
            allResults.push(errDetail);

            // If this path returns 404/HTML, skip remaining variants on it
            if (suspErr.status === 404 || suspErr.status === 405 || suspMsg.indexOf('non-json') > -1) {
              console.log('[mb-contract-manage] Path ' + spath + ' does not exist, skipping...');
              break;
            }
          }
        }
      }

      // All attempts failed — return full diagnostic data
      console.error('[mb-contract-manage] All suspend attempts failed:', JSON.stringify(allResults));
      var lastRes = allResults[allResults.length - 1] || {};
      return jsonResponse(400, {
        error: lastRes.message || 'All suspend attempts failed',
        _attempts: allResults,
        _hint: 'Tried ' + allResults.length + ' combos. Check _attempts for full error data from MB.'
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
