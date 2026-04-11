/**
 * Netlify Function: /.netlify/functions/deepgram-webhook
 *
 * Receives async transcription results from Deepgram's callback API.
 * Called automatically by Deepgram when transcription completes.
 *
 * Query params (set when requesting transcription):
 *   ?sessionId=FIRESTORE_ID  — which live-schedule session to update
 *   &secret=AI_INTERNAL_SECRET — auth
 *   &mode=transcript-only    — save transcript only (skip Claude)
 *   &mode=full               — save transcript + trigger Claude summary/quiz
 */

const https = require('https');
const { getDoc, updateDoc } = require('./shared/firestore');
const { jsonResponse } = require('./shared/utils');

var COLLECTION = 'live-schedule';

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return jsonResponse(204, '');

  var params = event.queryStringParameters || {};
  var sessionId = params.sessionId;
  var secret = params.secret || '';
  var expected = process.env.AI_INTERNAL_SECRET || '';
  var mode = params.mode || 'transcript-only';

  // Auth — reject when secret is not configured (fail closed, not open)
  if (!expected) {
    console.error('[deepgram-webhook] AI_INTERNAL_SECRET not set — rejecting request');
    return jsonResponse(401, { ok: false, error: 'Unauthorized' });
  }
  if (secret !== expected) {
    return jsonResponse(401, { ok: false, error: 'Unauthorized' });
  }

  if (!sessionId) {
    return jsonResponse(400, { ok: false, error: 'sessionId query param required' });
  }

  try {
    // Deepgram POSTs the full transcription result as JSON body
    var body = JSON.parse(event.body || '{}');

    // Extract transcript from Deepgram response
    var transcript = '';
    var channels = body.results && body.results.channels;
    if (channels && channels[0] && channels[0].alternatives && channels[0].alternatives[0]) {
      transcript = channels[0].alternatives[0].transcript || '';
    }

    // Check for Deepgram errors
    if (body.err_code || body.err_msg) {
      console.error('[deepgram-webhook] Deepgram error for session', sessionId, ':', body.err_code, body.err_msg);
      await updateDoc(COLLECTION, sessionId, {
        aiStatus: 'error',
        aiError: 'Deepgram callback error: ' + (body.err_msg || body.err_code || 'unknown')
      });
      return jsonResponse(200, { ok: true, status: 'deepgram_error' });
    }

    var detectedLang = '';
    if (channels && channels[0] && channels[0].detected_language) {
      detectedLang = channels[0].detected_language;
    }

    console.log('[deepgram-webhook] Received transcript for session:', sessionId,
      '— length:', transcript.length, 'chars',
      '— detected language:', detectedLang || 'unknown');

    if (!transcript || transcript.length < 50) {
      await updateDoc(COLLECTION, sessionId, {
        aiStatus: 'no_transcript',
        aiError: 'Deepgram callback: transcript too short (' + transcript.length + ' chars)'
      });
      return jsonResponse(200, { ok: true, status: 'no_transcript', chars: transcript.length });
    }

    // Save transcript
    var updateData = {
      aiTranscript: transcript.substring(0, 50000),
      aiProcessedAt: new Date().toISOString(),
      aiError: null
    };

    if (mode === 'full') {
      // Trigger Claude summary/quiz via reprocess
      updateData.aiStatus = 'transcript_ready';
      await updateDoc(COLLECTION, sessionId, updateData);

      console.log('[deepgram-webhook] Transcript saved, triggering Claude summary for session:', sessionId);

      // Fire-and-forget call to reprocess (uses existing transcript)
      try {
        await triggerReprocess(sessionId);
      } catch (err) {
        console.error('[deepgram-webhook] Failed to trigger reprocess:', err.message);
        // Transcript is saved, admin can manually reprocess
      }

      return jsonResponse(200, {
        ok: true,
        status: 'transcript_saved_claude_triggered',
        sessionId: sessionId,
        transcriptChars: transcript.length
      });
    } else {
      // Transcript-only mode
      updateData.aiStatus = 'transcript_ready';
      await updateDoc(COLLECTION, sessionId, updateData);

      console.log('[deepgram-webhook] Transcript-only mode — saved', transcript.length, 'chars');
      return jsonResponse(200, {
        ok: true,
        status: 'transcript_ready',
        sessionId: sessionId,
        transcriptChars: transcript.length
      });
    }

  } catch (err) {
    console.error('[deepgram-webhook] Error:', err);

    try {
      await updateDoc(COLLECTION, sessionId, {
        aiStatus: 'error',
        aiError: 'Webhook processing error: ' + err.message
      });
    } catch (e) { /* ignore */ }

    return jsonResponse(200, { ok: true, error: err.message });
  }
};

/* ── Trigger reprocess (Claude summary on existing transcript) ── */

function triggerReprocess(sessionId) {
  return new Promise(function (resolve, reject) {
    var secret = process.env.AI_INTERNAL_SECRET || '';
    var url = '/.netlify/functions/ai-backfill?reprocess=' + sessionId + '&secret=' + encodeURIComponent(secret);

    var opts = {
      hostname: 'yogabible.dk',
      path: url,
      method: 'GET',
      timeout: 10000
    };

    var req = https.request(opts, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        console.log('[deepgram-webhook] Reprocess response:', res.statusCode);
        resolve();
      });
    });
    req.on('error', reject);
    req.on('timeout', function () {
      req.destroy();
      resolve(); // Timeout is OK — reprocess runs in the background
    });
    req.end();
  });
}
