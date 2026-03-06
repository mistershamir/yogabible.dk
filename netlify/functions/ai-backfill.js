/**
 * Netlify Function: /.netlify/functions/ai-backfill
 *
 * Modes:
 *   ?debug=1    — Show status of all sessions (read-only)
 *   ?reconcile=1 — Find missing recordings from Mux and link them to Firestore sessions
 *   ?check=1    — Phase 2: check if Mux captions are ready, download transcript, run Claude
 *   (default)   — Phase 1: trigger caption requests for sessions with recordings but no AI data
 *
 * All modes require: ?secret=YOUR_AI_INTERNAL_SECRET
 */

const https = require('https');
const { getCollection, updateDoc } = require('./shared/firestore');
const { jsonResponse } = require('./shared/utils');

var COLLECTION = 'live-schedule';

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return jsonResponse(204, '');

  var params = event.queryStringParameters || {};

  // Auth check
  var secret = params.secret || '';
  var expected = process.env.AI_INTERNAL_SECRET || '';
  if (expected && secret !== expected) {
    return jsonResponse(401, { ok: false, error: 'Invalid secret' });
  }

  try {
    var all = await getCollection(COLLECTION, { orderBy: 'startDateTime', orderDir: 'desc' });

    // ── Debug mode ──
    if (params.debug === '1') {
      return jsonResponse(200, {
        ok: true,
        total: all.length,
        sessions: all.map(function (item) {
          return {
            id: item.id,
            title: item.title_da || item.title_en || '',
            status: item.status,
            hasRecording: !!item.recordingAssetId,
            recordingAssetId: item.recordingAssetId || null,
            recordingPlaybackId: item.recordingPlaybackId || null,
            muxLiveStreamId: item.muxLiveStreamId || null,
            aiStatus: item.aiStatus || null
          };
        })
      });
    }

    // ── Manual link mode: write correct playback IDs directly, then look up asset IDs ──
    if (params.link === '1') {
      var manualLinks = [
        { sessionId: 'fKCXgCU2FwyXWk8UCF1R', playbackId: '00YsBLE8nu5vkFSJyWawE2WdCIRYOEEjFeh87Xe6C3BU' },
        { sessionId: 'YYDqECjSRemeb9dTRbPK', playbackId: 'CIvPqI2JYzAW4vGM9WWxkk00FAZAVt5Gpnax1LobgsmQ' }
      ];

      var linkResults = [];
      for (var m = 0; m < manualLinks.length; m++) {
        var link = manualLinks[m];
        try {
          // Look up the asset ID from the playback ID via Mux API
          var pbResult = await muxRequest('GET', '/video/v1/playback-ids/' + link.playbackId);
          var assetId = pbResult.data && pbResult.data.object ? pbResult.data.object.id : null;

          var updateData = { recordingPlaybackId: link.playbackId };
          if (assetId) updateData.recordingAssetId = assetId;

          await updateDoc(COLLECTION, link.sessionId, updateData);
          linkResults.push({
            sessionId: link.sessionId,
            playbackId: link.playbackId,
            assetId: assetId || 'not_found',
            status: 'linked'
          });
          console.log('[ai-backfill] Linked', link.sessionId, '→ playback:', link.playbackId, 'asset:', assetId);
        } catch (err) {
          // Even if Mux lookup fails, still write the playback ID
          try {
            await updateDoc(COLLECTION, link.sessionId, { recordingPlaybackId: link.playbackId });
          } catch (e) { /* ignore */ }
          linkResults.push({ sessionId: link.sessionId, playbackId: link.playbackId, status: 'partial', error: err.message });
        }
      }

      return jsonResponse(200, {
        ok: true,
        message: 'Manual linking complete.',
        results: linkResults
      });
    }

    // ── Fix mode: look up correct asset IDs from playback IDs via Mux API ──
    // Use this when recordingPlaybackId is correct but recordingAssetId is corrupted
    if (params.fix === '1') {
      var fixable = all.filter(function (item) {
        return item.status === 'ended' && item.recordingPlaybackId;
      });

      if (fixable.length === 0) {
        return jsonResponse(200, { ok: true, message: 'No ended sessions with recordingPlaybackId found' });
      }

      console.log('[ai-backfill] Fixing', fixable.length, 'sessions — looking up asset IDs from playback IDs');
      var fixResults = [];

      for (var f = 0; f < fixable.length; f++) {
        var sess = fixable[f];
        try {
          // Use Mux playback-ids endpoint to get the real asset ID
          var pbResult = await muxRequest('GET', '/video/v1/playback-ids/' + sess.recordingPlaybackId);
          var assetId = pbResult.data && pbResult.data.object ? pbResult.data.object.id : null;

          if (assetId) {
            await updateDoc(COLLECTION, sess.id, {
              recordingAssetId: assetId
            });
            fixResults.push({
              id: sess.id,
              title: sess.title_da || sess.title_en || '',
              playbackId: sess.recordingPlaybackId,
              assetId: assetId,
              status: 'fixed'
            });
            console.log('[ai-backfill] Fixed', sess.id, '→ asset:', assetId);
          } else {
            fixResults.push({
              id: sess.id,
              title: sess.title_da || sess.title_en || '',
              playbackId: sess.recordingPlaybackId,
              status: 'no_asset_found'
            });
          }
        } catch (err) {
          console.error('[ai-backfill] Fix error for', sess.id, ':', err.message);
          fixResults.push({
            id: sess.id,
            title: sess.title_da || sess.title_en || '',
            playbackId: sess.recordingPlaybackId,
            status: 'error',
            error: err.message
          });
        }
      }

      return jsonResponse(200, {
        ok: true,
        message: 'Fix complete. Now run default mode to trigger AI processing.',
        results: fixResults
      });
    }

    // ── Reconcile mode: find recordings from Mux for ended sessions missing recordingAssetId ──
    if (params.reconcile === '1') {
      var missing = all.filter(function (item) {
        return item.status === 'ended' && !item.recordingAssetId && item.muxLiveStreamId;
      });

      if (missing.length === 0) {
        // Also check sessions without muxLiveStreamId
        var endedNoStream = all.filter(function (item) {
          return item.status === 'ended' && !item.recordingAssetId;
        });
        if (endedNoStream.length > 0) {
          return jsonResponse(200, {
            ok: false,
            message: endedNoStream.length + ' ended sessions have no recording AND no muxLiveStreamId — cannot reconcile automatically',
            sessions: endedNoStream.map(function (item) {
              return { id: item.id, title: item.title_da || item.title_en || '' };
            })
          });
        }
        return jsonResponse(200, { ok: true, message: 'No sessions need reconciliation' });
      }

      console.log('[ai-backfill] Reconciling', missing.length, 'sessions with Mux');
      var reconciled = [];

      for (var i = 0; i < missing.length; i++) {
        var session = missing[i];
        try {
          // Query Mux for assets from this live stream
          var assetsResult = await muxRequest('GET',
            '/video/v1/assets?live_stream_id=' + session.muxLiveStreamId + '&limit=5');
          var assets = (assetsResult.data || []).filter(function (a) {
            return a.status === 'ready';
          });

          if (assets.length > 0) {
            var asset = assets[0]; // take the most recent ready asset
            var playbackId = asset.playback_ids && asset.playback_ids.length > 0
              ? asset.playback_ids[0].id : null;

            await updateDoc(COLLECTION, session.id, {
              recordingAssetId: asset.id,
              recordingPlaybackId: playbackId
            });

            reconciled.push({
              id: session.id,
              title: session.title_da || session.title_en || '',
              assetId: asset.id,
              playbackId: playbackId,
              status: 'linked'
            });
            console.log('[ai-backfill] Linked session', session.id, 'to asset', asset.id);
          } else {
            reconciled.push({
              id: session.id,
              title: session.title_da || session.title_en || '',
              status: 'no_assets_found',
              muxLiveStreamId: session.muxLiveStreamId
            });
          }
        } catch (err) {
          console.error('[ai-backfill] Reconcile error for', session.id, ':', err.message);
          reconciled.push({
            id: session.id,
            title: session.title_da || session.title_en || '',
            status: 'error',
            error: err.message
          });
        }
      }

      return jsonResponse(200, {
        ok: true,
        message: 'Reconciliation complete. Run without ?reconcile=1 to trigger AI processing.',
        results: reconciled
      });
    }

    // ── Reset mode: clear aiStatus so recordings can be re-processed ──
    if (params.reset === '1') {
      var resettable = all.filter(function (item) {
        return item.status === 'ended' && item.recordingAssetId && item.aiStatus && item.aiStatus !== 'complete';
      });
      var resetResults = [];
      for (var r = 0; r < resettable.length; r++) {
        await updateDoc(COLLECTION, resettable[r].id, { aiStatus: 'error' });
        resetResults.push({ id: resettable[r].id, title: resettable[r].title_da || '', oldStatus: resettable[r].aiStatus, newStatus: 'error' });
      }
      return jsonResponse(200, { ok: true, message: 'Reset ' + resetResults.length + ' sessions. Now run default mode.', results: resetResults });
    }

    // ── Check mode (Phase 2): check if Mux captions are ready, download + Claude ──
    if (params.check === '1') {
      var waiting = all.filter(function (item) {
        return item.status === 'ended'
          && item.recordingAssetId
          && (item.aiStatus === 'captions_requested' || item.aiStatus === 'captions_pending' || item.aiStatus === 'processing');
      });

      if (waiting.length === 0) {
        return jsonResponse(200, { ok: true, message: 'No sessions waiting for captions.' });
      }

      console.log('[ai-backfill] Checking', waiting.length, 'sessions for ready captions');
      var checkResults = [];

      // Process one at a time to stay within function timeout
      for (var c = 0; c < waiting.length; c++) {
        var sess = waiting[c];
        try {
          // Check if text track is ready on Mux
          var tracksResult = await muxRequest('GET', '/video/v1/assets/' + sess.recordingAssetId + '/tracks');
          var tracks = tracksResult.data || [];
          var readyTrack = null;

          for (var t = 0; t < tracks.length; t++) {
            if (tracks[t].type === 'text' && tracks[t].text_type === 'subtitles') {
              if (tracks[t].status === 'ready') {
                readyTrack = tracks[t];
              } else if (tracks[t].status === 'errored') {
                await updateDoc(COLLECTION, sess.id, { aiStatus: 'error', aiError: 'Caption track errored on Mux' });
                checkResults.push({ id: sess.id, title: sess.title_da || '', status: 'caption_errored' });
                readyTrack = null;
                break;
              } else {
                // Still preparing
                checkResults.push({ id: sess.id, title: sess.title_da || '', status: 'still_preparing', trackStatus: tracks[t].status });
                readyTrack = null;
                break;
              }
            }
          }

          if (!readyTrack) continue;

          // Caption track is ready — get VTT URL
          var vttUrl = null;
          try {
            var trackDetail = await muxRequest('GET', '/video/v1/assets/' + sess.recordingAssetId + '/tracks/' + readyTrack.id);
            if (trackDetail.data && trackDetail.data.text_source) {
              vttUrl = trackDetail.data.text_source;
            }
          } catch (e) { /* fallback below */ }

          if (!vttUrl && sess.recordingPlaybackId) {
            vttUrl = 'https://stream.mux.com/' + sess.recordingPlaybackId + '/text/' + readyTrack.id + '.vtt';
          }

          if (!vttUrl) {
            checkResults.push({ id: sess.id, title: sess.title_da || '', status: 'no_vtt_url' });
            continue;
          }

          // Download VTT transcript
          var transcript = await downloadVTT(vttUrl);
          console.log('[ai-backfill] Transcript for', sess.id, ':', transcript.length, 'chars');

          if (!transcript || transcript.length < 50) {
            await updateDoc(COLLECTION, sess.id, { aiStatus: 'no_transcript' });
            checkResults.push({ id: sess.id, title: sess.title_da || '', status: 'no_transcript', chars: transcript.length });
            continue;
          }

          // Send to Claude for summary + quiz
          var sessionTitle = sess.title_da || sess.title_en || 'Yoga Class';
          var sessionInstructor = sess.instructor || '';
          var aiResult = await generateSummaryAndQuiz(transcript, sessionTitle, sessionInstructor);

          // Save to Firestore
          await updateDoc(COLLECTION, sess.id, {
            aiStatus: 'complete',
            aiTranscript: transcript.substring(0, 50000),
            aiSummary: aiResult.summary || '',
            aiSummaryLang: aiResult.lang || 'da',
            aiQuiz: JSON.stringify(aiResult.quiz || []),
            aiProcessedAt: new Date().toISOString()
          });

          checkResults.push({ id: sess.id, title: sess.title_da || '', status: 'complete' });
          console.log('[ai-backfill] Complete:', sess.id);

        } catch (err) {
          console.error('[ai-backfill] Check error for', sess.id, ':', err.message);
          checkResults.push({ id: sess.id, title: sess.title_da || '', status: 'error', error: err.message });
        }
      }

      return jsonResponse(200, {
        ok: true,
        message: 'Check complete.',
        results: checkResults
      });
    }

    // ── Default mode (Phase 1): trigger caption requests for sessions with recordings ──
    var pending = all.filter(function (item) {
      return item.status === 'ended'
        && item.recordingAssetId
        && (!item.aiStatus || item.aiStatus === 'error' || item.aiStatus === 'captions_pending');
    });

    console.log('[ai-backfill] Found', pending.length, 'recordings to process');

    if (pending.length === 0) {
      return jsonResponse(200, { ok: true, message: 'No recordings need processing', total: all.length });
    }

    var batch = pending.slice(0, 3);
    var results = [];

    for (var j = 0; j < batch.length; j++) {
      var item = batch[j];
      console.log('[ai-backfill] Processing', (j + 1) + '/' + batch.length, ':', item.id);

      try {
        var result = await callAiProcess(item.id, item.recordingAssetId);
        results.push({ id: item.id, title: item.title_da || item.title_en || '', status: 'triggered' });
      } catch (err) {
        console.error('[ai-backfill] Error for', item.id, ':', err.message);
        results.push({ id: item.id, title: item.title_da || item.title_en || '', status: 'error', error: err.message });
      }
    }

    var remaining = pending.length - batch.length;
    return jsonResponse(200, {
      ok: true,
      processed: results,
      remaining: remaining,
      message: remaining > 0
        ? 'Processed ' + batch.length + '. Call again to process ' + remaining + ' more.'
        : 'All recordings processed!'
    });

  } catch (err) {
    console.error('[ai-backfill]', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};

/* ── Mux API helper ── */

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
            var err = new Error('Mux API ' + res.statusCode + ': ' + raw.substring(0, 200));
            reject(err);
          }
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

