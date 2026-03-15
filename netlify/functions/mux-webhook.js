/**
 * Netlify Function: /.netlify/functions/mux-webhook
 * Fully autonomous live stream lifecycle — no manual admin actions needed.
 *
 * Handles 3 Mux events:
 *
 *   1. video.live_stream.active  — Stream went live (teacher pressed On Air)
 *      → Finds the closest scheduled session by time (same-day window)
 *      → Sets status to 'live', stores the Mux live stream ID
 *      → Also checks live-unmatched-recordings for any earlier asset.ready events
 *
 *   2. video.live_stream.idle    — Stream ended (teacher pressed Off)
 *      → Finds the session marked 'live' with matching stream ID
 *      → Sets status to 'ended'
 *
 *   3. video.asset.ready         — Recording asset is ready to play
 *      → Finds the session by stored muxLiveStreamId
 *      → Writes recordingPlaybackId so students can watch the replay
 *      → If no session matched yet, saves as unmatched (reconciled by step 1)
 *
 * Setup:
 * 1. Mux Dashboard → Settings → Webhooks → Add endpoint:
 *    URL: https://www.yogabible.dk/.netlify/functions/mux-webhook
 *    (Mux sends all event types by default — the function ignores irrelevant ones)
 * 2. Copy the signing secret → Netlify env var MUX_WEBHOOK_SECRET
 */

const crypto = require('crypto');
const { getCollection, getDb, updateDoc, addDoc, deleteDoc } = require('./shared/firestore');
const { jsonResponse } = require('./shared/utils');

const COLLECTION = 'live-schedule';
const UNMATCHED_COLLECTION = 'live-unmatched-recordings';

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

/**
 * Fetch all sessions from Firestore — no orderBy to avoid composite index requirement.
 * Sorts in-memory instead.
 */
async function getAllSessions() {
  var db = getDb();
  var snapshot = await db.collection(COLLECTION).get();
  var items = [];
  snapshot.forEach(function (doc) {
    items.push(Object.assign({ id: doc.id }, doc.data()));
  });
  // Sort by startDateTime descending (most recent first)
  items.sort(function (a, b) {
    var ta = a.startDateTime || '';
    var tb = b.startDateTime || '';
    return ta < tb ? 1 : ta > tb ? -1 : 0;
  });
  return items;
}

/**
 * Get the start-of-day and end-of-day for a given Date (UTC).
 */
function getDayBounds(date) {
  var y = date.getUTCFullYear();
  var m = date.getUTCMonth();
  var d = date.getUTCDate();
  return {
    start: new Date(Date.UTC(y, m, d, 0, 0, 0)).toISOString(),
    end: new Date(Date.UTC(y, m, d, 23, 59, 59, 999)).toISOString()
  };
}

/* ══════════════════════════════════════════════════════════════
   1. STREAM WENT LIVE — match to closest scheduled session
   ══════════════════════════════════════════════════════════════ */
