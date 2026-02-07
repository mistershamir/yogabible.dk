/**
 * YOGA BIBLE — Cookie Consent Manager
 * GDPR-compliant consent system for yogabible.dk
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
  var COOKIE_DAYS = 180; // 6 months — GDPR recommends re-asking periodically
  var GTM_ID = document.querySelector('meta[name="yb-gtm-id"]');
  GTM_ID = GTM_ID ? GTM_ID.getAttribute('content') : '';

  var CATEGORIES = ['necessary', 'statistics', 'marketing'];

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

  function deleteCookie(name) {
    document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;SameSite=Lax;Secure';
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

  function loadGTM() {
    if (gtmLoaded || !GTM_ID) return;
    gtmLoaded = true;

    // Push default consent state to dataLayer
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      'event': 'consent_update',
      'analytics_consent': isCategoryAccepted('statistics') ? 'granted' : 'denied',
      'marketing_consent': isCategoryAccepted('marketing') ? 'granted' : 'denied'
    });

    // Inject GTM script
    var script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtm.js?id=' + GTM_ID;
    document.head.appendChild(script);

    // Inject GTM noscript iframe
    var noscript = document.getElementById('yb-gtm-noscript');
    if (noscript) {
      noscript.innerHTML = '<iframe src="https://www.googletagmanager.com/ns.html?id=' +
        GTM_ID + '" height="0" width="0" style="display:none;visibility:hidden"></iframe>';
    }
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

    // Load GTM if any trackable category is accepted
    if (consent.statistics || consent.marketing) {
      loadGTM();
    }

    // Push updated consent signals
    if (gtmLoaded) {
      updateGTMConsent();
    }
  }

  // ============================================
  // LANGUAGE DETECTION
  // ============================================

  function getLang() {
    var hostname = window.location.hostname;
    if (hostname.indexOf('en.') === 0) return 'en';
    return 'da';
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
      // Trap focus on banner for accessibility
      var firstBtn = banner.querySelector('button');
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

    // Sync toggles with current consent
    var consent = getConsent();
    var statsToggle = modal.querySelector('#yb-cookie-toggle-statistics');
    var marketToggle = modal.querySelector('#yb-cookie-toggle-marketing');

    if (statsToggle) statsToggle.checked = consent ? consent.statistics === true : false;
    if (marketToggle) marketToggle.checked = consent ? consent.marketing === true : false;

    modal.classList.add('yb-cookie-modal--visible');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    // Focus first interactive element
    var firstToggle = modal.querySelector('input[type="checkbox"]:not([disabled])');
    if (firstToggle) firstToggle.focus();
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
    // No scripts to activate — GTM stays blocked
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
    // Banner buttons
    var acceptAllBtn = document.getElementById('yb-cookie-accept-all');
    var rejectAllBtn = document.getElementById('yb-cookie-reject-all');
    var settingsBtn = document.getElementById('yb-cookie-settings-btn');

    if (acceptAllBtn) acceptAllBtn.addEventListener('click', acceptAll);
    if (rejectAllBtn) rejectAllBtn.addEventListener('click', rejectAll);
    if (settingsBtn) settingsBtn.addEventListener('click', showModal);

    // Modal buttons
    var modalAcceptAll = document.getElementById('yb-cookie-modal-accept-all');
    var modalSave = document.getElementById('yb-cookie-modal-save');
    var modalReject = document.getElementById('yb-cookie-modal-reject');
    var modalClose = document.getElementById('yb-cookie-modal-close');

    if (modalAcceptAll) modalAcceptAll.addEventListener('click', acceptAll);
    if (modalSave) modalSave.addEventListener('click', savePreferences);
    if (modalReject) modalReject.addEventListener('click', rejectAll);
    if (modalClose) modalClose.addEventListener('click', hideModal);

    // Footer "Cookie Settings" link (can appear multiple times)
    document.querySelectorAll('[data-yb-cookie-settings]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        showModal();
      });
    });

    // Close modal on backdrop click
    var modalEl = document.getElementById('yb-cookie-modal');
    if (modalEl) {
      modalEl.addEventListener('click', function (e) {
        if (e.target === modalEl) hideModal();
      });
    }

    // Close modal on Escape key
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
    // Set language attribute on banner/modal for i18n CSS toggle
    var lang = getLang();
    var bannerEl = document.getElementById('yb-cookie-banner');
    var modalEl = document.getElementById('yb-cookie-modal');
    if (bannerEl) bannerEl.setAttribute('data-lang', lang);
    if (modalEl) modalEl.setAttribute('data-lang', lang);

    bindEvents();

    if (hasConsented()) {
      // Returning visitor — honour stored preferences
      activateScripts();
    } else {
      // First visit — show banner
      showBanner();
    }
  }

  // Run on DOMContentLoaded if document not ready, otherwise immediately
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for external use (footer link, etc.)
  window.YBCookies = {
    showModal: showModal,
    acceptAll: acceptAll,
    rejectAll: rejectAll,
    getConsent: getConsent,
    isCategoryAccepted: isCategoryAccepted
  };
})();
