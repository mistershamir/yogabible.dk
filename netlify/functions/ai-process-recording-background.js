/**
 * Netlify Background Function: /.netlify/functions/ai-process-recording-background
 *
 * Called internally after a recording's asset is ready (from mux-webhook).
 * The "-background" suffix gives this function a 15-minute timeout (vs 26s).
 *
 * Full pipeline (runs automatically end-to-end):
 *   1. Resolves Mux playback ID for the recording
 *   2. Tries MP4 static renditions → Deepgram transcription (creates temp asset for live recordings)
 *   3. If MP4 not ready in time → sets mp4_pending (admin retries via ai-backfill deepgram-direct)
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
    var directUrl = body.directUrl || null; // Skip Mux MP4 — send this URL straight to Deepgram

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
    var transcript = '';

    var deepgramResult = null;

    if (directUrl) {
      // Direct URL mode: skip all Mux asset creation, send URL straight to Deepgram
      console.log('[ai-process] DIRECT URL mode — skipping Mux MP4, sending to Deepgram:', directUrl);
      await updateDoc(COLLECTION, sessionId, { aiStatus: 'transcribing' });
      deepgramResult = await transcribeWithDeepgram(directUrl);
      transcript = deepgramResult.transcript;
      console.log('[ai-process] Deepgram transcript length:', transcript.length, 'chars, utterances:', deepgramResult.utterances.length);
    } else {
      await updateDoc(COLLECTION, sessionId, { aiStatus: 'preparing_audio' });

      // Primary path: MP4 → Deepgram (creates temp asset for live recordings if needed)
      // If MP4 not ready in time, error propagates to outer catch → sets mp4_pending
      // Admin can then retry via ai-backfill ?deepgram-direct=SESSION_ID
      var mp4Url = await ensureMp4Rendition(assetId, playbackId, sessionId);
      console.log('[ai-process] MP4 ready:', mp4Url);

      await updateDoc(COLLECTION, sessionId, { aiStatus: 'transcribing' });
      console.log('[ai-process] Sending to Deepgram for transcription...');
      deepgramResult = await transcribeWithDeepgram(mp4Url);
      transcript = deepgramResult.transcript;
      console.log('[ai-process] Deepgram transcript length:', transcript.length, 'chars, utterances:', deepgramResult.utterances.length);
    }

    if (!transcript || transcript.length < 50) {
      await updateDoc(COLLECTION, sessionId, { aiStatus: 'no_transcript', aiError: 'Transcript too short (' + (transcript ? transcript.length : 0) + ' chars)' });
      return jsonResponse(200, { ok: true, status: 'no_transcript', chars: transcript ? transcript.length : 0 });
    }

    // ── Upload Deepgram subtitles to Mux (replace auto-generated ones) ──
    if (deepgramResult && deepgramResult.utterances && deepgramResult.utterances.length > 0) {
      try {
        await updateDoc(COLLECTION, sessionId, { aiStatus: 'uploading_subtitles' });
        var vttContent = generateVttFromUtterances(deepgramResult.utterances);
        console.log('[ai-process] Generated VTT:', vttContent.length, 'chars,', deepgramResult.utterances.length, 'cues');

        // Save VTT to Firestore so serve-vtt function can serve it
        // Firestore max doc size is 1MB; VTT for 5hr session ≈ 500KB, safe margin
        if (vttContent.length > 900000) {
          console.log('[ai-process] VTT too large for Firestore (' + vttContent.length + ' chars), truncating');
          // Truncate at last complete cue boundary
          var truncated = vttContent.substring(0, 900000);
          var lastDouble = truncated.lastIndexOf('\n\n');
          if (lastDouble > 0) vttContent = truncated.substring(0, lastDouble + 2);
        }
        await updateDoc(COLLECTION, sessionId, {
          captionVtt: vttContent,
          captionLang: deepgramResult.detectedLang || 'en'
        });

        // Build the VTT URL for Mux to fetch
        // Use canonical domain directly — process.env.URL may include www which 301-redirects,
        // and Mux may not follow redirects when ingesting subtitle tracks
        var vttUrl = 'https://yogabible.dk/.netlify/functions/serve-vtt?session=' + sessionId + '&secret=' + encodeURIComponent(internalSecret);

        var subtitleLang = deepgramResult.detectedLang || 'en';
        var trackId = await replaceSubtitlesOnMux(assetId, vttUrl, subtitleLang);

        await updateDoc(COLLECTION, sessionId, { aiCaptionTrackId: trackId });
        console.log('[ai-process] Subtitles uploaded to Mux successfully, track:', trackId);
      } catch (subErr) {
        // Non-fatal: subtitles failed but we continue with summary
        console.error('[ai-process] Subtitle upload failed (non-fatal):', subErr.message);
        await updateDoc(COLLECTION, sessionId, { aiSubtitleError: subErr.message });
      }
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

// Helper: get ready rendition URL from both old object and new array format
function getReadyRenditionUrl(renditions, pbId) {
  if (!renditions) return null;
  if (Array.isArray(renditions)) {
    var ready = renditions.find(function (r) { return r.status === 'ready'; });
    return ready ? 'https://stream.mux.com/' + pbId + '/' + ready.name : null;
  }
  if (renditions.status === 'ready') {
    return 'https://stream.mux.com/' + pbId + '/low.mp4';
  }
  return null;
}

function getRenditionStatus(renditions) {
  if (!renditions) return 'none';
  if (Array.isArray(renditions)) {
    if (renditions.some(function (r) { return r.status === 'ready'; })) return 'ready';
    if (renditions.some(function (r) { return r.status === 'errored'; })) return 'errored';
    if (renditions.some(function (r) { return r.status === 'preparing'; })) return 'preparing';
    return 'none';
  }
  return renditions.status || 'none';
}

// Strategy: static renditions → master_access download URL
// Mux HLS streams (.m3u8) CANNOT be re-ingested as new assets.
// For live recordings without static renditions, we use master_access instead.

async function ensureMp4Rendition(assetId, playbackId, sessionId) {
  // Step 1: Check if a previous run created a temp asset with ready renditions (backward compat)
  if (sessionId) {
    var sessionDoc = await getDoc(COLLECTION, sessionId);
    if (sessionDoc && sessionDoc.aiTempAssetId) {
      var tempAssetId = sessionDoc.aiTempAssetId;
      var tempPlaybackId = sessionDoc.aiTempPlaybackId || playbackId;
      console.log('[ai-process] Found temp asset from previous run:', tempAssetId);

      try {
        var tempAsset = await muxRequest('GET', '/video/v1/assets/' + tempAssetId);
        var tempRenditions = tempAsset.data && tempAsset.data.static_renditions;
        var readyUrl = getReadyRenditionUrl(tempRenditions, tempPlaybackId);
        if (readyUrl) {
          console.log('[ai-process] Temp asset rendition ready!');
          return readyUrl;
        }
      } catch (e) {
        console.log('[ai-process] Temp asset check failed:', e.message);
      }
      // Clean up temp asset — we'll use master_access instead
      console.log('[ai-process] Temp asset not usable — cleaning up, will use master_access');
      await updateDoc(COLLECTION, sessionId, { aiTempAssetId: null, aiTempPlaybackId: null, aiTempAssetCreatedAt: null });
    }
  }

  // Step 2: Check if original asset already has static renditions
  var asset = await muxRequest('GET', '/video/v1/assets/' + assetId);
  var renditions = asset.data && asset.data.static_renditions;

  var readyUrl = getReadyRenditionUrl(renditions, playbackId);
  if (readyUrl) {
    console.log('[ai-process] Original asset rendition already available');
    return readyUrl;
  }

  // Step 3: Check if master_access already has a download URL
  var master = asset.data && asset.data.master;
  if (master && master.status === 'ready' && master.url) {
    console.log('[ai-process] Master download URL already available');
    return master.url;
  }

  // Step 4: Enable master_access on original asset to get downloadable MP4
  console.log('[ai-process] Enabling master_access on original asset:', assetId);
  var masterResult = await muxRequest('PUT', '/video/v1/assets/' + assetId + '/master-access', {
    master_access: 'temporary'
  });

  var newMaster = masterResult.data && masterResult.data.master;
  if (newMaster && newMaster.status === 'ready' && newMaster.url) {
    console.log('[ai-process] Master URL immediately ready!');
    return newMaster.url;
  }

  if (sessionId) {
    await updateDoc(COLLECTION, sessionId, { aiMasterAccessRequestedAt: new Date().toISOString() });
  }
  console.log('[ai-process] Master access requested, polling for readiness...');

  // Poll for master URL readiness (up to 10 minutes)
  var maxAttempts = 20; // 20 × 30s = 10 minutes
  for (var attempt = 1; attempt <= maxAttempts; attempt++) {
    await sleep(30000);
    asset = await muxRequest('GET', '/video/v1/assets/' + assetId);
    master = asset.data && asset.data.master;
    if (master && master.status === 'ready' && master.url) {
      console.log('[ai-process] Master URL ready after', attempt, 'polls (~' + (attempt * 30) + 's)');
      return master.url;
    }
    if (master && master.status === 'errored') {
      throw new Error('Master access failed on asset ' + assetId);
    }
    if (attempt % 4 === 0) console.log('[ai-process] Master poll', attempt + '/' + maxAttempts, '— status:', master ? master.status : 'none');
  }

  throw new Error('Master download URL not ready after 10 minutes on asset ' + assetId + '. Run retranscribe again to resume.');
}

// ═══════════════════════════════════════════════════
// Deepgram transcription
// ═══════════════════════════════════════════════════

/**
 * Transcribe audio with Deepgram Nova-2.
 * Returns { transcript, utterances } where utterances is an array of
 * { start, end, transcript } objects for VTT subtitle generation.
 */
