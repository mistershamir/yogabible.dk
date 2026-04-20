/**
 * Netlify Function: /.netlify/functions/livekit-token
 * LiveKit token generation + room management for live streaming.
 *
 * Actions:
 *   POST ?action=create-room     — Create a LiveKit room + return publisher token (teacher only)
 *   GET  ?action=viewer-token    — Get a subscriber token for viewing a live room (any auth)
 *   POST ?action=close-room      — Close a LiveKit room (teacher only)
 *   GET  ?action=room-status     — Check if a room is active
 *
 * Environment variables required:
 *   LIVEKIT_API_KEY      — LiveKit Cloud API key
 *   LIVEKIT_API_SECRET   — LiveKit Cloud API secret
 *   LIVEKIT_URL          — LiveKit Cloud WebSocket URL (e.g., wss://yoga-bible-xxxx.livekit.cloud)
 */

const crypto = require('crypto');
const { requireAuth, optionalAuth } = require('./shared/auth');
const { getDoc, updateDoc } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const COLLECTION = 'live-schedule';
const MUX_API_BASE = 'https://api.mux.com';

/**
 * Make authenticated request to Mux API (for recording setup).
 */
async function muxFetch(path, method, body) {
  var tokenId = process.env.MUX_TOKEN_ID;
  var tokenSecret = process.env.MUX_TOKEN_SECRET;
  if (!tokenId || !tokenSecret) throw new Error('MUX_TOKEN_ID/SECRET not set');

  var auth = Buffer.from(tokenId + ':' + tokenSecret).toString('base64');
  var opts = {
    method: method || 'GET',
    headers: { 'Authorization': 'Basic ' + auth, 'Content-Type': 'application/json' }
  };
  if (body) opts.body = JSON.stringify(body);

  var res = await fetch(MUX_API_BASE + path, opts);
  var data = await res.json();
  if (!res.ok) {
    var errMsg = data.error ? (data.error.message || JSON.stringify(data.error)) : 'Mux API error';
    throw new Error(errMsg);
  }
  return data;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  var params = event.queryStringParameters || {};
  var action = params.action || '';

  try {
    switch (action) {
      case 'create-room':
        return handleCreateRoom(event);
      case 'test-room':
        return handleTestRoom(event);
      case 'viewer-token':
        return handleViewerToken(event, params);
      case 'close-room':
        return handleCloseRoom(event);
      case 'room-status':
        return handleRoomStatus(params);
      case 'stop-all-egresses':
        return handleStopAllEgresses(event);
      case 'start-egress':
        return handleStartEgress(event);
      default:
        return jsonResponse(400, { ok: false, error: 'Unknown action: ' + action });
    }
  } catch (err) {
    console.error('[livekit-token]', err);
    return jsonResponse(err.status || 500, { ok: false, error: err.message });
  }
};

// ═══════════════════════════════════════════════════════
// JWT creation for LiveKit (HS256)
// ═══════════════════════════════════════════════════════

function base64url(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Create a LiveKit access token (JWT signed with HS256).
 * @param {Object} opts
 * @param {string} opts.identity - Participant identity
 * @param {string} opts.name - Participant display name
 * @param {string} opts.room - Room name
 * @param {boolean} opts.canPublish - Can publish tracks
 * @param {boolean} opts.canSubscribe - Can subscribe to tracks
 * @param {boolean} opts.roomCreate - Can create rooms
 * @param {boolean} opts.roomAdmin - Room admin privileges
 * @param {number} opts.ttl - Token TTL in seconds (default 6h)
 */
function createToken(opts) {
  var apiKey = process.env.LIVEKIT_API_KEY;
  var apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error('LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set');
  }

  var now = Math.floor(Date.now() / 1000);
  var ttl = opts.ttl || 21600; // 6 hours default

  var header = { alg: 'HS256', typ: 'JWT' };

  var payload = {
    iss: apiKey,
    sub: opts.identity,
    iat: now,
    nbf: now,
    exp: now + ttl,
    jti: opts.identity + '-' + now,
    video: {
      room: opts.room,
      roomJoin: true,
      canPublish: !!opts.canPublish,
      canSubscribe: !!opts.canSubscribe,
      canPublishData: true
    },
    metadata: JSON.stringify({
      name: opts.name || opts.identity,
      role: opts.role || 'viewer'
    }),
    name: opts.name || opts.identity
  };

  if (opts.roomCreate) {
    payload.video.roomCreate = true;
  }
  if (opts.roomAdmin) {
    payload.video.roomAdmin = true;
  }
  if (opts.roomRecord) {
    payload.video.roomRecord = true;
  }

  var segments = base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(payload));
  var signature = crypto.createHmac('sha256', apiSecret).update(segments).digest();
  var sig64 = signature.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  return segments + '.' + sig64;
}

