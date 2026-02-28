(function () {
  var container = document.getElementById('yb-live');
  if (!container) return;

  var playbackId = container.dataset.playbackId;
  var playerSection = document.getElementById('yb-live-player-section');
  var offlineSection = document.getElementById('yb-live-offline');
  var checkingOverlay = document.getElementById('yb-live-checking');
  var badge = document.getElementById('yb-live-badge');
  var retryBtn = document.getElementById('yb-live-retry');
  var player = document.getElementById('yb-mux-player');
  var elapsedEl = document.getElementById('yb-live-elapsed');
  var elapsedTimeEl = document.getElementById('yb-live-elapsed-time');
  var scheduleSection = document.getElementById('yb-live-schedule');
  var scheduleList = document.getElementById('yb-live-schedule-list');
  var pollTimer = null;
  var elapsedTimer = null;
  var POLL_INTERVAL = 30000;

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

  function showLive() {
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
    playerSection.style.display = 'none';
    offlineSection.style.display = 'block';
    badge.classList.remove('yb-live-badge--visible');
    checkingOverlay.classList.add('yb-live-player__checking--hidden');
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
            showLive();
            if (player) {
              player.setAttribute('playback-id', playbackId);
            }
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
      checkStream();
    });
  }

  if (player) {
    player.addEventListener('playing', function () {
      showLive();
    });

    player.addEventListener('error', function () {
      showOffline();
    });
  }

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
      var title = isDa ? (item.title_da || item.title_en || '') : (item.title_en || item.title_da || '');
      var isLive = item.status === 'live';

      var dayLabel = '';
      if (isToday(d)) dayLabel = tToday;
      else if (isTomorrow(d)) dayLabel = tTomorrow;

      var tag = '';
      if (isLive) {
        tag = '<span class="yb-live-schedule__tag yb-live-schedule__tag--live"><span class="yb-live-badge__dot"></span>' + tLiveNow + '</span>';
      } else {
        tag = '<span class="yb-live-schedule__tag yb-live-schedule__tag--upcoming">' + hours + ':' + mins + '</span>';
      }

      html += '<div class="yb-live-schedule__item' + (isLive ? ' yb-live-schedule__item--live' : '') + '">';
      html += '<div class="yb-live-schedule__date">';
      html += '<div class="yb-live-schedule__day">' + day + '</div>';
      html += '<div class="yb-live-schedule__month">' + esc(dayLabel || monthLabel) + '</div>';
      html += '</div>';
      html += '<div class="yb-live-schedule__info">';
      html += '<p class="yb-live-schedule__name">' + esc(title) + '</p>';
      html += '<span class="yb-live-schedule__meta">' + esc(item.instructor || '') + '</span>';
      html += '</div>';
      html += tag;
      html += '</div>';
    }

    scheduleList.innerHTML = html;
  }

  function fetchSchedule() {
    var headers = {};
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
          if (data.ok) renderSchedule(data.items);
        })
        .catch(function () {});
    }
  }

  // Fetch schedule after a short delay (non-blocking)
  setTimeout(fetchSchedule, 500);
})();
