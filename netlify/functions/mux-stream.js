/**
 * Netlify Function: /.netlify/functions/mux-stream
 * Manages Mux live streams for the Teacher Studio — remote browser-based streaming.
 *
 * Teacher-only actions (require auth + teacher/admin role):
 *   POST ?action=create-stream    — Create a new Mux live stream (returns stream key + playback ID)
 *   POST ?action=delete-stream    — Delete / disable a Mux live stream
 *   GET  ?action=stream-status    — Check if a live stream is active/idle
 *   GET  ?action=teacher-sessions — Get sessions assigned to the current teacher
 *
 * Flow:
 *   1. Teacher opens Teacher Studio → JS calls teacher-sessions to show their upcoming sessions
 *   2. Teacher selects a session → JS calls create-stream → gets RTMP URL + stream key
 *   3. Teacher's browser captures camera/mic → sends via WHIP (Mux Web Input) or MediaRecorder → RTMP
 *   4. Mux receives the stream → same webhook pipeline as ATEM Mini (mux-webhook.js handles lifecycle)
 *   5. Teacher ends stream → JS calls delete-stream to clean up
 *
 * Environment variables required:
 *   MUX_TOKEN_ID      — Mux API access token ID
 *   MUX_TOKEN_SECRET   — Mux API access token secret
 */

const { requireAuth } = require('./shared/auth');
const { getCollection, getDoc, updateDoc } = require('./shared/firestore');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const COLLECTION = 'live-schedule';
const MUX_API_BASE = 'https://api.mux.com';

/**
 * Make authenticated request to Mux API.
 */
async function muxFetch(path, method, body) {
  var tokenId = process.env.MUX_TOKEN_ID;
  var tokenSecret = process.env.MUX_TOKEN_SECRET;

  if (!tokenId || !tokenSecret) {
    throw new Error('MUX_TOKEN_ID and MUX_TOKEN_SECRET must be set');
  }

  var auth = Buffer.from(tokenId + ':' + tokenSecret).toString('base64');
  var opts = {
    method: method || 'GET',
    headers: {
      'Authorization': 'Basic ' + auth,
      'Content-Type': 'application/json'
    }
  };

  if (body) {
    opts.body = JSON.stringify(body);
  }

  var url = MUX_API_BASE + path;
  var res = await fetch(url, opts);
  var data = await res.json();

  if (!res.ok) {
    var errMsg = data.error ? (data.error.message || data.error.type || JSON.stringify(data.error)) : 'Mux API error';
    console.error('[mux-stream] API error:', res.status, errMsg);
    throw new Error(errMsg);
  }

  return data;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  var params = event.queryStringParameters || {};
  var action = params.action || '';

  try {
    // All actions require teacher or admin role
    var user = await requireAuth(event, ['teacher', 'admin']);
    if (user.error) return user.error;

    switch (action) {
      case 'create-stream':
        return handleCreateStream(event, user);
      case 'delete-stream':
        return handleDeleteStream(event, user);
      case 'stream-status':
        return handleStreamStatus(params);
      case 'teacher-sessions':
        return handleTeacherSessions(user);
      default:
        return jsonResponse(400, { ok: false, error: 'Unknown action: ' + action });
    }
  } catch (err) {
    console.error('[mux-stream]', err);
    return jsonResponse(err.status || 500, { ok: false, error: err.message });
  }
};

// ═══════════════════════════════════════════════════════
// Create a new Mux live stream for browser-based streaming
// ═══════════════════════════════════════════════════════
async function handleCreateStream(event, user) {
  var body = JSON.parse(event.body || '{}');
  var sessionId = body.sessionId;

  if (!sessionId) {
    return jsonResponse(400, { ok: false, error: 'sessionId is required' });
  }

  // Verify the session exists and is scheduled
  var session = await getDoc(COLLECTION, sessionId);
  if (!session) {
    return jsonResponse(404, { ok: false, error: 'Session not found' });
  }
  if (session.status !== 'scheduled') {
    return jsonResponse(400, { ok: false, error: 'Session is not in scheduled state (current: ' + session.status + ')' });
  }

  // Create a Mux live stream with recording enabled
  var result = await muxFetch('/video/v1/live-streams', 'POST', {
    playback_policy: ['public'],
    new_asset_settings: {
      playback_policy: ['public']
    },
    // Low-latency mode for better interactivity
    latency_mode: 'low',
    // Reconnect window allows teacher to briefly disconnect without ending the stream
    reconnect_window: 60,
    // Max continuous duration: 6 hours (for long workshops)
    max_continuous_duration: 21600
  });

  var stream = result.data;
  var streamKey = stream.stream_key;
  var streamId = stream.id;
  var playbackId = stream.playback_ids && stream.playback_ids[0]
    ? stream.playback_ids[0].id
    : null;

  console.log('[mux-stream] Created live stream:', streamId,
    'playback:', playbackId, 'for session:', sessionId, 'by:', user.email);

  // Update the session with the new stream info + mark as remote source
  await updateDoc(COLLECTION, sessionId, {
    muxLiveStreamId: streamId,
    muxPlaybackId: playbackId,
    muxStreamKey: streamKey,
    streamSource: 'remote',
    updated_by: user.email
  });

  // Return the RTMP URL + stream key for the browser to use via WHIP
  // Also return the SRT URL as an alternative
  return jsonResponse(200, {
    ok: true,
    streamId: streamId,
    streamKey: streamKey,
    playbackId: playbackId,
    rtmpUrl: 'rtmps://global-live.mux.com:443/app',
    srtUrl: 'srt://global-live.mux.com:5000',
    // Mux WHIP endpoint for browser-native WebRTC streaming
    whipUrl: 'https://global-live.mux.com/v1/whip/' + streamKey
  });
}