// ═══════════════════════════════════════════════════════
// LiveKit Server API calls
// ═══════════════════════════════════════════════════════

/**
 * Call LiveKit Server API using Twirp protocol.
 * LiveKit uses Twirp RPC over HTTP POST with JSON bodies.
 */
async function livekitApi(method, body, service) {
  var url = process.env.LIVEKIT_URL;
  if (!url) throw new Error('LIVEKIT_URL must be set');

  // Convert wss:// to https:// for API calls
  var httpUrl = url.replace('wss://', 'https://').replace('ws://', 'http://');

  // Create a short-lived admin token for server-to-server calls
  var adminToken = createToken({
    identity: 'server',
    room: '',
    canPublish: false,
    canSubscribe: false,
    roomCreate: true,
    roomAdmin: true,
    roomRecord: true,
    ttl: 60
  });

  var svc = service || 'livekit.RoomService';
  var apiUrl = httpUrl + '/twirp/' + svc + '/' + method;
  var res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + adminToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body || {})
  });

  var text = await res.text();
  var data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('LiveKit API error (' + res.status + '): non-JSON response — ' + text.substring(0, 200));
  }
  if (!res.ok) {
    var errMsg = data.msg || data.message || JSON.stringify(data);
    throw new Error('LiveKit API error (' + res.status + '): ' + errMsg);
  }

  return data;
}

