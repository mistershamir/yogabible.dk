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
 *   4. Fires ai-process-recording-background with the internal secret and
 *      returns 202 immediately.
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

  try {
    await fireBackgroundTrigger({ sessionId: sessionId, assetId: assetId, secret: secret });
  } catch (err) {
    console.error('[ai-reprocess-proxy] Trigger error:', err.message);
    return jsonResponse(502, { ok: false, error: 'Failed to trigger background function: ' + err.message });
  }

  return jsonResponse(202, {
    ok: true,
    message: 'Processing started',
    sessionId: sessionId,
    action: action
  });
};

// Fire-and-forget POST to the background function. We wait only for the response
// headers so we can surface errors; the handler itself runs async for up to 15 min.
function fireBackgroundTrigger(payload) {
  return new Promise(function (resolve, reject) {
    var data = JSON.stringify(payload);
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
