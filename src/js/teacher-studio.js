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
  var testStreamBtn = document.getElementById('yts-test-stream');

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
  var livekitRoom = null;
  var publishedVideoTrack = null;  // LiveKit LocalVideoTrack we published
  var publishedAudioTrack = null;  // LiveKit LocalAudioTrack we published
  var selectedSession = null;
  var activeRoomName = null;
  var isLive = false;
  var isTestMode = false;
  var testRoomName = null;
  var elapsedTimer = null;
  var liveStartTime = null;
  var cameraEnabled = true;
  var micEnabled = true;

  // Participant overlay elements
  var participantsOverlay = document.getElementById('yts-participants-overlay');
  var participantsNum = document.getElementById('yts-participants-num');
  var handAlert = document.getElementById('yts-hand-alert');
  var handAlertName = document.getElementById('yts-hand-alert-name');
  var handAlertTimer = null;
  var allCameras = [];  // full device list for flip

  // ═══════════════════════════════════════════════════════
  // AUTH GATE — show studio only for teacher/admin
  // ═══════════════════════════════════════════════════════
  function checkAuth() {
    if (typeof firebase === 'undefined' || !firebase.auth) {
      // Firebase not loaded yet — retry shortly (script may load before Firebase SDK)
      setTimeout(checkAuth, 200);
      return;
    }

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

    // Auto-select any live session so teacher can rejoin after refresh
    var liveItem = null;
    for (var li = 0; li < items.length; li++) {
      if (items[li].status === 'live') { liveItem = items[li]; break; }
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

      // Stream type badge
      var sType = item.streamType || (item.interactive ? 'interactive' : 'broadcast');
      var typeLabels = {
        broadcast: isDa ? 'Broadcast' : 'Broadcast',
        interactive: isDa ? 'Interaktiv' : 'Interactive',
        panel: isDa ? 'Panel' : 'Panel'
      };
      var typeIcons = {
        broadcast: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
        interactive: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
        panel: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="15" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/></svg>'
      };

      html += '<div class="yts-sessions__item" data-session-id="' + esc(item.id) + '" data-session=\'' + JSON.stringify(item).replace(/'/g, '&#39;') + '\'>';
      html += '<div class="yts-sessions__item-date">';
      if (dayLabel) html += '<div class="yts-sessions__item-day-label">' + esc(dayLabel) + '</div>';
      html += '<div class="yts-sessions__item-day">' + day + '. ' + esc(monthLabel) + '</div>';
      html += '</div>';
      html += '<div class="yts-sessions__item-info">';
      html += '<p class="yts-sessions__item-name">' + esc(title) + '</p>';
      html += '<span class="yts-sessions__item-time">' + startTime + endTime + '</span>';
      html += '<span class="yts-sessions__item-type yts-sessions__item-type--' + sType + '">' + (typeIcons[sType] || '') + ' ' + (typeLabels[sType] || sType) + '</span>';
      html += '</div>';
      html += tag;
      html += '</div>';
    }

    sessionList.innerHTML = html;

    var cards = sessionList.querySelectorAll('.yts-sessions__item');
    for (var j = 0; j < cards.length; j++) {
      cards[j].addEventListener('click', handleSessionClick);
    }

    // Auto-select live session so teacher can rejoin after page refresh
    if (liveItem && !isLive && !isTestMode) {
      selectedSession = liveItem;
      // Highlight the live session card
      var liveCard = sessionList.querySelector('[data-session-id="' + liveItem.id + '"]');
      if (liveCard) liveCard.classList.add('yts-sessions__item--selected');
      // Update button to show "Rejoin" instead of "Go Live"
      if (goLiveBtn) {
        goLiveBtn.textContent = isDa ? 'Tilslut igen' : 'Rejoin';
        goLiveBtn.disabled = false;
      }
    }
  }

  function handleSessionClick(e) {
    if (isLive || isTestMode) return;

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

  /**
   * Filter cameras to only front/back on mobile, or simplify labels on desktop.
   * Returns filtered + relabelled camera list.
   */
  function filterCameras(cameras) {
    var isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    if (!isMobile) return cameras;

    // On mobile: pick one front, one back based on label
    var front = null;
    var back = null;
    for (var i = 0; i < cameras.length; i++) {
      var label = (cameras[i].label || '').toLowerCase();
      // Skip ultra wide, telephoto, infrared, LiDAR, etc.
      if (label.indexOf('ultra') !== -1 || label.indexOf('telephoto') !== -1 ||
          label.indexOf('infrared') !== -1 || label.indexOf('lidar') !== -1 ||
          label.indexOf('truedepth') !== -1) continue;
      if (!back && (label.indexOf('back') !== -1 || label.indexOf('rear') !== -1 || label.indexOf('bag') !== -1)) {
        back = cameras[i];
      }
      if (!front && (label.indexOf('front') !== -1 || label.indexOf('user') !== -1 || label.indexOf('facetime') !== -1 || label.indexOf('selfie') !== -1)) {
        front = cameras[i];
      }
    }

    // If no labels matched, use first two cameras (front-facing first on iOS)
    if (!front && !back) {
      front = cameras[0] || null;
      back = cameras[1] || null;
    } else if (!front) {
      // Find the first camera that isn't the back camera
      for (var j = 0; j < cameras.length; j++) {
        if (cameras[j].deviceId !== (back && back.deviceId)) {
          var l = (cameras[j].label || '').toLowerCase();
          if (l.indexOf('ultra') === -1 && l.indexOf('telephoto') === -1 && l.indexOf('infrared') === -1) {
            front = cameras[j];
            break;
          }
        }
      }
    } else if (!back) {
      for (var k = 0; k < cameras.length; k++) {
        if (cameras[k].deviceId !== (front && front.deviceId)) {
          var lb = (cameras[k].label || '').toLowerCase();
          if (lb.indexOf('ultra') === -1 && lb.indexOf('telephoto') === -1 && lb.indexOf('infrared') === -1) {
            back = cameras[k];
            break;
          }
        }
      }
    }

    var result = [];
    if (front) result.push({ deviceId: front.deviceId, label: isDa ? 'Frontkamera' : 'Front Camera', kind: 'videoinput' });
    if (back) result.push({ deviceId: back.deviceId, label: isDa ? 'Bagkamera' : 'Back Camera', kind: 'videoinput' });
    return result.length ? result : cameras;
  }

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
      var rawCameras = devices.filter(function (d) { return d.kind === 'videoinput'; });
      var cameras = filterCameras(rawCameras);
      allCameras = cameras;
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

  /**
   * Switch camera/mic device. If we're live, republish tracks to LiveKit.
   * This fixes the bug where changing camera broke the viewer feed.
   */
  function switchDevice() {
    if (!mediaStream) return;
    mediaStream.getTracks().forEach(function (t) { t.stop(); });

    var constraints = getConstraints();
    navigator.mediaDevices.getUserMedia(constraints)
      .then(function (stream) {
        handleStream(stream);

        // If live, replace the published tracks in LiveKit
        if ((isLive || isTestMode) && livekitRoom) {
          republishTracks(stream);
        }
      })
      .catch(function (err) {
        console.error('[teacher-studio] switchDevice error:', err);
      });
  }

  /**
   * Replace published LiveKit tracks with new ones from the stream.
   * This is the key fix: viewers get the new track automatically.
   */
  function republishTracks(stream) {
    var room = livekitRoom;
    if (!room) return;

    var newVideoTrack = stream.getVideoTracks()[0];
    var newAudioTrack = stream.getAudioTracks()[0];

    // Unpublish old tracks, publish new ones
    var unpublishPromises = [];

    if (publishedVideoTrack) {
      try {
        room.localParticipant.unpublishTrack(publishedVideoTrack);
      } catch (e) { console.warn('[teacher-studio] unpublish video:', e.message); }
      publishedVideoTrack = null;
    }
    if (publishedAudioTrack) {
      try {
        room.localParticipant.unpublishTrack(publishedAudioTrack);
      } catch (e) { console.warn('[teacher-studio] unpublish audio:', e.message); }
      publishedAudioTrack = null;
    }

    var publishPromises = [];

    if (newVideoTrack) {
      var lv = new LivekitClient.LocalVideoTrack(newVideoTrack);
      publishedVideoTrack = lv;
      publishPromises.push(
        room.localParticipant.publishTrack(lv, {
          source: LivekitClient.Track.Source.Camera,
          simulcast: true
        })
      );
    }

    if (newAudioTrack) {
      var la = new LivekitClient.LocalAudioTrack(newAudioTrack);
      publishedAudioTrack = la;
      publishPromises.push(
        room.localParticipant.publishTrack(la, {
          source: LivekitClient.Track.Source.Microphone
        })
      );
    }

    Promise.all(publishPromises).then(function () {
      console.log('[teacher-studio] Tracks republished after device switch');
      // Restore mute states
      if (!cameraEnabled && publishedVideoTrack) {
        publishedVideoTrack.mute();
      }
      if (!micEnabled && publishedAudioTrack) {
        publishedAudioTrack.mute();
      }
    }).catch(function (err) {
      console.error('[teacher-studio] republish error:', err);
    });
  }

  /**
   * Flip camera (toggle between front and back).
   */
  function flipCamera() {
    if (allCameras.length < 2) return;
    var currentIdx = -1;
    var currentId = cameraSelect ? cameraSelect.value : '';
    for (var i = 0; i < allCameras.length; i++) {
      if (allCameras[i].deviceId === currentId) { currentIdx = i; break; }
    }
    var nextIdx = (currentIdx + 1) % allCameras.length;
    if (cameraSelect) cameraSelect.value = allCameras[nextIdx].deviceId;
    switchDevice();
  }

  if (startCameraBtn) startCameraBtn.addEventListener('click', startCamera);
  if (cameraSelect) cameraSelect.addEventListener('change', switchDevice);
  if (micSelect) micSelect.addEventListener('change', switchDevice);
  if (qualitySelect) qualitySelect.addEventListener('change', function () {
    if (mediaStream && !isLive && !isTestMode) switchDevice();
  });

  function updateGoLiveState() {
    if (goLiveBtn) {
      goLiveBtn.disabled = !(selectedSession && !isLive && !isTestMode);
      // Update button label based on session state
      if (selectedSession) {
        var st = selectedSession.streamType || (selectedSession.interactive ? 'interactive' : 'broadcast');
        if (selectedSession.status === 'live') {
          goLiveBtn.textContent = isDa ? 'Tilslut igen' : 'Rejoin';
        } else if (st === 'meet') {
          goLiveBtn.textContent = isDa ? 'Start møde' : 'Start meeting';
        } else {
          goLiveBtn.textContent = isDa ? 'Gå live' : 'Go Live';
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════
  // LIVE CONTROLS — mute camera, mute mic, flip camera
  // ═══════════════════════════════════════════════════════
  var controlsBar = null;

  function createLiveControls() {
    if (controlsBar) return;
    var viewport = document.getElementById('yts-viewport');
    if (!viewport) return;

    controlsBar = document.createElement('div');
    controlsBar.className = 'yts-live-controls';
    controlsBar.innerHTML =
      '<button class="yts-live-controls__btn yts-live-controls__btn--active" id="yts-ctrl-cam" title="' + (isDa ? 'Kamera til/fra' : 'Camera on/off') + '">' +
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>' +
      '</button>' +
      '<button class="yts-live-controls__btn yts-live-controls__btn--active" id="yts-ctrl-mic" title="' + (isDa ? 'Mikrofon til/fra' : 'Mic on/off') + '">' +
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>' +
      '</button>' +
      '<button class="yts-live-controls__btn" id="yts-ctrl-flip" title="' + (isDa ? 'Skift kamera' : 'Flip camera') + '">' +
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>' +
      '</button>' +
      '<button class="yts-live-controls__btn" id="yts-ctrl-chat" title="Chat" style="position:relative">' +
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
        '<span id="yts-ctrl-chat-badge" class="yts-live-controls__badge" style="display:none">0</span>' +
      '</button>';

    viewport.appendChild(controlsBar);

    document.getElementById('yts-ctrl-cam').addEventListener('click', toggleCamera);
    document.getElementById('yts-ctrl-mic').addEventListener('click', toggleMic);
    document.getElementById('yts-ctrl-flip').addEventListener('click', flipCamera);
    document.getElementById('yts-ctrl-chat').addEventListener('click', toggleTeacherChat);
  }

  function removeLiveControls() {
    if (controlsBar && controlsBar.parentNode) {
      controlsBar.parentNode.removeChild(controlsBar);
    }
    controlsBar = null;
  }

  function toggleCamera() {
    cameraEnabled = !cameraEnabled;

    if (publishedVideoTrack) {
      if (cameraEnabled) publishedVideoTrack.unmute();
      else publishedVideoTrack.mute();
    }

    // Update preview
    if (mediaStream) {
      var vt = mediaStream.getVideoTracks()[0];
      if (vt) vt.enabled = cameraEnabled;
    }

    updateControlStates();
  }

  function toggleMic() {
    micEnabled = !micEnabled;

    if (publishedAudioTrack) {
      if (micEnabled) publishedAudioTrack.unmute();
      else publishedAudioTrack.mute();
    }

    if (mediaStream) {
      var at = mediaStream.getAudioTracks()[0];
      if (at) at.enabled = micEnabled;
    }

    updateControlStates();
  }

  function updateControlStates() {
    var camBtn = document.getElementById('yts-ctrl-cam');
    var micBtn = document.getElementById('yts-ctrl-mic');
    if (camBtn) {
      camBtn.className = 'yts-live-controls__btn' + (cameraEnabled ? ' yts-live-controls__btn--active' : ' yts-live-controls__btn--off');
      if (!cameraEnabled) {
        camBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h4a2 2 0 0 1 2 2v9.34"/></svg>';
      } else {
        camBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>';
      }
    }
    if (micBtn) {
      micBtn.className = 'yts-live-controls__btn' + (micEnabled ? ' yts-live-controls__btn--active' : ' yts-live-controls__btn--off');
      if (!micEnabled) {
        micBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .28-.02.55-.05.82"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
      } else {
        micBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
      }
    }
  }

  // ═══════════════════════════════════════════════════════
  // LIVE MODE LAYOUT — video becomes main, controls overlay
  // ═══════════════════════════════════════════════════════
  function enterLiveMode() {
    root.classList.add('yts--live-mode');
    createLiveControls();
  }

  function exitLiveMode() {
    root.classList.remove('yts--live-mode');
    removeLiveControls();
    cameraEnabled = true;
    micEnabled = true;
  }

  // ═══════════════════════════════════════════════════════
  // GO LIVE — request camera (if needed) + create LiveKit room + publish
  // ═══════════════════════════════════════════════════════
  function goLive() {
    if (!selectedSession) {
      alert(tNoSession);
      return;
    }

    // Google Meet sessions — no LiveKit needed, just set status to live and open Meet
    var sType = selectedSession.streamType || (selectedSession.interactive ? 'interactive' : 'broadcast');
    if (sType === 'meet') {
      goLiveMeet();
      return;
    }

    setStatus('connecting');
    goLiveBtn.disabled = true;

    if (!mediaStream) {
      var constraints = getConstraints();
      navigator.mediaDevices.getUserMedia(constraints)
        .then(function (stream) {
          handleStream(stream);
          doGoLive();
        })
        .catch(function (err) {
          console.warn('[teacher-studio] full constraints failed:', err.name, err.message);
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

  var goLiveInProgress = false;

  function doGoLive() {
    if (goLiveInProgress) return;
    goLiveInProgress = true;

    var user = firebase.auth().currentUser;
    if (!user) { goLiveInProgress = false; return; }

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
      goLiveInProgress = false;
      setStatus('live');
      goLiveBtn.style.display = 'none';
      endStreamBtn.style.display = '';
      if (testStreamBtn) testStreamBtn.style.display = 'none';
      liveBadge.style.display = '';
      startElapsed();
      enterLiveMode();

      // Update session status to live in Firestore
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
      statusText.textContent = tError + ' — ' + (err.message || 'please try again');
      goLiveBtn.disabled = false;
      goLiveInProgress = false;
    });
  }

  // ═══════════════════════════════════════════════════════
  // GO LIVE — Google Meet (no LiveKit, just set status + open link)
  // ═══════════════════════════════════════════════════════
  function goLiveMeet() {
    setStatus('connecting');
    goLiveBtn.disabled = true;

    var user = firebase.auth().currentUser;
    if (!user) { goLiveBtn.disabled = false; return; }

    user.getIdToken().then(function (token) {
      return fetch('/.netlify/functions/live-admin?action=set-live', {
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
      if (data.error) throw new Error(data.error);

      isLive = true;
      setStatus('live');
      goLiveBtn.style.display = 'none';
      endStreamBtn.style.display = '';
      if (testStreamBtn) testStreamBtn.style.display = 'none';
      liveBadge.style.display = '';
      startElapsed();

      // Open the Google Meet link in a new tab
      var meetUrl = selectedSession.meetingUrl;
      if (meetUrl) {
        window.open(meetUrl, '_blank');
      }

      // Show info in preview area
      if (previewEl) {
        previewEl.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:1rem;color:#FFFCF9">'
          + '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#f75c03" stroke-width="1.5"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>'
          + '<p style="font-size:1.1rem;margin:0">' + (isDa ? 'Google Meet session er live' : 'Google Meet session is live') + '</p>'
          + '<a href="' + (meetUrl || '#') + '" target="_blank" rel="noopener" style="color:#f75c03;font-size:0.9rem">' + (isDa ? 'Åbn mødet igen' : 'Reopen meeting') + '</a>'
          + '</div>';
      }
    })
    .catch(function (err) {
      console.error('[teacher-studio] meet go-live error:', err);
      setStatus('error');
      goLiveBtn.disabled = false;
    });
  }

  if (goLiveBtn) goLiveBtn.addEventListener('click', goLive);

  // ═══════════════════════════════════════════════════════
  // TEST STREAM — quick connection test, no session needed
  // ═══════════════════════════════════════════════════════

  function testStream() {
    if (isLive || isTestMode) return;

    if (!mediaStream) {
      var constraints = getConstraints();
      navigator.mediaDevices.getUserMedia(constraints)
        .then(function (stream) {
          handleStream(stream);
          doTestStream();
        })
        .catch(function (err) {
          if (constraints.video && constraints.audio) {
            return navigator.mediaDevices.getUserMedia({ video: false, audio: constraints.audio })
              .then(function (stream) { handleStream(stream); doTestStream(); });
          }
          throw err;
        })
        .catch(function (err) {
          console.error('[teacher-studio] camera error:', err.name);
          alert(tPermissionDenied);
        });
      return;
    }
    doTestStream();
  }

  function doTestStream() {
    setStatus('connecting');
    if (testStreamBtn) testStreamBtn.disabled = true;

    var user = firebase.auth().currentUser;
    if (!user) return;

    user.getIdToken().then(function (token) {
      return fetch('/.netlify/functions/livekit-token?action=test-room', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json'
        },
        body: '{}'
      });
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data.ok) throw new Error(data.error || 'Failed to create test room');
      testRoomName = data.roomName;
      return connectLiveKit(data.wsUrl, data.token);
    })
    .then(function () {
      isTestMode = true;
      setStatus('live');
      statusText.textContent = 'TEST — ' + (isDa ? 'forbundet' : 'connected');
      liveBadge.style.display = '';
      liveBadge.style.background = 'rgba(255,150,0,0.9)';
      if (testStreamBtn) {
        testStreamBtn.textContent = isDa ? 'Afslut Test' : 'End Test';
        testStreamBtn.disabled = false;
        testStreamBtn.className = 'yts-btn yts-btn--end';
      }
      goLiveBtn.style.display = 'none';
      startElapsed();
      enterLiveMode();
    })
    .catch(function (err) {
      console.error('[teacher-studio] test stream error:', err);
      setStatus('error');
      statusText.textContent = tError + ' — ' + (err.message || '');
      if (testStreamBtn) testStreamBtn.disabled = false;
    });
  }

  function endTestStream() {
    isTestMode = false;
    setStatus('ended');
    stopElapsed();
    exitLiveMode();
    liveBadge.style.display = 'none';
    liveBadge.style.background = '';
    if (testStreamBtn) {
      testStreamBtn.textContent = isDa ? 'Test Stream' : 'Test Stream';
      testStreamBtn.className = 'yts-btn yts-btn--outline';
      testStreamBtn.disabled = false;
    }
    goLiveBtn.style.display = '';

    // Clear hand alert + remote tiles + chat (same as doEndStream)
    cleanupInteractiveUI();

    if (livekitRoom) {
      livekitRoom.disconnect();
      livekitRoom = null;
    }
    publishedVideoTrack = null;
    publishedAudioTrack = null;

    if (testRoomName) {
      var user = firebase.auth().currentUser;
      if (user) {
        user.getIdToken().then(function (token) {
          fetch('/.netlify/functions/livekit-token?action=close-room', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ roomName: testRoomName })
          }).catch(function () {});
        });
      }
      testRoomName = null;
    }
  }

  if (testStreamBtn) {
    testStreamBtn.addEventListener('click', function () {
      if (isTestMode) endTestStream();
      else testStream();
    });
  }

  // ═══════════════════════════════════════════════════════
  // LIVEKIT — connect to room + publish tracks
  // ═══════════════════════════════════════════════════════

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

      room.on(LivekitClient.RoomEvent.Disconnected, function () {
        console.log('[teacher-studio] Disconnected from LiveKit room');
        if (isLive || isTestMode) {
          setStatus('error');
          // Show Go Live button again so teacher can reconnect
          goLiveBtn.style.display = '';
          goLiveBtn.disabled = false;
          goLiveBtn.textContent = isDa ? 'Tilslut igen' : 'Reconnect';
          endStreamBtn.style.display = 'none';
          exitLiveMode();
          stopElapsed();
          isLive = false;
          isTestMode = false;
          livekitRoom = null;
          publishedVideoTrack = null;
          publishedAudioTrack = null;
        }
      });

      room.on(LivekitClient.RoomEvent.Reconnecting, function () {
        console.log('[teacher-studio] Reconnecting to LiveKit room…');
      });

      room.on(LivekitClient.RoomEvent.Reconnected, function () {
        console.log('[teacher-studio] Reconnected to LiveKit room');
        if (isLive) setStatus('live');
      });

      // Subscribe to remote participant tracks (for interactive sessions)
      room.on(LivekitClient.RoomEvent.TrackSubscribed, function (track, pub, participant) {
        console.log('[teacher-studio] Remote track:', track.kind, 'from', participant.identity);
        if (isEgressOrDuplicate(participant)) return;
        ensureRemoteTile(participant);
        attachRemoteTrack(track, participant);
      });

      room.on(LivekitClient.RoomEvent.TrackUnsubscribed, function (track, pub, participant) {
        detachRemoteTrack(track, participant);
      });

      room.on(LivekitClient.RoomEvent.ParticipantConnected, function (participant) {
        console.log('[teacher-studio] Participant joined:', participant.identity);
        if (isEgressOrDuplicate(participant)) return;
        ensureRemoteTile(participant);
        updateRemoteCount();
        var pName = getParticipantDisplayName(participant);
        addTeacherChatSystemMessage(pName + (isDa ? ' deltager' : ' joined'));
      });

      room.on(LivekitClient.RoomEvent.ParticipantDisconnected, function (participant) {
        console.log('[teacher-studio] Participant left:', participant.identity);
        removeRemoteTile(participant);
        updateRemoteCount();
        var pName = getParticipantDisplayName(participant);
        addTeacherChatSystemMessage(pName + (isDa ? ' forlod' : ' left'));
      });

      // Active speaker detection — highlight who's talking
      room.on(LivekitClient.RoomEvent.ActiveSpeakersChanged, function (speakers) {
        // Clear all speaking highlights
        var allTiles = document.querySelectorAll('[id^="yts-remote-"]');
        for (var ti = 0; ti < allTiles.length; ti++) {
          allTiles[ti].classList.remove('yts-remote--speaking');
        }
        // Highlight active speakers
        for (var si = 0; si < speakers.length; si++) {
          var sTile = document.getElementById('yts-remote-' + speakers[si].identity);
          if (sTile) sTile.classList.add('yts-remote--speaking');
        }
      });

      // Track muted/unmuted for remote tiles
      room.on(LivekitClient.RoomEvent.TrackMuted, function (pub, participant) {
        updateRemoteMuteState(participant);
      });
      room.on(LivekitClient.RoomEvent.TrackUnmuted, function (pub, participant) {
        updateRemoteMuteState(participant);
      });

      room.on(LivekitClient.RoomEvent.DataReceived, function (payload, participant) {
        try {
          if (!participant) return; // broadcast messages have no participant
          var msg = JSON.parse(new TextDecoder().decode(payload));
          if (msg.type === 'hand') {
            var tile = document.getElementById('yts-remote-' + participant.identity);
            if (tile) {
              var hand = tile.querySelector('.yts-remote__hand');
              if (hand) hand.style.display = msg.raised ? 'block' : 'none';
              // Add/remove orange stroke for raised hand
              if (msg.raised) {
                tile.classList.add('yts-remote--hand-raised');
              } else {
                tile.classList.remove('yts-remote--hand-raised');
              }
            }
            // Show prominent notification to teacher when hand is raised
            if (msg.raised) {
              var pName = getParticipantDisplayName(participant);
              showHandNotification(pName, participant.identity);
            }
          } else if (msg.type === 'chat') {
            var chatName = getParticipantDisplayName(participant);
            addTeacherChatMessage(chatName, msg.text, false);
            teacherUnreadChat++;
            updateTeacherChatBadge();
          }
        } catch (e) {
          console.warn('[teacher-studio] DataReceived error:', e);
        }
      });

      // Connect to the room
      room.connect(wsUrl, token).then(function () {
        console.log('[teacher-studio] Connected to LiveKit room:', room.name);

        var videoTrack = mediaStream ? mediaStream.getVideoTracks()[0] : null;
        var audioTrack = mediaStream ? mediaStream.getAudioTracks()[0] : null;

        var publishPromises = [];

        if (videoTrack) {
          var localVideo = new LivekitClient.LocalVideoTrack(videoTrack);
          publishedVideoTrack = localVideo;
          publishPromises.push(
            room.localParticipant.publishTrack(localVideo, {
              source: LivekitClient.Track.Source.Camera,
              simulcast: true
            })
          );
        }

        if (audioTrack) {
          var localAudio = new LivekitClient.LocalAudioTrack(audioTrack);
          publishedAudioTrack = localAudio;
          publishPromises.push(
            room.localParticipant.publishTrack(localAudio, {
              source: LivekitClient.Track.Source.Microphone
            })
          );
        }

        return Promise.all(publishPromises);
      }).then(function () {
        console.log('[teacher-studio] Tracks published to LiveKit room');

        // Enumerate existing remote participants (fixes disappearing after refresh)
        room.remoteParticipants.forEach(function (participant) {
          if (isEgressOrDuplicate(participant)) return;
          ensureRemoteTile(participant);
          participant.trackPublications.forEach(function (pub) {
            if (pub.track && pub.isSubscribed) {
              attachRemoteTrack(pub.track, participant);
            }
          });
        });
        updateRemoteCount();

        resolve();
      }).catch(function (err) {
        room.disconnect();
        livekitRoom = null;
        publishedVideoTrack = null;
        publishedAudioTrack = null;
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
    exitLiveMode();
    liveBadge.style.display = 'none';
    endStreamBtn.style.display = 'none';
    goLiveBtn.style.display = '';
    goLiveBtn.disabled = true;
    if (testStreamBtn) testStreamBtn.style.display = '';

    // Clean up interactive UI (hand alerts, remote tiles, chat)
    cleanupInteractiveUI();

    if (livekitRoom) {
      livekitRoom.disconnect();
      livekitRoom = null;
    }
    publishedVideoTrack = null;
    publishedAudioTrack = null;

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
    } else if (selectedSession) {
      // Meet session (no LiveKit room) — update Firestore status directly
      var user3 = firebase.auth().currentUser;
      if (user3) {
        user3.getIdToken().then(function (token) {
          fetch('/.netlify/functions/live-admin', {
            method: 'PUT',
            headers: {
              'Authorization': 'Bearer ' + token,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              id: selectedSession.id,
              status: 'ended',
              liveEndedAt: new Date().toISOString()
            })
          }).catch(function () {});
        });
      }
    }

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
    if (isLive || isTestMode) {
      e.preventDefault();
      e.returnValue = '';
    }
  });


  // ═══════════════════════════════════════════════════════
  // REMOTE PARTICIPANTS — overlaid on teacher video
  // ═══════════════════════════════════════════════════════

  var remoteContainer = null;
  var remoteCountEl = null;
  var teacherChatOpen = false;
  var teacherUnreadChat = 0;
  var teacherChatPanel = null;
  var teacherChatMessages = null;
  var teacherChatInput = null;
  var teacherChatBadge = null;
  var MIC_MUTED_SVG_SM = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#ff453a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/></svg>';

  function getRemoteContainer() {
    if (remoteContainer) return remoteContainer;
    var viewport = document.getElementById('yts-viewport');
    if (!viewport) return null;

    // Overlay container on top of the video
    var wrap = document.createElement('div');
    wrap.id = 'yts-remotes';
    wrap.className = 'yts-remotes-overlay';

    // Participant count pill
    var countPill = document.createElement('div');
    countPill.className = 'yts-remotes-overlay__count';
    countPill.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg> <span id="yts-remote-count">0</span>';
    wrap.appendChild(countPill);

    // Scrollable tile strip
    var strip = document.createElement('div');
    strip.id = 'yts-remote-grid';
    strip.className = 'yts-remotes-overlay__strip';
    wrap.appendChild(strip);

    viewport.appendChild(wrap);
    remoteContainer = strip;
    remoteCountEl = document.getElementById('yts-remote-count');
    return remoteContainer;
  }

  function getParticipantDisplayName(participant) {
    var meta = {};
    try { meta = JSON.parse(participant.metadata || '{}'); } catch (e) {}
    return meta.name || participant.name || participant.identity.split('-')[0] || 'Participant';
  }

  /**
   * Filter out egress bots and the teacher's own viewer connection.
   * Egress identities contain 'EG_' or start with 'egress'.
   * The teacher's own identity starts with 'teacher-' — if another participant
   * has the same uid suffix, it's the teacher viewing from /live (skip it).
   */
  function isEgressOrDuplicate(participant) {
    var id = participant.identity || '';
    // Egress bot
    if (id.indexOf('EG_') !== -1 || id.indexOf('egress') === 0) return true;
    // The teacher themselves (teacher-{uid}) — don't show teacher as remote
    if (id.indexOf('teacher-') === 0) return true;
    return false;
  }

  function ensureRemoteTile(participant) {
    var container = getRemoteContainer();
    if (!container) return;
    if (document.getElementById('yts-remote-' + participant.identity)) return;

    var name = getParticipantDisplayName(participant);
    var tile = document.createElement('div');
    tile.id = 'yts-remote-' + participant.identity;
    tile.className = 'yts-remote-tile';
    tile.dataset.identity = participant.identity;

    var avatar = document.createElement('div');
    avatar.className = 'yts-remote-tile__avatar';
    avatar.textContent = name.charAt(0).toUpperCase();
    tile.appendChild(avatar);

    var nameEl = document.createElement('div');
    nameEl.className = 'yts-remote-tile__name';
    nameEl.textContent = name;
    tile.appendChild(nameEl);

    var hand = document.createElement('div');
    hand.className = 'yts-remote__hand';
    hand.textContent = '✋';
    tile.appendChild(hand);

    var mutedEl = document.createElement('div');
    mutedEl.className = 'yts-remote-tile__muted';
    mutedEl.innerHTML = MIC_MUTED_SVG_SM;
    tile.appendChild(mutedEl);

    // Click on tile with raised hand → dismiss the hand
    tile.addEventListener('click', function () {
      if (tile.classList.contains('yts-remote--hand-raised')) {
        dismissRaisedHand(tile.dataset.identity);
      }
    });

    container.appendChild(tile);
  }

  function removeRemoteTile(participant) {
    var tile = document.getElementById('yts-remote-' + participant.identity);
    if (tile && tile.parentNode) tile.parentNode.removeChild(tile);
    // Remove from raisedHands tracking
    var idx = raisedHandIdentities.indexOf(participant.identity);
    if (idx !== -1) raisedHandIdentities.splice(idx, 1);
  }

  function attachRemoteTrack(track, participant) {
    var tile = document.getElementById('yts-remote-' + participant.identity);
    if (!tile) return;

    if (track.kind === 'video') {
      var existing = tile.querySelector('video');
      if (existing) existing.remove();
      var el = track.attach();
      el.className = 'yts-remote-tile__video';
      tile.insertBefore(el, tile.firstChild);
      tile.classList.remove('yts-remote-tile--no-video');
    } else if (track.kind === 'audio') {
      var audioEl = track.attach();
      audioEl.style.position = 'absolute';
      audioEl.style.width = '1px';
      audioEl.style.height = '1px';
      audioEl.style.opacity = '0';
      tile.appendChild(audioEl);
      var playPromise = audioEl.play();
      if (playPromise && playPromise.catch) {
        playPromise.catch(function () {
          function resumeAudio() {
            audioEl.play().catch(function () {});
            document.removeEventListener('click', resumeAudio);
          }
          document.addEventListener('click', resumeAudio);
        });
      }
    }
  }

  function detachRemoteTrack(track, participant) {
    var elements = track.detach();
    for (var i = 0; i < elements.length; i++) {
      if (elements[i].parentNode) elements[i].parentNode.removeChild(elements[i]);
    }
    if (track.kind === 'video') {
      var tile = document.getElementById('yts-remote-' + participant.identity);
      if (tile) tile.classList.add('yts-remote-tile--no-video');
    }
  }

  function updateRemoteMuteState(participant) {
    var tile = document.getElementById('yts-remote-' + participant.identity);
    if (!tile) return;
    var isMicMuted = true;
    participant.audioTrackPublications.forEach(function (pub) {
      if (pub.track && !pub.isMuted) isMicMuted = false;
    });
    var mutedEl = tile.querySelector('.yts-remote-tile__muted');
    if (mutedEl) {
      mutedEl.style.display = isMicMuted ? 'flex' : 'none';
    }
  }

  function updateRemoteCount() {
    if (!livekitRoom) return;
    var count = livekitRoom.remoteParticipants.size;
    if (remoteCountEl) {
      remoteCountEl.textContent = count;
    }
    // Update the preview overlay
    if (participantsOverlay) {
      if (count > 0) {
        participantsOverlay.style.display = '';
        if (participantsNum) participantsNum.textContent = count;
      } else {
        participantsOverlay.style.display = 'none';
      }
    }
    // Show/hide the remote overlay
    var wrap = document.getElementById('yts-remotes');
    if (wrap) wrap.style.display = count > 0 ? '' : 'none';
  }

  // ═══════════════════════════════════════════════════════
  // HAND RAISE NOTIFICATION + DISMISS
  // ═══════════════════════════════════════════════════════

  var handNotifTimer = null;
  var raisedHands = []; // track all currently raised hand names
  var raisedHandIdentities = []; // track identities for dismiss

  function showHandNotification(name, identity) {
    // Play a short notification sound
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = 'sine';
      gain.gain.value = 0.15;
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.stop(ctx.currentTime + 0.3);
    } catch (e) {}

    // Track raised hands — add if not already present
    if (raisedHands.indexOf(name) === -1) raisedHands.push(name);
    if (identity && raisedHandIdentities.indexOf(identity) === -1) raisedHandIdentities.push(identity);

    // Show hand alert pill on the preview overlay
    if (handAlert && handAlertName) {
      handAlertName.textContent = raisedHands.length > 1
        ? raisedHands.join(', ')
        : name;
      handAlert.style.display = '';
      handAlert.style.animation = 'none';
      handAlert.offsetHeight;
      handAlert.style.animation = 'yts-hand-pop 0.3s ease-out';
      if (handNotifTimer) clearTimeout(handNotifTimer);
      // Don't auto-hide — teacher must dismiss by clicking the tile
    }
  }

  /**
   * Teacher dismisses a raised hand by clicking the participant tile.
   * Sends a 'lower-hand' message to the participant so their hand icon clears.
   */
  function dismissRaisedHand(identity) {
    var tile = document.getElementById('yts-remote-' + identity);
    if (tile) {
      tile.classList.remove('yts-remote--hand-raised');
      var hand = tile.querySelector('.yts-remote__hand');
      if (hand) hand.style.display = 'none';
    }

    // Remove from tracking
    var idx = raisedHandIdentities.indexOf(identity);
    if (idx !== -1) {
      raisedHands.splice(idx, 1);
      raisedHandIdentities.splice(idx, 1);
    }

    // Send lower-hand message to the specific participant
    if (livekitRoom) {
      var data = new TextEncoder().encode(JSON.stringify({ type: 'lower-hand' }));
      // Find the participant and send targeted data
      var participant = livekitRoom.remoteParticipants.get(identity);
      if (participant) {
        try {
          livekitRoom.localParticipant.publishData(data, { reliable: true, destinationIdentities: [identity] });
        } catch (e) {
          console.warn('[teacher-studio] Failed to send lower-hand:', e);
        }
      }
    }

    // Update hand alert
    if (raisedHands.length === 0) {
      if (handAlert) handAlert.style.display = 'none';
    } else if (handAlertName) {
      handAlertName.textContent = raisedHands.join(', ');
    }
  }

  // ═══════════════════════════════════════════════════════
  // TEACHER CHAT — overlay panel
  // ═══════════════════════════════════════════════════════

  function createTeacherChat() {
    if (teacherChatPanel) return;
    var viewport = document.getElementById('yts-viewport');
    if (!viewport) return;

    var panel = document.createElement('div');
    panel.id = 'yts-chat';
    panel.className = 'yts-chat';
    panel.innerHTML =
      '<div class="yts-chat__header">' +
        '<span class="yts-chat__title">Chat</span>' +
        '<button class="yts-chat__close" id="yts-chat-close">&times;</button>' +
      '</div>' +
      '<div class="yts-chat__messages" id="yts-chat-messages"></div>' +
      '<div class="yts-chat__input-wrap">' +
        '<input class="yts-chat__input" id="yts-chat-input" type="text" placeholder="' + (isDa ? 'Skriv en besked…' : 'Type a message…') + '" autocomplete="off">' +
        '<button class="yts-chat__send" id="yts-chat-send">&#10148;</button>' +
      '</div>';

    viewport.appendChild(panel);
    teacherChatPanel = panel;
    teacherChatMessages = document.getElementById('yts-chat-messages');
    teacherChatInput = document.getElementById('yts-chat-input');

    document.getElementById('yts-chat-close').addEventListener('click', toggleTeacherChat);
    document.getElementById('yts-chat-send').addEventListener('click', sendTeacherChat);
    teacherChatInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') sendTeacherChat();
    });
  }

  function toggleTeacherChat() {
    teacherChatOpen = !teacherChatOpen;
    if (!teacherChatPanel) createTeacherChat();
    if (teacherChatOpen) {
      teacherChatPanel.classList.add('yts-chat--open');
      teacherUnreadChat = 0;
      updateTeacherChatBadge();
      if (teacherChatInput) teacherChatInput.focus();
    } else {
      teacherChatPanel.classList.remove('yts-chat--open');
    }
    // Update chat control button state
    var chatBtn = document.getElementById('yts-ctrl-chat');
    if (chatBtn) chatBtn.classList.toggle('yts-live-controls__btn--active', teacherChatOpen);
  }

  function sendTeacherChat() {
    if (!teacherChatInput) return;
    var text = teacherChatInput.value.trim();
    if (!text || !livekitRoom) return;
    teacherChatInput.value = '';

    var data = new TextEncoder().encode(JSON.stringify({ type: 'chat', text: text }));
    try {
      livekitRoom.localParticipant.publishData(data, { reliable: true });
    } catch (e) {
      console.warn('[teacher-studio] Failed to send chat:', e);
    }
    addTeacherChatMessage(isDa ? 'Dig' : 'You', text, true);
  }

  function addTeacherChatMessage(name, text, isSelf) {
    if (!teacherChatPanel) createTeacherChat();
    if (!teacherChatMessages) return;
    var div = document.createElement('div');
    div.className = 'yts-chat__msg';
    div.innerHTML = '<span class="yts-chat__msg-name" style="' + (isSelf ? 'color:#FFFCF9' : '') + '">' + esc(name) + '</span> <span class="yts-chat__msg-text">' + esc(text) + '</span>';
    teacherChatMessages.appendChild(div);
    teacherChatMessages.scrollTop = teacherChatMessages.scrollHeight;
  }

  function addTeacherChatSystemMessage(text) {
    if (!teacherChatPanel) createTeacherChat();
    if (!teacherChatMessages) return;
    var div = document.createElement('div');
    div.className = 'yts-chat__msg yts-chat__msg--system';
    div.textContent = text;
    teacherChatMessages.appendChild(div);
    teacherChatMessages.scrollTop = teacherChatMessages.scrollHeight;
  }

  function updateTeacherChatBadge() {
    if (!teacherChatBadge) teacherChatBadge = document.getElementById('yts-ctrl-chat-badge');
    if (!teacherChatBadge) return;
    if (teacherUnreadChat > 0 && !teacherChatOpen) {
      teacherChatBadge.textContent = teacherUnreadChat > 9 ? '9+' : String(teacherUnreadChat);
      teacherChatBadge.style.display = 'flex';
    } else {
      teacherChatBadge.style.display = 'none';
    }
  }

  // ═══════════════════════════════════════════════════════
  // CLEANUP — shared cleanup for end stream / end test
  // ═══════════════════════════════════════════════════════

  function cleanupInteractiveUI() {
    if (handNotifTimer) { clearTimeout(handNotifTimer); handNotifTimer = null; }
    if (handAlert) handAlert.style.display = 'none';
    raisedHands = [];
    raisedHandIdentities = [];
    if (remoteContainer) {
      while (remoteContainer.firstChild) remoteContainer.removeChild(remoteContainer.firstChild);
    }
    if (participantsOverlay) participantsOverlay.style.display = 'none';
    if (remoteCountEl) remoteCountEl.textContent = '0';
    var remotesWrap = document.getElementById('yts-remotes');
    if (remotesWrap) remotesWrap.style.display = 'none';

    // Clean up chat
    teacherChatOpen = false;
    teacherUnreadChat = 0;
    if (teacherChatPanel) {
      teacherChatPanel.classList.remove('yts-chat--open');
    }
    if (teacherChatMessages) teacherChatMessages.innerHTML = '';
  }

  // ═══════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════
  checkAuth();
})();