// ═══════════════════════════════════════════════════════
// Create room + publisher token (teacher only)
// ═══════════════════════════════════════════════════════
async function handleCreateRoom(event) {
  var user = await requireAuth(event, ['teacher', 'admin']);
  if (user.error) return user.error;

  var body = JSON.parse(event.body || '{}');
  var sessionId = body.sessionId;

  if (!sessionId) {
    return jsonResponse(400, { ok: false, error: 'sessionId is required' });
  }

  var session = await getDoc(COLLECTION, sessionId);
  if (!session) {
    return jsonResponse(404, { ok: false, error: 'Session not found' });
  }
  if (session.status !== 'scheduled' && session.status !== 'live') {
    return jsonResponse(400, { ok: false, error: 'Session is not in scheduled state (current: ' + session.status + ')' });
  }

  // Room name derived from session ID for consistency
  var roomName = 'yb-live-' + sessionId;

  // Auto-close any previous room for this session (prevents zombie rooms).
  // Every step is awaited sequentially so the cleanup is fully complete
  // before we create a new room + egress. Without this, LiveKit may still
  // be propagating the delete when the new room is created, and the new
  // egress can race against the stale teardown.
  if (session.livekitRoom && session.livekitRoom !== roomName) {
    try {
      var oldEgresses = await livekitApi('ListEgress', { room_name: session.livekitRoom }, 'livekit.Egress');
      var oldItems = oldEgresses.items || oldEgresses.egresses || [];
      for (var oe = 0; oe < oldItems.length; oe++) {
        var oeid = oldItems[oe].egress_id || oldItems[oe].egressId;
        if (!oeid) continue;
        try {
          await livekitApi('StopEgress', { egress_id: oeid }, 'livekit.Egress');
          console.log('[livekit-token] Stopped old egress:', oeid);
        } catch (stopErr) {
          // Log but continue — egress may already be stopping. We still
          // need to await the rest of the cleanup sequence.
          console.warn('[livekit-token] Failed to stop old egress', oeid, ':', stopErr.message);
        }
      }
      await livekitApi('DeleteRoom', { room: session.livekitRoom });
      // Brief settle delay so LiveKit propagates the deletion before we
      // create the new room. Prevents a race where the fresh egress
      // attaches to a room that's about to disappear.
      await new Promise(function (r) { setTimeout(r, 500); });
      console.log('[livekit-token] Auto-closed previous room:', session.livekitRoom);
    } catch (cleanupErr) {
      console.warn('[livekit-token] Previous room cleanup error (continuing):', cleanupErr.message);
    }
  }

  // Create the room via LiveKit API
  try {
    await livekitApi('CreateRoom', {
      name: roomName,
      empty_timeout: 300,         // Close room 5 min after last participant leaves
      max_participants: 100,      // 1 teacher + viewers
      metadata: JSON.stringify({
        sessionId: sessionId,
        title: session.title_da || session.title_en || '',
        instructor: session.instructor || '',
        streamType: session.streamType || (session.interactive ? 'interactive' : 'broadcast')
      })
    });
    console.log('[livekit-token] Created room:', roomName);
  } catch (err) {
    // Room may already exist — that's fine
    if (err.message && err.message.indexOf('already exists') !== -1) {
      console.log('[livekit-token] Room already exists:', roomName);
    } else {
      throw err;
    }
  }

  // Generate publisher token for the teacher
  var token = createToken({
    identity: 'teacher-' + user.uid,
    name: session.instructor || user.email.split('@')[0],
    role: 'teacher',
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    roomCreate: true,
    roomAdmin: true,
    ttl: 21600
  });

  // ── Set up Mux recording via Room Composite Egress ──
  // Detect fresh go-live vs. rejoin of an in-progress session.
  //
  // A "rejoin" is a teacher re-entering the SAME live session (e.g. ATEM
  // hiccup, browser refresh) — we want to reuse the existing Mux stream
  // and egress so the recording stays continuous.
  //
  // A "fresh go-live" is a new session on a different day, even if the
  // Firestore doc is reused (recurring class). In that case we MUST create
  // a new Mux live stream — reusing yesterday's stream ID causes the
  // asset.ready webhook to attach today's recording to yesterday's session.
  //
  // Signals that this is a fresh go-live, not a rejoin:
  //   - session already has a recordingPlaybackId (yesterday was recorded)
  //   - session already has liveEndedAt (yesterday ended)
  //   - liveStartedAt is older than the Mux max_continuous_duration (6h)
  var hasPriorRecording = !!(session.recordingPlaybackId || session.liveEndedAt);
  var liveStartedRecently = false;
  if (session.liveStartedAt) {
    var startedMs = new Date(session.liveStartedAt).getTime();
    liveStartedRecently = (Date.now() - startedMs) < 7 * 60 * 60 * 1000; // 7h
  }
  var isRejoin = session.status === 'live' &&
                 session.muxLiveStreamId &&
                 liveStartedRecently &&
                 !hasPriorRecording;
  var muxStreamId = isRejoin ? session.muxLiveStreamId : null;
  var muxPlaybackId = isRejoin ? session.muxPlaybackId : null;

  if (!isRejoin) {
    // Check for active egresses on this room first — prevent duplicates
    var hasActiveEgress = false;
    try {
      var existingEgresses = await livekitApi('ListEgress', { room_name: roomName }, 'livekit.Egress');
      var egressItems = existingEgresses.items || existingEgresses.egresses || [];
      for (var ei = 0; ei < egressItems.length; ei++) {
        var st = egressItems[ei].status;
        if (st === 'EGRESS_STARTING' || st === 'EGRESS_ACTIVE' || st === 0 || st === 1) {
          hasActiveEgress = true;
          console.log('[livekit-token] Active egress already exists:', egressItems[ei].egress_id, 'status:', st);
          break;
        }
      }
    } catch (checkErr) {
      // Fail safe: if we can't verify whether an egress already exists,
      // assume one does. Better to miss a recording than to create a
      // duplicate that costs money and corrupts the Firestore doc.
      console.error('[livekit-token] ListEgress failed, skipping new egress creation to prevent duplicates:', checkErr.message);
      hasActiveEgress = true;
    }

    if (hasActiveEgress) {
      console.log('[livekit-token] Skipping egress creation — active egress exists for room:', roomName);
    } else {
      try {
        var muxResult = await muxFetch('/video/v1/live-streams', 'POST', {
          playback_policy: ['public'],
          new_asset_settings: {
            playback_policy: ['public'],
            generated_subtitles: [{ language_code: 'en', name: 'English (auto)' }]
          },
          latency_mode: 'low',
          reconnect_window: 60,
          max_continuous_duration: 21600
        });
        var muxStream = muxResult.data;
        muxStreamId = muxStream.id;
        muxPlaybackId = muxStream.playback_ids && muxStream.playback_ids[0]
          ? muxStream.playback_ids[0].id : null;

        // Start LiveKit Room Composite Egress → RTMP to Mux
        var rtmpUrl = 'rtmps://global-live.mux.com:443/app/' + muxStream.stream_key;
        await livekitApi('StartRoomCompositeEgress', {
          room_name: roomName,
          layout: 'grid',
          audio_only: false,
          video_only: false,
          stream_outputs: [{
            urls: [rtmpUrl],
            protocol: 0
          }]
        }, 'livekit.Egress');

        console.log('[livekit-token] Recording egress started → Mux stream:', muxStreamId);
      } catch (egressErr) {
        // Recording failure should not block the session
        console.error('[livekit-token] Recording setup failed (non-blocking):', egressErr.message);
      }
    }
  } else {
    console.log('[livekit-token] Rejoin — reusing existing Mux stream:', muxStreamId);
  }

  // Update session with LiveKit room info + Mux recording info
  // Also set status to 'live' and liveStartedAt here (not just in set-live)
  // to avoid timer discrepancy between teacher and viewer
  var sessionUpdate = {
    livekitRoom: roomName,
    streamSource: 'remote',
    status: 'live',
    updated_by: user.email
  };
  // Only set liveStartedAt on first go-live, not on rejoin
  if (!isRejoin) sessionUpdate.liveStartedAt = new Date().toISOString();
  if (muxStreamId) sessionUpdate.muxLiveStreamId = muxStreamId;
  if (muxPlaybackId) sessionUpdate.muxPlaybackId = muxPlaybackId;

  // Fresh go-live on a session that previously ran (recurring class reused
  // across days): clear stale recording + AI state so today's recording can
  // attach cleanly and trigger fresh AI processing.
  if (!isRejoin && hasPriorRecording) {
    sessionUpdate.recordingPlaybackId = null;
    sessionUpdate.recordingAssetId = null;
    sessionUpdate.liveEndedAt = null;
    sessionUpdate.aiStatus = null;
    sessionUpdate.aiError = null;
    sessionUpdate.aiProcessedAt = null;
    console.log('[livekit-token] Fresh go-live on reused session', sessionId,
      '— cleared stale recording/AI fields from prior run');
  }

  await updateDoc(COLLECTION, sessionId, sessionUpdate);

  var wsUrl = process.env.LIVEKIT_URL || '';

  console.log('[livekit-token] Publisher token issued for', user.email, 'room:', roomName);

  return jsonResponse(200, {
    ok: true,
    token: token,
    wsUrl: wsUrl,
    roomName: roomName,
    sessionId: sessionId
  });
}

