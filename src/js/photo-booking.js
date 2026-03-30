/**
 * YOGA BIBLE — PHOTO SESSION REQUEST BOOKING
 * Request-based booking for yoga photography.
 * User suggests up to 3 date/time options → admin confirms or proposes alternative.
 *
 * Usage:
 *   <button data-open-photo-booking>Book</button>
 *   window.openPhotoBookingModal();
 */
(function () {
  'use strict';

  var API = '/.netlify/functions/appointment-book';
  var isDa = window.location.pathname.indexOf('/en/') !== 0;

  function $(id) { return document.getElementById(id); }
  function t(da, en) { return isDa ? da : en; }

  var monthNames = isDa
    ? ['Januar', 'Februar', 'Marts', 'April', 'Maj', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'December']
    : ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  /* ══════════════════════════════════════════
     MODAL OPEN / CLOSE
     ══════════════════════════════════════════ */
  function openModal() {
    var modal = $('yb-pbook-modal');
    if (!modal) return;
    goToStep(1);

    // Set minimum date to tomorrow
    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    var minDate = tomorrow.toISOString().slice(0, 10);
    var maxDate = new Date(tomorrow.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    for (var i = 1; i <= 3; i++) {
      var dateInput = $('yb-pbook-date-' + i);
      if (dateInput) {
        dateInput.setAttribute('min', minDate);
        dateInput.setAttribute('max', maxDate);
      }
    }

    modal.removeAttribute('style');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    // Record the time the modal was opened (used for spam timing check)
    var openedAtEl = $('yb-pbook-opened-at');
    if (openedAtEl) openedAtEl.value = String(Date.now());
  }

  function closeModal() {
    var modal = $('yb-pbook-modal');
    if (!modal) return;
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  window.openPhotoBookingModal = openModal;

  /* ══════════════════════════════════════════
     STEP NAVIGATION
     ══════════════════════════════════════════ */
  function goToStep(n) {
    var modal = $('yb-pbook-modal');
    if (!modal) return;
    modal.querySelectorAll('[data-pbook-step]').forEach(function (p) {
      p.classList.remove('is-active');
    });
    var panel = modal.querySelector('[data-pbook-step="' + n + '"]');
    if (panel) panel.classList.add('is-active');

    modal.querySelectorAll('.yb-pbook__step-dot').forEach(function (dot) {
      var step = parseInt(dot.getAttribute('data-step'));
      dot.classList.toggle('is-active', step <= n);
      dot.classList.toggle('is-current', step === n);
    });
    modal.querySelectorAll('.yb-pbook__step-line').forEach(function (line, idx) {
      line.classList.toggle('is-active', idx < n - 1);
    });
  }

  /* ══════════════════════════════════════════
     COLLECT FORM DATA
     ══════════════════════════════════════════ */
  function getFormData() {
    var name = ($('yb-pbook-name') || {}).value || '';
    var email = ($('yb-pbook-email') || {}).value || '';
    var phone = ($('yb-pbook-phone') || {}).value || '';
    var location = ($('yb-pbook-location') || {}).value || 'studio';
    var message = ($('yb-pbook-message') || {}).value || '';

    var slots = [];
    for (var i = 1; i <= 3; i++) {
      var date = ($('yb-pbook-date-' + i) || {}).value || '';
      var time = ($('yb-pbook-time-' + i) || {}).value || '';
      if (date && time) {
        slots.push({ date: date, time: time });
      }
    }

    return {
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      location_pref: location,
      message: message.trim(),
      preferred_slots: slots
    };
  }

  function validateStep1() {
    var data = getFormData();
    if (!data.name) { alert(t('Indtast dit navn', 'Please enter your name')); return false; }
    if (!data.email) { alert(t('Indtast din email', 'Please enter your email')); return false; }
    if (data.preferred_slots.length < 1) { alert(t('Foreslå mindst 1 tidspunkt', 'Please suggest at least 1 time')); return false; }
    return true;
  }

  /* ══════════════════════════════════════════
     RENDER SUMMARY
     ══════════════════════════════════════════ */
  function renderSummary() {
    var el = $('yb-pbook-summary');
    if (!el) return;
    var data = getFormData();

    var slotsHtml = '';
    data.preferred_slots.forEach(function (s, i) {
      var d = new Date(s.date + 'T12:00:00');
      var dateFormatted = d.getDate() + '. ' + monthNames[d.getMonth()] + ' ' + d.getFullYear();
      slotsHtml += '<div class="yb-pbook__summary-slot">' +
        '<span class="yb-pbook__summary-slot-num">' + (i + 1) + '</span>' +
        '<span><strong>' + dateFormatted + '</strong> ' + t('kl.', 'at') + ' <strong style="color:#f75c03;">' + s.time + '</strong></span>' +
        '</div>';
    });

    var locationLabel = data.location_pref === 'on-location'
      ? t('On-location (efter aftale)', 'On-location (by arrangement)')
      : 'Studio (Christianshavn)';

    el.innerHTML = '<div class="yb-pbook__summary-card">' +
      '<div class="yb-pbook__summary-row"><span class="yb-pbook__summary-label">' + t('Navn', 'Name') + '</span><span>' + data.name + '</span></div>' +
      '<div class="yb-pbook__summary-row"><span class="yb-pbook__summary-label">Email</span><span>' + data.email + '</span></div>' +
      (data.phone ? '<div class="yb-pbook__summary-row"><span class="yb-pbook__summary-label">' + t('Telefon', 'Phone') + '</span><span>' + data.phone + '</span></div>' : '') +
      '<div class="yb-pbook__summary-row"><span class="yb-pbook__summary-label">' + t('Lokation', 'Location') + '</span><span>' + locationLabel + '</span></div>' +
      (data.message ? '<div class="yb-pbook__summary-row"><span class="yb-pbook__summary-label">' + t('Besked', 'Message') + '</span><span>' + data.message + '</span></div>' : '') +
      '</div>' +
      '<div class="yb-pbook__summary-slots">' +
      '<p class="yb-pbook__summary-slots-title">' + t('Dine foretrukne tidspunkter:', 'Your preferred times:') + '</p>' +
      slotsHtml +
      '</div>';
  }

  /* ══════════════════════════════════════════
     SUBMIT REQUEST
     ══════════════════════════════════════════ */
  function submitRequest() {
    var data = getFormData();
    var btn = $('yb-pbook-submit');
    if (btn) { btn.disabled = true; btn.textContent = t('Sender...', 'Sending...'); }

    var hpEl       = $('yb-pbook-hp');
    var openedAtEl = $('yb-pbook-opened-at');

    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'photo-request',
        name: data.name,
        email: data.email,
        phone: data.phone,
        location_pref: data.location_pref,
        message: data.message,
        preferred_slots: data.preferred_slots,
        lang: isDa ? 'da' : 'en',
        source: 'website-photo-modal',
        _hp: hpEl ? hpEl.value : '',
        formOpenedAt: openedAtEl ? openedAtEl.value : ''
      })
    })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (res.ok) {
        showSuccess(data);
      } else {
        alert(t('Fejl: ', 'Error: ') + (res.error || 'Unknown error'));
        if (btn) { btn.disabled = false; btn.textContent = t('Send forespørgsel', 'Send Request'); }
      }
    })
    .catch(function () {
      alert(t('Netværksfejl. Prøv igen.', 'Network error. Please try again.'));
      if (btn) { btn.disabled = false; btn.textContent = t('Send forespørgsel', 'Send Request'); }
    });
  }

  function showSuccess(data) {
    goToStep(3);
    var detailsEl = $('yb-pbook-success-details');
    if (detailsEl && data.preferred_slots.length) {
      var html = '<div style="background:#F5F3F0;border-radius:8px;padding:16px;margin:16px 0;text-align:left;">';
      html += '<p style="margin:0 0 8px;color:#1a1a1a;font-weight:600;font-size:13px;">&#128247; ' + t('Dine forslag:', 'Your suggestions:') + '</p>';
      data.preferred_slots.forEach(function (s, i) {
        var d = new Date(s.date + 'T12:00:00');
        var dateFormatted = d.getDate() + '. ' + monthNames[d.getMonth()] + ' ' + d.getFullYear();
        html += '<p style="margin:4px 0;padding-left:8px;">&#128197; <strong>' + dateFormatted + '</strong> ' + t('kl.', 'at') + ' <strong>' + s.time + '</strong></p>';
      });
      html += '</div>';
      detailsEl.innerHTML = html;
    }
  }

  /* ══════════════════════════════════════════
     INIT
     ══════════════════════════════════════════ */
  function init() {
    // Open triggers
    document.querySelectorAll('[data-open-photo-booking]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        openModal();
      });
    });

    // Close triggers
    document.querySelectorAll('[data-close-pbook]').forEach(function (el) {
      el.addEventListener('click', closeModal);
    });

    // ESC to close
    document.addEventListener('keydown', function (e) {
      var modal = $('yb-pbook-modal');
      if (e.key === 'Escape' && modal && modal.getAttribute('aria-hidden') === 'false') closeModal();
    });

    // Step 1 → 2
    var next1 = $('yb-pbook-next-1');
    if (next1) next1.addEventListener('click', function () {
      if (!validateStep1()) return;
      goToStep(2);
      renderSummary();
    });

    // Back: 2 → 1
    var back2 = $('yb-pbook-back-2');
    if (back2) back2.addEventListener('click', function () { goToStep(1); });

    // Submit
    var submitBtn = $('yb-pbook-submit');
    if (submitBtn) submitBtn.addEventListener('click', submitRequest);

    // Auto-open from URL: ?photo-booking=1
    var urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('photo-booking')) {
      openModal();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
