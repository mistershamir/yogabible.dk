/**
 * Netlify Function: /.netlify/functions/ai-process-recording
 *
 * Called internally after a recording's asset is ready.
 * PHASE 1 ONLY (must complete within Netlify's ~26s function timeout):
 *   1. Requests Mux to generate auto-captions for the asset
 *   2. Saves aiStatus='captions_requested' on the session
 *   3. Returns immediately — does NOT poll or wait for captions
 *
 * Phase 2 (polling + Claude processing) is handled by ai-backfill?check=1,
 * which the user runs after 5-10 minutes once Mux has generated the captions.
 *
 * Env vars required:
 *   MUX_TOKEN_ID, MUX_TOKEN_SECRET — Mux API credentials
 */

const https = require('https');
const { getDoc, updateDoc } = require('./shared/firestore');
const { jsonResponse } = require('./shared/utils');

var COLLECTION = 'live-schedule';

// ═══════════════════════════════════════════════════
// Entry point — called by mux-webhook after asset.ready
// ═══════════════════════════════════════════════════

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(204, '');
  }

  try {
    var body = JSON.parse(event.body || '{}');
    var sessionId = body.sessionId;
    var assetId = body.assetId;

    if (!sessionId || !assetId) {
      return jsonResponse(400, { ok: false, error: 'sessionId and assetId required' });
    }

    // Verify internal call (simple shared secret)
    var internalSecret = process.env.AI_INTERNAL_SECRET || '';
    var providedSecret = body.secret || '';
    if (internalSecret && providedSecret !== internalSecret) {
      return jsonResponse(401, { ok: false, error: 'Unauthorized' });
    }

    console.log('[ai-process] Starting for session:', sessionId, 'asset:', assetId);

    // Mark processing started
    await updateDoc(COLLECTION, sessionId, {
      aiStatus: 'processing'
    });

    // Step 1: Request auto-generated captions from Mux (fast — just an API call)
    var trackId = await requestCaptions(assetId);
    console.log('[ai-process] Caption track requested:', trackId);

    if (!trackId) {
      await updateDoc(COLLECTION, sessionId, {
        aiStatus: 'error',
        aiError: 'No audio track found on asset'
      });
      return jsonResponse(200, { ok: true, status: 'no_audio_track' });
    }

    // Step 2: Mark as captions_requested — Phase 2 (ai-backfill?check=1) will poll later
    await updateDoc(COLLECTION, sessionId, {
      aiStatus: 'captions_requested',
      aiCaptionTrackId: trackId
    });

    console.log('[ai-process] Captions requested for session:', sessionId,
      '— run ai-backfill?check=1 in 5-10 minutes to complete processing');

    return jsonResponse(200, {
      ok: true,
      status: 'captions_requested',
      trackId: trackId,
      message: 'Captions requested from Mux. Run ai-backfill?check=1 in 5-10 minutes to complete processing.'
    });

  } catch (err) {
    console.error('[ai-process] Error:', err);

    // Try to mark the error on the session
    try {
      var errorBody = JSON.parse(event.body || '{}');
      if (errorBody.sessionId) {
        await updateDoc(COLLECTION, errorBody.sessionId, {
          aiStatus: 'error',
          aiError: err.message
        });
      }
    } catch (e) { /* ignore */ }

    return jsonResponse(200, { ok: true, error: err.message });
  }
};

// ═══════════════════════════════════════════════════
// Mux API helper
// ═══════════════════════════════════════════════════

function muxRequest(method, path, body) {
  var tokenId = process.env.MUX_TOKEN_ID;
  var tokenSecret = process.env.MUX_TOKEN_SECRET;
  if (!tokenId || !tokenSecret) {
    throw new Error('MUX_TOKEN_ID and MUX_TOKEN_SECRET env vars required');
  }

  return new Promise(function (resolve, reject) {
    var data = body ? JSON.stringify(body) : '';
    var opts = {
      hostname: 'api.mux.com',
      path: path,
      method: method,
      headers: {
        'Authorization': 'Basic ' + Buffer.from(tokenId + ':' + tokenSecret).toString('base64'),
        'Content-Type': 'application/json'
      }
    };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);

    var req = https.request(opts, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var raw = Buffer.concat(chunks).toString();
        try {
          var json = JSON.parse(raw);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            var err = new Error('Mux API error: ' + res.statusCode + ' ' + raw.substring(0, 200));
            err.status = res.statusCode;
            reject(err);
          }
        } catch (e) {
          reject(new Error('Mux API parse error: ' + raw.substring(0, 200)));
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function requestCaptions(assetId) {
  // First check if a text track already exists
  // Note: GET /assets/{id}/tracks is not a valid Mux endpoint — tracks are on the asset object
  var existing = await muxRequest('GET', '/video/v1/assets/' + assetId);
  var tracks = (existing.data && existing.data.tracks) || [];
  for (var i = 0; i < tracks.length; i++) {
    if (tracks[i].type === 'text' && tracks[i].text_type === 'subtitles') {
      return tracks[i].id;
    }
  }

  // Find the audio track ID — required for generate-subtitles endpoint
  var audioTrackId = null;
  for (var j = 0; j < tracks.length; j++) {
    if (tracks[j].type === 'audio') {
      audioTrackId = tracks[j].id;
      break;
    }
  }

  if (!audioTrackId) {
    console.error('[ai-process] No audio track found on asset:', assetId);
    return null;
  }

  // Request auto-generated captions via the correct endpoint
  console.log('[ai-process] Requesting captions on audio track:', audioTrackId);
  var result = await muxRequest('POST',
    '/video/v1/assets/' + assetId + '/tracks/' + audioTrackId + '/generate-subtitles',
    {
      generated_subtitles: [{
        language_code: 'en',
        name: 'English CC'
      }]
    }
  );

  // The response contains the newly created text track(s)
  var newTracks = result.data || [];
  if (Array.isArray(newTracks) && newTracks.length > 0) {
    return newTracks[0].id;
  }
  // Fallback: re-fetch tracks to find the new text track
  var refreshed = await muxRequest('GET', '/video/v1/assets/' + assetId);
  var refreshedTracks = (refreshed.data && refreshed.data.tracks) || [];
  for (var k = 0; k < refreshedTracks.length; k++) {
    if (refreshedTracks[k].type === 'text' && refreshedTracks[k].text_type === 'subtitles') {
      return refreshedTracks[k].id;
    }
  }
  return null;
}
