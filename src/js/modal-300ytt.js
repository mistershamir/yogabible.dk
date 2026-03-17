// =========================================================================
// modal-300ytt.js — Schedule modal for 300-Hour Advanced Teacher Training
// Mirrors modal-200ytt.js pattern, sends to Netlify Functions lead endpoint
// =========================================================================
(function () {
  'use strict';

  var FORM_URL = '/.netlify/functions/lead';

  var modal = document.getElementById('yb-schedule-300-modal');
  if (!modal) return;

  var form = document.getElementById('ybu300Form');
  var submitBtn = document.getElementById('ybu300Submit');
  var errorEl = document.getElementById('ybu300Error');
  var viewForm = document.getElementById('ybu300-view-form');
  var viewSuccess = document.getElementById('ybu300-view-success');
  var accHidden = document.getElementById('ybu300Accommodation');
  var cityInput = document.getElementById('ybu300City');
  var scrollY = 0;

  // ── Language detection ──
  var isDa = window.location.pathname.indexOf('/en/') !== 0;

  // ── Open / Close ──
  function openModal() {
    scrollY = window.pageYOffset;
    modal.setAttribute('aria-hidden', 'false');
    modal.style.display = 'flex';
    document.body.style.position = 'fixed';
    document.body.style.top = '-' + scrollY + 'px';
    document.body.style.width = '100%';
    // Reset to form view
    viewForm.hidden = false;
    viewSuccess.hidden = true;
    errorEl.hidden = true;
    form.reset();
    cityInput.hidden = true;
    accHidden.value = 'No';
    // Reset toggle buttons
    var toggleBtns = modal.querySelectorAll('[data-acc300]');
    toggleBtns.forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-acc300') === 'No');
    });
  }

  function closeModal() {
    modal.setAttribute('aria-hidden', 'true');
    modal.style.display = 'none';
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
    window.scrollTo(0, scrollY);
  }

  // Global open function
  window.openP300ScheduleModal = openModal;

  // Close listeners
  modal.querySelectorAll('[data-ybu300-close]').forEach(function (el) {
    el.addEventListener('click', closeModal);
  });

  // ESC key
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false') {
      closeModal();
    }
  });

  // ── Accommodation toggle ──
  modal.querySelectorAll('[data-acc300]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      var val = this.getAttribute('data-acc300');
      accHidden.value = val;
      // Update active states for current language buttons
      var allBtns = modal.querySelectorAll('[data-acc300]');
      allBtns.forEach(function (b) { b.classList.remove('is-active'); });
      // Activate all buttons with the same value
      modal.querySelectorAll('[data-acc300="' + val + '"]').forEach(function (b) {
        b.classList.add('is-active');
      });
      cityInput.hidden = (val !== 'Yes');
      if (val === 'Yes') {
        cityInput.placeholder = isDa ? 'Hvor kommer du fra? (by, land)' : 'Where are you from? (city, country)';
      }
    });
  });

  // ── Form submission ──
  form.addEventListener('submit', function (e) {
    e.preventDefault();

    // Honeypot check
    var hp = form.querySelector('[name="ybu_hp"]');
    if (hp && hp.value) return;

    var fn = document.getElementById('ybu300FirstName').value.trim();
    var ln = document.getElementById('ybu300LastName').value.trim();
    var em = document.getElementById('ybu300Email').value.trim();
    var ph = document.getElementById('ybu300Phone').value.trim();
    var acc = accHidden.value;
    var city = cityInput.value.trim();

    // Basic validation
    if (!fn || !ln || !em || !ph) {
      errorEl.hidden = false;
      return;
    }

    errorEl.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = isDa ? 'Sender...' : 'Sending...';

    var p = new URLSearchParams();
    p.append('lang', isDa ? 'da' : 'en');
    p.append('action', 'lead_schedule_300h');
    p.append('firstName', fn);
    p.append('lastName', ln);
    p.append('email', em);
    p.append('phone', ph);
    p.append('accommodation', acc);
    p.append('source', 'Modal-300h');
    p.append('allFormats', '300h');
    if (acc === 'Yes' && city) {
      p.append('cityCountry', city);
    }

    // Attach attribution data (UTM, referrer, channel)
    if (typeof window.ybAttribution === 'function') {
      var attr = window.ybAttribution();
      if (attr.channel) p.append('channel', attr.channel);
      if (attr.utm_source) p.append('utm_source', attr.utm_source);
      if (attr.utm_medium) p.append('utm_medium', attr.utm_medium);
      if (attr.utm_campaign) p.append('utm_campaign', attr.utm_campaign);
      if (attr.gclid) p.append('gclid', attr.gclid);
      if (attr.fbclid) p.append('fbclid', attr.fbclid);
      if (attr.referrer) p.append('referrer', attr.referrer);
      if (attr.landing_page) p.append('landing_page', attr.landing_page);
    }

    fetch(FORM_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: p.toString() })
      .then(function () {
        viewForm.hidden = true;
        viewSuccess.hidden = false;
      })
      .catch(function () {
        errorEl.hidden = false;
        submitBtn.disabled = false;
        submitBtn.textContent = isDa ? 'Send & få skema' : 'Send & get schedule';
      });
  });

  // ── Bilingual toggle ──
  if (!isDa) {
    modal.querySelectorAll('[data-yj-da]').forEach(function (el) { el.hidden = true; });
    modal.querySelectorAll('[data-yj-en]').forEach(function (el) { el.hidden = false; });
  }
})();
