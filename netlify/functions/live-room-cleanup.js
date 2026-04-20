/**
 * Scheduled function: runs every 5 minutes.
 * Closes zombie LiveKit rooms where the teacher has left but egress keeps the room alive.
 *
 * How it works:
 *   1. Lists all active LiveKit rooms
 *   2. For each room, lists participants
 *   3. If the only participants are egress processes (identity starts with 'EG_' or 'egress')
 *      or there are 0 real participants, the room is a zombie
 *   4. Waits for the room to have been in zombie state for 5+ minutes (uses Firestore timestamp)
 *   5. Auto-closes: stops egresses, deletes room, updates session to 'ended'
 */

const crypto = require('crypto');
const { getDoc, updateDoc, queryDocs, getCollection } = require('./shared/firestore');
const { jsonResponse } = require('./shared/utils');

const COLLECTION = 'live-schedule';

// Any session sitting in these AI statuses longer than STUCK_AI_THRESHOLD_MS
// is assumed dead (function crashed / timed out) and reset so the pipeline retries.
var STUCK_AI_STATUSES = ['processing', 'preparing_audio', 'transcribing', 'deepgram_pending'];
var STUCK_AI_THRESHOLD_MS = 20 * 60 * 1000; // 20 minutes

// ── LiveKit helpers (same as livekit-token.js) ──

function createToken(opts) {
  var apiKey = process.env.LIVEKIT_API_KEY;
  var apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) throw new Error('LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set');

  var header = { alg: 'HS256', typ: 'JWT' };
  var now = Math.floor(Date.now() / 1000);
  var payload = {
    iss: apiKey,
    sub: opts.identity || 'server',
    iat: now,
    nbf: now,
    exp: now + (opts.ttl || 60),
    video: {
      roomCreate: opts.roomCreate || false,
      roomAdmin: opts.roomAdmin || false,
      room: opts.room || ''
    }
  };
  if (opts.roomRecord) payload.video.roomRecord = true;

  function b64url(obj) {
    return Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  }

  var segments = b64url(header) + '.' + b64url(payload);
  var sig = crypto.createHmac('sha256', apiSecret).update(segments).digest('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  return segments + '.' + sig;
}

