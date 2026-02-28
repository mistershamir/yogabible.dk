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
  var pollTimer = null;
  var elapsedTimer = null;
  var POLL_INTERVAL = 30000;

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
})();
