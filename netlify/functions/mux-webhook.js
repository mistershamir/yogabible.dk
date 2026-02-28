/**
 * Netlify Function: /.netlify/functions/mux-webhook
 * Receives Mux webhook events and auto-updates live-schedule recordings.
 *
 * When a live stream ends, Mux generates a recording asset. Once the asset
 * is ready (video.asset.ready), this webhook finds the matching live-schedule
 * document by muxPlaybackId and writes the recording's playback ID into
 * recordingPlaybackId — so admins don't have to do it manually.
 *
 * Setup:
 * 1. In Mux Dashboard → Settings → Webhooks, add:
 *    URL: https://www.yogabible.dk/.netlify/functions/mux-webhook
 *    Events: video.asset.ready
 * 2. Copy the webhook signing secret and set env var MUX_WEBHOOK_SECRET
 */

const crypto = require('crypto');
const { queryDocs, updateDoc } = require('./shared/firestore');
const { jsonResponse } = require('./shared/utils');

const COLLECTION = 'live-schedule';

/**
 * Verify Mux webhook signature.
 * @see https://docs.mux.com/guides/listen-for-webhooks#verify-webhook-signatures
 */
function verifySignature(rawBody, signatureHeader, secret) {
  if (!secret) return true; // Skip verification if no secret configured (dev)
  if (!signatureHeader) return false;

  // Parse the header: t=<timestamp>,v1=<signature>
  var parts = {};
  signatureHeader.split(',').forEach(function (pair) {
    var kv = pair.split('=');
    parts[kv[0]] = kv.slice(1).join('=');
  });

  var timestamp = parts.t;
  var expectedSig = parts.v1;
  if (!timestamp || !expectedSig) return false;

  // Reject timestamps older than 5 minutes
  var age = Math.abs(Date.now() / 1000 - parseInt(timestamp, 10));
  if (age > 300) return false;

  var payload = timestamp + '.' + rawBody;
  var hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  var computed = hmac.digest('hex');

  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(expectedSig));
}

exports.handler = async function (event) {
  // Only accept POST
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  // Verify signature
  var secret = process.env.MUX_WEBHOOK_SECRET || '';
  var signature = event.headers['mux-signature'] || '';
  var rawBody = event.body || '';

  if (secret && !verifySignature(rawBody, signature, secret)) {
    console.error('[mux-webhook] Invalid signature');
    return jsonResponse(401, { error: 'Invalid signature' });
  }

  try {
    var payload = JSON.parse(rawBody);
    var type = payload.type;

    console.log('[mux-webhook] Received event:', type);

    // We only care about video.asset.ready — the recording is ready to play
    if (type === 'video.asset.ready') {
      await handleAssetReady(payload.data);
    }

    // Always return 200 so Mux doesn't retry
    return jsonResponse(200, { ok: true });

  } catch (err) {
    console.error('[mux-webhook] Error:', err);
    // Still return 200 to prevent Mux retries on parse errors
    return jsonResponse(200, { ok: true, error: err.message });
  }
};

/**
 * Handle video.asset.ready — find the live-schedule doc and set recordingPlaybackId.
 *
 * Mux assets from live streams have:
 * - data.live_stream_id — the stream that produced this recording
 * - data.playback_ids[0].id — the recording's playback ID
 *
 * Our live-schedule docs store muxPlaybackId (the live stream playback ID).
 * We also need to match via the live stream's playback ID. Mux provides
 * the live_stream_id on the asset, and the asset has its own playback_ids.
 *
 * Strategy: The live_stream_id from Mux's asset data corresponds to a stream
 * whose playback ID we stored in muxPlaybackId on our schedule doc. We try
 * to match using passthrough metadata first, then fall back to checking the
 * asset's source and matching via the most recent session.
 */
async function handleAssetReady(assetData) {
  if (!assetData) return;

  // Get the recording playback ID from the new asset
  var playbackIds = assetData.playback_ids || [];
  if (!playbackIds.length) {
    console.log('[mux-webhook] Asset has no playback IDs, skipping');
    return;
  }

  // Prefer public playback ID
  var recordingPlaybackId = null;
  for (var i = 0; i < playbackIds.length; i++) {
    if (playbackIds[i].policy === 'public') {
      recordingPlaybackId = playbackIds[i].id;
      break;
    }
  }
  if (!recordingPlaybackId) {
    recordingPlaybackId = playbackIds[0].id;
  }

  var liveStreamId = assetData.live_stream_id;

  if (!liveStreamId) {
    console.log('[mux-webhook] Asset is not from a live stream, skipping');
    return;
  }

  console.log('[mux-webhook] Recording ready:', recordingPlaybackId, 'from stream:', liveStreamId);

  // Try to match via passthrough (if we stored the session ID there)
  var passthrough = assetData.passthrough;
  if (passthrough) {
    try {
      var meta = JSON.parse(passthrough);
      if (meta.sessionId) {
        console.log('[mux-webhook] Matched via passthrough sessionId:', meta.sessionId);
        await updateDoc(COLLECTION, meta.sessionId, {
          recordingPlaybackId: recordingPlaybackId,
          recordingAssetId: assetData.id,
          status: 'ended'
        });
        console.log('[mux-webhook] Updated session', meta.sessionId, 'with recording', recordingPlaybackId);
        return;
      }
    } catch (e) {
      // passthrough wasn't JSON, ignore
    }
  }

  // Fallback: find session with matching muxStreamKey (we store the live stream ID there)
  // or find the most recent 'live' or 'scheduled' session
  var sessions = await queryDocs(COLLECTION,
    [{ field: 'status', op: 'in', value: ['live', 'scheduled', 'ended'] }],
    { orderBy: 'startDateTime', orderDir: 'desc', limit: 50 }
  );

  // Try to match by muxStreamKey === liveStreamId
  var matched = null;
  for (var j = 0; j < sessions.length; j++) {
    if (sessions[j].muxStreamKey === liveStreamId) {
      matched = sessions[j];
      break;
    }
  }

  // Fallback: match by muxPlaybackId if the stream's playback matches
  // (The playback ID of the stream and the asset's source stream ID are different,
  // but if someone stored the liveStreamId in any field, we can match.)
  if (!matched) {
    // Try matching sessions that are 'live' status (most likely the one that just ended)
    for (var k = 0; k < sessions.length; k++) {
      if (sessions[k].status === 'live' && !sessions[k].recordingPlaybackId) {
        matched = sessions[k];
        break;
      }
    }
  }

  if (matched) {
    console.log('[mux-webhook] Matched session:', matched.id, '(' + (matched.title_da || matched.title_en) + ')');
    await updateDoc(COLLECTION, matched.id, {
      recordingPlaybackId: recordingPlaybackId,
      recordingAssetId: assetData.id,
      status: 'ended'
    });
    console.log('[mux-webhook] Updated session', matched.id, 'with recording', recordingPlaybackId);
  } else {
    console.log('[mux-webhook] No matching session found for live stream', liveStreamId);
    // Store as an unmatched recording in Firestore for manual assignment
    console.log('[mux-webhook] Recording playback ID for manual assignment:', recordingPlaybackId);
  }
}