async function livekitApi(method, body, service) {
  var url = process.env.LIVEKIT_URL;
  if (!url) throw new Error('LIVEKIT_URL must be set');

  var httpUrl = url.replace('wss://', 'https://').replace('ws://', 'http://');
  var adminToken = createToken({
    identity: 'server',
    room: '',
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
  try { data = JSON.parse(text); } catch (e) {
    throw new Error('LiveKit API error (' + res.status + '): ' + text.substring(0, 200));
  }
  if (!res.ok) {
    throw new Error('LiveKit API error (' + res.status + '): ' + (data.msg || data.message || JSON.stringify(data)));
  }
  return data;
}

async function muxFetch(path, method, body) {
  var MUX_TOKEN_ID = process.env.MUX_TOKEN_ID;
  var MUX_TOKEN_SECRET = process.env.MUX_TOKEN_SECRET;
  if (!MUX_TOKEN_ID || !MUX_TOKEN_SECRET) throw new Error('MUX_TOKEN_ID and MUX_TOKEN_SECRET must be set');
  var auth = Buffer.from(MUX_TOKEN_ID + ':' + MUX_TOKEN_SECRET).toString('base64');

  var opts = {
    method: method || 'GET',
    headers: {
      'Authorization': 'Basic ' + auth,
      'Content-Type': 'application/json'
    }
  };
  if (body) opts.body = JSON.stringify(body);

  var res = await fetch('https://api.mux.com' + path, opts);
  if (!res.ok) {
    var errText = await res.text();
    throw new Error('Mux API error (' + res.status + '): ' + errText.substring(0, 200));
  }
  return res.json();
}

// ── Main handler ──

exports.handler = async function (event) {
  console.log('[live-room-cleanup] Running zombie room check...');

  var liveKitConfigured = process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET && process.env.LIVEKIT_URL;
  if (!liveKitConfigured) {
    console.log('[live-room-cleanup] LiveKit not configured — skipping zombie-room check, running stuck-AI recovery only');
    var resetAiOnly = [];
    try { resetAiOnly = await recoverStuckAiSessions(); }
    catch (e) { console.error('[live-room-cleanup] Stuck-AI recovery error:', e.message); }
    return jsonResponse(200, { ok: true, skipped: 'livekit', resetAi: resetAiOnly });
  }

  try {
    // List all active rooms
    var roomsResult = await livekitApi('ListRooms', {});
    var rooms = roomsResult.rooms || [];

    if (rooms.length === 0) {
      console.log('[live-room-cleanup] No active rooms');
      return jsonResponse(200, { ok: true, rooms: 0 });
    }

    var cleaned = [];

    for (var r = 0; r < rooms.length; r++) {
      var room = rooms[r];
      var roomName = room.name;

      // Only handle our rooms
      if (!roomName || !roomName.startsWith('yb-live-')) continue;

      // List participants in this room
      var partResult = await livekitApi('ListParticipants', { room: roomName });
      var participants = partResult.participants || [];

      // Count real participants (not egress)
      var realParticipants = 0;
      for (var p = 0; p < participants.length; p++) {
        var identity = participants[p].identity || '';
        if (!identity.startsWith('EG_') && !identity.startsWith('egress')) {
          realParticipants++;
        }
      }

      if (realParticipants > 0) {
        console.log('[live-room-cleanup] Room', roomName, 'has', realParticipants, 'real participants — skipping');
        continue;
      }

      // Room is a zombie — check how long it's been empty
      var sessionId = roomName.replace('yb-live-', '');
      var session = await getDoc(COLLECTION, sessionId);

      if (!session) {
        console.log('[live-room-cleanup] No session found for room', roomName, '— closing immediately');
      } else if (session.status !== 'live') {
        console.log('[live-room-cleanup] Session', sessionId, 'is', session.status, '— closing zombie room');
      } else {
        // Session is still 'live' — check if teacher has been gone long enough
        // Use a Firestore field to track when we first detected the room as empty
        if (!session._zombieDetectedAt) {
          // First detection — mark timestamp, don't close yet
          await updateDoc(COLLECTION, sessionId, { _zombieDetectedAt: new Date().toISOString() });
          console.log('[live-room-cleanup] Room', roomName, 'is empty — marked for cleanup in 5 min');
          continue;
        }

        var detectedAt = new Date(session._zombieDetectedAt);
        var minutesEmpty = (Date.now() - detectedAt.getTime()) / 60000;

        if (minutesEmpty < 5) {
          console.log('[live-room-cleanup] Room', roomName, 'empty for', Math.round(minutesEmpty), 'min — waiting (need 5 min)');
          continue;
        }

        console.log('[live-room-cleanup] Room', roomName, 'empty for', Math.round(minutesEmpty), 'min — auto-closing');
      }

      // ── Close the zombie room ──

      // Stop egresses
      try {
        var egressList = await livekitApi('ListEgress', { room_name: roomName }, 'livekit.Egress');
        var egresses = egressList.items || egressList.egresses || [];
        for (var e = 0; e < egresses.length; e++) {
          var eid = egresses[e].egress_id || egresses[e].egressId;
          if (!eid) continue;
          try { await livekitApi('StopEgress', { egress_id: eid }, 'livekit.Egress'); } catch (se) {}
        }
      } catch (le) {}

      // Delete room
      try { await livekitApi('DeleteRoom', { room: roomName }); } catch (de) {}

      // Update session
      if (session) {
        var updates = {
          status: 'ended',
          liveEndedAt: new Date().toISOString(),
          _zombieDetectedAt: null,
          _autoClosedByCleanup: true
        };

        if (session.liveStartedAt) {
          var durationMs = Date.now() - new Date(session.liveStartedAt).getTime();
          updates.durationMinutes = Math.round(durationMs / 60000);
        }

        // Stop Mux stream
        if (session.muxLiveStreamId) {
          try { await muxFetch('/video/v1/live-streams/' + session.muxLiveStreamId + '/complete', 'PUT'); } catch (me) {}
          try { await muxFetch('/video/v1/live-streams/' + session.muxLiveStreamId + '/disable', 'PUT'); } catch (me2) {}
        }

        await updateDoc(COLLECTION, sessionId, updates);
      }

      cleaned.push(roomName);
      console.log('[live-room-cleanup] Zombie room closed:', roomName);
    }

    // Clear _zombieDetectedAt for rooms that are no longer empty (teacher rejoined)
    // This runs on rooms we skipped because they had real participants
    for (var r2 = 0; r2 < rooms.length; r2++) {
      var rn = rooms[r2].name;
      if (!rn || !rn.startsWith('yb-live-')) continue;
      if (cleaned.indexOf(rn) !== -1) continue; // already cleaned

      var sid = rn.replace('yb-live-', '');
      var sess = await getDoc(COLLECTION, sid);
      if (sess && sess._zombieDetectedAt) {
        await updateDoc(COLLECTION, sid, { _zombieDetectedAt: null });
        console.log('[live-room-cleanup] Teacher rejoined room', rn, '— cleared zombie marker');
      }
    }

    // ── Stuck AI recovery ──
    var resetAi = [];
    try {
      resetAi = await recoverStuckAiSessions();
    } catch (aiErr) {
      console.error('[live-room-cleanup] Stuck-AI recovery error (non-fatal):', aiErr.message);
    }

    console.log('[live-room-cleanup] Done. Cleaned:', cleaned.length, 'rooms, reset AI:', resetAi.length, 'sessions');
    return jsonResponse(200, { ok: true, cleaned: cleaned, resetAi: resetAi });

  } catch (err) {
    console.error('[live-room-cleanup] Error:', err.message);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};

/**
 * Find sessions stuck in an active-looking AI status for more than
 * STUCK_AI_THRESHOLD_MS and clear the status so the pipeline retries.
 * Uses `updated_at` (or `aiMasterAccessRequestedAt` as a fallback) to age them.
 */
async function recoverStuckAiSessions() {
  var all = await getCollection(COLLECTION);
  var nowMs = Date.now();
  var reset = [];

  for (var i = 0; i < all.length; i++) {
    var s = all[i];
    if (STUCK_AI_STATUSES.indexOf(s.aiStatus) === -1) continue;

    // Age based on most recent known timestamp.
    var ageSource = s.updated_at || s.aiMasterAccessRequestedAt || s.liveEndedAt || s.startDateTime;
    if (!ageSource) continue;
    var ageMs = nowMs - new Date(ageSource).getTime();
    if (isNaN(ageMs) || ageMs < STUCK_AI_THRESHOLD_MS) continue;

    var oldStatus = s.aiStatus;
    try {
      await updateDoc(COLLECTION, s.id, {
        aiStatus: null,
        aiError: 'Reset by cleanup cron after ' + Math.round(ageMs / 60000) + ' min stuck in ' + oldStatus
      });
      console.log('[cleanup] Reset stuck AI session:', s.id, 'from:', oldStatus, '(' + Math.round(ageMs / 60000) + ' min)');
      reset.push({ id: s.id, from: oldStatus, ageMinutes: Math.round(ageMs / 60000) });
    } catch (err) {
      console.error('[cleanup] Failed to reset', s.id, ':', err.message);
    }
  }
  return reset;
}