/* ── Download VTT transcript ── */

function downloadVTT(url) {
  return new Promise(function (resolve, reject) {
    var protocol = url.startsWith('https') ? https : require('http');
    protocol.get(url, function (res) {
      // Follow redirects (Mux may redirect VTT URLs)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadVTT(res.headers.location).then(resolve).catch(reject);
      }
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var raw = Buffer.concat(chunks).toString();
        // Strip VTT headers and timestamps, keep just the text
        var lines = raw.split('\n');
        var text = [];
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line || line === 'WEBVTT' || line.match(/^\d+$/) || line.match(/^\d{2}:\d{2}/)) continue;
          line = line.replace(/<[^>]+>/g, '');
          if (line) text.push(line);
        }
        resolve(text.join(' '));
      });
    }).on('error', reject);
  });
}

/* ── Claude API: generate summary + quiz ── */

function claudeRequest(messages, systemPrompt) {
  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY env var required');

  return new Promise(function (resolve, reject) {
    var body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
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

function generateSummaryAndQuiz(transcript, title, instructor) {
  // Detect language from transcript
  var daWords = ['og', 'med', 'fra', 'til', 'din', 'det', 'som', 'men', 'har', 'den', 'ikke', 'kan', 'skal', 'godt', 'ind', 'ud', 'hold', 'pust', 'ånd', 'stræk', 'krop', 'ben', 'arme', 'ryg'];
  var enWords = ['the', 'and', 'with', 'from', 'your', 'that', 'this', 'but', 'have', 'not', 'can', 'breathe', 'stretch', 'body', 'arms', 'legs', 'hold', 'inhale', 'exhale'];

  var words = transcript.toLowerCase().split(/\s+/).slice(0, 500);
  var daScore = 0, enScore = 0;
  for (var i = 0; i < words.length; i++) {
    if (daWords.indexOf(words[i]) !== -1) daScore++;
    if (enWords.indexOf(words[i]) !== -1) enScore++;
  }
  var lang = daScore >= enScore ? 'da' : 'en';

  var systemPrompt = lang === 'da'
    ? 'Du er en yogaekspert, der hjælper med at opsummere yogaklasser og lave quizzer. Svar KUN på dansk. Svar i valid JSON.'
    : 'You are a yoga expert who helps summarize yoga classes and create quizzes. Respond ONLY in English. Respond in valid JSON.';

  var userPrompt = lang === 'da'
    ? 'Her er en transskription af en yogaklasse'
      + (title ? ' med titlen "' + title + '"' : '')
      + (instructor ? ' undervist af ' + instructor : '')
      + '.\n\nTransskription:\n' + transcript.substring(0, 30000)
      + '\n\nGenerer et JSON-objekt med:\n'
      + '1. "summary": En detaljeret opsummering af klassen (2-3 afsnit) med bullet points. Brug HTML: <p>, <ul><li>, <strong>.\n'
      + '2. "quiz": Et array med 8-10 spørgsmål. Mix af multiple choice og sandt/falsk. Hvert:\n'
      + '   - "question": Spørgsmålstekst\n'
      + '   - "type": "multiple" eller "truefalse"\n'
      + '   - "options": Array af svarmuligheder\n'
      + '   - "correct": Index af korrekt svar (0-baseret)\n'
      + '   - "explanation": Kort forklaring\n\n'
      + 'Svar KUN med det rå JSON-objekt.'
    : 'Here is a transcript of a yoga class'
      + (title ? ' titled "' + title + '"' : '')
      + (instructor ? ' taught by ' + instructor : '')
      + '.\n\nTranscript:\n' + transcript.substring(0, 30000)
      + '\n\nGenerate a JSON object with:\n'
      + '1. "summary": Detailed summary (2-3 paragraphs) with bullets. Use HTML: <p>, <ul><li>, <strong>.\n'
      + '2. "quiz": Array of 8-10 questions. Mix multiple choice and true/false. Each:\n'
      + '   - "question": Question text\n'
      + '   - "type": "multiple" or "truefalse"\n'
      + '   - "options": Array of answer options\n'
      + '   - "correct": Index of correct answer (0-based)\n'
      + '   - "explanation": Brief explanation\n\n'
      + 'Respond ONLY with the raw JSON object.';

  return claudeRequest([{ role: 'user', content: userPrompt }], systemPrompt)
    .then(function (response) {
      var cleaned = response.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
      var parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch (e) {
        console.error('[ai-backfill] Failed to parse Claude response:', response.substring(0, 500));
        parsed = { summary: '', quiz: [] };
      }
      return { summary: parsed.summary || '', quiz: parsed.quiz || [], lang: lang };
    });
}

/* ── Call ai-process-recording (Phase 1 trigger) ── */

function callAiProcess(sessionId, assetId) {
  return new Promise(function (resolve, reject) {
    var body = JSON.stringify({
      sessionId: sessionId,
      assetId: assetId,
      secret: process.env.AI_INTERNAL_SECRET || ''
    });

    var opts = {
      hostname: 'yogabible.dk',
      path: '/.netlify/functions/ai-process-recording',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 300000
    };

    var req = https.request(opts, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var raw = Buffer.concat(chunks).toString();
        console.log('[ai-backfill] Response for', sessionId, ':', res.statusCode, raw.substring(0, 200));
        resolve(raw);
      });
    });
    req.on('error', reject);
    req.on('timeout', function () {
      req.destroy();
      resolve('timeout (expected)');
    });
    req.write(body);
    req.end();
  });
}
