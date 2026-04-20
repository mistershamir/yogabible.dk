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
const { getCollection, getDb, getDoc, updateDoc, addDoc, deleteDoc } = require('./shared/firestore');
const { jsonResponse } = require('./shared/utils');

const COLLECTION = 'live-schedule';
const UNMATCHED_COLLECTION = 'live-unmatched-recordings';

/**
 * Verify Mux webhook signature.
 * @see https://docs.mux.com/guides/listen-for-webhooks#verify-webhook-signatures
 */
function verifySignature(rawBody, signatureHeader, secret) {
  if (!secret) {
    console.error('[mux-webhook] MUX_WEBHOOK_SECRET not configured — all webhooks rejected. Set this env var in Netlify (Mux Dashboard → Settings → Webhooks → copy signing secret).');
    return false;
  }
  if (!signatureHeader) {
    console.error('[mux-webhook] Request has no mux-signature header — rejecting');
    return false;
  }

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

  if (!verifySignature(rawBody, signature, secret)) {
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
      case 'video.asset.track.ready':
        await handleTrackReady(payload.data);
        break;
      case 'robots.job.summarize.completed':
        await handleRobotsSummarize(payload.data);
        break;
      case 'robots.job.generate_chapters.completed':
        await handleRobotsChapters(payload.data);
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

/**
 * Mutate `update` to clear stale state from a prior go-live on the same
 * session doc (recurring class reused across days). Signals of a prior run:
 *   - liveEndedAt is set (previous session ended)
 *   - aiProcessedAt is set (previous AI pipeline completed)
 *   - recordingPlaybackId is set (previous recording attached)
 *
 * Without this, yesterday's aiStatus ('complete', 'error', stuck 'processing')
 * blocks claimAiProcessingSlot when today's recording reconciles — the
 * transaction sees a "busy" status and skips triggering AI for the new asset.
 */
function clearStaleRunState(session, update) {
  var hasPriorRun = !!(session.liveEndedAt || session.aiProcessedAt ||
                       session.recordingPlaybackId);
  if (!hasPriorRun) return;

  if (session.aiStatus) {
    update.aiStatus = null;
    update.aiError = null;
    update.aiProcessedAt = null;
  }
  if (session.liveEndedAt) update.liveEndedAt = null;
  if (session.recordingPlaybackId) update.recordingPlaybackId = null;
  if (session.recordingAssetId) update.recordingAssetId = null;

  console.log('[mux-webhook] Cleared stale prior-run state on session', session.id,
    '(prior aiStatus:', session.aiStatus || 'none',
    ', prior recordingPlaybackId:', session.recordingPlaybackId || 'none', ')');
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
    // Clear stale state from a prior go-live on this same doc. Without this,
    // aiStatus from yesterday ('complete', 'error', or stuck 'processing')
    // blocks claimAiProcessingSlot when today's recording reconciles.
    clearStaleRunState(preMatched, preUpdate);
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

  // Clear stale state from a prior go-live on this same doc.
  clearStaleRunState(closest, update);

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

  // Priority 1: session that owns this stream ID AND doesn't yet have a
  // recording. The stream ID can be shared across multiple sessions when a
  // recurring class reuses the same Firestore doc — picking the one without
  // a recording ensures a fresh recording lands on the right go-live.
  // recentSessions is already sorted newest-first, so we naturally pick
  // today's session over yesterday's when both share the stream ID.
  for (var i = 0; i < recentSessions.length; i++) {
    var si = recentSessions[i];
    if (si.muxLiveStreamId === liveStreamId && !si.recordingPlaybackId) {
      matched = si;
      break;
    }
  }

  // Priority 2: match on muxStreamKey (manually entered in admin form),
  // again preferring sessions without an existing recording.
  if (!matched) {
    for (var j = 0; j < recentSessions.length; j++) {
      var sj = recentSessions[j];
      if (sj.muxStreamKey === liveStreamId && !sj.recordingPlaybackId) {
        matched = sj;
        break;
      }
    }
  }

  // Priority 3: a session from today (live or ended) without a recording.
  // Covers the case where a fresh go-live created a new Mux stream but
  // the session doc hasn't yet had muxLiveStreamId propagated via the
  // live_stream.active webhook — asset.ready arrived first.
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

  // Priority 4: any scheduled session for today without a recording that
  // hasn't been touched yet — final fallback before giving up.
  if (!matched) {
    var now2 = new Date();
    var bounds2 = getDayBounds(now2);
    var allToday = allSessions.filter(function (s) {
      return s.startDateTime &&
             s.startDateTime >= bounds2.start &&
             s.startDateTime <= bounds2.end &&
             !s.recordingPlaybackId;
    });
    if (allToday.length) {
      matched = allToday[0];
      console.log('[mux-webhook] Priority 4 fallback — matched scheduled session',
        matched.id, 'for today without recording');
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

    // NEW FLOW: do NOT trigger Deepgram here. The live stream was created
    // with generated_subtitles enabled, so Mux will auto-generate captions
    // and fire video.asset.track.ready — handleTrackReady picks it up and
    // triggers Claude in transcriptReady mode.
    console.log('[ai-pipeline] Using Mux captions (primary) — waiting for track.ready');
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

    // NEW FLOW: wait for track.ready webhook; don't trigger Deepgram here.
    console.log('[ai-pipeline] Using Mux captions (primary) — reconciled asset', rec.recordingAssetId);

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
 * Atomically claim the AI processing slot for a session.
 * Uses a Firestore transaction to read aiStatus + set it to 'processing'
 * in a single atomic operation, so two concurrent webhook deliveries can't
 * both trigger transcription for the same asset.
 *
 * Returns true if this caller won the race and should proceed to trigger
 * processing; false if another caller is already handling it.
 */
async function claimAiProcessingSlot(sessionId) {
  var BUSY_STATUSES = [
    'processing', 'preparing_audio', 'transcribing',
    'uploading_subtitles', 'generating_summary', 'translating', 'complete'
  ];
  try {
    var db = getDb();
    var ref = db.collection(COLLECTION).doc(sessionId);
    return await db.runTransaction(async function (tx) {
      var snap = await tx.get(ref);
      if (!snap.exists) {
        console.log('[mux-webhook] claimAiProcessingSlot: session', sessionId, 'does not exist');
        return false;
      }
      var current = snap.data().aiStatus;
      if (current && BUSY_STATUSES.indexOf(current) !== -1) {
        console.log('[mux-webhook] claimAiProcessingSlot: session', sessionId,
          'already has aiStatus:', current, '— skipping duplicate AI trigger');
        return false;
      }
      tx.update(ref, {
        aiStatus: 'processing',
        aiError: null,
        updated_at: new Date().toISOString()
      });
      return true;
    });
  } catch (err) {
    console.error('[mux-webhook] claimAiProcessingSlot error:', err.message);
    // Fail safe: if we can't claim the slot, don't trigger — better to miss
    // a transcription than to run it twice.
    return false;
  }
}

/**
 * Fire-and-forget call to ai-process-recording function.
 * Non-blocking — errors are logged but don't affect the webhook response.
 */
function triggerAiProcessing(sessionId, assetId, playbackId, transcriptReady) {
  try {
    var https = require('https');
    var payload = {
      sessionId: sessionId,
      assetId: assetId,
      secret: process.env.AI_INTERNAL_SECRET || ''
    };
    if (playbackId) payload.playbackId = playbackId;
    if (transcriptReady) payload.transcriptReady = true;
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

/* ══════════════════════════════════════════════════════════════
   4. MUX AUTO-CAPTION TRACK READY — primary transcript source
   ══════════════════════════════════════════════════════════════ */

async function handleTrackReady(data) {
  if (!data) return;

  // Only act on Mux-generated caption tracks (text + generated_vod/generated_live)
  var textSource = data.text_source || '';
  var isGenerated = textSource === 'generated_vod' || textSource === 'generated_live';
  if (data.type !== 'text' || !isGenerated) {
    console.log('[mux-webhook] track.ready — not a generated caption (type:', data.type,
      'source:', textSource, ') — skipping');
    return;
  }

  var assetId = data.asset_id || (data.asset && data.asset.id);
  var trackId = data.id;
  var langCode = data.language_code || 'en';

  if (!assetId || !trackId) {
    console.log('[mux-webhook] track.ready missing asset_id or track id');
    return;
  }

  // Find session by recordingAssetId
  var db = getDb();
  var snap = await db.collection(COLLECTION)
    .where('recordingAssetId', '==', assetId)
    .limit(1)
    .get();

  if (snap.empty) {
    console.log('[mux-webhook] track.ready — no session found for asset', assetId);
    return;
  }

  var sessionDoc = snap.docs[0];
  var sessionId = sessionDoc.id;
  var session = sessionDoc.data();
  var playbackId = session.recordingPlaybackId;

  if (!playbackId) {
    console.log('[mux-webhook] track.ready — session', sessionId, 'has no recordingPlaybackId');
    return;
  }

  console.log('[mux-webhook] track.ready — session:', sessionId, 'track:', trackId, 'lang:', langCode);

  // Fetch plain-text transcript from Mux
  var transcriptTxt = '';
  var vtt = '';
  try {
    transcriptTxt = await httpsGetText('https://stream.mux.com/' + playbackId + '/text/' + trackId + '.txt');
  } catch (err) {
    console.error('[mux-webhook] Failed to fetch transcript .txt:', err.message);
  }
  try {
    vtt = await httpsGetText('https://stream.mux.com/' + playbackId + '/text/' + trackId + '.vtt');
  } catch (err) {
    console.error('[mux-webhook] Failed to fetch transcript .vtt:', err.message);
  }

  var update = {
    captionTrackId: trackId,
    captionLang: langCode,
    aiCaptionTrackId: trackId
  };
  if (transcriptTxt) update.aiTranscript = transcriptTxt.substring(0, 50000);
  if (vtt && vtt.length < 900000) update.captionVtt = vtt;

  if (transcriptTxt && transcriptTxt.length >= 50) {
    update.aiStatus = 'transcript_ready';
  }

  await updateDoc(COLLECTION, sessionId, update);
  console.log('[mux-webhook] Saved Mux transcript — session:', sessionId,
    'chars:', transcriptTxt.length, 'vtt chars:', vtt.length);

  // Trigger AI pipeline in transcript-ready mode (skip Deepgram/MP4)
  if (transcriptTxt && transcriptTxt.length >= 50) {
    triggerAiProcessing(sessionId, assetId, null, true);
  }

  // Fire-and-forget Mux Robots bonus jobs (summarize + chapters)
  fireRobotsJobs(assetId, sessionId);
}

/* ══════════════════════════════════════════════════════════════
   5. MUX ROBOTS — summarize + chapters results
   ══════════════════════════════════════════════════════════════ */

async function findSessionByAssetId(assetId) {
  if (!assetId) return null;
  var db = getDb();
  var snap = await db.collection(COLLECTION)
    .where('recordingAssetId', '==', assetId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, data: snap.docs[0].data() };
}

async function handleRobotsSummarize(data) {
  if (!data) return;
  var assetId = (data.parameters && data.parameters.asset_id) ||
                data.asset_id || (data.asset && data.asset.id);
  var result = data.result || data.output || {};
  if (!assetId) return;

  var found = await findSessionByAssetId(assetId);
  if (!found) {
    console.log('[mux-webhook] robots.summarize — no session for asset', assetId);
    return;
  }

  var update = {};
  if (result.title) update.muxTitle = result.title;
  if (result.description) update.muxDescription = result.description;
  if (result.tags) update.muxTags = result.tags;
  if (!Object.keys(update).length) {
    console.log('[mux-webhook] robots.summarize — no title/desc/tags in payload');
    return;
  }
  await updateDoc(COLLECTION, found.id, update);
  console.log('[mux-webhook] Saved Mux summarize → session:', found.id);
}

async function handleRobotsChapters(data) {
  if (!data) return;
  var assetId = (data.parameters && data.parameters.asset_id) ||
                data.asset_id || (data.asset && data.asset.id);
  var result = data.result || data.output || {};
  if (!assetId) return;

  var found = await findSessionByAssetId(assetId);
  if (!found) {
    console.log('[mux-webhook] robots.chapters — no session for asset', assetId);
    return;
  }

  var chapters = result.chapters || data.chapters || null;
  if (!chapters) {
    console.log('[mux-webhook] robots.chapters — no chapters in payload');
    return;
  }
  await updateDoc(COLLECTION, found.id, { muxChapters: chapters });
  console.log('[mux-webhook] Saved Mux chapters → session:', found.id);
}

function fireRobotsJobs(assetId, sessionId) {
  // Fire both summarize + generate-chapters. Results arrive via webhook.
  var jobs = ['summarize', 'generate-chapters'];
  for (var i = 0; i < jobs.length; i++) {
    (function (jobType) {
      muxRobotsRequest('POST', '/robots/v0/jobs/' + jobType, {
        parameters: { asset_id: assetId }
      }).then(function () {
        console.log('[mux-webhook] Robots job queued:', jobType, 'for session:', sessionId);
      }).catch(function (err) {
        if (/403/.test(err.message)) {
          console.warn('[mux-webhook] Robots ' + jobType + ' 403 — token lacks robots:* scope (non-fatal)');
        } else {
          console.log('[mux-webhook] Robots ' + jobType + ' failed (non-fatal):', err.message);
        }
      });
    })(jobs[i]);
  }
}

function muxRobotsRequest(method, path, body) {
  var tokenId = process.env.MUX_TOKEN_ID;
  var tokenSecret = process.env.MUX_TOKEN_SECRET;
  if (!tokenId || !tokenSecret) return Promise.reject(new Error('MUX_TOKEN_ID/SECRET required'));

  return new Promise(function (resolve, reject) {
    var https = require('https');
    var payload = body ? JSON.stringify(body) : '';
    var opts = {
      hostname: 'api.mux.com',
      path: path,
      method: method,
      headers: {
        'Authorization': 'Basic ' + Buffer.from(tokenId + ':' + tokenSecret).toString('base64'),
        'Content-Type': 'application/json'
      }
    };
    if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload);

    var req = https.request(opts, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var raw = Buffer.concat(chunks).toString();
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(raw || '{}')); } catch (e) { resolve({}); }
        } else {
          reject(new Error('Mux Robots ' + res.statusCode + ': ' + raw.substring(0, 200)));
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function httpsGetText(url) {
  return new Promise(function (resolve, reject) {
    var https = require('https');
    var req = https.get(url, function (res) {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        httpsGetText(res.headers.location).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error('HTTP ' + res.statusCode + ' from ' + url));
        return;
      }
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
    });
    req.on('error', reject);
    req.setTimeout(60000, function () { req.destroy(new Error('timeout')); });
  });
}
