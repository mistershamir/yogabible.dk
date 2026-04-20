/**
 * Netlify Function: /.netlify/functions/backfill-ai-recordings
 *
 * Bulk backfill tool for past Mux recordings:
 *   - Re-trigger AI pipeline on past ended sessions (one by one with stagger)
 *   - Scan Mux for ready assets not attached to any session (orphans)
 *   - List the live-unmatched-recordings collection
 *
 * Auth: X-Internal-Secret header must match AI_INTERNAL_SECRET env var.
 *
 * Query params / actions:
 *   ?action=list-mux-assets    — GET recent ready Mux assets (id, playback, created_at, duration)
 *   ?action=find-orphans       — Mux assets not attached to any live-schedule session
 *   ?action=list-unmatched     — dump live-unmatched-recordings collection
 *   (default POST, no action)  — run backfill with filters below
 *
 * Backfill params (POST, default action):
 *   dry_run=true               — list would-be targets, don't reset or trigger
 *   session_id=X               — single session
 *   status=missing             — sessions with recordingPlaybackId but no aiSummary
 *   status=failed              — sessions with aiStatus error or mp4_pending
 *   status=all                 — every ended session with a recording
 *   limit=N                    — max sessions to process (default 10, cap 50)
 */

const https = require('https');
const { getCollection, getDb, updateDoc } = require('./shared/firestore');
const { jsonResponse } = require('./shared/utils');

const COLLECTION = 'live-schedule';
const UNMATCHED_COLLECTION = 'live-unmatched-recordings';
const STAGGER_MS = 5000;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 10;

function isAuthorized(event) {
  var expected = process.env.AI_INTERNAL_SECRET || '';
  if (!expected) return false;
  var header = event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'] || '';
  // Also accept as query param for convenience (CLI curl etc.)
  if (!header) {
    var params = event.queryStringParameters || {};
    header = params.secret || '';
  }
  return header === expected;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Internal-Secret, Authorization'
  };
}

