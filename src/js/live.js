(function () {
  var container = document.getElementById('yb-live');
  if (!container) return;

  var playbackId = container.dataset.playbackId;
  var envKey = container.dataset.envKey || '';
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
  var player = null;
  var pollTimer = null;
  var elapsedTimer = null;
  var POLL_INTERVAL = 30000;
  var isStreamLive = false;
  var playerErrorCount = 0;
  var MAX_PLAYER_ERRORS = 3;

  // iOS detection — ALL browsers on iOS use WebKit (Apple requirement).
  // WebKit has native HLS support but the mux-player web component
  // can fail to initialize, especially inside hidden containers.
  // Use native <video> on iOS for reliable playback.
  var isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

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
    if (elapsedEl) elapsedEl.classList.add('yb-live-elapsed--visible');
    elapsedTimer = setInterval(function () {
      if (player && elapsedTimeEl) {
        var t = player.currentTime;
        if (t > 0) elapsedTimeEl.textContent = formatTime(t);
      }
    }, 1000);
  }

  function stopElapsedTimer() {
    if (elapsedTimer) {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
    if (elapsedEl) elapsedEl.classList.remove('yb-live-elapsed--visible');
    if (elapsedTimeEl) elapsedTimeEl.textContent = '00:00';
  }

  /**
   * Create the appropriate player element based on platform.
   * iOS: native <video> with HLS URL (WebKit supports HLS natively)
   * Desktop/Android: <mux-player> web component with full features
   */
  function createPlayer() {
    if (!mountEl) return null;

    // Remove existing player if any
    if (player && player.parentNode) {
      player.parentNode.removeChild(player);
    }
    player = null;

    var el;
    if (isIOS) {
      // Use Mux's hosted iframe player on iOS — handles HLS/codec/mobile natively
      el = document.createElement('iframe');
      el.id = 'yb-mux-player';
      el.src = 'https://player.mux.com/' + playbackId;
      el.style.cssText = 'width:100%;aspect-ratio:16/9;border:none;display:block';
      el.setAttribute('allow', 'accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;');
      el.setAttribute('allowfullscreen', '');
    } else {
      el = document.createElement('mux-player');
      el.id = 'yb-mux-player';
      el.setAttribute('stream-type', 'll-live');
      el.setAttribute('playback-id', playbackId);
      el.setAttribute('env-key', envKey);
      el.setAttribute('accent-color', '#f75c03');
      el.setAttribute('primary-color', '#FFFCF9');
      el.setAttribute('secondary-color', '#0F0F0F');
      el.setAttribute('default-hidden-captions', '');
      el.setAttribute('playsinline', '');
    }

    mountEl.appendChild(el);
    player = el;

    // Only bind player events for mux-player (iframe handles its own events)
    if (!isIOS) bindPlayerEvents();

    return el;
  }

  /**
   * Re-create the player element from scratch.
   * Destroys the old element and builds a new one for clean init.
   */
  function recreatePlayer() {
    createPlayer();
  }

  function showLive() {
    isStreamLive = true;
    playerErrorCount = 0;
    playerSection.style.display = 'block';
    offlineSection.style.display = 'none';
    checkingOverlay.classList.add('yb-live-player__checking--hidden');
    badge.classList.add('yb-live-badge--visible');

    // Create player lazily — only when stream is confirmed live
    if (!player || !player.parentNode) {
      createPlayer();
    } else if (isIOS) {
      // Ensure iframe src is set for Mux hosted player
      var expectedSrc = 'https://player.mux.com/' + playbackId;
      if (!player.src || player.src.indexOf(playbackId) === -1) {
        player.src = expectedSrc;
      }
    } else {
      // Set playback-id for mux-player if not already set
      if (!player.getAttribute('playback-id')) {
        player.setAttribute('playback-id', playbackId);
      }
    }

    startElapsedTimer();
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function showOffline() {
    isStreamLive = false;
    playerErrorCount = 0;
    playerSection.style.display = 'none';
    offlineSection.style.display = 'block';
    badge.classList.remove('yb-live-badge--visible');
    checkingOverlay.classList.add('yb-live-player__checking--hidden');

    // Stop/clear the player
    if (player) {
      if (isIOS) {
        player.src = 'about:blank'; // Clear iframe
      } else if (player.getAttribute('playback-id')) {
        player.removeAttribute('playback-id');
      }
    }

    stopElapsedTimer();
    startPolling();
  }

  function checkStream() {
    if (!playbackId) {
      showOffline();
      return;
    }
    var url = 'https://stream.mux.com/' + playbackId + '.m3u8';
    fetch(url)
      .then(function (res) {
        if (res.ok) {
          showLive();
        } else {
          showOffline();
        }
      })
      .catch(function () {
        showOffline();
      });
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(function () {
      if (!playbackId) return;
      var url = 'https://stream.mux.com/' + playbackId + '.m3u8';
      fetch(url)
        .then(function (res) {
          if (res.ok) {
            // Stream came online — recreate player fresh for clean init
            recreatePlayer();
            showLive();
          }
        })
        .catch(function () {});
    }, POLL_INTERVAL);
  }

  if (retryBtn) {
    retryBtn.addEventListener('click', function () {
      playerSection.style.display = 'block';
      offlineSection.style.display = 'none';
      checkingOverlay.classList.remove('yb-live-player__checking--hidden');
      recreatePlayer();
      checkStream();
    });
  }

  function bindPlayerEvents() {
    if (!player) return;

    player.addEventListener('playing', function () {
      showLive();
    });

    player.addEventListener('error', function () {
      // On mobile, transient errors can occur while the stream is loading.
      // Only go offline after multiple consecutive errors, or if we never
      // confirmed the stream was live in the first place.
      if (!isStreamLive) {
        showOffline();
        return;
      }
      playerErrorCount++;
      console.warn('[live] player error #' + playerErrorCount + ' (stream confirmed live, tolerating)');
      if (playerErrorCount >= MAX_PLAYER_ERRORS) {
        console.warn('[live] max errors reached, going offline');
        isStreamLive = false;
        showOffline();
      }
    });
  }

  // No player in HTML — created lazily by checkStream → showLive
  checkStream();

  /* ══════════════════════════════════════════
     SCHEDULE — fetch upcoming live sessions
     ══════════════════════════════════════════ */
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

  function fetchSchedule() {
    if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) {
      firebase.auth().currentUser.getIdToken().then(function (token) {
        doFetch(token);
      });
    } else {
      doFetch(null);
    }

    function doFetch(token) {
      var opts = { headers: {} };
      if (token) opts.headers['Authorization'] = 'Bearer ' + token;
      fetch('/.netlify/functions/live-admin?action=schedule', opts)
        .then(function (r) { return r.json(); })
        .then(function (data) {
          console.log('[live] schedule response:', data.ok, 'items:', data.items ? data.items.length : 0);
          if (data.ok) renderSchedule(data.items);
          if (data.error) console.warn('[live] schedule error:', data.error);
        })
        .catch(function (err) {
          console.error('[live] schedule fetch failed:', err);
        });
    }
  }

  // Expose so member.js can trigger a re-fetch when the Live tab opens
  window._liveScheduleFetch = fetchSchedule;

  // Fetch schedule after a short delay (non-blocking)
  setTimeout(fetchSchedule, 500);

  // Also re-fetch once auth is ready (may arrive after the initial 500ms fetch)
  if (typeof firebase !== 'undefined' && firebase.auth) {
    var authUnsub = firebase.auth().onAuthStateChanged(function (u) {
      if (u) {
        fetchSchedule();
        authUnsub(); // Only need this once
      }
    });
  }
})();