// ═══════════════════════════════════════════════════════
// Delete / disable a Mux live stream
// ═══════════════════════════════════════════════════════
async function handleDeleteStream(event, user) {
  var body = JSON.parse(event.body || '{}');
  var streamId = body.streamId;
  var sessionId = body.sessionId;

  if (!streamId) {
    return jsonResponse(400, { ok: false, error: 'streamId is required' });
  }

  try {
    // Signal Mux to complete the stream (sends idle event → webhook handles lifecycle)
    await muxFetch('/video/v1/live-streams/' + streamId + '/complete', 'PUT');
    console.log('[mux-stream] Completed stream:', streamId, 'by:', user.email);
  } catch (err) {
    // Stream may already be idle — that's fine
    console.log('[mux-stream] Complete failed (may already be idle):', err.message);
  }

  // Optionally disable the stream entirely so it can't be reused
  try {
    await muxFetch('/video/v1/live-streams/' + streamId + '/disable', 'PUT');
  } catch (err) {
    console.log('[mux-stream] Disable failed (non-fatal):', err.message);
  }

  return jsonResponse(200, { ok: true });
}

// ═══════════════════════════════════════════════════════
// Check live stream status
// ═══════════════════════════════════════════════════════
async function handleStreamStatus(params) {
  var streamId = params.streamId;
  if (!streamId) {
    return jsonResponse(400, { ok: false, error: 'streamId is required' });
  }

  var result = await muxFetch('/video/v1/live-streams/' + streamId, 'GET');
  var stream = result.data;

  return jsonResponse(200, {
    ok: true,
    status: stream.status, // 'active', 'idle', 'disabled'
    activeAssetId: stream.active_asset_id || null
  });
}

// ═══════════════════════════════════════════════════════
// Get sessions assigned to the current teacher
// ═══════════════════════════════════════════════════════
async function handleTeacherSessions(user) {
  var allItems = await getCollection(COLLECTION, { orderBy: 'startDateTime', orderDir: 'asc' });

  // Filter to scheduled or live sessions
  var nowMs = Date.now();
  var items = allItems.filter(function (item) {
    if (item.status !== 'scheduled' && item.status !== 'live') return false;
    if (item.status === 'live') return true;
    if (!item.startDateTime) return false;
    var itemTime = new Date(item.startDateTime).getTime();
    return !isNaN(itemTime) && itemTime >= nowMs;
  });

  // For teachers (non-admin): filter to sessions where they are the instructor
  // Match by email or by instructor name
  if (user.role === 'teacher') {
    items = items.filter(function (item) {
      // Match by instructor field (could be name or email)
      var instructor = (item.instructor || '').toLowerCase();
      var email = (user.email || '').toLowerCase();
      // Simple match: instructor contains the email prefix (before @)
      var emailPrefix = email.split('@')[0].replace(/[._-]/g, ' ');
      return instructor === email ||
             instructor.indexOf(emailPrefix) !== -1 ||
             // Also check if session has streamSource=remote and was created by this teacher
             item.created_by === email;
    });
  }

  // Strip sensitive fields
  var safe = items.map(function (item) {
    return {
      id: item.id,
      title_da: item.title_da,
      title_en: item.title_en,
      instructor: item.instructor,
      startDateTime: item.startDateTime,
      endDateTime: item.endDateTime,
      status: item.status,
      streamSource: item.streamSource || 'studio',
      muxLiveStreamId: item.muxLiveStreamId || null,
      muxPlaybackId: item.muxPlaybackId || null
    };
  });

  return jsonResponse(200, { ok: true, items: safe });
}
