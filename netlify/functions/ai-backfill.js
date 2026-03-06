/**
 * Netlify Function: /.netlify/functions/ai-backfill
 *
 * Modes:
 *   ?debug=1    — Show status of all sessions (read-only)
 *   ?reconcile=1 — Find missing recordings from Mux and link them to Firestore sessions
 *   (default)   — Process sessions that have recordings but no AI data yet
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

    // ── Manual link mode: fetches correct playback IDs from Mux API using asset IDs ──
    if (params.link === '1') {
      var manualLinks = [
        { sessionId: 'fKCXgCU2FwyXWk8UCF1R', assetId: 'WAGBUMO1M101Rovb9qRTV1U8S5LOlBDyPVL2y2miOkGE' },
        { sessionId: 'YYDqECjSRemeb9dTRbPK', assetId: 'kuHT5DO2VhICO6EKlbpZPGPO2tGodd8KiMelNWir3ziQ' }
      ];

      var linkResults = [];
      for (var m = 0; m < manualLinks.length; m++) {
        var link = manualLinks[m];
        try {
          // Fetch the asset from Mux to get the correct public playback ID
          var assetData = await muxRequest('GET', '/video/v1/assets/' + link.assetId);
          var asset = assetData.data;
          var playbackId = null;
          var ids = asset.playback_ids || [];
          for (var p = 0; p < ids.length; p++) {
            if (ids[p].policy === 'public') { playbackId = ids[p].id; break; }
          }
          if (!playbackId && ids.length) playbackId = ids[0].id;

          if (!playbackId) {
            linkResults.push({ sessionId: link.sessionId, assetId: link.assetId, status: 'error', error: 'No playback ID found on asset' });
            continue;
          }

          await updateDoc(COLLECTION, link.sessionId, {
            recordingAssetId: link.assetId,
            recordingPlaybackId: playbackId
          });
          linkResults.push({
            sessionId: link.sessionId,
            assetId: link.assetId,
            playbackId: playbackId,
            playbackPolicy: ids[0] ? ids[0].policy : 'unknown',
            status: 'linked'
          });
          console.log('[ai-backfill] Linked', link.sessionId, '→ asset:', link.assetId, 'playback:', playbackId);
        } catch (err) {
          linkResults.push({ sessionId: link.sessionId, assetId: link.assetId, status: 'error', error: err.message });
        }
      }

      return jsonResponse(200, {
        ok: true,
        message: 'Manual linking complete (playback IDs fetched from Mux API).',
        results: linkResults
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

    // ── Default mode: process sessions with recordings but no AI data ──
    var pending = all.filter(function (item) {
      return item.status === 'ended'
        && item.recordingAssetId
        && (!item.aiStatus || item.aiStatus === 'error');
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

/* ── Call ai-process-recording ── */

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
