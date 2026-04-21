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
const { requireAuth } = require('./shared/auth');

const COLLECTION = 'live-schedule';
const UNMATCHED_COLLECTION = 'live-unmatched-recordings';
const STAGGER_MS = 8000;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 10;

// Accept either (a) the AI_INTERNAL_SECRET via header/query (CLI usage) OR
// (b) a Firebase ID token with role=admin (browser admin panel usage).
// Returns { ok: true } on success, { ok: false, response } with an error response otherwise.
async function authorize(event) {
  var expected = process.env.AI_INTERNAL_SECRET || '';
  var header = event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'] || '';
  if (!header) {
    var params = event.queryStringParameters || {};
    header = params.secret || '';
  }
  if (expected && header === expected) return { ok: true };

  // Fall back to admin token auth for browser-based admin panel.
  var authHeader = event.headers.authorization || event.headers.Authorization || '';
  if (authHeader) {
    var authResult = await requireAuth(event, ['admin']);
    if (!authResult.error) return { ok: true };
  }
  return { ok: false, response: jsonResponse(401, { ok: false, error: 'Unauthorized — admin auth or X-Internal-Secret required' }) };
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

  var auth = await authorize(event);
  if (!auth.ok) return auth.response;

  var params = event.queryStringParameters || {};
  var action = params.action || '';

  try {
    if (action === 'list-mux-assets') return await handleListMuxAssets(params);
    if (action === 'find-orphans') return await handleFindOrphans(params);
    if (action === 'list-unmatched') return await handleListUnmatched();
    if (action === 'generate-captions') return await handleGenerateCaptions(params);
    if (action === 'fetch-transcripts') return await handleFetchTranscripts(params);
    if (action === 'inspect-asset') return await handleInspectAsset(params);

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

/**
 * Retroactively generate Mux auto-captions on old recordings.
 * For each session with recordingAssetId but no captionTrackId, calls Mux's
 * generate-subtitles endpoint on the asset's audio track. Mux then fires
 * video.asset.track.ready when captions are ready — handleTrackReady triggers
 * the Claude pipeline.
 */
async function handleGenerateCaptions(params) {
  var limit = Math.min(parseInt(params.limit, 10) || DEFAULT_LIMIT, MAX_LIMIT);
  var dryRun = params.dry_run === 'true' || params.dry_run === '1';
  var sessionId = params.session_id || '';

  var all = await getCollection(COLLECTION, { orderBy: 'startDateTime', orderDir: 'desc' });

  var candidates;
  if (sessionId) {
    var single = all.find(function (s) { return s.id === sessionId; });
    if (!single) return jsonResponse(404, { ok: false, error: 'Session not found: ' + sessionId });
    if (!single.recordingAssetId) return jsonResponse(400, { ok: false, error: 'Session has no recordingAssetId' });
    candidates = [single];
  } else {
    candidates = all.filter(function (s) {
      return s.recordingAssetId && !s.captionTrackId && !s.aiCaptionTrackId;
    });
  }

  var targets = candidates.slice(0, limit);

  if (dryRun) {
    return jsonResponse(200, {
      ok: true,
      dry_run: true,
      matched: candidates.length,
      wouldProcess: targets.length,
      sessions: targets.map(function (s) {
        return { id: s.id, title: s.title_da || s.title_en || '', assetId: s.recordingAssetId };
      })
    });
  }

  var queued = [];
  var errors = [];
  var skipped = [];

  for (var i = 0; i < targets.length; i++) {
    var s = targets[i];
    try {
      // Fetch asset to find audio track ID
      var assetResult = await muxFetch('GET', '/video/v1/assets/' + s.recordingAssetId);
      var tracks = (assetResult.data && assetResult.data.tracks) || [];
      var audioTrack = null;
      for (var t = 0; t < tracks.length; t++) {
        if (tracks[t].type === 'audio') { audioTrack = tracks[t]; break; }
      }
      if (!audioTrack || !audioTrack.id) {
        skipped.push({ id: s.id, reason: 'no audio track' });
        continue;
      }

      // Check if captions are already being generated / exist
      var hasGeneratedText = false;
      for (var tt = 0; tt < tracks.length; tt++) {
        var tr = tracks[tt];
        if (tr.type === 'text' &&
            (tr.text_source === 'generated_vod' || tr.text_source === 'generated_live')) {
          hasGeneratedText = true;
          break;
        }
      }
      if (hasGeneratedText) {
        skipped.push({ id: s.id, reason: 'captions already exist on asset' });
        continue;
      }

      await muxFetch('POST',
        '/video/v1/assets/' + s.recordingAssetId + '/tracks/' + audioTrack.id + '/generate-subtitles',
        { generated_subtitles: [{ language_code: 'en', name: 'English (auto)' }] }
      );

      await updateDoc(COLLECTION, s.id, {
        aiStatus: 'captions_requested',
        aiError: null
      });

      queued.push({ id: s.id, title: s.title_da || s.title_en || '', assetId: s.recordingAssetId });
      console.log('[backfill-ai] Generate-captions queued:', s.id, 'asset:', s.recordingAssetId);

      if (i < targets.length - 1) await sleep(1000);
    } catch (err) {
      errors.push({ id: s.id, error: err.message });
      console.error('[backfill-ai] generate-captions error for', s.id, ':', err.message);
    }
  }

  return jsonResponse(200, {
    ok: true,
    matched: candidates.length,
    queued: queued.length,
    skipped: skipped.length,
    skippedDetails: skipped,
    errors: errors,
    sessions: queued
  });
}

/**
 * Fetch Mux-generated transcripts for sessions whose captions exist on Mux
 * but whose aiTranscript is empty locally (webhook missed the track.ready
 * event, e.g. before the webhook was configured).
 */
/**
 * Read-only debug: dump the tracks array (plus key asset metadata) for an
 * asset or session. Use to diagnose why fetch-transcripts skips a session.
 *   ?action=inspect-asset&session_id=RvC1AVM5Zjh7ruWboHun
 *   ?action=inspect-asset&asset_id=Z0269olyWzGjdIKu00cxTooZiICbOJ9bfICsBYuyC2DAI
 */
async function handleInspectAsset(params) {
  var assetId = params.asset_id || '';
  var sessionId = params.session_id || '';

  if (!assetId && sessionId) {
    var all = await getCollection(COLLECTION);
    var s = all.find(function (x) { return x.id === sessionId; });
    if (!s) return jsonResponse(404, { ok: false, error: 'Session not found: ' + sessionId });
    assetId = s.recordingAssetId;
    if (!assetId) return jsonResponse(400, { ok: false, error: 'Session has no recordingAssetId' });
  }
  if (!assetId) return jsonResponse(400, { ok: false, error: 'asset_id or session_id required' });

  var assetResult = await muxFetch('GET', '/video/v1/assets/' + assetId);
  var data = (assetResult && assetResult.data) || {};

  return jsonResponse(200, {
    ok: true,
    asset_id: assetId,
    status: data.status || null,
    duration: data.duration || null,
    created_at: data.created_at || null,
    live_stream_id: data.live_stream_id || null,
    master: data.master || null,
    tracks: data.tracks || [],
    playback_ids: data.playback_ids || []
  });
}

async function handleFetchTranscripts(params) {
  var limit = Math.min(parseInt(params.limit, 10) || DEFAULT_LIMIT, MAX_LIMIT);
  var dryRun = params.dry_run === 'true' || params.dry_run === '1';
  var sessionId = params.session_id || '';

  var all = await getCollection(COLLECTION, { orderBy: 'startDateTime', orderDir: 'desc' });

  var candidates;
  if (sessionId) {
    var single = all.find(function (s) { return s.id === sessionId; });
    if (!single) return jsonResponse(404, { ok: false, error: 'Session not found: ' + sessionId });
    if (!single.recordingAssetId || !single.recordingPlaybackId) {
      return jsonResponse(400, { ok: false, error: 'Session missing recordingAssetId or recordingPlaybackId' });
    }
    candidates = [single];
  } else {
    candidates = all.filter(function (s) {
      return s.recordingAssetId && s.recordingPlaybackId && !s.aiTranscript;
    });
  }

  var targets = candidates.slice(0, limit);

  if (dryRun) {
    return jsonResponse(200, {
      ok: true,
      dry_run: true,
      matched: candidates.length,
      wouldProcess: targets.length,
      sessions: targets.map(function (s) {
        return { id: s.id, title: s.title_da || s.title_en || '', assetId: s.recordingAssetId };
      })
    });
  }

  var queued = [];
  var errors = [];
  var skipped = [];

  for (var i = 0; i < targets.length; i++) {
    var s = targets[i];
    try {
      var assetResult = await muxFetch('GET', '/video/v1/assets/' + s.recordingAssetId);
      var tracks = (assetResult.data && assetResult.data.tracks) || [];
      var captionTrack = null;
      for (var t = 0; t < tracks.length; t++) {
        var tr = tracks[t];
        if (tr.type === 'text' &&
            (tr.text_source === 'generated_vod' || tr.text_source === 'generated_live') &&
            tr.status === 'ready') {
          captionTrack = tr;
          break;
        }
      }
      if (!captionTrack) {
        skipped.push({ id: s.id, reason: 'no ready generated caption track' });
        continue;
      }

      var trackId = captionTrack.id;
      var langCode = captionTrack.language_code || 'en';

      var txtUrl = 'https://stream.mux.com/' + s.recordingPlaybackId + '/text/' + trackId + '.txt';
      var vttUrl = 'https://stream.mux.com/' + s.recordingPlaybackId + '/text/' + trackId + '.vtt';

      var transcriptTxt = '';
      var vtt = '';
      try { transcriptTxt = await httpsGetText(txtUrl); } catch (e) {
        errors.push({ id: s.id, error: 'txt fetch: ' + e.message });
        continue;
      }
      try { vtt = await httpsGetText(vttUrl); } catch (e) {
        console.log('[backfill-ai] VTT fetch failed (non-fatal) for', s.id, ':', e.message);
      }

      if (!transcriptTxt || transcriptTxt.length < 50) {
        skipped.push({ id: s.id, reason: 'transcript too short (' + transcriptTxt.length + ' chars)' });
        continue;
      }

      var update = {
        aiTranscript: transcriptTxt.substring(0, 50000),
        captionTrackId: trackId,
        aiCaptionTrackId: trackId,
        captionLang: langCode,
        aiStatus: 'transcript_ready',
        aiError: null
      };
      if (vtt && vtt.length < 900000) update.captionVtt = vtt;

      await updateDoc(COLLECTION, s.id, update);
      console.log('[backfill-ai] Saved transcript for', s.id, '(' + transcriptTxt.length, 'chars) — triggering Claude');

      // Await the trigger so the POST actually lands before this lambda returns.
      // Netlify would otherwise freeze us and kill the in-flight request.
      var triggerResult = await triggerAiProcess(s.id, s.recordingAssetId, true);
      if (!triggerResult.ok) {
        errors.push({
          id: s.id,
          error: 'trigger failed: ' + (triggerResult.error || ('HTTP ' + triggerResult.status + ' ' + (triggerResult.body || '')))
        });
        continue;
      }

      queued.push({
        id: s.id,
        title: s.title_da || s.title_en || '',
        assetId: s.recordingAssetId,
        chars: transcriptTxt.length
      });
      console.log('[backfill-ai] Triggered Claude for', s.id);

      if (i < targets.length - 1) await sleep(STAGGER_MS);
    } catch (err) {
      errors.push({ id: s.id, error: err.message });
      console.error('[backfill-ai] fetch-transcripts error for', s.id, ':', err.message);
    }
  }

  return jsonResponse(200, {
    ok: true,
    matched: candidates.length,
    queued: queued.length,
    skipped: skipped.length,
    skippedDetails: skipped,
    errors: errors,
    sessions: queued
  });
}

function httpsGetText(url) {
  return new Promise(function (resolve, reject) {
    var req = https.get(url, function (res) {
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

// Awaitable trigger — Netlify background functions return 202 immediately,
// but the POST must finish *before* this lambda returns or the request gets
// killed in-flight (lambda freeze) and ai-process-recording-background never
// starts. That manifests as `queued: 0` even when the transcript saved.
function triggerAiProcess(sessionId, assetId, transcriptReady) {
  return new Promise(function (resolve) {
    var payloadObj = {
      sessionId: sessionId,
      assetId: assetId,
      secret: process.env.AI_INTERNAL_SECRET || ''
    };
    if (transcriptReady) payloadObj.transcriptReady = true;
    var payload = JSON.stringify(payloadObj);
    var opts = {
      hostname: 'yogabible.dk',
      path: '/.netlify/functions/ai-process-recording-background',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    var req = https.request(opts, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var body = Buffer.concat(chunks).toString();
        if (res.statusCode === 200 || res.statusCode === 202) {
          console.log('[backfill-ai] Trigger response:', sessionId, 'status:', res.statusCode, 'body:', body.substring(0, 200));
          resolve({ ok: true, status: res.statusCode });
        } else {
          console.error('[backfill-ai] Trigger response:', sessionId, 'status:', res.statusCode, 'body:', body.substring(0, 200));
          resolve({ ok: false, status: res.statusCode, body: body.substring(0, 200) });
        }
      });
    });
    req.setTimeout(15000, function () {
      console.error('[backfill-ai] Trigger TIMED OUT for session:', sessionId);
      req.destroy(new Error('timeout'));
    });
    req.on('error', function (err) {
      console.error('[backfill-ai] Trigger error:', sessionId, err.message);
      resolve({ ok: false, error: err.message });
    });
    req.write(payload);
    req.end();
  });
}
