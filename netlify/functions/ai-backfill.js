/**
 * Netlify Function: /.netlify/functions/ai-backfill
 *
 * One-time backfill: processes all existing recordings that don't have AI data yet.
 * Call via: GET /.netlify/functions/ai-backfill?secret=YOUR_AI_INTERNAL_SECRET
 *
 * Processes sequentially to avoid rate limits. Each recording takes ~3-6 min
 * (caption generation + Claude call), so this function may time out on Netlify's
 * 10s/26s limit. For many recordings, call it multiple times — it skips already-processed ones.
 */

const https = require('https');
const { getCollection, updateDoc } = require('./shared/firestore');
const { jsonResponse } = require('./shared/utils');

var COLLECTION = 'live-schedule';

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return jsonResponse(204, '');

  // Auth check
  var secret = (event.queryStringParameters || {}).secret || '';
  var expected = process.env.AI_INTERNAL_SECRET || '';
  if (expected && secret !== expected) {
    return jsonResponse(401, { ok: false, error: 'Invalid secret. Use ?secret=YOUR_AI_INTERNAL_SECRET' });
  }

  try {
    // Find all ended sessions with a recording but no AI data
    var all = await getCollection(COLLECTION, { orderBy: 'startDateTime', orderDir: 'desc' });

    var pending = all.filter(function (item) {
      return item.status === 'ended'
        && item.recordingAssetId
        && (!item.aiStatus || item.aiStatus === 'error');
    });

    console.log('[ai-backfill] Found', pending.length, 'recordings to process');

    // Debug mode: show status of all sessions
    var debug = (event.queryStringParameters || {}).debug === '1';
    if (debug) {
      return jsonResponse(200, {
        ok: true,
        total: all.length,
        pending: pending.length,
        sessions: all.map(function (item) {
          return {
            id: item.id,
            title: item.title_da || item.title_en || '',
            status: item.status,
            hasRecording: !!item.recordingAssetId,
            recordingAssetId: item.recordingAssetId || null,
            aiStatus: item.aiStatus || null,
            wouldProcess: item.status === 'ended' && !!item.recordingAssetId && (!item.aiStatus || item.aiStatus === 'error')
          };
        })
      });
    }

    if (pending.length === 0) {
      return jsonResponse(200, { ok: true, message: 'No recordings need processing', total: all.length });
    }

    // Process up to 3 per invocation (to stay within Netlify function timeout)
    var batch = pending.slice(0, 3);
    var results = [];

    for (var i = 0; i < batch.length; i++) {
      var item = batch[i];
      console.log('[ai-backfill] Processing', (i + 1) + '/' + batch.length, ':', item.id, item.title_da || item.title_en || '');

      try {
        // Call ai-process-recording synchronously
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

function callAiProcess(sessionId, assetId) {
  return new Promise(function (resolve, reject) {
    var body = JSON.stringify({
      sessionId: sessionId,
      assetId: assetId,
      secret: process.env.AI_INTERNAL_SECRET || ''
    });

    var opts = {
      hostname: 'www.yogabible.dk',
      path: '/.netlify/functions/ai-process-recording',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 300000 // 5 min
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
      // Timeout is expected — the AI function runs longer than the HTTP call
      resolve('timeout (expected)');
    });
    req.write(body);
    req.end();
  });
}