// ═══════════════════════════════════════════════════════
// Test room — quick LiveKit test, no Firestore/Mux (teacher/admin only)
// ═══════════════════════════════════════════════════════
async function handleTestRoom(event) {
  var user = await requireAuth(event, ['teacher', 'admin']);
  if (user.error) return user.error;

  var roomName = 'yb-test-' + user.uid.substring(0, 8) + '-' + Date.now();

  try {
    await livekitApi('CreateRoom', {
      name: roomName,
      empty_timeout: 120,
      max_participants: 10,
      metadata: JSON.stringify({ test: true, teacher: user.email })
    });
  } catch (err) {
    if (!err.message || err.message.indexOf('already exists') === -1) {
      throw err;
    }
  }

  var token = createToken({
    identity: 'teacher-' + user.uid,
    name: user.email.split('@')[0],
    role: 'teacher',
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    roomCreate: true,
    roomAdmin: true,
    ttl: 3600
  });

  var wsUrl = process.env.LIVEKIT_URL || '';
  console.log('[livekit-token] Test room created:', roomName, 'by:', user.email);

  return jsonResponse(200, {
    ok: true,
    token: token,
    wsUrl: wsUrl,
    roomName: roomName,
    test: true
  });
}

// ═══════════════════════════════════════════════════════
// Viewer token (any authenticated user or public)
// ═══════════════════════════════════════════════════════
async function handleViewerToken(event, params) {
  var roomName = params.room;
  if (!roomName) {
    return jsonResponse(400, { ok: false, error: 'room parameter is required' });
  }

  // Check session type — extract sessionId from room name (yb-live-{sessionId})
  var isInteractive = false;
  var streamType = 'broadcast';
  var coTeachers = [];
  var sessionId = roomName.replace('yb-live-', '');
  if (sessionId && sessionId !== roomName) {
    try {
      var session = await getDoc(COLLECTION, sessionId);
      if (session) {
        streamType = session.streamType || (session.interactive ? 'interactive' : 'broadcast');
        isInteractive = streamType === 'interactive' || streamType === 'panel';
        coTeachers = session.coTeachers || [];
      }
    } catch (err) {
      console.log('[livekit-token] Could not check session:', err.message);
    }
  }

  // Optional auth — viewers can be anonymous (but interactive/panel requires auth)
  var user = await optionalAuth(event);

  if (isInteractive && !user) {
    return jsonResponse(401, { ok: false, error: 'Authentication required for interactive sessions' });
  }

  // Determine viewer's role and publish rights
  var viewerRole = 'viewer';
  var canPublish = false;
  if (user && streamType === 'panel' && coTeachers.indexOf(user.email) !== -1) {
    // Co-teacher in a panel session → gets teacher role + publish rights
    viewerRole = 'teacher';
    canPublish = true;
  } else if (user && streamType === 'interactive') {
    viewerRole = 'participant';
    canPublish = true;
  }

  var identity = user
    ? (viewerRole === 'teacher' ? 'teacher-' : viewerRole === 'participant' ? 'participant-' : 'viewer-') + user.uid
    : 'anon-' + Math.random().toString(36).substring(2, 10);
  var displayName = user
    ? (user.email || '').split('@')[0]
    : 'Viewer';

  // Look up user's Firestore profile for a better display name
  if (user) {
    try {
      var userDoc = await getDoc('users', user.uid);
      if (userDoc && (userDoc.firstName || userDoc.displayName)) {
        displayName = userDoc.firstName || userDoc.displayName.split(' ')[0];
      }
    } catch (e) {}
  }

  var token = createToken({
    identity: identity,
    name: displayName,
    role: viewerRole,
    room: roomName,
    canPublish: canPublish,
    canSubscribe: true,
    roomCreate: viewerRole === 'teacher',
    roomAdmin: viewerRole === 'teacher',
    ttl: 21600
  });

  var wsUrl = process.env.LIVEKIT_URL || '';

  return jsonResponse(200, {
    ok: true,
    token: token,
    wsUrl: wsUrl,
    roomName: roomName,
    interactive: isInteractive,
    streamType: streamType,
    role: viewerRole
  });
}

