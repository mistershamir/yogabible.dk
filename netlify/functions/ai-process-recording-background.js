/**
 * Netlify Background Function: /.netlify/functions/ai-process-recording-background
 *
 * Called internally after a recording's asset is ready (from mux-webhook).
 * The "-background" suffix gives this function a 15-minute timeout (vs 26s).
 *
 * Full pipeline (runs automatically end-to-end):
 *   1. Resolves Mux playback ID for the recording
 *   2. Tries MP4 static renditions → Deepgram transcription (primary path)
 *   3. Falls back to Mux auto-generated subtitles → VTT parsing (if MP4 unavailable)
 *   4. Sends transcript to Claude for summary + quiz generation
 *   5. Saves results to Firestore
 *
 * Env vars required:
 *   MUX_TOKEN_ID, MUX_TOKEN_SECRET — Mux API credentials
 *   DEEPGRAM_API_KEY — Deepgram transcription API key
 *   ANTHROPIC_API_KEY — Claude API key
 */

const https = require('https');
const { getDoc, updateDoc } = require('./shared/firestore');
const { jsonResponse } = require('./shared/utils');

var COLLECTION = 'live-schedule';

// ═══════════════════════════════════════════════════
// Entry point
// ═══════════════════════════════════════════════════

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(204, '');
  }

  try {
    var body = JSON.parse(event.body || '{}');
    var sessionId = body.sessionId;
    var assetId = body.assetId;
    var playbackId = body.playbackId || null;
    var transcriptOnly = body.transcriptOnly === true;

    if (!sessionId || !assetId) {
      return jsonResponse(400, { ok: false, error: 'sessionId and assetId required' });
    }

    // Verify internal call
    var internalSecret = process.env.AI_INTERNAL_SECRET || '';
    var providedSecret = body.secret || '';
    if (internalSecret && providedSecret !== internalSecret) {
      return jsonResponse(401, { ok: false, error: 'Unauthorized' });
    }

    console.log('[ai-process] Starting full pipeline for session:', sessionId, 'asset:', assetId);

    // Mark processing started
    await updateDoc(COLLECTION, sessionId, { aiStatus: 'processing' });

    // ── Step 1: Resolve playback ID ──
    if (!playbackId) {
      var session = await getDoc(COLLECTION, sessionId);
      playbackId = session && session.recordingPlaybackId;
    }
    if (!playbackId) {
      var assetInfo = await muxRequest('GET', '/video/v1/assets/' + assetId);
      var pbIds = (assetInfo.data && assetInfo.data.playback_ids) || [];
      for (var p = 0; p < pbIds.length; p++) {
        if (pbIds[p].policy === 'public') { playbackId = pbIds[p].id; break; }
      }
      if (!playbackId && pbIds.length) playbackId = pbIds[0].id;
    }
    if (!playbackId) {
      await updateDoc(COLLECTION, sessionId, { aiStatus: 'error', aiError: 'No playback ID found' });
      return jsonResponse(200, { ok: true, status: 'no_playback_id' });
    }

    // ── Step 2+3: Transcribe via MP4+Deepgram, falling back to Mux subtitles ──
    await updateDoc(COLLECTION, sessionId, { aiStatus: 'preparing_audio' });
    var transcript = '';

    try {
      // Primary path: MP4 → Deepgram (creates temp asset for live recordings if needed)
      var mp4Url = await ensureMp4Rendition(assetId, playbackId, sessionId);
      console.log('[ai-process] MP4 ready:', mp4Url);

      await updateDoc(COLLECTION, sessionId, { aiStatus: 'transcribing' });
      console.log('[ai-process] Sending to Deepgram for transcription...');
      transcript = await transcribeWithDeepgram(mp4Url);
      console.log('[ai-process] Deepgram transcript length:', transcript.length, 'chars');
    } catch (mp4Err) {
      // Fallback: Mux auto-generated subtitles → VTT → plain text
      console.log('[ai-process] MP4/Deepgram failed:', mp4Err.message, '— trying Mux subtitles fallback');
      await updateDoc(COLLECTION, sessionId, {
        aiStatus: 'subtitle_fallback',
        aiDeepgramError: mp4Err.message,
        aiDeepgramFailedAt: new Date().toISOString()
      });
      transcript = await transcribeViaMuxSubtitles(assetId, playbackId, sessionId);
      console.log('[ai-process] Mux subtitle transcript length:', transcript.length, 'chars');
    }

    if (!transcript || transcript.length < 50) {
      await updateDoc(COLLECTION, sessionId, { aiStatus: 'no_transcript', aiError: 'Transcript too short (' + (transcript ? transcript.length : 0) + ' chars)' });
      return jsonResponse(200, { ok: true, status: 'no_transcript', chars: transcript ? transcript.length : 0 });
    }

    // ── Transcript-only mode: save transcript and stop (skip Claude) ──
    if (transcriptOnly) {
      await updateDoc(COLLECTION, sessionId, {
        aiStatus: 'transcript_ready',
        aiTranscript: transcript.substring(0, 50000),
        aiProcessedAt: new Date().toISOString(),
        aiError: null
      });
      console.log('[ai-process] Transcript-only mode — saved', transcript.length, 'chars, stopping before Claude');
      return jsonResponse(200, {
        ok: true,
        status: 'transcript_ready',
        sessionId: sessionId,
        transcriptChars: transcript.length,
        transcriptPreview: transcript.substring(0, 500)
      });
    }

    // ── Step 4: Send to Claude for summary + quiz ──
    await updateDoc(COLLECTION, sessionId, { aiStatus: 'generating_summary' });

    var session = await getDoc(COLLECTION, sessionId);
    var sessionTitle = (session && (session.title_da || session.title_en)) || 'Yoga Class';
    var sessionInstructor = (session && session.instructor) || '';

    console.log('[ai-process] Sending to Claude for summary + quiz...');
    var aiResult = await generateSummaryAndQuiz(transcript, sessionTitle, sessionInstructor);

    // ── Step 5: Save results ──
    await updateDoc(COLLECTION, sessionId, {
      aiStatus: 'complete',
      aiTranscript: transcript.substring(0, 50000),
      aiSummary: aiResult.summary || '',
      aiSummaryLang: aiResult.lang || 'da',
      aiQuiz: JSON.stringify(aiResult.quiz || []),
      aiProcessedAt: new Date().toISOString(),
      aiError: null
    });

    console.log('[ai-process] Complete! Session:', sessionId, 'Lang:', aiResult.lang);

    return jsonResponse(200, {
      ok: true,
      status: 'complete',
      sessionId: sessionId,
      lang: aiResult.lang
    });

  } catch (err) {
    console.error('[ai-process] Error:', err);

    try {
      var errorBody = JSON.parse(event.body || '{}');
      if (errorBody.sessionId) {
        // For long recordings where temp asset needs more time, use a retryable status
        var isPending = err.message && (err.message.indexOf('not ready yet') !== -1 || err.message.indexOf('subtitles not ready') !== -1);
        await updateDoc(COLLECTION, errorBody.sessionId, {
          aiStatus: isPending ? 'mp4_pending' : 'error',
          aiError: err.message
        });
      }
    } catch (e) { /* ignore */ }

    return jsonResponse(200, { ok: true, error: err.message });
  }
};

