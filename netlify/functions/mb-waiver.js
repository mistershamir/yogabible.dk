/**
 * Netlify Function: /.netlify/functions/mb-waiver
 *
 * GET  ?clientId=...  — Check if client has signed the liability waiver + fetch waiver text
 * POST               — Accept liability waiver for a client
 *
 * Body for POST:
 *   clientId (string) - Mindbody client ID
 *   signatureImage (string, optional) - Base64 PNG of drawn signature
 */

const { mbFetch, jsonResponse, corsHeaders } = require('./shared/mb-api');

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  // GET: Fetch waiver text + check if client has signed
  if (event.httpMethod === 'GET') {
    try {
      var params = event.queryStringParameters || {};
      var result = { waiverText: null, clientSigned: false, agreementDate: null };

      // 1. Fetch the liability waiver text for the business
      try {
        var waiverData = await mbFetch('/client/liabilitywaiver');
        // MB returns waiver text — exact shape varies, try common fields
        result.waiverText = waiverData.Waiver || waiverData.WaiverText || waiverData.Text || waiverData.Html || null;
        if (!result.waiverText && typeof waiverData === 'object') {
          // If none of the expected fields, capture whatever we got for debugging
          result._rawWaiverKeys = Object.keys(waiverData);
          // Try to find any string field that looks like waiver content
          var keys = Object.keys(waiverData);
          for (var i = 0; i < keys.length; i++) {
            if (typeof waiverData[keys[i]] === 'string' && waiverData[keys[i]].length > 50) {
              result.waiverText = waiverData[keys[i]];
              result._waiverTextField = keys[i];
              break;
            }
          }
        }
      } catch (waiverErr) {
        console.warn('[mb-waiver] Could not fetch waiver text:', waiverErr.message);
        result._waiverError = waiverErr.message;
      }

      // 2. Check if client has signed (if clientId provided)
      if (params.clientId) {
        try {
          var clientData = await mbFetch('/client/clients?ClientIds=' + params.clientId);
          var clients = clientData.Clients || [];
          if (clients.length > 0) {
            var client = clients[0];
            var liability = client.Liability || {};
            result.clientSigned = liability.IsReleased === true;
            result.agreementDate = liability.AgreementDate || null;
            result.releasedBy = liability.ReleasedBy;
          }
        } catch (clientErr) {
          console.warn('[mb-waiver] Could not check client liability:', clientErr.message);
          result._clientError = clientErr.message;
        }
      }

      return jsonResponse(200, result);
    } catch (err) {
      console.error('[mb-waiver] GET error:', err);
      return jsonResponse(err.status || 500, { error: err.message });
    }
  }

  // POST: Accept liability waiver for a client
  if (event.httpMethod === 'POST') {
    try {
      var body = JSON.parse(event.body || '{}');

      if (!body.clientId) {
        return jsonResponse(400, { error: 'clientId is required' });
      }

      // 1. Try to set LiabilityRelease = true on the client (best-effort)
      //    The actual consent record is stored in Firestore on the frontend.
      //    MB may reject this call (e.g. LiabilityRelease not writable) — that's OK.
      var liability = {};
      try {
        var updateBody = {
          Client: {
            ClientId: body.clientId,
            LiabilityRelease: true
          },
          CrossRegionalUpdate: false
        };

        var data = await mbFetch('/client/updateclient', {
          method: 'POST',
          body: JSON.stringify(updateBody)
        });

        var updated = data.Client || {};
        liability = updated.Liability || {};
      } catch (updateErr) {
        console.warn('[mb-waiver] Could not set LiabilityRelease on client (non-critical):', updateErr.message);
      }

      // 2. If signature image provided, upload as client document (best-effort)
      if (body.signatureImage) {
        try {
          var sigFileName = 'liability-waiver-signature-' + body.clientId + '-' + new Date().toISOString().split('T')[0] + '.png';
          var base64Data = body.signatureImage.replace(/^data:image\/png;base64,/, '');

          await mbFetch('/client/uploadclientdocument', {
            method: 'POST',
            body: JSON.stringify({
              ClientId: body.clientId,
              File: {
                FileName: sigFileName,
                MediaType: 'png',
                Buffer: base64Data
              }
            })
          });
        } catch (uploadErr) {
          console.warn('[mb-waiver] Could not upload signature image (non-critical):', uploadErr.message);
        }
      }

      // Always return success — consent is recorded in Firestore on the frontend
      return jsonResponse(200, {
        success: true,
        clientId: body.clientId,
        isReleased: liability.IsReleased !== false,
        agreementDate: liability.AgreementDate || new Date().toISOString()
      });
    } catch (err) {
      console.error('[mb-waiver] POST error:', err);
      return jsonResponse(err.status || 500, { error: err.message });
    }
  }

  return jsonResponse(405, { error: 'Method not allowed' });
};
