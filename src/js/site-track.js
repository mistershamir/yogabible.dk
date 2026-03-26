/**
 * YOGA BIBLE — Site Behavior Tracker
 * Tracks website browsing behavior for:
 *   1. Identified leads (yb_lid cookie from email click-through) → site-visit.js
 *   2. Anonymous visitors (yb_vid cookie from statistics consent) → anon-visit.js
 *
 * For identified leads: full tracking (pageviews, heartbeats, scroll, CTA clicks)
 * For anonymous visitors: lightweight tracking (pageview + leave only, saves Firestore writes)
 */
(function () {
  'use strict';

  // ── Read identity cookies ─────────────────────────
  function getCookie(name) {
    var match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  var lid = getCookie('yb_lid');
  var vid = getCookie('yb_vid');
  if (!lid && !vid) return; // No identity — do nothing

  // Skip admin pages
  var path = window.location.pathname;
  if (path.indexOf('/admin') === 0) return;

  var isAnon = !lid; // Anonymous if no lead ID
  var API = isAnon ? '/.netlify/functions/anon-visit' : '/.netlify/functions/site-visit';
  var page = path;
  var maxScroll = 0;
  var startTime = Date.now();
  var lastHeartbeat = Date.now();
  var HEARTBEAT_INTERVAL = 30000; // 30 seconds
  var heartbeatTimer = null;
  var sent = { leave: false };

  // Session ID for anonymous visitors (group pages within a session)
  var sessionId = isAnon ? ('s_' + Date.now().toString(36)) : null;

  // ── Send tracking event ─────────────────────────
  function track(evt, extra) {
    var payload = {
      page: page,
      event: evt
    };
    // Identify as lead or anonymous visitor
    if (lid) {
      payload.lid = lid;
    } else {
      payload.vid = vid;
      payload.session = sessionId;
    }
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

  // ── Heartbeat (leads only — skipped for anonymous to save writes) ──
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
  var pageviewExtra = { referrer: document.referrer || null };
  if (isAnon) {
    pageviewExtra.title = document.title || '';
    // Pass attribution on first pageview for anonymous visitors
    if (typeof window.ybAttribution === 'function') {
      var attr = window.ybAttribution();
      if (attr && (attr.utm_source || attr.channel || attr.referrer)) {
        pageviewExtra.attribution = attr;
      }
    }
  }
  track('pageview', pageviewExtra);

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Heartbeats only for identified leads (not anonymous — saves Firestore writes)
  if (!isAnon) {
    heartbeatTimer = setInterval(heartbeat, HEARTBEAT_INTERVAL);
  }

  window.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') onLeave();
  });
  window.addEventListener('pagehide', onLeave);
  window.addEventListener('beforeunload', onLeave);

  trackCTAs();
})();