function transcribeWithDeepgram(audioUrl) {
  var apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) throw new Error('DEEPGRAM_API_KEY env var required');

  return new Promise(function (resolve, reject) {
    var body = JSON.stringify({ url: audioUrl });
    var opts = {
      hostname: 'api.deepgram.com',
      path: '/v1/listen?model=nova-2&detect_language=true&smart_format=true&paragraphs=true&utterances=true&utt_split=0.8',
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
            var alt = channels[0].alternatives[0];
            var utterances = (json.results && json.results.utterances) || [];
            var mappedUtterances = utterances.map(function (u) {
              return { start: u.start, end: u.end, transcript: u.transcript };
            });

            // Fallback: if Deepgram returned no utterances (can happen with long recordings),
            // build synthetic utterances from word-level timestamps (~10s chunks)
            if (mappedUtterances.length === 0 && alt.words && alt.words.length > 0) {
              console.log('[ai-process] No utterances from Deepgram, building from', alt.words.length, 'words');
              mappedUtterances = buildUtterancesFromWords(alt.words);
              console.log('[ai-process] Built', mappedUtterances.length, 'synthetic utterances from words');
            }

            resolve({
              transcript: alt.transcript || '',
              utterances: mappedUtterances,
              detectedLang: (json.results && json.results.channels[0] &&
                json.results.channels[0].detected_language) || null
            });
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
// Build utterances from word-level timestamps (fallback)
// ═══════════════════════════════════════════════════

/**
 * When Deepgram returns words but no utterances (happens with long recordings),
 * chunk words into ~10-second segments to create VTT cues.
 */
function buildUtterancesFromWords(words) {
  var MAX_CHUNK_SECS = 10;
  var utterances = [];
  var chunkWords = [];
  var chunkStart = null;

  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    if (chunkStart === null) chunkStart = w.start;
    chunkWords.push(w.punctuated_word || w.word);

    var chunkDuration = w.end - chunkStart;
    var isLast = i === words.length - 1;

    if (chunkDuration >= MAX_CHUNK_SECS || isLast) {
      utterances.push({
        start: chunkStart,
        end: w.end,
        transcript: chunkWords.join(' ')
      });
      chunkWords = [];
      chunkStart = null;
    }
  }
  return utterances;
}

// ═══════════════════════════════════════════════════
// VTT subtitle generation from Deepgram utterances
// ═══════════════════════════════════════════════════

function formatVttTime(seconds) {
  var h = Math.floor(seconds / 3600);
  var m = Math.floor((seconds % 3600) / 60);
  var s = Math.floor(seconds % 60);
  var ms = Math.round((seconds % 1) * 1000);
  return (h < 10 ? '0' : '') + h + ':' +
         (m < 10 ? '0' : '') + m + ':' +
         (s < 10 ? '0' : '') + s + '.' +
         (ms < 100 ? '0' : '') + (ms < 10 ? '0' : '') + ms;
}

function generateVttFromUtterances(utterances) {
  var lines = ['WEBVTT', ''];
  for (var i = 0; i < utterances.length; i++) {
    var u = utterances[i];
    if (!u.transcript || !u.transcript.trim()) continue;
    lines.push('' + (i + 1));
    lines.push(formatVttTime(u.start) + ' --> ' + formatVttTime(u.end));
    lines.push(u.transcript.trim());
    lines.push('');
  }
  return lines.join('\n');
}

// ═══════════════════════════════════════════════════
// Mux subtitle track management
// ═══════════════════════════════════════════════════

/**
 * Delete all existing subtitle tracks on a Mux asset,
 * then upload a new one from the given URL.
 */
async function replaceSubtitlesOnMux(assetId, vttUrl, langCode) {
  langCode = langCode || 'en';

  // Step 1: Get current tracks and delete subtitles
  try {
    var asset = await muxRequest('GET', '/video/v1/assets/' + assetId);
    var tracks = (asset.data && asset.data.tracks) || [];
    for (var i = 0; i < tracks.length; i++) {
      if (tracks[i].type === 'text' && tracks[i].text_type === 'subtitles') {
        try {
          await muxRequest('DELETE', '/video/v1/assets/' + assetId + '/tracks/' + tracks[i].id);
          console.log('[ai-process] Deleted old subtitle track:', tracks[i].id, '(' + tracks[i].name + ')');
        } catch (e) {
          console.log('[ai-process] Could not delete track', tracks[i].id, ':', e.message);
        }
      }
    }
  } catch (e) {
    console.log('[ai-process] Could not fetch tracks for cleanup:', e.message);
  }

  // Step 2: Add new subtitle track from VTT URL
  var trackName = langCode === 'da' ? 'Dansk' : 'English';
  var result = await muxRequest('POST', '/video/v1/assets/' + assetId + '/tracks', {
    url: vttUrl,
    type: 'text',
    text_type: 'subtitles',
    language_code: langCode,
    name: trackName,
    closed_captions: true
  });

  var trackId = result.data && result.data.id;
  console.log('[ai-process] Uploaded new subtitle track:', trackId, '(' + trackName + ')');
  return trackId;
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
