/**
 * Netlify Function: /.netlify/functions/mux-webhook
 * Fully autonomous live stream lifecycle — no manual admin actions needed.
 *
 * Handles 3 Mux events:
 *
 *   1. video.live_stream.active  — Stream went live (teacher pressed On Air)
 *      → Finds the closest scheduled session by time (±30 min window)
 *      → Sets status to 'live', stores the Mux live stream ID
 *
 *   2. video.live_stream.idle    — Stream ended (teacher pressed Off)
 *      → Finds the session marked 'live' with matching stream ID
 *      → Sets status to 'ended'
 *
 *   3. video.asset.ready         — Recording asset is ready to play
 *      → Finds the session by stored muxLiveStreamId
 *      → Writes recordingPlaybackId so students can watch the replay
 *
 * Setup:
 * 1. Mux Dashboard → Settings → Webhooks → Add endpoint:
 *    URL: https://www.yogabible.dk/.netlify/functions/mux-webhook
 *    (Mux sends all event types by default — the function ignores irrelevant ones)
 * 2. Copy the signing secret → Netlify env var MUX_WEBHOOK_SECRET
 */

const crypto = require('crypto');
const { queryDocs, updateDoc, addDoc } = require('./shared/firestore');
const { jsonResponse } = require('./shared/utils');

const COLLECTION = 'live-schedule';

// How close (in minutes) a stream start can be to a scheduled session to auto-match
var MATCH_WINDOW_MINUTES = 30;

/**
 * Verify Mux webhook signature.
 * @see https://docs.mux.com/guides/listen-for-webhooks#verify-webhook-signatures
 */
function verifySignature(rawBody, signatureHeader, secret) {
  if (!secret) return true; // Skip verification if no secret configured (dev)
  if (!signatureHeader) return false;

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
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

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

    console.log('[mux-webhook] Event:', type);

    switch (type) {
      case 'video.live_stream.active':
        await handleStreamActive(payload.data);
        break;
      case 'video.live_stream.idle':
        await handleStreamIdle(payload.data);
        break;
      case 'video.asset.ready':
        await handleAssetReady(payload.data);
        break;
      default:
        // Ignore all other events
        break;
    }

    return jsonResponse(200, { ok: true });

  } catch (err) {
    console.error('[mux-webhook] Error:', err);
    return jsonResponse(200, { ok: true, error: err.message });
  }
};

/* ══════════════════════════════════════════════════════════════
   1. STREAM WENT LIVE — match to closest scheduled session
   ══════════════════════════════════════════════════════════════ */
async function handleStreamActive(streamData) {
  if (!streamData || !streamData.id) return;

  var liveStreamId = streamData.id;
  var streamPlaybackId = getPlaybackId(streamData);

  console.log('[mux-webhook] Stream active:', liveStreamId, 'playback:', streamPlaybackId);

  var now = new Date();
  var windowMs = MATCH_WINDOW_MINUTES * 60 * 1000;
  var windowStart = new Date(now.getTime() - windowMs).toISOString();
  var windowEnd = new Date(now.getTime() + windowMs).toISOString();

  // Find scheduled sessions in the time window
  var sessions = await queryDocs(COLLECTION,
    [{ field: 'status', op: '==', value: 'scheduled' }],
    { orderBy: 'startDateTime', orderDir: 'asc' }
  );

  // Filter to sessions within the match window
  var candidates = sessions.filter(function (s) {
    return s.startDateTime && s.startDateTime >= windowStart && s.startDateTime <= windowEnd;
  });

  if (!candidates.length) {
    // Expand window: also check sessions starting up to 2 hours ago (late start / long class)
    var expandedStart = new Date(now.getTime() - 120 * 60 * 1000).toISOString();
    candidates = sessions.filter(function (s) {
      return s.startDateTime && s.startDateTime >= expandedStart && s.startDateTime <= windowEnd;
    });
  }

  if (!candidates.length) {
    console.log('[mux-webhook] No scheduled session found near', now.toISOString(), '— skipping auto-match');
    return;
  }

  // Pick the closest session by time distance
  var closest = null;
  var closestDist = Infinity;
  for (var i = 0; i < candidates.length; i++) {
    var dist = Math.abs(new Date(candidates[i].startDateTime).getTime() - now.getTime());
    if (dist < closestDist) {
      closestDist = dist;
      closest = candidates[i];
    }
  }

  console.log('[mux-webhook] Matched to session:', closest.id,
    '(' + (closest.title_da || closest.title_en) + ')',
    'scheduled at', closest.startDateTime,
    '— distance:', Math.round(closestDist / 60000), 'min');

  // Update the session: mark as live, store Mux IDs for later matching
  var update = {
    status: 'live',
    muxLiveStreamId: liveStreamId,
    liveStartedAt: now.toISOString()
  };

  // Also store the stream's playback ID if the session doesn't already have one
  if (streamPlaybackId && !closest.muxPlaybackId) {
    update.muxPlaybackId = streamPlaybackId;
  }

  await updateDoc(COLLECTION, closest.id, update);
  console.log('[mux-webhook] Session', closest.id, 'is now LIVE');
}

