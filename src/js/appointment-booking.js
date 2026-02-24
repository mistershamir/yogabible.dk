/**
 * YOGA BIBLE — APPOINTMENT BOOKING
 * Client-facing booking widget. Replaces Calendly.
 *
 * Opens a 4-step modal:
 *   1. Select appointment type + date
 *   2. Pick a time slot (fetched from API)
 *   3. Enter client details + confirm
 *   4. Success confirmation
 *
 * Usage:
 *   <button data-open-booking>Book</button>
 *   <button data-open-booking="studio-tour">Book Studio Tour</button>
 *   window.openBookingModal('studio-tour');
 */
(function () {
  'use strict';

  var API = '/.netlify/functions/appointment-book';
  var isDa = window.location.pathname.indexOf('/en/') !== 0;

  // State
  var selectedType = 'studio-tour';
  var selectedDate = null;
  var selectedTime = null;
  var calYear, calMonth;

  // Helpers
  function $(id) { return document.getElementById(id); }
  function t(da, en) { return isDa ? da : en; }

  var monthNames = isDa
    ? ['Januar', 'Februar', 'Marts', 'April', 'Maj', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'December']
    : ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  var dayNames = isDa
    ? ['Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør', 'Søn']
    : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  var TYPE_DURATIONS = { 'studio-tour': 30, 'consultation': 30, 'intro-class': 60 };

  /* ══════════════════════════════════════════
     MODAL OPEN / CLOSE
     ══════════════════════════════════════════ */
  function openModal(preselectedType) {
    var modal = $('yb-book-modal');
    if (!modal) return;

    if (preselectedType) {
      selectedType = preselectedType;
      // Pre-select the type button
      var types = modal.querySelectorAll('[data-type]');
      types.forEach(function (btn) {
        btn.classList.toggle('is-active', btn.getAttribute('data-type') === preselectedType);
      });
    }

    // Reset to step 1
    selectedDate = null;
    selectedTime = null;
    goToStep(1);

    // Init calendar
    var now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth();
    renderCalendar();

    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    var modal = $('yb-book-modal');
    if (!modal) return;
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  window.openBookingModal = openModal;

  /* ══════════════════════════════════════════
     STEP NAVIGATION
     ══════════════════════════════════════════ */
  function goToStep(n) {
    var modal = $('yb-book-modal');
    if (!modal) return;

    // Hide all panels
    modal.querySelectorAll('[data-book-step]').forEach(function (p) {
      p.classList.remove('is-active');
    });
    // Show target panel
    var panel = modal.querySelector('[data-book-step="' + n + '"]');
    if (panel) panel.classList.add('is-active');

    // Update step dots
    modal.querySelectorAll('.yb-book__step-dot').forEach(function (dot) {
      var step = parseInt(dot.getAttribute('data-step'));
      dot.classList.toggle('is-active', step <= n);
      dot.classList.toggle('is-current', step === n);
    });
    modal.querySelectorAll('.yb-book__step-line').forEach(function (line, idx) {
      line.classList.toggle('is-active', idx < n - 1);
    });
  }

  /* ══════════════════════════════════════════
     STEP 1: CALENDAR
     ══════════════════════════════════════════ */
  function renderCalendar() {
    var grid = $('yb-book-cal-grid');
    var title = $('yb-book-cal-title');
    if (!grid) return;

    if (title) title.textContent = monthNames[calMonth] + ' ' + calYear;

    var today = new Date();
    var todayStr = today.toISOString().slice(0, 10);
    var maxDate = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000);
    var maxStr = maxDate.toISOString().slice(0, 10);

    var firstDay = new Date(calYear, calMonth, 1);
    var lastDay = new Date(calYear, calMonth + 1, 0);
    var startDow = (firstDay.getDay() + 6) % 7;

    var html = '';
    // Day headers
    dayNames.forEach(function (d) {
      html += '<div class="yb-book__cal-dayname">' + d + '</div>';
    });

    // Empty cells
    for (var e = 0; e < startDow; e++) {
      html += '<div class="yb-book__cal-cell yb-book__cal-cell--empty"></div>';
    }

    for (var d = 1; d <= lastDay.getDate(); d++) {
      var dateStr = calYear + '-' + String(calMonth + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      var dow = new Date(calYear, calMonth, d).getDay();
      var isPast = dateStr < todayStr;
      var isTooFar = dateStr > maxStr;
      var isSunday = dow === 0;
      var disabled = isPast || isTooFar || isSunday;
      var isSelected = dateStr === selectedDate;
      var isToday = dateStr === todayStr;

      var cls = 'yb-book__cal-cell';
      if (disabled) cls += ' yb-book__cal-cell--disabled';
      if (isSelected) cls += ' yb-book__cal-cell--selected';
      if (isToday) cls += ' yb-book__cal-cell--today';

      html += '<div class="' + cls + '"' + (disabled ? '' : ' data-date="' + dateStr + '"') + '>' + d + '</div>';
    }

    grid.innerHTML = html;

    // Click handlers
    grid.querySelectorAll('[data-date]').forEach(function (cell) {
      cell.addEventListener('click', function () {
        selectedDate = cell.getAttribute('data-date');
        grid.querySelectorAll('.yb-book__cal-cell--selected').forEach(function (c) { c.classList.remove('yb-book__cal-cell--selected'); });
        cell.classList.add('yb-book__cal-cell--selected');
        var nextBtn = $('yb-book-next-1');
        if (nextBtn) nextBtn.disabled = false;
      });
    });
  }

  /* ══════════════════════════════════════════
     STEP 2: TIME SLOTS
     ══════════════════════════════════════════ */
  function loadSlots() {
    var slotsEl = $('yb-book-slots');
    var dateLabel = $('yb-book-date-display');
    if (!slotsEl) return;

    if (dateLabel) {
      var d = new Date(selectedDate + 'T12:00:00');
      dateLabel.textContent = (isDa ? dayNames[(d.getDay() + 6) % 7] : dayNames[(d.getDay() + 6) % 7]) + ' ' + d.getDate() + '. ' + monthNames[d.getMonth()] + ' ' + d.getFullYear();
    }

    slotsEl.innerHTML = '<div class="yb-book__loading">' + t('Indlæser tidspunkter...', 'Loading times...') + '</div>';

    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'slots', date: selectedDate, type: selectedType })
    })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (!res.ok || !res.data) {
        slotsEl.innerHTML = '<p style="color:#999;">' + t('Kunne ikke indlæse tidspunkter.', 'Could not load time slots.') + '</p>';
        return;
      }

      var slots = res.data.slots || [];
      var available = slots.filter(function (s) { return s.available; });

      if (available.length === 0) {
        slotsEl.innerHTML = '<p style="color:#999;text-align:center;padding:24px;">' + t('Ingen ledige tidspunkter denne dag. Prøv en anden dato.', 'No available slots this day. Try another date.') + '</p>';
        return;
      }

      var html = '<div class="yb-book__slot-grid">';
      available.forEach(function (s) {
        html += '<button class="yb-book__slot-btn" data-time="' + s.time + '" type="button">' + s.time + '</button>';
      });
      html += '</div>';
      slotsEl.innerHTML = html;

      // Click handlers
      slotsEl.querySelectorAll('[data-time]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          selectedTime = btn.getAttribute('data-time');
          slotsEl.querySelectorAll('.yb-book__slot-btn').forEach(function (b) { b.classList.remove('is-active'); });
          btn.classList.add('is-active');
          var nextBtn = $('yb-book-next-2');
          if (nextBtn) nextBtn.disabled = false;
        });
      });
    })
    .catch(function () {
      slotsEl.innerHTML = '<p style="color:#d32f2f;">' + t('Fejl ved indlæsning. Prøv igen.', 'Error loading. Please try again.') + '</p>';
    });
  }

  /* ══════════════════════════════════════════
     STEP 3: SUMMARY + FORM
     ══════════════════════════════════════════ */
  function renderSummary() {
    var el = $('yb-book-summary');
    if (!el) return;

    var d = new Date(selectedDate + 'T12:00:00');
    var dateFormatted = d.getDate() + '. ' + monthNames[d.getMonth()] + ' ' + d.getFullYear();

    var typeLabels = {
      'studio-tour': t('Studiebesøg & konsultation', 'Studio Tour & Consultation'),
      'consultation': t('Online konsultation', 'Online Consultation'),
      'intro-class': t('Gratis prøvetime', 'Free Trial Class')
    };

    var locationLabels = {
      'studio-tour': 'Yoga Bible, Torvegade 66, 1400 København K',
      'consultation': t('Online (link sendes på email)', 'Online (link sent via email)'),
      'intro-class': 'Yoga Bible, Torvegade 66, 1400 København K'
    };

    el.innerHTML = '<div class="yb-book__summary-card">' +
      '<div class="yb-book__summary-row"><span class="yb-book__summary-label">' + t('Type', 'Type') + '</span><span>' + (typeLabels[selectedType] || selectedType) + '</span></div>' +
      '<div class="yb-book__summary-row"><span class="yb-book__summary-label">' + t('Dato', 'Date') + '</span><span>' + dateFormatted + '</span></div>' +
      '<div class="yb-book__summary-row"><span class="yb-book__summary-label">' + t('Tid', 'Time') + '</span><span style="font-weight:bold;color:#f75c03;">' + selectedTime + '</span></div>' +
      '<div class="yb-book__summary-row"><span class="yb-book__summary-label">' + t('Varighed', 'Duration') + '</span><span>' + (TYPE_DURATIONS[selectedType] || 30) + ' min</span></div>' +
      '<div class="yb-book__summary-row"><span class="yb-book__summary-label">' + t('Sted', 'Location') + '</span><span>' + (locationLabels[selectedType] || '') + '</span></div>' +
      '</div>';
  }

  /* ══════════════════════════════════════════
     SUBMIT BOOKING
     ══════════════════════════════════════════ */
  function submitBooking(e) {
    e.preventDefault();

    var name = $('yb-book-name').value.trim();
    var email = $('yb-book-email').value.trim();
    var phone = $('yb-book-phone').value.trim();
    var message = $('yb-book-message').value.trim();

    if (!name || !email) return;

    var btn = $('yb-book-submit');
    if (btn) { btn.disabled = true; btn.textContent = t('Booker...', 'Booking...'); }

    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'book',
        date: selectedDate,
        time: selectedTime,
        type: selectedType,
        name: name,
        email: email,
        phone: phone,
        message: message,
        source: 'website-modal'
      })
    })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (res.ok) {
        showSuccess();
      } else {
        alert(t('Fejl: ', 'Error: ') + (res.error || 'Unknown error'));
        if (btn) { btn.disabled = false; btn.textContent = t('Bekræft aftale', 'Confirm Appointment'); }
      }
    })
    .catch(function (err) {
      alert(t('Netværksfejl. Prøv igen.', 'Network error. Please try again.'));
      if (btn) { btn.disabled = false; btn.textContent = t('Bekræft aftale', 'Confirm Appointment'); }
    });
  }

  function showSuccess() {
    goToStep(4);

    var d = new Date(selectedDate + 'T12:00:00');
    var dateFormatted = d.getDate() + '. ' + monthNames[d.getMonth()] + ' ' + d.getFullYear();

    var detailsEl = $('yb-book-success-details');
    if (detailsEl) {
      detailsEl.innerHTML = '<div style="background:#F5F3F0;border-radius:8px;padding:16px;margin:16px 0;text-align:left;">' +
        '<p style="margin:4px 0;">&#128197; <strong>' + dateFormatted + '</strong> ' + t('kl.', 'at') + ' <strong>' + selectedTime + '</strong></p>' +
        '<p style="margin:4px 0;">&#128205; ' + (selectedType === 'consultation' ? 'Online' : 'Yoga Bible, Torvegade 66') + '</p>' +
        '</div>';
    }
  }

  /* ══════════════════════════════════════════
     INIT
     ══════════════════════════════════════════ */
  function init() {
    // Open triggers
    document.querySelectorAll('[data-open-booking]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var type = btn.getAttribute('data-open-booking') || null;
        openModal(type);
      });
    });

    // Close triggers
    document.querySelectorAll('[data-close-book]').forEach(function (el) {
      el.addEventListener('click', closeModal);
    });

    // ESC to close
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeModal();
    });

    // Type selection
    var typesEl = $('yb-book-types');
    if (typesEl) {
      typesEl.querySelectorAll('[data-type]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          selectedType = btn.getAttribute('data-type');
          typesEl.querySelectorAll('[data-type]').forEach(function (b) { b.classList.remove('is-active'); });
          btn.classList.add('is-active');
        });
      });
    }

    // Calendar navigation
    var prevBtn = $('yb-book-cal-prev');
    if (prevBtn) prevBtn.addEventListener('click', function () {
      calMonth--;
      if (calMonth < 0) { calMonth = 11; calYear--; }
      renderCalendar();
    });

    var nextBtn = $('yb-book-cal-next');
    if (nextBtn) nextBtn.addEventListener('click', function () {
      calMonth++;
      if (calMonth > 11) { calMonth = 0; calYear++; }
      renderCalendar();
    });

    // Step 1 → 2
    var next1 = $('yb-book-next-1');
    if (next1) next1.addEventListener('click', function () {
      if (!selectedDate) return;
      goToStep(2);
      loadSlots();
    });

    // Step 2 → 3
    var next2 = $('yb-book-next-2');
    if (next2) next2.addEventListener('click', function () {
      if (!selectedTime) return;
      goToStep(3);
      renderSummary();
    });

    // Back buttons
    var back2 = $('yb-book-back-2');
    if (back2) back2.addEventListener('click', function () {
      selectedTime = null;
      goToStep(1);
    });

    var back3 = $('yb-book-back-3');
    if (back3) back3.addEventListener('click', function () { goToStep(2); });

    // Form submit
    var form = $('yb-book-form');
    if (form) form.addEventListener('submit', submitBooking);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
