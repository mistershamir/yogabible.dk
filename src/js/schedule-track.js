/**
 * YOGA BIBLE — Schedule Visit Tracker
 * Tracks tokenized schedule page visits: pageview, scroll depth, time on page, revisits.
 * Included on all schedule pages. Only activates when ?tid=&tok= params are present.
 */
(function () {
  'use strict';

  var params = new URLSearchParams(window.location.search);
  var tid = params.get('tid');
  var tok = params.get('tok');
  if (!tid || !tok) return; // No token — do nothing

  var API = '/.netlify/functions/schedule-visit';
  var page = window.location.pathname;
  var maxScroll = 0;
  var startTime = Date.now();
  var lastHeartbeat = Date.now();
  var HEARTBEAT_INTERVAL = 30000; // 30 seconds
  var heartbeatTimer = null;
  var sent = { leave: false };

  // ── Send tracking event ─────────────────────────
  function track(evt, extra) {
    var payload = {
      tid: tid,
      tok: tok,
      page: page,
      event: evt
    };
    if (extra) {
      if (typeof extra.scrollDepth === 'number') payload.scrollDepth = extra.scrollDepth;
      if (typeof extra.timeOnPage === 'number') payload.timeOnPage = extra.timeOnPage;
    }

    // Use sendBeacon for leave events (page unload), fetch for others
    if (evt === 'leave' && navigator.sendBeacon) {
      navigator.sendBeacon(API, JSON.stringify(payload));
    } else {
      fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: evt === 'leave'
      }).catch(function () { /* silent */ });
    }
  }

  // ── Scroll depth tracker ────────────────────────
  function getScrollDepth() {
    var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    var docHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    );
    var winHeight = window.innerHeight;
    if (docHeight <= winHeight) return 100;
    return Math.min(100, Math.round((scrollTop + winHeight) / docHeight * 100));
  }

  function onScroll() {
    var depth = getScrollDepth();
    if (depth > maxScroll) maxScroll = depth;
  }

  // ── Heartbeat (periodic metric update) ──────────
  function heartbeat() {
    var elapsed = Math.round((Date.now() - lastHeartbeat) / 1000);
    lastHeartbeat = Date.now();
    track('heartbeat', {
      scrollDepth: maxScroll,
      timeOnPage: elapsed
    });
  }

  // ── Page leave ──────────────────────────────────
  function onLeave() {
    if (sent.leave) return;
    sent.leave = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    var elapsed = Math.round((Date.now() - lastHeartbeat) / 1000);
    track('leave', {
      scrollDepth: maxScroll,
      timeOnPage: elapsed
    });
  }

  // ── Initialize ──────────────────────────────────
  track('pageview');

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll(); // Capture initial scroll position

  heartbeatTimer = setInterval(heartbeat, HEARTBEAT_INTERVAL);

  // Capture page leave via multiple events for reliability
  window.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') onLeave();
  });
  window.addEventListener('pagehide', onLeave);
  // beforeunload as fallback for older browsers
  window.addEventListener('beforeunload', onLeave);
})();
