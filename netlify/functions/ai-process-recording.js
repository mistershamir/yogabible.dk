/**
 * Netlify Function: /.netlify/functions/ai-process-recording
 *
 * Called internally after a recording's asset is ready.
 * 1. Requests Mux to generate auto-captions for the asset
 * 2. Polls until the text track is ready
 * 3. Downloads the VTT transcript
 * 4. Sends transcript to Claude (Haiku) for summary + quiz generation
 * 5. Saves results to Firestore on the session document
 *
 * Env vars required:
 *   MUX_TOKEN_ID, MUX_TOKEN_SECRET — Mux API credentials
 *   ANTHROPIC_API_KEY              — Claude API key
 */

const https = require('https');
const { getDoc, updateDoc } = require('./shared/firestore');
const { jsonResponse } = require('./shared/utils');

var COLLECTION = 'live-schedule';

// ═══════════════════════════════════════════════════
// Entry point — called by mux-webhook after asset.ready
// ═══════════════════════════════════════════════════

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(204, '');
  }

  try {
    var body = JSON.parse(event.body || '{}');
    var sessionId = body.sessionId;
    var assetId = body.assetId;

    if (!sessionId || !assetId) {
      return jsonResponse(400, { ok: false, error: 'sessionId and assetId required' });
    }

    // Verify internal call (simple shared secret)
    var internalSecret = process.env.AI_INTERNAL_SECRET || '';
    var providedSecret = body.secret || '';
    if (internalSecret && providedSecret !== internalSecret) {
      return jsonResponse(401, { ok: false, error: 'Unauthorized' });
    }

    console.log('[ai-process] Starting for session:', sessionId, 'asset:', assetId);

    // Mark processing started
    await updateDoc(COLLECTION, sessionId, {
      aiStatus: 'processing'
    });

    // Step 1: Request auto-generated captions from Mux
    var trackId = await requestCaptions(assetId);
    console.log('[ai-process] Caption track requested:', trackId);

    // Step 2: Poll until the track is ready (max 5 min)
    var trackUrl = await pollForTrack(assetId, trackId);
    console.log('[ai-process] Track ready, URL:', trackUrl ? 'yes' : 'no');

    if (!trackUrl) {
      // Captions not ready within timeout — mark for retry
      await updateDoc(COLLECTION, sessionId, {
        aiStatus: 'captions_pending'
      });
      return jsonResponse(200, { ok: true, status: 'captions_pending' });
    }

    // Step 3: Download the VTT transcript
    var transcript = await downloadVTT(trackUrl);
    console.log('[ai-process] Transcript length:', transcript.length, 'chars');

    if (!transcript || transcript.length < 50) {
      await updateDoc(COLLECTION, sessionId, {
        aiStatus: 'no_transcript'
      });
      return jsonResponse(200, { ok: true, status: 'no_transcript' });
    }

    // Step 4: Get session data for context
    var session = await getDoc(COLLECTION, sessionId);
    var sessionTitle = session ? (session.title_da || session.title_en || 'Yoga Class') : 'Yoga Class';
    var sessionInstructor = session ? (session.instructor || '') : '';

    // Step 5: Send to Claude for summary + quiz
    var aiResult = await generateSummaryAndQuiz(transcript, sessionTitle, sessionInstructor);
    console.log('[ai-process] AI generated summary + quiz');

    // Step 6: Save to Firestore
    await updateDoc(COLLECTION, sessionId, {
      aiStatus: 'complete',
      aiTranscript: transcript.substring(0, 50000), // Cap at 50k chars
      aiSummary: aiResult.summary || '',
      aiSummaryLang: aiResult.lang || 'da',
      aiQuiz: JSON.stringify(aiResult.quiz || []),
      aiProcessedAt: new Date().toISOString()
    });

    console.log('[ai-process] Done for session:', sessionId);
    return jsonResponse(200, { ok: true, status: 'complete' });

  } catch (err) {
    console.error('[ai-process] Error:', err);

    // Try to mark the error on the session
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
// Mux API: Request auto-generated captions
// ═══════════════════════════════════════════════════

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
  // First check if a text track already exists
  var existing = await muxRequest('GET', '/video/v1/assets/' + assetId + '/tracks');
  var tracks = (existing.data || []);
  for (var i = 0; i < tracks.length; i++) {
    if (tracks[i].type === 'text' && tracks[i].text_type === 'subtitles') {
      return tracks[i].id;
    }
  }

  // Request auto-generated captions
  var result = await muxRequest('POST', '/video/v1/assets/' + assetId + '/tracks', {
    language_code: 'da',
    type: 'text',
    text_type: 'subtitles',
    name: 'Auto (DA)',
    generated_subtitles: [{
      language_code: 'da',
      name: 'Auto (DA)'
    }]
  });

  return result.data ? result.data.id : null;
}