// ═══════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function muxRequest(method, path, body) {
  var tokenId = process.env.MUX_TOKEN_ID;
  var tokenSecret = process.env.MUX_TOKEN_SECRET;
  if (!tokenId || !tokenSecret) {
    throw new Error('MUX_TOKEN_ID and MUX_TOKEN_SECRET env vars required');
  }

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
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            var err = new Error('Mux API error: ' + res.statusCode + ' ' + raw.substring(0, 200));
            err.status = res.statusCode;
            reject(err);
          }
        } catch (e) {
          reject(new Error('Mux API parse error: ' + raw.substring(0, 200)));
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function ensureMp4Rendition(assetId, playbackId, sessionId) {
  // Step 1: Check if a previous run created a temp asset with MP4 (for live recordings)
  if (sessionId) {
    var sessionDoc = await getDoc(COLLECTION, sessionId);
    if (sessionDoc && sessionDoc.aiTempAssetId) {
      var tempAssetId = sessionDoc.aiTempAssetId;
      var tempPlaybackId = sessionDoc.aiTempPlaybackId || playbackId;
      console.log('[ai-process] Found temp asset from previous run:', tempAssetId);

      var tempAsset = await muxRequest('GET', '/video/v1/assets/' + tempAssetId);
      var tempRenditions = tempAsset.data && tempAsset.data.static_renditions;

      if (tempRenditions && tempRenditions.status === 'ready') {
        console.log('[ai-process] Temp asset MP4 ready! Using it for Deepgram');
        return 'https://stream.mux.com/' + tempPlaybackId + '/low.mp4';
      }
      if (tempRenditions && tempRenditions.status === 'errored') {
        console.log('[ai-process] Temp asset MP4 errored — will create a new one');
      } else {
        // Still preparing — poll for up to 10 minutes
        console.log('[ai-process] Temp asset MP4 still preparing, polling...');
        var maxPoll = 20; // 20 × 30s = 10 minutes
        for (var pa = 1; pa <= maxPoll; pa++) {
          await sleep(30000);
          tempAsset = await muxRequest('GET', '/video/v1/assets/' + tempAssetId);
          tempRenditions = tempAsset.data && tempAsset.data.static_renditions;
          if (tempRenditions && tempRenditions.status === 'ready') {
            console.log('[ai-process] Temp asset MP4 ready after', pa, 'polls');
            return 'https://stream.mux.com/' + tempPlaybackId + '/low.mp4';
          }
          if (tempRenditions && tempRenditions.status === 'errored') {
            console.log('[ai-process] Temp asset MP4 errored after', pa, 'polls');
            break;
          }
          var tempStatus = tempAsset.data && tempAsset.data.status;
          if (tempStatus === 'errored') {
            console.log('[ai-process] Temp asset ingestion errored');
            break;
          }
          if (pa % 4 === 0) console.log('[ai-process] Temp MP4 poll', pa + '/' + maxPoll, '— renditions:', tempRenditions ? tempRenditions.status : 'none', 'asset:', tempStatus);
        }
        // If still not ready, throw so caller can save status and exit
        if (!tempRenditions || tempRenditions.status !== 'ready') {
          throw new Error('Temp asset MP4 not ready yet (asset ' + tempAssetId + '). Run retranscribe again to resume.');
        }
      }
    }
  }

  // Step 2: Check if MP4 renditions already exist on original asset
  var asset = await muxRequest('GET', '/video/v1/assets/' + assetId);
  var renditions = asset.data && asset.data.static_renditions;

  if (renditions && renditions.status === 'ready') {
    console.log('[ai-process] MP4 renditions already available');
    return 'https://stream.mux.com/' + playbackId + '/low.mp4';
  }

  // Step 3: Try to enable MP4 support on the original asset
  console.log('[ai-process] Enabling MP4 support on asset:', assetId);
  try {
    var patchResult = await muxRequest('PATCH', '/video/v1/assets/' + assetId, { mp4_support: 'capped-1080p' });
    var patchedMp4 = patchResult.data && patchResult.data.mp4_support;

    if (patchedMp4 === 'none' || !patchedMp4) {
      // Live stream recordings can't have MP4 enabled on the original asset.
      // Create a NEW temp asset from HLS with MP4 support for Deepgram.
      console.log('[ai-process] MP4 unavailable on original (live recording) — creating temp asset with MP4...');
      var hlsUrl = 'https://stream.mux.com/' + playbackId + '.m3u8';
      var newAsset = await muxRequest('POST', '/video/v1/assets', {
        input: [{ url: hlsUrl }],
        playback_policy: ['public'],
        mp4_support: 'capped-1080p',
        encoding_tier: 'baseline'
      });

      var newAssetId = newAsset.data.id;
      var newPbIds = newAsset.data.playback_ids || [];
      var newPlaybackId = newPbIds.length > 0 ? newPbIds[0].id : playbackId;

      // Save temp asset so retries can resume
      if (sessionId) {
        await updateDoc(COLLECTION, sessionId, {
          aiTempAssetId: newAssetId,
          aiTempPlaybackId: newPlaybackId
        });
      }
      console.log('[ai-process] Temp asset created:', newAssetId, '— polling for MP4...');

      // Poll for MP4 readiness (up to 10 min — ingestion + rendering for long recordings)
      var maxAttempts2 = 20; // 20 × 30s = 10 minutes
      for (var attempt2 = 1; attempt2 <= maxAttempts2; attempt2++) {
        await sleep(30000);
        var tempCheck = await muxRequest('GET', '/video/v1/assets/' + newAssetId);
        var tempRend = tempCheck.data && tempCheck.data.static_renditions;
        if (tempRend && tempRend.status === 'ready') {
          console.log('[ai-process] Temp asset MP4 ready after', attempt2, 'polls');
          return 'https://stream.mux.com/' + newPlaybackId + '/low.mp4';
        }
        if (tempRend && tempRend.status === 'errored') {
          throw new Error('Temp asset MP4 rendition failed');
        }
        var assetSt = tempCheck.data && tempCheck.data.status;
        if (assetSt === 'errored') {
          throw new Error('Temp asset ingestion errored');
        }
        if (attempt2 % 4 === 0) console.log('[ai-process] Temp MP4 poll', attempt2 + '/' + maxAttempts2, '— renditions:', tempRend ? tempRend.status : 'none', 'asset:', assetSt);
      }

      // Not ready in time — for 5+ hour recordings, ingestion can take 20+ min.
      // Save state so retranscribe can resume from this temp asset.
      throw new Error('Temp asset MP4 not ready yet (asset ' + newAssetId + '). Run retranscribe again to resume.');
    }

    console.log('[ai-process] MP4 support enabled (' + patchedMp4 + '), polling for readiness...');

    // Poll original asset for MP4 (up to 10 minutes)
    var maxAttempts = 20; // 20 × 30s = 10 minutes
    var pollInterval = 30000;

    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
      await sleep(pollInterval);
      asset = await muxRequest('GET', '/video/v1/assets/' + assetId);
      renditions = asset.data && asset.data.static_renditions;
      if (renditions && renditions.status === 'ready') {
        console.log('[ai-process] MP4 renditions ready after', attempt, 'polls (~' + (attempt * 30) + 's)');
        return 'https://stream.mux.com/' + playbackId + '/low.mp4';
      }
      if (renditions && renditions.status === 'errored') {
        throw new Error('MP4 rendition creation failed on Mux');
      }
      console.log('[ai-process] MP4 poll', attempt + '/' + maxAttempts, '— status:', renditions ? renditions.status : 'none');
    }

    throw new Error('MP4 renditions not ready after 10 minutes. Run retranscribe again to resume.');
  } catch (patchErr) {
    throw patchErr;
  }
}

