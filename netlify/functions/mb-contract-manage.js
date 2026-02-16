/**
 * Netlify Function: POST /.netlify/functions/mb-contract-manage
 * Manages client contracts: terminate, suspend (pause), or resume.
 *
 * Suspend uses MB suspension type "Self-suspending" (configured in MB Settings):
 *   - Min 1 month, max 3 months
 *   - DurationUnit: "Month", Duration: 1/2/3
 *   - SuspensionStart = start date (future-dated supported)
 */

const { mbFetch, getStaffToken, jsonResponse, corsHeaders } = require('./shared/mb-api');

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
      if (!body.startDate) {
        return jsonResponse(400, { error: 'startDate is required for suspension' });
      }

      var months = Number(body.months);
      if (!months || months < 1 || months > 3) {
        return jsonResponse(400, { error: 'months must be 1, 2, or 3' });
      }

      // Calculate end date (start + N months) for the response
      var start = new Date(body.startDate);
      var endDate = new Date(start);
      endDate.setMonth(endDate.getMonth() + months);
      var endDateStr = endDate.toISOString().split('T')[0];

      var ccId = Number(body.clientContractId);

      // Check if contract is already suspended
      try {
        var contractsData = await mbFetch('/client/clientcontracts?ClientId=' + body.clientId);
        var targetContract = (contractsData.Contracts || []).find(function(c) { return c.Id === ccId; });
        if (targetContract && targetContract.IsSuspended) {
          return jsonResponse(409, {
            error: 'already_suspended',
            message: 'This membership is already paused. You cannot add another pause while one is active.'
          });
        }
      } catch (checkErr) {
        console.warn('[mb-contract-manage] Could not check MB suspension status:', checkErr.message);
      }

      var suspendBody = {
        ClientId: body.clientId,
        ClientContractId: ccId,
        SuspensionStart: body.startDate,
        Duration: months,
        DurationUnit: 'Month',
        SuspensionType: 'Self-suspending'
      };

      console.log('[mb-contract-manage] Suspending contract:', JSON.stringify(suspendBody),
        'months:', months, 'calculated end:', endDateStr);

      var suspResult;
      try {
        suspResult = await mbFetch('/client/suspendcontract', {
          method: 'POST',
          body: JSON.stringify(suspendBody)
        });
      } catch (suspErr) {
        var suspErrMsg = (suspErr.message || '').toLowerCase();
        var suspErrData = suspErr.data && suspErr.data.Error ? suspErr.data.Error.Message || '' : '';
        var combined = suspErrMsg + ' ' + suspErrData.toLowerCase();

        if (combined.indexOf('exceeded') > -1 || combined.indexOf('maximum iterations') > -1 || combined.indexOf('already suspended') > -1) {
          console.log('[mb-contract-manage] Contract already at max suspensions — treating as already_suspended');
          return jsonResponse(409, {
            error: 'already_suspended',
            message: 'This membership has already been paused. You cannot add another pause.',
            suspendDate: body.startDate,
            resumeDate: endDateStr
          });
        }
        throw suspErr;
      }

      console.log('[mb-contract-manage] Suspend SUCCESS:', JSON.stringify(suspResult).substring(0, 500));

      return jsonResponse(200, {
        success: true,
        action: 'suspend',
        suspendDate: body.startDate,
        resumeDate: endDateStr,
        months: months,
        mbResponse: suspResult,
        message: 'Contract suspension scheduled'
      });
    }

    // ── RESUME (CANCEL PAUSE EARLY) ──
    // MB Public API v6 has NO resume/unsuspend endpoint. All paths tested, none work.
    // Do NOT probe endpoints — they may cause side effects (duplicate suspensions).
    // This action is handled entirely on the frontend (contact message).
    if (body.action === 'resume') {
      return jsonResponse(400, {
        error: 'resume_not_available',
        message: 'Automatic resume is not available via the Mindbody API. Please contact the studio.'
      });
    }

    return jsonResponse(400, { error: 'Invalid action. Use "terminate", "suspend", or "resume".' });

  } catch (err) {
    console.error('[mb-contract-manage] Error:', err.message, err.data ? JSON.stringify(err.data) : '');
    var errorMsg = err.message || 'Contract management failed';
    if (err.data && err.data.Error && err.data.Error.Message) {
      errorMsg = err.data.Error.Message;
    }
    return jsonResponse(err.status || 500, { error: errorMsg });
  }
};
