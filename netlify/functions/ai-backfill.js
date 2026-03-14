/**
 * Netlify Function: /.netlify/functions/ai-backfill
 *
 * Modes:
 *   ?debug=1    — Show status of all sessions (read-only)
 *   ?reconcile=1 — Find missing recordings from Mux and link them to Firestore sessions
 *   ?enable-mp4=1 — Request MP4 static renditions on Mux assets
 *   ?mp4-status=1 — Check if MP4 renditions are ready
 *   ?generate-subtitles=1 — Request Mux auto-generated captions (fallback when MP4 unavailable)
 *   ?subtitle-status=1 — Check if auto-generated subtitles are ready
 *   ?check=1    — Find stuck sessions and re-trigger processing
 *   ?retranscribe=SESSION_ID — Reset and re-trigger full pipeline (MP4→Deepgram→Claude, with subtitle fallback)
 *   ?retranscribe=all — Re-transcribe ALL sessions with recordings (batch mode)
 *   ?deepgram-direct=SESSION_ID — Skip Mux, send HLS URL to Deepgram async API with callback webhook
 *   ?reprocess=SESSION_ID — Re-run Claude on existing transcript (no re-transcription)
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
            aiStatus: item.aiStatus || null,
            aiError: item.aiError || null
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

    // ── Retranscribe mode: reset and re-trigger Deepgram transcription ──
    // ?retranscribe=SESSION_ID  — single session
    // ?retranscribe=all         — all sessions with recordings
    // &transcript-only=1        — stop after transcription, skip Claude summary/quiz
    if (params.retranscribe) {
      var isTranscriptOnly = params['transcript-only'] === '1';
      var retranscribeTargets = [];

      if (params.retranscribe === 'all') {
        // Batch mode: all ended sessions with recordings
        retranscribeTargets = all.filter(function (item) {
          return item.status === 'ended' && item.recordingAssetId;
        });
        if (retranscribeTargets.length === 0) {
          return jsonResponse(200, { ok: true, message: 'No sessions with recordings found.' });
        }
      } else {
        // Single session mode
        var sessId = params.retranscribe;
        var sess = all.find(function (item) { return item.id === sessId; });
        if (!sess) {
          return jsonResponse(404, { ok: false, error: 'Session not found: ' + sessId });
        }
        if (!sess.recordingAssetId) {
          return jsonResponse(400, { ok: false, error: 'Session has no recording asset' });
        }
        retranscribeTargets = [sess];
      }

      console.log('[ai-backfill] Retranscribe:', retranscribeTargets.length, 'session(s)');
      var retranscribeResults = [];

      for (var rt = 0; rt < retranscribeTargets.length; rt++) {
        var target = retranscribeTargets[rt];
        try {
          // Step 1: Delete old Mux subtitle tracks (cleanup)
          var deletedCount = 0;
          try {
            var assetResult = await muxRequest('GET', '/video/v1/assets/' + target.recordingAssetId);
            var tracks = (assetResult.data && assetResult.data.tracks) || [];
            for (var dt = 0; dt < tracks.length; dt++) {
              if (tracks[dt].type === 'text' && tracks[dt].text_type === 'subtitles') {
                try {
                  await muxRequest('DELETE', '/video/v1/assets/' + target.recordingAssetId + '/tracks/' + tracks[dt].id);
                  deletedCount++;
                } catch (delErr) { /* ignore */ }
              }
            }
          } catch (muxErr) {
            console.log('[ai-backfill] Could not clean Mux tracks for', target.id, ':', muxErr.message);
          }

          // Step 2: Reset Firestore status
          await updateDoc(COLLECTION, target.id, {
            aiStatus: null,
            aiError: null,
            aiTranscript: null,
            aiSummary: null,
            aiQuiz: null,
            aiCaptionTrackId: null
          });

          // Step 3: Trigger the background function
          await callAiProcess(target.id, target.recordingAssetId, { transcriptOnly: isTranscriptOnly });

          retranscribeResults.push({
            id: target.id,
            title: target.title_da || target.title_en || '',
            deletedSubtitleTracks: deletedCount,
            status: 'triggered'
          });
          console.log('[ai-backfill] Retranscribe triggered:', target.id, '(cleaned', deletedCount, 'old tracks)');
        } catch (err) {
          console.error('[ai-backfill] Retranscribe error for', target.id, ':', err.message);
          retranscribeResults.push({ id: target.id, title: target.title_da || '', status: 'error', error: err.message });
        }
      }

      return jsonResponse(200, {
        ok: true,
        message: retranscribeResults.length + ' session(s) triggered for re-transcription (old Mux subtitles cleaned).'
          + (isTranscriptOnly ? ' TRANSCRIPT-ONLY mode — will stop after Deepgram, no Claude.' : ' Full pipeline: MP4 → Deepgram → Claude.'),
        results: retranscribeResults
      });
    }

    // ── Deepgram Direct mode: skip Mux, send HLS URL to Deepgram with async callback ──
    // ?deepgram-direct=SESSION_ID  — send HLS playback URL to Deepgram's async API
    // &transcript-only=1           — stop after transcription, skip Claude summary/quiz
    // &url=CUSTOM_URL              — override the audio URL (default: HLS from recordingPlaybackId)
    if (params['deepgram-direct']) {
      var sessId = params['deepgram-direct'];
      var isTranscriptOnly = params['transcript-only'] === '1';
      var sess = all.find(function (item) { return item.id === sessId; });

      if (!sess) {
        return jsonResponse(404, { ok: false, error: 'Session not found: ' + sessId });
      }
      if (!sess.recordingPlaybackId && !params.url) {
        return jsonResponse(400, { ok: false, error: 'Session has no recordingPlaybackId and no ?url= provided' });
      }

      // Build the audio URL (HLS from Mux, or custom override)
      var audioUrl = params.url || ('https://stream.mux.com/' + sess.recordingPlaybackId + '.m3u8');

      // Build the callback URL — Deepgram will POST the result here when done
      var callbackSecret = encodeURIComponent(process.env.AI_INTERNAL_SECRET || '');
      var callbackMode = isTranscriptOnly ? 'transcript-only' : 'full';
      var callbackUrl = 'https://yogabible.dk/.netlify/functions/deepgram-webhook'
        + '?sessionId=' + sessId
        + '&secret=' + callbackSecret
        + '&mode=' + callbackMode;

      console.log('[ai-backfill] Deepgram-direct: sending to Deepgram async API');
      console.log('[ai-backfill] Audio URL:', audioUrl);
      console.log('[ai-backfill] Callback URL:', callbackUrl.replace(callbackSecret, '***'));

      // Reset status
      await updateDoc(COLLECTION, sessId, {
        aiStatus: 'deepgram_pending',
        aiError: null,
        aiTranscript: null,
        aiSummary: null,
        aiQuiz: null
      });

      // Send to Deepgram with callback — returns immediately with request_id
      var dgResult = await deepgramWithCallback(audioUrl, callbackUrl);

      return jsonResponse(200, {
        ok: true,
        message: 'Deepgram async transcription requested. Deepgram will POST the result to our webhook when done.'
          + (isTranscriptOnly ? ' TRANSCRIPT-ONLY mode.' : ' Full pipeline: Deepgram → Claude.'),
        id: sessId,
        title: sess.title_da || sess.title_en || '',
        audioUrl: audioUrl,
        deepgramRequestId: dgResult.request_id || null
      });
    }

    // ── MP4 status check: query Mux directly to see if MP4 renditions are ready ──
    if (params['mp4-status'] === '1') {
      var withRecordings = all.filter(function (item) {
        return item.status === 'ended' && item.recordingAssetId;
      });

      var mp4Results = [];
      for (var m = 0; m < withRecordings.length; m++) {
        var sess = withRecordings[m];
        try {
          var asset = await muxRequest('GET', '/video/v1/assets/' + sess.recordingAssetId);
          var renditions = asset.data && asset.data.static_renditions;
          var mp4Support = asset.data && asset.data.mp4_support;
          var duration = asset.data && asset.data.duration;
          mp4Results.push({
            id: sess.id,
            title: (sess.title_da || sess.title_en || '').substring(0, 60),
            assetId: sess.recordingAssetId,
            mp4Support: mp4Support || 'none',
            renditionStatus: renditions ? renditions.status : 'none',
            durationMinutes: duration ? Math.round(duration / 60) : null,
            aiStatus: sess.aiStatus
          });
        } catch (err) {
          mp4Results.push({ id: sess.id, title: sess.title_da || '', error: err.message });
        }
      }

      return jsonResponse(200, { ok: true, results: mp4Results });
    }

    // ── Enable MP4 only (no processing): request MP4 renditions without triggering pipeline ──
    if (params['enable-mp4'] === '1') {
      var withRecordings = all.filter(function (item) {
        return item.status === 'ended' && item.recordingAssetId;
      });

      var enableResults = [];
      for (var e2 = 0; e2 < withRecordings.length; e2++) {
        var sess = withRecordings[e2];
        try {
          var asset = await muxRequest('GET', '/video/v1/assets/' + sess.recordingAssetId);
          var renditions = asset.data && asset.data.static_renditions;
          if (renditions && renditions.status === 'ready') {
            enableResults.push({ id: sess.id, title: (sess.title_da || '').substring(0, 60), status: 'already_ready' });
          } else {
            var patchResult = await muxRequest('PATCH', '/video/v1/assets/' + sess.recordingAssetId, { mp4_support: 'capped-1080p' });
            var patchMp4 = patchResult.data && patchResult.data.mp4_support;
            var patchRenditions = patchResult.data && patchResult.data.static_renditions;
            enableResults.push({
              id: sess.id,
              title: (sess.title_da || '').substring(0, 60),
              status: 'mp4_requested',
              mp4Support: patchMp4 || 'none',
              renditionStatus: patchRenditions ? patchRenditions.status : 'none'
            });
          }
        } catch (err) {
          enableResults.push({ id: sess.id, title: sess.title_da || '', status: 'error', error: err.message });
        }
      }

      return jsonResponse(200, {
        ok: true,
        message: 'MP4 renditions requested. Use ?mp4-status=1 to check when ready, then ?retranscribe=all to process.',
        results: enableResults
      });
    }

    // ── Generate subtitles mode: request Mux auto-generated captions (fallback when MP4 doesn't work) ──
    if (params['generate-subtitles'] === '1') {
      var withRecordings = all.filter(function (item) {
        return item.status === 'ended' && item.recordingAssetId;
      });

      var subtitleResults = [];
      for (var s2 = 0; s2 < withRecordings.length; s2++) {
        var sess = withRecordings[s2];
        try {
          // Check existing tracks
          var asset = await muxRequest('GET', '/video/v1/assets/' + sess.recordingAssetId);
          var tracks = (asset.data && asset.data.tracks) || [];
          var hasAutoSubs = false;
          for (var t = 0; t < tracks.length; t++) {
            if (tracks[t].type === 'text' && tracks[t].text_type === 'subtitles' && tracks[t].status === 'ready') {
              hasAutoSubs = true;
              break;
            }
          }

          if (hasAutoSubs) {
            subtitleResults.push({ id: sess.id, title: (sess.title_da || '').substring(0, 60), status: 'already_has_subtitles' });
          } else {
            // Request auto-generated subtitles from Mux
            var trackResult = await muxRequest('POST', '/video/v1/assets/' + sess.recordingAssetId + '/tracks', {
              type: 'text',
              text_type: 'subtitles',
              language_code: 'en',
              name: 'English CC',
              closed_captions: true
            });
            var trackId = trackResult.data && trackResult.data.id;
            subtitleResults.push({
              id: sess.id,
              title: (sess.title_da || '').substring(0, 60),
              status: 'subtitles_requested',
              trackId: trackId
            });
          }
        } catch (err) {
          subtitleResults.push({ id: sess.id, title: sess.title_da || '', status: 'error', error: err.message });
        }
      }

      return jsonResponse(200, {
        ok: true,
        message: 'Subtitle tracks requested. Use ?subtitle-status=1 to check when ready, then ?retranscribe=all to process.',
        results: subtitleResults
      });
    }

    // ── Subtitle status check: see if auto-generated subtitles are ready ──
    if (params['subtitle-status'] === '1') {
      var withRecordings = all.filter(function (item) {
        return item.status === 'ended' && item.recordingAssetId;
      });

      var subStatusResults = [];
      for (var ss = 0; ss < withRecordings.length; ss++) {
        var sess = withRecordings[ss];
        try {
          var asset = await muxRequest('GET', '/video/v1/assets/' + sess.recordingAssetId);
          var tracks = (asset.data && asset.data.tracks) || [];
          var subtitleTracks = [];
          for (var st = 0; st < tracks.length; st++) {
            if (tracks[st].type === 'text') {
              subtitleTracks.push({
                id: tracks[st].id,
                status: tracks[st].status,
                name: tracks[st].name || '',
                language: tracks[st].language_code || ''
              });
            }
          }
          var duration = asset.data && asset.data.duration;
          subStatusResults.push({
            id: sess.id,
            title: (sess.title_da || sess.title_en || '').substring(0, 60),
            assetId: sess.recordingAssetId,
            durationMinutes: duration ? Math.round(duration / 60) : null,
            subtitleTracks: subtitleTracks,
            aiStatus: sess.aiStatus
          });
        } catch (err) {
          subStatusResults.push({ id: sess.id, title: sess.title_da || '', error: err.message });
        }
      }

      return jsonResponse(200, { ok: true, results: subStatusResults });
    }

    // ── Check mode (Phase 2): find stuck sessions and re-trigger processing ──
    if (params.check === '1') {
      var waiting = all.filter(function (item) {
        return item.status === 'ended'
          && item.recordingAssetId
          && (item.aiStatus === 'preparing_audio' || item.aiStatus === 'transcribing'
              || item.aiStatus === 'processing' || item.aiStatus === 'captions_requested'
              || item.aiStatus === 'captions_pending' || item.aiStatus === 'subtitle_pending' || item.aiStatus === 'mp4_pending'
              || item.aiStatus === 'deepgram_pending');
      });

      if (waiting.length === 0) {
        return jsonResponse(200, { ok: true, message: 'No stuck sessions found.' });
      }

      console.log('[ai-backfill] Found', waiting.length, 'stuck sessions — re-triggering processing');
      var checkResults = [];

      for (var c = 0; c < waiting.length; c++) {
        var sess = waiting[c];
        try {
          // Reset status and re-trigger the background function
          await updateDoc(COLLECTION, sess.id, { aiStatus: null, aiError: null });
          await callAiProcess(sess.id, sess.recordingAssetId);
          checkResults.push({ id: sess.id, title: sess.title_da || '', status: 're-triggered' });
          console.log('[ai-backfill] Re-triggered:', sess.id);
        } catch (err) {
          console.error('[ai-backfill] Check error for', sess.id, ':', err.message);
          checkResults.push({ id: sess.id, title: sess.title_da || '', status: 'error', error: err.message });
        }
      }

      return jsonResponse(200, {
        ok: true,
        message: 'Check complete. Stuck sessions re-triggered.',
        results: checkResults
      });
    }

    // ── Reprocess mode: re-run Claude on a specific session (uses existing transcript) ──
    // ?reprocess=SESSION_ID  — optionally &lang=en to force language
    if (params.reprocess) {
      var sessId = params.reprocess;
      var sess = all.find(function (item) { return item.id === sessId; });
      if (!sess) {
        return jsonResponse(404, { ok: false, error: 'Session not found: ' + sessId });
      }

      // Use existing transcript or re-download from Mux
      var transcript = sess.aiTranscript || '';
      if (!transcript && sess.recordingPlaybackId && sess.recordingAssetId) {
        // Try to get VTT from Mux
        var tracksResult = await muxRequest('GET', '/video/v1/assets/' + sess.recordingAssetId);
        var tracks = (tracksResult.data && tracksResult.data.tracks) || [];
        var readyTrack = null;
        for (var t = 0; t < tracks.length; t++) {
          if (tracks[t].type === 'text' && tracks[t].text_type === 'subtitles' && tracks[t].status === 'ready') {
            readyTrack = tracks[t]; break;
          }
        }
        if (readyTrack) {
          transcript = await downloadVTT('https://stream.mux.com/' + sess.recordingPlaybackId + '/text/' + readyTrack.id + '.vtt');
        }
      }

      if (!transcript || transcript.length < 50) {
        return jsonResponse(400, { ok: false, error: 'No transcript available for session ' + sessId });
      }

      var sessionTitle = sess.title_da || sess.title_en || 'Yoga Class';
      var sessionInstructor = sess.instructor || '';
      var aiResult = await generateSummaryAndQuiz(transcript, sessionTitle, sessionInstructor, params.lang || null, !!sess.interactive);

      await updateDoc(COLLECTION, sessId, {
        aiStatus: 'complete',
        aiTranscript: transcript.substring(0, 50000),
        aiSummary: aiResult.summary || '',
        aiSummaryLang: aiResult.lang || 'en',
        aiQuiz: JSON.stringify(aiResult.quiz || []),
        aiProcessedAt: new Date().toISOString()
      });

      return jsonResponse(200, {
        ok: true,
        message: 'Reprocessed session ' + sessId + ' in ' + aiResult.lang,
        id: sessId,
        title: sessionTitle,
        lang: aiResult.lang
      });
    }

    // ── Default mode (Phase 1): trigger caption requests for sessions with recordings ──
    var pending = all.filter(function (item) {
      return item.status === 'ended'
        && item.recordingAssetId
        && (!item.aiStatus || item.aiStatus === 'error' || item.aiStatus === 'captions_pending' || item.aiStatus === 'subtitle_pending' || item.aiStatus === 'mp4_pending');
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

function generateSummaryAndQuiz(transcript, title, instructor, forceLang, isInteractive) {
  // Detect language from transcript (or use forced language)
  // Use only unambiguous words (no overlap between languages)
  // Danish-only words (never appear in English yoga instruction)
  var daWords = ['og', 'til', 'din', 'det', 'som', 'har', 'den', 'ikke', 'kan', 'skal', 'godt', 'pust', 'ånd', 'stræk', 'krop', 'ben', 'arme', 'ryg', 'vi', 'jer', 'dig', 'ser', 'ned', 'op', 'er', 'en', 'et', 'jeg', 'nu', 'lige', 'også', 'så', 'bare', 'igen', 'lidt', 'helt', 'venstre', 'højre'];
  // English-only words (never appear in Danish yoga instruction)
  var enWords = ['the', 'and', 'your', 'you', 'that', 'this', 'have', 'not', 'breathe', 'stretch', 'body', 'arms', 'legs', 'inhale', 'exhale', 'is', 'are', 'we', 'go', 'into', 'let', 'just', 'now', 'right', 'left', 'down', 'up', 'here', 'feel', 'bring', 'keep', 'through', 'then', 'going', 'want', 'make', 'take', 'come'];

  var words = transcript.toLowerCase().split(/\s+/).slice(0, 500);
  var daScore = 0, enScore = 0;
  for (var i = 0; i < words.length; i++) {
    if (daWords.indexOf(words[i]) !== -1) daScore++;
    if (enWords.indexOf(words[i]) !== -1) enScore++;
  }
  // Default to English on tie (most yoga instruction is English)
  var lang = forceLang || (daScore > enScore ? 'da' : 'en');
  console.log('[ai-backfill] Language detection — DA:', daScore, 'EN:', enScore, '→', lang, forceLang ? '(forced)' : '');

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

  // Interactive session: add multi-speaker handling instructions
  if (isInteractive) {
    var interactiveInstructions = lang === 'da'
      ? '\n\nINTERAKTIV SESSION — Flerspeaker-håndtering:\n'
        + 'Denne optagelse er fra en interaktiv session med flere deltagere (Zoom-stil gruppeundervisning). '
        + 'Der vil være flere stemmer i transskriptionen.\n\n'
        + (instructor ? 'UNDERVISER: ' + instructor + ' — denne persons udtalelser er det primære faglige indhold.\n' : '')
        + 'REGLER:\n'
        + '- Underviseren er den autoritative kilde. Prioritér undervisernes forklaringer, instruktioner og svar.\n'
        + '- Studerendes spørgsmål: Medtag vigtige faglige spørgsmål som "Diskussionspunkter" i opsummeringen — men kun spørgsmål der fører til fagligt værdifulde svar fra underviseren.\n'
        + '- IGNORÉR studerendes small talk, personlige kommentarer, "ja/nej"-svar og casual snak mellem deltagere.\n'
        + '- Hvis en studerende stiller et godt spørgsmål og underviseren svarer uddybende, medtag BÅDE spørgsmålet og svaret.\n'
        + '- Quiz-spørgsmål skal baseres på undervisernes svar, IKKE på studerendes udtalelser.\n'
      : '\n\nINTERACTIVE SESSION — Multi-Speaker Handling:\n'
        + 'This recording is from an interactive session with multiple participants (Zoom-style group class). '
        + 'There will be multiple voices in the transcript.\n\n'
        + (instructor ? 'INSTRUCTOR: ' + instructor + ' — this person\'s statements are the primary educational content.\n' : '')
        + 'RULES:\n'
        + '- The instructor is the authoritative source. Prioritize the instructor\'s explanations, instructions, and answers.\n'
        + '- Student questions: Include important educational questions as "Discussion Points" in the summary — but only questions that led to valuable answers from the instructor.\n'
        + '- IGNORE student small talk, personal comments, "yes/no" responses, and casual chat between participants.\n'
        + '- If a student asks a good question and the instructor gives an in-depth answer, include BOTH the question and answer.\n'
        + '- Quiz questions must be based on the instructor\'s answers, NOT on student statements.\n';

    focusInstructions += interactiveInstructions;
  }

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
        console.error('[ai-backfill] Failed to parse Claude response:', response.substring(0, 500));
        parsed = { summary: '', quiz: [] };
      }
      return { summary: parsed.summary || '', quiz: parsed.quiz || [], lang: lang };
    });
}

