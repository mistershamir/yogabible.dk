/**
 * Live Page — Student-facing live stream viewer.
 *
 * Uses LiveKit to subscribe to teacher's video/audio in real time.
 * Falls back to Mux HLS player for hardware encoder streams.
 * Shows upcoming schedule and polls for active rooms.
 *
 * Flow:
 * 1. Check schedule for live sessions with a LiveKit room
 * 2. If active → get viewer token → connect to room → display video
 * 3. If not → show offline card, poll every 15s
 * 4. Schedule section always loads upcoming sessions
 */
(function () {
  var container = document.getElementById('yb-live');
  if (!container) return;

  var playerSection = document.getElementById('yb-live-player-section');
  var offlineSection = document.getElementById('yb-live-offline');
  var checkingOverlay = document.getElementById('yb-live-checking');
  var badge = document.getElementById('yb-live-badge');
  var retryBtn = document.getElementById('yb-live-retry');
  var mountEl = document.getElementById('yb-live-player-mount');
  var elapsedEl = document.getElementById('yb-live-elapsed');
  var elapsedTimeEl = document.getElementById('yb-live-elapsed-time');
  var scheduleSection = document.getElementById('yb-live-schedule');
  var scheduleList = document.getElementById('yb-live-schedule-list');

  var pollTimer = null;
  var elapsedTimer = null;
  var liveStartTime = null;
  var POLL_INTERVAL = 15000;
  var isStreamLive = false;
  var livekitRoom = null;
  var currentRoomName = null;

  var isDa = (container.dataset.lang || 'da') === 'da';
  var tToday = container.dataset.tToday || 'I dag';
  var tTomorrow = container.dataset.tTomorrow || 'I morgen';
  var tLiveNow = container.dataset.tLiveNow || 'LIVE NU';
  var tEmpty = container.dataset.tEmpty || '';

  function formatTime(totalSeconds) {
    var s = Math.floor(totalSeconds);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    var mm = m < 10 ? '0' + m : m;
    var ss = sec < 10 ? '0' + sec : sec;
    return h > 0 ? h + ':' + mm + ':' + ss : mm + ':' + ss;
  }

  function startElapsedTimer() {
    if (elapsedTimer) return;
    liveStartTime = Date.now();
    if (elapsedEl) elapsedEl.classList.add('yb-live-elapsed--visible');
    elapsedTimer = setInterval(function () {
      if (elapsedTimeEl && liveStartTime) {
        var t = (Date.now() - liveStartTime) / 1000;
        elapsedTimeEl.textContent = formatTime(t);
      }
    }, 1000);
  }

  function stopElapsedTimer() {
    if (elapsedTimer) {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
    liveStartTime = null;
    if (elapsedEl) elapsedEl.classList.remove('yb-live-elapsed--visible');
    if (elapsedTimeEl) elapsedTimeEl.textContent = '00:00';
  }

  // ═══════════════════════════════════════════════════════
  // LIVEKIT — subscribe to teacher's tracks
  // ═══════════════════════════════════════════════════════

  function connectToRoom(roomName) {
    if (typeof LivekitClient === 'undefined') {
      console.error('[live] LiveKit SDK not loaded');
      showOffline();
      return;
    }

    if (livekitRoom && currentRoomName === roomName) {
      showLive();
      return;
    }

    if (livekitRoom) {
      livekitRoom.disconnect();
      livekitRoom = null;
    }

    currentRoomName = roomName;

    var tokenUrl = '/.netlify/functions/livekit-token?action=viewer-token&room=' + encodeURIComponent(roomName);
    var opts = { headers: {} };

    var authPromise;
    if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) {
      authPromise = firebase.auth().currentUser.getIdToken();
    } else {
      authPromise = Promise.resolve(null);
    }

    authPromise.then(function (authToken) {
      if (authToken) opts.headers['Authorization'] = 'Bearer ' + authToken;
      return fetch(tokenUrl, opts);
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data.ok) throw new Error(data.error || 'Failed to get viewer token');
      return joinRoom(data.wsUrl, data.token);
    })
    .catch(function (err) {
      console.error('[live] LiveKit connection error:', err);
      showOffline();
    });
  }

  function joinRoom(wsUrl, token) {
    var room = new LivekitClient.Room({
      adaptiveStream: true,
      dynacast: true
    });

    livekitRoom = room;

    room.on(LivekitClient.RoomEvent.TrackSubscribed, function (track, publication, participant) {
      console.log('[live] Track subscribed:', track.kind, 'from', participant.identity);
      attachTrack(track);
      showLive();
    });

    room.on(LivekitClient.RoomEvent.TrackUnsubscribed, function (track) {
      console.log('[live] Track unsubscribed:', track.kind);
      detachTrack(track);
    });

    room.on(LivekitClient.RoomEvent.Disconnected, function () {
      console.log('[live] Disconnected from LiveKit room');
      cleanupMount();
      livekitRoom = null;
      currentRoomName = null;
      showOffline();
    });

    room.on(LivekitClient.RoomEvent.Reconnecting, function () {
      console.log('[live] Reconnecting…');
    });

    room.on(LivekitClient.RoomEvent.Reconnected, function () {
      console.log('[live] Reconnected');
    });

    return room.connect(wsUrl, token).then(function () {
      console.log('[live] Connected to room:', room.name, 'participants:', room.remoteParticipants.size);

      room.remoteParticipants.forEach(function (participant) {
        participant.trackPublications.forEach(function (publication) {
          if (publication.track && publication.isSubscribed) {
            attachTrack(publication.track);
          }
        });
      });

      if (room.remoteParticipants.size > 0) {
        showLive();
      }
    });
  }

  function attachTrack(track) {
    if (!mountEl) return;

    var el = track.attach();
    el.id = 'yb-live-track-' + track.sid;

    if (track.kind === 'video') {
      el.style.width = '100%';
      el.style.aspectRatio = '16 / 9';
      el.style.objectFit = 'contain';
      el.style.background = '#000';
      el.style.display = 'block';
    } else {
      el.style.display = 'none';
    }

    mountEl.appendChild(el);
  }

  function detachTrack(track) {
    var elements = track.detach();
    for (var i = 0; i < elements.length; i++) {
      if (elements[i].parentNode) {
        elements[i].parentNode.removeChild(elements[i]);
      }
    }
  }

  function cleanupMount() {
    if (!mountEl) return;
    while (mountEl.firstChild) {
      mountEl.removeChild(mountEl.firstChild);
    }
  }

  // ═══════════════════════════════════════════════════════
  // SHOW LIVE / OFFLINE
  // ═══════════════════════════════════════════════════════

  function showLive() {
    isStreamLive = true;
    playerSection.style.display = 'block';
    offlineSection.style.display = 'none';
    checkingOverlay.classList.add('yb-live-player__checking--hidden');
    badge.classList.add('yb-live-badge--visible');
    startElapsedTimer();
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function showOffline() {
    isStreamLive = false;
    playerSection.style.display = 'none';
    offlineSection.style.display = 'block';
    badge.classList.remove('yb-live-badge--visible');
    checkingOverlay.classList.add('yb-live-player__checking--hidden');
    cleanupMount();
    stopElapsedTimer();

    if (livekitRoom) {
      livekitRoom.disconnect();
      livekitRoom = null;
      currentRoomName = null;
    }

    startPolling();
  }

  // ═══════════════════════════════════════════════════════
  // STREAM CHECK — poll schedule for active rooms
  // ═══════════════════════════════════════════════════════

  /**
   * Mux HLS fallback for hardware encoder streams (ATEM Mini etc.)
   */
  function showMuxPlayer(playbackId) {
    if (!mountEl) return;
    cleanupMount();

    var envKey = container.dataset.envKey || '';
    var isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    var el;
    if (isIOS) {
      el = document.createElement('iframe');
      el.src = 'https://player.mux.com/' + playbackId;
      el.style.cssText = 'width:100%;aspect-ratio:16/9;border:none;display:block';
      el.setAttribute('allow', 'accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;');
      el.setAttribute('allowfullscreen', '');
    } else {
      el = document.createElement('mux-player');
      el.setAttribute('stream-type', 'll-live');
      el.setAttribute('playback-id', playbackId);
      if (envKey) el.setAttribute('env-key', envKey);
      el.setAttribute('accent-color', '#f75c03');
      el.setAttribute('primary-color', '#FFFCF9');
      el.setAttribute('secondary-color', '#0F0F0F');
      el.setAttribute('default-hidden-captions', '');
      el.setAttribute('playsinline', '');
    }

    mountEl.appendChild(el);
    showLive();
  }

  function checkStream() {
    var opts = { headers: {} };
    var authPromise;

    if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) {
      authPromise = firebase.auth().currentUser.getIdToken();
    } else {
      authPromise = Promise.resolve(null);
    }

    authPromise.then(function (token) {
      if (token) opts.headers['Authorization'] = 'Bearer ' + token;
      return fetch('/.netlify/functions/live-admin?action=schedule', opts);
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data.ok || !data.items) {
        showOffline();
        return;
      }

      // Priority 1: LiveKit room
      var liveSession = null;
      for (var i = 0; i < data.items.length; i++) {
        if (data.items[i].status === 'live' && data.items[i].livekitRoom) {
          liveSession = data.items[i];
          break;
        }
      }

      if (liveSession) {
        console.log('[live] Found live session:', liveSession.id, 'room:', liveSession.livekitRoom);
        connectToRoom(liveSession.livekitRoom);
        renderSchedule(data.items);
        return;
      }

      // Priority 2: Mux HLS (hardware encoder fallback)
      var muxLive = null;
      for (var j = 0; j < data.items.length; j++) {
        if (data.items[j].status === 'live' && data.items[j].muxPlaybackId) {
          muxLive = data.items[j];
          break;
        }
      }

      if (muxLive) {
        showMuxPlayer(muxLive.muxPlaybackId);
      } else {
        showOffline();
      }

      renderSchedule(data.items);
    })
    .catch(function () {
      showOffline();
    });
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(checkStream, POLL_INTERVAL);
  }

  if (retryBtn) {
    retryBtn.addEventListener('click', function () {
      playerSection.style.display = 'block';
      offlineSection.style.display = 'none';
      checkingOverlay.classList.remove('yb-live-player__checking--hidden');
      checkStream();
    });
  }

  // Initial check
  checkStream();

  // ═══════════════════════════════════════════════════════
  // SCHEDULE RENDERING
  // ═══════════════════════════════════════════════════════
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

  var MONTHS_DA = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  var MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function renderSchedule(items) {
    if (!scheduleSection || !scheduleList) return;
    if (!items || !items.length) {
      scheduleSection.hidden = true;
      return;
    }

    scheduleSection.hidden = false;
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
        endTime = String(de.getHours()).padStart(2, '0') + ':' + String(de.getMinutes()).padStart(2, '0');
      }
      var timeRange = endTime ? (startTime + ' – ' + endTime) : startTime;
      var title = isDa ? (item.title_da || item.title_en || '') : (item.title_en || item.title_da || '');
      var isLive = item.status === 'live';

      var dayLabel = '';
      if (isToday(d)) dayLabel = tToday;
      else if (isTomorrow(d)) dayLabel = tTomorrow;

      var tag = '';
      if (isLive) {
        tag = '<span class="yb-live-schedule__tag yb-live-schedule__tag--live"><span class="yb-live-badge__dot"></span>' + tLiveNow + '</span>';
      } else {
        tag = '<span class="yb-live-schedule__tag yb-live-schedule__tag--upcoming">' + timeRange + '</span>';
      }

      html += '<div class="yb-live-schedule__card' + (isLive ? ' yb-live-schedule__card--live' : '') + '">';
      html += '<div class="yb-live-schedule__item">';
      html += '<div class="yb-live-schedule__date">';
      if (dayLabel) {
        html += '<div class="yb-live-schedule__day-label">' + esc(dayLabel) + '</div>';
      }
      html += '<div class="yb-live-schedule__day">' + day + '. ' + esc(monthLabel) + ' ' + d.getFullYear() + '</div>';
      html += '</div>';
      html += '<div class="yb-live-schedule__info">';
      html += '<p class="yb-live-schedule__name">' + esc(title) + '</p>';
      html += '<span class="yb-live-schedule__meta">' + esc(item.instructor || '') + '</span>';
      html += '</div>';
      html += tag;
      html += '</div>';
      html += '</div>';
    }

    scheduleList.innerHTML = html;
  }

  // Expose for member.js to trigger re-fetch
  window._liveScheduleFetch = checkStream;

  // Re-fetch once auth is ready
  if (typeof firebase !== 'undefined' && firebase.auth) {
    var authUnsub = firebase.auth().onAuthStateChanged(function (u) {
      if (u) {
        checkStream();
        authUnsub();
      }
    });
  }
})();
