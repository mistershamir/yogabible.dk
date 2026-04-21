/**
 * Netlify Function: /.netlify/functions/ai-reprocess-proxy
 *
 * Admin-facing proxy that triggers ai-process-recording-background using the
 * AI_INTERNAL_SECRET from env, so admins never need to handle the secret in
 * the browser. Auth is a Firebase ID token with role === 'admin'.
 *
 * POST body:
 *   sessionId (required)
 *   action    — 'reprocess' (default) resets summary/quiz; 'retranscribe' also clears transcript
 *
 * Behaviour:
 *   1. Verifies the caller is an admin.
 *   2. Looks up the session, reads its recordingAssetId.
 *   3. Resets aiStatus + error (and optionally transcript/summary/quiz fields)
 *      so the background-function guard doesn't short-circuit.
 *   4. Checks the Mux asset for ready auto-generated captions. If present,
 *      fetches the transcript, saves it to Firestore, and triggers the
 *      background function with transcriptReady:true (skips Deepgram).
 *      Otherwise, triggers normally (Deepgram path).
 */

const https = require('https');
const { requireAuth } = require('./shared/auth');
const { getDoc, updateDoc } = require('./shared/firestore');
const { jsonResponse } = require('./shared/utils');

const COLLECTION = 'live-schedule';

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(204, '');
  }
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'POST required' });
  }

  var authResult = await requireAuth(event, ['admin']);
  if (authResult.error) return authResult.error;

  var body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return jsonResponse(400, { ok: false, error: 'Invalid JSON' }); }

  var sessionId = body.sessionId;
  var action = body.action || 'reprocess';
  if (!sessionId) {
    return jsonResponse(400, { ok: false, error: 'sessionId required' });
  }
  if (action !== 'reprocess' && action !== 'retranscribe') {
    return jsonResponse(400, { ok: false, error: 'Unknown action: ' + action });
  }

  var secret = (process.env.AI_INTERNAL_SECRET || '').trim();
  if (!secret) {
    return jsonResponse(500, { ok: false, error: 'AI_INTERNAL_SECRET not configured' });
  }

  var session = await getDoc(COLLECTION, sessionId);
  if (!session) {
    return jsonResponse(404, { ok: false, error: 'Session not found' });
  }
  var assetId = session.recordingAssetId || null;
  var playbackId = session.recordingPlaybackId || null;
  if (!assetId && !playbackId) {
    return jsonResponse(400, { ok: false, error: 'Session has no recording to process' });
  }

  // Reset fields so the background function's ACTIVE_STATUSES guard doesn't bail,
  // and so stale content doesn't linger while processing runs.
  var reset = { aiStatus: null, aiError: null, aiSummary: null, aiSummary_da: null, aiSummary_en: null, aiQuiz: null, aiQuiz_da: null, aiQuiz_en: null };
  if (action === 'retranscribe') {
    reset.aiTranscript = null;
  }
  await updateDoc(COLLECTION, sessionId, reset);

  console.log('[ai-reprocess-proxy]', authResult.email, 'triggered', action, 'for', sessionId);

  // Check for auto-generated Mux captions. If a ready generated caption track
  // exists, fetch the transcript and skip Deepgram. Only fall back when no
  // captions are available.
  var transcriptReady = false;
  var captionInfo = null;
  if (assetId && playbackId) {
    try {
      captionInfo = await fetchMuxCaptionTranscript(assetId, playbackId);
    } catch (err) {
      console.warn('[ai-reprocess-proxy] Mux caption check failed — falling back to Deepgram:', err.message);
    }
  }

  if (captionInfo && captionInfo.transcript && captionInfo.transcript.length >= 50) {
    var update = {
      aiTranscript: captionInfo.transcript.substring(0, 50000),
      captionTrackId: captionInfo.trackId,
      aiCaptionTrackId: captionInfo.trackId,
      captionLang: captionInfo.lang,
      aiStatus: 'transcript_ready',
      aiError: null
    };
    if (captionInfo.vtt && captionInfo.vtt.length < 900000) update.captionVtt = captionInfo.vtt;
    await updateDoc(COLLECTION, sessionId, update);
    transcriptReady = true;
    console.log('[ai-reprocess-proxy] Mux captions found (' + captionInfo.transcript.length + ' chars) — triggering with transcriptReady:true');
  } else {
    console.log('[ai-reprocess-proxy] No Mux captions available — falling back to Deepgram');
  }

  try {
    await fireBackgroundTrigger({
      sessionId: sessionId,
      assetId: assetId,
      secret: secret,
      transcriptReady: transcriptReady
    });
  } catch (err) {
    console.error('[ai-reprocess-proxy] Trigger error:', err.message);
    return jsonResponse(502, { ok: false, error: 'Failed to trigger background function: ' + err.message });
  }

  return jsonResponse(202, {
    ok: true,
    message: 'Processing started',
    sessionId: sessionId,
    action: action,
    source: transcriptReady ? 'mux-captions' : 'deepgram'
  });
};

