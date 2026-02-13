/**
 * Netlify Function: POST /.netlify/functions/mb-contract-manage
 * Manages client contracts: terminate, suspend (pause), or resume.
 *
 * CONFIRMED BY MINDBODY SUPPORT (2026-02-13):
 *   Endpoint: POST /client/suspendcontract
 *   Required fields: ClientId, ClientContractId, SuspensionStart, Duration, DurationUnit, SuspensionType
 *   Working values: SuspensionType:"Vacation", DurationUnit:"Day"
 *   SuspensionStart = start date (defaults to today if omitted)
 *   Resume date = SuspensionStart + Duration(DurationUnit)
 *   Future-dated starts ARE supported via SuspensionStart.
 */

const { mbFetch, getStaffToken, jsonResponse, corsHeaders } = require('./shared/mb-api');

var TERMINATE_PATHS = ['/sale/terminatecontract', '/contract/terminatecontract', '/client/terminatecontract'];
var PAUSE_MARKER = 'CONTRACT_PAUSED';

// Read pause notes for a client from MB client notes
async function getPauseNotes(clientId) {
  try {
    var notesData = await mbFetch('/client/clientnotes?ClientId=' + clientId + '&Limit=100');
    var notes = notesData.Notes || notesData.ClientNotes || [];
    console.log('[mb-contract-manage] getPauseNotes: keys:', Object.keys(notesData), 'count:', notes.length);
    var pauses = [];
    for (var i = 0; i < notes.length; i++) {
      var text = notes[i].Text || notes[i].Note || notes[i].Body || '';
      if (text.indexOf(PAUSE_MARKER) === 0) {
        // Format: CONTRACT_PAUSED|contractId|startDate|endDate
        var parts = text.split('|');
        if (parts.length >= 4) {
          pauses.push({
            noteId: notes[i].Id,
            contractId: Number(parts[1]),
            startDate: parts[2],
            endDate: parts[3],
            noteDate: notes[i].DateTime || notes[i].CreatedDateTime || null
          });
        }
      }
    }
    return pauses;
  } catch (err) {
    console.warn('[mb-contract-manage] Could not read pause notes:', err.message);
    return [];
  }
}

// Save a pause marker note — try multiple MB API body formats
async function savePauseNote(clientId, contractId, startDate, endDate) {
  var noteText = PAUSE_MARKER + '|' + contractId + '|' + startDate + '|' + endDate;
  var formats = [
    { ClientId: String(clientId), Note: { Text: noteText, Type: { Id: 1 } } },
    { ClientId: String(clientId), Body: noteText },
    { ClientId: String(clientId), Text: noteText },
    { ClientId: String(clientId), Note: noteText }
  ];
  for (var i = 0; i < formats.length; i++) {
    try {
      var result = await mbFetch('/client/addclientnote', {
        method: 'POST',
        body: JSON.stringify(formats[i])
      });
      console.log('[mb-contract-manage] Saved pause note (format ' + i + '):', noteText, 'result:', JSON.stringify(result).substring(0, 200));
      return true;
    } catch (err) {
      console.warn('[mb-contract-manage] Note format ' + i + ' failed:', err.message);
    }
  }
  console.error('[mb-contract-manage] ALL note formats failed for:', noteText);
  return false;
}

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

      // Check if contract is already suspended (MB field + our notes)
      var existingPause = null;
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

      // NOTE: We no longer check MB notes for duplicate detection.
      // Notes persist even after admin deletes a suspension, causing false blocks.
      // Frontend checks isSuspended flag before showing the pause button.
      // MB itself will return "exceeded maximum iterations" if already at max pauses.

      // CONFIRMED BY MINDBODY SUPPORT (2026-02-13):
      // The correct parameter is SuspensionStart (NOT SuspendDate).
      // SuspensionStart = the start date of the suspension.
      // Duration + DurationUnit determine how long the suspension lasts.
      // Resume date = SuspensionStart + Duration(DurationUnit).
      // Future-dated starts are supported via SuspensionStart.
      var suspendBody = {
        ClientId: body.clientId,
        ClientContractId: ccId,
        SuspensionStart: body.startDate,
        Duration: durationDays,
        DurationUnit: 'Day',
        SuspensionType: 'Vacation'
      };

      console.log('[mb-contract-manage] Suspending contract:', JSON.stringify(suspendBody),
        'USER selected start:', body.startDate, 'end:', body.endDate, 'duration:', durationDays, 'days');

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

        // MB returns this when contract already has max suspensions
        if (combined.indexOf('exceeded') > -1 || combined.indexOf('maximum iterations') > -1 || combined.indexOf('already suspended') > -1) {
          console.log('[mb-contract-manage] Contract already at max suspensions — treating as already_suspended');
          return jsonResponse(409, {
            error: 'already_suspended',
            message: 'This membership has already been paused. You cannot add another pause.',
            suspendDate: body.startDate,
            resumeDate: body.endDate
          });
        }
        throw suspErr; // Re-throw other errors
      }

      console.log('[mb-contract-manage] Suspend SUCCESS:', JSON.stringify(suspResult).substring(0, 500));

      return jsonResponse(200, {
        success: true,
        action: 'suspend',
        suspendDate: body.startDate,
        resumeDate: body.endDate,
        durationDays: durationDays,
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
