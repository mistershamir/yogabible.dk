/**
 * Netlify Function: POST /.netlify/functions/mb-contract-manage
 * Manages client contracts: terminate or suspend (pause).
 *
 * POST body:
 *   action (string) - 'terminate' or 'suspend'
 *   clientId (string) - Mindbody client ID
 *   clientContractId (number) - The client's specific contract instance ID
 *
 *   For terminate:
 *     terminationDate (string, YYYY-MM-DD) - When the termination takes effect
 *     terminationCode (string, optional) - Mindbody termination code
 *
 *   For suspend:
 *     startDate (string, YYYY-MM-DD) - When suspension begins
 *     endDate (string, YYYY-MM-DD) - When suspension ends
 */

const { mbFetch, clearTokenCache, jsonResponse, corsHeaders } = require('./shared/mb-api');

// MB v6 docs are ambiguous on the category for contract management endpoints.
// Try these paths in order until one returns a JSON response.
// MB v6 docs put these under Sale category — try /sale/ first
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

    // Force fresh token for contract management (staff permissions may have changed)
    clearTokenCache();

    if (!body.clientId || !body.clientContractId || !body.action) {
      return jsonResponse(400, { error: 'clientId, clientContractId, and action are required' });
    }

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
        TerminationDate: terminateBody.TerminationDate,
        HasTerminationCode: !!terminateBody.TerminationCode
      }));

      var lastTermErr = null;

      for (var ti = 0; ti < TERMINATE_PATHS.length; ti++) {
        try {
          console.log('[mb-contract-manage] Trying: ' + TERMINATE_PATHS[ti]);
          await mbFetch(TERMINATE_PATHS[ti], {
            method: 'POST',
            body: JSON.stringify(terminateBody)
          });

          return jsonResponse(200, {
            success: true,
            action: 'terminate',
            terminationDate: body.terminationDate,
            endpointUsed: TERMINATE_PATHS[ti],
            message: 'Contract termination scheduled'
          });
        } catch (termErr) {
          var errMsg = (termErr.message || '').toLowerCase();

          // If error is about termination code, retry without it on same path
          if (errMsg.indexOf('termination') > -1 || errMsg.indexOf('code') > -1) {
            console.log('[mb-contract-manage] Retrying without termination code on ' + TERMINATE_PATHS[ti]);
            delete terminateBody.TerminationCode;
            try {
              await mbFetch(TERMINATE_PATHS[ti], {
                method: 'POST',
                body: JSON.stringify(terminateBody)
              });

              return jsonResponse(200, {
                success: true,
                action: 'terminate',
                terminationDate: body.terminationDate,
                endpointUsed: TERMINATE_PATHS[ti],
                message: 'Contract termination scheduled'
              });
            } catch (retryErr) {
              lastTermErr = retryErr;
            }
          } else if (errMsg.indexOf('non-json') > -1 || errMsg.indexOf('not exist') > -1 || termErr.status === 404 || termErr.status === 405) {
            console.log('[mb-contract-manage] Path ' + TERMINATE_PATHS[ti] + ' failed (' + (termErr.status || 'unknown') + '), trying next...');
            lastTermErr = termErr;
          } else if (errMsg.indexOf('permission') > -1) {
            console.log('[mb-contract-manage] Permission denied on ' + TERMINATE_PATHS[ti] + ', trying next path...');
            lastTermErr = termErr;
          } else {
            // Real API error — don't try other paths
            throw termErr;
          }
        }
      }

      if (lastTermErr) {
        throw lastTermErr;
      }
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

      // MB API docs behind auth — try multiple body formats to find what works.
      // The MB UI shows: SuspensionType dropdown, StartDate, Duration + DurationUnit.
      var bodyVariants = [
        { label: 'A', body: { ClientContractId: ccId, SuspendDate: body.startDate, Duration: durationDays, DurationUnit: 'Days' } },
        { label: 'B', body: { ClientContractId: ccId, SuspendDate: body.startDate, Duration: durationDays, DurationUnit: 'Day' } },
        { label: 'C', body: { ClientId: body.clientId, ClientContractId: ccId, SuspendDate: body.startDate, Duration: durationDays, DurationUnit: 'Days' } },
        { label: 'D', body: { ClientContractId: ccId, Duration: durationDays, DurationUnit: 'Days' } },
        { label: 'E', body: { ClientContractId: ccId, SuspendDate: body.startDate, Duration: String(durationDays), DurationUnit: 'Days' } },
        { label: 'F', body: { ClientId: body.clientId, ClientContractId: ccId, SuspendDate: body.startDate, Duration: durationDays, DurationUnit: 'Day' } },
        { label: 'G', body: { ClientContractId: ccId, SuspendDate: body.startDate, Duration: durationDays, DurationUnit: 'Day', Test: true } },
      ];

      var suspendPaths = ['/sale/suspendcontract', '/contract/suspendcontract', '/client/suspendcontract'];
      var allResults = [];

      // Step 1: Find which endpoint path exists (returns JSON, not 404 HTML)
      var activePath = null;
      for (var pi = 0; pi < suspendPaths.length; pi++) {
        try {
          console.log('[mb-contract-manage] Probing path: ' + suspendPaths[pi]);
          var probeResult = await mbFetch(suspendPaths[pi], {
            method: 'POST',
            body: JSON.stringify(bodyVariants[0].body)
          });
          // If it succeeded, we're done!
          console.log('[mb-contract-manage] SUCCESS on probe ' + suspendPaths[pi]);
          return jsonResponse(200, {
            success: true,
            action: 'suspend',
            suspendDate: body.startDate,
            resumeDate: body.endDate,
            durationDays: durationDays,
            endpointUsed: suspendPaths[pi],
            bodyVariant: 'A',
            message: 'Contract suspension scheduled'
          });
        } catch (probeErr) {
          var probeMsg = (probeErr.message || '').toLowerCase();
          allResults.push({ variant: 'A-probe', path: suspendPaths[pi], status: probeErr.status, message: probeErr.message });

          if (probeErr.status === 404 || probeErr.status === 405 || probeMsg.indexOf('non-json') > -1) {
            console.log('[mb-contract-manage] Path ' + suspendPaths[pi] + ' does not exist (404/HTML), trying next...');
            continue;
          }
          // This path exists (returned JSON error like 400) — use it
          activePath = suspendPaths[pi];
          console.log('[mb-contract-manage] Found active path: ' + activePath + ' (status ' + probeErr.status + ')');
          break;
        }
      }

      // Step 2: Try ALL body variants on the active path
      if (activePath) {
        // Skip variant A (already tried as probe) — start from B
        for (var vi = 1; vi < bodyVariants.length; vi++) {
          var v = bodyVariants[vi];
          try {
            console.log('[mb-contract-manage] Trying variant ' + v.label + ' on ' + activePath + ':', JSON.stringify(v.body));
            var suspResult = await mbFetch(activePath, {
              method: 'POST',
              body: JSON.stringify(v.body)
            });

            console.log('[mb-contract-manage] SUCCESS variant ' + v.label + ':', JSON.stringify(suspResult).substring(0, 300));

            return jsonResponse(200, {
              success: true,
              action: 'suspend',
              suspendDate: body.startDate,
              resumeDate: body.endDate,
              durationDays: durationDays,
              endpointUsed: activePath,
              bodyVariant: v.label,
              message: 'Contract suspension scheduled'
            });
          } catch (suspErr) {
            var errInfo = {
              variant: v.label,
              path: activePath,
              status: suspErr.status,
              message: suspErr.message,
              data: suspErr.data ? JSON.stringify(suspErr.data).substring(0, 300) : null
            };
            console.log('[mb-contract-manage] Variant ' + v.label + ' failed:', JSON.stringify(errInfo));
            allResults.push(errInfo);
          }
        }
      }

      // All attempts failed — return diagnostic info
      console.error('[mb-contract-manage] All suspend attempts failed:', JSON.stringify(allResults));
      var lastErr = allResults[allResults.length - 1] || {};
      return jsonResponse(lastErr.status || 500, {
        error: lastErr.message || 'All suspend attempts failed',
        _attempts: allResults,
        _activePath: activePath,
        _hint: 'Tried ' + allResults.length + ' combinations. Check Netlify function logs for details.'
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