// ═══════════════════════════════════════════════════
// Mux subtitle fallback transcription
// ═══════════════════════════════════════════════════

async function transcribeViaMuxSubtitles(assetId, playbackId, sessionId) {
  // Step 1: Check if a previous run already created a temp asset (saved in Firestore)
  var subtitleAssetId = assetId;
  var subtitlePlaybackId = playbackId;
  var createdTempAsset = false;

  if (sessionId) {
    var sessionDoc = await getDoc(COLLECTION, sessionId);
    if (sessionDoc && sessionDoc.aiTempAssetId) {
      subtitleAssetId = sessionDoc.aiTempAssetId;
      subtitlePlaybackId = sessionDoc.aiTempPlaybackId || playbackId;
      console.log('[ai-process] Resuming with previously created temp asset:', subtitleAssetId);
    }
  }

  // Step 2: Check if subtitles already exist on the target asset
  var asset = await muxRequest('GET', '/video/v1/assets/' + subtitleAssetId);
  var tracks = (asset.data && asset.data.tracks) || [];
  var readyTrack = null;

  for (var t = 0; t < tracks.length; t++) {
    if (tracks[t].type === 'text' && tracks[t].text_type === 'subtitles' && tracks[t].status === 'ready') {
      readyTrack = tracks[t];
      break;
    }
  }

  // Step 3: If no ready subtitles, try generate-subtitles on the original asset first
  if (!readyTrack) {
    // Only try generate-subtitles on the ORIGINAL asset (not if we already have a temp asset)
    if (subtitleAssetId === assetId) {
      var audioTrackId = null;
      for (var at = 0; at < tracks.length; at++) {
        if (tracks[at].type === 'audio') {
          audioTrackId = tracks[at].id;
          break;
        }
      }
      if (!audioTrackId) {
        throw new Error('No audio track found on asset ' + assetId);
      }

      try {
        console.log('[ai-process] Requesting Mux auto-generated subtitles for asset:', assetId, 'audio track:', audioTrackId);
        await muxRequest('POST', '/video/v1/assets/' + assetId + '/tracks/' + audioTrackId + '/generate-subtitles', {
          generated_subtitles: [{
            language_code: 'en',
            name: 'English CC'
          }]
        });
        console.log('[ai-process] Subtitle generation requested on original asset — polling...');
      } catch (genErr) {
        // Live stream recording assets often have empty input URLs, causing generate-subtitles to fail.
        // Fallback: create a NEW temporary asset from the HLS URL with subtitles baked into creation.
        console.log('[ai-process] generate-subtitles failed on original asset:', genErr.message);
        console.log('[ai-process] Creating temporary asset from HLS URL for subtitle generation...');

        var hlsUrl = 'https://stream.mux.com/' + playbackId + '.m3u8';
        var newAsset = await muxRequest('POST', '/video/v1/assets', {
          input: [{
            url: hlsUrl,
            generated_subtitles: [{
              language_code: 'en',
              name: 'English CC'
            }]
          }],
          playback_policy: ['public'],
          encoding_tier: 'baseline'
        });

        subtitleAssetId = newAsset.data.id;
        var newPlaybackIds = newAsset.data.playback_ids || [];
        subtitlePlaybackId = newPlaybackIds.length > 0 ? newPlaybackIds[0].id : playbackId;
        createdTempAsset = true;

        // Save temp asset ID to Firestore so retries can resume without creating another
        if (sessionId) {
          await updateDoc(COLLECTION, sessionId, {
            aiTempAssetId: subtitleAssetId,
            aiTempPlaybackId: subtitlePlaybackId
          });
        }
        console.log('[ai-process] Temporary asset created and saved:', subtitleAssetId, 'playback:', subtitlePlaybackId);
      }
    } else {
      console.log('[ai-process] Using existing temp asset:', subtitleAssetId, '— checking subtitle status...');
    }

    // Poll until subtitles are ready (up to 12 minutes — temp asset needs to ingest first)
    var maxAttempts = 24; // 24 × 30s = 12 minutes
    var pollInterval = 30000;

    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
      await sleep(pollInterval);

      asset = await muxRequest('GET', '/video/v1/assets/' + subtitleAssetId);
      tracks = (asset.data && asset.data.tracks) || [];

      for (var t2 = 0; t2 < tracks.length; t2++) {
        if (tracks[t2].type === 'text' && tracks[t2].text_type === 'subtitles') {
          if (tracks[t2].status === 'ready') {
            readyTrack = tracks[t2];
            break;
          }
          if (tracks[t2].status === 'errored') {
            throw new Error('Mux subtitle generation failed for track ' + tracks[t2].id);
          }
          console.log('[ai-process] Subtitle poll', attempt + '/' + maxAttempts, '— status:', tracks[t2].status);
          break;
        }
      }
      if (readyTrack) break;

      // Also check if the asset itself is still preparing (temp asset needs ingestion time)
      var assetStatus = asset.data && asset.data.status;
      if (assetStatus === 'errored') {
        throw new Error('Mux asset errored during ingestion');
      }
      if (attempt % 4 === 0) {
        console.log('[ai-process] Asset status:', assetStatus, '— still waiting for subtitles...');
      }
    }

    if (!readyTrack) {
      throw new Error('Mux subtitles not ready after 12 minutes — temp asset ' + subtitleAssetId + ' may still be processing. Retry with retranscribe to resume.');
    }
  }

  console.log('[ai-process] Subtitles ready, downloading VTT...');

  // Step 4: Download VTT file
  var vttUrl = 'https://stream.mux.com/' + subtitlePlaybackId + '/text/' + readyTrack.id + '.vtt';
  var vttContent = await fetchUrl(vttUrl);

  // Step 4: Parse VTT to plain text (strip timestamps and formatting)
  var lines = vttContent.split('\n');
  var textParts = [];
  for (var l = 0; l < lines.length; l++) {
    var line = lines[l].trim();
    // Skip WEBVTT header, empty lines, timestamps (contain -->), and numeric cue IDs
    if (!line || line === 'WEBVTT' || line.indexOf('-->') !== -1 || /^\d+$/.test(line) || line.indexOf('NOTE') === 0) {
      continue;
    }
    // Strip HTML tags from cue text
    line = line.replace(/<[^>]+>/g, '');
    if (line) textParts.push(line);
  }

  var transcript = textParts.join(' ');
  if (!transcript || transcript.length < 50) {
    throw new Error('Mux subtitles produced empty/short transcript (' + transcript.length + ' chars)');
  }

  return transcript;
}