/* ── Deepgram async transcription with callback ── */

function deepgramWithCallback(audioUrl, callbackUrl) {
  var apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) throw new Error('DEEPGRAM_API_KEY env var required');

  return new Promise(function (resolve, reject) {
    var body = JSON.stringify({ url: audioUrl });
    var queryParams = 'model=nova-2&detect_language=true&smart_format=true&paragraphs=true'
      + '&callback=' + encodeURIComponent(callbackUrl);

    var opts = {
      hostname: 'api.deepgram.com',
      path: '/v1/listen?' + queryParams,
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
        console.log('[ai-backfill] Deepgram callback response:', res.statusCode, raw.substring(0, 300));
        try {
          var json = JSON.parse(raw);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            reject(new Error('Deepgram API error ' + res.statusCode + ': ' + raw.substring(0, 300)));
          }
        } catch (e) {
          reject(new Error('Deepgram parse error: ' + raw.substring(0, 300)));
        }
      });
    });

    req.setTimeout(30000, function () {
      req.destroy();
      reject(new Error('Deepgram callback request timed out'));
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/* ── Call ai-process-recording (Phase 1 trigger) ── */

function callAiProcess(sessionId, assetId, extraOpts) {
  extraOpts = extraOpts || {};
  var payload = {
    sessionId: sessionId,
    assetId: assetId,
    secret: process.env.AI_INTERNAL_SECRET || ''
  };
  if (extraOpts.transcriptOnly) payload.transcriptOnly = true;
  if (extraOpts.directUrl) payload.directUrl = extraOpts.directUrl;
  return new Promise(function (resolve, reject) {
    var body = JSON.stringify(payload);

    var opts = {
      hostname: 'yogabible.dk',
      path: '/.netlify/functions/ai-process-recording-background',
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