async function handleStreamActive(streamData) {
  if (!streamData || !streamData.id) return;

  var liveStreamId = streamData.id;
  var streamPlaybackId = getPlaybackId(streamData);

  console.log('[mux-webhook] Stream active:', liveStreamId, 'playback:', streamPlaybackId);

  var now = new Date();
  var bounds = getDayBounds(now);

  // Fetch ALL sessions (no orderBy → no composite index needed)
  var allSessions = await getAllSessions();

  // Safety: first check if any session already owns this exact stream ID
  // (e.g. created via mux-stream.js create-stream before ATEM started pushing)
  var preMatched = null;
  for (var p = 0; p < allSessions.length; p++) {
    if (allSessions[p].muxLiveStreamId === liveStreamId) {
      preMatched = allSessions[p];
      break;
    }
  }

  if (preMatched) {
    // Session already has this stream ID (set by mux-stream or livekit-token) — just mark live
    console.log('[mux-webhook] Stream', liveStreamId, 'already assigned to session',
      preMatched.id, '— marking live');
    var preUpdate = { status: 'live', liveStartedAt: now.toISOString() };
    if (streamPlaybackId && !preMatched.muxPlaybackId) {
      preUpdate.muxPlaybackId = streamPlaybackId;
    }
    await updateDoc(COLLECTION, preMatched.id, preUpdate);
    await reconcileUnmatchedRecordings(liveStreamId, preMatched.id);
    return;
  }

  // Only match to sessions that are 'scheduled' AND don't already have a recording
  // This prevents a random ATEM stream from hijacking a session that already finished
  var sessions = allSessions.filter(function (s) {
    return s.status === 'scheduled' && !s.recordingPlaybackId && !s.muxLiveStreamId;
  });

  // Match sessions from today (same calendar day UTC), or yesterday if stream started around midnight
  var yesterday = new Date(now.getTime() - 12 * 60 * 60 * 1000);
  var yesterdayBounds = getDayBounds(yesterday);

  var candidates = sessions.filter(function (s) {
    if (!s.startDateTime) return false;
    // Accept sessions from today or yesterday (covers late starts, long classes, midnight edge)
    return (s.startDateTime >= bounds.start && s.startDateTime <= bounds.end) ||
           (s.startDateTime >= yesterdayBounds.start && s.startDateTime <= yesterdayBounds.end);
  });

  if (!candidates.length) {
    console.log('[mux-webhook] No scheduled session found for today/yesterday near',
      now.toISOString(), '— skipping auto-match. Total scheduled:', sessions.length);
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

  // Reconcile: check for unmatched recordings from this same stream
  // (asset.ready can fire BEFORE live_stream.active due to Mux event ordering)
  await reconcileUnmatchedRecordings(liveStreamId, closest.id);
}

/* ══════════════════════════════════════════════════════════════
   2. STREAM WENT IDLE — mark session as ended
   ══════════════════════════════════════════════════════════════ */
// Streams shorter than this are treated as test runs — session resets to 'scheduled'
// Keep low (30s) to only catch accidental pushes — real sessions with ATEM hiccups
// are protected by the 5-min reconnect_window on the Mux stream itself
var TEST_STREAM_THRESHOLD_MS = 30 * 1000; // 30 seconds

async function handleStreamIdle(streamData) {
  if (!streamData || !streamData.id) return;

  var liveStreamId = streamData.id;
  console.log('[mux-webhook] Stream idle:', liveStreamId);

  // Fetch ALL sessions (no orderBy → no composite index needed)
  var allSessions = await getAllSessions();
  var liveSessions = allSessions.filter(function (s) { return s.status === 'live'; });

  var matched = null;

  // Priority 1: exact match on stored muxLiveStreamId
  for (var i = 0; i < liveSessions.length; i++) {
    if (liveSessions[i].muxLiveStreamId === liveStreamId) {
      matched = liveSessions[i];
      break;
    }
  }

  // Priority 2: if only one session is live AND its muxLiveStreamId is empty
  // (i.e. it was set live manually, not via webhook), cautiously match it.
  // But NEVER match if the session already has a different stream ID — that means
  // this idle event is from an orphan stream unrelated to the session.
  if (!matched && liveSessions.length === 1) {
    var candidate = liveSessions[0];
    if (!candidate.muxLiveStreamId) {
      matched = candidate;
      console.log('[mux-webhook] Fallback: matched to only live session (no stream ID):', matched.id);
    } else {
      console.log('[mux-webhook] Only live session', candidate.id, 'has stream ID',
        candidate.muxLiveStreamId, 'which does not match idle stream', liveStreamId, '— skipping');
    }
  }

  if (matched) {
    var now2 = new Date();

    // Check how long the stream was actually live
    var liveStarted = matched.liveStartedAt ? new Date(matched.liveStartedAt) : null;
    var liveDurationMs = liveStarted ? (now2.getTime() - liveStarted.getTime()) : Infinity;

    if (liveDurationMs < TEST_STREAM_THRESHOLD_MS) {
      // Short stream = test run — reset back to scheduled so it stays on the schedule
      await updateDoc(COLLECTION, matched.id, {
        status: 'scheduled',
        muxLiveStreamId: null,
        liveStartedAt: null
      });
      console.log('[mux-webhook] Session', matched.id, 'was live for only',
        Math.round(liveDurationMs / 1000), 'seconds — treating as test, reset to scheduled');
    } else {
      // Real session — mark as ended
      await updateDoc(COLLECTION, matched.id, {
        status: 'ended',
        liveEndedAt: now2.toISOString()
      });
      console.log('[mux-webhook] Session', matched.id, 'ended after',
        Math.round(liveDurationMs / 60000), 'minutes');
    }
  } else {
    console.log('[mux-webhook] No live session found for stream', liveStreamId,
      '— total live sessions:', liveSessions.length);
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

  // Fetch ALL sessions (no orderBy → no composite index needed)
  var allSessions = await getAllSessions();
  var recentSessions = allSessions.filter(function (s) {
    return s.status === 'live' || s.status === 'ended';
  }).slice(0, 50);

  var matched = null;

  // Priority 1: exact match on stored muxLiveStreamId
  for (var i = 0; i < recentSessions.length; i++) {
    if (recentSessions[i].muxLiveStreamId === liveStreamId) {
      matched = recentSessions[i];
      break;
    }
  }

  // Priority 2: match on muxStreamKey (manually entered in admin form)
  if (!matched) {
    for (var j = 0; j < recentSessions.length; j++) {
      if (recentSessions[j].muxStreamKey === liveStreamId) {
        matched = recentSessions[j];
        break;
      }
    }
  }

  // Priority 3: most recent ended/live session without a recording (same day)
  if (!matched) {
    var now = new Date();
    var bounds = getDayBounds(now);
    for (var k = 0; k < recentSessions.length; k++) {
      var s = recentSessions[k];
      if (!s.recordingPlaybackId && s.startDateTime &&
          s.startDateTime >= bounds.start && s.startDateTime <= bounds.end) {
        matched = s;
        break;
      }
    }
  }

  if (matched) {
    // Safety: never overwrite an existing recording — save as unmatched instead
    if (matched.recordingPlaybackId && matched.recordingPlaybackId !== recordingPlaybackId) {
      console.log('[mux-webhook] Session', matched.id, 'already has recording',
        matched.recordingPlaybackId, '— refusing to overwrite with', recordingPlaybackId,
        '. Saving as unmatched.');
      await addDoc(UNMATCHED_COLLECTION, {
        muxLiveStreamId: liveStreamId,
        recordingPlaybackId: recordingPlaybackId,
        recordingAssetId: assetData.id,
        reason: 'session_already_has_recording',
        matchedSessionId: matched.id,
        createdAt: new Date().toISOString()
      });
      return;
    }

    console.log('[mux-webhook] Attaching recording to session:', matched.id,
      '(' + (matched.title_da || matched.title_en) + ')');

    await updateDoc(COLLECTION, matched.id, {
      recordingPlaybackId: recordingPlaybackId,
      recordingAssetId: assetData.id,
      status: 'ended'
    });
    console.log('[mux-webhook] Session', matched.id, 'now has recording', recordingPlaybackId);

    // Trigger AI processing (transcription + summary + quiz)
    triggerAiProcessing(matched.id, assetData.id);
  } else {
    // No match — store as unmatched recording so it gets reconciled
    // when handleStreamActive runs (events can arrive out of order)
    console.log('[mux-webhook] No matching session for stream', liveStreamId,
      '— saving as unmatched for later reconciliation');
    await addDoc(UNMATCHED_COLLECTION, {
      muxLiveStreamId: liveStreamId,
      recordingPlaybackId: recordingPlaybackId,
      recordingAssetId: assetData.id,
      createdAt: new Date().toISOString()
    });
  }
}

/* ══════════════════════════════════════════════════════════════
   RECONCILE — attach unmatched recordings when session is matched
   ══════════════════════════════════════════════════════════════ */

/**
 * When handleStreamActive matches a session, check if there are
 * unmatched recordings from the same stream (asset.ready fired before
 * live_stream.active due to Mux event ordering).
 */
async function reconcileUnmatchedRecordings(liveStreamId, sessionId) {
  try {
    var db = getDb();
    var snapshot = await db.collection(UNMATCHED_COLLECTION).get();
    var unmatched = [];
    snapshot.forEach(function (doc) {
      unmatched.push(Object.assign({ id: doc.id }, doc.data()));
    });

    var matches = unmatched.filter(function (r) {
      return r.muxLiveStreamId === liveStreamId;
    });

    if (!matches.length) return;

    // Take the first (most recent) recording
    var rec = matches[0];
    console.log('[mux-webhook] Reconciling unmatched recording:', rec.recordingPlaybackId,
      'from stream:', liveStreamId, '→ session:', sessionId);

    // Attach recording to the session
    await updateDoc(COLLECTION, sessionId, {
      recordingPlaybackId: rec.recordingPlaybackId,
      recordingAssetId: rec.recordingAssetId || null
    });

    // Trigger AI processing for reconciled recording
    if (rec.recordingAssetId) {
      triggerAiProcessing(sessionId, rec.recordingAssetId);
    }

    // Delete all matched unmatched records
    for (var i = 0; i < matches.length; i++) {
      await deleteDoc(UNMATCHED_COLLECTION, matches[i].id);
    }

    console.log('[mux-webhook] Reconciled', matches.length, 'unmatched recording(s) for stream', liveStreamId);
  } catch (err) {
    // Non-fatal — session is already matched, recording just didn't get attached
    console.error('[mux-webhook] Reconciliation error (non-fatal):', err.message);
  }
}

/* ══════════════════════════════════════════════════════════════
   AI PROCESSING — trigger transcription + summary + quiz
   ══════════════════════════════════════════════════════════════ */

/**
 * Fire-and-forget call to ai-process-recording function.
 * Non-blocking — errors are logged but don't affect the webhook response.
 */
function triggerAiProcessing(sessionId, assetId, playbackId) {
  try {
    var https = require('https');
    var payload = {
      sessionId: sessionId,
      assetId: assetId,
      secret: process.env.AI_INTERNAL_SECRET || ''
    };
    if (playbackId) payload.playbackId = playbackId;
    var body = JSON.stringify(payload);

    var opts = {
      hostname: 'yogabible.dk',
      path: '/.netlify/functions/ai-process-recording-background',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 5000 // 5s timeout — we don't wait for it to finish
    };

    var req = https.request(opts, function (res) {
      console.log('[mux-webhook] AI processing triggered, status:', res.statusCode);
      res.resume(); // drain the response
    });
    req.on('error', function (err) {
      console.log('[mux-webhook] AI trigger fire-and-forget error (non-fatal):', err.message);
    });
    req.on('timeout', function () {
      console.log('[mux-webhook] AI trigger timed out (expected — function runs async)');
      req.destroy();
    });
    req.write(body);
    req.end();
  } catch (err) {
    console.log('[mux-webhook] AI trigger error (non-fatal):', err.message);
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