function fetchUrl(url) {
  return new Promise(function (resolve, reject) {
    var parsedUrl = new URL(url);
    var opts = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET'
    };

    var req = https.request(opts, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        fetchUrl(res.headers.location).then(resolve).catch(reject);
        return;
      }
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(Buffer.concat(chunks).toString());
        } else {
          reject(new Error('Fetch ' + url + ' failed: HTTP ' + res.statusCode));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, function () {
      req.destroy();
      reject(new Error('Fetch timeout: ' + url));
    });
    req.end();
  });
}

// ═══════════════════════════════════════════════════
// Deepgram transcription
// ═══════════════════════════════════════════════════

function transcribeWithDeepgram(audioUrl) {
  var apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) throw new Error('DEEPGRAM_API_KEY env var required');

  return new Promise(function (resolve, reject) {
    var body = JSON.stringify({ url: audioUrl });
    var opts = {
      hostname: 'api.deepgram.com',
      path: '/v1/listen?model=nova-2&detect_language=true&smart_format=true&paragraphs=true',
      method: 'POST',
      headers: {
        'Authorization': 'Token ' + apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    var req = https.request(opts, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var raw = Buffer.concat(chunks).toString();
        try {
          var json = JSON.parse(raw);
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error('Deepgram API error ' + res.statusCode + ': ' + raw.substring(0, 300)));
            return;
          }
          var channels = json.results && json.results.channels;
          if (channels && channels[0] && channels[0].alternatives && channels[0].alternatives[0]) {
            resolve(channels[0].alternatives[0].transcript || '');
          } else {
            reject(new Error('Deepgram: no transcript in response: ' + raw.substring(0, 300)));
          }
        } catch (e) {
          reject(new Error('Deepgram parse error: ' + raw.substring(0, 300)));
        }
      });
    });

    // 12-minute timeout for very long recordings (5+ hours). Deepgram processes
    // at ~100x real-time but HLS URLs may need extra download time.
    req.setTimeout(720000, function () {
      req.destroy();
      reject(new Error('Deepgram request timed out after 12 minutes'));
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ═══════════════════════════════════════════════════
// Claude API — summary + quiz generation
// ═══════════════════════════════════════════════════

function claudeRequest(messages, systemPrompt) {
  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY env var required');

  return new Promise(function (resolve, reject) {
    var body = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: systemPrompt,
      messages: messages
    });

    var opts = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    var req = https.request(opts, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var raw = Buffer.concat(chunks).toString();
        try {
          var json = JSON.parse(raw);
          if (json.content && json.content[0]) {
            resolve(json.content[0].text);
          } else {
            reject(new Error('Claude API unexpected: ' + raw.substring(0, 300)));
          }
        } catch (e) {
          reject(new Error('Claude API parse error: ' + raw.substring(0, 300)));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function generateSummaryAndQuiz(transcript, title, instructor, forceLang) {
  var daWords = ['og', 'til', 'din', 'det', 'som', 'har', 'den', 'ikke', 'kan', 'skal', 'godt', 'pust', 'ånd', 'stræk', 'krop', 'ben', 'arme', 'ryg', 'vi', 'jer', 'dig', 'ser', 'ned', 'op', 'er', 'en', 'et', 'jeg', 'nu', 'lige', 'også', 'så', 'bare', 'igen', 'lidt', 'helt', 'venstre', 'højre'];
  var enWords = ['the', 'and', 'your', 'you', 'that', 'this', 'have', 'not', 'breathe', 'stretch', 'body', 'arms', 'legs', 'inhale', 'exhale', 'is', 'are', 'we', 'go', 'into', 'let', 'just', 'now', 'right', 'left', 'down', 'up', 'here', 'feel', 'bring', 'keep', 'through', 'then', 'going', 'want', 'make', 'take', 'come'];

  var words = transcript.toLowerCase().split(/\s+/).slice(0, 500);
  var daScore = 0, enScore = 0;
  for (var i = 0; i < words.length; i++) {
    if (daWords.indexOf(words[i]) !== -1) daScore++;
    if (enWords.indexOf(words[i]) !== -1) enScore++;
  }
  var lang = forceLang || (daScore > enScore ? 'da' : 'en');
  console.log('[ai-process] Language detection — DA:', daScore, 'EN:', enScore, '→', lang);

  var systemPrompt = lang === 'da'
    ? 'Du er en erfaren yogauddannelsesekspert med dyb viden om yogafilosofi, anatomi, undervisningsmetodik, pranayama, asana-alignment og sekventering. '
      + 'Du hjælper yogalærerstuderende med at lære ved at lave præcise opsummeringer og meningsfulde quizzer af optagede undervisningssessioner. '
      + 'Svar KUN på dansk. Svar i valid JSON.'
    : 'You are an experienced yoga teacher training expert with deep knowledge of yoga philosophy, anatomy, teaching methodology, pranayama, asana alignment, and sequencing. '
      + 'You help yoga teacher trainees learn by creating precise summaries and meaningful quizzes from recorded training sessions. '
      + 'Respond ONLY in English. Respond in valid JSON.';

  var focusInstructions = lang === 'da'
    ? '\n\nVIGTIGT — Indholdsprioritering:\n'
      + 'Disse optagelser er fra et yogalæreruddannelsesprogram (ofte 3-4 timer lange). '
      + 'Du SKAL fokusere på det fagligt relevante indhold og IGNORERE alt irrelevant.\n\n'
      + 'FOKUSÉR PÅ (høj prioritet):\n'
      + '- Yoga-teknikker, asanas, alignment cues og fysiske instruktioner\n'
      + '- Pranayama (åndedrætsteknikker) og meditation\n'
      + '- Yogafilosofi, sutraer, yamas, niyamas, chakraer\n'
      + '- Anatomi og fysiologi relateret til yogapraksis\n'
      + '- Undervisningsmetodik: hvordan man guider elever, cue-teknikker, sekventering\n'
      + '- Justeringer (adjustments/assists) og sikkerhed\n'
      + '- Yogastilarter og deres forskelle (vinyasa, yin, hot yoga, hatha osv.)\n'
      + '- Professionelle aspekter: klassestruktur, musikvalg, rumopsætning, forretning\n\n'
      + 'IGNORÉR HELT (medtag ALDRIG i summary eller quiz):\n'
      + '- Personlige introduktioner, baghistorier og anekdoter om underviseren\n'
      + '- Logistik: pauser, skemaer, madbestillinger, praktiske detaljer\n'
      + '- Small talk, jokes, og uformel samtale mellem deltagere\n'
      + '- Navne og personlige detaljer om underviseren eller studerende\n'
      + '- Tekniske problemer med lyd, kamera eller streaming\n'
      + '- Trivia om underviseren (fx antal studier, rejser, personlig historik)\n'
    : '\n\nIMPORTANT — Content Prioritization:\n'
      + 'These recordings are from a yoga teacher training program (often 3-4 hours long). '
      + 'You MUST focus on professionally relevant content and IGNORE everything irrelevant.\n\n'
      + 'FOCUS ON (high priority):\n'
      + '- Yoga techniques, asanas, alignment cues, and physical instructions\n'
      + '- Pranayama (breathing techniques) and meditation\n'
      + '- Yoga philosophy, sutras, yamas, niyamas, chakras\n'
      + '- Anatomy and physiology related to yoga practice\n'
      + '- Teaching methodology: how to guide students, cueing techniques, sequencing\n'
      + '- Adjustments/assists and safety considerations\n'
      + '- Yoga styles and their differences (vinyasa, yin, hot yoga, hatha, etc.)\n'
      + '- Professional aspects: class structure, music selection, room setup, business\n\n'
      + 'COMPLETELY IGNORE (NEVER include in summary or quiz):\n'
      + '- Personal introductions, backstories, and anecdotes about the instructor\n'
      + '- Logistics: breaks, schedules, food orders, practical arrangements\n'
      + '- Small talk, jokes, and casual conversation between participants\n'
      + '- Names and personal details about the instructor or students\n'
      + '- Technical issues with audio, camera, or streaming\n'
      + '- Trivia about the instructor (e.g., how many studios they own, travel history)\n';

  var userPrompt = lang === 'da'
    ? 'Her er en transskription af en yogalæreruddannelsessession'
      + (title ? ' med titlen "' + title + '"' : '')
      + (instructor ? ' undervist af ' + instructor : '')
      + '.'
      + focusInstructions
      + '\nTransskription:\n' + transcript.substring(0, 30000)
      + '\n\nGenerer et JSON-objekt med:\n'
      + '1. "summary": En struktureret opsummering af sessionens FAGLIGE indhold (3-5 afsnit). '
      + 'Organisér efter emner/temaer der blev dækket. '
      + 'Fremhæv de vigtigste læringspointer for en yogalærerstuderende. '
      + 'Brug HTML: <h3> for emneoverskrifter, <p> for afsnit, <ul><li> for nøglepunkter, <strong> for vigtige begreber.\n'
      + '2. "quiz": Et array med 8-12 spørgsmål der tester FAGLIG forståelse. Spørgsmålene skal hjælpe studerende med at huske og forstå det vigtigste fra sessionen. Mix af:\n'
      + '   - Teknik-spørgsmål (alignment, cues, variationer)\n'
      + '   - Filosofi-spørgsmål (hvis relevant)\n'
      + '   - Anatomi-spørgsmål (hvis relevant)\n'
      + '   - Undervisningsmetodik-spørgsmål\n'
      + '   Hvert spørgsmål:\n'
      + '   - "question": Spørgsmålstekst\n'
      + '   - "type": "multiple" eller "truefalse"\n'
      + '   - "options": Array af svarmuligheder (4 for multiple choice)\n'
      + '   - "correct": Index af korrekt svar (0-baseret)\n'
      + '   - "explanation": Kort forklaring der uddyber det korrekte svar og styrker læringen\n\n'
      + 'Svar KUN med det rå JSON-objekt.'
    : 'Here is a transcript of a yoga teacher training session'
      + (title ? ' titled "' + title + '"' : '')
      + (instructor ? ' taught by ' + instructor : '')
      + '.'
      + focusInstructions
      + '\nTranscript:\n' + transcript.substring(0, 30000)
      + '\n\nGenerate a JSON object with:\n'
      + '1. "summary": A structured summary of the session\'s EDUCATIONAL content (3-5 paragraphs). '
      + 'Organize by topics/themes covered. '
      + 'Highlight the most important learning points for a yoga teacher trainee. '
      + 'Use HTML: <h3> for topic headings, <p> for paragraphs, <ul><li> for key points, <strong> for important concepts.\n'
      + '2. "quiz": Array of 8-12 questions testing PROFESSIONAL understanding. Questions should help trainees retain and understand the most important content from the session. Mix of:\n'
      + '   - Technique questions (alignment, cues, variations)\n'
      + '   - Philosophy questions (if covered)\n'
      + '   - Anatomy questions (if covered)\n'
      + '   - Teaching methodology questions\n'
      + '   Each question:\n'
      + '   - "question": Question text\n'
      + '   - "type": "multiple" or "truefalse"\n'
      + '   - "options": Array of answer options (4 for multiple choice)\n'
      + '   - "correct": Index of correct answer (0-based)\n'
      + '   - "explanation": Brief explanation that reinforces the learning\n\n'
      + 'Respond ONLY with the raw JSON object.';

  return claudeRequest([{ role: 'user', content: userPrompt }], systemPrompt)
    .then(function (response) {
      var cleaned = response.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
      var parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch (e) {
        console.error('[ai-process] Failed to parse Claude response:', response.substring(0, 500));
        parsed = { summary: '', quiz: [] };
      }
      return { summary: parsed.summary || '', quiz: parsed.quiz || [], lang: lang };
    });
}
