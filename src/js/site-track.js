/**
 * YOGA BIBLE — Site Behavior Tracker
 * Tracks website browsing behavior for identified leads.
 * A lead is identified via the yb_lid cookie (set by email click-through).
 * Tracks: pageviews, scroll depth, time on page, CTA clicks.
 * Sends data to /.netlify/functions/site-visit
 */
(function () {
  'use strict';

  // ── Read lead ID from cookie ──────────────────────
  function getCookie(name) {
    var match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  var lid = getCookie('yb_lid');
  if (!lid) return; // Not an identified lead — do nothing

  // Skip admin pages
  var path = window.location.pathname;
  if (path.indexOf('/admin') === 0) return;

  var API = '/.netlify/functions/site-visit';
  var page = path;
  var maxScroll = 0;
  var startTime = Date.now();
  var lastHeartbeat = Date.now();
  var HEARTBEAT_INTERVAL = 30000; // 30 seconds
  var heartbeatTimer = null;
  var sent = { leave: false };

  // ── Send tracking event ─────────────────────────
  function track(evt, extra) {
    var payload = {
      lid: lid,
      page: page,
      event: evt
    };
    if (extra) {
      for (var k in extra) {
        if (extra[k] !== undefined && extra[k] !== null) payload[k] = extra[k];
      }
    }

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

  // ── Heartbeat ───────────────────────────────────
  function heartbeat() {
    var elapsed = Math.round((Date.now() - lastHeartbeat) / 1000);
    lastHeartbeat = Date.now();
    track('heartbeat', { scrollDepth: maxScroll, timeOnPage: elapsed });
  }

  // ── Page leave ──────────────────────────────────
  function onLeave() {
    if (sent.leave) return;
    sent.leave = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    var elapsed = Math.round((Date.now() - lastHeartbeat) / 1000);
    track('leave', { scrollDepth: maxScroll, timeOnPage: elapsed });
  }

  // ── CTA click tracking ─────────────────────────
  function trackCTAs() {
    document.addEventListener('click', function (e) {
      var el = e.target.closest('a.yb-btn, a.yb-btn--primary, a.yb-btn--secondary, button[data-checkout-product], a[data-checkout-product], .yb-hero__cta, .yb-section__cta');
      if (!el) return;
      var text = (el.textContent || '').trim().substring(0, 60);
      var href = el.getAttribute('href') || el.getAttribute('data-checkout-product') || '';
      track('cta_click', { ctaText: text, ctaHref: href });
    });
  }

  // ── Initialize ──────────────────────────────────
  track('pageview', { referrer: document.referrer || null });

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  heartbeatTimer = setInterval(heartbeat, HEARTBEAT_INTERVAL);

  window.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') onLeave();
  });
  window.addEventListener('pagehide', onLeave);
  window.addEventListener('beforeunload', onLeave);

  trackCTAs();
})();