// ═══════════════════════════════════════════════════════
// Close room (teacher only)
// ═══════════════════════════════════════════════════════
async function handleCloseRoom(event) {
  var user = await requireAuth(event, ['teacher', 'admin']);
  if (user.error) return user.error;

  var body = JSON.parse(event.body || '{}');
  var roomName = body.roomName;
  var sessionId = body.sessionId;

  if (!roomName) {
    return jsonResponse(400, { ok: false, error: 'roomName is required' });
  }

  // Stop any active egresses for this room before deleting it
  try {
    var egressList = await livekitApi('ListEgress', { room_name: roomName }, 'livekit.Egress');
    var egresses = egressList.items || egressList.egresses || [];
    for (var e = 0; e < egresses.length; e++) {
      var eid = egresses[e].egress_id || egresses[e].egressId;
      if (!eid) continue;
      try {
        await livekitApi('StopEgress', { egress_id: eid }, 'livekit.Egress');
        console.log('[livekit-token] Egress stopped:', eid);
      } catch (stopErr) {
        console.log('[livekit-token] Egress stop failed:', eid, stopErr.message);
      }
    }
  } catch (listErr) {
    console.log('[livekit-token] ListEgress failed (room may not exist):', listErr.message);
  }

  try {
    await livekitApi('DeleteRoom', { room: roomName });
    console.log('[livekit-token] Room deleted:', roomName, 'by:', user.email);
  } catch (err) {
    console.log('[livekit-token] Room delete failed (may not exist):', err.message);
  }

  // Update session status + stop Mux stream
  if (sessionId) {
    var session = await getDoc(COLLECTION, sessionId);

    // Stop Mux live stream if one was created (prevents orphan recording after room deletion)
    if (session && session.muxLiveStreamId) {
      try {
        await muxFetch('/video/v1/live-streams/' + session.muxLiveStreamId + '/complete', 'PUT');
        console.log('[livekit-token] Mux stream completed:', session.muxLiveStreamId);
      } catch (muxErr) {
        console.log('[livekit-token] Mux stream complete failed (may already be idle):', muxErr.message);
      }
      try {
        await muxFetch('/video/v1/live-streams/' + session.muxLiveStreamId + '/disable', 'PUT');
        console.log('[livekit-token] Mux stream disabled:', session.muxLiveStreamId);
      } catch (muxErr2) {
        console.log('[livekit-token] Mux stream disable failed:', muxErr2.message);
      }
    }

    if (session && session.status === 'live') {
      var liveStarted = session.liveStartedAt ? new Date(session.liveStartedAt) : null;
      var durationMs = liveStarted ? (Date.now() - liveStarted.getTime()) : Infinity;
      var TEST_THRESHOLD = 5 * 60 * 1000; // 5 minutes

      if (durationMs < TEST_THRESHOLD) {
        await updateDoc(COLLECTION, sessionId, {
          status: 'scheduled',
          livekitRoom: null,
          liveStartedAt: null
        });
        console.log('[livekit-token] Short stream (' + Math.round(durationMs / 1000) + 's) — reset to scheduled');
      } else {
        await updateDoc(COLLECTION, sessionId, {
          status: 'ended',
          liveEndedAt: new Date().toISOString()
        });
        console.log('[livekit-token] Session', sessionId, 'ended after', Math.round(durationMs / 60000), 'min');
      }
    }
  }

  return jsonResponse(200, { ok: true });
}

