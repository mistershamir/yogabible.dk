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

      // Add termination code if provided
      if (body.terminationCode) {
        terminateBody.TerminationCode = body.terminationCode;
      }

      console.log('[mb-contract-manage] Terminating contract:', JSON.stringify({
        ClientId: terminateBody.ClientId,
        ClientContractId: terminateBody.ClientContractId,
        TerminationDate: terminateBody.TerminationDate,
        HasTerminationCode: !!terminateBody.TerminationCode
      }));

      // Try with termination code first, then without if it fails
      try {
        var result = await mbFetch('/contract/terminatecontract', {
          method: 'POST',
          body: JSON.stringify(terminateBody)
        });

        return jsonResponse(200, {
          success: true,
          action: 'terminate',
          terminationDate: body.terminationDate,
          message: 'Contract termination scheduled'
        });
      } catch (termErr) {
        // If the error is about termination code, retry without it
        var errMsg = termErr.message || '';
        var errData = termErr.data || {};
        if (errMsg.toLowerCase().indexOf('termination') > -1 || errMsg.toLowerCase().indexOf('code') > -1) {
          console.log('[mb-contract-manage] Retrying without termination code...');
          delete terminateBody.TerminationCode;
          var result2 = await mbFetch('/contract/terminatecontract', {
            method: 'POST',
            body: JSON.stringify(terminateBody)
          });

          return jsonResponse(200, {
            success: true,
            action: 'terminate',
            terminationDate: body.terminationDate,
            message: 'Contract termination scheduled'
          });
        }

        throw termErr;
      }
    }

    // ── SUSPEND (PAUSE) ──
    if (body.action === 'suspend') {
      if (!body.startDate || !body.endDate) {
        return jsonResponse(400, { error: 'startDate and endDate are required for suspension' });
      }

      // Validate duration: 14 days minimum, 3 months maximum
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

      var suspResult = await mbFetch('/contract/suspendcontract', {
        method: 'POST',
        body: JSON.stringify(suspendBody)
      });

      return jsonResponse(200, {
        success: true,
        action: 'suspend',
        suspendDate: body.startDate,
        resumeDate: body.endDate,
        durationDays: durationDays,
        message: 'Contract suspension scheduled'
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