// ═══════════════════════════════════════════════════
// Poll for caption track to be ready
// ═══════════════════════════════════════════════════

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function pollForTrack(assetId, trackId) {
  // Poll every 15s for up to 4 minutes (16 attempts)
  for (var attempt = 0; attempt < 16; attempt++) {
    if (attempt > 0) await sleep(15000);

    try {
      var result = await muxRequest('GET', '/video/v1/assets/' + assetId + '/tracks');
      var tracks = result.data || [];

      for (var i = 0; i < tracks.length; i++) {
        var track = tracks[i];
        if (track.type === 'text' && track.status === 'ready') {
          // Get the text track URL
          var textResult = await muxRequest('GET', '/video/v1/assets/' + assetId + '/tracks/' + track.id);
          if (textResult.data && textResult.data.text_source) {
            return textResult.data.text_source;
          }
          // Fallback: construct the URL from the playback ID
          var assetResult = await muxRequest('GET', '/video/v1/assets/' + assetId);
          var playbackIds = assetResult.data ? assetResult.data.playback_ids : [];
          var publicId = null;
          for (var j = 0; j < playbackIds.length; j++) {
            if (playbackIds[j].policy === 'public') {
              publicId = playbackIds[j].id;
              break;
            }
          }
          if (publicId) {
            return 'https://stream.mux.com/' + publicId + '/text/' + track.id + '.vtt';
          }
          return null;
        }
        if (track.type === 'text' && track.status === 'errored') {
          console.error('[ai-process] Caption track errored');
          return null;
        }
      }
    } catch (err) {
      console.log('[ai-process] Poll attempt', attempt, 'error:', err.message);
    }
  }

  return null; // Timeout
}

// ═══════════════════════════════════════════════════
// Download and parse VTT
// ═══════════════════════════════════════════════════

function downloadVTT(url) {
  return new Promise(function (resolve, reject) {
    var protocol = url.startsWith('https') ? https : require('http');
    protocol.get(url, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var raw = Buffer.concat(chunks).toString();
        // Strip VTT headers and timestamps, keep just the text
        var lines = raw.split('\n');
        var text = [];
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          // Skip WEBVTT header, empty lines, and timestamp lines
          if (!line || line === 'WEBVTT' || line.match(/^\d+$/) || line.match(/^\d{2}:\d{2}/)) continue;
          // Remove HTML tags from subtitle text
          line = line.replace(/<[^>]+>/g, '');
          if (line) text.push(line);
        }
        resolve(text.join(' '));
      });
    }).on('error', reject);
  });
}

// ═══════════════════════════════════════════════════
// Claude API: Generate summary + quiz
// ═══════════════════════════════════════════════════

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
            reject(new Error('Claude API unexpected response: ' + raw.substring(0, 300)));
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

async function generateSummaryAndQuiz(transcript, title, instructor) {
  // Detect language from transcript (simple heuristic)
  var daWords = ['og', 'med', 'fra', 'til', 'din', 'det', 'som', 'men', 'har', 'den', 'ikke', 'kan', 'skal', 'godt', 'ind', 'ud', 'hold', 'pust', 'ånd', 'stræk', 'krop', 'ben', 'arme', 'ryg', 'fod', 'ånde', 'vejr'];
  var enWords = ['the', 'and', 'with', 'from', 'your', 'that', 'this', 'but', 'have', 'not', 'can', 'breathe', 'stretch', 'body', 'arms', 'legs', 'hold', 'inhale', 'exhale', 'forward', 'back'];

  var words = transcript.toLowerCase().split(/\s+/).slice(0, 500);
  var daScore = 0;
  var enScore = 0;
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
      + '1. "summary": En detaljeret opsummering af klassen (2-3 afsnit) med bullet points for nøgleemner. Brug HTML: <p> for afsnit, <ul><li> for punkter, <strong> for fremhævning.\n'
      + '2. "quiz": Et array med 8-10 spørgsmål fra klassen. Mix af multiple choice og sandt/falsk. Hvert spørgsmål:\n'
      + '   - "question": Spørgsmålstekst\n'
      + '   - "type": "multiple" eller "truefalse"\n'
      + '   - "options": Array af svarmuligheder (4 for multiple choice, 2 for sandt/falsk: ["Sandt","Falsk"])\n'
      + '   - "correct": Index af det korrekte svar (0-baseret)\n'
      + '   - "explanation": Kort forklaring af det rigtige svar\n\n'
      + 'Svar KUN med det rå JSON-objekt, ingen markdown eller tekst omkring.'
    : 'Here is a transcript of a yoga class'
      + (title ? ' titled "' + title + '"' : '')
      + (instructor ? ' taught by ' + instructor : '')
      + '.\n\nTranscript:\n' + transcript.substring(0, 30000)
      + '\n\nGenerate a JSON object with:\n'
      + '1. "summary": A detailed summary of the class (2-3 paragraphs) with bullet points for key topics. Use HTML: <p> for paragraphs, <ul><li> for bullets, <strong> for emphasis.\n'
      + '2. "quiz": An array of 8-10 questions from the class. Mix of multiple choice and true/false. Each question:\n'
      + '   - "question": Question text\n'
      + '   - "type": "multiple" or "truefalse"\n'
      + '   - "options": Array of answer options (4 for multiple choice, 2 for true/false: ["True","False"])\n'
      + '   - "correct": Index of correct answer (0-based)\n'
      + '   - "explanation": Brief explanation of the correct answer\n\n'
      + 'Respond ONLY with the raw JSON object, no markdown or text around it.';

  var response = await claudeRequest([
    { role: 'user', content: userPrompt }
  ], systemPrompt);

  // Parse the JSON response
  var parsed;
  try {
    // Strip potential markdown code fences
    var cleaned = response.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    console.error('[ai-process] Failed to parse Claude response:', response.substring(0, 500));
    parsed = { summary: '', quiz: [] };
  }

  return {
    summary: parsed.summary || '',
    quiz: parsed.quiz || [],
    lang: lang
  };
}