// ═══════════════════════════════════════════════════════
// Start egress for an active room (admin only)
// Stops orphaned egresses first, then starts a new one
// ═══════════════════════════════════════════════════════
async function handleStartEgress(event) {
  var user = await requireAuth(event, ['admin']);
  if (user.error) return user.error;

  var body = JSON.parse(event.body || '{}');
  var sessionId = body.sessionId;
  if (!sessionId) return jsonResponse(400, { ok: false, error: 'sessionId is required' });

  var session = await getDoc(COLLECTION, sessionId);
  if (!session) return jsonResponse(404, { ok: false, error: 'Session not found' });
  if (!session.livekitRoom) return jsonResponse(400, { ok: false, error: 'Session has no active LiveKit room' });

  var roomName = session.livekitRoom;

  // Step 1: Check for active egresses on this room — prevent duplicates
  try {
    var egressList = await livekitApi('ListEgress', { room_name: roomName }, 'livekit.Egress');
    var egresses = egressList.items || egressList.egresses || [];
    for (var i = 0; i < egresses.length; i++) {
      var st = egresses[i].status;
      if (st === 'EGRESS_STARTING' || st === 'EGRESS_ACTIVE' || st === 0 || st === 1) {
        return jsonResponse(200, {
          ok: true,
          roomName: roomName,
          muxStreamId: session.muxLiveStreamId,
          message: 'Egress already active — skipped duplicate',
          existingEgressId: egresses[i].egress_id
        });
      }
    }
    // Stop any completed/failed egresses (cleanup)
    for (var j = 0; j < egresses.length; j++) {
      var eid = egresses[j].egress_id || egresses[j].egressId;
      if (!eid) continue;
      try {
        await livekitApi('StopEgress', { egress_id: eid }, 'livekit.Egress');
      } catch (stopErr) { /* already complete/stopped */ }
    }
  } catch (listErr) {
    console.log('[livekit-token] ListEgress failed:', listErr.message);
  }

  // Step 2: Get or create Mux live stream
  var muxStreamId = session.muxLiveStreamId;
  var streamKey = null;

  if (muxStreamId) {
    // Fetch existing stream key from Mux
    try {
      var muxData = await muxFetch('/video/v1/live-streams/' + muxStreamId, 'GET');
      streamKey = muxData.data.stream_key;
      // Re-enable the stream if it was disabled
      if (muxData.data.status === 'disabled') {
        await muxFetch('/video/v1/live-streams/' + muxStreamId + '/enable', 'PUT');
      }
    } catch (muxErr) {
      console.log('[livekit-token] Could not fetch existing Mux stream, creating new one:', muxErr.message);
      muxStreamId = null;
    }
  }

  if (!muxStreamId) {
    // Create a new Mux live stream
    var muxResult = await muxFetch('/video/v1/live-streams', 'POST', {
      playback_policy: ['public'],
      new_asset_settings: {
        playback_policy: ['public'],
        master_access: 'temporary',
        generated_subtitles: [{ language_code: 'en', name: 'English (auto)' }]
      },
      latency_mode: 'low',
      reconnect_window: 60,
      max_continuous_duration: 21600
    });
    muxStreamId = muxResult.data.id;
    streamKey = muxResult.data.stream_key;
    var muxPlaybackId = muxResult.data.playback_ids && muxResult.data.playback_ids[0]
      ? muxResult.data.playback_ids[0].id : null;

    await updateDoc(COLLECTION, sessionId, {
      muxLiveStreamId: muxStreamId,
      muxPlaybackId: muxPlaybackId
    });
  }

  if (!streamKey) {
    return jsonResponse(500, { ok: false, error: 'Could not get Mux stream key' });
  }

  // Step 3: Start Room Composite Egress → RTMP to Mux
  var rtmpUrl = 'rtmps://global-live.mux.com:443/app/' + streamKey;
  try {
    await livekitApi('StartRoomCompositeEgress', {
      room_name: roomName,
      layout: 'grid',
      audio_only: false,
      video_only: false,
      stream_outputs: [{
        urls: [rtmpUrl],
        protocol: 0
      }]
    }, 'livekit.Egress');
    console.log('[livekit-token] Egress started for room:', roomName, '→ Mux:', muxStreamId);
  } catch (egressErr) {
    return jsonResponse(500, { ok: false, error: 'Failed to start egress: ' + egressErr.message });
  }

  return jsonResponse(200, {
    ok: true,
    roomName: roomName,
    muxStreamId: muxStreamId,
    message: 'Egress started — recording from now'
  });
}

