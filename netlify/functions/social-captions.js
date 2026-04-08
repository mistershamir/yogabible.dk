/**
 * Social Captions API — Yoga Bible
 * Auto-caption generation from video audio via Deepgram Nova-2.
 *
 * POST /.netlify/functions/social-captions  { action: 'transcribe', videoUrl }
 *   → Now delegates to social-captions-background (Netlify background function)
 *     to avoid the 10s sync function timeout. Returns a jobId for polling.
 * GET  /.netlify/functions/social-captions?action=poll&jobId=...
 *   → Polls for background transcription results.
 * POST /.netlify/functions/social-captions  { action: 'translate', text, targetLang }
 */

const https = require('https');
const { getDb } = require('./shared/firestore');
const { requireAuth } = require('./shared/auth');
const { jsonResponse, optionsResponse } = require('./shared/utils');

const JOBS_COLLECTION = 'social_caption_jobs';

const MAX_CHUNK_SECS = 10;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return optionsResponse();

  const user = await requireAuth(event, ['admin']);
  if (user.error) return user.error;

  try {
    // GET actions (polling)
    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      if (params.action === 'poll' && params.jobId) {
        return pollTranscriptionJob(params.jobId);
      }
      return jsonResponse(400, { ok: false, error: 'Unknown GET action' });
    }

    const body = JSON.parse(event.body || '{}');
    const action = body.action;

    switch (action) {
      case 'transcribe': return startTranscription(body, event);
      case 'translate':  return translateText(body);
      default:
        return jsonResponse(400, { ok: false, error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error('[social-captions] Error:', err);
    return jsonResponse(500, { ok: false, error: err.message });
  }
};

/**
 * Start transcription via background function.
 * Returns a jobId immediately; client polls via GET ?action=poll&jobId=...
 */
async function startTranscription(body, event) {
  const { videoUrl } = body;
  if (!videoUrl) return jsonResponse(400, { ok: false, error: 'Missing videoUrl' });

  const jobId = 'cap_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);

  // Fire the background function (returns 202, runs up to 15 minutes)
  const token = event.headers.authorization || event.headers.Authorization || '';
  try {
    const siteUrl = process.env.URL || 'https://yogabible.dk';
    fetch(`${siteUrl}/.netlify/functions/social-captions-background`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token
      },
      body: JSON.stringify({ videoUrl, jobId })
    }).catch(err => console.warn('[social-captions] Background invoke error:', err.message));
  } catch (e) {
    console.warn('[social-captions] Background invoke error:', e.message);
  }

  return jsonResponse(200, { ok: true, jobId, status: 'processing' });
}

/**
 * Poll for transcription job results stored in Firestore by the background function.
 */
async function pollTranscriptionJob(jobId) {
  const db = getDb();
  const doc = await db.collection(JOBS_COLLECTION).doc(jobId).get();

  if (!doc.exists) {
    return jsonResponse(404, { ok: false, status: 'not_found' });
  }

  const data = doc.data();
  if (data.status === 'complete') {
    return jsonResponse(200, {
      ok: true,
      status: 'complete',
      transcript: data.transcript,
      utterances: data.utterances,
      language: data.language,
      vtt: data.vtt,
      srt: data.srt
    });
  }

  if (data.status === 'failed') {
    return jsonResponse(200, { ok: false, status: 'failed', error: data.error });
  }

  return jsonResponse(200, { ok: true, status: 'processing' });
}


// ── Deepgram Transcription ───────────────────────────────────────────

async function transcribeVideo({ videoUrl }) {
  if (!videoUrl) return jsonResponse(400, { ok: false, error: 'Missing videoUrl' });

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) return jsonResponse(500, { ok: false, error: 'DEEPGRAM_API_KEY not configured' });

  const result = await deepgramTranscribe(videoUrl, apiKey);

  // Generate VTT and SRT from utterances
  const vtt = generateVtt(result.utterances);
  const srt = generateSrt(result.utterances);

  return jsonResponse(200, {
    ok: true,
    transcript: result.transcript,
    words: result.words,
    utterances: result.utterances,
    language: result.language,
    vtt,
    srt
  });
}

