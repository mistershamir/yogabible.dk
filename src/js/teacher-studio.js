/**
 * Teacher Studio — Browser-based live streaming for teachers.
 *
 * Uses Mux WHIP (WebRTC HTTP Ingestion Protocol) to stream camera/mic
 * directly from the browser to Mux. The same webhook pipeline
 * (mux-webhook.js) handles the lifecycle — no changes needed downstream.
 *
 * Flow:
 * 1. Teacher authenticates → role check (teacher/admin only)
 * 2. Teacher selects upcoming session → camera/mic preview starts
 * 3. Teacher clicks "Go Live" → creates Mux live stream via API → connects via WHIP
 * 4. Stream is live → students see it on /live, recording happens automatically
 * 5. Teacher clicks "End Stream" → WHIP connection closed, Mux stream completed
 */
(function () {
  'use strict';

  var root = document.getElementById('yts-root');
  if (!root) return;

  // ── Elements ──
  var gate = document.getElementById('yts-gate');
  var studio = document.getElementById('yts-studio');
  var previewVideo = document.getElementById('yts-preview-video');
  var placeholder = document.getElementById('yts-placeholder');
  var startCameraBtn = document.getElementById('yts-start-camera');
  var devicesPanel = document.getElementById('yts-devices');
  var cameraSelect = document.getElementById('yts-camera-select');
  var micSelect = document.getElementById('yts-mic-select');
  var qualitySelect = document.getElementById('yts-quality-select');
  var sessionList = document.getElementById('yts-session-list');
  var statusEl = document.getElementById('yts-status');
  var statusDot = document.getElementById('yts-status-dot');
  var statusText = document.getElementById('yts-status-text');
  var goLiveBtn = document.getElementById('yts-go-live');
  var endStreamBtn = document.getElementById('yts-end-stream');
  var liveBadge = document.getElementById('yts-live-badge');
  var elapsedEl = document.getElementById('yts-elapsed');
  var elapsedTimeEl = document.getElementById('yts-elapsed-time');

  // ── i18n data attributes ──
  var lang = root.dataset.lang || 'da';
  var isDa = lang === 'da';
  var tToday = root.dataset.tToday || 'I dag';
  var tTomorrow = root.dataset.tTomorrow || 'I morgen';
  var tLiveNow = root.dataset.tLiveNow || 'LIVE NU';
  var tEmpty = root.dataset.tEmpty || '';
  var tConnecting = root.dataset.tConnecting || 'Connecting…';
  var tLive = root.dataset.tLive || 'You are LIVE';
  var tEnded = root.dataset.tEnded || 'Stream ended';
  var tError = root.dataset.tError || 'Connection error';
  var tIdle = root.dataset.tIdle || 'Ready';
  var tConfirmEnd = root.dataset.tConfirmEnd || 'End the stream?';
  var tPermissionDenied = root.dataset.tPermissionDenied || 'Permission denied.';
  var tNoSession = root.dataset.tNoSession || 'Select a session first.';
  var tWhipNotSupported = root.dataset.tWhipNotSupported || 'Browser not supported.';

  // ── State ──
  var mediaStream = null;
  var peerConnection = null;
  var selectedSession = null;
  var activeStreamId = null;
  var activeWhipUrl = null;
  var isLive = false;
  var elapsedTimer = null;
  var liveStartTime = null;

  // ═══════════════════════════════════════════════════════
  // AUTH GATE — show studio only for teacher/admin
  // ═══════════════════════════════════════════════════════
  function checkAuth() {
    if (typeof firebase === 'undefined' || !firebase.auth) return;

    firebase.auth().onAuthStateChanged(function (user) {
      if (!user) {
        gate.style.display = '';
        studio.style.display = 'none';
        return;
      }

      // Check Firestore role
      firebase.firestore().collection('users').doc(user.uid).get()
        .then(function (doc) {
          var role = doc.exists ? (doc.data().role || 'member') : 'member';
          if (role === 'teacher' || role === 'admin') {
            gate.style.display = 'none';
            studio.style.display = '';
            fetchSessions();
          } else {
            gate.style.display = '';
            studio.style.display = 'none';
          }
        })
        .catch(function () {
          gate.style.display = '';
          studio.style.display = 'none';
        });
    });
  }

  // ═══════════════════════════════════════════════════════
  // SESSION PICKER — fetch teacher's sessions
  // ═══════════════════════════════════════════════════════
  var MONTHS_DA = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  var MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function isToday(d) {
    var now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  }

  function isTomorrow(d) {
    var tom = new Date();
    tom.setDate(tom.getDate() + 1);
    return d.getFullYear() === tom.getFullYear() && d.getMonth() === tom.getMonth() && d.getDate() === tom.getDate();
  }

  function fetchSessions() {
    var user = firebase.auth().currentUser;
    if (!user) return;

    user.getIdToken().then(function (token) {
      return fetch('/.netlify/functions/mux-stream?action=teacher-sessions', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.ok) renderSessions(data.items || []);
    })
    .catch(function (err) {
      console.error('[teacher-studio] fetch sessions error:', err);
    });
  }

  function renderSessions(items) {
    if (!items.length) {
      sessionList.innerHTML = '<div class="yts-sessions__empty">' + esc(tEmpty) + '</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var d = new Date(item.startDateTime);
      var day = d.getDate();
      var months = isDa ? MONTHS_DA : MONTHS_EN;
      var monthLabel = months[d.getMonth()];
      var hours = String(d.getHours()).padStart(2, '0');
      var mins = String(d.getMinutes()).padStart(2, '0');
      var startTime = hours + ':' + mins;
      var endTime = '';
      if (item.endDateTime) {
        var de = new Date(item.endDateTime);
        endTime = ' – ' + String(de.getHours()).padStart(2, '0') + ':' + String(de.getMinutes()).padStart(2, '0');
      }
      var title = isDa ? (item.title_da || item.title_en || '') : (item.title_en || item.title_da || '');
      var isItemLive = item.status === 'live';

      var dayLabel = '';
      if (isToday(d)) dayLabel = tToday;
      else if (isTomorrow(d)) dayLabel = tTomorrow;

      var tag = '';
      if (isItemLive) {
        tag = '<span class="yts-sessions__item-tag yts-sessions__item-tag--live">' + tLiveNow + '</span>';
      }

      html += '<div class="yts-sessions__item" data-session-id="' + esc(item.id) + '" data-session=\'' + JSON.stringify(item).replace(/'/g, '&#39;') + '\'>';
      html += '<div class="yts-sessions__item-date">';
      if (dayLabel) html += '<div class="yts-sessions__item-day-label">' + esc(dayLabel) + '</div>';
      html += '<div class="yts-sessions__item-day">' + day + '. ' + esc(monthLabel) + '</div>';
      html += '</div>';
      html += '<div class="yts-sessions__item-info">';
      html += '<p class="yts-sessions__item-name">' + esc(title) + '</p>';
      html += '<span class="yts-sessions__item-time">' + startTime + endTime + '</span>';
      html += '</div>';
      html += tag;
      html += '</div>';
    }

    sessionList.innerHTML = html;

    // Bind click handlers
    var cards = sessionList.querySelectorAll('.yts-sessions__item');
    for (var j = 0; j < cards.length; j++) {
      cards[j].addEventListener('click', handleSessionClick);
    }
  }

  function handleSessionClick(e) {
    if (isLive) return; // Can't switch sessions while live

    var el = e.currentTarget;
    var sessionData = JSON.parse(el.dataset.session);

    // Update selection UI
    var all = sessionList.querySelectorAll('.yts-sessions__item');
    for (var i = 0; i < all.length; i++) {
      all[i].classList.remove('yts-sessions__item--selected');
    }
    el.classList.add('yts-sessions__item--selected');

    selectedSession = sessionData;

    // Enable go-live button if camera is on
    updateGoLiveState();
  }

  // ═══════════════════════════════════════════════════════
  // CAMERA & MICROPHONE — preview + device selection
  // ═══════════════════════════════════════════════════════
  function getConstraints() {
    var quality = qualitySelect ? qualitySelect.value : '720';
    var videoConstraints = { facingMode: 'user' };

    if (quality === '1080') {
      videoConstraints.width = { ideal: 1920 };
      videoConstraints.height = { ideal: 1080 };
    } else if (quality === '720') {
      videoConstraints.width = { ideal: 1280 };
      videoConstraints.height = { ideal: 720 };
    } else {
      videoConstraints.width = { ideal: 854 };
      videoConstraints.height = { ideal: 480 };
    }

    if (cameraSelect && cameraSelect.value) {
      videoConstraints.deviceId = { exact: cameraSelect.value };
    }

    var audioConstraints = true;
    if (micSelect && micSelect.value) {
      audioConstraints = { deviceId: { exact: micSelect.value } };
    }

    return { video: videoConstraints, audio: audioConstraints };
  }

  function startCamera() {
    navigator.mediaDevices.getUserMedia(getConstraints())
      .then(function (stream) {
        mediaStream = stream;
        previewVideo.srcObject = stream;
        placeholder.classList.add('yts-preview__placeholder--hidden');
        devicesPanel.style.display = '';
        enumerateDevices();
        updateGoLiveState();
      })
      .catch(function (err) {
        console.error('[teacher-studio] camera error:', err);
        alert(tPermissionDenied);
      });
  }

  function enumerateDevices() {
    navigator.mediaDevices.enumerateDevices().then(function (devices) {
      var cameras = devices.filter(function (d) { return d.kind === 'videoinput'; });
      var mics = devices.filter(function (d) { return d.kind === 'audioinput'; });

      // Current device IDs
      var currentCam = '';
      var currentMic = '';
      if (mediaStream) {
        var vt = mediaStream.getVideoTracks()[0];
        var at = mediaStream.getAudioTracks()[0];
        if (vt) currentCam = vt.getSettings().deviceId || '';
        if (at) currentMic = at.getSettings().deviceId || '';
      }

      cameraSelect.innerHTML = '';
      for (var i = 0; i < cameras.length; i++) {
        var opt = document.createElement('option');
        opt.value = cameras[i].deviceId;
        opt.textContent = cameras[i].label || ('Camera ' + (i + 1));
        if (cameras[i].deviceId === currentCam) opt.selected = true;
        cameraSelect.appendChild(opt);
      }

      micSelect.innerHTML = '';
      for (var j = 0; j < mics.length; j++) {
        var opt2 = document.createElement('option');
        opt2.value = mics[j].deviceId;
        opt2.textContent = mics[j].label || ('Mic ' + (j + 1));
        if (mics[j].deviceId === currentMic) opt2.selected = true;
        micSelect.appendChild(opt2);
      }
    });
  }

  function switchDevice() {
    if (!mediaStream) return;
    // Stop current tracks
    mediaStream.getTracks().forEach(function (t) { t.stop(); });
    startCamera();
  }

  if (startCameraBtn) startCameraBtn.addEventListener('click', startCamera);
  if (cameraSelect) cameraSelect.addEventListener('change', switchDevice);
  if (micSelect) micSelect.addEventListener('change', switchDevice);
  if (qualitySelect) qualitySelect.addEventListener('change', function () {
    if (mediaStream && !isLive) switchDevice();
  });

  function updateGoLiveState() {
    if (goLiveBtn) {
      goLiveBtn.disabled = !(mediaStream && selectedSession && !isLive);
    }
  }

  // ═══════════════════════════════════════════════════════
  // GO LIVE — create Mux stream + connect via WHIP
  // ═══════════════════════════════════════════════════════
  function goLive() {
    if (!selectedSession) {
      alert(tNoSession);
      return;
    }
    if (!mediaStream) {
      startCamera();
      return;
    }

    setStatus('connecting');
    goLiveBtn.disabled = true;

    var user = firebase.auth().currentUser;
    if (!user) return;

    user.getIdToken().then(function (token) {
      return fetch('/.netlify/functions/mux-stream?action=create-stream', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sessionId: selectedSession.id })
      });
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data.ok) {
        throw new Error(data.error || 'Failed to create stream');
      }

      activeStreamId = data.streamId;
      activeWhipUrl = data.whipUrl;

      console.log('[teacher-studio] Stream created:', activeStreamId);
      console.log('[teacher-studio] WHIP URL:', activeWhipUrl);

      return connectWhip(activeWhipUrl, mediaStream);
    })
    .then(function () {
      isLive = true;
      setStatus('live');
      goLiveBtn.style.display = 'none';
      endStreamBtn.style.display = '';
      liveBadge.style.display = '';
      startElapsed();
    })
    .catch(function (err) {
      console.error('[teacher-studio] go live error:', err);
      setStatus('error');
      goLiveBtn.disabled = false;
    });
  }

  if (goLiveBtn) goLiveBtn.addEventListener('click', goLive);

  // ═══════════════════════════════════════════════════════
  // WHIP — WebRTC HTTP Ingestion Protocol
  // ═══════════════════════════════════════════════════════

  /**
   * Connect to Mux via WHIP (WebRTC).
   * WHIP is a simple protocol: POST an SDP offer, get an SDP answer.
   * @see https://docs.mux.com/guides/stream-with-whip
   */
  function connectWhip(whipUrl, stream) {
    return new Promise(function (resolve, reject) {
      // Check RTCPeerConnection support
      if (typeof RTCPeerConnection === 'undefined') {
        reject(new Error(tWhipNotSupported));
        return;
      }

      var pc = new RTCPeerConnection({
        iceServers: [] // Mux handles ICE
      });
      peerConnection = pc;

      // Add local tracks to peer connection
      stream.getTracks().forEach(function (track) {
        pc.addTrack(track, stream);
      });

      // Set preferred codec to H264 for Mux compatibility
      var transceivers = pc.getTransceivers();
      for (var i = 0; i < transceivers.length; i++) {
        var t = transceivers[i];
        if (t.sender && t.sender.track && t.sender.track.kind === 'video') {
          var codecs = RTCRtpSender.getCapabilities
            ? RTCRtpSender.getCapabilities('video').codecs
            : [];
          var h264 = codecs.filter(function (c) {
            return c.mimeType === 'video/H264';
          });
          if (h264.length && t.setCodecPreferences) {
            // Put H264 first, keep others as fallback
            var rest = codecs.filter(function (c) { return c.mimeType !== 'video/H264'; });
            try { t.setCodecPreferences(h264.concat(rest)); } catch (e) { /* ignore */ }
          }
        }
      }

      // Create offer
      pc.createOffer().then(function (offer) {
        return pc.setLocalDescription(offer);
      }).then(function () {
        // Wait for ICE gathering to complete (or timeout after 2s)
        return waitForIce(pc, 2000);
      }).then(function () {
        // Send the SDP offer to Mux via WHIP
        return fetch(whipUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/sdp' },
          body: pc.localDescription.sdp
        });
      }).then(function (res) {
        if (!res.ok) {
          return res.text().then(function (body) {
            throw new Error('WHIP error (' + res.status + '): ' + body);
          });
        }
        // Store the resource URL for DELETE on end-stream
        var location = res.headers.get('Location');
        if (location) {
          // Resolve relative URLs
          if (location.startsWith('/')) {
            var urlObj = new URL(whipUrl);
            location = urlObj.origin + location;
          }
          activeWhipUrl = location;
        }
        return res.text();
      }).then(function (answerSdp) {
        return pc.setRemoteDescription({
          type: 'answer',
          sdp: answerSdp
        });
      }).then(function () {
        console.log('[teacher-studio] WHIP connected');
        resolve();
      }).catch(function (err) {
        pc.close();
        peerConnection = null;
        reject(err);
      });

      // Monitor connection state
      pc.onconnectionstatechange = function () {
        console.log('[teacher-studio] connection state:', pc.connectionState);
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          if (isLive) {
            setStatus('error');
          }
        }
      };
    });
  }

  /**
   * Wait for ICE gathering to complete (or timeout).
   */
  function waitForIce(pc, timeoutMs) {
    return new Promise(function (resolve) {
      if (pc.iceGatheringState === 'complete') {
        resolve();
        return;
      }

      var timer = setTimeout(function () {
        resolve(); // Proceed with whatever candidates we have
      }, timeoutMs);

      pc.onicegatheringstatechange = function () {
        if (pc.iceGatheringState === 'complete') {
          clearTimeout(timer);
          resolve();
        }
      };
    });
  }

  // ═══════════════════════════════════════════════════════
  // END STREAM
  // ═══════════════════════════════════════════════════════
  function endStream() {
    showConfirm(tConfirmEnd, function () {
      doEndStream();
    });
  }

  function doEndStream() {
    isLive = false;
    setStatus('ended');
    stopElapsed();
    liveBadge.style.display = 'none';
    endStreamBtn.style.display = 'none';
    goLiveBtn.style.display = '';
    goLiveBtn.disabled = true;

    // Close WHIP connection
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }

    // Send DELETE to WHIP resource URL (optional cleanup)
    if (activeWhipUrl) {
      fetch(activeWhipUrl, { method: 'DELETE' }).catch(function () {});
    }

    // Tell our backend to complete the Mux stream
    if (activeStreamId) {
      var user = firebase.auth().currentUser;
      if (user) {
        user.getIdToken().then(function (token) {
          fetch('/.netlify/functions/mux-stream?action=delete-stream', {
            method: 'POST',
            headers: {
              'Authorization': 'Bearer ' + token,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              streamId: activeStreamId,
              sessionId: selectedSession ? selectedSession.id : null
            })
          }).catch(function () {});
        });
      }
      activeStreamId = null;
    }

    // Refresh sessions
    setTimeout(fetchSessions, 2000);
  }

  if (endStreamBtn) endStreamBtn.addEventListener('click', endStream);

  // ═══════════════════════════════════════════════════════
  // STATUS + ELAPSED TIMER
  // ═══════════════════════════════════════════════════════
  function setStatus(state) {
    statusEl.className = 'yts-status yts-status--' + state;
    var labels = {
      idle: tIdle,
      connecting: tConnecting,
      live: tLive,
      ended: tEnded,
      error: tError
    };
    statusText.textContent = labels[state] || state;
  }

  function formatTime(totalSeconds) {
    var s = Math.floor(totalSeconds);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    var mm = m < 10 ? '0' + m : String(m);
    var ss = sec < 10 ? '0' + sec : String(sec);
    return h > 0 ? h + ':' + mm + ':' + ss : mm + ':' + ss;
  }

  function startElapsed() {
    liveStartTime = Date.now();
    elapsedEl.style.display = '';
    elapsedTimer = setInterval(function () {
      var elapsed = (Date.now() - liveStartTime) / 1000;
      elapsedTimeEl.textContent = formatTime(elapsed);
    }, 1000);
  }

  function stopElapsed() {
    if (elapsedTimer) {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
    elapsedEl.style.display = 'none';
  }

  // ═══════════════════════════════════════════════════════
  // CONFIRM DIALOG
  // ═══════════════════════════════════════════════════════
  function showConfirm(message, onConfirm) {
    var overlay = document.createElement('div');
    overlay.className = 'yts-confirm';
    overlay.innerHTML =
      '<div class="yts-confirm__box">' +
        '<p class="yts-confirm__text">' + esc(message) + '</p>' +
        '<div class="yts-confirm__actions">' +
          '<button class="yts-btn yts-btn--outline" data-action="cancel">' +
            (isDa ? 'Annuller' : 'Cancel') +
          '</button>' +
          '<button class="yts-btn yts-btn--end" data-action="confirm">' +
            (isDa ? 'Ja, afslut' : 'Yes, end it') +
          '</button>' +
        '</div>' +
      '</div>';

    overlay.querySelector('[data-action="cancel"]').addEventListener('click', function () {
      overlay.remove();
    });
    overlay.querySelector('[data-action="confirm"]').addEventListener('click', function () {
      overlay.remove();
      onConfirm();
    });

    document.body.appendChild(overlay);
  }

  // ═══════════════════════════════════════════════════════
  // BEFOREUNLOAD — warn if live
  // ═══════════════════════════════════════════════════════
  window.addEventListener('beforeunload', function (e) {
    if (isLive) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // ═══════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════
  checkAuth();
})();
