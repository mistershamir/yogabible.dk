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
 *   <button data-open-booking="info-session">Book Info Session</button>
 *   window.openBookingModal('info-session');
 */
(function () {
  'use strict';

  var API = '/.netlify/functions/appointment-book';
  var isDa = window.location.pathname.indexOf('/en/') !== 0;

  // State
  var selectedType = 'info-session';
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

  var TYPE_DURATIONS = { 'info-session': 30, 'consultation': 30, 'intro-class': 60 };
  var REQUEST_TYPES = ['intro-class']; // Types that are request-only (not instant booking)

  /* ══════════════════════════════════════════
     ICS CALENDAR HELPER
     ══════════════════════════════════════════ */
  function buildIcsFile(date, time, duration, typeName, location) {
    var dateClean = date.replace(/-/g, '');
    var timeClean = time.replace(/:/g, '') + '00';
    var h = parseInt(time.split(':')[0]);
    var m = parseInt(time.split(':')[1]);
    var endMin = h * 60 + m + (duration || 30);
    var endH = Math.floor(endMin / 60);
    var endM = endMin % 60;
    var endTime = String(endH).padStart(2, '0') + String(endM).padStart(2, '0') + '00';
    var loc = location === 'online' ? 'Online' : 'Yoga Bible, Torvegade 66, 1400 København K';
    var uid = date + '-' + time.replace(/:/g, '') + '@yogabible.dk';

    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Yoga Bible//Appointment//DA',
      'CALSCALE:GREGORIAN',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      'DTSTART;TZID=Europe/Copenhagen:' + dateClean + 'T' + timeClean,
      'DTEND;TZID=Europe/Copenhagen:' + dateClean + 'T' + endTime,
      'SUMMARY:' + (typeName || 'Appointment') + ' - Yoga Bible',
      'DESCRIPTION:' + (typeName || 'Appointment') + ' at Yoga Bible',
      'LOCATION:' + loc,
      'UID:' + uid,
      'STATUS:CONFIRMED',
      'BEGIN:VALARM',
      'TRIGGER:-PT1H',
      'ACTION:DISPLAY',
      'DESCRIPTION:Reminder: ' + (typeName || 'Appointment') + ' at Yoga Bible',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');
  }

  function downloadIcsFile(date, time, duration, typeName, location) {
    var ics = buildIcsFile(date, time, duration, typeName, location);
    var blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'appointment-' + date + '.ics';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function getGoogleCalendarUrl(date, time, duration, typeName, location) {
    var h = parseInt(time.split(':')[0]);
    var m = parseInt(time.split(':')[1]);
    var endMin = h * 60 + m + (duration || 30);
    var endH = Math.floor(endMin / 60);
    var endM = endMin % 60;
    var dateClean = date.replace(/-/g, '');
    var startStr = dateClean + 'T' + String(h).padStart(2, '0') + String(m).padStart(2, '0') + '00';
    var endStr = dateClean + 'T' + String(endH).padStart(2, '0') + String(endM).padStart(2, '0') + '00';
    var loc = location === 'online' ? 'Online' : 'Yoga Bible, Torvegade 66, 1400 København K';
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
      '&text=' + encodeURIComponent((typeName || 'Appointment') + ' - Yoga Bible') +
      '&dates=' + startStr + '/' + endStr +
      '&ctz=Europe/Copenhagen' +
      '&details=' + encodeURIComponent((typeName || 'Appointment') + ' at Yoga Bible') +
      '&location=' + encodeURIComponent(loc);
  }

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

    // Record the time the modal was opened (used for spam timing check)
    var openedAtEl = $('yb-book-opened-at');
    if (openedAtEl) openedAtEl.value = String(Date.now());
  }

  function closeModal() {
    var modal = $('yb-book-modal');
    if (!modal) return;
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  window.openBookingModal = openModal;
  window.ybBuildIcsFile = buildIcsFile;
  window.ybDownloadIcsFile = downloadIcsFile;
  window.ybGetGoogleCalendarUrl = getGoogleCalendarUrl;

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
     REQUEST MODE — toggle UI for request-only types
     ══════════════════════════════════════════ */
  function isRequestType() {
    return REQUEST_TYPES.indexOf(selectedType) !== -1;
  }

  function updateRequestMode() {
    var modal = $('yb-book-modal');
    if (!modal) return;
    var isReq = isRequestType();
    // Toggle request badge visibility
    var badge = modal.querySelector('.yb-book__request-badge');
    if (badge) badge.style.display = isReq ? 'flex' : 'none';
    // Update submit button text
    var submitBtn = $('yb-book-submit');
    if (submitBtn) {
      if (isReq) {
        submitBtn.textContent = t('Send anmodning', 'Send Request');
        submitBtn.setAttribute('data-yj-da', 'Send anmodning');
        submitBtn.setAttribute('data-yj-en', 'Send Request');
      } else {
        submitBtn.textContent = t('Bekræft aftale', 'Confirm Appointment');
        submitBtn.setAttribute('data-yj-da', 'Bekræft aftale');
        submitBtn.setAttribute('data-yj-en', 'Confirm Appointment');
      }
    }
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
      'info-session': t('Gratis infomøde', 'Free Info Session'),
      'consultation': t('Online konsultation', 'Online Consultation'),
      'intro-class': t('Gratis prøvetime', 'Free Trial Class')
    };

    var locationLabels = {
      'info-session': 'Yoga Bible, Torvegade 66, 1400 København K',
      'consultation': t('Online (link sendes på email)', 'Online (link sent via email)'),
      'intro-class': 'Yoga Bible, Torvegade 66, 1400 København K'
    };

    var isReq = isRequestType();
    var requestNotice = isReq
      ? '<div class="yb-book__request-notice">' +
          '<span style="margin-right:6px;">&#128233;</span>' +
          t('Dette er en anmodning — vi bekræfter din tid inden for 24 timer.', 'This is a request — we\'ll confirm your time within 24 hours.') +
        '</div>'
      : '';

    el.innerHTML = requestNotice +
      '<div class="yb-book__summary-card">' +
      '<div class="yb-book__summary-row"><span class="yb-book__summary-label">' + t('Type', 'Type') + '</span><span>' + (typeLabels[selectedType] || selectedType) + (isReq ? ' <span class="yb-book__req-chip">' + t('Anmodning', 'Request') + '</span>' : '') + '</span></div>' +
      '<div class="yb-book__summary-row"><span class="yb-book__summary-label">' + (isReq ? t('Ønsket dato', 'Preferred date') : t('Dato', 'Date')) + '</span><span>' + dateFormatted + '</span></div>' +
      '<div class="yb-book__summary-row"><span class="yb-book__summary-label">' + (isReq ? t('Ønsket tid', 'Preferred time') : t('Tid', 'Time')) + '</span><span style="font-weight:bold;color:#f75c03;">' + selectedTime + '</span></div>' +
      '<div class="yb-book__summary-row"><span class="yb-book__summary-label">' + t('Varighed', 'Duration') + '</span><span>' + (TYPE_DURATIONS[selectedType] || 30) + ' min</span></div>' +
      '<div class="yb-book__summary-row"><span class="yb-book__summary-label">' + t('Sted', 'Location') + '</span><span>' + (locationLabels[selectedType] || '') + '</span></div>' +
      '</div>';

    // Update submit button text for request mode
    updateRequestMode();
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
    var isReq = isRequestType();
    if (btn) { btn.disabled = true; btn.textContent = isReq ? t('Sender...', 'Sending...') : t('Booker...', 'Booking...'); }

    var hpEl       = $('yb-book-hp');
    var openedAtEl = $('yb-book-opened-at');

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
        source: 'website-modal',
        _hp: hpEl ? hpEl.value : '',
        formOpenedAt: openedAtEl ? openedAtEl.value : ''
      })
    })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (res.ok) {
        showSuccess();
      } else {
        alert(t('Fejl: ', 'Error: ') + (res.error || 'Unknown error'));
        if (btn) { btn.disabled = false; btn.textContent = isReq ? t('Send anmodning', 'Send Request') : t('Bekræft aftale', 'Confirm Appointment'); }
      }
    })
    .catch(function (err) {
      alert(t('Netværksfejl. Prøv igen.', 'Network error. Please try again.'));
      if (btn) { btn.disabled = false; btn.textContent = isReq ? t('Send anmodning', 'Send Request') : t('Bekræft aftale', 'Confirm Appointment'); }
    });
  }

  function showSuccess() {
    goToStep(4);

    var d = new Date(selectedDate + 'T12:00:00');
    var dateFormatted = d.getDate() + '. ' + monthNames[d.getMonth()] + ' ' + d.getFullYear();
    var isReq = isRequestType();

    // Update success title and text for request mode
    var titleEl = $('yb-book-modal').querySelector('[data-book-step="4"] .yb-book__title');
    var textEl = $('yb-book-success-text');
    if (isReq && titleEl) {
      titleEl.textContent = t('Anmodning sendt!', 'Request Sent!');
    }
    if (isReq && textEl) {
      textEl.textContent = t(
        'Vi har modtaget din anmodning og vender tilbage med en bekræftelse inden for 24 timer. Tjek din email.',
        'We\'ve received your request and will confirm within 24 hours. Check your email.'
      );
    }

    var detailsEl = $('yb-book-success-details');
    if (detailsEl) {
      var duration = TYPE_DURATIONS[selectedType] || 30;
      var location = selectedType === 'consultation' ? 'online' : 'studio';
      var typeName = isDa ? selectedType : selectedType;

      var calendarBtns = '';
      if (!isReq) {
        var gcalUrl = getGoogleCalendarUrl(selectedDate, selectedTime, duration, typeName, location);
        calendarBtns = '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;justify-content:center;">' +
          '<button type="button" id="yb-book-download-ics" style="display:inline-flex;align-items:center;gap:6px;padding:8px 16px;background:#fff;border:1px solid #E8E4E0;border-radius:8px;font-size:13px;cursor:pointer;font-family:inherit;color:#333;">&#128197; ' + t('Download .ics', 'Download .ics') + '</button>' +
          '<a href="' + gcalUrl + '" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;padding:8px 16px;background:#fff;border:1px solid #E8E4E0;border-radius:8px;font-size:13px;text-decoration:none;color:#333;">&#128279; Google Calendar</a>' +
          '</div>';
      }

      detailsEl.innerHTML = '<div style="background:#F5F3F0;border-radius:8px;padding:16px;margin:16px 0;text-align:left;">' +
        (isReq ? '<p style="margin:0 0 8px;color:#f75c03;font-weight:600;font-size:13px;">&#128233; ' + t('Anmodning — afventer bekræftelse', 'Request — awaiting confirmation') + '</p>' : '') +
        '<p style="margin:4px 0;">&#128197; <strong>' + dateFormatted + '</strong> ' + t('kl.', 'at') + ' <strong>' + selectedTime + '</strong></p>' +
        '<p style="margin:4px 0;">&#128205; ' + (selectedType === 'consultation' ? 'Online' : 'Yoga Bible, Torvegade 66') + '</p>' +
        '</div>' +
        calendarBtns +
        (!isReq ? '<p style="font-size:12px;color:#999;margin-top:8px;text-align:center;">' + t('Kalenderfilen sendes også med din bekræftelsesmail', 'A calendar file is also included in your confirmation email') + '</p>' : '');

      // Bind ICS download button
      if (!isReq) {
        var icsBtn = document.getElementById('yb-book-download-ics');
        if (icsBtn) {
          icsBtn.addEventListener('click', function() {
            downloadIcsFile(selectedDate, selectedTime, duration, typeName, location);
          });
        }
      }
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
          updateRequestMode();
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

    // Auto-open from URL: ?booking=1 or ?booking=info-session
    var urlParams = new URLSearchParams(window.location.search);
    var bookParam = urlParams.get('booking');
    if (bookParam) {
      var type = (bookParam === '1' || bookParam === 'true') ? null : bookParam;
      openModal(type);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
