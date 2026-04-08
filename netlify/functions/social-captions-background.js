/**
 * Social Captions Background — Yoga Bible
 * Long-running Deepgram transcription as a Netlify background function.
 * Stores results in Firestore for the client to poll.
 *
 * POST /.netlify/functions/social-captions-background  { videoUrl, jobId }
 *
 * The client generates a jobId, invokes this (gets 202 immediately),
 * then polls social-captions?action=poll&jobId=... for results.
 */

const { getDb, serverTimestamp } = require('./shared/firestore');
const { requireAuth } = require('./shared/auth');

// Re-use the transcription logic from social-captions.js
const https = require('https');
const MAX_CHUNK_SECS = 10;

const JOBS_COLLECTION = 'social_caption_jobs';

exports.handler = async (event) => {
  // Background functions still receive the event — validate auth
  const user = await requireAuth(event, ['admin']);
  if (user.error) return user.error;

  const body = JSON.parse(event.body || '{}');
  const { videoUrl, jobId } = body;

  if (!videoUrl || !jobId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing videoUrl or jobId' }) };
  }

  const db = getDb();
  const jobRef = db.collection(JOBS_COLLECTION).doc(jobId);

  try {
    await jobRef.set({
      status: 'processing',
      videoUrl,
      createdAt: serverTimestamp()
    });

    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      await jobRef.update({ status: 'failed', error: 'DEEPGRAM_API_KEY not configured' });
      return { statusCode: 200, body: '{}' };
    }

    const result = await deepgramTranscribe(videoUrl, apiKey);
    const vtt = generateVtt(result.utterances);
    const srt = generateSrt(result.utterances);

    await jobRef.update({
      status: 'complete',
      transcript: result.transcript,
      utterances: result.utterances,
      language: result.language,
      vtt,
      srt,
      completedAt: serverTimestamp()
    });
  } catch (err) {
    console.error('[social-captions-bg] Error:', err.message);
    await jobRef.update({
      status: 'failed',
      error: err.message,
      failedAt: serverTimestamp()
    }).catch(() => {});
  }

  return { statusCode: 200, body: '{}' };
};


// ── Deepgram helpers (duplicated from social-captions.js to avoid cross-require) ──

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
      timeout: 300000
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
          const alt = json.results?.channels?.[0]?.alternatives?.[0];
          if (!alt) return reject(new Error('No transcription results'));

          let utterances = (json.results.utterances || []).map(u => ({
            text: u.transcript, start: u.start, end: u.end
          }));
          if (utterances.length === 0 && alt.words?.length > 0) {
            utterances = buildUtterancesFromWords(alt.words);
          }

          resolve({
            transcript: alt.transcript || '',
            utterances,
            language: json.results.channels?.[0]?.detected_language || 'unknown'
          });
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

function buildUtterancesFromWords(words) {
  const utterances = [];
  let chunk = [], chunkStart = null;
  for (const w of words) {
    if (chunkStart === null) chunkStart = w.start;
    chunk.push(w.punctuated_word || w.word);
    if (w.end - chunkStart >= MAX_CHUNK_SECS) {
      utterances.push({ text: chunk.join(' '), start: chunkStart, end: w.end });
      chunk = []; chunkStart = null;
    }
  }
  if (chunk.length > 0) {
    utterances.push({ text: chunk.join(' '), start: chunkStart, end: words[words.length - 1].end });
  }
  return utterances;
}

function formatVttTime(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60), ms = Math.round((s % 1) * 1000);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0') + '.' + String(ms).padStart(3, '0');
}

function generateVtt(utterances) {
  let vtt = 'WEBVTT\n\n';
  utterances.forEach((u, i) => { vtt += (i + 1) + '\n' + formatVttTime(u.start) + ' --> ' + formatVttTime(u.end) + '\n' + u.text + '\n\n'; });
  return vtt;
}

function generateSrt(utterances) {
  let srt = '';
  utterances.forEach((u, i) => { srt += (i + 1) + '\n' + formatVttTime(u.start).replace('.', ',') + ' --> ' + formatVttTime(u.end).replace('.', ',') + '\n' + u.text + '\n\n'; });
  return srt;
}
