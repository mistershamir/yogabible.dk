(function () {
  'use strict';

  var cfg = window.__yvt;
  if (!cfg) return;

  var STORAGE_KEY = 'yvt-dismissed-' + window.location.pathname;
  var widget = document.getElementById('yvt-widget');
  var preview = document.getElementById('yvt-preview');
  var thumb = document.getElementById('yvt-thumb');
  var dismiss = document.getElementById('yvt-dismiss');
  var player = document.getElementById('yvt-player');
  var minimize = document.getElementById('yvt-minimize');
  var playerClose = document.getElementById('yvt-player-close');
  var video = document.getElementById('yvt-video');

  if (!widget) return;

  // Don't show if already dismissed this session
  if (sessionStorage.getItem(STORAGE_KEY)) return;

  function show() {
    widget.hidden = false;
    // Trigger slide-in animation on next frame
    requestAnimationFrame(function () {
      widget.classList.add('yvt-widget--visible');
    });
  }

  function dismiss_widget() {
    sessionStorage.setItem(STORAGE_KEY, '1');
    widget.classList.remove('yvt-widget--visible');
    widget.addEventListener('transitionend', function () {
      widget.hidden = true;
    }, { once: true });
    // Pause video if playing
    if (video && !video.paused) video.pause();
  }

  function expand() {
    // Load video src lazily on first expand
    if (!video.src) {
      video.src = cfg.src;
    }
    preview.hidden = true;
    player.hidden = false;
    widget.classList.add('yvt-widget--expanded');
    video.play().catch(function () {});
  }

  function collapse() {
    if (video && !video.paused) video.pause();
    player.hidden = true;
    preview.hidden = false;
    widget.classList.remove('yvt-widget--expanded');
  }

  // Event listeners
  thumb.addEventListener('click', expand);
  dismiss.addEventListener('click', dismiss_widget);
  minimize.addEventListener('click', collapse);
  playerClose.addEventListener('click', dismiss_widget);

  // Keyboard: escape closes
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !widget.hidden && !player.hidden) {
      collapse();
    }
  });

  // Show after configured delay
  setTimeout(show, cfg.delay);
})();
