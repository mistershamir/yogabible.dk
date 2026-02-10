/**
 * Netlify Function: /.netlify/functions/mb-waiver
 *
 * GET  ?clientId=...  — Check if client has signed the liability waiver
 * POST               — Accept liability waiver for a client
 *
 * Uses 3 checks (any one positive = signed):
 *   1. MB Liability.IsReleased field
 *   2. MB client notes (marker "WAIVER_SIGNED")
 *   3. MB uploaded signature document
 */

const { mbFetch, jsonResponse, corsHeaders } = require('./shared/mb-api');

var WAIVER_MARKER = 'WAIVER_SIGNED';

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  // GET: Check if client has signed the waiver
  if (event.httpMethod === 'GET') {
    try {
      var params = event.queryStringParameters || {};
      var result = { waiverText: null, clientSigned: false, agreementDate: null };

      // 1. Fetch the liability waiver text (try multiple endpoints/field paths)
      try {
        var waiverData = await mbFetch('/client/liabilitywaiver');
        console.log('[mb-waiver] liabilitywaiver response keys:', Object.keys(waiverData || {}));
        // Try known field paths
        result.waiverText = waiverData.Waiver || waiverData.WaiverText || waiverData.Text
          || waiverData.Html || waiverData.Content || waiverData.Body || null;
        // Try nested: LiabilityWaiver.Content, etc.
        if (!result.waiverText && waiverData.LiabilityWaiver) {
          var lw = waiverData.LiabilityWaiver;
          result.waiverText = lw.Content || lw.Text || lw.Html || lw.Waiver || lw.Body || null;
        }
        // Fallback: scan all string fields
        if (!result.waiverText && typeof waiverData === 'object') {
          var keys = Object.keys(waiverData);
          for (var i = 0; i < keys.length; i++) {
            var val = waiverData[keys[i]];
            if (typeof val === 'string' && val.length > 50) {
              result.waiverText = val;
              console.log('[mb-waiver] Found waiver text in field:', keys[i]);
              break;
            }
            // Scan nested objects too
            if (val && typeof val === 'object' && !Array.isArray(val)) {
              var subKeys = Object.keys(val);
              for (var si = 0; si < subKeys.length; si++) {
                if (typeof val[subKeys[si]] === 'string' && val[subKeys[si]].length > 50) {
                  result.waiverText = val[subKeys[si]];
                  console.log('[mb-waiver] Found waiver text in nested field:', keys[i] + '.' + subKeys[si]);
                  break;
                }
              }
              if (result.waiverText) break;
            }
          }
        }
      } catch (waiverErr) {
        console.warn('[mb-waiver] Could not fetch waiver text:', waiverErr.message);
        // Try alternate endpoint: /site/liabilitywaiver
        try {
          var altData = await mbFetch('/site/liabilitywaiver');
          console.log('[mb-waiver] site/liabilitywaiver response keys:', Object.keys(altData || {}));
          var altKeys = Object.keys(altData || {});
          for (var ai = 0; ai < altKeys.length; ai++) {
            if (typeof altData[altKeys[ai]] === 'string' && altData[altKeys[ai]].length > 50) {
              result.waiverText = altData[altKeys[ai]];
              break;
            }
          }
        } catch (altErr) {
          console.warn('[mb-waiver] Alternate endpoint also failed:', altErr.message);
        }
      }

      // 2. Check if client has signed (if clientId provided)
      if (params.clientId) {
        // Check MB Liability field
        try {
          var clientData = await mbFetch('/client/clients?ClientIds=' + params.clientId);
          var clients = clientData.Clients || [];
          if (clients.length > 0) {
            var client = clients[0];
            var liability = client.Liability || {};
            if (liability.IsReleased === true) {
              result.clientSigned = true;
              result.agreementDate = liability.AgreementDate || null;
              result.source = 'mb-liability';
            }
          }
        } catch (clientErr) {
          console.warn('[mb-waiver] Could not check client liability:', clientErr.message);
        }

        // Also check MB client notes for our marker (cross-browser reliable)
        if (!result.clientSigned) {
          try {
            var notesData = await mbFetch('/client/clientnotes?ClientId=' + params.clientId + '&Limit=50');
            var notes = notesData.Notes || [];
            for (var n = 0; n < notes.length; n++) {
              var noteText = (notes[n].Text || notes[n].Note || '').toUpperCase();
              if (noteText.indexOf(WAIVER_MARKER) > -1) {
                result.clientSigned = true;
                result.agreementDate = notes[n].DateTime || notes[n].CreatedDateTime || null;
                result.source = 'mb-note';
                break;
              }
            }
          } catch (notesErr) {
            console.warn('[mb-waiver] Could not check client notes:', notesErr.message);
          }
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

      // 1. Try to set LiabilityRelease on the client (best-effort, try multiple formats)
      var liability = {};
      var isoNow = new Date().toISOString();
      var updateFormats = [
        { Client: { Id: body.clientId, LiabilityRelease: true } },
        { Client: { Id: body.clientId, Liability: { IsReleased: true, AgreementDate: isoNow } } },
        { Client: { ClientId: body.clientId, LiabilityRelease: true }, CrossRegionalUpdate: false }
      ];
      for (var f = 0; f < updateFormats.length; f++) {
        try {
          var data = await mbFetch('/client/updateclient', {
            method: 'POST',
            body: JSON.stringify(updateFormats[f])
          });
          var updated = data.Client || {};
          liability = updated.Liability || {};
          if (liability.IsReleased) break;
        } catch (updateErr) {
          console.warn('[mb-waiver] updateclient format ' + f + ' failed:', updateErr.message);
        }
      }

      // 2. Save a marker note on the client (RELIABLE cross-browser persistence)
      try {
        var noteDate = new Date().toISOString().split('T')[0];
        await mbFetch('/client/addclientnote', {
          method: 'POST',
          body: JSON.stringify({
            ClientId: body.clientId,
            Note: {
              Text: WAIVER_MARKER + ' ' + noteDate,
              Type: { Id: 1 }
            }
          })
        });
        console.log('[mb-waiver] Saved waiver marker note for client', body.clientId);
      } catch (noteErr) {
        console.warn('[mb-waiver] Could not save waiver note (non-critical):', noteErr.message);
        // Try alternate note format
        try {
          await mbFetch('/client/addclientnote', {
            method: 'POST',
            body: JSON.stringify({
              ClientId: body.clientId,
              Text: WAIVER_MARKER + ' ' + new Date().toISOString().split('T')[0]
            })
          });
        } catch (e) {
          console.warn('[mb-waiver] Alternate note format also failed:', e.message);
        }
      }

      // 3. Upload signature image (best-effort)
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
          console.warn('[mb-waiver] Could not upload signature image:', uploadErr.message);
        }
      }

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