function optionsResponse() {
  return { statusCode: 204, headers: corsHeaders(), body: '' };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  if (!isAuthorized(event)) {
    return jsonResponse(401, { ok: false, error: 'Unauthorized — X-Internal-Secret required' });
  }

  var params = event.queryStringParameters || {};
  var action = params.action || '';

  try {
    if (action === 'list-mux-assets') return await handleListMuxAssets(params);
    if (action === 'find-orphans') return await handleFindOrphans(params);
    if (action === 'list-unmatched') return await handleListUnmatched();

    // Default: backfill
    if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
      return jsonResponse(405, { ok: false, error: 'Use POST' });
    }
    return await handleBackfill(params);
  } catch (err) {
    console.error('[backfill-ai-recordings]', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};

/* ═══════════════════════════════════════════
   BACKFILL
   ═══════════════════════════════════════════ */

async function handleBackfill(params) {
  var dryRun = params.dry_run === 'true' || params.dry_run === '1';
  var sessionId = params.session_id || '';
  var statusFilter = params.status || 'missing';
  var limit = Math.min(parseInt(params.limit, 10) || DEFAULT_LIMIT, MAX_LIMIT);

  var all = await getCollection(COLLECTION, { orderBy: 'startDateTime', orderDir: 'desc' });

  var candidates;
  if (sessionId) {
    var single = all.find(function (s) { return s.id === sessionId; });
    if (!single) return jsonResponse(404, { ok: false, error: 'Session not found: ' + sessionId });
    if (!single.recordingPlaybackId) {
      return jsonResponse(400, { ok: false, error: 'Session has no recording' });
    }
    candidates = [single];
  } else {
    var withRecording = all.filter(function (s) {
      return s.status === 'ended' && s.recordingPlaybackId && s.recordingAssetId;
    });

    if (statusFilter === 'missing') {
      candidates = withRecording.filter(function (s) {
        return !s.aiSummary && !s.aiSummary_da && !s.aiSummary_en;
      });
    } else if (statusFilter === 'failed') {
      candidates = withRecording.filter(function (s) {
        return s.aiStatus === 'error' || s.aiStatus === 'mp4_pending' || s.aiStatus === 'no_transcript';
      });
    } else if (statusFilter === 'all') {
      candidates = withRecording;
    } else {
      return jsonResponse(400, { ok: false, error: 'Unknown status: ' + statusFilter });
    }
  }

  var targets = candidates.slice(0, limit);

  if (dryRun) {
    return jsonResponse(200, {
      ok: true,
      dry_run: true,
      matched: candidates.length,
      wouldProcess: targets.length,
      sessions: targets.map(summarizeSession)
    });
  }

  // Reset + stagger triggers
  var queued = [];
  var errors = [];
  var clearTranscript = statusFilter === 'failed' || statusFilter === 'all' || !!sessionId;

  for (var i = 0; i < targets.length; i++) {
    var s = targets[i];
    try {
      var reset = { aiStatus: null, aiError: null };
      if (clearTranscript) {
        reset.aiTranscript = null;
        reset.aiSummary = null;
        reset.aiSummary_da = null;
        reset.aiSummary_en = null;
        reset.aiQuiz = null;
        reset.aiQuiz_da = null;
        reset.aiQuiz_en = null;
      }
      await updateDoc(COLLECTION, s.id, reset);

      triggerAiProcess(s.id, s.recordingAssetId);
      queued.push({ id: s.id, title: s.title_da || s.title_en || '', assetId: s.recordingAssetId });
      console.log('[backfill-ai] Queued', s.id, '(' + (s.title_da || s.title_en || '') + ')');

      if (i < targets.length - 1) await sleep(STAGGER_MS);
    } catch (err) {
      errors.push({ id: s.id, error: err.message });
      console.error('[backfill-ai] Error for', s.id, ':', err.message);
    }
  }

  return jsonResponse(200, {
    ok: true,
    matched: candidates.length,
    queued: queued.length,
    skipped: candidates.length - queued.length,
    errors: errors,
    sessions: queued
  });
}

function summarizeSession(s) {
  return {
    id: s.id,
    title: s.title_da || s.title_en || '',
    startDateTime: s.startDateTime || null,
    aiStatus: s.aiStatus || null,
    aiError: s.aiError || null,
    recordingPlaybackId: s.recordingPlaybackId || null,
    recordingAssetId: s.recordingAssetId || null,
    hasSummary: !!(s.aiSummary || s.aiSummary_da || s.aiSummary_en)
  };
}

/* ═══════════════════════════════════════════
   MUX ASSET ACTIONS
   ═══════════════════════════════════════════ */

async function handleListMuxAssets(params) {
  var days = parseInt(params.days, 10);
  var limit = Math.min(parseInt(params.limit, 10) || 50, 100);
  var page = parseInt(params.page, 10) || 1;

  var result = await muxFetch('GET', '/video/v1/assets?limit=' + limit + '&page=' + page);
  var raw = Array.isArray(result.data) ? result.data : [];
  var cutoffMs = (days > 0) ? Date.now() - (days * 86400000) : 0;

  var assets = [];
  for (var i = 0; i < raw.length; i++) {
    var a = raw[i];
    if (a.status !== 'ready') continue;
    var createdMs = a.created_at ? parseInt(a.created_at, 10) * 1000 : 0;
    if (cutoffMs && createdMs && createdMs < cutoffMs) continue;
    assets.push(formatMuxAsset(a));
  }
  return jsonResponse(200, {
    ok: true,
    count: assets.length,
    assets: assets,
    nextPage: raw.length >= limit ? page + 1 : null
  });
}

async function handleFindOrphans(params) {
  var days = parseInt(params.days, 10) || 60;
  var pagesToScan = Math.min(parseInt(params.pages, 10) || 3, 10);
  var limit = 50;

  // Collect attached IDs from Firestore
  var all = await getCollection(COLLECTION);
  var attachedAssetIds = {};
  var attachedPlaybackIds = {};
  for (var i = 0; i < all.length; i++) {
    if (all[i].recordingAssetId) attachedAssetIds[all[i].recordingAssetId] = all[i].id;
    if (all[i].recordingPlaybackId) attachedPlaybackIds[all[i].recordingPlaybackId] = all[i].id;
  }

  var cutoffMs = Date.now() - (days * 86400000);
  var orphans = [];
  var scanned = 0;

  for (var page = 1; page <= pagesToScan; page++) {
    var result = await muxFetch('GET', '/video/v1/assets?limit=' + limit + '&page=' + page);
    var raw = Array.isArray(result.data) ? result.data : [];
    if (!raw.length) break;

    for (var j = 0; j < raw.length; j++) {
      var a = raw[j];
      scanned++;
      if (a.status !== 'ready') continue;
      var createdMs = a.created_at ? parseInt(a.created_at, 10) * 1000 : 0;
      if (createdMs && createdMs < cutoffMs) {
        // older than window — stop paging (Mux returns newest first)
        return jsonResponse(200, { ok: true, scanned: scanned, orphans: orphans, truncated: false });
      }
      if (attachedAssetIds[a.id]) continue;
      var pbId = getPublicPlaybackId(a);
      if (pbId && attachedPlaybackIds[pbId]) continue;
      orphans.push(formatMuxAsset(a));
    }
    if (raw.length < limit) break;
  }

  return jsonResponse(200, { ok: true, scanned: scanned, orphans: orphans, truncated: scanned >= pagesToScan * limit });
}

async function handleListUnmatched() {
  var db = getDb();
  var snap = await db.collection(UNMATCHED_COLLECTION).get();
  var items = [];
  snap.forEach(function (doc) {
    items.push(Object.assign({ id: doc.id }, doc.data()));
  });
  items.sort(function (a, b) {
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });
  return jsonResponse(200, { ok: true, count: items.length, items: items });
}

/* ═══════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════ */

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function getPublicPlaybackId(asset) {
  var ids = asset.playback_ids || [];
  for (var i = 0; i < ids.length; i++) {
    if (ids[i].policy === 'public') return ids[i].id;
  }
  return ids.length ? ids[0].id : null;
}

function formatMuxAsset(a) {
  var res = '';
  if (Array.isArray(a.tracks)) {
    var maxH = 0;
    for (var t = 0; t < a.tracks.length; t++) {
      var tr = a.tracks[t];
      if (tr.type === 'video' && tr.max_height && tr.max_height > maxH) {
        maxH = tr.max_height;
        res = (tr.max_width || '?') + 'x' + tr.max_height;
      }
    }
  }
  return {
    id: a.id,
    playback_id: getPublicPlaybackId(a),
    created_at: a.created_at ? new Date(parseInt(a.created_at, 10) * 1000).toISOString() : null,
    duration: a.duration || 0,
    resolution: res,
    live_stream_id: a.live_stream_id || null
  };
}

function muxFetch(method, path, body) {
  var tokenId = process.env.MUX_TOKEN_ID;
  var tokenSecret = process.env.MUX_TOKEN_SECRET;
  if (!tokenId || !tokenSecret) throw new Error('MUX_TOKEN_ID and MUX_TOKEN_SECRET required');

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
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
          else reject(new Error('Mux API ' + res.statusCode + ': ' + raw.substring(0, 200)));
        } catch (e) {
          reject(new Error('Mux parse error: ' + raw.substring(0, 200)));
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function triggerAiProcess(sessionId, assetId) {
  var payload = JSON.stringify({
    sessionId: sessionId,
    assetId: assetId,
    secret: process.env.AI_INTERNAL_SECRET || ''
  });
  var opts = {
    hostname: 'yogabible.dk',
    path: '/.netlify/functions/ai-process-recording-background',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    },
    timeout: 5000
  };
  var req = https.request(opts, function (res) {
    console.log('[backfill-ai] Triggered', sessionId, '→', res.statusCode);
    res.resume();
  });
  req.on('error', function (err) {
    console.log('[backfill-ai] Trigger error (non-fatal):', err.message);
  });
  req.on('timeout', function () { req.destroy(); });
  req.write(payload);
  req.end();
}