/* ══════════════════════════════════════════════════════════════
   2. STREAM WENT IDLE — mark session as ended
   ══════════════════════════════════════════════════════════════ */
async function handleStreamIdle(streamData) {
  if (!streamData || !streamData.id) return;

  var liveStreamId = streamData.id;
  console.log('[mux-webhook] Stream idle:', liveStreamId);

  // Find the session we previously marked as live with this stream ID
  var sessions = await queryDocs(COLLECTION,
    [{ field: 'status', op: '==', value: 'live' }],
    { orderBy: 'startDateTime', orderDir: 'desc', limit: 10 }
  );

  var matched = null;
  for (var i = 0; i < sessions.length; i++) {
    if (sessions[i].muxLiveStreamId === liveStreamId) {
      matched = sessions[i];
      break;
    }
  }

  // Fallback: if only one session is live, it's almost certainly the right one
  if (!matched && sessions.length === 1) {
    matched = sessions[0];
  }

  if (matched) {
    await updateDoc(COLLECTION, matched.id, {
      status: 'ended',
      liveEndedAt: new Date().toISOString()
    });
    console.log('[mux-webhook] Session', matched.id, 'ended');
  } else {
    console.log('[mux-webhook] No live session found for stream', liveStreamId);
  }
}

/* ══════════════════════════════════════════════════════════════
   3. RECORDING READY — attach recording playback ID to session
   ══════════════════════════════════════════════════════════════ */
async function handleAssetReady(assetData) {
  if (!assetData) return;

  // Only process assets that came from a live stream
  var liveStreamId = assetData.live_stream_id;
  if (!liveStreamId) {
    console.log('[mux-webhook] Asset is not from a live stream, skipping');
    return;
  }

  // Get the recording's playback ID
  var recordingPlaybackId = getPlaybackId(assetData);
  if (!recordingPlaybackId) {
    console.log('[mux-webhook] Asset has no playback IDs, skipping');
    return;
  }

  console.log('[mux-webhook] Recording ready:', recordingPlaybackId, 'from stream:', liveStreamId);

  // Find session by muxLiveStreamId (set during handleStreamActive)
  var sessions = await queryDocs(COLLECTION,
    [{ field: 'status', op: 'in', value: ['live', 'ended'] }],
    { orderBy: 'startDateTime', orderDir: 'desc', limit: 50 }
  );

  var matched = null;

  // Priority 1: exact match on stored muxLiveStreamId
  for (var i = 0; i < sessions.length; i++) {
    if (sessions[i].muxLiveStreamId === liveStreamId) {
      matched = sessions[i];
      break;
    }
  }

  // Priority 2: match on muxStreamKey (manually entered in admin form)
  if (!matched) {
    for (var j = 0; j < sessions.length; j++) {
      if (sessions[j].muxStreamKey === liveStreamId) {
        matched = sessions[j];
        break;
      }
    }
  }

  // Priority 3: most recent ended session without a recording (within last 4 hours)
  if (!matched) {
    var fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    for (var k = 0; k < sessions.length; k++) {
      var s = sessions[k];
      if (s.status === 'ended' && !s.recordingPlaybackId && s.startDateTime >= fourHoursAgo) {
        matched = s;
        break;
      }
    }
  }

  if (matched) {
    console.log('[mux-webhook] Attaching recording to session:', matched.id,
      '(' + (matched.title_da || matched.title_en) + ')');

    await updateDoc(COLLECTION, matched.id, {
      recordingPlaybackId: recordingPlaybackId,
      recordingAssetId: assetData.id,
      status: 'ended'
    });
    console.log('[mux-webhook] Session', matched.id, 'now has recording', recordingPlaybackId);
  } else {
    // No match — store as unmatched recording so admin can assign it later
    console.log('[mux-webhook] No matching session for stream', liveStreamId, '— saving as unmatched');
    await addDoc('live-unmatched-recordings', {
      muxLiveStreamId: liveStreamId,
      recordingPlaybackId: recordingPlaybackId,
      recordingAssetId: assetData.id,
      createdAt: new Date().toISOString()
    });
  }
}

/* ══════════════════════════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════════════════════════ */

/** Extract the public playback ID from a Mux object (stream or asset). */
function getPlaybackId(muxObj) {
  var ids = muxObj.playback_ids || [];
  for (var i = 0; i < ids.length; i++) {
    if (ids[i].policy === 'public') return ids[i].id;
  }
  return ids.length ? ids[0].id : null;
}
