/**
 * YOGA BIBLE — Marketing & Analytics Tracking
 * Comprehensive dataLayer events for GTM + Meta CAPI server-side relay.
 *
 * Loaded by cookies.js ONLY when user has granted statistics or marketing consent.
 *
 * Events pushed to dataLayer (for GTM to pick up):
 *   - page_view              (every page, with metadata)
 *   - scroll_depth            (25%, 50%, 75%, 100% milestones)
 *   - cta_click               (apply, contact, course CTAs)
 *   - form_submit_schedule    (schedule request modal)
 *   - form_submit_contact     (contact form / course enquiry)
 *   - form_submit_register    (user registration)
 *   - form_submit_login       (user login)
 *   - class_booking           (Mindbody class booked)
 *   - checkout_start          (checkout modal opened)
 *   - checkout_complete       (payment succeeded)
 *   - view_course             (course / program page viewed)
 *   - newsletter_signup       (newsletter form submitted)
 *   - phone_click             (phone number link clicked)
 *   - email_click             (email link clicked)
 *   - social_click            (social media link clicked)
 *   - outbound_click          (external link clicked)
 *
 * Meta CAPI: key conversion events are also sent server-side via
 *   /.netlify/functions/meta-capi for ad-blocker resilience.
 */

(function () {
  'use strict';

  var DL = window.dataLayer = window.dataLayer || [];
  var CAPI_URL = '/.netlify/functions/meta-capi';

  // ============================================
  // HELPERS
  // ============================================

  /** Generate a unique event ID for deduplication between browser pixel + CAPI */
  function eventId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 9);
  }

  /** Get page language */
  function getLang() {
    return document.documentElement.lang === 'en' ? 'en' : 'da';
  }

  /** Safe fbq wrapper — only fires if Meta Pixel was loaded by cookie consent */
  function pixelTrack(eventName, params, eid) {
    if (typeof fbq !== 'function') return;
    var opts = eid ? { eventID: eid } : {};
    fbq('track', eventName, params || {}, opts);
  }

  /** Check if marketing consent was granted (for CAPI calls) */
  function hasMarketingConsent() {
    try {
      var raw = document.cookie.match(/(^| )yb_consent=([^;]+)/);
      if (!raw) return false;
      var consent = JSON.parse(decodeURIComponent(raw[2]));
      return consent.marketing === true;
    } catch (e) {
      return false;
    }
  }

  /** SHA-256 hash for PII (email, phone) — required by Meta CAPI */
  function sha256(str) {
    if (!str || !window.crypto || !window.crypto.subtle) return Promise.resolve('');
    var buffer = new TextEncoder().encode(str.trim().toLowerCase());
    return window.crypto.subtle.digest('SHA-256', buffer).then(function (hash) {
      return Array.from(new Uint8Array(hash)).map(function (b) {
        return b.toString(16).padStart(2, '0');
      }).join('');
    });
  }

  /** Send event to Meta CAPI server-side (fire-and-forget) */
  function sendCAPI(eventName, eid, customData, userEmail) {
    if (!hasMarketingConsent()) return;

    var payload = {
      event_name: eventName,
      event_id: eid,
      event_source_url: window.location.href,
      custom_data: customData || {}
    };

    if (userEmail) {
      sha256(userEmail).then(function (hashed) {
        if (hashed) {
          payload.user_data = { em: [hashed] };
        }
        doSend(payload);
      });
    } else {
      doSend(payload);
    }
  }

  function doSend(payload) {
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(CAPI_URL, JSON.stringify(payload));
      } else {
        fetch(CAPI_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          keepalive: true
        });
      }
    } catch (e) { /* silent */ }
  }

  // ============================================
  // PAGE VIEW
  // ============================================

  var pvId = eventId();
  DL.push({
    event: 'page_view',
    event_id: pvId,
    page_path: window.location.pathname,
    page_title: document.title,
    page_language: getLang(),
    page_referrer: document.referrer
  });

  pixelTrack('PageView', {}, pvId);

  sendCAPI('PageView', pvId, {
    content_name: document.title
  });

  // ============================================
  // VIEW COURSE (program pages)
  // ============================================

  var coursePages = [
    '/om-200hrs-yogalreruddannelser/',
    '/200-hours-18-weeks-flexible-programs/',
    '/200-hours-8-weeks-semi-intensive-programs/',
    '/200-hours-4-weeks-intensive-programs/',
    '/inversions/', '/splits/', '/backbends/',
    '/mentorship-private-training/'
  ];

  var path = window.location.pathname.replace(/\/en/, '');
  var isCourse = coursePages.some(function (p) { return path === p; });

  if (isCourse) {
    var vcId = eventId();
    DL.push({
      event: 'view_course',
      event_id: vcId,
      course_name: document.title,
      course_url: window.location.pathname
    });

    pixelTrack('ViewContent', {
      content_name: document.title,
      content_category: 'yoga_course',
      content_type: 'product'
    }, vcId);

    sendCAPI('ViewContent', vcId, {
      content_name: document.title,
      content_category: 'yoga_course',
      content_type: 'product'
    });
  }

  // ============================================
  // SCROLL DEPTH TRACKING
  // ============================================

  var scrollMilestones = { 25: false, 50: false, 75: false, 100: false };

  function checkScroll() {
    var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    var docHeight = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight
    ) - window.innerHeight;

    if (docHeight <= 0) return;
    var pct = Math.round((scrollTop / docHeight) * 100);

    [25, 50, 75, 100].forEach(function (milestone) {
      if (pct >= milestone && !scrollMilestones[milestone]) {
        scrollMilestones[milestone] = true;
        DL.push({
          event: 'scroll_depth',
          scroll_percentage: milestone,
          page_path: window.location.pathname
        });
      }
    });
  }

  var scrollTimer;
  window.addEventListener('scroll', function () {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(checkScroll, 150);
  }, { passive: true });

  // ============================================
  // CTA CLICK TRACKING
  // ============================================

  document.addEventListener('click', function (e) {
    var link = e.target.closest('a[href]');
    if (!link) return;

    var href = link.getAttribute('href') || '';

    // Apply / Ansøg CTA
    if (href.match(/\/apply\/?$/i) || href.match(/\/en\/apply\/?$/i)) {
      DL.push({
        event: 'cta_click',
        cta_type: 'apply',
        cta_text: link.textContent.trim(),
        cta_location: detectCtaLocation(link)
      });
      return;
    }

    // Contact / Kontakt CTA
    if (href.match(/\/kontakt\/?$/i) || href.match(/\/en\/kontakt\/?$/i)) {
      DL.push({
        event: 'cta_click',
        cta_type: 'contact',
        cta_text: link.textContent.trim(),
        cta_location: detectCtaLocation(link)
      });
      return;
    }

    // Course program links
    if (href.match(/200-hours|yogalreruddannelser|inversions|splits|backbends|mentorship/i)) {
      DL.push({
        event: 'cta_click',
        cta_type: 'course',
        cta_text: link.textContent.trim(),
        cta_url: href,
        cta_location: detectCtaLocation(link)
      });
      return;
    }

    // Phone number clicks
    if (href.indexOf('tel:') === 0) {
      DL.push({
        event: 'phone_click',
        phone_number: href.replace('tel:', '')
      });
      return;
    }

    // Email clicks
    if (href.indexOf('mailto:') === 0) {
      DL.push({
        event: 'email_click',
        email_address: href.replace('mailto:', '')
      });
      return;
    }

    // Social media clicks
    if (href.match(/instagram\.com|facebook\.com|youtube\.com|tiktok\.com|soundcloud\.com/i)) {
      DL.push({
        event: 'social_click',
        social_platform: extractDomain(href),
        social_url: href
      });
      return;
    }

    // Outbound link clicks (external domains)
    if (href.indexOf('http') === 0 && href.indexOf(window.location.hostname) === -1) {
      DL.push({
        event: 'outbound_click',
        outbound_url: href,
        outbound_domain: extractDomain(href),
        link_text: link.textContent.trim().substring(0, 100)
      });
    }
  });

  function detectCtaLocation(el) {
    if (el.closest('header, .yb-header')) return 'header';
    if (el.closest('footer, .yb-footer')) return 'footer';
    if (el.closest('.yb-hero, [class*="hero"]')) return 'hero';
    if (el.closest('.yb-drawer')) return 'mobile_drawer';
    return 'page_body';
  }

  function extractDomain(url) {
    try {
      return new URL(url).hostname.replace('www.', '');
    } catch (e) {
      return url;
    }
  }

  // ============================================
  // SCHEDULE MODAL FORM SUBMIT
  // ============================================

  var ybuForm = document.getElementById('ybuForm');
  if (ybuForm) {
    ybuForm.addEventListener('submit', function () {
      var eid = eventId();
      var email = (document.getElementById('ybuEmail') || {}).value || '';
      var formats = [];
      document.querySelectorAll('input[name="format"]:checked').forEach(function (cb) {
        formats.push(cb.value);
      });

      DL.push({
        event: 'form_submit_schedule',
        event_id: eid,
        form_name: 'schedule_request',
        selected_formats: formats.join(','),
        has_accommodation: (document.getElementById('ybuAccommodation') || {}).value || 'No'
      });

      pixelTrack('Lead', {
        content_name: 'Schedule Request',
        content_category: formats.join(',')
      }, eid);

      sendCAPI('Lead', eid, {
        content_name: 'Schedule Request',
        content_category: formats.join(',')
      }, email);
    });
  }

  // ============================================
  // COURSE ENQUIRY FORM (modal-courses)
  // ============================================

  var ybcForm = document.getElementById('ybC-form');
  if (ybcForm) {
    ybcForm.addEventListener('submit', function () {
      var eid = eventId();
      DL.push({
        event: 'form_submit_contact',
        event_id: eid,
        form_name: 'course_enquiry'
      });

      pixelTrack('Lead', {
        content_name: 'Course Enquiry'
      }, eid);

      sendCAPI('Lead', eid, {
        content_name: 'Course Enquiry'
      });
    });
  }

  // ============================================
  // AUTH FORMS: REGISTER + LOGIN
  // ============================================

  var regForm = document.getElementById('yb-auth-register-form');
  if (regForm) {
    regForm.addEventListener('submit', function () {
      var eid = eventId();
      var email = (document.getElementById('yb-register-email') || {}).value || '';

      DL.push({
        event: 'form_submit_register',
        event_id: eid,
        form_name: 'user_registration'
      });

      pixelTrack('CompleteRegistration', {
        content_name: 'User Registration',
        status: 'submitted'
      }, eid);

      sendCAPI('CompleteRegistration', eid, {
        content_name: 'User Registration',
        status: 'submitted'
      }, email);
    });
  }

  var loginForm = document.getElementById('yb-auth-login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', function () {
      DL.push({
        event: 'form_submit_login',
        form_name: 'user_login'
      });
    });
  }

  // ============================================
  // CLASS BOOKING
  // ============================================

  document.addEventListener('click', function (e) {
    var bookBtn = e.target.closest('[data-mb-book]');
    if (!bookBtn) return;

    var classId = bookBtn.getAttribute('data-mb-book');
    var classRow = bookBtn.closest('.yb-mb-class');
    var className = classRow ? (classRow.querySelector('.yb-mb-class__name') || {}).textContent : '';

    DL.push({
      event: 'class_booking',
      class_id: classId,
      class_name: (className || '').trim()
    });
  });

  // ============================================
  // CHECKOUT: START + COMPLETE
  // ============================================

  // Intercept checkout open
  var origOpen = window.openYBCheckout;
  if (typeof origOpen === 'function') {
    window.openYBCheckout = function (serviceId, serviceName, servicePrice) {
      var eid = eventId();
      DL.push({
        event: 'checkout_start',
        event_id: eid,
        service_id: serviceId,
        service_name: serviceName,
        service_price: servicePrice
      });

      pixelTrack('InitiateCheckout', {
        content_name: serviceName,
        value: parseFloat(servicePrice) || 0,
        currency: 'DKK'
      }, eid);

      sendCAPI('InitiateCheckout', eid, {
        content_name: serviceName,
        value: parseFloat(servicePrice) || 0,
        currency: 'DKK'
      });

      origOpen.call(this, serviceId, serviceName, servicePrice);
    };
  }

  // Watch for checkout success
  var checkoutSuccess = document.getElementById('yb-checkout-success');
  if (checkoutSuccess) {
    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        if (m.attributeName === 'hidden' && !checkoutSuccess.hidden) {
          var serviceNameEl = document.getElementById('yb-checkout-service-name');
          var servicePriceEl = document.getElementById('yb-checkout-service-price');
          var serviceName = serviceNameEl ? serviceNameEl.textContent : '';
          var servicePrice = servicePriceEl ? servicePriceEl.textContent.replace(/[^\d.]/g, '') : '0';

          var eid = eventId();
          DL.push({
            event: 'checkout_complete',
            event_id: eid,
            service_name: serviceName.trim(),
            service_price: servicePrice,
            currency: 'DKK'
          });

          pixelTrack('Purchase', {
            content_name: serviceName.trim(),
            value: parseFloat(servicePrice) || 0,
            currency: 'DKK'
          }, eid);

          sendCAPI('Purchase', eid, {
            content_name: serviceName.trim(),
            value: parseFloat(servicePrice) || 0,
            currency: 'DKK'
          });
        }
      });
    });
    observer.observe(checkoutSuccess, { attributes: true });
  }

  // ============================================
  // SCHEDULE MODAL: OPEN EVENT
  // ============================================

  var origScheduleOpen = window.openYBScheduleModal;
  if (typeof origScheduleOpen === 'function') {
    window.openYBScheduleModal = function (fmt) {
      DL.push({
        event: 'cta_click',
        cta_type: 'get_schedule',
        cta_text: 'Schedule modal opened',
        selected_format: fmt || '18w'
      });

      origScheduleOpen.call(this, fmt);
    };
  }

  // ============================================
  // NEWSLETTER SIGNUP (if present)
  // ============================================

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || form.id === 'ybuForm' || form.id === 'ybC-form' ||
        form.id === 'yb-auth-register-form' || form.id === 'yb-auth-login-form' ||
        form.id === 'yb-auth-reset-form' || form.id === 'yb-checkout-form') return;

    // Generic form submission tracking for any other forms (newsletter, contact page, etc.)
    var emailInput = form.querySelector('input[type="email"]');
    if (emailInput) {
      var eid = eventId();
      DL.push({
        event: 'newsletter_signup',
        event_id: eid,
        form_id: form.id || 'unknown',
        page_path: window.location.pathname
      });

      pixelTrack('Lead', {
        content_name: 'Newsletter Signup',
        content_category: 'email'
      }, eid);

      sendCAPI('Lead', eid, {
        content_name: 'Newsletter Signup',
        content_category: 'email'
      }, emailInput.value);
    }
  }, true);

  console.log('✅ Tracking initialized');
})();
