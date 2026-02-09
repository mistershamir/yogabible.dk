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

      // MB API docs are behind auth — try multiple body formats to find what works.
      // The MB UI shows: SuspensionType dropdown, StartDate, Duration number + DurationUnit dropdown.
      var bodyVariants = [
        // A: Standard with plural "Days" + SuspendDate
        { ClientContractId: ccId, SuspendDate: body.startDate, Duration: durationDays, DurationUnit: 'Days' },
        // B: Singular "Day" (common API enum pattern)
        { ClientContractId: ccId, SuspendDate: body.startDate, Duration: durationDays, DurationUnit: 'Day' },
        // C: With ClientId included
        { ClientId: body.clientId, ClientContractId: ccId, SuspendDate: body.startDate, Duration: durationDays, DurationUnit: 'Days' },
        // D: Minimal — no SuspendDate (maybe defaults to today)
        { ClientContractId: ccId, Duration: durationDays, DurationUnit: 'Days' },
        // E: Duration as string (MB sometimes expects strings for numbers)
        { ClientContractId: ccId, SuspendDate: body.startDate, Duration: String(durationDays), DurationUnit: 'Days' },
      ];

      var allResults = [];
      var suspendPath = '/sale/suspendcontract';

      // Try each body variant on the primary path
      for (var vi = 0; vi < bodyVariants.length; vi++) {
        var variant = bodyVariants[vi];
        var label = String.fromCharCode(65 + vi);
        try {
          console.log('[mb-contract-manage] Trying variant ' + label + ' on ' + suspendPath + ':', JSON.stringify(variant));
          var suspResult = await mbFetch(suspendPath, {
            method: 'POST',
            body: JSON.stringify(variant)
          });

          console.log('[mb-contract-manage] SUCCESS variant ' + label + ':', JSON.stringify(suspResult).substring(0, 300));

          return jsonResponse(200, {
            success: true,
            action: 'suspend',
            suspendDate: body.startDate,
            resumeDate: body.endDate,
            durationDays: durationDays,
            endpointUsed: suspendPath,
            bodyVariant: label,
            message: 'Contract suspension scheduled'
          });
        } catch (suspErr) {
          var errInfo = {
            variant: label,
            path: suspendPath,
            status: suspErr.status,
            message: suspErr.message,
            data: suspErr.data ? JSON.stringify(suspErr.data).substring(0, 200) : null
          };
          console.log('[mb-contract-manage] Variant ' + label + ' failed:', JSON.stringify(errInfo));
          allResults.push(errInfo);

          // If 404/405 on primary path, skip remaining variants and try alt paths
          if (suspErr.status === 404 || suspErr.status === 405) break;
        }
      }

      // If primary path was 404, try alternate paths with variant A
      var firstResult = allResults[0] || {};
      if (firstResult.status === 404 || firstResult.status === 405) {
        var altPaths = ['/contract/suspendcontract', '/client/suspendcontract'];
        for (var pi = 0; pi < altPaths.length; pi++) {
          try {
            console.log('[mb-contract-manage] Trying alt path: ' + altPaths[pi]);
            var altResult = await mbFetch(altPaths[pi], {
              method: 'POST',
              body: JSON.stringify(bodyVariants[0])
            });
            console.log('[mb-contract-manage] SUCCESS on ' + altPaths[pi]);
            return jsonResponse(200, {
              success: true,
              action: 'suspend',
              suspendDate: body.startDate,
              resumeDate: body.endDate,
              durationDays: durationDays,
              endpointUsed: altPaths[pi],
              message: 'Contract suspension scheduled'
            });
          } catch (altErr) {
            allResults.push({
              variant: 'A',
              path: altPaths[pi],
              status: altErr.status,
              message: altErr.message,
              data: altErr.data ? JSON.stringify(altErr.data).substring(0, 200) : null
            });
          }
        }
      }

      // All attempts failed — return diagnostic info
      console.error('[mb-contract-manage] All suspend attempts failed:', JSON.stringify(allResults));
      var lastErr = allResults[allResults.length - 1] || {};
      return jsonResponse(lastErr.status || 500, {
        error: lastErr.message || 'All suspend attempts failed',
        _attempts: allResults,
        _hint: 'Tried ' + allResults.length + ' body variants. Check Netlify function logs for full details.'
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
