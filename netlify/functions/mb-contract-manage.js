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

      // Fire ALL path+body combos in PARALLEL to avoid 504 timeout.
      // /sale/suspendcontract returns 404, so focus on /contract/ and /client/.
      var paths = ['/contract/suspendcontract', '/client/suspendcontract', '/sale/suspendcontract'];
      var bodies = [
        { label: 'A', data: { ClientContractId: ccId, SuspendDate: body.startDate, Duration: durationDays, DurationUnit: 'Days' } },
        { label: 'B', data: { ClientContractId: ccId, SuspendDate: body.startDate, Duration: durationDays, DurationUnit: 'Day' } },
        { label: 'C', data: { ClientId: body.clientId, ClientContractId: ccId, SuspendDate: body.startDate, Duration: durationDays, DurationUnit: 'Days' } },
        { label: 'D', data: { ClientId: body.clientId, ClientContractId: ccId, SuspendDate: body.startDate, Duration: durationDays, DurationUnit: 'Day' } },
      ];

      // Build all combos
      var combos = [];
      for (var pi = 0; pi < paths.length; pi++) {
        for (var bi = 0; bi < bodies.length; bi++) {
          combos.push({ path: paths[pi], label: bodies[bi].label, body: bodies[bi].data });
        }
      }

      console.log('[mb-contract-manage] Firing ' + combos.length + ' suspend combos in parallel');

      var results = await Promise.allSettled(combos.map(function(combo) {
        return mbFetch(combo.path, {
          method: 'POST',
          body: JSON.stringify(combo.body)
        }).then(function(data) {
          return { success: true, combo: combo, data: data };
        });
      }));

      // Check for any success
      var diagnostics = [];
      for (var ri = 0; ri < results.length; ri++) {
        var r = results[ri];
        var combo = combos[ri];
        if (r.status === 'fulfilled' && r.value.success) {
          console.log('[mb-contract-manage] SUCCESS: path=' + combo.path + ' variant=' + combo.label);
          return jsonResponse(200, {
            success: true,
            action: 'suspend',
            suspendDate: body.startDate,
            resumeDate: body.endDate,
            durationDays: durationDays,
            endpointUsed: combo.path,
            bodyVariant: combo.label,
            message: 'Contract suspension scheduled'
          });
        } else {
          var err = r.reason || {};
          diagnostics.push({
            path: combo.path,
            variant: combo.label,
            status: err.status || 'error',
            message: (err.message || '').substring(0, 120),
            data: err.data ? JSON.stringify(err.data).substring(0, 150) : null
          });
        }
      }

      // All failed
      console.error('[mb-contract-manage] All ' + combos.length + ' suspend combos failed');
      console.error('[mb-contract-manage] Diagnostics:', JSON.stringify(diagnostics));
      var lastDiag = diagnostics[diagnostics.length - 1] || {};
      return jsonResponse(400, {
        error: lastDiag.message || 'All suspend attempts failed',
        _attempts: diagnostics,
        _hint: 'Tried ' + combos.length + ' path+body combos in parallel.'
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
