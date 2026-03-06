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
