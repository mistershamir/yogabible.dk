/**
 * YOGA BIBLE — Cookie Consent Manager
 * GDPR-compliant consent system for yogabible.dk
 *
 * i18n: Uses data-yb-da / data-yb-en with hidden attribute
 *       (same pattern as data-yj-da / data-yj-en in journal.js)
 *
 * Categories:
 *   - necessary: Always on (language pref, session, consent cookie itself)
 *   - statistics: Google Analytics (via GTM)
 *   - marketing:  Meta Pixel (via GTM)
 */

(function () {
  'use strict';

  // ============================================
  // CONFIGURATION
  // ============================================

  var COOKIE_NAME = 'yb_consent';
  var COOKIE_DAYS = 180;
  var GTM_ID = (function () {
    var el = document.querySelector('meta[name="yb-gtm-id"]');
    return el ? el.getAttribute('content') : '';
  })();

  // ============================================
  // LANGUAGE — hidden attribute toggle
  // ============================================

  function applyLanguage() {
    var host = window.location.hostname.toLowerCase();
    var isEN = host.indexOf('en.') === 0;
    var daEls = document.querySelectorAll('[data-yb-da]');
    var enEls = document.querySelectorAll('[data-yb-en]');

    for (var i = 0; i < daEls.length; i++) {
      daEls[i].hidden = isEN;
    }
    for (var i = 0; i < enEls.length; i++) {
      enEls[i].hidden = !isEN;
    }
  }

  // ============================================
  // COOKIE HELPERS
  // ============================================

  function setCookie(name, value, days) {
    var d = new Date();
    d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
    document.cookie = name + '=' + encodeURIComponent(value) +
      ';expires=' + d.toUTCString() +
      ';path=/;SameSite=Lax;Secure';
  }

  function getCookie(name) {
    var match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? decodeURIComponent(match[2]) : null;
  }

  // ============================================
  // CONSENT STATE
  // ============================================

  function getConsent() {
    var raw = getCookie(COOKIE_NAME);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function saveConsent(consent) {
    consent.timestamp = new Date().toISOString();
    setCookie(COOKIE_NAME, JSON.stringify(consent), COOKIE_DAYS);
  }

  function hasConsented() {
    return getConsent() !== null;
  }

  function isCategoryAccepted(category) {
    var consent = getConsent();
    if (!consent) return false;
    if (category === 'necessary') return true;
    return consent[category] === true;
  }

  // ============================================
  // SCRIPT INJECTION
  // ============================================

  var gtmLoaded = false;
  var metaPixelLoaded = false;
  var clarityLoaded = false;
  var trackingLoaded = false;

  var META_PIXEL_ID = (function () {
    var el = document.querySelector('meta[name="yb-meta-pixel-id"]');
    return el ? el.getAttribute('content') : '';
  })();

  var CLARITY_ID = (function () {
    var el = document.querySelector('meta[name="yb-clarity-id"]');
    return el ? el.getAttribute('content') : '';
  })();

  function loadGTM() {
    if (gtmLoaded || !GTM_ID) return;
    gtmLoaded = true;

    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      'event': 'consent_update',
      'analytics_consent': isCategoryAccepted('statistics') ? 'granted' : 'denied',
      'marketing_consent': isCategoryAccepted('marketing') ? 'granted' : 'denied'
    });

    var script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtm.js?id=' + GTM_ID;
    document.head.appendChild(script);

    var noscript = document.getElementById('yb-gtm-noscript');
    if (noscript) {
      noscript.innerHTML = '<iframe src="https://www.googletagmanager.com/ns.html?id=' +
        GTM_ID + '" height="0" width="0" style="display:none;visibility:hidden"></iframe>';
    }
  }

  /** Meta Pixel (fbq) — loaded when marketing consent is granted */
  function loadMetaPixel() {
    if (metaPixelLoaded || !META_PIXEL_ID) return;
    metaPixelLoaded = true;

    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      }; if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0';
      n.queue = []; t = b.createElement(e); t.async = !0; t.src = v;
      s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');

    fbq('init', META_PIXEL_ID);
  }

  /** Microsoft Clarity — heatmaps & session recordings (statistics category) */
  function loadClarity() {
    if (clarityLoaded || !CLARITY_ID) return;
    clarityLoaded = true;

    (function (c, l, a, r, i, t, y) {
      c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
      t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i;
      y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
    })(window, document, 'clarity', 'script', CLARITY_ID);
  }

  /** Load tracking.js — dataLayer events + Meta CAPI relay */
  function loadTracking() {
    if (trackingLoaded) return;
    trackingLoaded = true;

    var script = document.createElement('script');
    script.async = true;
    script.src = '/js/tracking.js';
    document.body.appendChild(script);
  }

  function updateGTMConsent() {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      'event': 'consent_update',
      'analytics_consent': isCategoryAccepted('statistics') ? 'granted' : 'denied',
      'marketing_consent': isCategoryAccepted('marketing') ? 'granted' : 'denied'
    });
  }

  function activateScripts() {
    var consent = getConsent();
    if (!consent) return;
    if (consent.marketing) {
      loadMetaPixel();
    }
    if (consent.statistics || consent.marketing) {
      loadGTM();
      loadTracking();
    }
    if (consent.statistics) {
      loadClarity();
    }
    if (gtmLoaded) {
      updateGTMConsent();
    }
  }

  // ============================================
  // BANNER / MODAL UI
  // ============================================

  var banner = null;
  var modal = null;

  function showBanner() {
    banner = document.getElementById('yb-cookie-banner');
    if (banner) {
      banner.classList.add('yb-cookie-banner--visible');
      banner.setAttribute('aria-hidden', 'false');
      var firstBtn = banner.querySelector('.yb-cookie-btn--primary');
      if (firstBtn) firstBtn.focus();
    }
  }

  function hideBanner() {
    if (banner) {
      banner.classList.remove('yb-cookie-banner--visible');
      banner.setAttribute('aria-hidden', 'true');
    }
  }

  function showModal() {
    modal = document.getElementById('yb-cookie-modal');
    if (!modal) return;
    hideBanner();

    var consent = getConsent();
    var statsToggle = modal.querySelector('#yb-cookie-toggle-statistics');
    var marketToggle = modal.querySelector('#yb-cookie-toggle-marketing');
    if (statsToggle) statsToggle.checked = consent ? consent.statistics === true : false;
    if (marketToggle) marketToggle.checked = consent ? consent.marketing === true : false;

    modal.classList.add('yb-cookie-modal--visible');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    var closeBtn = modal.querySelector('#yb-cookie-modal-close');
    if (closeBtn) closeBtn.focus();
  }

  function hideModal() {
    if (modal) {
      modal.classList.remove('yb-cookie-modal--visible');
      modal.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }
  }

  // ============================================
  // CONSENT ACTIONS
  // ============================================

  function acceptAll() {
    saveConsent({ necessary: true, statistics: true, marketing: true });
    hideBanner();
    hideModal();
    activateScripts();
  }

  function rejectAll() {
    saveConsent({ necessary: true, statistics: false, marketing: false });
    hideBanner();
    hideModal();
  }

  function savePreferences() {
    var statsToggle = document.getElementById('yb-cookie-toggle-statistics');
    var marketToggle = document.getElementById('yb-cookie-toggle-marketing');

    saveConsent({
      necessary: true,
      statistics: statsToggle ? statsToggle.checked : false,
      marketing: marketToggle ? marketToggle.checked : false
    });

    hideModal();
    activateScripts();
  }

  // ============================================
  // EVENT BINDING
  // ============================================

  function bindEvents() {
    var acceptAllBtn = document.getElementById('yb-cookie-accept-all');
    var rejectAllBtn = document.getElementById('yb-cookie-reject-all');
    var settingsBtn = document.getElementById('yb-cookie-settings-btn');

    if (acceptAllBtn) acceptAllBtn.addEventListener('click', acceptAll);
    if (rejectAllBtn) rejectAllBtn.addEventListener('click', rejectAll);
    if (settingsBtn) settingsBtn.addEventListener('click', showModal);

    var modalAcceptAll = document.getElementById('yb-cookie-modal-accept-all');
    var modalSave = document.getElementById('yb-cookie-modal-save');
    var modalReject = document.getElementById('yb-cookie-modal-reject');
    var modalClose = document.getElementById('yb-cookie-modal-close');

    if (modalAcceptAll) modalAcceptAll.addEventListener('click', acceptAll);
    if (modalSave) modalSave.addEventListener('click', savePreferences);
    if (modalReject) modalReject.addEventListener('click', rejectAll);
    if (modalClose) modalClose.addEventListener('click', hideModal);

    document.querySelectorAll('[data-yb-cookie-settings]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        showModal();
      });
    });

    var modalEl = document.getElementById('yb-cookie-modal');
    if (modalEl) {
      modalEl.addEventListener('click', function (e) {
        if (e.target === modalEl) hideModal();
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (modal && modal.classList.contains('yb-cookie-modal--visible')) {
          hideModal();
        }
      }
    });
  }

  // ============================================
  // INITIALISE
  // ============================================

  function init() {
    applyLanguage();
    bindEvents();

    if (hasConsented()) {
      activateScripts();
    } else {
      showBanner();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.YBCookies = {
    showModal: showModal,
    acceptAll: acceptAll,
    rejectAll: rejectAll,
    getConsent: getConsent,
    isCategoryAccepted: isCategoryAccepted
  };
})();
