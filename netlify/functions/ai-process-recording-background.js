/**
 * Netlify Background Function: /.netlify/functions/ai-process-recording-background
 *
 * Called internally after a recording's asset is ready (from mux-webhook).
 * The "-background" suffix gives this function a 15-minute timeout (vs 26s).
 *
 * Full pipeline (runs automatically end-to-end):
 *   1. Requests Mux to generate auto-captions for the asset
 *   2. Polls Mux until captions are ready (up to 10 minutes)
 *   3. Downloads VTT transcript
 *   4. Sends transcript to Claude for summary + quiz generation
 *   5. Saves results to Firestore
 *
 * Env vars required:
 *   MUX_TOKEN_ID, MUX_TOKEN_SECRET — Mux API credentials
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

    // ── Step 1: Request auto-generated captions ──
    var trackId = await requestCaptions(assetId);
    console.log('[ai-process] Caption track:', trackId);

    if (!trackId) {
      await updateDoc(COLLECTION, sessionId, {
        aiStatus: 'error',
        aiError: 'No audio track found on asset'
      });
      return jsonResponse(200, { ok: true, status: 'no_audio_track' });
    }

    await updateDoc(COLLECTION, sessionId, {
      aiStatus: 'captions_requested',
      aiCaptionTrackId: trackId
    });

    // ── Step 2: Poll until captions are ready (up to 10 minutes) ──
    console.log('[ai-process] Polling for caption readiness...');
    var captionReady = false;
    var readyTrack = null;
    var maxAttempts = 20; // 20 × 30s = 10 minutes
    var pollInterval = 30000; // 30 seconds

    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
      await sleep(pollInterval);

      var assetData = await muxRequest('GET', '/video/v1/assets/' + assetId);
      var tracks = (assetData.data && assetData.data.tracks) || [];

      for (var t = 0; t < tracks.length; t++) {
        if (tracks[t].type === 'text' && tracks[t].text_type === 'subtitles') {
          if (tracks[t].status === 'ready') {
            readyTrack = tracks[t];
            captionReady = true;
          } else if (tracks[t].status === 'errored') {
            console.error('[ai-process] Caption track errored on Mux');
            await updateDoc(COLLECTION, sessionId, {
              aiStatus: 'error',
              aiError: 'Caption generation failed on Mux'
            });
            return jsonResponse(200, { ok: true, status: 'caption_errored' });
          }
          break;
        }
      }

      if (captionReady) {
        console.log('[ai-process] Captions ready after', attempt, 'polls (~' + (attempt * 30) + 's)');
        break;
      }

      console.log('[ai-process] Poll', attempt + '/' + maxAttempts, '— captions not ready yet');
    }

    if (!captionReady) {
      console.error('[ai-process] Captions not ready after 10 minutes');
      await updateDoc(COLLECTION, sessionId, {
        aiStatus: 'captions_requested',
        aiError: 'Captions not ready after 10 minutes — run ai-backfill?check=1 manually'
      });
      return jsonResponse(200, { ok: true, status: 'timeout' });
    }

    // ── Step 3: Download VTT transcript ──
    // Get playback ID if not provided
    if (!playbackId) {
      var session = await getDoc(COLLECTION, sessionId);
      playbackId = session && session.recordingPlaybackId;
    }
    if (!playbackId) {
      // Try from asset
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

    var vttUrl = 'https://stream.mux.com/' + playbackId + '/text/' + readyTrack.id + '.vtt';
    console.log('[ai-process] Downloading VTT from:', vttUrl);
    var transcript = await downloadVTT(vttUrl);
    console.log('[ai-process] Transcript length:', transcript.length, 'chars');

    if (!transcript || transcript.length < 50) {
      await updateDoc(COLLECTION, sessionId, { aiStatus: 'no_transcript' });
      return jsonResponse(200, { ok: true, status: 'no_transcript', chars: transcript.length });
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
        await updateDoc(COLLECTION, errorBody.sessionId, {
          aiStatus: 'error',
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

async function requestCaptions(assetId) {
  var existing = await muxRequest('GET', '/video/v1/assets/' + assetId);
  var tracks = (existing.data && existing.data.tracks) || [];

  // Check if captions already exist and are ready
  for (var i = 0; i < tracks.length; i++) {
    if (tracks[i].type === 'text' && tracks[i].text_type === 'subtitles') {
      console.log('[ai-process] Existing caption track found:', tracks[i].id, 'status:', tracks[i].status);
      return tracks[i].id;
    }
  }

  // Find the audio track ID
  var audioTrackId = null;
  for (var j = 0; j < tracks.length; j++) {
    if (tracks[j].type === 'audio') {
      audioTrackId = tracks[j].id;
      break;
    }
  }

  if (!audioTrackId) {
    console.error('[ai-process] No audio track found on asset:', assetId);
    return null;
  }

  // Request auto-generated captions
  console.log('[ai-process] Requesting captions on audio track:', audioTrackId);
  var result = await muxRequest('POST',
    '/video/v1/assets/' + assetId + '/tracks/' + audioTrackId + '/generate-subtitles',
    {
      generated_subtitles: [{
        language_code: 'en',
        name: 'English CC'
      }]
    }
  );

  var newTracks = result.data || [];
  if (Array.isArray(newTracks) && newTracks.length > 0) {
    return newTracks[0].id;
  }

  // Fallback: re-fetch
  var refreshed = await muxRequest('GET', '/video/v1/assets/' + assetId);
  var refreshedTracks = (refreshed.data && refreshed.data.tracks) || [];
  for (var k = 0; k < refreshedTracks.length; k++) {
    if (refreshedTracks[k].type === 'text' && refreshedTracks[k].text_type === 'subtitles') {
      return refreshedTracks[k].id;
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════
// VTT download
// ═══════════════════════════════════════════════════

function downloadVTT(url) {
  return new Promise(function (resolve, reject) {
    var protocol = url.startsWith('https') ? https : require('http');
    protocol.get(url, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadVTT(res.headers.location).then(resolve).catch(reject);
      }
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var raw = Buffer.concat(chunks).toString();
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
