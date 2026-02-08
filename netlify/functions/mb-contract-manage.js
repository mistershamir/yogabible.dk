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

const { mbFetch, jsonResponse, corsHeaders } = require('./shared/mb-api');

// MB v6 docs are ambiguous on the category for contract management endpoints.
// Try these paths in order until one returns a JSON response.
// MB v6 docs put these under Sale category — try /sale/ first
var TERMINATE_PATHS = ['/sale/terminatecontract', '/contract/terminatecontract', '/client/terminatecontract'];
var SUSPEND_PATHS = ['/sale/suspendcontract', '/contract/suspendcontract', '/client/suspendcontract'];

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

      if (durationDays < 14) {
        return jsonResponse(400, { error: 'Suspension must be at least 14 days' });
      }
      if (durationDays > 93) {
        return jsonResponse(400, { error: 'Suspension cannot exceed 3 months (93 days)' });
      }

      var suspendBody = {
        ClientId: body.clientId,
        ClientContractId: body.clientContractId,
        SuspendDate: body.startDate,
        ResumeDate: body.endDate,
        SendNotifications: true
      };

      console.log('[mb-contract-manage] Suspending contract:', JSON.stringify({
        ClientId: suspendBody.ClientId,
        ClientContractId: suspendBody.ClientContractId,
        SuspendDate: suspendBody.SuspendDate,
        ResumeDate: suspendBody.ResumeDate,
        DurationDays: durationDays
      }));

      var lastSuspErr = null;

      for (var si = 0; si < SUSPEND_PATHS.length; si++) {
        try {
          console.log('[mb-contract-manage] Trying: ' + SUSPEND_PATHS[si]);
          await mbFetch(SUSPEND_PATHS[si], {
            method: 'POST',
            body: JSON.stringify(suspendBody)
          });

          return jsonResponse(200, {
            success: true,
            action: 'suspend',
            suspendDate: body.startDate,
            resumeDate: body.endDate,
            durationDays: durationDays,
            endpointUsed: SUSPEND_PATHS[si],
            message: 'Contract suspension scheduled'
          });
        } catch (suspErr) {
          var suspMsg = (suspErr.message || '').toLowerCase();
          if (suspMsg.indexOf('non-json') > -1 || suspMsg.indexOf('not exist') > -1 || suspErr.status === 404 || suspErr.status === 405) {
            console.log('[mb-contract-manage] Path ' + SUSPEND_PATHS[si] + ' failed (' + (suspErr.status || 'unknown') + '), trying next...');
            lastSuspErr = suspErr;
          } else if (suspMsg.indexOf('permission') > -1) {
            console.log('[mb-contract-manage] Permission denied on ' + SUSPEND_PATHS[si] + ', trying next path...');
            lastSuspErr = suspErr;
          } else {
            throw suspErr;
          }
        }
      }

      if (lastSuspErr) {
        throw lastSuspErr;
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
