/**
 * YOGA BIBLE — APPOINTMENT ADMIN
 * Full-featured Appointment Manager for the admin panel.
 * Reads/writes directly to Firestore (client-side SDK).
 *
 * Features:
 *  - Sortable table with multi-column display
 *  - Calendar month view with appointment dots
 *  - Filter by status, type, date range, search
 *  - Create / Edit / Cancel / Complete appointments
 *  - Send manual reminders
 *  - Notes timeline
 *  - CSV export
 *  - Pipeline stats (today / this week / month / cancelled)
 *  - Add-to-calendar (.ics) generation
 */
(function () {
  'use strict';

  /* ══════════════════════════════════════════
     STATE
     ══════════════════════════════════════════ */
  var db;
  var T = {};
  var appointments = [];
  var apptLoaded = false;
  var currentApptId = null;
  var currentAppt = null;
  var searchTerm = '';
  var filterStatus = '';
  var filterType = '';
  var filterDateFrom = '';
  var filterDateTo = '';
  var sortField = 'date';
  var sortDir = 'desc';
  var viewMode = 'list'; // 'list' or 'calendar'
  var calYear, calMonth; // calendar view state

  function isDa() { return (window._ybAdminLang || 'da') !== 'en'; }
  function t(k) { return T[k] || k; }
  function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function $(id) { return document.getElementById(id); }

  function toast(msg, isError) {
    var el = $('yb-admin-toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'yb-admin__toast' + (isError ? ' yb-admin__toast--error' : '');
    el.hidden = false;
    clearTimeout(el._tid);
    el._tid = setTimeout(function () { el.hidden = true; }, 3000);
  }

  /* ══════════════════════════════════════════
     STATUS HELPERS
     ══════════════════════════════════════════ */
  var STATUS_COLORS = {
    confirmed: '#4CAF50',
    rescheduled: '#f75c03',
    completed: '#2E7D32',
    cancelled: '#999',
    'no-show': '#d32f2f'
  };

  var STATUS_ICONS = {
    confirmed: '&#9989;',
    rescheduled: '&#128260;',
    completed: '&#9989;',
    cancelled: '&#10006;',
    'no-show': '&#128683;'
  };

  var TYPE_ICONS = {
    'studio-tour': '&#127963;',
    'consultation': '&#128187;',
    'intro-class': '&#129495;'
  };

  function getStatusLabel(status) {
    var key = 'appt_status_' + (status || '').replace('-', '_');
    return T[key] || status || '—';
  }

  function getTypeLabel(type) {
    var key = 'appt_' + (type || '').replace(/-/g, '_');
    return T[key] || type || '—';
  }

  function getStatusBadge(status) {
    var color = STATUS_COLORS[status] || '#999';
    var icon = STATUS_ICONS[status] || '';
    return '<span class="yb-lead__status-badge" style="background:' + color + '15;color:' + color + ';border:1px solid ' + color + '33;padding:3px 10px;border-radius:20px;font-size:12px;white-space:nowrap;">' + icon + ' ' + getStatusLabel(status) + '</span>';
  }

  /* ══════════════════════════════════════════
     DATE HELPERS
     ══════════════════════════════════════════ */
  function formatDate(dateStr) {
    if (!dateStr) return '—';
    var d = new Date(dateStr + 'T12:00:00');
    if (isDa()) {
      var daDays = ['søn', 'man', 'tir', 'ons', 'tor', 'fre', 'lør'];
      var daMonths = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
      return daDays[d.getDay()] + ' ' + d.getDate() + '. ' + daMonths[d.getMonth()] + ' ' + d.getFullYear();
    }
    return d.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  }

  function isToday(dateStr) {
    return dateStr === new Date().toISOString().slice(0, 10);
  }

  function isFuture(dateStr) {
    return dateStr >= new Date().toISOString().slice(0, 10);
  }

  function getWeekDates() {
    var now = new Date();
    var day = now.getDay();
    var diff = now.getDate() - day + (day === 0 ? -6 : 1);
    var start = new Date(now.setDate(diff));
    var end = new Date(start);
    end.setDate(end.getDate() + 6);
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  }

  function getMonthDates() {
    var now = new Date();
    var start = new Date(now.getFullYear(), now.getMonth(), 1);
    var end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  }

  /* ══════════════════════════════════════════
     FIRESTORE DATA
     ══════════════════════════════════════════ */
  function loadAppointments() {
    if (!db) return;
    var ref = db.collection('appointments').orderBy('date', 'desc').limit(500);

    ref.get().then(function (snap) {
      appointments = [];
      snap.forEach(function (doc) {
        appointments.push(Object.assign({ id: doc.id }, doc.data()));
      });
      apptLoaded = true;
      renderStats();
      renderView();
    }).catch(function (err) {
      console.error('[appointments] Load error:', err);
      toast('Error loading appointments', true);
    });
  }

  /* ══════════════════════════════════════════
     FILTERING & SORTING
     ══════════════════════════════════════════ */
  function getFiltered() {
    var filtered = appointments.slice();

    if (filterStatus) {
      filtered = filtered.filter(function (a) { return a.status === filterStatus; });
    }
    if (filterType) {
      filtered = filtered.filter(function (a) { return a.type === filterType; });
    }
    if (filterDateFrom) {
      filtered = filtered.filter(function (a) { return a.date >= filterDateFrom; });
    }
    if (filterDateTo) {
      filtered = filtered.filter(function (a) { return a.date <= filterDateTo; });
    }
    if (searchTerm) {
      var q = searchTerm.toLowerCase();
      filtered = filtered.filter(function (a) {
        return (a.client_name || '').toLowerCase().includes(q) ||
               (a.client_email || '').toLowerCase().includes(q) ||
               (a.client_phone || '').toLowerCase().includes(q);
      });
    }

    // Sort
    filtered.sort(function (a, b) {
      var va = a[sortField] || '';
      var vb = b[sortField] || '';
      if (sortField === 'date') {
        va = (a.date || '') + (a.time || '');
        vb = (b.date || '') + (b.time || '');
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }

  /* ══════════════════════════════════════════
     STATS
     ══════════════════════════════════════════ */
  function renderStats() {
    var el = $('yb-appt-stats');
    if (!el) return;

    var todayStr = new Date().toISOString().slice(0, 10);
    var week = getWeekDates();
    var month = getMonthDates();

    var todayCount = appointments.filter(function (a) { return a.date === todayStr && a.status !== 'cancelled'; }).length;
    var weekCount = appointments.filter(function (a) { return a.date >= week.start && a.date <= week.end && a.status !== 'cancelled'; }).length;
    var monthCount = appointments.filter(function (a) { return a.date >= month.start && a.date <= month.end && a.status !== 'cancelled'; }).length;
    var cancelledCount = appointments.filter(function (a) { return a.status === 'cancelled'; }).length;

    el.innerHTML =
      '<div class="yb-lead__stat-card" data-filter-date="today" style="cursor:pointer;">' +
      '<div class="yb-lead__stat-number">' + todayCount + '</div>' +
      '<div class="yb-lead__stat-label">' + t('appt_stats_today') + '</div></div>' +
      '<div class="yb-lead__stat-card" data-filter-date="week" style="cursor:pointer;">' +
      '<div class="yb-lead__stat-number">' + weekCount + '</div>' +
      '<div class="yb-lead__stat-label">' + t('appt_stats_week') + '</div></div>' +
      '<div class="yb-lead__stat-card" data-filter-date="month" style="cursor:pointer;">' +
      '<div class="yb-lead__stat-number">' + monthCount + '</div>' +
      '<div class="yb-lead__stat-label">' + t('appt_stats_month') + '</div></div>' +
      '<div class="yb-lead__stat-card" data-filter-date="cancelled" style="cursor:pointer;">' +
      '<div class="yb-lead__stat-number" style="color:#d32f2f;">' + cancelledCount + '</div>' +
      '<div class="yb-lead__stat-label">' + t('appt_stats_cancelled') + '</div></div>';

    // Click handlers for stat cards
    el.querySelectorAll('[data-filter-date]').forEach(function (card) {
      card.addEventListener('click', function () {
        var range = card.getAttribute('data-filter-date');
        var fromEl = $('yb-appt-date-from');
        var toEl = $('yb-appt-date-to');
        var statusEl = $('yb-appt-status-filter');

        if (range === 'today') {
          filterDateFrom = todayStr;
          filterDateTo = todayStr;
          filterStatus = '';
        } else if (range === 'week') {
          filterDateFrom = week.start;
          filterDateTo = week.end;
          filterStatus = '';
        } else if (range === 'month') {
          filterDateFrom = month.start;
          filterDateTo = month.end;
          filterStatus = '';
        } else if (range === 'cancelled') {
          filterDateFrom = '';
          filterDateTo = '';
          filterStatus = 'cancelled';
        }

        if (fromEl) fromEl.value = filterDateFrom;
        if (toEl) toEl.value = filterDateTo;
        if (statusEl) statusEl.value = filterStatus;
        renderView();
      });
    });
  }

  /* ══════════════════════════════════════════
     RENDER VIEW DISPATCH
     ══════════════════════════════════════════ */
  function renderView() {
    if (viewMode === 'calendar') {
      renderCalendar();
      if ($('yb-appt-table-container')) $('yb-appt-table-container').hidden = true;
      if ($('yb-appt-calendar')) $('yb-appt-calendar').hidden = false;
    } else {
      renderTable();
      if ($('yb-appt-table-container')) $('yb-appt-table-container').hidden = false;
      if ($('yb-appt-calendar')) $('yb-appt-calendar').hidden = true;
    }
  }

  /* ══════════════════════════════════════════
     TABLE VIEW
     ══════════════════════════════════════════ */
  function renderTable() {
    var tbody = $('yb-appt-table-body');
    if (!tbody) return;

    var filtered = getFiltered();
    var countEl = $('yb-appt-count');
    if (countEl) countEl.textContent = filtered.length + ' ' + (isDa() ? 'aftaler' : 'appointments');

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:32px;color:#999;">' + t('appt_no_appointments') + '</td></tr>';
      return;
    }

    var html = '';
    filtered.forEach(function (appt) {
      var todayClass = isToday(appt.date) ? 'background:#FFF8E1;' : '';
      var pastClass = !isFuture(appt.date) && appt.status === 'confirmed' ? 'opacity:0.6;' : '';

      html += '<tr style="cursor:pointer;' + todayClass + pastClass + '" data-appt-id="' + appt.id + '">' +
        '<td class="yb-lead__td-chevron">&#9656;</td>' +
        '<td><strong>' + formatDate(appt.date) + '</strong>' + (isToday(appt.date) ? ' <span style="color:#f75c03;font-size:11px;font-weight:bold;">' + t('appt_today').toUpperCase() + '</span>' : '') + '</td>' +
        '<td style="font-weight:bold;font-size:15px;">' + esc(appt.time || '') + '</td>' +
        '<td>' + esc(appt.client_name || '') + '<br><span style="color:#999;font-size:12px;">' + esc(appt.client_email || '') + '</span></td>' +
        '<td>' + (TYPE_ICONS[appt.type] || '') + ' ' + getTypeLabel(appt.type) + '</td>' +
        '<td>' + (appt.duration || 30) + ' ' + t('appt_min') + '</td>' +
        '<td>' + getStatusBadge(appt.status) + '</td>' +
        '<td style="color:#999;font-size:12px;">' + esc(appt.source || '—') + '</td>' +
        '<td><button class="yb-btn yb-btn--outline yb-btn--sm" data-action="appt-view" data-id="' + appt.id + '" style="white-space:nowrap;">&#128065; ' + (isDa() ? 'Vis' : 'View') + '</button></td>' +
        '</tr>';
    });

    tbody.innerHTML = html;

    // Row click → detail
    tbody.querySelectorAll('tr[data-appt-id]').forEach(function (row) {
      row.addEventListener('click', function (e) {
        if (e.target.closest('button')) return;
        showDetail(row.getAttribute('data-appt-id'));
      });
    });
    tbody.querySelectorAll('[data-action="appt-view"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        showDetail(btn.getAttribute('data-id'));
      });
    });
  }

  /* ══════════════════════════════════════════
     CALENDAR VIEW
     ══════════════════════════════════════════ */
  function renderCalendar() {
    var grid = $('yb-appt-calendar-grid');
    var titleEl = $('yb-appt-calendar-month');
    if (!grid) return;

    if (!calYear) {
      var now = new Date();
      calYear = now.getFullYear();
      calMonth = now.getMonth();
    }

    var monthNames = isDa()
      ? ['Januar', 'Februar', 'Marts', 'April', 'Maj', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'December']
      : ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    var dayNames = isDa()
      ? ['Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør', 'Søn']
      : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    if (titleEl) titleEl.textContent = monthNames[calMonth] + ' ' + calYear;

    var firstDay = new Date(calYear, calMonth, 1);
    var lastDay = new Date(calYear, calMonth + 1, 0);
    var startDow = (firstDay.getDay() + 6) % 7; // Monday = 0
    var todayStr = new Date().toISOString().slice(0, 10);

    // Index appointments by date
    var byDate = {};
    appointments.forEach(function (a) {
      if (a.status === 'cancelled') return;
      if (!byDate[a.date]) byDate[a.date] = [];
      byDate[a.date].push(a);
    });

    var html = '<div class="yb-appt__cal-header">';
    dayNames.forEach(function (d) { html += '<div class="yb-appt__cal-day-name">' + d + '</div>'; });
    html += '</div><div class="yb-appt__cal-body">';

    // Empty cells before first day
    for (var e = 0; e < startDow; e++) {
      html += '<div class="yb-appt__cal-cell yb-appt__cal-cell--empty"></div>';
    }

    for (var d = 1; d <= lastDay.getDate(); d++) {
      var dateStr = calYear + '-' + String(calMonth + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      var dayAppts = byDate[dateStr] || [];
      var isTodayCell = dateStr === todayStr;
      var cellClass = 'yb-appt__cal-cell' + (isTodayCell ? ' yb-appt__cal-cell--today' : '') + (dayAppts.length > 0 ? ' yb-appt__cal-cell--has-appts' : '');

      html += '<div class="' + cellClass + '" data-date="' + dateStr + '">';
      html += '<div class="yb-appt__cal-date">' + d + '</div>';

      if (dayAppts.length > 0) {
        dayAppts.slice(0, 3).forEach(function (a) {
          var color = STATUS_COLORS[a.status] || '#f75c03';
          html += '<div class="yb-appt__cal-event" style="background:' + color + '20;border-left:3px solid ' + color + ';padding:2px 6px;margin:2px 0;border-radius:3px;font-size:11px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" data-appt-id="' + a.id + '">' +
            '<strong>' + esc(a.time) + '</strong> ' + esc(a.client_name || '') +
            '</div>';
        });
        if (dayAppts.length > 3) {
          html += '<div style="font-size:10px;color:#999;padding:0 6px;">+' + (dayAppts.length - 3) + ' ' + (isDa() ? 'mere' : 'more') + '</div>';
        }
      }

      html += '</div>';
    }

    // Fill remaining cells
    var totalCells = startDow + lastDay.getDate();
    var remaining = (7 - (totalCells % 7)) % 7;
    for (var r = 0; r < remaining; r++) {
      html += '<div class="yb-appt__cal-cell yb-appt__cal-cell--empty"></div>';
    }

    html += '</div>';
    grid.innerHTML = html;

    // Click handlers
    grid.querySelectorAll('[data-appt-id]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        showDetail(el.getAttribute('data-appt-id'));
      });
    });
  }

  /* ══════════════════════════════════════════
     DETAIL VIEW
     ══════════════════════════════════════════ */
  function showDetail(id) {
    currentAppt = appointments.find(function (a) { return a.id === id; });
    if (!currentAppt) return;
    currentApptId = id;

    // Switch views
    var listEl = $('yb-admin-v-appt-list');
    var detailEl = $('yb-admin-v-appt-detail');
    if (listEl) listEl.hidden = true;
    if (detailEl) detailEl.hidden = false;

    renderDetailCard();
    renderActions();
    populateEditForm();
    renderNotes();
  }

  function backToList() {
    var listEl = $('yb-admin-v-appt-list');
    var detailEl = $('yb-admin-v-appt-detail');
    if (listEl) listEl.hidden = false;
    if (detailEl) detailEl.hidden = true;
    currentApptId = null;
    currentAppt = null;
  }

  function renderDetailCard() {
    var el = $('yb-appt-detail-card');
    if (!el || !currentAppt) return;

    var a = currentAppt;
    var heading = $('yb-appt-detail-heading');
    if (heading) heading.textContent = a.client_name + ' — ' + formatDate(a.date);

    var locationLabel = a.location === 'online' ? (isDa() ? 'Online' : 'Online') : 'Yoga Bible, Torvegade 66';

    el.innerHTML = '<div class="yb-lead__detail-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:12px 24px;padding:20px;background:#F5F3F0;border-radius:8px;margin-bottom:16px;">' +
      '<div><span style="color:#999;font-size:12px;">' + t('appt_col_date') + '</span><br><strong>' + formatDate(a.date) + '</strong></div>' +
      '<div><span style="color:#999;font-size:12px;">' + t('appt_col_time') + '</span><br><strong style="font-size:18px;">' + esc(a.time) + '</strong></div>' +
      '<div><span style="color:#999;font-size:12px;">' + t('appt_col_type') + '</span><br>' + (TYPE_ICONS[a.type] || '') + ' ' + getTypeLabel(a.type) + '</div>' +
      '<div><span style="color:#999;font-size:12px;">' + t('appt_col_duration') + '</span><br>' + (a.duration || 30) + ' ' + t('appt_min') + '</div>' +
      '<div><span style="color:#999;font-size:12px;">' + t('appt_col_status') + '</span><br>' + getStatusBadge(a.status) + '</div>' +
      '<div><span style="color:#999;font-size:12px;">' + t('appt_new_location') + '</span><br>' + esc(locationLabel) + '</div>' +
      '<div><span style="color:#999;font-size:12px;">' + t('appt_col_client') + '</span><br><strong>' + esc(a.client_name) + '</strong></div>' +
      '<div><span style="color:#999;font-size:12px;">Email</span><br><a href="mailto:' + esc(a.client_email) + '" style="color:#f75c03;">' + esc(a.client_email) + '</a></div>' +
      (a.client_phone ? '<div><span style="color:#999;font-size:12px;">' + t('appt_new_phone') + '</span><br><a href="tel:' + esc(a.client_phone) + '" style="color:#f75c03;">' + esc(a.client_phone) + '</a></div>' : '') +
      (a.source ? '<div><span style="color:#999;font-size:12px;">' + t('appt_col_source') + '</span><br>' + esc(a.source) + '</div>' : '') +
      (a.message ? '<div style="grid-column:1/-1;"><span style="color:#999;font-size:12px;">' + (isDa() ? 'Besked' : 'Message') + '</span><br>' + esc(a.message) + '</div>' : '') +
      (a.rescheduled_from ? '<div style="grid-column:1/-1;"><span style="color:#999;font-size:12px;">' + (isDa() ? 'Flyttet fra' : 'Rescheduled from') + '</span><br><span style="text-decoration:line-through;">' + esc(a.rescheduled_from) + '</span></div>' : '') +
      '</div>';
  }

  function renderActions() {
    var el = $('yb-appt-actions');
    if (!el || !currentAppt) return;
    var a = currentAppt;

    var html = '<div style="display:flex;flex-wrap:wrap;gap:8px;">';

    if (a.status === 'confirmed' || a.status === 'rescheduled') {
      html += '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="appt-send-reminder">&#128276; ' + t('appt_send_reminder') + '</button>';
      html += '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="appt-complete">&#9989; ' + t('appt_mark_completed') + '</button>';
      html += '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="appt-no-show">&#128683; ' + t('appt_mark_no_show') + '</button>';
      html += '<button class="yb-btn yb-btn--outline yb-btn--sm yb-admin__icon-btn--danger" data-action="appt-cancel-appt">&#10006; ' + t('appt_cancel') + '</button>';
    }

    html += '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="appt-download-ics">&#128197; ' + (isDa() ? 'Download .ics' : 'Download .ics') + '</button>';
    html += '<button class="yb-btn yb-btn--outline yb-btn--sm yb-admin__icon-btn--danger" data-action="appt-delete">&#128465; ' + t('appt_delete') + '</button>';
    html += '</div>';

    el.innerHTML = html;

    // Bind action buttons
    el.querySelectorAll('[data-action]').forEach(function (btn) {
      btn.addEventListener('click', function () { handleDetailAction(btn.getAttribute('data-action')); });
    });
  }

  function handleDetailAction(action) {
    if (!currentAppt || !currentApptId) return;

    if (action === 'appt-send-reminder') {
      sendManualReminder();
    } else if (action === 'appt-complete') {
      updateStatus('completed');
    } else if (action === 'appt-no-show') {
      updateStatus('no-show');
    } else if (action === 'appt-cancel-appt') {
      if (confirm(t('appt_cancel_confirm'))) updateStatus('cancelled');
    } else if (action === 'appt-delete') {
      if (confirm(t('appt_delete_confirm'))) deleteAppointment();
    } else if (action === 'appt-download-ics') {
      downloadIcs();
    }
  }

  function updateStatus(newStatus) {
    db.collection('appointments').doc(currentApptId).update({
      status: newStatus,
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
      currentAppt.status = newStatus;
      var idx = appointments.findIndex(function (a) { return a.id === currentApptId; });
      if (idx >= 0) appointments[idx].status = newStatus;
      renderDetailCard();
      renderActions();
      renderStats();
      toast(t('appt_saved'));
    }).catch(function (err) {
      toast('Error: ' + err.message, true);
    });
  }

  function deleteAppointment() {
    db.collection('appointments').doc(currentApptId).delete().then(function () {
      appointments = appointments.filter(function (a) { return a.id !== currentApptId; });
      toast(isDa() ? 'Aftale slettet' : 'Appointment deleted');
      backToList();
      renderStats();
      renderView();
    }).catch(function (err) {
      toast('Error: ' + err.message, true);
    });
  }

  function sendManualReminder() {
    // Call the appointment-reminders-like email via Netlify function
    fetch('/.netlify/functions/appointment-book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'book', // We'll reuse the confirmation email as a reminder
        date: currentAppt.date,
        time: currentAppt.time,
        type: currentAppt.type,
        name: currentAppt.client_name,
        email: '__reminder_only__' // Flag to just send reminder
      })
    });
    // For now, just send a custom reminder via the raw email approach
    // Actually, let's use the admin send-email function
    var token = window._ybFirebaseUser ? window._ybFirebaseUser.getIdToken() : Promise.resolve('');
    (typeof token === 'object' ? token : Promise.resolve(token)).then(function (idToken) {
      return fetch('/.netlify/functions/send-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + idToken
        },
        body: JSON.stringify({
          to: currentAppt.client_email,
          subject: (isDa() ? '🔔 Påmindelse: ' : '🔔 Reminder: ') + (currentAppt.type_name_da || currentAppt.type) + ' — ' + currentAppt.date + ' kl. ' + currentAppt.time,
          body_html: '<p>' + (isDa() ? 'Hej ' : 'Hi ') + '<strong>' + esc(currentAppt.client_name) + '</strong>,</p>' +
            '<p>' + (isDa() ? 'Venlig påmindelse om din aftale:' : 'Friendly reminder about your appointment:') + '</p>' +
            '<div style="background:#F5F3F0;padding:16px;border-radius:8px;margin:16px 0;">' +
            '<p style="margin:4px 0;"><strong>' + (currentAppt.type_name_da || currentAppt.type) + '</strong></p>' +
            '<p style="margin:4px 0;">&#128197; ' + currentAppt.date + ' kl. ' + currentAppt.time + '</p>' +
            '<p style="margin:4px 0;">&#128205; ' + (currentAppt.location === 'online' ? 'Online' : 'Yoga Bible, Torvegade 66') + '</p></div>',
          mode: 'custom'
        })
      });
    }).then(function () {
      toast(t('appt_reminder_sent'));
      // Mark reminder as sent
      db.collection('appointments').doc(currentApptId).update({ reminder_sent: true });
    }).catch(function (err) {
      toast('Error: ' + err.message, true);
    });
  }

  function downloadIcs() {
    if (!currentAppt) return;
    var a = currentAppt;
    var dateClean = a.date.replace(/-/g, '');
    var timeClean = (a.time || '10:00').replace(/:/g, '') + '00';
    var dur = a.duration || 30;
    var startMin = parseInt(a.time.split(':')[0]) * 60 + parseInt(a.time.split(':')[1]);
    var endMin = startMin + dur;
    var endH = String(Math.floor(endMin / 60)).padStart(2, '0');
    var endM = String(endMin % 60).padStart(2, '0');
    var endTime = endH + endM + '00';
    var loc = a.location === 'online' ? 'Online' : 'Yoga Bible, Torvegade 66, 1400 Copenhagen K';

    var ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//YogaBible//Appt//DA\r\nBEGIN:VEVENT\r\n' +
      'DTSTART;TZID=Europe/Copenhagen:' + dateClean + 'T' + timeClean + '\r\n' +
      'DTEND;TZID=Europe/Copenhagen:' + dateClean + 'T' + endTime + '\r\n' +
      'SUMMARY:' + (a.type_name_en || a.type) + ' - ' + a.client_name + '\r\n' +
      'LOCATION:' + loc + '\r\n' +
      'UID:' + a.id + '@yogabible.dk\r\n' +
      'END:VEVENT\r\nEND:VCALENDAR';

    var blob = new Blob([ics], { type: 'text/calendar' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'appointment-' + a.date + '.ics';
    link.click();
    URL.revokeObjectURL(url);
  }

  /* ══════════════════════════════════════════
     EDIT FORM
     ══════════════════════════════════════════ */
  function populateEditForm() {
    if (!currentAppt) return;
    var a = currentAppt;
    var setVal = function (id, val) { var el = $(id); if (el) el.value = val || ''; };
    setVal('yb-appt-edit-date', a.date);
    setVal('yb-appt-edit-time', a.time);
    setVal('yb-appt-edit-type', a.type);
    setVal('yb-appt-edit-duration', a.duration || 30);
    setVal('yb-appt-edit-name', a.client_name);
    setVal('yb-appt-edit-email', a.client_email);
    setVal('yb-appt-edit-phone', a.client_phone);
    setVal('yb-appt-edit-status', a.status);
    setVal('yb-appt-edit-location', a.location);
    setVal('yb-appt-edit-notes', a.notes);
  }

  function saveEditForm() {
    if (!currentApptId) return;
    var getVal = function (id) { var el = $(id); return el ? el.value : ''; };

    var updates = {
      date: getVal('yb-appt-edit-date'),
      time: getVal('yb-appt-edit-time'),
      type: getVal('yb-appt-edit-type'),
      duration: parseInt(getVal('yb-appt-edit-duration')) || 30,
      client_name: getVal('yb-appt-edit-name'),
      client_email: getVal('yb-appt-edit-email'),
      client_phone: getVal('yb-appt-edit-phone'),
      status: getVal('yb-appt-edit-status'),
      location: getVal('yb-appt-edit-location'),
      notes: getVal('yb-appt-edit-notes'),
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    };

    db.collection('appointments').doc(currentApptId).update(updates).then(function () {
      Object.assign(currentAppt, updates);
      var idx = appointments.findIndex(function (a) { return a.id === currentApptId; });
      if (idx >= 0) Object.assign(appointments[idx], updates);
      renderDetailCard();
      renderActions();
      renderStats();
      toast(t('appt_saved'));
    }).catch(function (err) {
      toast('Error: ' + err.message, true);
    });
  }

  /* ══════════════════════════════════════════
     NOTES
     ══════════════════════════════════════════ */
  function renderNotes() {
    var el = $('yb-appt-notes-timeline');
    if (!el || !currentAppt) return;

    var notes = currentAppt._notes || [];
    if (notes.length === 0) {
      el.innerHTML = '<p style="color:#999;font-size:13px;">' + (isDa() ? 'Ingen noter endnu.' : 'No notes yet.') + '</p>';
      return;
    }

    var html = '';
    notes.forEach(function (n) {
      html += '<div class="yb-lead__note-item" style="padding:8px 0;border-bottom:1px solid #E8E4E0;">' +
        '<span style="font-size:12px;color:#999;">' + (n.date || '') + '</span>' +
        '<p style="margin:4px 0;">' + esc(n.text) + '</p></div>';
    });
    el.innerHTML = html;
  }

  function addNote(text) {
    if (!text || !currentApptId) return;
    var note = { text: text, date: new Date().toISOString().slice(0, 16).replace('T', ' '), by: 'admin' };
    var notes = currentAppt._notes || [];
    notes.push(note);

    db.collection('appointments').doc(currentApptId).update({
      _notes: notes,
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
      currentAppt._notes = notes;
      renderNotes();
      toast(isDa() ? 'Note tilføjet' : 'Note added');
    }).catch(function (err) {
      toast('Error: ' + err.message, true);
    });
  }

  /* ══════════════════════════════════════════
     CREATE APPOINTMENT (Admin)
     ══════════════════════════════════════════ */
  function createAppointment(formData) {
    var btn = $('yb-appt-create-btn');
    if (btn) { btn.disabled = true; btn.textContent = t('appt_creating'); }

    // Get auth token
    var tokenPromise = window._ybFirebaseUser ? window._ybFirebaseUser.getIdToken() : Promise.resolve('');

    tokenPromise.then(function (idToken) {
      return fetch('/.netlify/functions/appointments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + idToken
        },
        body: JSON.stringify(formData)
      });
    }).then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.ok) {
        toast(t('appt_created'));
        closeNewModal();
        loadAppointments();
      } else {
        toast('Error: ' + (data.error || 'Unknown'), true);
      }
    }).catch(function (err) {
      toast('Error: ' + err.message, true);
    }).finally(function () {
      if (btn) { btn.disabled = false; btn.textContent = t('appt_create'); }
    });
  }

  /* ══════════════════════════════════════════
     CSV EXPORT
     ══════════════════════════════════════════ */
  function exportCSV() {
    var filtered = getFiltered();
    var headers = ['Date', 'Time', 'Client Name', 'Client Email', 'Phone', 'Type', 'Duration', 'Status', 'Location', 'Source', 'Notes'];
    var rows = filtered.map(function (a) {
      return [a.date, a.time, a.client_name, a.client_email, a.client_phone, a.type, a.duration, a.status, a.location, a.source, (a.notes || '').replace(/"/g, '""')];
    });

    var csv = headers.join(',') + '\n' + rows.map(function (r) {
      return r.map(function (c) { return '"' + (c || '') + '"'; }).join(',');
    }).join('\n');

    var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'appointments-' + new Date().toISOString().slice(0, 10) + '.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  /* ══════════════════════════════════════════
     NEW MODAL
     ══════════════════════════════════════════ */
  function openNewModal() {
    var modal = $('yb-appt-new-modal');
    if (modal) modal.hidden = false;
    // Set default date to today
    var dateEl = $('yb-appt-f-date');
    if (dateEl && !dateEl.value) dateEl.value = new Date().toISOString().slice(0, 10);
  }

  function closeNewModal() {
    var modal = $('yb-appt-new-modal');
    if (modal) modal.hidden = true;
    var form = $('yb-appt-new-form');
    if (form) form.reset();
  }

  /* ══════════════════════════════════════════
     EVENT BINDINGS
     ══════════════════════════════════════════ */
  function initEventListeners() {
    // New appointment button
    var newBtn = $('yb-appt-new-btn');
    if (newBtn) newBtn.addEventListener('click', openNewModal);

    // New appointment form
    var newForm = $('yb-appt-new-form');
    if (newForm) {
      newForm.addEventListener('submit', function (e) {
        e.preventDefault();
        createAppointment({
          date: $('yb-appt-f-date').value,
          time: $('yb-appt-f-time').value,
          type: $('yb-appt-f-type').value,
          duration: parseInt($('yb-appt-f-duration').value) || 30,
          client_name: $('yb-appt-f-name').value,
          client_email: $('yb-appt-f-email').value,
          client_phone: ($('yb-appt-f-phone').value || ''),
          location: $('yb-appt-f-location').value,
          notes: ($('yb-appt-f-notes').value || ''),
          status: 'confirmed'
        });
      });
    }

    // Close modal
    document.querySelectorAll('[data-action="appt-modal-close"]').forEach(function (el) {
      el.addEventListener('click', closeNewModal);
    });

    // Back to list
    document.querySelectorAll('[data-action="back-appt"]').forEach(function (el) {
      el.addEventListener('click', backToList);
    });

    // Edit form
    var editForm = $('yb-appt-edit-form');
    if (editForm) {
      editForm.addEventListener('submit', function (e) {
        e.preventDefault();
        saveEditForm();
      });
    }

    // Note form
    var noteForm = $('yb-appt-note-form');
    if (noteForm) {
      noteForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var input = $('yb-appt-note-input');
        if (input && input.value.trim()) {
          addNote(input.value.trim());
          input.value = '';
        }
      });
    }

    // Refresh
    document.querySelectorAll('[data-action="appt-refresh"]').forEach(function (el) {
      el.addEventListener('click', loadAppointments);
    });

    // Export CSV
    document.querySelectorAll('[data-action="appt-export-csv"]').forEach(function (el) {
      el.addEventListener('click', exportCSV);
    });

    // Filters
    var statusFilter = $('yb-appt-status-filter');
    if (statusFilter) statusFilter.addEventListener('change', function () { filterStatus = this.value; renderView(); });

    var typeFilter = $('yb-appt-type-filter');
    if (typeFilter) typeFilter.addEventListener('change', function () { filterType = this.value; renderView(); });

    var dateFromFilter = $('yb-appt-date-from');
    if (dateFromFilter) dateFromFilter.addEventListener('change', function () { filterDateFrom = this.value; renderView(); });

    var dateToFilter = $('yb-appt-date-to');
    if (dateToFilter) dateToFilter.addEventListener('change', function () { filterDateTo = this.value; renderView(); });

    // Search
    var searchForm = $('yb-appt-search-form');
    if (searchForm) {
      searchForm.addEventListener('submit', function (e) { e.preventDefault(); });
    }
    var searchInput = $('yb-appt-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function () { searchTerm = this.value; renderView(); });
    }

    // View toggle (list/calendar)
    var viewToggle = $('yb-appt-view-toggle');
    if (viewToggle) {
      viewToggle.querySelectorAll('[data-view]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          viewMode = btn.getAttribute('data-view');
          viewToggle.querySelectorAll('[data-view]').forEach(function (b) { b.classList.remove('is-active'); });
          btn.classList.add('is-active');
          renderView();
        });
      });
    }

    // Calendar navigation
    document.querySelectorAll('[data-action="appt-cal-prev"]').forEach(function (el) {
      el.addEventListener('click', function () {
        calMonth--;
        if (calMonth < 0) { calMonth = 11; calYear--; }
        renderCalendar();
      });
    });
    document.querySelectorAll('[data-action="appt-cal-next"]').forEach(function (el) {
      el.addEventListener('click', function () {
        calMonth++;
        if (calMonth > 11) { calMonth = 0; calYear++; }
        renderCalendar();
      });
    });

    // Sort buttons
    document.querySelectorAll('#yb-appt-table .yb-lead__sort-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var field = btn.getAttribute('data-sort');
        if (sortField === field) {
          sortDir = sortDir === 'desc' ? 'asc' : 'desc';
        } else {
          sortField = field;
          sortDir = 'desc';
        }
        document.querySelectorAll('#yb-appt-table .yb-lead__sort-btn').forEach(function (b) {
          b.classList.remove('is-active', 'is-asc', 'is-desc');
        });
        btn.classList.add('is-active', sortDir === 'asc' ? 'is-asc' : 'is-desc');
        renderView();
      });
    });
  }

  /* ══════════════════════════════════════════
     INIT
     ══════════════════════════════════════════ */
  function init() {
    T = window._ybAdminT || {};

    // Wait for Firebase to be ready
    var checkInterval = setInterval(function () {
      if (typeof firebase !== 'undefined' && firebase.firestore && firebase.auth) {
        clearInterval(checkInterval);
        db = firebase.firestore();

        firebase.auth().onAuthStateChanged(function (user) {
          if (user) {
            window._ybFirebaseUser = user;
            // Load on tab click
            document.querySelectorAll('[data-yb-admin-tab="appointments"]').forEach(function (btn) {
              btn.addEventListener('click', function () {
                if (!apptLoaded) loadAppointments();
              });
            });
            initEventListeners();
          }
        });
      }
    }, 200);
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
