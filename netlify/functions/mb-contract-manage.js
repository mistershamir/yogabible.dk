/**
 * Netlify Function: POST /.netlify/functions/mb-contract-manage
 * Manages client contracts: terminate, suspend (pause), or resume.
 *
 * CONFIRMED WORKING (2026-02-09):
 *   Endpoint: POST /client/suspendcontract
 *   Required fields: ClientId, ClientContractId, SuspendDate, Duration, DurationUnit, SuspensionType
 *   Working values: SuspensionType:"Vacation", DurationUnit:"Day"
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
        console.warn('[mb-contract-manage] Could not check suspension status:', checkErr.message);
        // Continue anyway — MB will reject duplicate if needed
      }

      // CONFIRMED WORKING FORMAT (2026-02-09):
      // POST /client/suspendcontract with SuspensionType:"Vacation", DurationUnit:"Day"
      var suspendBody = {
        ClientId: body.clientId,
        ClientContractId: ccId,
        SuspendDate: body.startDate,
        Duration: durationDays,
        DurationUnit: 'Day',
        SuspensionType: 'Vacation'
      };

      console.log('[mb-contract-manage] Suspending contract:', JSON.stringify(suspendBody));

      var suspResult = await mbFetch('/client/suspendcontract', {
        method: 'POST',
        body: JSON.stringify(suspendBody)
      });

      console.log('[mb-contract-manage] Suspend SUCCESS:', JSON.stringify(suspResult).substring(0, 300));
      return jsonResponse(200, {
        success: true,
        action: 'suspend',
        suspendDate: body.startDate,
        resumeDate: body.endDate,
        durationDays: durationDays,
        message: 'Contract suspension scheduled'
      });
    }

    // ── RESUME (CANCEL PAUSE EARLY) ──
    if (body.action === 'resume') {
      var resumeCcId = Number(body.clientContractId);

      // Try known endpoint paths for resuming/removing suspension
      var resumePaths = [
        '/client/resumecontract',
        '/sale/resumecontract',
        '/contract/resumecontract',
        '/client/removecontractsuspension',
        '/sale/removecontractsuspension'
      ];

      var resumeBody = {
        ClientId: body.clientId,
        ClientContractId: resumeCcId
      };

      console.log('[mb-contract-manage] Attempting to resume contract:', JSON.stringify(resumeBody));

      var lastResumeErr = null;
      var resumeResults = [];

      for (var ri = 0; ri < resumePaths.length; ri++) {
        try {
          var resumeResult = await mbFetch(resumePaths[ri], {
            method: 'POST',
            body: JSON.stringify(resumeBody)
          });
          console.log('[mb-contract-manage] Resume SUCCESS on ' + resumePaths[ri]);
          return jsonResponse(200, {
            success: true,
            action: 'resume',
            endpointUsed: resumePaths[ri],
            message: 'Contract suspension cancelled — membership resumed'
          });
        } catch (resumeErr) {
          var rMsg = resumeErr.message || '';
          var isNotFound = rMsg.indexOf('non-JSON') > -1 || resumeErr.status === 404;
          resumeResults.push({ path: resumePaths[ri], status: resumeErr.status || 'error', message: rMsg.substring(0, 100) });
          lastResumeErr = resumeErr;
          if (!isNotFound) {
            // Got a real JSON error — endpoint exists but rejected. Log and continue.
            console.log('[mb-contract-manage] Resume path ' + resumePaths[ri] + ' returned:', rMsg.substring(0, 200));
          }
        }
      }

      // All paths failed — resume is not available via API
      console.error('[mb-contract-manage] All resume paths failed:', JSON.stringify(resumeResults));
      return jsonResponse(400, {
        error: 'resume_not_available',
        message: 'Automatic resume is not available. Please contact the studio to cancel your pause early.',
        _pathResults: resumeResults
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