function deepgramTranscribe(audioUrl, apiKey) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      model: 'nova-2',
      detect_language: 'true',
      smart_format: 'true',
      paragraphs: 'true',
      utterances: 'true',
      utt_split: '0.8'
    });

    const body = JSON.stringify({ url: audioUrl });

    const opts = {
      hostname: 'api.deepgram.com',
      path: '/v1/listen?' + params.toString(),
      method: 'POST',
      headers: {
        'Authorization': 'Token ' + apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 300000 // 5 min
    };

    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        try {
          const json = JSON.parse(raw);

          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error('Deepgram HTTP ' + res.statusCode + ': ' + raw.substring(0, 500)));
          }

          const alt = json.results && json.results.channels && json.results.channels[0] &&
                       json.results.channels[0].alternatives && json.results.channels[0].alternatives[0];
          if (!alt) return reject(new Error('No transcription results'));

          const transcript = alt.transcript || '';
          const words = (alt.words || []).map(w => ({
            word: w.punctuated_word || w.word,
            start: w.start,
            end: w.end,
            confidence: w.confidence
          }));

          // Get utterances — with fallback for empty utterances on long recordings
          let utterances = (json.results.utterances || []).map(u => ({
            text: u.transcript,
            start: u.start,
            end: u.end
          }));

          if (utterances.length === 0 && alt.words && alt.words.length > 0) {
            utterances = buildUtterancesFromWords(alt.words);
          }

          const language = (json.results.channels && json.results.channels[0] &&
                            json.results.channels[0].detected_language) || 'unknown';

          resolve({ transcript, words, utterances, language });
        } catch (e) {
          reject(new Error('Deepgram parse error: ' + e.message));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Deepgram timeout')); });
    req.write(body);
    req.end();
  });
}

/**
 * Fallback: build synthetic utterances from word-level timestamps in ~10s chunks.
 * Deepgram can return a full transcript but empty utterances for long recordings (3h+).
 */
function buildUtterancesFromWords(words) {
  const utterances = [];
  let chunk = [];
  let chunkStart = null;

  for (const w of words) {
    if (chunkStart === null) chunkStart = w.start;
    chunk.push(w.punctuated_word || w.word);

    if (w.end - chunkStart >= MAX_CHUNK_SECS) {
      utterances.push({
        text: chunk.join(' '),
        start: chunkStart,
        end: w.end
      });
      chunk = [];
      chunkStart = null;
    }
  }

  if (chunk.length > 0) {
    utterances.push({
      text: chunk.join(' '),
      start: chunkStart,
      end: words[words.length - 1].end
    });
  }

  return utterances;
}


// ── VTT / SRT Generation ─────────────────────────────────────────────

function formatVttTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return String(h).padStart(2, '0') + ':' +
         String(m).padStart(2, '0') + ':' +
         String(s).padStart(2, '0') + '.' +
         String(ms).padStart(3, '0');
}

function formatSrtTime(seconds) {
  // SRT uses comma instead of dot for milliseconds
  return formatVttTime(seconds).replace('.', ',');
}

function generateVtt(utterances) {
  let vtt = 'WEBVTT\n\n';
  utterances.forEach((u, i) => {
    vtt += (i + 1) + '\n';
    vtt += formatVttTime(u.start) + ' --> ' + formatVttTime(u.end) + '\n';
    vtt += u.text + '\n\n';
  });
  return vtt;
}

function generateSrt(utterances) {
  let srt = '';
  utterances.forEach((u, i) => {
    srt += (i + 1) + '\n';
    srt += formatSrtTime(u.start) + ' --> ' + formatSrtTime(u.end) + '\n';
    srt += u.text + '\n\n';
  });
  return srt;
}


// ── Translation via Claude ───────────────────────────────────────────

async function translateText({ text, targetLang }) {
  if (!text) return jsonResponse(400, { ok: false, error: 'Missing text' });
  if (!targetLang) return jsonResponse(400, { ok: false, error: 'Missing targetLang' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return jsonResponse(500, { ok: false, error: 'ANTHROPIC_API_KEY not configured' });

  const langNames = {
    da: 'Danish', en: 'English', de: 'German', sv: 'Swedish', no: 'Norwegian'
  };
  const langName = langNames[targetLang] || targetLang;

  const translated = await claudeRequest(apiKey, [
    {
      role: 'user',
      content: `Translate the following subtitle text to ${langName}. Preserve all line breaks and timing cues. Return ONLY the translated text, nothing else.\n\n${text}`
    }
  ], 4000);

  return jsonResponse(200, { ok: true, translated, targetLang });
}

function claudeRequest(apiKey, messages, maxTokens) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens || 2000,
      system: 'You are a professional translator. Translate accurately while preserving the natural tone and meaning.',
      messages
    });

    const opts = {
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

    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        try {
          const json = JSON.parse(raw);
          if (json.content && json.content[0]) {
            resolve(json.content[0].text);
          } else {
            reject(new Error('Claude unexpected response: ' + raw.substring(0, 300)));
          }
        } catch (e) {
          reject(new Error('Claude parse error: ' + raw.substring(0, 300)));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