// Query Mux for the asset's tracks; if a ready generated caption track is
// present, fetch the .txt (and .vtt) transcript. Returns null when no
// suitable caption track is available.
async function fetchMuxCaptionTranscript(assetId, playbackId) {
  var assetResult = await muxFetch('GET', '/video/v1/assets/' + assetId);
  var tracks = (assetResult && assetResult.data && assetResult.data.tracks) || [];
  var captionTrack = null;
  for (var i = 0; i < tracks.length; i++) {
    var tr = tracks[i];
    if (tr.type === 'text' &&
        (tr.text_source === 'generated_vod' ||
         tr.text_source === 'generated_live' ||
         tr.text_source === 'uploaded') &&
        tr.status === 'ready') {
      captionTrack = tr;
      break;
    }
  }
  if (!captionTrack) return null;

  var trackId = captionTrack.id;
  var lang = captionTrack.language_code || 'en';
  var txtUrl = 'https://stream.mux.com/' + playbackId + '/text/' + trackId + '.txt';
  var vttUrl = 'https://stream.mux.com/' + playbackId + '/text/' + trackId + '.vtt';

  var transcript = await httpsGetText(txtUrl);
  var vtt = '';
  try { vtt = await httpsGetText(vttUrl); } catch (e) {
    console.log('[ai-reprocess-proxy] VTT fetch failed (non-fatal):', e.message);
  }

  return { trackId: trackId, lang: lang, transcript: transcript, vtt: vtt };
}

function muxFetch(method, path) {
  var tokenId = process.env.MUX_TOKEN_ID;
  var tokenSecret = process.env.MUX_TOKEN_SECRET;
  if (!tokenId || !tokenSecret) {
    return Promise.reject(new Error('MUX_TOKEN_ID and MUX_TOKEN_SECRET required'));
  }
  return new Promise(function (resolve, reject) {
    var opts = {
      hostname: 'api.mux.com',
      path: path,
      method: method,
      headers: {
        'Authorization': 'Basic ' + Buffer.from(tokenId + ':' + tokenSecret).toString('base64'),
        'Content-Type': 'application/json'
      }
    };
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
    req.setTimeout(15000, function () { req.destroy(new Error('Mux request timeout')); });
    req.end();
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
    req.setTimeout(30000, function () { req.destroy(new Error('timeout')); });
  });
}

// Fire-and-forget POST to the background function. We wait only for the response
// headers so we can surface errors; the handler itself runs async for up to 15 min.
function fireBackgroundTrigger(payload) {
  return new Promise(function (resolve, reject) {
    var payloadObj = {
      sessionId: payload.sessionId,
      assetId: payload.assetId,
      secret: payload.secret
    };
    if (payload.transcriptReady) payloadObj.transcriptReady = true;
    var data = JSON.stringify(payloadObj);
    var opts = {
      hostname: 'yogabible.dk',
      path: '/.netlify/functions/ai-process-recording-background',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 30000
    };
    var req = https.request(opts, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var bodyStr = Buffer.concat(chunks).toString();
        console.log('[ai-reprocess-proxy] Background responded', res.statusCode, bodyStr.slice(0, 200));
        if (res.statusCode === 200 || res.statusCode === 202) {
          resolve({ statusCode: res.statusCode, body: bodyStr });
        } else {
          reject(new Error('Background returned ' + res.statusCode + ': ' + bodyStr.slice(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', function () {
      req.destroy();
      reject(new Error('Timeout contacting background function'));
    });
    req.write(data);
    req.end();
  });
}
