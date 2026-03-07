/**
 * Teacher Studio — Browser-based live streaming for teachers.
 *
 * Uses LiveKit Cloud for real-time video streaming. The teacher publishes
 * camera + microphone to a LiveKit Room. Students subscribe on /live.
 *
 * Flow:
 * 1. Teacher authenticates → role check (teacher/admin only)
 * 2. Teacher selects upcoming session → camera/mic preview starts
 * 3. Teacher clicks "Go Live" → creates LiveKit room via API → connects + publishes
 * 4. Stream is live → students see it on /live via LiveKit subscribe
 * 5. Teacher clicks "End Stream" → disconnects from room, room is deleted
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

  // ── State ──
  var mediaStream = null;
  var livekitRoom = null;    // LiveKit Room instance
  var selectedSession = null;
  var activeRoomName = null;
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

    var cards = sessionList.querySelectorAll('.yts-sessions__item');
    for (var j = 0; j < cards.length; j++) {
      cards[j].addEventListener('click', handleSessionClick);
    }
  }

  function handleSessionClick(e) {
    if (isLive) return;

    var el = e.currentTarget;
    var sessionData = JSON.parse(el.dataset.session);

    var all = sessionList.querySelectorAll('.yts-sessions__item');
    for (var i = 0; i < all.length; i++) {
      all[i].classList.remove('yts-sessions__item--selected');
    }
    el.classList.add('yts-sessions__item--selected');

    selectedSession = sessionData;
    updateGoLiveState();
  }

  // ═══════════════════════════════════════════════════════
  // CAMERA & MICROPHONE — preview + device selection
  // ═══════════════════════════════════════════════════════
  function getConstraints() {
    var quality = qualitySelect ? qualitySelect.value : '720';
    var videoConstraints = {};

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
    var constraints = getConstraints();
    navigator.mediaDevices.getUserMedia(constraints)
      .then(handleStream)
      .catch(function (err) {
        console.warn('[teacher-studio] full constraints failed:', err.name, err.message);
        // If video failed (no camera), try audio-only so mic still works
        if (constraints.video && constraints.audio) {
          return navigator.mediaDevices.getUserMedia({ video: false, audio: constraints.audio })
            .then(handleStream);
        }
        throw err;
      })
      .catch(function (err) {
        console.error('[teacher-studio] camera error:', err.name, err.message);
        if (err.name === 'NotAllowedError') {
          alert(tPermissionDenied);
        } else if (err.name === 'NotFoundError' || err.name === 'NotReadableError') {
          alert(isDa ? 'Ingen kamera eller mikrofon fundet.' : 'No camera or microphone found.');
        } else {
          alert((isDa ? 'Kamerafejl: ' : 'Camera error: ') + err.message);
        }
      });
  }

  function handleStream(stream) {
    mediaStream = stream;
    previewVideo.srcObject = stream;
    if (stream.getVideoTracks().length > 0) {
      placeholder.classList.add('yts-preview__placeholder--hidden');
    }
    devicesPanel.style.display = '';
    enumerateDevices();
    updateGoLiveState();
  }

  function enumerateDevices() {
    navigator.mediaDevices.enumerateDevices().then(function (devices) {
      var cameras = devices.filter(function (d) { return d.kind === 'videoinput'; });
      var mics = devices.filter(function (d) { return d.kind === 'audioinput'; });

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
      goLiveBtn.disabled = !(selectedSession && !isLive);
    }
  }

  // ═══════════════════════════════════════════════════════
  // GO LIVE — request camera (if needed) + create LiveKit room + publish
  // ═══════════════════════════════════════════════════════
  function goLive() {
    if (!selectedSession) {
      alert(tNoSession);
      return;
    }

    setStatus('connecting');
    goLiveBtn.disabled = true;

    // If camera not started yet, request it now
    if (!mediaStream) {
      var constraints = getConstraints();
      navigator.mediaDevices.getUserMedia(constraints)
        .then(function (stream) {
          handleStream(stream);
          doGoLive();
        })
        .catch(function (err) {
          console.warn('[teacher-studio] full constraints failed:', err.name, err.message);
          // If video failed (no camera), try audio-only
          if (constraints.video && constraints.audio) {
            return navigator.mediaDevices.getUserMedia({ video: false, audio: constraints.audio })
              .then(function (stream) {
                handleStream(stream);
                doGoLive();
              });
          }
          throw err;
        })
        .catch(function (err) {
          console.error('[teacher-studio] camera error:', err.name, err.message);
          setStatus('error');
          goLiveBtn.disabled = false;
          if (err.name === 'NotAllowedError') {
            alert(tPermissionDenied);
          } else if (err.name === 'NotFoundError' || err.name === 'NotReadableError') {
            alert(isDa ? 'Ingen kamera eller mikrofon fundet.' : 'No camera or microphone found.');
          } else {
            alert((isDa ? 'Kamerafejl: ' : 'Camera error: ') + err.message);
          }
        });
      return;
    }

    doGoLive();
  }

  function doGoLive() {

    var user = firebase.auth().currentUser;
    if (!user) return;

    user.getIdToken().then(function (token) {
      return fetch('/.netlify/functions/livekit-token?action=create-room', {
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
        throw new Error(data.error || 'Failed to create room');
      }

      activeRoomName = data.roomName;
      console.log('[teacher-studio] Room created:', activeRoomName);

      return connectLiveKit(data.wsUrl, data.token);
    })
    .then(function () {
      isLive = true;
      setStatus('live');
      goLiveBtn.style.display = 'none';
      endStreamBtn.style.display = '';
      liveBadge.style.display = '';
      startElapsed();

      // Update session status to live in Firestore via existing mux-stream endpoint
      var user2 = firebase.auth().currentUser;
      if (user2) {
        user2.getIdToken().then(function (token) {
          fetch('/.netlify/functions/live-admin?action=set-live', {
            method: 'POST',
            headers: {
              'Authorization': 'Bearer ' + token,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              sessionId: selectedSession.id,
              livekitRoom: activeRoomName
            })
          }).catch(function () {});
        });
      }
    })
    .catch(function (err) {
      console.error('[teacher-studio] go live error:', err);
      setStatus('error');
      goLiveBtn.disabled = false;
    });
  }

  if (goLiveBtn) goLiveBtn.addEventListener('click', goLive);

  // ═══════════════════════════════════════════════════════
  // LIVEKIT — connect to room + publish tracks
  // ═══════════════════════════════════════════════════════

  /**
   * Connect to LiveKit room and publish local tracks.
   * Uses the livekit-client SDK loaded via CDN.
   */
  function connectLiveKit(wsUrl, token) {
    return new Promise(function (resolve, reject) {
      if (typeof LivekitClient === 'undefined') {
        reject(new Error('LiveKit SDK not loaded. Please refresh the page.'));
        return;
      }

      var room = new LivekitClient.Room({
        adaptiveStream: true,
        dynacast: true,
        videoCaptureDefaults: {
          resolution: LivekitClient.VideoPresets.h720.resolution
        }
      });

      livekitRoom = room;

      // Monitor connection state
      room.on(LivekitClient.RoomEvent.Disconnected, function () {
        console.log('[teacher-studio] Disconnected from LiveKit room');
        if (isLive) {
          setStatus('error');
        }
      });

      room.on(LivekitClient.RoomEvent.Reconnecting, function () {
        console.log('[teacher-studio] Reconnecting to LiveKit room…');
      });

      room.on(LivekitClient.RoomEvent.Reconnected, function () {
        console.log('[teacher-studio] Reconnected to LiveKit room');
        if (isLive) setStatus('live');
      });

      // Connect to the room
      room.connect(wsUrl, token).then(function () {
        console.log('[teacher-studio] Connected to LiveKit room:', room.name);

        // Publish local tracks from our existing mediaStream
        var videoTrack = mediaStream.getVideoTracks()[0];
        var audioTrack = mediaStream.getAudioTracks()[0];

        var publishPromises = [];

        if (videoTrack) {
          var localVideo = new LivekitClient.LocalVideoTrack(videoTrack);
          publishPromises.push(
            room.localParticipant.publishTrack(localVideo, {
              source: LivekitClient.Track.Source.Camera,
              simulcast: true
            })
          );
        }

        if (audioTrack) {
          var localAudio = new LivekitClient.LocalAudioTrack(audioTrack);
          publishPromises.push(
            room.localParticipant.publishTrack(localAudio, {
              source: LivekitClient.Track.Source.Microphone
            })
          );
        }

        return Promise.all(publishPromises);
      }).then(function () {
        console.log('[teacher-studio] Tracks published to LiveKit room');
        resolve();
      }).catch(function (err) {
        room.disconnect();
        livekitRoom = null;
        reject(err);
      });
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

    // Disconnect from LiveKit room
    if (livekitRoom) {
      livekitRoom.disconnect();
      livekitRoom = null;
    }

    // Tell backend to close the room and update session status
    if (activeRoomName) {
      var user = firebase.auth().currentUser;
      if (user) {
        user.getIdToken().then(function (token) {
          fetch('/.netlify/functions/livekit-token?action=close-room', {
            method: 'POST',
            headers: {
              'Authorization': 'Bearer ' + token,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              roomName: activeRoomName,
              sessionId: selectedSession ? selectedSession.id : null
            })
          }).catch(function () {});
        });
      }
      activeRoomName = null;
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
