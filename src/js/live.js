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
  var pollTimer = null;
  var POLL_INTERVAL = 30000;

  function showLive() {
    playerSection.style.display = 'block';
    offlineSection.style.display = 'none';
    checkingOverlay.classList.add('yb-live-player__checking--hidden');
    badge.classList.add('yb-live-badge--visible');
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