// ═══════════════════════════════════════════════════════
// Stop all active egresses (admin only)
// ═══════════════════════════════════════════════════════
async function handleStopAllEgresses(event) {
  var user = await requireAuth(event, ['admin']);
  if (user.error) return user.error;

  try {
    var egressList = await livekitApi('ListEgress', {}, 'livekit.Egress');
    var egresses = egressList.items || egressList.egresses || [];
    var stopped = [];

    for (var i = 0; i < egresses.length; i++) {
      var eg = egresses[i];
      var eid = eg.egress_id || eg.egressId;
      if (!eid) continue;
      try {
        await livekitApi('StopEgress', { egress_id: eid }, 'livekit.Egress');
        stopped.push(eid);
      } catch (stopErr) {
        console.log('[livekit-token] Egress stop failed:', eid, stopErr.message);
      }
    }

    // Return raw egress data for debugging
    var debugInfo = egresses.map(function(eg) {
      return { keys: Object.keys(eg), egress_id: eg.egress_id, egressId: eg.egressId, status: eg.status, room_name: eg.room_name, roomName: eg.roomName };
    });

    return jsonResponse(200, {
      ok: true,
      total: egresses.length,
      stopped: stopped.length,
      stoppedIds: stopped,
      debug: debugInfo
    });
  } catch (err) {
    return jsonResponse(500, { ok: false, error: err.message });
  }
}

// ═══════════════════════════════════════════════════════
// Room status check
// ═══════════════════════════════════════════════════════
async function handleRoomStatus(params) {
  var roomName = params.room;
  if (!roomName) {
    return jsonResponse(400, { ok: false, error: 'room parameter is required' });
  }

  try {
    var rooms = await livekitApi('ListRooms', { names: [roomName] });
    var roomList = rooms.rooms || [];

    if (roomList.length > 0) {
      var room = roomList[0];
      return jsonResponse(200, {
        ok: true,
        active: true,
        numParticipants: room.num_participants || 0,
        metadata: room.metadata || ''
      });
    }

    return jsonResponse(200, { ok: true, active: false });
  } catch (err) {
    return jsonResponse(200, { ok: true, active: false, error: err.message });
  }
}
