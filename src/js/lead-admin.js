/**
 * YOGA BIBLE — LEAD ADMIN (Enhanced v2)
 * Full-featured Lead + Application Manager for the admin panel.
 * Reads/writes directly to Firestore (client-side SDK).
 *
 * Features:
 *  - Sortable table with multi-column display
 *  - Primary status + sub-status + priority + temperature
 *  - Structured notes timeline (not plain text)
 *  - Follow-up scheduling with date picker
 *  - Call logging & attempt tracking
 *  - Inline SMS & email composers
 *  - SMS conversation view (subcollection)
 *  - Bulk select + bulk actions (status, email, SMS)
 *  - Source / date range / accommodation filters
 *  - CSV export
 *  - Pipeline stats with unread SMS badge
 *  - Applications tab with full CRUD
 *  - Cross-linking between leads and applications
 *  - Marketing role detection (restricted delete)
 */
(function () {
  'use strict';

  /* ══════════════════════════════════════════
     STATE
     ══════════════════════════════════════════ */
  var db;
  var T = {};
  var currentUserRole = 'user';

  // Lead state
  var leads = [];
  var leadsLoaded = false;
  var currentLeadId = null;
  var currentLead = null;
  var lastDoc = null;
  var PAGE_SIZE = 10000; // Load all leads at once for instant search
  var totalLeadCount = null; // true DB count (from aggregation query)
  var searchTerm = '';
  var filterStatuses = []; // multi-select array
  var filterTypes = [];    // multi-select array
  var filterSubType = '';      // client-side sub-filter value
  var filterSubTypeField = ''; // which lead field to match filterSubType against
  var filterSource = '';
  var filterPriority = '';
  var filterTemperature = '';
  var sortField = 'created_at';
  var sortDir = 'desc';
  var selectedIds = new Set();
  var selectAll = false;
  var leadViewMode = 'table';
  var expandedLeadIds = new Set();

  // Kanban columns
  // 'Converted' and 'Existing Applicant' are intentionally excluded — those leads are
  // hidden from the active leads view and live in the Applications tab instead.
  var KANBAN_COLUMNS = ['New', 'Contacted', 'No Answer', 'Follow-up', 'Engaged', 'Qualified', 'Negotiating'];

  // Application state
  var applications = [];
  var appLoaded = false;
  var currentAppId = null;
  var currentApp = null;
  var appSearchTerm = '';
  var appFilterStatus = '';
  var appFilterType = '';
  var selectedAppIds = new Set();
  var selectAllApps = false;
  var showArchivedApps = false;
  var appFilterTrack = '';
  var appFilterCohort = '';

  // Language helper — returns true when admin page is Danish
  function isAdminDa() { return (window._ybAdminLang || 'da') !== 'en'; }

  // Course catalog for admin edit dropdowns (bilingual)
  var COURSE_CATALOG = {
    ytt: [
      { id: '100078', name_da: '18 Ugers Fleksibelt Program (Mar-Jun)', name_en: '18 Weeks Flexible Program (Mar-Jun)', cohorts: [{ label_da: 'Marts\u2013Juni 2026', label_en: 'March\u2013June 2026' }] },
      { id: '100121', name_da: '4 Ugers Complete Program (Apr)', name_en: '4-Week Complete Program (Apr)', cohorts: [{ label_da: 'April 2026', label_en: 'April 2026' }] },
      { id: '100211', name_da: '4 Ugers Vinyasa Plus (Jul)', name_en: '4-Week Vinyasa Plus (Jul)', cohorts: [{ label_da: 'Juli 2026', label_en: 'July 2026' }] },
      { id: '100209', name_da: '8 Ugers Semi-Intensiv (Maj-Jun)', name_en: '8 Weeks Semi-Intensive (May-Jun)', cohorts: [{ label_da: 'Maj\u2013Juni 2026', label_en: 'May\u2013June 2026' }] },
      { id: '100210', name_da: '18 Ugers Fleksibelt Program (Aug-Dec)', name_en: '18 Weeks Flexible Program (Aug-Dec)', cohorts: [{ label_da: 'August\u2013December 2026', label_en: 'August\u2013December 2026' }] }
    ],
    course: [
      { id: '100145', name_da: 'Inversions', name_en: 'Inversions', cohorts: [{ label_da: 'April 2026', label_en: 'April 2026' }] },
      { id: '100150', name_da: 'Splits', name_en: 'Splits', cohorts: [{ label_da: 'April 2026', label_en: 'April 2026' }] },
      { id: '100140', name_da: 'Backbends', name_en: 'Backbends', cohorts: [{ label_da: 'April 2026', label_en: 'April 2026' }] }
    ],
    bundle: [
      { id: '119', name_da: 'Backbends + Inversions', name_en: 'Backbends + Inversions', cohorts: [{ label_da: 'April 2026', label_en: 'April 2026' }] },
      { id: '120', name_da: 'Inversions + Splits', name_en: 'Inversions + Splits', cohorts: [{ label_da: 'April 2026', label_en: 'April 2026' }] },
      { id: '121', name_da: 'Backbends + Splits', name_en: 'Backbends + Splits', cohorts: [{ label_da: 'April 2026', label_en: 'April 2026' }] },
      { id: '127', name_da: 'All-In (Inversions + Splits + Backbends)', name_en: 'All-In (Inversions + Splits + Backbends)', cohorts: [{ label_da: 'April 2026', label_en: 'April 2026' }] }
    ],
    mentorship: []
  };
  // education is what apply.js stores for YTT
  COURSE_CATALOG.education = COURSE_CATALOG.ytt;

  // Bilingual catalog accessors
  function catalogName(item) { return isAdminDa() ? item.name_da : (item.name_en || item.name_da); }
  function cohortLabel(coh) { return isAdminDa() ? coh.label_da : (coh.label_en || coh.label_da); }

  // Payment choice labels for admin display (bilingual)
  var PAYMENT_LABELS_DA = {
    paid: 'Betalt (ældre)',
    paid_deposit: 'Forberedelsesfasen betalt',
    paid_full: 'Fuldt betalt',
    pay_now: 'Betalt via link'
  };
  var PAYMENT_LABELS_EN = {
    paid: 'Paid (legacy)',
    paid_deposit: 'Preparation Phase paid',
    paid_full: 'Fully paid',
    pay_now: 'Paid via link'
  };
  function getPaymentChoiceLabel(choice) {
    var labels = isAdminDa() ? PAYMENT_LABELS_DA : PAYMENT_LABELS_EN;
    return labels[choice] || choice || '\u2014';
  }

  // Bilingual display helpers for stored Firestore values (legacy data is Danish)
  var DISPLAY_MAP_EN = {
    // Track labels
    'Hverdagsprogram': 'Weekday Program',
    'hverdagsprogram': 'Weekday Program',
    'Weekendprogram': 'Weekend Program',
    'weekendprogram': 'Weekend Program',
    // Cohort labels
    'Marts\u2013Juni 2026': 'March\u2013June 2026',
    'April 2026': 'April 2026',
    'Juli 2026': 'July 2026',
    'Maj\u2013Juni 2026': 'May\u2013June 2026',
    'August\u2013December 2026': 'August\u2013December 2026'
  };
  // Translate a stored DA value to EN for display (pass-through if not found)
  function displayLocalized(raw) {
    if (!raw) return '\u2014';
    return isAdminDa() ? raw : (DISPLAY_MAP_EN[raw] || raw);
  }
  function displayTrack(raw) {
    if (!raw) return '\u2014';
    return displayLocalized(raw);
  }

  /* ══════════════════════════════════════════
     HELPERS
     ══════════════════════════════════════════ */
  function t(k) { return T[k] || k; }
  function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function $(id) { return document.getElementById(id); }
  function $$(sel, root) { return (root || document).querySelectorAll(sel); }

  function toast(msg, isError) {
    var el = $('yb-admin-toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'yb-admin__toast' + (isError ? ' yb-admin__toast--error' : '');
    el.hidden = false;
    clearTimeout(el._tid);
    el._tid = setTimeout(function () { el.hidden = true; }, 3500);
  }

  /**
   * Show save feedback on a submit button:
   * 1. Before save: text → "Saving..." + disable
   * 2. On success: text → "✓ Saved!" + green + pulse animation
   * 3. After 2s: revert to original
   */
  function saveBtnStart(formEl) {
    if (!formEl) return;
    var btn = formEl.querySelector('button[type="submit"]');
    if (!btn) return;
    btn._origText = btn.textContent;
    btn.textContent = t('save_feedback_saving');
    btn.disabled = true;
    btn.classList.add('yb-btn--muted');
    return btn;
  }
  function saveBtnSuccess(btn) {
    if (!btn) return;
    btn.disabled = false;
    btn.classList.remove('yb-btn--muted');
    btn.textContent = '\u2713 ' + t('save_feedback_saved');
    btn.classList.add('yb-btn--save-success', 'yb-btn--save-pulse');
    clearTimeout(btn._revertTid);
    btn._revertTid = setTimeout(function () {
      btn.classList.remove('yb-btn--save-success', 'yb-btn--save-pulse');
      btn.textContent = btn._origText || t('save');
    }, 2000);
  }
  function saveBtnError(btn) {
    if (!btn) return;
    btn.disabled = false;
    btn.classList.remove('yb-btn--muted');
    btn.textContent = btn._origText || t('save');
  }

  function fmtDate(d) {
    if (!d) return '\u2014';
    var date = d.toDate ? d.toDate() : new Date(d);
    if (isNaN(date.getTime())) return '\u2014';
    var dd = String(date.getDate()).padStart(2, '0');
    var mm = String(date.getMonth() + 1).padStart(2, '0');
    var yyyy = date.getFullYear();
    return dd + '/' + mm + '/' + yyyy;
  }

  function fmtDateTime(d) {
    if (!d) return '\u2014';
    var date = d.toDate ? d.toDate() : new Date(d);
    if (isNaN(date.getTime())) return '\u2014';
    var dd = String(date.getDate()).padStart(2, '0');
    var mm = String(date.getMonth() + 1).padStart(2, '0');
    var yyyy = date.getFullYear();
    return dd + '/' + mm + '/' + yyyy +
      ' ' + date.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
  }

  function fmtDateInput(d) {
    if (!d) return '';
    var date = d.toDate ? d.toDate() : new Date(d);
    if (isNaN(date.getTime())) return '';
    return date.toISOString().split('T')[0];
  }

  function relativeTime(d) {
    return fmtDate(d);
  }

  function fmtTime(d) {
    if (!d) return '';
    var date = d.toDate ? d.toDate() : new Date(d);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
  }

  function getAuthToken() {
    return firebase.auth().currentUser.getIdToken();
  }

  /* ══════════════════════════════════════════
     STATUS SYSTEM — LEADS
     ══════════════════════════════════════════ */
  var STATUSES = [
    { value: 'New', label: 'New', color: '#fff3cd', text: '#856404', icon: '\u2728' },
    { value: 'Contacted', label: 'Contacted', color: '#d1ecf1', text: '#0c5460', icon: '\ud83d\udce7' },
    { value: 'No Answer', label: 'No Answer', color: '#FFE0CC', text: '#BF360C', icon: '\ud83d\udcf5' },
    { value: 'Follow-up', label: 'Follow-up', color: '#e8daef', text: '#6c3483', icon: '\ud83d\udd04' },
    { value: 'Engaged', label: 'Engaged', color: '#DCEDC8', text: '#33691E', icon: '\ud83d\udcac' },
    { value: 'Strongly Interested', label: 'Strongly Interested', color: '#FFF9C4', text: '#F57F17', icon: '\u2B50' },
    { value: 'Qualified', label: 'Qualified', color: '#B3E5FC', text: '#01579B', icon: '\u2705' },
    { value: 'Negotiating', label: 'Negotiating', color: '#FFE0B2', text: '#E65100', icon: '\ud83e\udd1d' },
    { value: 'Converted', label: 'Converted', color: '#d4edda', text: '#155724', icon: '\ud83c\udf89' },
    { value: 'Existing Applicant', label: 'Existing Applicant', color: '#cce5ff', text: '#004085', icon: '\ud83d\udcc4' },
    { value: 'On Hold', label: 'On Hold', color: '#FFF9C4', text: '#F57F17', icon: '\u23f8\ufe0f' },
    { value: 'Interested In Next Round', label: 'Interested In Next Round', color: '#E0F2F1', text: '#00695C', icon: '\ud83d\udcc5' },
    { value: 'Not too keen', label: 'Not too keen', color: '#CFD8DC', text: '#37474F', icon: '\ud83d\ude10' },
    { value: 'Unsubscribed', label: 'Unsubscribed', color: '#f8d7da', text: '#721c24', icon: '\ud83d\udeab' },
    { value: 'Lost', label: 'Lost', color: '#ECEFF1', text: '#546E7F', icon: '\ud83d\udc4e' },
    { value: 'Closed', label: 'Closed', color: '#f5f5f5', text: '#9e9e9e', icon: '\u2716' },
    { value: 'Archived', label: 'Archived', color: '#EFEBE9', text: '#795548', icon: '\ud83d\udce6' }
  ];

  var SUB_STATUSES = {
    'New': ['Incoming', 'Needs Review', 'Auto-assigned'],
    'Contacted': ['First Email Sent', 'Called - Spoke', 'SMS Sent', 'WhatsApp Sent'],
    'No Answer': ['1st Attempt', '2nd Attempt', '3rd Attempt', 'Voicemail Left', 'Try Again Later'],
    'Follow-up': ['Scheduled Call', 'Waiting Reply', 'Second Follow-up', 'Third Follow-up', 'Final Attempt'],
    'Engaged': ['Asking Questions', 'Price Discussion', 'Scheduling Visit', 'Reviewing Materials'],
    'Strongly Interested': ['Application Ready', 'Price Sensitive', 'Needs More Info', 'Almost Converted', 'Second Thoughts'],
    'Qualified': ['Ready to Apply', 'Needs Payment Info', 'Considering Dates'],
    'Negotiating': ['Payment Plan', 'Scholarship Request', 'Group Discount'],
    'Converted': ['Application Submitted', 'Payment Received', 'Enrolled'],
    'Existing Applicant': ['Re-inquiry', 'Upgrade Request', 'Referral'],
    'On Hold': ['Travel Issues', 'Financial', 'Personal Reasons', 'Next Cohort'],
    'Interested In Next Round': [], // populated dynamically from COURSE_CATALOG cohorts
    'Not too keen': ['Price Too High', 'Bad Timing', 'Lost Interest', 'Considering Alternatives', 'No Reason Given'],
    'Unsubscribed': ['Email Only', 'All Communications'],
    'Lost': ['No Response', 'Chose Competitor', 'Budget', 'Not Interested', 'Wrong Fit'],
    'Closed': ['Spam', 'Duplicate', 'Invalid Contact', 'Completed'],
    'Archived': ['Cleaned Up', 'Duplicate', 'Test Lead', 'Old Data']
  };

  var PRIORITIES = [
    { value: '', label: '\u2014 None', icon: '' },
    { value: 'urgent', label: 'Urgent', icon: '\ud83d\udd34', color: '#EF5350' },
    { value: 'high', label: 'High', icon: '\ud83d\udfe0', color: '#FF9800' },
    { value: 'normal', label: 'Normal', icon: '\ud83d\udfe2', color: '#66BB6A' },
    { value: 'low', label: 'Low', icon: '\u26aa', color: '#BDBDBD' }
  ];

  var TEMPERATURES = [
    { value: '', label: '\u2014 None', icon: '' },
    { value: 'hot', label: 'Hot', icon: '\ud83d\udd25', color: '#EF5350' },
    { value: 'warm', label: 'Warm', icon: '\u2600\ufe0f', color: '#FF9800' },
    { value: 'cold', label: 'Cold', icon: '\u2744\ufe0f', color: '#42A5F5' }
  ];

  /* ══════════════════════════════════════════
     STATUS SYSTEM — APPLICATIONS
     ══════════════════════════════════════════ */
  var APP_STATUSES = [
    { value: 'Pending', label: 'Pending', color: '#fff3cd', text: '#856404', icon: '\u23f3' },
    { value: 'Under Review', label: 'Under Review', color: '#d1ecf1', text: '#0c5460', icon: '\ud83d\udd0d' },
    { value: 'Approved', label: 'Approved', color: '#d4edda', text: '#155724', icon: '\u2705' },
    { value: 'Enrolled', label: 'Enrolled', color: '#cce5ff', text: '#004085', icon: '\ud83c\udf93' },
    { value: 'Waitlisted', label: 'Waitlisted', color: '#FFE0B2', text: '#E65100', icon: '\ud83d\udccb' },
    { value: 'Rejected', label: 'Rejected', color: '#f8d7da', text: '#721c24', icon: '\u274c' },
    { value: 'Withdrawn', label: 'Withdrawn', color: '#ECEFF1', text: '#546E7F', icon: '\u21a9\ufe0f' },
    { value: 'Completed', label: 'Completed', color: '#E8F5E9', text: '#2E7D32', icon: '\ud83c\udfc6' }
  ];

  /* ══════════════════════════════════════════
     BULK STATUS PICKER (shared modal)
     ══════════════════════════════════════════ */
  function openBulkStatusPicker(statuses, count, onSelect) {
    var modal = document.getElementById('yb-bulk-status-modal');
    var grid = document.getElementById('yb-bulk-status-grid');
    var subtitle = document.getElementById('yb-bulk-status-subtitle');
    if (!modal || !grid) return;

    subtitle.textContent = count + ' ' + t('leads_selected');

    grid.innerHTML = statuses.map(function (s) {
      return '<button type="button" class="yb-bulk-status__option" data-status="' + esc(s.value) + '" style="border-color:' + s.color + '">' +
        '<span class="yb-bulk-status__option-icon">' + s.icon + '</span>' +
        '<span class="yb-bulk-status__option-label">' + esc(s.label) + '</span>' +
      '</button>';
    }).join('');

    modal.hidden = false;
    positionModalInIframe(modal);

    function close() {
      modal.hidden = true;
      grid.innerHTML = '';
      modal.removeEventListener('click', handleClick);
    }

    function handleClick(e) {
      // Close button or overlay
      if (e.target.closest('[data-close-bulk-status]')) { close(); return; }
      // Status option
      var btn = e.target.closest('.yb-bulk-status__option');
      if (btn) {
        var status = btn.getAttribute('data-status');
        close();
        onSelect(status);
      }
    }

    modal.addEventListener('click', handleClick);
  }

  /* ══════════════════════════════════════════
     STATUS HELPERS
     ══════════════════════════════════════════ */
  function getStatusMeta(status) {
    return STATUSES.find(function (s) { return s.value === status; }) || STATUSES[0];
  }

  function getAppStatusMeta(status) {
    return APP_STATUSES.find(function (s) { return s.value === status; }) || APP_STATUSES[0];
  }

  function statusBadgeHtml(status) {
    var m = getStatusMeta(status || 'New');
    return '<span class="yb-lead__badge" style="background:' + m.color + ';color:' + m.text + '">' +
      m.icon + ' ' + esc(m.label) + '</span>';
  }

  function appStatusBadgeHtml(status) {
    var m = getAppStatusMeta(status || 'Pending');
    return '<span class="yb-lead__badge" style="background:' + m.color + ';color:' + m.text + '">' +
      m.icon + ' ' + esc(m.label) + '</span>';
  }

  function priorityBadgeHtml(priority) {
    var p = PRIORITIES.find(function (x) { return x.value === priority; });
    if (!p || !p.value) return '';
    return '<span class="yb-lead__priority" title="' + p.label + '" style="color:' + p.color + '">' + p.icon + '</span>';
  }

  function temperatureBadgeHtml(temp) {
    var ti = TEMPERATURES.find(function (x) { return x.value === temp; });
    if (!ti || !ti.value) return '';
    return '<span class="yb-lead__temp" title="' + ti.label + '">' + ti.icon + '</span>';
  }

  function typeBadge(type) {
    var labels = { ytt: 'YTT', course: 'Course', bundle: 'Bundle', mentorship: 'Mentorship', careers: 'Career', contact: 'Contact' };
    return labels[(type || '').toLowerCase()] || type || '\u2014';
  }

  /** Render a colored channel badge */
  function channelBadgeHtml(channel) {
    if (!channel) return '\u2014';
    var ch = channel.toLowerCase();
    var color = '#6B7280'; // default gray
    if (ch.includes('google ads')) color = '#4285F4';
    else if (ch.includes('google') && ch.includes('organic')) color = '#34A853';
    else if (ch.includes('meta ads') || ch.includes('instagram ads')) color = '#1877F2';
    else if (ch.includes('ai referral')) color = '#8B5CF6';
    else if (ch.includes('social')) color = '#E4405F';
    else if (ch.includes('email')) color = '#f75c03';
    else if (ch.includes('sms')) color = '#22C55E';
    else if (ch.includes('referral')) color = '#F59E0B';
    else if (ch === 'direct') color = '#6B7280';
    return '<span class="yb-lead__channel-badge" style="background:' + color + '">' + esc(channel.substring(0, 25)) + '</span>';
  }

  function lcRecencyColor(d) {
    if (!d) return '#6F6A66';
    var date = d.toDate ? d.toDate() : new Date(d);
    var days = Math.floor((Date.now() - date.getTime()) / 86400000);
    if (days > 14) return '#EF5350';
    if (days > 7) return '#FF9800';
    return '#4CAF50';
  }

  /* ══════════════════════════════════════════
     LOAD LEADS
     ══════════════════════════════════════════ */
  function loadLeads(append) {
    if (!append) {
      leads = [];
      lastDoc = null;
      selectedIds.clear();
      selectAll = false;
      expandedLeadIds.clear();
    }

    var query = db.collection('leads').orderBy(sortField, sortDir);

    // Archived mode: Firestore filter
    if (showArchived) {
      query = query.where('archived', '==', true);
    }

    query.limit(PAGE_SIZE).get().then(function (snap) {
      snap.forEach(function (doc) {
        var data = Object.assign({ id: doc.id }, doc.data());
        if (!showArchived && data.archived === true) return;
        leads.push(data);
      });

      lastDoc = null; // No pagination needed — all loaded at once

      renderLeadView();
      renderLeadStats();
      updateBulkBar();

      // Hide Load More — everything is already loaded
      var loadMore = $('yb-lead-load-more-wrap');
      if (loadMore) loadMore.hidden = true;

    }).catch(function (err) {
      console.error('[lead-admin] Load error:', err);
      toast(t('error_load'), true);
    });
  }

  /**
   * Load the true total lead count from Firestore using aggregation.
   * Uses count() aggregation (Firebase 9.22+) with fallback.
   */
  function loadTotalLeadCount() {
    var ref = db.collection('leads');
    // Try aggregation count first (Firebase 9.22+ compat)
    try {
      if (typeof ref.count === 'function') {
        ref.count().get().then(function (snap) {
          totalLeadCount = snap.data().count;
          renderLeadStats();
          updateCountDisplay();
        }).catch(function () {
          fallbackLoadCount();
        });
        return;
      }
    } catch (e) { /* fallback */ }
    fallbackLoadCount();
  }

  function fallbackLoadCount() {
    // Fallback: fetch all docs and count (works with any SDK version)
    db.collection('leads').get().then(function (snap) {
      var count = 0;
      snap.forEach(function (doc) {
        var d = doc.data();
        if (!showArchived && d.archived === true) return;
        count++;
      });
      totalLeadCount = count;
      renderLeadStats();
      updateCountDisplay();
    }).catch(function () {
      // If both fail, totalLeadCount stays null — stats will show loaded count
    });
  }

  function updateCountDisplay() {
    var countEl = $('yb-lead-count');
    if (!countEl) return;
    var filtered = getFilteredLeads();
    var total = leads.length;
    if (filtered.length < total) {
      countEl.textContent = filtered.length + ' ' + t('leads_matching') + ' ' + t('leads_of') + ' ' + total;
    } else {
      countEl.textContent = total + ' ' + t('leads_stat_total').toLowerCase();
    }
  }

  /* ══════════════════════════════════════════
     SOURCE FILTER — smart matching
     Maps dropdown values → lead fields (type, ytt_program_type, source)
     so that old leads with verbose sources still match.
     ══════════════════════════════════════════ */
  function matchesSourceFilter(lead, filterValue) {
    // Channel-based filters (prefixed with "ch:")
    if (filterValue.indexOf('ch:') === 0) {
      var chFilter = filterValue.substring(3).toLowerCase();
      var ch = (lead.channel || '').toLowerCase();
      return ch.indexOf(chFilter) !== -1;
    }

    var src  = (lead.source || '').toLowerCase();
    var type = (lead.type   || '').toLowerCase();
    var ytt  = (lead.ytt_program_type || '').toLowerCase();
    switch (filterValue) {
      case '200h YTT':
        // Type must be ytt (or education from apply form), and NOT 300h / 50h / 30h
        return (type === 'ytt' || type === 'education') &&
               ytt !== '300h' && ytt !== '50h' && ytt !== '30h';
      case '300h YTT':
        return (type === 'ytt' || type === 'education') && ytt === '300h';
      case '50h YTT':
        return (type === 'ytt' || type === 'education') && ytt === '50h';
      case '30h YTT':
        return (type === 'ytt' || type === 'education') && ytt === '30h';
      case 'Courses':
        return type === 'course' || type === 'bundle';
      case 'Mentorship':
        return type === 'mentorship';
      case 'Contact page':
        return type === 'contact' || src.indexOf('contact') !== -1;
      case 'Apply page':
        return src.indexOf('apply') !== -1 || src === 'ansøgningsside' || src === 'application page';
      case 'Careers page':
        return type === 'careers' || src.indexOf('career') !== -1;
      case 'Manual entry':
        return src === 'manual entry' || src.indexOf('manual') !== -1;
      case 'Facebook Ad':
        return src.indexOf('meta lead') !== -1 || src.indexOf('facebook') !== -1;
      default:
        return lead.source === filterValue;
    }
  }

  /* ══════════════════════════════════════════
     RENDER LEAD TABLE
     ══════════════════════════════════════════ */
  function getFilteredLeads() {
    var filtered = leads;

    // Hide converted/existing-applicant unless explicitly filtered
    var CONVERTED_STATUSES = ['Converted', 'Existing Applicant'];
    var isConvertedFilter = filterStatuses.some(function (s) { return CONVERTED_STATUSES.indexOf(s) !== -1; });
    if (!isConvertedFilter) {
      filtered = filtered.filter(function (l) {
        return CONVERTED_STATUSES.indexOf(l.status) === -1 && !l.application_id;
      });
    }

    // Multi-select status filter (OR within same filter type)
    if (filterStatuses.length > 0) {
      filtered = filtered.filter(function (l) { return filterStatuses.indexOf(l.status) !== -1; });
    } else if (!showArchived) {
      filtered = filtered.filter(function (l) { return l.status !== 'Archived'; });
    }

    // Multi-select type filter
    if (filterTypes.length > 0) {
      filtered = filtered.filter(function (l) { return filterTypes.indexOf(l.type) !== -1; });
    }

    // Single-select secondary filters
    if (filterSource) filtered = filtered.filter(function (l) { return matchesSourceFilter(l, filterSource); });
    if (filterPriority) filtered = filtered.filter(function (l) { return l.priority === filterPriority; });
    if (filterTemperature) filtered = filtered.filter(function (l) { return l.temperature === filterTemperature; });

    // Sub-type filter — matches on a specific field (ytt_program_type for YTT, or program text for others)
    if (filterSubType) {
      var st = filterSubType.toLowerCase();
      filtered = filtered.filter(function (l) {
        if (filterSubTypeField) {
          return (String(l[filterSubTypeField] || '').toLowerCase()).indexOf(st) !== -1;
        }
        // fallback: check program text
        var prog = (l.program || '').toLowerCase();
        return prog.indexOf(st) !== -1;
      });
    }

    if (searchTerm) {
      var s = searchTerm.toLowerCase();
      filtered = filtered.filter(function (l) {
        return (l.email || '').toLowerCase().indexOf(s) !== -1 ||
          (l.first_name || '').toLowerCase().indexOf(s) !== -1 ||
          (l.last_name || '').toLowerCase().indexOf(s) !== -1 ||
          (l.phone || '').indexOf(s) !== -1 ||
          (l.program || '').toLowerCase().indexOf(s) !== -1 ||
          (l.source || '').toLowerCase().indexOf(s) !== -1;
      });
    }
    return filtered;
  }

  /* ══════════════════════════════════════════
     MULTI-SELECT CHIP FILTERS
     ══════════════════════════════════════════ */
  function renderLeadFilterChips() {
    // Status chips (all statuses except Archived, which is managed by the toggle button)
    var sc = $('yb-lead-status-chips');
    if (sc) {
      var html = '';
      STATUSES.filter(function (s) { return s.value !== 'Archived'; }).forEach(function (s) {
        var active = filterStatuses.indexOf(s.value) !== -1 ? ' is-active' : '';
        html += '<button type="button" class="yb-lead__campaign-chip' + active + '" data-status-chip="' + esc(s.value) + '">' +
          s.icon + ' ' + esc(s.label) + '</button>';
      });
      sc.innerHTML = html;
    }

    // Type chips
    var tc = $('yb-lead-type-chips');
    if (tc) {
      var types = [
        { value: 'ytt', label: '🧘 YTT' },
        { value: 'course', label: '📚 Course' },
        { value: 'bundle', label: '📦 Bundle' },
        { value: 'mentorship', label: '🎓 Mentorship' },
        { value: 'careers', label: '💼 Career' },
        { value: 'contact', label: '📞 Contact' }
      ];
      var html2 = '';
      types.forEach(function (typ) {
        var active = filterTypes.indexOf(typ.value) !== -1 ? ' is-active' : '';
        html2 += '<button type="button" class="yb-lead__campaign-chip' + active + '" data-type-chip="' + esc(typ.value) + '">' +
          esc(typ.label) + '</button>';
      });
      tc.innerHTML = html2;
    }
  }

  // Sub-type definitions per lead type.
  // `field` = which lead property to match against (defaults to 'program' text if omitted).
  var SUB_TYPE_OPTIONS = {
    ytt: [
      { label: '18W Spring',   match: '18-week', field: 'ytt_program_type' },
      { label: '18W Autumn',   match: '18-week-aug', field: 'ytt_program_type' },
      { label: '8W Semi',      match: '8-week',  field: 'ytt_program_type' },
      { label: '4W Intensive', match: '4-week',  field: 'ytt_program_type' },
      { label: '300h Adv.',    match: '300h',    field: 'ytt_program_type' },
      { label: '50h Specialty',match: '50h',     field: 'ytt_program_type' },
      { label: '30h Module',   match: '30h',     field: 'ytt_program_type' }
    ],
    course: [
      { label: 'Inversions', match: 'inversion', field: 'program' },
      { label: 'Splits',     match: 'split',     field: 'program' },
      { label: 'Backbends',  match: 'backbend',  field: 'program' }
    ],
    bundle: [
      { label: '2-Course',        match: '2-course', field: 'program' },
      { label: '3-Course All-In', match: 'all-in',   field: 'program' }
    ]
  };

  function renderSubTypeFilter(type) {
    var row = $('yb-lead-subtype-row');
    var chipsEl = $('yb-lead-subtype-chips');
    if (!row || !chipsEl) return;

    var options = SUB_TYPE_OPTIONS[type];
    if (!options || options.length === 0) {
      row.hidden = true;
      chipsEl.innerHTML = '';
      return;
    }

    chipsEl.innerHTML = '<span class="yb-lead__subtype-label">Sub-filter:</span>' +
      options.map(function (opt) {
        var active = filterSubType === opt.match ? ' is-active' : '';
        var fieldAttr = opt.field ? ' data-subtype-field="' + esc(opt.field) + '"' : '';
        return '<button type="button" class="yb-lead__campaign-chip' + active + '"' +
          ' data-subtype="' + esc(opt.match) + '"' + fieldAttr + '>' + esc(opt.label) + '</button>';
      }).join('');
    row.hidden = false;
  }

  /* ── View dispatcher ── */
  function renderLeadView() {
    var tableContainer = $('yb-lead-table-container');
    var loadMore = $('yb-lead-load-more-wrap');
    var kanbanEl = $('yb-lead-kanban');
    var bulkBar = $('yb-lead-bulk-bar');

    if (leadViewMode === 'kanban') {
      if (tableContainer) tableContainer.hidden = true;
      if (loadMore) loadMore.hidden = true;
      if (bulkBar) bulkBar.hidden = true;
      if (kanbanEl) { kanbanEl.hidden = false; renderKanban(); }
    } else {
      if (tableContainer) tableContainer.hidden = false;
      if (kanbanEl) kanbanEl.hidden = true;
      renderLeadTable();
      updateBulkBar();
    }
  }

  /**
   * Compute dynamic heat score (1-5) from all available lead signals.
   * Combines: form_score, pre-lead journey, email engagement, site engagement.
   */
  function computeLeadHeat(l) {
    var score = 0;
    // Form score (0-7, normalize to 0-2)
    var fs = l.form_score || 0;
    if (fs >= 4) score += 2;
    else if (fs >= 2) score += 1;

    // Pre-lead journey (0-2)
    var plj = l.pre_lead_journey || {};
    if (plj.total_sessions >= 3 && plj.viewed_schedule) score += 2;
    else if (plj.total_sessions >= 2 || plj.return_visitor) score += 1;

    // Email engagement (0-3)
    var ee = l.email_engagement || {};
    if (ee.total_clicks >= 3) score += 3;
    else if (ee.welcome_clicked || ee.total_clicks >= 1) score += 2;
    else if (ee.welcome_opened || ee.total_opens >= 2) score += 1;

    // Post-lead site engagement (0-3)
    var se = l.site_engagement || {};
    var schedRevisits = se.schedule_revisits || 0;
    if (schedRevisits >= 2 && se.accommodation_visited) score += 3;
    else if (schedRevisits >= 1 || se.accommodation_visited) score += 2;
    else if (se.total_pageviews >= 3) score += 1;

    // Social engagement (0-2) — following = interest signal
    var soc = l.social_engagement || {};
    if (soc.instagram_followed && (soc.instagram_dm_count || 0) > 0) score += 2;
    else if (soc.instagram_followed || soc.facebook_followed) score += 1;

    // Consultation / application intent (bonus)
    if (se.consultation_booking_clicked || se.application_page_visited) score += 1;

    // Map 0-14 raw score → 1-5 heat
    if (score >= 8) return 5;
    if (score >= 6) return 4;
    if (score >= 4) return 3;
    if (score >= 2) return 2;
    return 1;
  }

  /**
   * Compute lead status flags from all engagement data.
   * Returns array of { emoji, label, color, title }.
   */
  function computeStatusFlags(l) {
    var flags = [];
    var ee = l.email_engagement || {};
    var se = l.site_engagement || {};
    var schedRevisits = se.schedule_revisits || 0;

    // 📧 Engaged — opened 2+ emails
    if ((ee.total_opens || 0) >= 2) {
      flags.push({ emoji: '\ud83d\udce7', label: 'Engaged', color: '#2E7D32', title: 'Opened ' + ee.total_opens + ' emails' });
    }

    // 🔄 Returning — revisited site after form
    if ((se.total_sessions || 0) >= 2) {
      flags.push({ emoji: '\ud83d\udd04', label: 'Returning', color: '#1565C0', title: se.total_sessions + ' sessions on site' });
    }

    // 📅 Planning — viewed schedule + accommodation post-lead
    if (schedRevisits >= 1 && se.accommodation_visited) {
      flags.push({ emoji: '\ud83d\udcc5', label: 'Planning', color: '#6A1B9A', title: 'Viewed schedule ' + schedRevisits + 'x + accommodation' });
    }

    // ⏰ Fast responder — opened within 30 min
    var ttfo = ee.time_to_first_open_min;
    if (typeof ttfo === 'number' && ttfo <= 30) {
      flags.push({ emoji: '\u23f0', label: 'Fast', color: '#E65100', title: 'Opened email in ' + ttfo + ' min' });
    }

    // 🔇 Gone quiet — no activity for 7+ days
    var lastAct = l.last_activity;
    if (lastAct) {
      var lastMs = lastAct.toDate ? lastAct.toDate().getTime() :
        (lastAct._seconds ? lastAct._seconds * 1000 : new Date(lastAct).getTime());
      var daysSilent = (Date.now() - lastMs) / (1000 * 60 * 60 * 24);
      if (daysSilent >= 7) {
        flags.push({ emoji: '\ud83d\udd07', label: 'Quiet ' + Math.round(daysSilent) + 'd', color: '#9e9e9e', title: 'No activity for ' + Math.round(daysSilent) + ' days' });
      }
    } else if (l.created_at) {
      // No activity ever recorded after lead creation
      var creMs = l.created_at.toDate ? l.created_at.toDate().getTime() :
        (l.created_at._seconds ? l.created_at._seconds * 1000 : new Date(l.created_at).getTime());
      var daysSinceCreate = (Date.now() - creMs) / (1000 * 60 * 60 * 24);
      if (daysSinceCreate >= 7) {
        flags.push({ emoji: '\ud83d\udd07', label: 'Silent', color: '#9e9e9e', title: 'No engagement since signup (' + Math.round(daysSinceCreate) + ' days ago)' });
      }
    }

    return flags;
  }

  function renderLeadTable() {
    var tbody = $('yb-lead-table-body');
    if (!tbody) return;

    var filtered = getFilteredLeads();

    // Update count display (uses true DB total when available)
    updateCountDisplay();

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="16" style="text-align:center;padding:2rem;color:var(--yb-muted)">' + t('leads_no_leads') + '</td></tr>';
      return;
    }

    // Update header checkbox
    var headerCb = $('yb-lead-select-all');
    if (headerCb) headerCb.checked = selectAll;

    tbody.innerHTML = filtered.map(function (l) {
      var isSelected = selectedIds.has(l.id);
      var isExpanded = expandedLeadIds.has(l.id);
      var followupClass = '';
      if (l.followup_date) {
        var fDate = l.followup_date.toDate ? l.followup_date.toDate() : new Date(l.followup_date);
        var today = new Date();
        today.setHours(0, 0, 0, 0);
        if (fDate <= today) followupClass = ' yb-lead__row--overdue';
        else if (fDate <= new Date(today.getTime() + 86400000)) followupClass = ' yb-lead__row--due-today';
      }

      // Unread SMS badge
      var unreadBadge = '';
      if (l.has_unread_sms === true) {
        unreadBadge = ' <span class="yb-lead__sms-unread-icon" title="Unread SMS">\ud83d\udce9</span>';
      }

      // Schedule engagement badge
      var schedBadge = '';
      var se = l.schedule_engagement;
      if (se && se.total_visits) {
        var sePages = se.pages || {};
        var seMaxScroll = 0;
        for (var sk in sePages) { if (sePages[sk].max_scroll > seMaxScroll) seMaxScroll = sePages[sk].max_scroll; }
        if (se.total_visits >= 3 && seMaxScroll >= 75) {
          schedBadge = ' <span class="yb-lead__sched-badge" style="color:#155724" title="Viewed schedule ' + se.total_visits + 'x, scrolled ' + seMaxScroll + '%">\ud83d\udcc5\ud83d\udd25</span>';
        } else if (se.total_visits >= 2 || seMaxScroll >= 50) {
          schedBadge = ' <span class="yb-lead__sched-badge" style="color:#856404" title="Viewed schedule ' + se.total_visits + 'x, scrolled ' + seMaxScroll + '%">\ud83d\udcc5</span>';
        } else {
          schedBadge = ' <span class="yb-lead__sched-badge" style="color:#6F6A66" title="Viewed schedule ' + se.total_visits + 'x, scrolled ' + seMaxScroll + '%">\ud83d\udcc5</span>';
        }
      }

      // Email engagement badge
      var emailBadge = '';
      var ee = l.email_engagement;
      if (ee) {
        var opens = ee.total_opens || 0;
        var clicks = ee.total_clicks || 0;
        if (clicks >= 3) {
          emailBadge = ' <span style="color:#155724" title="' + opens + ' opens, ' + clicks + ' clicks">\u2709\ufe0f\ud83d\udd25</span>';
        } else if (clicks >= 1 || opens >= 3) {
          emailBadge = ' <span style="color:#856404" title="' + opens + ' opens, ' + clicks + ' clicks">\u2709\ufe0f</span>';
        }
      }

      // Site browsing badge
      var siteBadge = '';
      var ste = l.site_engagement;
      if (ste && ste.total_pageviews >= 3) {
        var sitePages = ste.total_pageviews || 0;
        var interests = (ste.interests || []).join(', ');
        siteBadge = ' <span style="color:#0d47a1" title="Browsed ' + sitePages + ' pages. Interests: ' + interests + '">\ud83c\udf10</span>';
      }

      // Social follow badge (Instagram/Facebook)
      var socialBadge = '';
      var soc = l.social_engagement;
      if (soc && (soc.instagram_followed || soc.facebook_followed)) {
        var socPlatforms = (soc.platforms || []).join(', ') || 'social';
        var socDm = soc.instagram_dm_count || 0;
        if (soc.instagram_followed && socDm > 0) {
          socialBadge = ' <span style="color:#E4405F;font-weight:700" title="Follows on ' + esc(socPlatforms) + ' + ' + socDm + ' DMs">\ud83d\udcf1\ud83d\udd25</span>';
        } else {
          socialBadge = ' <span style="color:#E4405F" title="Follows on ' + esc(socPlatforms) + '">\ud83d\udcf1</span>';
        }
      }

      // Re-engagement badge (came back after silence)
      var reEngBadge = '';
      if (l.re_engaged && l.re_engaged_at) {
        var reEvents = l.re_engagement_events || [];
        var lastRe = reEvents.length > 0 ? reEvents[reEvents.length - 1] : null;
        var reDays = lastRe ? lastRe.days_inactive : '?';
        reEngBadge = ' <span style="color:#f75c03;font-weight:700" title="Came back after ' + reDays + ' days of silence!">\ud83d\udd04</span>';
      }

      // Dynamic heat score badge (combines form, pre-lead, email, site signals)
      var heatBadge = '';
      var heatLevel = computeLeadHeat(l);
      if (heatLevel >= 2) {
        var fires = '';
        for (var hi = 0; hi < heatLevel; hi++) fires += '\ud83d\udd25';
        var heatColor = heatLevel >= 4 ? '#d32f2f' : heatLevel >= 3 ? '#f57c00' : '#fbc02d';
        var heatTitle = 'Heat ' + heatLevel + '/5';
        if (l.form_score) heatTitle += ' \u00b7 Form: ' + l.form_score + '/7';
        var _ee = l.email_engagement || {};
        if (_ee.total_opens) heatTitle += ' \u00b7 ' + _ee.total_opens + ' opens, ' + (_ee.total_clicks || 0) + ' clicks';
        var _se = l.site_engagement || {};
        if (_se.total_pageviews) heatTitle += ' \u00b7 ' + _se.total_pageviews + ' pages';
        heatBadge = ' <span style="color:' + heatColor + ';font-size:.75rem;" title="' + esc(heatTitle) + '">' + fires + '</span>';
      }

      // Status flags (inline after heat)
      var statusFlagsBadge = '';
      var sFlags = computeStatusFlags(l);
      sFlags.forEach(function (f) {
        statusFlagsBadge += ' <span style="color:' + f.color + ';font-size:.7rem;font-weight:600;" title="' + esc(f.title) + '">' + f.emoji + '</span>';
      });

      // Notes count
      var notesCount = Array.isArray(l.notes) ? l.notes.length : 0;

      var row = '<tr class="yb-lead__row' + followupClass + (isSelected ? ' is-selected' : '') + '" data-id="' + l.id + '">' +
        // Chevron
        '<td class="yb-lead__cell-chevron">' +
          '<button class="yb-lead__chevron-btn' + (isExpanded ? ' is-open' : '') + '" data-action="toggle-expand" data-id="' + l.id + '" title="Quick view">' +
            '<span class="yb-lead__chevron-icon"></span>' +
          '</button>' +
        '</td>' +
        '<td class="yb-lead__cell-cb"><input type="checkbox" class="yb-lead__cb" data-lead-id="' + l.id + '"' + (isSelected ? ' checked' : '') + '></td>' +
        '<td class="yb-lead__cell-date">' + relativeTime(l.created_at) + '</td>' +
        '<td class="yb-lead__cell-name">' +
          priorityBadgeHtml(l.priority) +
          esc((l.first_name || '') + ' ' + (l.last_name || '')).trim() +
          unreadBadge + heatBadge + statusFlagsBadge + reEngBadge + socialBadge + schedBadge + emailBadge + siteBadge +
        '</td>' +
        '<td class="yb-lead__cell-contact">' +
          '<div class="yb-lead__cell-email-text">' + esc(l.email || '') +
          (l.email_bounced ? ' <span class="yb-lead__bounce-badge" title="Email bounced ' + (l.bounce_count || '') + ' time(s)">BOUNCED</span>' : '') +
          '</div>' +
          (l.phone ? '<a href="tel:' + esc(l.phone) + '" class="yb-lead__cell-phone-link" onclick="event.stopPropagation()">' + esc(l.phone) + '</a>' : '') +
        '</td>' +
        '<td><span class="yb-lead__type-badge">' + typeBadge(l.type) + '</span></td>' +
        '<td class="yb-lead__cell-program">' + esc((l.program || l.cohort_label || '').substring(0, 30)) + '</td>' +
        '<td class="yb-lead__cell-channel">' + channelBadgeHtml(l.channel) + '</td>' +
        '<td class="yb-lead__cell-source">' + esc((l.source || '').substring(0, 20)) + '</td>' +
        '<td>' + statusBadgeHtml(l.status) +
          (l.sub_status ? '<div class="yb-lead__sub-status">' + esc(l.sub_status) + '</div>' : '') +
        '</td>' +
        '<td class="yb-lead__cell-followup">' +
          (l.followup_date ? '<span class="yb-lead__followup-date' + followupClass + '">' + fmtDate(l.followup_date) + '</span>' : '\u2014') +
        '</td>' +
        // Enhanced columns
        '<td class="yb-lead__cell-lastcontact">' +
          (l.last_contact ? '<span style="color:' + lcRecencyColor(l.last_contact) + '">' + relativeTime(l.last_contact) + '</span>' : '\u2014') +
        '</td>' +
        '<td class="yb-lead__cell-temp">' + temperatureBadgeHtml(l.temperature) + '</td>' +
        '<td class="yb-lead__cell-notes">' +
          (notesCount ? '<span class="yb-lead__notes-count">' + notesCount + '</span>' : '\u2014') +
        '</td>' +
        '<td class="yb-lead__cell-app">' +
          (l.application_id ? '<span class="yb-lead__app-badge--inline" title="Has application">\u2713</span>' : '\u2014') +
        '</td>' +
        '<td class="yb-lead__cell-actions">' +
          '<button class="yb-admin__icon-btn" data-action="view-lead" data-id="' + l.id + '" title="' + t('users_view') + '">\u2192</button>' +
        '</td>' +
        '</tr>';

      // Expanded inline panel
      if (isExpanded) {
        row += buildExpandedRow(l);
      }

      return row;
    }).join('');
  }

  /* ── Expandable inline row ── */
  function buildExpandedRow(l) {
    var notes = Array.isArray(l.notes) ? l.notes : [];
    var lastFiveNotes = notes.slice(-5).reverse();

    var lcColor = lcRecencyColor(l.last_contact);

    var appBadge = l.application_id
      ? '<span class="yb-lead__app-badge--inline" style="color:#155724">\u2713 App</span>'
      : '<span style="color:#6F6A66">\u2014</span>';

    // Status options for inline dropdown
    var statusOptions = [
      { v: 'New', l: '\u2728 New' }, { v: 'Contacted', l: '\ud83d\udce7 Contacted' },
      { v: 'No Answer', l: '\ud83d\udd14 No Answer' }, { v: 'Follow-up', l: '\ud83d\udd04 Follow-up' },
      { v: 'Engaged', l: '\ud83d\udcac Engaged' }, { v: 'Strongly Interested', l: '\u2b50 Strongly Interested' },
      { v: 'Qualified', l: '\u2705 Qualified' }, { v: 'Negotiating', l: '\ud83e\udd1d Negotiating' },
      { v: 'Converted', l: '\ud83c\udf89 Converted' }, { v: 'On Hold', l: '\u23f8\ufe0f On Hold' },
      { v: 'Interested In Next Round', l: '\ud83d\udcc5 Next Round' },
      { v: 'Not too keen', l: '\ud83d\ude10 Not too keen' },
      { v: 'Lost', l: '\ud83d\udc4e Lost' }, { v: 'Closed', l: '\u2716 Closed' }
    ];
    var statusOpts = statusOptions.map(function (o) {
      return '<option value="' + esc(o.v) + '"' + (l.status === o.v ? ' selected' : '') + '>' + o.l + '</option>';
    }).join('');

    var html = '<tr class="yb-lead__expanded-row" data-expanded-for="' + l.id + '">' +
      '<td colspan="16" class="yb-lead__expanded-cell">' +
      '<div class="yb-lead__expanded-panel">' +

      // Row 1: Quick stats
      '<div class="yb-lead__exp-row">' +
        '<div class="yb-lead__exp-stat">' +
          '<span class="yb-lead__exp-label">' + t('leads_last_contact') + '</span>' +
          '<span class="yb-lead__exp-value" style="color:' + lcColor + '">' +
            (l.last_contact ? relativeTime(l.last_contact) : '\u2014') +
          '</span>' +
        '</div>' +
        '<div class="yb-lead__exp-stat">' +
          '<span class="yb-lead__exp-label">' + t('leads_call_attempts') + '</span>' +
          '<span class="yb-lead__exp-value">' + (l.call_attempts || 0) + '</span>' +
        '</div>' +
        '<div class="yb-lead__exp-stat">' +
          '<span class="yb-lead__exp-label">' + t('leads_sms_status') + '</span>' +
          '<span class="yb-lead__exp-value">' + esc(l.sms_status || '\u2014') + '</span>' +
        '</div>' +
        '<div class="yb-lead__exp-stat">' +
          '<span class="yb-lead__exp-label">' + t('leads_temperature') + ' / ' + t('leads_priority') + '</span>' +
          '<span class="yb-lead__exp-value">' + temperatureBadgeHtml(l.temperature) + ' ' + priorityBadgeHtml(l.priority) + '</span>' +
        '</div>' +
        '<div class="yb-lead__exp-stat">' +
          '<span class="yb-lead__exp-label">App</span>' +
          '<span class="yb-lead__exp-value">' + appBadge + '</span>' +
        '</div>' +
      '</div>';

    // Row 2: Inline status change
    html += '<div class="yb-lead__exp-row yb-lead__exp-status-row">' +
      '<div class="yb-lead__exp-stat" style="flex:0 0 auto">' +
        '<span class="yb-lead__exp-label">' + t('leads_col_status') + '</span>' +
        '<select class="yb-admin__select yb-lead__exp-status-select" data-lead-id="' + l.id + '" data-field="status">' +
          statusOpts +
        '</select>' +
      '</div>' +
      '<div class="yb-lead__exp-stat" style="flex:0 0 auto">' +
        '<span class="yb-lead__exp-label">' + t('leads_temperature') + '</span>' +
        '<select class="yb-admin__select yb-lead__exp-status-select" data-lead-id="' + l.id + '" data-field="temperature">' +
          '<option value=""' + (!l.temperature ? ' selected' : '') + '>\u2014</option>' +
          '<option value="hot"' + (l.temperature === 'hot' ? ' selected' : '') + '>\ud83d\udd25 Hot</option>' +
          '<option value="warm"' + (l.temperature === 'warm' ? ' selected' : '') + '>\u2600\ufe0f Warm</option>' +
          '<option value="cold"' + (l.temperature === 'cold' ? ' selected' : '') + '>\u2744\ufe0f Cold</option>' +
        '</select>' +
      '</div>' +
      '<div class="yb-lead__exp-stat" style="flex:0 0 auto">' +
        '<span class="yb-lead__exp-label">' + t('leads_priority') + '</span>' +
        '<select class="yb-admin__select yb-lead__exp-status-select" data-lead-id="' + l.id + '" data-field="priority">' +
          '<option value=""' + (!l.priority ? ' selected' : '') + '>\u2014</option>' +
          '<option value="urgent"' + (l.priority === 'urgent' ? ' selected' : '') + '>\ud83d\udd34 Urgent</option>' +
          '<option value="high"' + (l.priority === 'high' ? ' selected' : '') + '>\ud83d\udfe0 High</option>' +
          '<option value="normal"' + (l.priority === 'normal' ? ' selected' : '') + '>\ud83d\udfe2 Normal</option>' +
          '<option value="low"' + (l.priority === 'low' ? ' selected' : '') + '>\u26aa Low</option>' +
        '</select>' +
      '</div>' +
    '</div>';

    // Row 3: Location + Accommodation
    if (l.city_country || (l.accommodation && l.accommodation !== 'No')) {
      html += '<div class="yb-lead__exp-row">';
      if (l.city_country) {
        html += '<div class="yb-lead__exp-stat"><span class="yb-lead__exp-label">' + t('leads_city') + '</span><span class="yb-lead__exp-value">\ud83c\udf0d ' + esc(l.city_country) + '</span></div>';
      }
      if (l.accommodation && l.accommodation !== 'No') {
        html += '<div class="yb-lead__exp-stat"><span class="yb-lead__exp-label">' + t('leads_accommodation') + '</span><span class="yb-lead__exp-value">\ud83c\udfe0 ' + esc(l.accommodation) + (l.housing_months ? ' \u00b7 ' + esc(l.housing_months) : '') + '</span></div>';
      }
      html += '</div>';
    }

    // Row 4: Notes timeline (show last 5 + add note input)
    html += '<div class="yb-lead__exp-notes-section">' +
      '<div class="yb-lead__exp-notes-header">' +
        '<span class="yb-lead__exp-label">\ud83d\udcdd ' + t('leads_notes') + ' (' + notes.length + ')</span>' +
      '</div>';
    if (lastFiveNotes.length) {
      html += '<div class="yb-lead__exp-notes">';
      lastFiveNotes.forEach(function (n) {
        var noteIcons = { call: '\ud83d\udcde', email: '\u2709\ufe0f', sms: '\ud83d\udcf1', note: '\ud83d\udcdd', system: '\u2699\ufe0f' };
        html += '<div class="yb-lead__exp-note">' +
          '<span class="yb-lead__exp-note-icon">' + (noteIcons[n.type] || '\ud83d\udcdd') + '</span>' +
          '<span class="yb-lead__exp-note-time">' + relativeTime(n.timestamp) + '</span>' +
          '<span class="yb-lead__exp-note-text">' + esc((n.text || '').substring(0, 200)) + (n.text && n.text.length > 200 ? '\u2026' : '') + '</span>' +
        '</div>';
      });
      html += '</div>';
    } else {
      html += '<div style="color:#6F6A66;font-size:0.82rem;padding:0.25rem 0">' + t('leads_no_notes') + '</div>';
    }
    // Add note inline
    html += '<div class="yb-lead__exp-add-note">' +
      '<input type="text" class="yb-lead__exp-note-input" data-lead-id="' + l.id + '" placeholder="' + t('leads_note_placeholder') + '">' +
      '<button class="yb-btn yb-btn--primary yb-btn--sm" data-action="add-note-inline" data-id="' + l.id + '">' + t('leads_add_note_btn') + '</button>' +
    '</div>';
    html += '</div>';

    // Row 5: Message excerpt
    if (l.message) {
      html += '<div class="yb-lead__exp-message">\ud83d\udcac ' + esc(l.message.substring(0, 200)) + (l.message.length > 200 ? '\u2026' : '') + '</div>';
    }

    // Quick action buttons
    html += '<div class="yb-lead__exp-actions yb-lead__actions">';
    if (l.phone) {
      html += '<a href="tel:' + esc(l.phone) + '" class="yb-btn" data-action="log-call-inline" data-id="' + l.id + '">\ud83d\udcde ' + t('leads_call') + '</a>';
      html += '<button class="yb-btn" data-action="sms-inline" data-id="' + l.id + '">\ud83d\udcf1 ' + t('leads_sms') + '</button>';
      html += '<a href="https://wa.me/' + esc((l.phone || '').replace(/[^0-9+]/g, '')) + '" target="_blank" rel="noopener" class="yb-btn">WhatsApp</a>';
    }
    if (l.email) {
      html += '<button class="yb-btn" data-action="email-inline" data-id="' + l.id + '">\u2709 ' + t('leads_email') + '</button>';
    }
    html += '<button class="yb-btn yb-btn--primary" data-action="view-lead" data-id="' + l.id + '">' + t('leads_detail_title') + ' \u2192</button>';
    html += '</div>';

    html += '</div></td></tr>';
    return html;
  }

  /* ══════════════════════════════════════════
     RENDER STATS (Pipeline)
     ══════════════════════════════════════════ */
  function renderLeadStats() {
    var el = $('yb-lead-stats');
    if (!el) return;

    // Use true DB total when available, fall back to loaded count
    var total = totalLeadCount !== null ? totalLeadCount : leads.length;
    var loadedCount = leads.length;
    var counts = {};
    STATUSES.forEach(function (s) { counts[s.value] = 0; });
    var unreadSmsCount = 0;
    leads.forEach(function (l) {
      var st = l.status || 'New';
      if (counts[st] !== undefined) counts[st]++;
      if (l.has_unread_sms === true) unreadSmsCount++;
    });

    // Pipeline funnel stats
    var pipeline = leads.filter(function (l) {
      return ['New', 'Contacted', 'No Answer', 'Follow-up', 'Engaged', 'Qualified', 'Negotiating'].indexOf(l.status) !== -1;
    }).length;
    var convertedCount = counts['Converted'] || 0;
    var conversionRate = total > 0 ? Math.round((convertedCount / total) * 100) : 0;

    // Today's follow-ups
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var tomorrow = new Date(today.getTime() + 86400000);
    var overdueCount = 0;
    var todayCount = 0;
    leads.forEach(function (l) {
      if (!l.followup_date) return;
      var fd = l.followup_date.toDate ? l.followup_date.toDate() : new Date(l.followup_date);
      if (fd < today) overdueCount++;
      else if (fd < tomorrow) todayCount++;
    });

    el.innerHTML =
      '<div class="yb-lead__stat-card yb-lead__stat-card--total" data-filter-status="">' +
        '<span class="yb-lead__stat-value">' + total + '</span>' +
        '<span class="yb-lead__stat-label">' + t('leads_stat_total') + '</span>' +
      '</div>' +
      '<div class="yb-lead__stat-card yb-lead__stat-card--new" data-filter-status="New">' +
        '<span class="yb-lead__stat-value">' + (counts['New'] || 0) + '</span>' +
        '<span class="yb-lead__stat-label">' + t('leads_stat_new') + '</span>' +
      '</div>' +
      '<div class="yb-lead__stat-card yb-lead__stat-card--pipeline" data-filter-status="">' +
        '<span class="yb-lead__stat-value">' + pipeline + '</span>' +
        '<span class="yb-lead__stat-label">' + t('leads_stat_pipeline') + '</span>' +
      '</div>' +
      '<div class="yb-lead__stat-card yb-lead__stat-card--converted" data-filter-status="Converted">' +
        '<span class="yb-lead__stat-value">' + convertedCount + '</span>' +
        '<span class="yb-lead__stat-label">' + t('leads_stat_converted') + '</span>' +
      '</div>' +
      '<div class="yb-lead__stat-card yb-lead__stat-card--rate">' +
        '<span class="yb-lead__stat-value">' + conversionRate + '%</span>' +
        '<span class="yb-lead__stat-label">' + t('leads_stat_conversion') + '</span>' +
      '</div>' +
      (unreadSmsCount > 0 ?
        '<div class="yb-lead__stat-card yb-lead__stat-card--sms">' +
          '<span class="yb-lead__stat-value">' + unreadSmsCount + '</span>' +
          '<span class="yb-lead__stat-label">\ud83d\udce9 Unread SMS</span>' +
        '</div>'
      : '') +
      (overdueCount + todayCount > 0 ?
        '<div class="yb-lead__stat-card yb-lead__stat-card--followup">' +
          '<span class="yb-lead__stat-value">' + (overdueCount + todayCount) + '</span>' +
          '<span class="yb-lead__stat-label">' +
            (overdueCount > 0 ? '<span class="yb-lead__stat-overdue">' + overdueCount + ' ' + t('leads_overdue') + '</span> ' : '') +
            (todayCount > 0 ? todayCount + ' ' + t('leads_due_today') : '') +
          '</span>' +
        '</div>'
      : '');

    // Update mobile summary toggle
    var summaryEl = $('yb-lead-stats-summary');
    if (summaryEl) {
      var parts = [
        '<span class="yb-lead__stats-summary-item"><strong>' + total + '</strong> ' + t('leads_stat_total') + '</span>',
        '<span class="yb-lead__stats-summary-item yb-lead__stats-summary-item--new"><strong>' + (counts['New'] || 0) + '</strong> ' + t('leads_stat_new') + '</span>',
        '<span class="yb-lead__stats-summary-item yb-lead__stats-summary-item--pipeline"><strong>' + pipeline + '</strong> ' + t('leads_stat_pipeline') + '</span>',
        '<span class="yb-lead__stats-summary-item yb-lead__stats-summary-item--converted"><strong>' + convertedCount + '</strong> ' + t('leads_stat_converted') + '</span>'
      ];
      if (overdueCount + todayCount > 0) {
        parts.push('<span class="yb-lead__stats-summary-item yb-lead__stats-summary-item--followup"><strong>' + (overdueCount + todayCount) + '</strong> ' + t('leads_overdue') + '</span>');
      }
      summaryEl.innerHTML = parts.join('<span style="color:#E8E4E0">·</span>');
    }
  }

  /* ══════════════════════════════════════════
     KANBAN BOARD VIEW
     ══════════════════════════════════════════ */
  function renderKanban() {
    var el = $('yb-lead-kanban');
    if (!el) return;

    var filtered = getFilteredLeads();

    // Update count display (uses true DB total when available)
    updateCountDisplay();

    // Group leads by column
    var groups = {};
    KANBAN_COLUMNS.forEach(function (s) { groups[s] = []; });
    groups['Other'] = [];

    filtered.forEach(function (l) {
      if (KANBAN_COLUMNS.indexOf(l.status) !== -1) {
        groups[l.status].push(l);
      } else {
        groups['Other'].push(l);
      }
    });

    var allCols = KANBAN_COLUMNS.concat(['Other']);

    el.innerHTML = '<div class="yb-lead__kanban-board">' +
      allCols.map(function (status) {
        var meta = status === 'Other'
          ? { color: '#BDBDBD', text: '#6F6A66', icon: '\u2022' }
          : getStatusMeta(status);
        var colLeads = groups[status];

        return '<div class="yb-lead__kanban-col" data-kanban-status="' + esc(status) + '">' +
          '<div class="yb-lead__kanban-col-header" style="border-top:3px solid ' + meta.text + '">' +
            '<span class="yb-lead__kanban-col-icon">' + meta.icon + '</span>' +
            '<span class="yb-lead__kanban-col-name">' + esc(status === 'Other' ? t('leads_kanban_other') : status) + '</span>' +
            '<span class="yb-lead__kanban-col-count">' + colLeads.length + '</span>' +
          '</div>' +
          '<div class="yb-lead__kanban-cards" data-kanban-drop-zone="' + esc(status) + '">' +
            colLeads.map(function (l) { return buildKanbanCard(l); }).join('') +
          '</div>' +
        '</div>';
      }).join('') +
    '</div>';

    bindKanbanDragEvents();
  }

  function buildKanbanCard(l) {
    var followupUrgency = '';
    var followupText = '';
    if (l.followup_date) {
      var fDate = l.followup_date.toDate ? l.followup_date.toDate() : new Date(l.followup_date);
      var today = new Date();
      today.setHours(0, 0, 0, 0);
      if (fDate < today) followupUrgency = ' yb-lead__kanban-followup--overdue';
      else if (fDate < new Date(today.getTime() + 86400000)) followupUrgency = ' yb-lead__kanban-followup--today';
      followupText = fmtDate(l.followup_date);
    }

    return '<div class="yb-lead__kanban-card" draggable="true" data-id="' + l.id + '">' +
      '<div class="yb-lead__kanban-card-header">' +
        '<strong class="yb-lead__kanban-card-name">' +
          priorityBadgeHtml(l.priority) +
          esc((l.first_name || '') + ' ' + (l.last_name || '')).trim() +
        '</strong>' +
        (l.has_unread_sms ? '<span class="yb-lead__sms-unread-icon" title="Unread SMS">\ud83d\udce9</span>' : '') +
      '</div>' +
      '<div class="yb-lead__kanban-card-meta">' +
        '<span class="yb-lead__type-badge">' + typeBadge(l.type) + '</span>' +
        temperatureBadgeHtml(l.temperature) +
      '</div>' +
      (followupText
        ? '<div class="yb-lead__kanban-followup' + followupUrgency + '">\ud83d\udcc5 ' + followupText + '</div>'
        : '') +
      (l.channel ? '<div class="yb-lead__kanban-channel">' + channelBadgeHtml(l.channel) + '</div>' : '') +
      (l.source ? '<div class="yb-lead__kanban-source">' + esc(l.source.substring(0, 25)) + '</div>' : '') +
    '</div>';
  }

  function bindKanbanDragEvents() {
    var cards = $$('.yb-lead__kanban-card');
    var dropZones = $$('.yb-lead__kanban-cards');

    for (var i = 0; i < cards.length; i++) {
      (function (card) {
        card.addEventListener('dragstart', function (e) {
          e.dataTransfer.setData('text/plain', card.getAttribute('data-id'));
          e.dataTransfer.effectAllowed = 'move';
          card.classList.add('is-dragging');
        });
        card.addEventListener('dragend', function () {
          card.classList.remove('is-dragging');
          for (var j = 0; j < dropZones.length; j++) {
            dropZones[j].classList.remove('is-drag-over');
          }
        });
        card.addEventListener('click', function (e) {
          if (e.target.closest('button')) return;
          showLeadDetail(card.getAttribute('data-id'));
        });
      })(cards[i]);
    }

    for (var k = 0; k < dropZones.length; k++) {
      (function (zone) {
        zone.addEventListener('dragover', function (e) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          zone.classList.add('is-drag-over');
        });
        zone.addEventListener('dragleave', function (e) {
          // Only remove if leaving the zone itself, not entering a child
          if (!zone.contains(e.relatedTarget)) {
            zone.classList.remove('is-drag-over');
          }
        });
        zone.addEventListener('drop', function (e) {
          e.preventDefault();
          zone.classList.remove('is-drag-over');
          var leadId = e.dataTransfer.getData('text/plain');
          var newStatus = zone.getAttribute('data-kanban-drop-zone');
          if (leadId && newStatus && newStatus !== 'Other') {
            moveLeadToStatus(leadId, newStatus);
          }
        });
      })(dropZones[k]);
    }
  }

  function moveLeadToStatus(leadId, newStatus) {
    var lead = leads.find(function (l) { return l.id === leadId; });
    if (!lead || lead.status === newStatus) return;

    var oldStatus = lead.status;
    var updates = {
      status: newStatus,
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    };

    // Auto-set last_contact when moving to Contacted
    if (newStatus === 'Contacted' && !lead.last_contact) {
      updates.last_contact = firebase.firestore.FieldValue.serverTimestamp();
    }
    // Auto-set converted flag
    if (newStatus === 'Converted') {
      updates.converted = true;
      updates.converted_at = firebase.firestore.FieldValue.serverTimestamp();
    }

    // Optimistic local update
    lead.status = newStatus;
    renderKanban();

    db.collection('leads').doc(leadId).update(updates).then(function () {
      renderLeadStats();
      toast(esc((lead.first_name || '') + ' ' + (lead.last_name || '')).trim() + ' \u2192 ' + newStatus);
    }).catch(function (err) {
      // Rollback
      lead.status = oldStatus;
      renderKanban();
      toast('Error: ' + err.message, true);
    });
  }

  /* ══════════════════════════════════════════
     VIEW LEAD DETAIL
     ══════════════════════════════════════════ */
  function showLeadDetail(leadId) {
    currentLeadId = leadId;
    currentLead = leads.find(function (l) { return l.id === leadId; });
    if (!currentLead) return;

    $('yb-admin-v-lead-list').hidden = true;
    $('yb-admin-v-lead-detail').hidden = false;

    $('yb-lead-detail-heading').textContent = (currentLead.first_name || '') + ' ' + (currentLead.last_name || '');

    renderLeadDetailCard();
    renderLeadQuickActions();
    renderLeadEditForm();
    loadSMSConversation(leadId);
    populateStatusForm();
    renderLeadNotes();
    loadLeadActivity();

    // Mark unread SMS as read
    if (currentLead.has_unread_sms === true) {
      markSMSRead(leadId);
    }
  }

  function backToLeadList() {
    $('yb-admin-v-lead-list').hidden = false;
    $('yb-admin-v-lead-detail').hidden = true;
    currentLeadId = null;
    currentLead = null;
    renderLeadView(); // refresh in case changes were made
  }

  /* ══════════════════════════════════════════
     REDESIGNED LEAD DETAIL CARD
     ══════════════════════════════════════════ */
  function renderLeadDetailCard() {
    var el = $('yb-lead-detail-card');
    if (!el || !currentLead) return;
    var l = currentLead;

    var statusMeta = getStatusMeta(l.status);
    var priorityMeta = PRIORITIES.find(function (p) { return p.value === l.priority; });
    var tempMeta = TEMPERATURES.find(function (ti) { return ti.value === l.temperature; });

    var html = '<div class="yb-lead__detail-cards">';

    // Card 1: Contact Info
    html += '<div class="yb-lead__section-card">';
    html += '<h4 class="yb-lead__card-title">CONTACT INFO</h4>';
    html += '<div class="yb-lead__card-row">' +
      '<span class="yb-lead__card-label">' + t('users_col_email') + '</span>' +
      '<a href="mailto:' + esc(l.email) + '" class="yb-lead__card-value yb-lead__card-link">' + esc(l.email || '\u2014') + '</a>' +
    '</div>';
    html += '<div class="yb-lead__card-row">' +
      '<span class="yb-lead__card-label">' + t('users_profile_phone') + '</span>' +
      (l.phone
        ? '<a href="tel:' + esc(l.phone) + '" class="yb-lead__card-value yb-lead__card-link">' + esc(l.phone) + '</a>'
        : '<span class="yb-lead__card-value">\u2014</span>') +
    '</div>';
    if (l.city_country) {
      html += '<div class="yb-lead__card-row">' +
        '<span class="yb-lead__card-label">' + t('leads_city') + '</span>' +
        '<span class="yb-lead__card-value">' + esc(l.city_country) + '</span>' +
      '</div>';
    }
    html += '<div class="yb-lead__card-row">' +
      '<span class="yb-lead__card-label">' + t('leads_channel') + '</span>' +
      '<span class="yb-lead__card-value">' + channelBadgeHtml(l.channel) + '</span>' +
    '</div>';
    html += '<div class="yb-lead__card-row">' +
      '<span class="yb-lead__card-label">' + t('leads_source') + '</span>' +
      '<span class="yb-lead__card-value">' + esc(l.source || '\u2014') + '</span>' +
    '</div>';
    if (l.utm_campaign) {
      html += '<div class="yb-lead__card-row">' +
        '<span class="yb-lead__card-label">UTM Campaign</span>' +
        '<span class="yb-lead__card-value">' + esc(l.utm_campaign) + '</span>' +
      '</div>';
    }
    if (l.landing_page) {
      html += '<div class="yb-lead__card-row">' +
        '<span class="yb-lead__card-label">Landing Page</span>' +
        '<span class="yb-lead__card-value">' + esc(l.landing_page) + '</span>' +
      '</div>';
    }
    html += '<div class="yb-lead__card-row">' +
      '<span class="yb-lead__card-label">' + t('leads_col_date') + '</span>' +
      '<span class="yb-lead__card-value">' + fmtDateTime(l.created_at) + '</span>' +
    '</div>';
    html += '</div>'; // end card 1

    // Card 1b: Lead Intelligence (heat + form score + status flags)
    var detailHeat = computeLeadHeat(l);
    var detailFlags = computeStatusFlags(l);
    if (detailHeat >= 2 || detailFlags.length > 0 || l.form_score) {
      html += '<div class="yb-lead__section-card">';
      html += '<h4 class="yb-lead__card-title" style="color:#d32f2f;">LEAD INTELLIGENCE</h4>';

      // Heat score visual
      var heatFires = '';
      for (var hfi = 0; hfi < 5; hfi++) heatFires += hfi < detailHeat ? '\ud83d\udd25' : '\u2b1c';
      html += '<div class="yb-lead__card-row">' +
        '<span class="yb-lead__card-label">Heat Score</span>' +
        '<span class="yb-lead__card-value" style="font-size:1.1rem;">' + heatFires + ' <strong>' + detailHeat + '/5</strong></span>' +
      '</div>';

      // Form score
      if (l.form_score) {
        html += '<div class="yb-lead__card-row">' +
          '<span class="yb-lead__card-label">Form Quality</span>' +
          '<span class="yb-lead__card-value"><strong>' + l.form_score + '</strong>/7</span>' +
        '</div>';
      }

      // Status flags
      if (detailFlags.length > 0) {
        html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">';
        detailFlags.forEach(function (f) {
          html += '<span class="yb-lead__badge" style="background:' +
            (f.color === '#2E7D32' ? '#E8F5E9' : f.color === '#1565C0' ? '#E3F2FD' :
             f.color === '#6A1B9A' ? '#F3E5F5' : f.color === '#E65100' ? '#FFF3E0' :
             f.color === '#9e9e9e' ? '#F5F5F5' : '#FFF3E0') +
            ';color:' + f.color + ';padding:4px 10px;font-size:.78rem;">' +
            f.emoji + ' ' + esc(f.label) + '</span>';
        });
        html += '</div>';
      }

      html += '</div>'; // end card 1b
    }

    // Card 2: Program Details
    html += '<div class="yb-lead__section-card">';
    html += '<h4 class="yb-lead__card-title">PROGRAM DETAILS</h4>';
    html += '<div class="yb-lead__card-row">' +
      '<span class="yb-lead__card-label">' + t('leads_col_type') + '</span>' +
      '<span class="yb-lead__card-value"><span class="yb-lead__type-badge">' + typeBadge(l.type) + '</span></span>' +
    '</div>';
    if (l.program) {
      html += '<div class="yb-lead__card-row">' +
        '<span class="yb-lead__card-label">' + t('leads_col_program') + '</span>' +
        '<span class="yb-lead__card-value">' + esc(l.program) + '</span>' +
      '</div>';
    }
    if (l.ytt_program_type) {
      html += '<div class="yb-lead__card-row">' +
        '<span class="yb-lead__card-label">YTT Format</span>' +
        '<span class="yb-lead__card-value">' + esc(l.ytt_program_type) + '</span>' +
      '</div>';
    }
    if (l.cohort_label) {
      html += '<div class="yb-lead__card-row">' +
        '<span class="yb-lead__card-label">' + t('leads_cohort') + '</span>' +
        '<span class="yb-lead__card-value">' + esc(displayLocalized(l.cohort_label)) + '</span>' +
      '</div>';
    }
    if (l.preferred_month) {
      html += '<div class="yb-lead__card-row">' +
        '<span class="yb-lead__card-label">' + t('leads_preferred_month') + '</span>' +
        '<span class="yb-lead__card-value">' + esc(l.preferred_month) + '</span>' +
      '</div>';
    }
    if (l.accommodation && l.accommodation !== 'No') {
      html += '<div class="yb-lead__card-row">' +
        '<span class="yb-lead__card-label">' + t('leads_accommodation') + '</span>' +
        '<span class="yb-lead__card-value"><span class="yb-lead__badge" style="background:#E8F5E9;color:#2E7D32">\ud83c\udfe0 ' + esc(l.accommodation) + '</span></span>' +
      '</div>';
    }
    if (l.housing_months) {
      html += '<div class="yb-lead__card-row">' +
        '<span class="yb-lead__card-label">' + t('leads_housing_months') + '</span>' +
        '<span class="yb-lead__card-value">' + esc(l.housing_months) + '</span>' +
      '</div>';
    }
    if (l.service) {
      html += '<div class="yb-lead__card-row">' +
        '<span class="yb-lead__card-label">' + t('leads_service') + '</span>' +
        '<span class="yb-lead__card-value">' + esc(l.service) + '</span>' +
      '</div>';
    }
    if (l.message) {
      html += '<div class="yb-lead__card-row yb-lead__card-row--full">' +
        '<span class="yb-lead__card-label">' + t('leads_message') + '</span>' +
        '<div class="yb-lead__detail-message">' + esc(l.message) + '</div>' +
      '</div>';
    }
    html += '</div>'; // end card 2

    // Card 3: Pipeline Status (full-width)
    html += '<div class="yb-lead__section-card yb-lead__section-card--full">';
    html += '<h4 class="yb-lead__card-title">PIPELINE STATUS</h4>';

    // Status pill (large)
    html += '<div class="yb-lead__card-row">' +
      '<span class="yb-lead__card-label">' + t('leads_col_status') + '</span>' +
      '<span class="yb-lead__card-value">' +
        '<span class="yb-lead__badge yb-lead__badge--lg" style="background:' + statusMeta.color + ';color:' + statusMeta.text + '">' +
          statusMeta.icon + ' ' + esc(statusMeta.label) +
        '</span>' +
        (l.sub_status ? ' <span class="yb-lead__sub-status">' + esc(l.sub_status) + '</span>' : '') +
      '</span>' +
    '</div>';

    if (l.priority) {
      html += '<div class="yb-lead__card-row">' +
        '<span class="yb-lead__card-label">' + t('leads_priority') + '</span>' +
        '<span class="yb-lead__card-value">' + priorityBadgeHtml(l.priority) + ' ' + (priorityMeta ? priorityMeta.label : '') + '</span>' +
      '</div>';
    }
    if (l.temperature) {
      html += '<div class="yb-lead__card-row">' +
        '<span class="yb-lead__card-label">' + t('leads_temperature') + '</span>' +
        '<span class="yb-lead__card-value">' + temperatureBadgeHtml(l.temperature) + ' ' + (tempMeta ? tempMeta.label : '') + '</span>' +
      '</div>';
    }

    // Follow-up date with urgency color
    var followupHtml = '\u2014';
    if (l.followup_date) {
      var fDate = l.followup_date.toDate ? l.followup_date.toDate() : new Date(l.followup_date);
      var nowDate = new Date();
      nowDate.setHours(0, 0, 0, 0);
      var fuColor = '#66BB6A'; // green (future)
      if (fDate < nowDate) fuColor = '#EF5350'; // red (overdue)
      else if (fDate < new Date(nowDate.getTime() + 86400000)) fuColor = '#FF9800'; // orange (today)
      followupHtml = '<span style="color:' + fuColor + ';font-weight:600">' + fmtDate(l.followup_date) + '</span>';
    }
    html += '<div class="yb-lead__card-row">' +
      '<span class="yb-lead__card-label">' + t('leads_followup') + '</span>' +
      '<span class="yb-lead__card-value">' + followupHtml + '</span>' +
    '</div>';

    html += '<div class="yb-lead__card-row">' +
      '<span class="yb-lead__card-label">' + t('leads_call_attempts') + '</span>' +
      '<span class="yb-lead__card-value">' + (l.call_attempts || 0) + '</span>' +
    '</div>';
    html += '<div class="yb-lead__card-row">' +
      '<span class="yb-lead__card-label">' + t('leads_sms_status') + '</span>' +
      '<span class="yb-lead__card-value">' + esc(l.sms_status || '\u2014') + '</span>' +
    '</div>';
    html += '<div class="yb-lead__card-row">' +
      '<span class="yb-lead__card-label">' + t('leads_last_contact') + '</span>' +
      '<span class="yb-lead__card-value">' + fmtDateTime(l.last_contact) + '</span>' +
    '</div>';

    if (l.application_id) {
      html += '<div class="yb-lead__card-row">' +
        '<span class="yb-lead__card-label">' + t('leads_application_id') + '</span>' +
        '<span class="yb-lead__card-value">' +
          '<span class="yb-lead__badge" style="background:#d4edda;color:#155724">' + esc(l.application_id) + '</span> ' +
          '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="view-linked-app" data-app-id="' + esc(l.application_id) + '">View Application \u2192</button>' +
        '</span>' +
      '</div>';
    }

    html += '</div>'; // end card 3

    // Card 4: Schedule Engagement (from visit tracking)
    var eng = l.schedule_engagement;
    if (eng && eng.pages && Object.keys(eng.pages).length > 0) {
      html += '<div class="yb-lead__section-card yb-lead__section-card--full">';
      html += '<h4 class="yb-lead__card-title">SCHEDULE ENGAGEMENT</h4>';
      html += '<div class="yb-lead__card-row">' +
        '<span class="yb-lead__card-label">Total Visits</span>' +
        '<span class="yb-lead__card-value"><strong>' + (eng.total_visits || 0) + '</strong></span>' +
      '</div>';
      if (eng.last_visit) {
        html += '<div class="yb-lead__card-row">' +
          '<span class="yb-lead__card-label">Last Visit</span>' +
          '<span class="yb-lead__card-value">' + fmtDateTime(eng.last_visit) + '</span>' +
        '</div>';
      }
      if (eng.last_page) {
        html += '<div class="yb-lead__card-row">' +
          '<span class="yb-lead__card-label">Last Page</span>' +
          '<span class="yb-lead__card-value">' + esc(eng.last_page) + '</span>' +
        '</div>';
      }
      // Per-page breakdown
      var pages = eng.pages || {};
      var slugs = Object.keys(pages);
      if (slugs.length > 0) {
        html += '<div style="margin-top:8px;border-top:1px solid #E8E4E0;padding-top:8px;">';
        slugs.forEach(function (slug) {
          var p = pages[slug];
          var visits = p.visit_count || 0;
          var scroll = p.max_scroll || 0;
          var secs = p.total_seconds || 0;
          var mins = secs >= 60 ? Math.floor(secs / 60) + 'm ' + (secs % 60) + 's' : secs + 's';
          // Engagement level badges
          var level = '';
          if (visits >= 3 && scroll >= 75) {
            level = '<span class="yb-lead__badge" style="background:#d4edda;color:#155724;margin-left:6px;">🔥 High</span>';
          } else if (visits >= 2 || scroll >= 50) {
            level = '<span class="yb-lead__badge" style="background:#FFF3CD;color:#856404;margin-left:6px;">📊 Medium</span>';
          } else {
            level = '<span class="yb-lead__badge" style="background:#F5F3F0;color:#6F6A66;margin-left:6px;">👀 Low</span>';
          }
          html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;flex-wrap:wrap;">';
          html += '<span style="font-weight:600;font-size:.82rem;">' + esc(slug) + '</span>' + level;
          html += '<span style="font-size:.75rem;color:#6F6A66;margin-left:auto;">' +
            visits + ' visit' + (visits !== 1 ? 's' : '') +
            ' · ' + scroll + '% scrolled' +
            ' · ' + mins + ' on page' +
          '</span>';
          if (p.last_visit) {
            html += '<span style="font-size:.72rem;color:#6F6A66;">(last: ' + fmtDateTime(p.last_visit) + ')</span>';
          }
          html += '</div>';
        });
        html += '</div>';
      }
      html += '</div>'; // end card 4
    }

    // Card 5: Email Engagement
    var ee = l.email_engagement;
    if (ee && (ee.total_opens || ee.total_clicks)) {
      html += '<div class="yb-lead__section-card yb-lead__section-card--full">';
      html += '<h4 class="yb-lead__card-title">EMAIL ENGAGEMENT</h4>';

      // Welcome email row
      if (ee.welcome_opened) {
        html += '<div class="yb-lead__card-row">' +
          '<span class="yb-lead__card-label">\u2709\ufe0f Welcome Email</span>' +
          '<span class="yb-lead__card-value" style="color:#2E7D32;font-weight:600;">Opened' +
            (ee.welcome_clicked ? ' + Clicked' : '') +
          '</span></div>';
      }
      // Time to first open
      if (typeof ee.time_to_first_open_min === 'number') {
        var ttfo = ee.time_to_first_open_min;
        var ttfoText = ttfo < 60 ? ttfo + ' min' : Math.round(ttfo / 60) + 'h ' + (ttfo % 60) + 'm';
        var ttfoColor = ttfo <= 30 ? '#2E7D32' : ttfo <= 120 ? '#f57c00' : '#6F6A66';
        html += '<div class="yb-lead__card-row">' +
          '<span class="yb-lead__card-label">\u23f1 Time to First Open</span>' +
          '<span class="yb-lead__card-value" style="color:' + ttfoColor + ';font-weight:600;">' + ttfoText + '</span>' +
        '</div>';
      }

      html += '<div class="yb-lead__card-row">' +
        '<span class="yb-lead__card-label">Total Opens</span>' +
        '<span class="yb-lead__card-value"><strong>' + (ee.total_opens || 0) + '</strong>' +
          (ee.sequence_opens ? ' <span style="font-size:.72rem;color:#6F6A66;">(seq: ' + ee.sequence_opens + ')</span>' : '') +
        '</span></div>';
      html += '<div class="yb-lead__card-row">' +
        '<span class="yb-lead__card-label">Total Clicks</span>' +
        '<span class="yb-lead__card-value"><strong>' + (ee.total_clicks || 0) + '</strong>' +
          (ee.sequence_clicks ? ' <span style="font-size:.72rem;color:#6F6A66;">(seq: ' + ee.sequence_clicks + ')</span>' : '') +
        '</span></div>';

      // Days active
      var activeDates = ee.active_dates || [];
      if (activeDates.length > 0) {
        html += '<div class="yb-lead__card-row">' +
          '<span class="yb-lead__card-label">Days Active</span>' +
          '<span class="yb-lead__card-value"><strong>' + activeDates.length + '</strong> distinct days</span>' +
        '</div>';
      }

      if (ee.last_opened) {
        html += '<div class="yb-lead__card-row">' +
          '<span class="yb-lead__card-label">Last Opened</span>' +
          '<span class="yb-lead__card-value">' + fmtDateTime(ee.last_opened) + '</span>' +
        '</div>';
      }
      if (ee.last_clicked) {
        html += '<div class="yb-lead__card-row">' +
          '<span class="yb-lead__card-label">Last Clicked</span>' +
          '<span class="yb-lead__card-value">' + fmtDateTime(ee.last_clicked) + '</span>' +
        '</div>';
      }
      // Recent clicked links
      var clicks = ee.clicks || [];
      if (clicks.length > 0) {
        html += '<div style="margin-top:8px;border-top:1px solid #E8E4E0;padding-top:8px;">';
        html += '<div style="font-size:.75rem;font-weight:600;color:#6F6A66;margin-bottom:4px;">RECENT CLICKS</div>';
        var recentClicks = clicks.slice(-8).reverse();
        recentClicks.forEach(function (c) {
          var shortUrl = (c.url || '').replace('https://www.yogabible.dk', '').replace('https://yogabible.dk', '') || c.url;
          html += '<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:.78rem;">' +
            '<span style="color:#f75c03;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:65%;">' + esc(shortUrl) + '</span>' +
            '<span style="color:#6F6A66;">' + (c.at ? fmtDateTime(c.at) : '') + '</span>' +
          '</div>';
        });
        html += '</div>';
      }
      html += '</div>'; // end card 5
    }

    // Card 6: Website Browsing Activity
    var ste = l.site_engagement;
    if (ste && ste.total_pageviews) {
      html += '<div class="yb-lead__section-card yb-lead__section-card--full">';
      html += '<h4 class="yb-lead__card-title">WEBSITE ACTIVITY</h4>';
      html += '<div class="yb-lead__card-row">' +
        '<span class="yb-lead__card-label">Total Pageviews</span>' +
        '<span class="yb-lead__card-value"><strong>' + (ste.total_pageviews || 0) + '</strong></span>' +
      '</div>';
      html += '<div class="yb-lead__card-row">' +
        '<span class="yb-lead__card-label">Sessions</span>' +
        '<span class="yb-lead__card-value">' + (ste.total_sessions || 0) + '</span>' +
      '</div>';
      var totalTimeSecs = ste.total_time_seconds || 0;
      var totalTimeMins = totalTimeSecs >= 60 ? Math.floor(totalTimeSecs / 60) + 'm ' + (totalTimeSecs % 60) + 's' : totalTimeSecs + 's';
      html += '<div class="yb-lead__card-row">' +
        '<span class="yb-lead__card-label">Total Time</span>' +
        '<span class="yb-lead__card-value">' + totalTimeMins + '</span>' +
      '</div>';
      if (ste.last_visit) {
        html += '<div class="yb-lead__card-row">' +
          '<span class="yb-lead__card-label">Last Visit</span>' +
          '<span class="yb-lead__card-value">' + fmtDateTime(ste.last_visit) + '</span>' +
        '</div>';
      }
      // Interests
      var interests = ste.interests || [];
      if (interests.length > 0) {
        html += '<div class="yb-lead__card-row">' +
          '<span class="yb-lead__card-label">Interests</span>' +
          '<span class="yb-lead__card-value">' + interests.map(function (i) {
            return '<span class="yb-lead__badge" style="background:#FFF3CD;color:#856404;margin:1px 2px;">' + esc(i) + '</span>';
          }).join(' ') + '</span>' +
        '</div>';
      }
      // Post-lead key page flags
      var keyPageBadges = [];
      if (ste.schedule_revisits) keyPageBadges.push({ bg: '#E8F5E9', color: '#2E7D32', text: '\ud83d\udcc5 Schedule (' + ste.schedule_revisits + 'x)' });
      if (ste.accommodation_visited) keyPageBadges.push({ bg: '#FFF3E0', color: '#E65100', text: '\ud83c\udfe0 Accommodation' });
      if (ste.prep_phase_page_visited) keyPageBadges.push({ bg: '#FCE4EC', color: '#C62828', text: '\ud83d\udcb0 Checkout page' });
      if (ste.consultation_booking_clicked) keyPageBadges.push({ bg: '#E0F7FA', color: '#00695C', text: '\ud83d\udcc6 Booking' });
      if (ste.application_page_visited) keyPageBadges.push({ bg: '#F3E5F5', color: '#6A1B9A', text: '\ud83d\udcdd Application' });
      if (keyPageBadges.length > 0) {
        html += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">';
        keyPageBadges.forEach(function (b) {
          html += '<span class="yb-lead__badge" style="background:' + b.bg + ';color:' + b.color + ';">' + b.text + '</span>';
        });
        html += '</div>';
      }

      // Days active (site)
      var siteActiveDates = ste.active_dates || [];
      if (siteActiveDates.length > 0) {
        html += '<div class="yb-lead__card-row" style="margin-top:6px;">' +
          '<span class="yb-lead__card-label">Days Active on Site</span>' +
          '<span class="yb-lead__card-value"><strong>' + siteActiveDates.length + '</strong> distinct days</span>' +
        '</div>';
      }

      // Top pages
      var sitePages = ste.pages || {};
      var spSlugs = Object.keys(sitePages).sort(function (a, b) {
        return (sitePages[b].views || 0) - (sitePages[a].views || 0);
      }).slice(0, 10);
      if (spSlugs.length > 0) {
        html += '<div style="margin-top:8px;border-top:1px solid #E8E4E0;padding-top:8px;">';
        html += '<div style="font-size:.75rem;font-weight:600;color:#6F6A66;margin-bottom:4px;">TOP PAGES</div>';
        spSlugs.forEach(function (slug) {
          var sp = sitePages[slug];
          var views = sp.views || 0;
          var scroll = sp.max_scroll || 0;
          var secs = sp.total_seconds || 0;
          var mins = secs >= 60 ? Math.floor(secs / 60) + 'm ' + (secs % 60) + 's' : secs + 's';
          html += '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;flex-wrap:wrap;font-size:.78rem;">' +
            '<span style="font-weight:600;color:#1a1a1a;min-width:40%;">' + esc(sp.path || slug) + '</span>' +
            '<span style="color:#6F6A66;margin-left:auto;">' +
              views + ' view' + (views !== 1 ? 's' : '') +
              ' · ' + scroll + '% · ' + mins +
            '</span>' +
          '</div>';
        });
        html += '</div>';
      }
      // CTA clicks
      var ctaClicks = ste.cta_clicks || [];
      if (ctaClicks.length > 0) {
        html += '<div style="margin-top:8px;border-top:1px solid #E8E4E0;padding-top:8px;">';
        html += '<div style="font-size:.75rem;font-weight:600;color:#6F6A66;margin-bottom:4px;">CTA CLICKS</div>';
        ctaClicks.slice(-6).reverse().forEach(function (c) {
          html += '<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:.78rem;">' +
            '<span style="color:#f75c03;">' + esc(c.text || '') + '</span>' +
            '<span style="color:#6F6A66;">' + (c.at ? fmtDateTime(c.at) : '') + '</span>' +
          '</div>';
        });
        html += '</div>';
      }
      html += '</div>'; // end card 6
    }

    // Card 7: Re-Engagement Events
    var reEvents = l.re_engagement_events || [];
    if (reEvents.length > 0) {
      html += '<div class="yb-lead__section-card yb-lead__section-card--full">';
      html += '<h4 class="yb-lead__card-title" style="color:#f75c03;">\ud83d\udd04 RE-ENGAGEMENT HISTORY</h4>';
      reEvents.slice().reverse().forEach(function (re) {
        var triggerLabel = re.trigger === 'email_open' ? 'Opened email' :
          re.trigger === 'email_click' ? 'Clicked email link' :
          re.trigger === 'site_visit' ? 'Visited website' : re.trigger;
        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #F5F3F0;">' +
          '<div>' +
            '<span style="font-weight:600;font-size:.82rem;">' + esc(triggerLabel) + '</span>' +
            '<span class="yb-lead__badge" style="background:#FFF3CD;color:#856404;margin-left:6px;">after ' + re.days_inactive + ' days</span>' +
            (re.detail ? '<div style="font-size:.72rem;color:#6F6A66;margin-top:2px;">' + esc(re.detail) + '</div>' : '') +
          '</div>' +
          '<span style="font-size:.72rem;color:#6F6A66;">' + (re.at ? fmtDateTime(re.at) : '') + '</span>' +
        '</div>';
      });
      html += '</div>'; // end card 7
    }

    // Card 7b: Social Media Engagement
    var socEng = l.social_engagement;
    if (socEng && (socEng.instagram_followed || socEng.facebook_followed)) {
      html += '<div class="yb-lead__section-card yb-lead__section-card--full">';
      html += '<h4 class="yb-lead__card-title" style="color:#E4405F;">\ud83d\udcf1 SOCIAL MEDIA</h4>';

      // Platforms
      var socPlats = socEng.platforms || [];
      if (socPlats.length > 0) {
        html += '<div class="yb-lead__card-row">' +
          '<span class="yb-lead__card-label">Follows on</span>' +
          '<span class="yb-lead__card-value">' + socPlats.map(function (p) {
            var bg = p === 'instagram' ? '#E4405F' : p === 'facebook' ? '#1877F2' : '#6F6A66';
            return '<span class="yb-lead__badge" style="background:' + bg + ';color:#fff;margin:1px 2px;">' + esc(p) + '</span>';
          }).join(' ') + '</span>' +
        '</div>';
      }

      // Instagram details
      if (socEng.instagram_followed) {
        if (socEng.instagram_username) {
          html += '<div class="yb-lead__card-row">' +
            '<span class="yb-lead__card-label">Instagram</span>' +
            '<span class="yb-lead__card-value"><a href="https://instagram.com/' + esc(socEng.instagram_username) + '" target="_blank" style="color:#E4405F;">@' + esc(socEng.instagram_username) + '</a></span>' +
          '</div>';
        }
        if (socEng.instagram_followed_at) {
          html += '<div class="yb-lead__card-row">' +
            '<span class="yb-lead__card-label">Followed at</span>' +
            '<span class="yb-lead__card-value">' + fmtDateTime(socEng.instagram_followed_at) + '</span>' +
          '</div>';
        }
        if (socEng.instagram_dm_count) {
          html += '<div class="yb-lead__card-row">' +
            '<span class="yb-lead__card-label">DM interactions</span>' +
            '<span class="yb-lead__card-value"><strong>' + socEng.instagram_dm_count + '</strong>' +
              (socEng.last_dm_at ? ' <span style="font-size:.72rem;color:#6F6A66;">(last: ' + fmtDateTime(socEng.last_dm_at) + ')</span>' : '') +
            '</span></div>';
        }
      }

      // Facebook details
      if (socEng.facebook_followed) {
        if (socEng.facebook_followed_at) {
          html += '<div class="yb-lead__card-row">' +
            '<span class="yb-lead__card-label">Facebook follow</span>' +
            '<span class="yb-lead__card-value">' + fmtDateTime(socEng.facebook_followed_at) + '</span>' +
          '</div>';
        }
      }

      html += '</div>'; // end card 7b
    }

    // Card 8: Pre-Lead Journey (anonymous browsing before signup)
    var plj = l.pre_lead_journey;
    if (plj) {
      html += '<div class="yb-lead__section-card yb-lead__section-card--full">';
      var heatFires = '';
      var hScore = l.lead_heat || 0;
      for (var hfi = 0; hfi < 5; hfi++) heatFires += hfi < hScore ? '\ud83d\udd25' : '\u2b1c';
      html += '<h4 class="yb-lead__card-title" style="color:#d32f2f;">' + heatFires + ' PRE-LEAD JOURNEY (Heat ' + hScore + '/5)</h4>';

      // Summary line
      var summaryParts = [];
      if (plj.total_sessions) summaryParts.push(plj.total_sessions + ' session' + (plj.total_sessions > 1 ? 's' : ''));
      if (plj.total_pageviews) summaryParts.push(plj.total_pageviews + ' page' + (plj.total_pageviews > 1 ? 's' : ''));
      if (plj.days_before_signup) summaryParts.push('over ' + plj.days_before_signup + ' day' + (plj.days_before_signup > 1 ? 's' : ''));
      if (summaryParts.length > 0) {
        html += '<div style="font-size:.85rem;margin-bottom:8px;color:#333;">Visited ' + summaryParts.join(', ') + ' before signing up</div>';
      }

      // Return visitor badge
      if (plj.return_visitor) {
        html += '<span class="yb-lead__badge" style="background:#E3F2FD;color:#1565C0;margin-right:6px;">\u21a9\ufe0f Return Visitor</span>';
      }

      // Key page badges
      if (plj.viewed_schedule) {
        html += '<span class="yb-lead__badge" style="background:#E8F5E9;color:#2E7D32;margin-right:6px;">\ud83d\udcc5 Schedule</span>';
      }
      if (plj.viewed_accommodation) {
        html += '<span class="yb-lead__badge" style="background:#FFF3E0;color:#E65100;margin-right:6px;">\ud83c\udfe0 Accommodation</span>';
      }
      if (plj.viewed_copenhagen) {
        html += '<span class="yb-lead__badge" style="background:#E0F7FA;color:#00695C;margin-right:6px;">\ud83c\udf0d Copenhagen</span>';
      }
      if (plj.viewed_pricing) {
        html += '<span class="yb-lead__badge" style="background:#FCE4EC;color:#C62828;margin-right:6px;">\ud83d\udcb0 Pricing</span>';
      }
      if (plj.viewed_application) {
        html += '<span class="yb-lead__badge" style="background:#F3E5F5;color:#6A1B9A;margin-right:6px;">\ud83d\udcdd Application</span>';
      }

      // Attribution
      if (plj.attribution) {
        var attrParts = [];
        if (plj.attribution.utm_source) attrParts.push('Source: ' + plj.attribution.utm_source);
        if (plj.attribution.utm_medium) attrParts.push('Medium: ' + plj.attribution.utm_medium);
        if (plj.attribution.utm_campaign) attrParts.push('Campaign: ' + plj.attribution.utm_campaign);
        if (plj.attribution.channel) attrParts.push('Channel: ' + plj.attribution.channel);
        if (attrParts.length > 0) {
          html += '<div style="font-size:.75rem;color:#6F6A66;margin-top:8px;">' + esc(attrParts.join(' \u00b7 ')) + '</div>';
        }
      }

      // Top pages visited
      var pljPages = plj.pages || {};
      var pageKeys = Object.keys(pljPages);
      if (pageKeys.length > 0) {
        pageKeys.sort(function (a, b) { return (pljPages[b].views || 0) - (pljPages[a].views || 0); });
        html += '<div style="margin-top:10px;font-size:.78rem;">';
        html += '<div style="font-weight:600;color:#333;margin-bottom:4px;">Pages visited:</div>';
        pageKeys.slice(0, 8).forEach(function (pk) {
          var pg = pljPages[pk];
          html += '<div style="display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid #F5F3F0;">' +
            '<span style="color:#333;">' + esc(pg.title || pg.path || pk) + '</span>' +
            '<span style="color:#6F6A66;">' + (pg.views || 0) + 'x' + (pg.max_scroll ? ' \u00b7 ' + pg.max_scroll + '% scroll' : '') + '</span>' +
          '</div>';
        });
        html += '</div>';
      }

      html += '</div>'; // end card 8
    }

    html += '</div>'; // end yb-lead__detail-cards wrapper

    el.innerHTML = html;
  }

  /* ══════════════════════════════════════════
     LEAD EDIT FORM (mirrors app edit pattern)
     ══════════════════════════════════════════ */
  function renderLeadEditForm() {
    if (!currentLead) return;
    var l = currentLead;
    var el;
    el = $('yb-lead-edit-first-name'); if (el) el.value = l.first_name || '';
    el = $('yb-lead-edit-last-name'); if (el) el.value = l.last_name || '';
    el = $('yb-lead-edit-email'); if (el) el.value = l.email || '';
    el = $('yb-lead-edit-phone'); if (el) el.value = l.phone || '';
    el = $('yb-lead-edit-city'); if (el) el.value = l.city_country || '';
    el = $('yb-lead-edit-source'); if (el) el.value = l.source || '';
    el = $('yb-lead-edit-channel'); if (el) el.value = l.channel || '';
    el = $('yb-lead-edit-type'); if (el) el.value = l.type || '';
    el = $('yb-lead-edit-program'); if (el) el.value = l.program || '';
    el = $('yb-lead-edit-preferred-month'); if (el) el.value = l.preferred_month || '';
    el = $('yb-lead-edit-accommodation'); if (el) el.value = l.accommodation || '';
    el = $('yb-lead-edit-housing-months'); if (el) el.value = l.housing_months || '';
    el = $('yb-lead-edit-message'); if (el) el.value = l.message || '';
  }

  function saveLeadFields() {
    if (!currentLeadId || !currentLead) return;

    var formEl = $('yb-lead-edit-form');
    var btn = saveBtnStart(formEl);

    var updates = {};
    var fields = [
      { id: 'yb-lead-edit-first-name', key: 'first_name' },
      { id: 'yb-lead-edit-last-name', key: 'last_name' },
      { id: 'yb-lead-edit-email', key: 'email' },
      { id: 'yb-lead-edit-phone', key: 'phone' },
      { id: 'yb-lead-edit-city', key: 'city_country' },
      { id: 'yb-lead-edit-source', key: 'source' },
      { id: 'yb-lead-edit-channel', key: 'channel' },
      { id: 'yb-lead-edit-type', key: 'type' },
      { id: 'yb-lead-edit-program', key: 'program' },
      { id: 'yb-lead-edit-preferred-month', key: 'preferred_month' },
      { id: 'yb-lead-edit-accommodation', key: 'accommodation' },
      { id: 'yb-lead-edit-housing-months', key: 'housing_months' },
      { id: 'yb-lead-edit-message', key: 'message' }
    ];

    fields.forEach(function (f) {
      var el = $(f.id);
      if (el) updates[f.key] = el.value.trim();
    });

    updates.updated_at = firebase.firestore.FieldValue.serverTimestamp();

    db.collection('leads').doc(currentLeadId).update(updates).then(function () {
      // Update local cache
      Object.keys(updates).forEach(function (k) {
        if (k !== 'updated_at') currentLead[k] = updates[k];
      });
      var idx = leads.findIndex(function (l) { return l.id === currentLeadId; });
      if (idx !== -1) Object.assign(leads[idx], currentLead);

      renderLeadDetailCard();
      renderLeadQuickActions();
      // Update heading in case name changed
      var headingEl = $('yb-lead-detail-heading');
      if (headingEl) headingEl.textContent = (currentLead.first_name || '') + ' ' + (currentLead.last_name || '');
      saveBtnSuccess(btn);
      toast(t('leads_fields_saved'));
    }).catch(function (err) {
      console.error('[lead-admin] Lead fields save error:', err);
      saveBtnError(btn);
      toast(t('error_save'), true);
    });
  }

  /* ══════════════════════════════════════════
     QUICK ACTIONS
     ══════════════════════════════════════════ */
  function renderLeadQuickActions() {
    var el = $('yb-lead-actions');
    if (!el || !currentLead) return;

    var phone = currentLead.phone || '';
    var email = currentLead.email || '';

    var html =
      (phone ? '<a href="tel:' + esc(phone) + '" class="yb-btn" data-action="log-call">\ud83d\udcde ' + t('leads_call') + '</a>' : '') +
      (phone ? '<button class="yb-btn" data-action="lead-sms">\ud83d\udcf1 ' + t('leads_sms') + '</button>' : '') +
      (phone ? '<a href="https://wa.me/' + esc(phone.replace(/[^0-9+]/g, '')) + '" target="_blank" class="yb-btn">\ud83d\udcac WhatsApp</a>' : '') +
      (email ? '<button class="yb-btn" data-action="lead-email">\u2709\ufe0f ' + t('leads_email') + '</button>' : '') +
      (phone ? '<button class="yb-btn yb-btn--primary" data-action="send-booking-sms" title="Send booking link via SMS">\ud83d\udcc5 Booking SMS</button>' : '') +
      (email ? '<button class="yb-btn yb-btn--primary" data-action="send-booking-email" title="Send booking link via Email">\ud83d\udcc5 Booking Email</button>' : '') +
      '<button class="yb-btn" data-action="lead-add-note">\ud83d\udcdd ' + t('leads_add_note') + '</button>';

    // Admin actions: archive (soft delete) or restore
    if (currentUserRole === 'admin') {
      if (currentLead.archived === true) {
        html += '<button class="yb-btn yb-btn--outline yb-btn--sm" style="color:#4CAF50;border-color:#4CAF50" data-action="restore-lead" data-id="' + currentLeadId + '">\u21a9\ufe0f ' + t('leads_restore') + '</button>';
      } else {
        html += '<button class="yb-btn yb-btn--outline yb-btn--sm yb-admin__icon-btn--danger" data-action="delete-lead" data-id="' + currentLeadId + '">\ud83d\uddd1 ' + t('leads_archive') + '</button>';
      }
    }

    el.innerHTML = html;
  }

  /* ══════════════════════════════════════════
     SMS CONVERSATION (subcollection)
     ══════════════════════════════════════════ */
  function loadSMSConversation(leadId) {
    var container = $('yb-lead-sms-conversation');
    if (!container) return;

    container.innerHTML = '<p class="yb-lead__empty-text">' + t('loading') + '</p>';

    db.collection('leads').doc(leadId).collection('sms_messages')
      .orderBy('timestamp', 'asc')
      .get()
      .then(function (snap) {
        var messages = [];
        snap.forEach(function (doc) {
          messages.push(Object.assign({ id: doc.id }, doc.data()));
        });
        renderSMSConversation(messages, container);
      })
      .catch(function (err) {
        console.error('[lead-admin] SMS conversation load error:', err);
        container.innerHTML = '<p class="yb-lead__empty-text">Could not load SMS conversation.</p>';
      });
  }

  function renderSMSConversation(messages, container) {
    if (!container) container = $('yb-lead-sms-conversation');
    if (!container) return;

    var html = '<div class="yb-lead__sms-thread">';

    if (!messages || messages.length === 0) {
      html += '<p class="yb-lead__empty-text">No SMS messages yet.</p>';
    } else {
      html += messages.map(function (m) {
        var dir = (m.direction === 'inbound') ? 'in' : 'out';
        return '<div class="yb-lead__sms-bubble yb-lead__sms-bubble--' + dir + '">' +
          '<div class="yb-lead__sms-bubble-text">' + esc(m.message || m.body || '') + '</div>' +
          '<div class="yb-lead__sms-bubble-time">' + fmtDateTime(m.timestamp) + '</div>' +
        '</div>';
      }).join('');
    }

    html += '</div>';

    // Reply input
    if (currentLead && currentLead.phone) {
      html += '<div class="yb-lead__sms-reply">' +
        '<input type="text" id="yb-sms-reply-input" class="yb-admin__input" placeholder="Type a reply..." style="flex:1">' +
        '<button class="yb-btn yb-btn--primary yb-btn--sm" data-action="sms-reply-send">\u27a4 Send</button>' +
      '</div>';
    }

    container.innerHTML = html;

    // Auto-scroll to bottom of thread
    var thread = container.querySelector('.yb-lead__sms-thread');
    if (thread) thread.scrollTop = thread.scrollHeight;
  }

  function sendSMSReply() {
    var input = $('yb-sms-reply-input');
    if (!input || !currentLead || !currentLead.phone) return;

    var message = input.value.trim();
    if (!message) { toast(t('leads_sms_empty'), true); return; }

    input.disabled = true;

    getAuthToken().then(function (token) {
      return fetch('/.netlify/functions/send-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ leadId: currentLeadId, message: message })
      });
    }).then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.ok) {
          toast(t('leads_sms_sent'));
          input.value = '';
          addNoteDirectly('SMS sent: ' + message.substring(0, 100), 'sms');
          // Reload conversation
          loadSMSConversation(currentLeadId);
        } else {
          toast(t('leads_sms_failed') + ': ' + (data.error || ''), true);
        }
      }).catch(function (err) {
        toast(t('leads_sms_failed') + ': ' + err.message, true);
      }).finally(function () {
        if (input) input.disabled = false;
      });
  }

  function markSMSRead(leadId) {
    // Update the lead doc
    db.collection('leads').doc(leadId).update({
      has_unread_sms: false
    }).then(function () {
      // Update local state
      if (currentLead) currentLead.has_unread_sms = false;
      var idx = leads.findIndex(function (l) { return l.id === leadId; });
      if (idx !== -1) leads[idx].has_unread_sms = false;
    }).catch(function (err) {
      console.error('[lead-admin] markSMSRead error:', err);
    });
  }

  /* ══════════════════════════════════════════
     STATUS + SETTINGS FORM
     ══════════════════════════════════════════ */
  function populateStatusForm() {
    if (!currentLead) return;

    var statusSelect = $('yb-lead-status-select');
    var subStatusSelect = $('yb-lead-sub-status-select');
    var prioritySelect = $('yb-lead-priority-select');
    var tempSelect = $('yb-lead-temperature-select');
    var followupInput = $('yb-lead-followup-input');

    if (statusSelect) statusSelect.value = currentLead.status || 'New';
    if (prioritySelect) prioritySelect.value = currentLead.priority || '';
    if (tempSelect) tempSelect.value = currentLead.temperature || '';
    if (followupInput) followupInput.value = fmtDateInput(currentLead.followup_date);

    // Populate sub-statuses for current status
    updateSubStatusOptions();
    if (subStatusSelect) subStatusSelect.value = currentLead.sub_status || '';
  }

  function updateSubStatusOptions() {
    var statusSelect = $('yb-lead-status-select');
    var subStatusSelect = $('yb-lead-sub-status-select');
    if (!statusSelect || !subStatusSelect) return;

    var status = statusSelect.value;
    var subs = SUB_STATUSES[status] || [];

    // For "Interested In Next Round", use all cohort labels from COURSE_CATALOG
    if (status === 'Interested In Next Round') {
      subs = [];
      ['ytt', 'course', 'bundle'].forEach(function (type) {
        (COURSE_CATALOG[type] || []).forEach(function (item) {
          var name = catalogName(item);
          (item.cohorts || []).forEach(function (coh) {
            subs.push(cohortLabel(coh) + ' — ' + name);
          });
          // For courses/bundles with no cohorts, just use the name
          if (!item.cohorts || item.cohorts.length === 0) {
            subs.push(name);
          }
        });
      });
    }

    subStatusSelect.innerHTML = '<option value="">-- ' + t('leads_no_sub_status') + ' --</option>' +
      subs.map(function (s) {
        return '<option value="' + esc(s) + '">' + esc(s) + '</option>';
      }).join('');
  }

  function saveLeadStatus(e) {
    e.preventDefault();
    if (!currentLeadId) return;

    var formEl = $('yb-lead-status-form');
    var btn = saveBtnStart(formEl);

    var newStatus = $('yb-lead-status-select').value;
    var newSubStatus = $('yb-lead-sub-status-select') ? $('yb-lead-sub-status-select').value : '';
    var newPriority = $('yb-lead-priority-select') ? $('yb-lead-priority-select').value : '';
    var newTemp = $('yb-lead-temperature-select') ? $('yb-lead-temperature-select').value : '';
    var newFollowup = $('yb-lead-followup-input') ? $('yb-lead-followup-input').value : '';

    var updates = {
      status: newStatus,
      sub_status: newSubStatus,
      priority: newPriority,
      temperature: newTemp,
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (newFollowup) {
      updates.followup_date = new Date(newFollowup + 'T09:00:00');
    } else {
      updates.followup_date = null;
    }

    if (newStatus === 'Contacted' && !currentLead.last_contact) {
      updates.last_contact = firebase.firestore.FieldValue.serverTimestamp();
    }

    if (newStatus === 'Converted' && !currentLead.converted) {
      updates.converted = true;
      updates.converted_at = firebase.firestore.FieldValue.serverTimestamp();
    }

    db.collection('leads').doc(currentLeadId).update(updates).then(function () {
      // Update local state
      Object.keys(updates).forEach(function (k) {
        currentLead[k] = updates[k];
      });
      var idx = leads.findIndex(function (l) { return l.id === currentLeadId; });
      if (idx !== -1) Object.assign(leads[idx], updates);

      // Converted / Existing Applicant → remove from active leads view
      if (newStatus === 'Converted' || newStatus === 'Existing Applicant') {
        saveBtnSuccess(btn);
        var msg = newStatus === 'Converted'
          ? 'Lead markeret som konverteret — se dem under Applications-fanen'
          : 'Lead markeret som Existing Applicant — se dem under Applications-fanen';
        toast(msg);
        // Close detail panel and refresh list (lead disappears from active view)
        $('yb-admin-v-lead-list').hidden = false;
        $('yb-admin-v-lead-detail').hidden = true;
        currentLeadId = null;
        currentLead = null;
        renderLeadView();
        renderLeadStats();
      } else {
        renderLeadDetailCard();
        renderLeadStats();
        saveBtnSuccess(btn);
        toast(t('saved'));
      }
    }).catch(function (err) {
      console.error('[lead-admin] Save error:', err);
      saveBtnError(btn);
      toast(t('error_save'), true);
    });
  }

  /* ══════════════════════════════════════════
     NOTES TIMELINE
     ══════════════════════════════════════════ */
  function renderLeadNotes() {
    var el = $('yb-lead-notes-timeline');
    if (!el || !currentLead) return;

    var notes = currentLead.notes;

    // Support old format (plain string) and new format (array of objects)
    if (typeof notes === 'string' && notes) {
      el.innerHTML = '<div class="yb-lead__note-item">' +
        '<div class="yb-lead__note-text">' + esc(notes) + '</div>' +
        '</div>';
      return;
    }

    if (!Array.isArray(notes) || notes.length === 0) {
      el.innerHTML = '<p class="yb-lead__empty-text">' + t('leads_no_notes') + '</p>';
      return;
    }

    // New format — array of { text, timestamp, author, type }
    el.innerHTML = notes.slice().reverse().map(function (n) {
      var typeIcon = { call: '\ud83d\udcde', email: '\u2709\ufe0f', sms: '\ud83d\udcf1', note: '\ud83d\udcdd', system: '\u2699\ufe0f' };
      var icon = typeIcon[n.type || 'note'] || '\ud83d\udcdd';
      return '<div class="yb-lead__note-item yb-lead__note-item--' + (n.type || 'note') + '">' +
        '<div class="yb-lead__note-header">' +
          '<span class="yb-lead__note-icon">' + icon + '</span>' +
          '<span class="yb-lead__note-author">' + esc(n.author || '') + '</span>' +
          '<span class="yb-lead__note-time">' + fmtDateTime(n.timestamp) + '</span>' +
        '</div>' +
        '<div class="yb-lead__note-text">' + esc(n.text || '') + '</div>' +
      '</div>';
    }).join('');
  }

  function addNote(type) {
    if (!currentLeadId || !currentLead) return;

    var noteText = $('yb-lead-note-input') ? $('yb-lead-note-input').value.trim() : '';
    if (!noteText) {
      var input = prompt(t('leads_enter_note'));
      if (!input) return;
      noteText = input;
    }

    var newNote = {
      text: noteText,
      timestamp: new Date().toISOString(),
      author: (firebase.auth().currentUser || {}).email || 'admin',
      type: type || 'note'
    };

    // Convert old format to new
    var existingNotes = currentLead.notes;
    var notesArray = [];
    if (typeof existingNotes === 'string' && existingNotes) {
      notesArray.push({ text: existingNotes, timestamp: '', author: '', type: 'note' });
    } else if (Array.isArray(existingNotes)) {
      notesArray = existingNotes.slice();
    }
    notesArray.push(newNote);

    db.collection('leads').doc(currentLeadId).update({
      notes: notesArray,
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
      currentLead.notes = notesArray;
      var idx = leads.findIndex(function (l) { return l.id === currentLeadId; });
      if (idx !== -1) leads[idx].notes = notesArray;

      renderLeadNotes();
      if ($('yb-lead-note-input')) $('yb-lead-note-input').value = '';
      toast(t('leads_note_added'));
    }).catch(function (err) {
      console.error('[lead-admin] Note error:', err);
      toast(t('error_save'), true);
    });
  }

  function logCall() {
    if (!currentLeadId || !currentLead) return;

    var result = prompt(t('leads_call_result'), 'Spoke briefly');
    if (!result) return;

    var newAttempts = (currentLead.call_attempts || 0) + 1;
    var newNote = {
      text: t('leads_call_log_prefix') + ' #' + newAttempts + ': ' + result,
      timestamp: new Date().toISOString(),
      author: (firebase.auth().currentUser || {}).email || 'admin',
      type: 'call'
    };

    var notesArray = [];
    if (typeof currentLead.notes === 'string' && currentLead.notes) {
      notesArray.push({ text: currentLead.notes, timestamp: '', author: '', type: 'note' });
    } else if (Array.isArray(currentLead.notes)) {
      notesArray = currentLead.notes.slice();
    }
    notesArray.push(newNote);

    db.collection('leads').doc(currentLeadId).update({
      call_attempts: newAttempts,
      last_contact: firebase.firestore.FieldValue.serverTimestamp(),
      notes: notesArray,
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
      currentLead.call_attempts = newAttempts;
      currentLead.notes = notesArray;
      var idx = leads.findIndex(function (l) { return l.id === currentLeadId; });
      if (idx !== -1) {
        leads[idx].call_attempts = newAttempts;
        leads[idx].notes = notesArray;
      }
      renderLeadDetailCard();
      renderLeadNotes();
      toast(t('leads_call_logged'));
    }).catch(function (err) {
      console.error('[lead-admin] Call log error:', err);
      toast(t('error_save'), true);
    });
  }

  /* ══════════════════════════════════════════
     DELETE LEAD (Soft — archives, does not remove from DB)
     ══════════════════════════════════════════ */
  var showArchived = false;

  function deleteLead(leadId) {
    if (currentUserRole !== 'admin') {
      toast('Only admins can delete leads.', true);
      return;
    }
    if (!confirm(t('leads_confirm_delete'))) return;

    var lead = leads.find(function (l) { return l.id === leadId; });
    var user = firebase.auth().currentUser;

    db.collection('leads').doc(leadId).update({
      archived: true,
      archived_at: firebase.firestore.FieldValue.serverTimestamp(),
      archived_by: user ? user.email : 'unknown',
      previous_status: lead ? lead.status : '',
      status: 'Archived'
    }).then(function () {
      leads = leads.filter(function (l) { return l.id !== leadId; });
      backToLeadList();
      renderLeadView();
      renderLeadStats();
      toast(t('leads_archived'));
    }).catch(function (err) {
      console.error('[lead-admin] Archive error:', err);
      toast(t('error_save'), true);
    });
  }

  function restoreLead(leadId) {
    if (currentUserRole !== 'admin') {
      toast('Only admins can restore leads.', true);
      return;
    }
    var lead = leads.find(function (l) { return l.id === leadId; });
    if (!lead) return;

    var restoreStatus = lead.previous_status || 'New';

    db.collection('leads').doc(leadId).update({
      archived: false,
      archived_at: null,
      archived_by: null,
      previous_status: null,
      status: restoreStatus
    }).then(function () {
      lead.archived = false;
      lead.status = restoreStatus;
      lead.previous_status = null;
      renderLeadView();
      renderLeadStats();
      toast(t('leads_restored'));
    }).catch(function (err) {
      toast(t('error_save'), true);
    });
  }

  function toggleShowArchived() {
    showArchived = !showArchived;
    var btn = $('yb-lead-archive-toggle');
    if (btn) {
      btn.textContent = showArchived
        ? '\ud83d\udce6 ' + t('leads_hide_archived')
        : '\ud83d\udce6 ' + t('leads_show_archived');
      btn.classList.toggle('is-active', showArchived);
    }
    loadLeads();
  }

  /* ══════════════════════════════════════════
     ACTIVITY LOG (Email + SMS)
     ══════════════════════════════════════════ */
  function loadLeadActivity() {
    var el = $('yb-lead-activity');
    if (!el || !currentLead) return;

    el.innerHTML = '<p class="yb-lead__empty-text">' + t('loading') + '</p>';

    // Load email log + sms log
    var emailPromise = db.collection('email_log')
      .where('to', '==', currentLead.email)
      .orderBy('sent_at', 'desc')
      .limit(30)
      .get()
      .catch(function () { return { empty: true, forEach: function () {} }; });

    var smsPromise = db.collection('sms_log')
      .where('to', '==', currentLead.phone || '__none__')
      .orderBy('sent_at', 'desc')
      .limit(20)
      .get()
      .catch(function () { return { empty: true, forEach: function () {} }; });

    Promise.all([emailPromise, smsPromise]).then(function (results) {
      var activities = [];

      results[0].forEach(function (doc) {
        var d = doc.data();
        activities.push({
          type: 'email',
          icon: '\u2709\ufe0f',
          title: d.subject || 'Email',
          detail: d.template_id ? 'Template: ' + d.template_id : 'Custom',
          time: d.sent_at
        });
      });

      results[1].forEach(function (doc) {
        var d = doc.data();
        activities.push({
          type: 'sms',
          icon: '\ud83d\udcf1',
          title: 'SMS',
          detail: (d.message || '').substring(0, 80),
          time: d.sent_at
        });
      });

      // Sort by time descending
      activities.sort(function (a, b) {
        var ta = a.time && a.time.toDate ? a.time.toDate().getTime() : new Date(a.time || 0).getTime();
        var tb = b.time && b.time.toDate ? b.time.toDate().getTime() : new Date(b.time || 0).getTime();
        return tb - ta;
      });

      if (!activities.length) {
        el.innerHTML = '<p class="yb-lead__empty-text">' + t('leads_no_activity') + '</p>';
        return;
      }

      el.innerHTML = activities.map(function (a) {
        return '<div class="yb-lead__activity-item yb-lead__activity-item--' + a.type + '">' +
          '<span class="yb-lead__activity-icon">' + a.icon + '</span>' +
          '<div class="yb-lead__activity-body">' +
            '<strong>' + esc(a.title) + '</strong>' +
            (a.detail ? '<div class="yb-lead__activity-detail">' + esc(a.detail) + '</div>' : '') +
            '<div class="yb-lead__activity-time">' + fmtDateTime(a.time) + '</div>' +
          '</div>' +
        '</div>';
      }).join('');
    });
  }

  /* ══════════════════════════════════════════
     SMS TEMPLATES (from config)
     ══════════════════════════════════════════ */
  var SMS_TEMPLATES = {
    booking: { label: '\ud83d\udcc5 Book aftale', msg: "Hej {{first_name}}! Book et gratis infom\u00f8de, samtale eller pr\u00f8vetime her: https://yogabible.dk/?booking=1 \u2014 Yoga Bible" },
    followup: { label: '\ud83d\udd04 F\u00f8lg op', msg: "Hej {{first_name}}! Jeg ville lige h\u00f8re om du har haft tid til at kigge p\u00e5 vores uddannelse? Du er velkommen til at booke et infom\u00f8de: https://yogabible.dk/?booking=1 \u2014 Yoga Bible" },
    ytt: { label: '\ud83c\udf93 YTT velkomst', msg: "Hej {{first_name}}! Tak for din interesse i vores yogal\u00e6reruddannelse. Vi har sendt detaljer til din email (tjek ogs\u00e5 spam). Book et infom\u00f8de: https://yogabible.dk/?booking=1 \u2014 Yoga Bible" },
    course: { label: '\ud83d\udcda Kursus velkomst', msg: "Hej {{first_name}}! Tak for din interesse i vores {{program}} kursus. Vi har sendt detaljer til din email. Book en samtale: https://yogabible.dk/?booking=1 \u2014 Yoga Bible" },
    mentorship: { label: '\ud83e\uddd8 Mentorship', msg: "Hej {{first_name}}! Tak for din interesse i vores mentorship-program. Book en gratis samtale: https://yogabible.dk/?booking=1 \u2014 Yoga Bible" },
    reminder: { label: '\u23f0 P\u00e5mindelse', msg: "Hej {{first_name}}! Husk at vi har reserveret en plads til dig. Holdene fylder op \u2014 sikr din plads: https://yogabible.dk/?booking=1 \u2014 Yoga Bible" },
    general: { label: '\ud83d\udcac Generel', msg: "Hej {{first_name}}! Tak fordi du kontaktede Yoga Bible. Vi har sendt info til din email. Book en samtale: https://yogabible.dk/?booking=1 \u2014 Yoga Bible" }
  };

  function applySMSTemplate(key) {
    var tpl = SMS_TEMPLATES[key];
    if (!tpl) return;
    var ta = $('yb-sms-message');
    if (!ta) return;
    var msg = tpl.msg;
    if (currentLead) {
      msg = msg.replace(/\{\{first_name\}\}/gi, currentLead.first_name || '');
      msg = msg.replace(/\{\{program\}\}/gi, currentLead.program || 'yoga program');
    }
    ta.value = msg;
    updateSMSCharCount();
    ta.focus();
  }

  function updateSMSCharCount() {
    var ta = $('yb-sms-message');
    if (!ta) return;
    var len = ta.value.length;
    var segments = Math.ceil(len / 160) || 1;
    var charEl = $('yb-sms-charcount');
    var segEl = $('yb-sms-segments');
    if (charEl) charEl.textContent = len;
    if (segEl) segEl.textContent = segments;
  }

  /* ══════════════════════════════════════════
     SMS COMPOSER (Modal)
     ══════════════════════════════════════════ */
  function openSMSComposer(leadOrLeads) {
    var modal = $('yb-lead-sms-modal');
    if (!modal) return;

    var isBulk = Array.isArray(leadOrLeads);
    var recipients = isBulk ? leadOrLeads : [leadOrLeads || currentLead];
    var withPhone = recipients.filter(function (l) { return l && l.phone; }).length;
    var skipped = recipients.length - withPhone;

    // Main recipient info
    $('yb-sms-recipient-info').textContent = isBulk ?
      withPhone + ' ' + t('leads_recipients') :
      (recipients[0].first_name || '') + ' (' + (recipients[0].phone || '') + ')';

    // Detailed breakdown for bulk
    var detailEl = $('yb-sms-recipient-detail');
    if (detailEl) {
      if (isBulk && skipped > 0) {
        detailEl.textContent = withPhone + ' ' + t('leads_with_phone') + ' · ' + skipped + ' ' + t('leads_skipped');
        detailEl.hidden = false;
      } else {
        detailEl.hidden = true;
      }
    }

    $('yb-sms-message').value = isBulk ? '' : ('Hi ' + (recipients[0].first_name || '') + '! ');
    updateSMSCharCount();

    // Reset template dropdown
    var tplSel = $('yb-sms-template-select');
    if (tplSel) tplSel.value = '';

    // Hide progress bar
    var prog = $('yb-sms-progress');
    if (prog) prog.hidden = true;

    modal.hidden = false;
    positionModalInIframe(modal);
    modal._recipients = recipients;
    modal._isBulk = isBulk;

    setTimeout(function () { $('yb-sms-message').focus(); }, 100);
  }

  function sendSMSFromComposer() {
    var modal = $('yb-lead-sms-modal');
    if (!modal) return;

    var message = ($('yb-sms-message') || {}).value;
    if (!message) { toast(t('leads_sms_empty'), true); return; }

    var recipients = modal._recipients || [];
    var isBulk = modal._isBulk;
    var sendBtn = $('yb-sms-send-btn');
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = t('leads_sending'); }

    getAuthToken().then(function (token) {
      var body;
      if (isBulk) {
        var leadIds = recipients.filter(function (l) { return l && l.phone; }).map(function (l) { return l.id; });
        body = JSON.stringify({ leadIds: leadIds, message: message });
      } else {
        body = JSON.stringify({ leadId: recipients[0].id, message: message });
      }

      return fetch('/.netlify/functions/send-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: body
      });
    }).then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.ok) {
          toast(isBulk ? t('leads_sms_bulk_sent') + ' (' + (data.results ? data.results.sent : '?') + ')' : t('leads_sms_sent'));
          modal.hidden = true;

          // Log note if single
          if (!isBulk && currentLead) {
            addNoteDirectly('SMS sent: ' + message.substring(0, 100), 'sms');
          }
        } else {
          toast(t('leads_sms_failed') + ': ' + (data.error || ''), true);
        }
      }).catch(function (err) {
        toast(t('leads_sms_failed') + ': ' + err.message, true);
      }).finally(function () {
        if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = t('leads_send_sms'); }
      });
  }

  /* ══════════════════════════════════════════
     BOOKING LINK SHORTCUTS (SMS + Email)
     ══════════════════════════════════════════ */
  function sendBookingSMS() {
    if (!currentLead || !currentLead.phone) { toast('No phone number', true); return; }
    openSMSComposer();
    setTimeout(function () { applySMSTemplate('booking'); }, 50);
  }

  function sendBookingEmail() {
    if (!currentLead || !currentLead.email) { toast('No email', true); return; }
    openEmailComposer();
    setTimeout(function () {
      var subj = $('yb-email-subject');
      var body = $('yb-email-body');
      var name = currentLead.first_name || '';
      if (subj) subj.value = 'Book en aftale — Yoga Bible';
      if (body) body.value = 'Hej ' + name + ',\n\nTak for din interesse! Book et gratis infom\u00f8de, samtale eller pr\u00f8vetime her:\nhttps://yogabible.dk/?booking=1\n\nVi gl\u00e6der os til at se dig.\n\nVarme hilsner,\nYoga Bible';
    }, 50);
  }

  /* ══════════════════════════════════════════
     EMAIL COMPOSER (Modal)
     ══════════════════════════════════════════ */
  var emailTemplatesLoaded = false;

  function loadEmailTemplates() {
    if (emailTemplatesLoaded || !db) return;
    emailTemplatesLoaded = true;
    var sel = $('yb-email-template-select');
    if (!sel) return;
    db.collection('email_templates').get().then(function (snap) {
      snap.forEach(function (doc) {
        var d = doc.data();
        var opt = document.createElement('option');
        opt.value = doc.id;
        opt.textContent = d.name || doc.id;
        opt.dataset.subject = d.subject || '';
        opt.dataset.body = d.body_plain || d.body || '';
        sel.appendChild(opt);
      });
    }).catch(function () { /* template collection may not exist */ });
  }

  function openEmailComposer(leadOrLeads) {
    var modal = $('yb-lead-email-modal');
    if (!modal) return;

    var isBulk = Array.isArray(leadOrLeads);
    var recipients = isBulk ? leadOrLeads : [leadOrLeads || currentLead];
    var withEmail = recipients.filter(function (l) { return l && l.email; }).length;
    var skipped = recipients.length - withEmail;

    $('yb-email-recipient-info').textContent = isBulk ?
      withEmail + ' ' + t('leads_recipients') :
      (recipients[0].first_name || '') + ' (' + (recipients[0].email || '') + ')';

    // Detailed breakdown for bulk
    var detailEl = $('yb-email-recipient-detail');
    if (detailEl) {
      if (isBulk && skipped > 0) {
        detailEl.textContent = withEmail + ' ' + t('leads_with_email') + ' · ' + skipped + ' ' + t('leads_skipped');
        detailEl.hidden = false;
      } else {
        detailEl.hidden = true;
      }
    }

    $('yb-email-subject').value = '';
    $('yb-email-body').value = '';

    // Reset template dropdown
    var tplSel = $('yb-email-template-select');
    if (tplSel) tplSel.value = '';

    // Load templates from Firestore (once)
    loadEmailTemplates();

    // Hide progress bar
    var prog = $('yb-email-progress');
    if (prog) prog.hidden = true;

    modal.hidden = false;
    positionModalInIframe(modal);
    modal._recipients = recipients;
    modal._isBulk = isBulk;

    setTimeout(function () { $('yb-email-subject').focus(); }, 100);
  }

  function sendEmailFromComposer() {
    var modal = $('yb-lead-email-modal');
    if (!modal) return;

    var subject = ($('yb-email-subject') || {}).value;
    var bodyHtml = ($('yb-email-body') || {}).value;
    if (!subject || !bodyHtml) { toast(t('leads_email_empty'), true); return; }

    var recipients = modal._recipients || [];
    var isBulk = modal._isBulk;
    var sendBtn = $('yb-email-send-btn');
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = t('leads_sending'); }

    // Convert plain text to HTML paragraphs
    var htmlBody = '<p>' + esc(bodyHtml).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>') + '</p>';

    getAuthToken().then(function (token) {
      var body;
      if (isBulk) {
        var leadIds = recipients.filter(function (l) { return l && l.email; }).map(function (l) { return l.id; });
        body = JSON.stringify({ leadIds: leadIds, subject: subject, bodyHtml: htmlBody, bodyPlain: bodyHtml });
      } else {
        body = JSON.stringify({ leadId: recipients[0].id, subject: subject, bodyHtml: htmlBody, bodyPlain: bodyHtml });
      }

      return fetch('/.netlify/functions/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: body
      });
    }).then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.ok) {
          toast(isBulk ? t('leads_email_bulk_sent') + ' (' + (data.results ? data.results.sent : '?') + ')' : t('leads_email_sent'));
          modal.hidden = true;

          if (!isBulk && currentLead) {
            addNoteDirectly('Email sent: ' + subject, 'email');
            loadLeadActivity();
          }
        } else {
          toast(t('leads_email_failed') + ': ' + (data.error || ''), true);
        }
      }).catch(function (err) {
        toast(t('leads_email_failed') + ': ' + err.message, true);
      }).finally(function () {
        if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = t('leads_send_email'); }
      });
  }

  /* helper - add note without prompt */
  function addNoteDirectly(text, type) {
    if (!currentLeadId || !currentLead) return;
    var newNote = {
      text: text,
      timestamp: new Date().toISOString(),
      author: (firebase.auth().currentUser || {}).email || 'admin',
      type: type || 'note'
    };
    var notesArray = [];
    if (typeof currentLead.notes === 'string' && currentLead.notes) {
      notesArray.push({ text: currentLead.notes, timestamp: '', author: '', type: 'note' });
    } else if (Array.isArray(currentLead.notes)) {
      notesArray = currentLead.notes.slice();
    }
    notesArray.push(newNote);

    db.collection('leads').doc(currentLeadId).update({
      notes: notesArray,
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
      currentLead.notes = notesArray;
      var idx = leads.findIndex(function (l) { return l.id === currentLeadId; });
      if (idx !== -1) leads[idx].notes = notesArray;
      renderLeadNotes();
    }).catch(function () { /* silent */ });
  }

  /* ══════════════════════════════════════════
     BULK OPERATIONS
     ══════════════════════════════════════════ */
  function updateBulkBar() {
    var bar = $('yb-lead-bulk-bar');
    if (!bar) return;

    // Bar is always visible in table mode; kanban hides it via renderLeadView
    var hasSelection = selectedIds.size > 0;

    // Selection-only buttons
    bar.querySelectorAll('.yb-lead__bulk-sel-only').forEach(function (btn) {
      btn.hidden = !hasSelection;
    });

    // Count text
    var countEl = $('yb-lead-bulk-count');
    if (countEl) {
      if (hasSelection) {
        var selected = leads.filter(function (l) { return selectedIds.has(l.id); });
        var withPhone = selected.filter(function (l) { return l.phone; }).length;
        var withEmail = selected.filter(function (l) { return l.email; }).length;
        var dbTotal = totalLeadCount !== null ? totalLeadCount : leads.length;
        var notAllLoaded = leads.length < dbTotal;
        countEl.innerHTML = '<strong>' + selectedIds.size + '</strong> ' + t('leads_selected') +
          ' &nbsp;·&nbsp; 📱 ' + withPhone + ' &nbsp;·&nbsp; ✉️ ' + withEmail +
          (notAllLoaded ? ' &nbsp;·&nbsp; <span style="color:var(--yb-muted);font-size:0.8em">(' + leads.length + ' ' + t('leads_loaded') + ' ' + t('leads_of') + ' ' + dbTotal + ')</span>' : '');
        countEl.hidden = false;
      } else {
        countEl.hidden = true;
      }
    }
  }

  function toggleSelectAll() {
    selectAll = !selectAll;
    var filtered = getFilteredLeads();
    if (selectAll) {
      filtered.forEach(function (l) { selectedIds.add(l.id); });
    } else {
      selectedIds.clear();
    }
    renderLeadView();
    updateBulkBar();
  }

  function toggleSelectLead(leadId) {
    if (selectedIds.has(leadId)) {
      selectedIds.delete(leadId);
    } else {
      selectedIds.add(leadId);
    }
    // Update checkbox without full re-render
    var cb = document.querySelector('.yb-lead__cb[data-lead-id="' + leadId + '"]');
    if (cb) {
      cb.checked = selectedIds.has(leadId);
      cb.closest('.yb-lead__row').classList.toggle('is-selected', selectedIds.has(leadId));
    }
    updateBulkBar();
  }

  function bulkUpdateStatus() {
    openBulkStatusPicker(STATUSES, selectedIds.size, function (newStatus) {
      var batch = db.batch();
      var extraFields = {};
      if (newStatus === 'Converted') {
        extraFields.converted = true;
        extraFields.converted_at = firebase.firestore.FieldValue.serverTimestamp();
      }
      selectedIds.forEach(function (id) {
        batch.update(db.collection('leads').doc(id), Object.assign({
          status: newStatus,
          updated_at: firebase.firestore.FieldValue.serverTimestamp()
        }, extraFields));
      });

      batch.commit().then(function () {
        leads.forEach(function (l) {
          if (selectedIds.has(l.id)) l.status = newStatus;
        });
        selectedIds.clear();
        selectAll = false;
        renderLeadView();
        renderLeadStats();
        updateBulkBar();
        toast(t('saved'));
      }).catch(function (err) {
        toast(t('error_save') + ': ' + err.message, true);
      });
    });
  }

  function bulkSMS() {
    if (selectedIds.size > 0) {
      var selected = leads.filter(function (l) { return selectedIds.has(l.id); });
      if (!selected.some(function (l) { return l.phone; })) { toast(t('leads_no_phone'), true); return; }
      if (typeof window.openSMSCampaign === 'function') { window.openSMSCampaign(selected); }
      else { openSMSComposer(selected); }
    } else {
      // No pre-selection: open wizard fresh, admin picks recipients inside
      if (typeof window.openSMSCampaign === 'function') { window.openSMSCampaign([]); }
    }
  }

  function bulkEmail() {
    if (selectedIds.size > 0) {
      var selected = leads.filter(function (l) { return selectedIds.has(l.id); });
      if (!selected.some(function (l) { return l.email; })) { toast(t('leads_no_email_addr'), true); return; }
      if (typeof window.openEmailCampaign === 'function') { window.openEmailCampaign(selected); }
      else { openEmailComposer(selected); }
    } else {
      // No pre-selection: open wizard fresh, admin picks recipients inside
      if (typeof window.openEmailCampaign === 'function') { window.openEmailCampaign([]); }
    }
  }

  function bulkArchive() {
    if (currentUserRole !== 'admin') { toast('Only admins can archive leads.', true); return; }
    var count = selectedIds.size;
    if (!count) return;
    if (!confirm(t('leads_bulk_archive_confirm').replace('{n}', count))) return;

    var user = firebase.auth().currentUser;
    var batch = db.batch();
    selectedIds.forEach(function (id) {
      var lead = leads.find(function (l) { return l.id === id; });
      var ref = db.collection('leads').doc(id);
      batch.update(ref, {
        archived: true,
        archived_at: firebase.firestore.FieldValue.serverTimestamp(),
        archived_by: user ? user.email : 'unknown',
        previous_status: lead ? lead.status : '',
        status: 'Archived'
      });
    });

    batch.commit().then(function () {
      toast(count + ' ' + t('leads_bulk_archived'));
      selectedIds.clear();
      selectAll = false;
      updateBulkBar();
      loadLeads();
    }).catch(function (err) {
      toast(t('error_save') + ': ' + err.message, true);
    });
  }

  /* ══════════════════════════════════════════
     CSV EXPORT
     ══════════════════════════════════════════ */
  function exportCSV() {
    var filtered = getFilteredLeads();
    if (!filtered.length) { toast(t('leads_no_leads'), true); return; }

    var headers = ['Name', 'Email', 'Phone', 'Type', 'Program', 'Status', 'Sub-Status', 'Priority', 'Temperature', 'Channel', 'Source', 'UTM Campaign', 'Landing Page', 'Accommodation', 'City', 'Follow-up', 'Last Contact', 'Call Attempts', 'Created'];
    var rows = filtered.map(function (l) {
      return [
        (l.first_name || '') + ' ' + (l.last_name || ''),
        l.email || '',
        l.phone || '',
        l.type || '',
        l.program || '',
        l.status || '',
        l.sub_status || '',
        l.priority || '',
        l.temperature || '',
        l.channel || '',
        l.source || '',
        l.utm_campaign || '',
        l.landing_page || '',
        l.accommodation || '',
        l.city_country || '',
        fmtDate(l.followup_date),
        fmtDate(l.last_contact),
        (l.call_attempts || 0) + '',
        fmtDate(l.created_at)
      ].map(function (v) { return '"' + (v || '').replace(/"/g, '""') + '"'; }).join(',');
    });

    var csv = headers.join(',') + '\n' + rows.join('\n');
    var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'yoga-bible-leads-' + new Date().toISOString().split('T')[0] + '.csv';
    a.click();
    URL.revokeObjectURL(url);
    toast(t('leads_exported'));
  }

  /* ══════════════════════════════════════════
     SORT
     ══════════════════════════════════════════ */
  function toggleSort(field) {
    if (sortField === field) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortField = field;
      sortDir = field === 'created_at' ? 'desc' : 'asc';
    }

    // Update sort indicators
    $$('.yb-lead__sort-btn').forEach(function (btn) {
      btn.classList.remove('is-active', 'is-asc', 'is-desc');
      if (btn.getAttribute('data-sort') === field) {
        btn.classList.add('is-active', sortDir === 'asc' ? 'is-asc' : 'is-desc');
      }
    });

    loadLeads();
  }

  /* ══════════════════════════════════════════
     SMS prompt (legacy fallback)
     ══════════════════════════════════════════ */
  function promptSendSMS() {
    if (!currentLead || !currentLead.phone) return;
    openSMSComposer();
  }

  /* ══════════════════════════════════════════════
     ═══════════════════════════════════════════
     APPLICATIONS TAB
     ═══════════════════════════════════════════
     ══════════════════════════════════════════════ */

  /* ── Load Applications ── */
  function loadApplications() {
    applications = [];

    db.collection('applications').orderBy('created_at', 'desc').limit(10000).get().then(function (snap) {
      snap.forEach(function (doc) {
        applications.push(Object.assign({ id: doc.id }, doc.data()));
      });

      renderApplicationTable();
      renderApplicationStats();
      populateCohortFilter();
    }).catch(function (err) {
      console.error('[lead-admin] Applications load error:', err);
      toast(t('error_load'), true);
    });
  }

  /* ── Filter applications ── */
  function getFilteredApps() {
    var filtered = applications;
    // Filter archived unless showing archived
    if (!showArchivedApps) {
      filtered = filtered.filter(function (a) { return !a.archived; });
    }
    // Status filter (moved from Firestore query to client-side)
    if (appFilterStatus) {
      filtered = filtered.filter(function (a) { return a.status === appFilterStatus; });
    }
    // Type filter — "ytt" matches both 'ytt' and 'education' (apply.js stores 'education' for YTT)
    if (appFilterType) {
      filtered = filtered.filter(function (a) {
        var pt = (a.program_type || a.type || '').toLowerCase();
        if (appFilterType === 'ytt') return pt === 'ytt' || pt === 'education';
        return pt === appFilterType;
      });
    }
    if (appFilterTrack) {
      filtered = filtered.filter(function (a) {
        var tr = (a.track || '').toLowerCase();
        if (appFilterTrack === 'weekday') return tr.indexOf('hverdag') !== -1 || tr.indexOf('weekday') !== -1;
        if (appFilterTrack === 'weekend') return tr.indexOf('weekend') !== -1;
        return tr === appFilterTrack.toLowerCase();
      });
    }
    if (appFilterCohort) {
      filtered = filtered.filter(function (a) { return (a.cohort_label || a.cohort || '') === appFilterCohort; });
    }
    if (appSearchTerm) {
      var s = appSearchTerm.toLowerCase();
      filtered = filtered.filter(function (a) {
        return (a.email || '').toLowerCase().indexOf(s) !== -1 ||
          (a.first_name || '').toLowerCase().indexOf(s) !== -1 ||
          (a.last_name || '').toLowerCase().indexOf(s) !== -1 ||
          (a.app_id || '').toLowerCase().indexOf(s) !== -1 ||
          (a.program_type || '').toLowerCase().indexOf(s) !== -1 ||
          (a.course_name || '').toLowerCase().indexOf(s) !== -1;
      });
    }
    return filtered;
  }

  /* ── Render Application Table ── */
  function renderApplicationTable() {
    var tbody = $('yb-app-table-body');
    if (!tbody) return;

    var filtered = getFilteredApps();

    var countEl = $('yb-app-count');
    if (countEl) countEl.textContent = filtered.length + ' of ' + applications.length;

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:2rem;color:var(--yb-muted)">' + t('apps_no_apps') + '</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(function (a) {
      var isChecked = selectedAppIds.has(a.id);
      var archivedTag = a.archived ? ' <span class="yb-lead__badge" style="background:#ECEFF1;color:#546E7F">' + t('apps_archived') + '</span>' : '';
      return '<tr class="yb-lead__row' + (isChecked ? ' is-selected' : '') + (a.archived ? ' yb-lead__row--archived' : '') + '" data-app-id="' + a.id + '">' +
        '<td class="yb-lead__cell-cb"><input type="checkbox" class="yb-app-row-cb" data-id="' + a.id + '"' + (isChecked ? ' checked' : '') + '></td>' +
        '<td class="yb-lead__cell-date">' + esc(a.app_id || a.id.substring(0, 8)) + '</td>' +
        '<td class="yb-lead__cell-name">' + esc((a.first_name || '') + ' ' + (a.last_name || '')).trim() + '</td>' +
        '<td class="yb-lead__cell-contact"><div class="yb-lead__cell-email-text">' + esc(a.email || '') + '</div>' + (a.phone ? '<a href="tel:' + esc(a.phone) + '" class="yb-lead__cell-phone-link" onclick="event.stopPropagation()">' + esc(a.phone) + '</a>' : '') + '</td>' +
        '<td><span class="yb-lead__type-badge">' + esc(a.program_type || '\u2014') + '</span></td>' +
        '<td class="yb-lead__cell-program">' + esc((a.course_name || a.cohort || '').substring(0, 30)) + '</td>' +
        '<td>' + esc(displayTrack(a.track)) + '</td>' +
        '<td>' + esc(getPaymentChoiceLabel(a.payment_choice)) + '</td>' +
        '<td>' + appStatusBadgeHtml(a.status) + archivedTag + '</td>' +
        '<td class="yb-lead__cell-date">' + relativeTime(a.created_at) + '</td>' +
        '<td class="yb-lead__cell-actions">' +
          '<button class="yb-admin__icon-btn" data-action="view-app" data-id="' + a.id + '" title="View">\u2192</button>' +
        '</td>' +
      '</tr>';
    }).join('');

    // Update select-all checkbox state
    var selectAllCb = $('yb-app-select-all');
    if (selectAllCb) selectAllCb.checked = selectAllApps && filtered.length > 0;
  }

  /* ── Render Application Stats ── */
  function renderApplicationStats() {
    var el = $('yb-app-stats');
    if (!el) return;

    var nonArchived = applications.filter(function (a) { return !a.archived; });
    var total = nonArchived.length;
    var archivedCount = applications.length - total;
    var counts = {};
    APP_STATUSES.forEach(function (s) { counts[s.value] = 0; });
    var typeCounts = {};
    nonArchived.forEach(function (a) {
      var st = a.status || 'Pending';
      if (counts[st] !== undefined) counts[st]++;
      var pt = a.program_type || 'Other';
      typeCounts[pt] = (typeCounts[pt] || 0) + 1;
    });

    var html =
      '<div class="yb-lead__stat-card yb-lead__stat-card--total">' +
        '<span class="yb-lead__stat-value">' + total + '</span>' +
        '<span class="yb-lead__stat-label">Total</span>' +
      '</div>' +
      '<div class="yb-lead__stat-card yb-lead__stat-card--new">' +
        '<span class="yb-lead__stat-value">' + (counts['Pending'] || 0) + '</span>' +
        '<span class="yb-lead__stat-label">\u23f3 Pending</span>' +
      '</div>' +
      '<div class="yb-lead__stat-card yb-lead__stat-card--converted">' +
        '<span class="yb-lead__stat-value">' + (counts['Approved'] || 0) + '</span>' +
        '<span class="yb-lead__stat-label">\u2705 Approved</span>' +
      '</div>' +
      '<div class="yb-lead__stat-card yb-lead__stat-card--pipeline">' +
        '<span class="yb-lead__stat-value">' + (counts['Enrolled'] || 0) + '</span>' +
        '<span class="yb-lead__stat-label">\ud83c\udf93 Enrolled</span>' +
      '</div>';

    // By program type
    Object.keys(typeCounts).forEach(function (pt) {
      html += '<div class="yb-lead__stat-card">' +
        '<span class="yb-lead__stat-value">' + typeCounts[pt] + '</span>' +
        '<span class="yb-lead__stat-label">' + esc(pt) + '</span>' +
      '</div>';
    });

    if (archivedCount > 0) {
      html += '<div class="yb-lead__stat-card">' +
        '<span class="yb-lead__stat-value">' + archivedCount + '</span>' +
        '<span class="yb-lead__stat-label">\ud83d\udce6 ' + t('apps_archived') + '</span>' +
      '</div>';
    }

    el.innerHTML = html;
  }

  /* ── Show Application Detail ── */
  function showApplicationDetail(appId) {
    currentAppId = appId;
    currentApp = applications.find(function (a) { return a.id === appId; });
    if (!currentApp) return;
    // Expose to billing-admin for "Bill Applicant" action
    window._ybCurrentApp = currentApp;

    var listView = $('yb-admin-v-app-list');
    var detailView = $('yb-admin-v-app-detail');
    if (listView) listView.hidden = true;
    if (detailView) detailView.hidden = false;

    var headingEl = $('yb-app-detail-heading');
    if (headingEl) headingEl.textContent = (currentApp.first_name || '') + ' ' + (currentApp.last_name || '') + ' \u2014 ' + (currentApp.app_id || appId.substring(0, 8));

    renderApplicationDetailCard();
    renderAppInvoiceStatus();
    renderAppQuickActions();
    updateActivateBtn();
    renderAppEditForm();
    renderAppNotesTimeline();
    loadAppSMSConversation(appId);

    // Set status form to current status
    var statusSelect = $('yb-app-status-select');
    if (statusSelect && currentApp) statusSelect.value = currentApp.status || 'Pending';

    // Allow billing-admin to notify us when invoice data changes
    window._ybRefreshAppInvoice = function () {
      if (currentAppId) {
        // Re-read the application to pick up invoice field changes
        db.collection('applications').doc(currentAppId).get().then(function (doc) {
          if (doc.exists) {
            var data = doc.data();
            data.id = doc.id;
            currentApp = data;
            window._ybCurrentApp = currentApp;
            var idx = applications.findIndex(function (a) { return a.id === currentAppId; });
            if (idx !== -1) applications[idx] = currentApp;
            renderAppInvoiceStatus();
          }
        });
      }
    };
  }

  function backToAppList() {
    var listView = $('yb-admin-v-app-list');
    var detailView = $('yb-admin-v-app-detail');
    if (listView) listView.hidden = false;
    if (detailView) detailView.hidden = true;
    currentAppId = null;
    currentApp = null;
    renderApplicationTable();
  }

  /* ── Render Application Detail Card ── */
  function renderApplicationDetailCard() {
    var el = $('yb-app-detail-card');
    if (!el || !currentApp) return;
    var a = currentApp;
    var statusMeta = getAppStatusMeta(a.status);

    var html = '<div class="yb-lead__detail-cards">';

    // Card 1: Personal Info
    html += '<div class="yb-lead__section-card">';
    html += '<h4 class="yb-lead__card-title">PERSONAL INFO</h4>';
    html += '<div class="yb-lead__card-row">' +
      '<span class="yb-lead__card-label">Name</span>' +
      '<span class="yb-lead__card-value">' + esc((a.first_name || '') + ' ' + (a.last_name || '')) + '</span>' +
    '</div>';
    html += '<div class="yb-lead__card-row">' +
      '<span class="yb-lead__card-label">Email</span>' +
      '<a href="mailto:' + esc(a.email) + '" class="yb-lead__card-value yb-lead__card-link">' + esc(a.email || '\u2014') + '</a>' +
    '</div>';
    html += '<div class="yb-lead__card-row">' +
      '<span class="yb-lead__card-label">Phone</span>' +
      (a.phone
        ? '<a href="tel:' + esc(a.phone) + '" class="yb-lead__card-value yb-lead__card-link">' + esc(a.phone) + '</a>'
        : '<span class="yb-lead__card-value">\u2014</span>') +
    '</div>';
    if (a.dob) {
      html += '<div class="yb-lead__card-row">' +
        '<span class="yb-lead__card-label">Date of Birth</span>' +
        '<span class="yb-lead__card-value">' + esc(a.dob) + '</span>' +
      '</div>';
    }
    if (a.city_country) {
      html += '<div class="yb-lead__card-row">' +
        '<span class="yb-lead__card-label">Location</span>' +
        '<span class="yb-lead__card-value">' + esc(a.city_country) + '</span>' +
      '</div>';
    }
    html += '<div class="yb-lead__card-row">' +
      '<span class="yb-lead__card-label">Applied</span>' +
      '<span class="yb-lead__card-value">' + fmtDateTime(a.created_at) + '</span>' +
    '</div>';
    html += '</div>'; // end card 1

    // Card 2: Program
    html += '<div class="yb-lead__section-card">';
    html += '<h4 class="yb-lead__card-title">PROGRAM</h4>';
    html += '<div class="yb-lead__card-row">' +
      '<span class="yb-lead__card-label">Program Type</span>' +
      '<span class="yb-lead__card-value"><span class="yb-lead__type-badge">' + esc(a.program_type || '\u2014') + '</span></span>' +
    '</div>';
    if (a.course_name) {
      html += '<div class="yb-lead__card-row">' +
        '<span class="yb-lead__card-label">Course</span>' +
        '<span class="yb-lead__card-value">' + esc(a.course_name) + '</span>' +
      '</div>';
    }
    if (a.cohort_label || a.cohort) {
      html += '<div class="yb-lead__card-row">' +
        '<span class="yb-lead__card-label">Cohort</span>' +
        '<span class="yb-lead__card-value">' + esc(displayLocalized(a.cohort_label || a.cohort)) + '</span>' +
      '</div>';
    }
    if (a.track) {
      html += '<div class="yb-lead__card-row">' +
        '<span class="yb-lead__card-label">Track</span>' +
        '<span class="yb-lead__card-value">' + esc(displayTrack(a.track)) + '</span>' +
      '</div>';
    }
    if (a.bundle) {
      html += '<div class="yb-lead__card-row">' +
        '<span class="yb-lead__card-label">Bundle</span>' +
        '<span class="yb-lead__card-value">' + esc(a.bundle) + '</span>' +
      '</div>';
    }
    if (a.hear_about) {
      html += '<div class="yb-lead__card-row">' +
        '<span class="yb-lead__card-label">How did you hear?</span>' +
        '<span class="yb-lead__card-value">' + esc(a.hear_about) + '</span>' +
      '</div>';
    }
    if (a.experience) {
      html += '<div class="yb-lead__card-row yb-lead__card-row--full">' +
        '<span class="yb-lead__card-label">Experience</span>' +
        '<div class="yb-lead__detail-message">' + esc(a.experience) + '</div>' +
      '</div>';
    }
    if (a.motivation) {
      html += '<div class="yb-lead__card-row yb-lead__card-row--full">' +
        '<span class="yb-lead__card-label">Motivation</span>' +
        '<div class="yb-lead__detail-message">' + esc(a.motivation) + '</div>' +
      '</div>';
    }
    html += '</div>'; // end card 2

    // Card 3: Payment & Status (full-width)
    html += '<div class="yb-lead__section-card yb-lead__section-card--full">';
    html += '<h4 class="yb-lead__card-title">PAYMENT & STATUS</h4>';
    if (a.payment_choice) {
      html += '<div class="yb-lead__card-row">' +
        '<span class="yb-lead__card-label">Payment Choice</span>' +
        '<span class="yb-lead__card-value">' + esc(getPaymentChoiceLabel(a.payment_choice)) + '</span>' +
      '</div>';
    }
    html += '<div class="yb-lead__card-row">' +
      '<span class="yb-lead__card-label">Status</span>' +
      '<span class="yb-lead__card-value">' +
        '<span class="yb-lead__badge yb-lead__badge--lg" style="background:' + statusMeta.color + ';color:' + statusMeta.text + '">' +
          statusMeta.icon + ' ' + esc(statusMeta.label) +
        '</span>' +
      '</span>' +
    '</div>';

    if (a.app_id) {
      html += '<div class="yb-lead__card-row">' +
        '<span class="yb-lead__card-label">App ID</span>' +
        '<span class="yb-lead__card-value"><code>' + esc(a.app_id) + '</code></span>' +
      '</div>';
    }
    html += '</div>'; // end card 3

    // Card 4: Linked Lead
    html += '<div class="yb-lead__section-card yb-lead__section-card--full">';
    html += '<h4 class="yb-lead__card-title">LINKED LEAD</h4>';
    html += '<div class="yb-lead__card-row">' +
      '<span class="yb-lead__card-label">Lead</span>' +
      '<span class="yb-lead__card-value">' +
        '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="view-linked-lead" data-app-id="' + esc(a.app_id || a.id) + '">\u2190 View Lead</button>' +
      '</span>' +
    '</div>';
    html += '</div>'; // end card 4

    html += '</div>'; // end yb-lead__detail-cards

    el.innerHTML = html;
  }

  /* ── Render Application Invoice Status Card ── */
  function renderAppInvoiceStatus() {
    var el = $('yb-app-invoice-status');
    if (!el || !currentApp) return;

    var inv = currentApp.invoice;
    var appRef = currentApp.app_id || currentAppId;

    // No invoice data yet — show empty state with lookup button
    if (!inv) {
      el.innerHTML = '<div class="yb-lead__section-card yb-lead__section-card--full yb-app-invoice">' +
        '<h4 class="yb-lead__card-title">' + t('invoice_title') + '</h4>' +
        '<p class="yb-lead__empty-text" style="margin:0 0 0.75rem">' + t('invoice_none') + '</p>' +
        '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="app-invoice-lookup" data-ref="' + esc(appRef) + '">' +
          '\ud83d\udd0d ' + t('invoice_lookup') +
        '</button>' +
      '</div>';
      return;
    }

    // Invoice exists — render status card
    var statusLabel, statusClass, statusIcon;
    switch (inv.status) {
      case 'sent':
        statusLabel = t('invoice_status_sent');
        statusClass = 'yb-app-invoice__badge--sent';
        statusIcon = '\u2709\ufe0f';
        break;
      case 'booked':
        statusLabel = t('invoice_status_booked');
        statusClass = 'yb-app-invoice__badge--booked';
        statusIcon = '\u2705';
        break;
      default:
        statusLabel = t('invoice_status_draft');
        statusClass = 'yb-app-invoice__badge--draft';
        statusIcon = '\ud83d\udcdd';
    }

    var html = '<div class="yb-lead__section-card yb-lead__section-card--full yb-app-invoice">';
    html += '<div class="yb-app-invoice__header">';
    html += '<h4 class="yb-lead__card-title" style="margin:0">' + t('invoice_title') + '</h4>';
    html += '<span class="yb-app-invoice__badge ' + statusClass + '">' + statusIcon + ' ' + esc(statusLabel) + '</span>';
    html += '</div>';

    // Details rows
    if (inv.bookedNumber) {
      html += '<div class="yb-lead__card-row"><span class="yb-lead__card-label">' + t('invoice_number') + '</span><span class="yb-lead__card-value"><strong>#' + esc(String(inv.bookedNumber)) + '</strong></span></div>';
    } else if (inv.draftNumber) {
      html += '<div class="yb-lead__card-row"><span class="yb-lead__card-label">' + t('invoice_number') + '</span><span class="yb-lead__card-value">' + (isDa ? 'Kladde' : 'Draft') + ' #' + esc(String(inv.draftNumber)) + '</span></div>';
    }
    if (inv.amount) {
      html += '<div class="yb-lead__card-row"><span class="yb-lead__card-label">' + t('invoice_amount') + '</span><span class="yb-lead__card-value">' + formatDKK(inv.amount) + '</span></div>';
    }
    if (inv.date) {
      html += '<div class="yb-lead__card-row"><span class="yb-lead__card-label">' + t('invoice_date') + '</span><span class="yb-lead__card-value">' + esc(inv.date) + '</span></div>';
    }
    if (inv.dueDate) {
      html += '<div class="yb-lead__card-row"><span class="yb-lead__card-label">' + t('invoice_due') + '</span><span class="yb-lead__card-value">' + esc(inv.dueDate) + '</span></div>';
    }
    if (inv.remainder != null) {
      html += '<div class="yb-lead__card-row"><span class="yb-lead__card-label">' + t('invoice_remainder') + '</span><span class="yb-lead__card-value">' + formatDKK(inv.remainder) + '</span></div>';
    }
    if (inv.sentTo) {
      html += '<div class="yb-lead__card-row"><span class="yb-lead__card-label">' + t('invoice_sent_to') + '</span><span class="yb-lead__card-value">' + esc(inv.sentTo) + '</span></div>';
    }
    if (inv.sentAt) {
      html += '<div class="yb-lead__card-row"><span class="yb-lead__card-label">' + t('invoice_last_sent') + '</span><span class="yb-lead__card-value">' + formatSentDate(inv.sentAt) + '</span></div>';
    }

    // Manual payment status
    var payStatus = inv.paymentStatus || 'pending';
    html += '<div class="yb-lead__card-row" style="margin-top:0.5rem">';
    html += '<span class="yb-lead__card-label">' + t('invoice_payment_status') + '</span>';
    html += '<span class="yb-lead__card-value">';
    html += '<select id="yb-app-invoice-payment-status" class="yb-admin__select" style="max-width:160px;font-size:0.8rem" data-action="app-invoice-payment-status">';
    html += '<option value="pending"' + (payStatus === 'pending' ? ' selected' : '') + '>' + t('invoice_pay_pending') + '</option>';
    html += '<option value="paid"' + (payStatus === 'paid' ? ' selected' : '') + '>' + t('invoice_pay_paid') + '</option>';
    html += '<option value="unpaid"' + (payStatus === 'unpaid' ? ' selected' : '') + '>' + t('invoice_pay_unpaid') + '</option>';
    html += '<option value="partial"' + (payStatus === 'partial' ? ' selected' : '') + '>' + t('invoice_pay_partial') + '</option>';
    html += '</select>';
    html += '</span></div>';

    // Action buttons
    html += '<div class="yb-app-invoice__actions">';
    if (inv.bookedNumber) {
      html += '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="app-invoice-view" data-booked="' + inv.bookedNumber + '">\ud83d\udc41 ' + t('invoice_quick_view') + '</button>';
      html += '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="app-invoice-pdf" data-booked="' + inv.bookedNumber + '">\ud83d\udcc4 ' + t('invoice_download') + '</button>';
      html += '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="app-invoice-resend" data-booked="' + inv.bookedNumber + '" data-email="' + esc(inv.sentTo || currentApp.email || '') + '">\ud83d\udce8 ' + t('invoice_resend') + '</button>';
      html += '<button class="yb-btn yb-btn--outline yb-btn--sm yb-admin__icon-btn--danger" data-action="app-invoice-credit" data-booked="' + inv.bookedNumber + '">\u21ba ' + t('billing_credit_note') + '</button>';
    }
    if (inv.draftNumber && !inv.bookedNumber) {
      html += '<button class="yb-btn yb-btn--outline yb-btn--sm yb-admin__icon-btn--danger" data-action="app-invoice-delete-draft" data-draft="' + inv.draftNumber + '">\ud83d\uddd1 ' + t('billing_delete_draft') + '</button>';
    }
    html += '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="app-invoice-refresh" data-ref="' + esc(appRef) + '">\u21bb ' + t('invoice_refresh') + '</button>';
    html += '</div>';

    html += '</div>';
    el.innerHTML = html;
  }

  function formatDKK(amount) {
    return Number(amount).toLocaleString('da-DK') + ' DKK';
  }

  function formatSentDate(isoStr) {
    if (!isoStr) return '\u2014';
    var d = new Date(isoStr);
    if (isNaN(d.getTime())) return esc(isoStr);
    var dd = String(d.getDate()).padStart(2, '0');
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var yyyy = d.getFullYear();
    var hh = String(d.getHours()).padStart(2, '0');
    var min = String(d.getMinutes()).padStart(2, '0');
    return dd + '/' + mm + '/' + yyyy + ' ' + hh + ':' + min;
  }

  /* ── Invoice Actions from Application Profile ── */
  /**
   * Look up invoices by customer email.
   * Strategy: search e-conomic customers by email → then searchInvoicesByCustomer
   * Falls back to searchInvoicesByRef if email yields nothing.
   */
  function appInvoiceLookup(refText) {
    var btn = document.querySelector('[data-action="app-invoice-lookup"]');
    if (btn) { btn.textContent = '\ud83d\udd0d ' + t('invoice_looking_up'); btn.classList.add('yb-btn--muted'); }

    var email = currentApp ? (currentApp.email || '') : '';

    function resetBtn() {
      if (btn) { btn.textContent = '\ud83d\udd0d ' + t('invoice_lookup'); btn.classList.remove('yb-btn--muted'); }
    }

    function handleInvoiceResults(data) {
      var bookedList = data.booked || [];
      var draftList = data.drafts || [];

      if (!bookedList.length && !draftList.length) {
        toast(t('invoice_not_found'));
        return;
      }

      // Pick the most recent invoice (prefer booked over draft)
      if (bookedList.length) {
        var inv = bookedList[0];
        saveAppInvoiceData({
          bookedNumber: inv.bookedInvoiceNumber,
          status: 'booked',
          amount: inv.grossAmount || inv.netAmount || 0,
          date: inv.date || '',
          dueDate: inv.dueDate || '',
          remainder: inv.remainder,
          createdAt: new Date().toISOString()
        });
      } else {
        var inv = draftList[0];
        saveAppInvoiceData({
          draftNumber: inv.draftInvoiceNumber,
          status: 'draft',
          amount: inv.grossAmount || inv.netAmount || 0,
          date: inv.date || '',
          createdAt: new Date().toISOString()
        });
      }
    }

    // Primary: search by customer email
    if (email) {
      billingApiCall({ action: 'searchCustomers', query: email }).then(function (custRes) {
        if (!custRes.ok || !custRes.data || !custRes.data.length) {
          // No e-conomic customer found — fallback to ref search
          return fallbackRefSearch();
        }
        // Find exact email match
        var match = custRes.data.find(function (c) { return c.email && c.email.toLowerCase() === email.toLowerCase(); });
        if (!match) match = custRes.data[0]; // use closest match

        // Search invoices by customer number
        return billingApiCall({ action: 'searchInvoicesByCustomer', customerNumber: match.customerNumber }).then(function (invRes) {
          resetBtn();
          if (!invRes.ok) { toast(invRes.error, true); return; }
          handleInvoiceResults(invRes.data);
        });
      }).catch(function (err) {
        resetBtn();
        toast(err.message, true);
      });
    } else {
      // No email — try ref search directly
      fallbackRefSearch();
    }

    function fallbackRefSearch() {
      if (!refText) { resetBtn(); toast(t('invoice_not_found')); return; }
      billingApiCall({ action: 'searchInvoicesByRef', refText: refText }).then(function (res) {
        resetBtn();
        if (!res.ok) { toast(res.error, true); return; }
        handleInvoiceResults(res.data);
      }).catch(function (err) { resetBtn(); toast(err.message, true); });
    }
  }

  function appInvoiceRefresh(refText) {
    var btn = document.querySelector('[data-action="app-invoice-refresh"]');
    if (btn) { btn.textContent = '\u21bb ' + t('invoice_refreshing'); btn.classList.add('yb-btn--muted'); }

    var inv = currentApp && currentApp.invoice;
    if (!inv || !inv.bookedNumber) {
      // No booked number — try lookup
      appInvoiceLookup(refText);
      if (btn) { btn.textContent = '\u21bb ' + t('invoice_refresh'); btn.classList.remove('yb-btn--muted'); }
      return;
    }

    // Fetch latest data from e-conomic for the booked invoice
    billingApiCall({ action: 'getBooked', bookedNumber: inv.bookedNumber }).then(function (res) {
      if (btn) { btn.textContent = '\u21bb ' + t('invoice_refresh'); btn.classList.remove('yb-btn--muted'); }
      if (!res.ok) { toast(res.error, true); return; }
      var d = res.data;
      var update = {
        bookedNumber: d.bookedInvoiceNumber,
        status: inv.status || 'booked',
        amount: d.grossAmount || d.netAmount || 0,
        date: d.date || inv.date,
        dueDate: d.dueDate || '',
        remainder: d.remainder
      };
      if (inv.sentAt) update.sentAt = inv.sentAt;
      if (inv.sentTo) update.sentTo = inv.sentTo;
      saveAppInvoiceData(update);
      toast(isDa ? 'Fakturastatus opdateret' : 'Invoice status updated');
    }).catch(function (err) {
      if (btn) { btn.textContent = '\u21bb ' + t('invoice_refresh'); btn.classList.remove('yb-btn--muted'); }
      toast(err.message, true);
    });
  }

  function saveAppPaymentStatus(status) {
    if (!currentApp || !currentApp.invoice) return;
    currentApp.invoice.paymentStatus = status;
    saveAppInvoiceData({ paymentStatus: status });
    toast(isDa ? 'Betalingsstatus gemt' : 'Payment status saved');
  }

  function appInvoiceQuickView(bookedNumber) {
    var btn = document.querySelector('[data-action="app-invoice-view"]');
    if (btn) { btn.textContent = '\ud83d\udc41 ...'; btn.classList.add('yb-btn--muted'); }

    billingApiCall({ action: 'getBooked', bookedNumber: parseInt(bookedNumber) }).then(function (res) {
      if (btn) { btn.textContent = '\ud83d\udc41 ' + t('invoice_quick_view'); btn.classList.remove('yb-btn--muted'); }
      if (!res.ok) { toast(res.error, true); return; }
      var d = res.data;
      showInvoiceQuickViewModal(d);
    }).catch(function (err) {
      if (btn) { btn.textContent = '\ud83d\udc41 ' + t('invoice_quick_view'); btn.classList.remove('yb-btn--muted'); }
      toast(err.message, true);
    });
  }

  function showInvoiceQuickViewModal(d) {
    // Re-use the billing modal if available, or create an inline overlay
    var modal = $('yb-app-invoice-modal');
    if (!modal) return;
    var body = $('yb-app-invoice-modal-body');
    var title = $('yb-app-invoice-modal-title');
    if (title) title.textContent = (isDa ? 'Faktura' : 'Invoice') + ' #' + (d.bookedInvoiceNumber || '');

    var html = '<div class="yb-billing__detail">';
    html += '<div class="yb-billing__detail-row"><strong>' + (isDa ? 'Kunde' : 'Customer') + ':</strong> ' + esc(d.recipient && d.recipient.name || '\u2014') + '</div>';
    html += '<div class="yb-billing__detail-row"><strong>' + (isDa ? 'Dato' : 'Date') + ':</strong> ' + (d.date || '\u2014') + '</div>';
    html += '<div class="yb-billing__detail-row"><strong>' + (isDa ? 'Forfaldsdato' : 'Due Date') + ':</strong> ' + (d.dueDate || '\u2014') + '</div>';
    html += '<div class="yb-billing__detail-row"><strong>' + (isDa ? 'Total' : 'Total') + ':</strong> ' + (d.grossAmount != null ? formatDKK(d.grossAmount) : formatDKK(d.netAmount || 0)) + '</div>';
    if (d.remainder != null) {
      var isPaid = d.remainder === 0;
      html += '<div class="yb-billing__detail-row"><strong>' + t('invoice_remainder') + ':</strong> ' + formatDKK(d.remainder) + ' <span style="color:' + (isPaid ? '#16a34a' : '#dc2626') + ';font-weight:600">' + (isPaid ? (isDa ? 'Betalt' : 'Paid') : (isDa ? 'Ikke betalt' : 'Unpaid')) + '</span></div>';
    }
    if (d.lines && d.lines.length) {
      html += '<table class="yb-billing__preview-table"><thead><tr><th>#</th><th>' + (isDa ? 'Beskrivelse' : 'Description') + '</th><th>' + (isDa ? 'Beløb' : 'Amount') + '</th></tr></thead><tbody>';
      d.lines.forEach(function (line, i) {
        html += '<tr><td>' + (i + 1) + '</td><td>' + esc(line.description) + '</td><td>' + formatDKK(line.totalNetAmount || line.unitNetPrice || 0) + '</td></tr>';
      });
      html += '</tbody></table>';
    }
    html += '</div>';
    body.innerHTML = html;
    modal.hidden = false;
    positionModalInIframe(modal);
  }

  function appInvoiceDownloadPdf(bookedNumber) {
    var btn = document.querySelector('[data-action="app-invoice-pdf"]');
    if (btn) { btn.textContent = '\ud83d\udcc4 ...'; btn.classList.add('yb-btn--muted'); }

    billingApiCall({ action: 'getInvoicePdf', bookedNumber: parseInt(bookedNumber) }).then(function (res) {
      if (btn) { btn.textContent = '\ud83d\udcc4 ' + t('invoice_download'); btn.classList.remove('yb-btn--muted'); }
      if (!res.ok) { toast(res.error, true); return; }
      if (res.data && res.data.base64) {
        var byteChars = atob(res.data.base64);
        var byteNums = new Array(byteChars.length);
        for (var i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
        var blob = new Blob([new Uint8Array(byteNums)], { type: 'application/pdf' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = res.data.filename || ('Faktura-' + bookedNumber + '.pdf');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast(isDa ? 'PDF downloadet' : 'PDF downloaded');
      } else {
        toast(isDa ? 'Kunne ikke hente PDF' : 'Could not get PDF', true);
      }
    }).catch(function (err) {
      if (btn) { btn.textContent = '\ud83d\udcc4 ' + t('invoice_download'); btn.classList.remove('yb-btn--muted'); }
      toast(err.message, true);
    });
  }

  function appInvoiceResend(bookedNumber, email) {
    var currentEmail = email || (currentApp && currentApp.email) || '';
    var inputEmail = prompt(t('invoice_resend_confirm'), currentEmail);
    if (!inputEmail) return;
    inputEmail = inputEmail.trim();
    if (!inputEmail || inputEmail.indexOf('@') < 1) {
      toast(isDa ? 'Ugyldig email-adresse' : 'Invalid email address', true);
      return;
    }

    var btn = document.querySelector('[data-action="app-invoice-resend"]');
    if (btn) { btn.textContent = '\ud83d\udce8 ...'; btn.classList.add('yb-btn--muted'); }

    billingApiCall({ action: 'sendInvoice', bookedNumber: parseInt(bookedNumber), email: inputEmail }).then(function (res) {
      if (btn) { btn.textContent = '\ud83d\udce8 ' + t('invoice_resend'); btn.classList.remove('yb-btn--muted'); }
      if (!res.ok) { toast(res.error, true); return; }
      // Update sent tracking on the application doc
      saveAppInvoiceData({
        bookedNumber: parseInt(bookedNumber),
        status: 'sent',
        sentAt: new Date().toISOString(),
        sentTo: inputEmail
      });
      toast(t('invoice_resent'));
    }).catch(function (err) {
      if (btn) { btn.textContent = '\ud83d\udce8 ' + t('invoice_resend'); btn.classList.remove('yb-btn--muted'); }
      toast(err.message, true);
    });
  }

  function appInvoiceCreditNote(bookedNumber) {
    var choice = prompt(isDa
      ? 'Kreditnota for faktura #' + bookedNumber + ':\n\nIndtast beløb at kreditere, eller tryk OK for fuld kreditnota.\n(Lad feltet stå tomt for fuld kreditnota)'
      : 'Credit note for invoice #' + bookedNumber + ':\n\nEnter amount to credit, or press OK for full credit note.\n(Leave empty for full credit note)',
      '');
    if (choice === null) return;

    var payload = { action: 'createCreditNote', bookedNumber: parseInt(bookedNumber) };

    if (choice.trim()) {
      var amount = parseFloat(choice.replace(/[^0-9.,\-]/g, '').replace(',', '.'));
      if (isNaN(amount) || amount === 0) { toast(isDa ? 'Ugyldigt beløb' : 'Invalid amount', true); return; }
      if (amount > 0) amount = -amount;

      var desc = prompt(isDa ? 'Beskrivelse for kreditlinjen:' : 'Description for credit line:',
        isDa ? 'Kreditnota — faktura #' + bookedNumber : 'Credit note — invoice #' + bookedNumber);
      if (!desc) return;

      payload.lines = [{ description: desc, unitNetPrice: amount, quantity: 1 }];
    }

    if (!confirm(isDa
      ? 'Opretter kreditnota for faktura #' + bookedNumber + '. Fortsæt?'
      : 'Create credit note for invoice #' + bookedNumber + '. Continue?')) return;

    var creditBtn = document.querySelector('[data-action="app-invoice-credit"]');
    if (creditBtn) { creditBtn.textContent = '\u21ba ...'; creditBtn.classList.add('yb-btn--muted'); }

    billingApiCall(payload).then(function (res) {
      if (creditBtn) { creditBtn.textContent = '\u21ba ' + t('billing_credit_note'); creditBtn.classList.remove('yb-btn--muted'); }
      if (!res.ok) { toast(res.error, true); return; }
      var data = res.data;
      toast(isDa
        ? 'Kreditnota oprettet' + (data.booked ? ' & bogført (#' + data.booked + ')' : '')
        : 'Credit note created' + (data.booked ? ' & booked (#' + data.booked + ')' : ''));
    }).catch(function (err) {
      if (creditBtn) { creditBtn.textContent = '\u21ba ' + t('billing_credit_note'); creditBtn.classList.remove('yb-btn--muted'); }
      toast(err.message, true);
    });
  }

  function appInvoiceDeleteDraft(draftNumber) {
    if (!confirm(isDa
      ? 'Slet kladde #' + draftNumber + '? Denne handling kan ikke fortrydes.'
      : 'Delete draft #' + draftNumber + '? This cannot be undone.')) return;

    var deleteBtn = document.querySelector('[data-action="app-invoice-delete-draft"]');
    if (deleteBtn) { deleteBtn.textContent = '\ud83d\uddd1 ...'; deleteBtn.classList.add('yb-btn--muted'); }

    billingApiCall({ action: 'deleteDraft', draftNumber: parseInt(draftNumber) }).then(function (res) {
      if (deleteBtn) { deleteBtn.textContent = '\ud83d\uddd1 ' + t('billing_delete_draft'); deleteBtn.classList.remove('yb-btn--muted'); }
      if (!res.ok) { toast(res.error, true); return; }
      toast(isDa ? 'Kladde slettet' : 'Draft deleted');
      // Clear invoice data from app
      saveAppInvoiceData(null);
    }).catch(function (err) {
      if (deleteBtn) { deleteBtn.textContent = '\ud83d\uddd1 ' + t('billing_delete_draft'); deleteBtn.classList.remove('yb-btn--muted'); }
      toast(err.message, true);
    });
  }

  /** Save invoice metadata to Firestore application doc and re-render.
   *  Pass null to clear the invoice field (e.g. after deleting a draft). */
  function saveAppInvoiceData(invoiceData) {
    if (!currentAppId) return;

    var merged;
    if (invoiceData === null) {
      // Clear invoice data
      merged = firebase.firestore.FieldValue.delete();
    } else {
      // Merge with existing invoice data
      var existing = (currentApp && currentApp.invoice) || {};
      merged = {};
      Object.keys(existing).forEach(function (k) { merged[k] = existing[k]; });
      Object.keys(invoiceData).forEach(function (k) { merged[k] = invoiceData[k]; });
    }

    db.collection('applications').doc(currentAppId).update({
      invoice: merged,
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
      if (invoiceData === null) {
        delete currentApp.invoice;
        var idx = applications.findIndex(function (a) { return a.id === currentAppId; });
        if (idx !== -1) delete applications[idx].invoice;
      } else {
        currentApp.invoice = merged;
        var idx = applications.findIndex(function (a) { return a.id === currentAppId; });
        if (idx !== -1) applications[idx].invoice = merged;
      }
      renderAppInvoiceStatus();
    }).catch(function (err) {
      console.error('[lead-admin] Save invoice data error:', err);
    });
  }

  /** Proxy to billing API (same endpoint) */
  function billingApiCall(body) {
    if (!window.firebase || !firebase.auth || !firebase.auth().currentUser) {
      return Promise.reject(new Error('Not signed in'));
    }
    return firebase.auth().currentUser.getIdToken().then(function (token) {
      return fetch('/.netlify/functions/economic-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(body)
      });
    }).then(function (res) {
      return res.text().then(function (text) {
        try { return JSON.parse(text); }
        catch (e) { return { ok: false, error: 'Server error (' + res.status + ')' }; }
      });
    });
  }

  /* ── Update Application Status ── */
  function updateAppStatus() {
    if (!currentAppId || !currentApp) return;

    var select = $('yb-app-status-select');
    if (!select) return;

    var newStatus = select.value;
    if (newStatus === currentApp.status) return;

    var formEl = $('yb-app-status-form');
    var btn = saveBtnStart(formEl);

    db.collection('applications').doc(currentAppId).update({
      status: newStatus,
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
      currentApp.status = newStatus;
      var idx = applications.findIndex(function (a) { return a.id === currentAppId; });
      if (idx !== -1) applications[idx].status = newStatus;

      renderApplicationDetailCard();
      renderApplicationStats();
      saveBtnSuccess(btn);
      toast(t('saved'));
    }).catch(function (err) {
      console.error('[lead-admin] App status update error:', err);
      saveBtnError(btn);
      toast(t('error_save'), true);
    });
  }

  /* ══════════════════════════════════════════
     APPLICATION — QUICK ACTIONS
     ══════════════════════════════════════════ */

  function renderAppQuickActions() {
    var el = $('yb-app-actions');
    if (!el || !currentApp) return;

    var a = currentApp;
    var isApprovedOrEnrolled = a.status === 'Approved' || a.status === 'Enrolled';
    var acceptanceSent = a.acceptance_email_sent;

    var html = '';
    html += '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="app-send-email" data-id="' + a.id + '">\u2709\ufe0f ' + t('apps_send_email') + '</button> ';
    html += '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="app-send-sms" data-id="' + a.id + '">\ud83d\udcf1 ' + t('apps_send_sms') + '</button> ';

    if (isApprovedOrEnrolled) {
      if (acceptanceSent) {
        html += '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="app-send-acceptance" data-id="' + a.id + '" style="opacity:0.6">\u2705 ' + t('apps_acceptance_already_sent') + '</button> ';
      } else {
        html += '<button class="yb-btn yb-btn--primary yb-btn--sm" data-action="app-send-acceptance" data-id="' + a.id + '">\ud83c\udf89 ' + t('apps_send_acceptance') + '</button> ';
      }
    }

    if (a.archived) {
      html += '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="app-restore" data-id="' + a.id + '">\u21a9\ufe0f ' + t('apps_restore') + '</button>';
    } else {
      html += '<button class="yb-btn yb-btn--outline yb-btn--sm yb-admin__icon-btn--danger" data-action="app-archive" data-id="' + a.id + '">\ud83d\uddd1 ' + t('apps_bulk_archive') + '</button>';
    }

    el.innerHTML = html;
  }

  /* ══════════════════════════════════════════
     APPLICATION — EDIT FIELDS FORM
     ══════════════════════════════════════════ */

  function renderAppEditForm() {
    if (!currentApp) return;
    var a = currentApp;
    var el;
    el = $('yb-app-edit-first-name'); if (el) el.value = a.first_name || '';
    el = $('yb-app-edit-last-name'); if (el) el.value = a.last_name || '';
    el = $('yb-app-edit-email'); if (el) el.value = a.email || '';
    el = $('yb-app-edit-phone'); if (el) el.value = a.phone || '';
    el = $('yb-app-edit-program-type'); if (el) el.value = a.program_type || '';
    el = $('yb-app-edit-track'); if (el) el.value = a.track || '';

    // Populate course and cohort dropdowns from catalog
    populateCourseDropdown(a.program_type || a.type || '', a.course_name || '');
    populateCohortDropdown(a.program_type || a.type || '', a.course_name || '', a.cohort_label || a.cohort || '');
  }

  function populateCourseDropdown(programType, currentValue) {
    var sel = $('yb-app-edit-course-name');
    if (!sel) return;
    var courses = COURSE_CATALOG[programType] || [];
    var html = '<option value="">---</option>';
    var matched = false;
    courses.forEach(function (c) {
      var displayName = catalogName(c);
      // Match against both DA and EN names (stored value could be either)
      var isMatch = (currentValue === c.name_da || currentValue === c.name_en);
      if (isMatch) matched = true;
      html += '<option value="' + esc(displayName) + '" data-course-id="' + c.id + '"' + (isMatch ? ' selected' : '') + '>' + esc(displayName) + '</option>';
    });
    // Preserve non-catalog values with a "(custom)" fallback
    if (currentValue && !matched) {
      html += '<option value="' + esc(currentValue) + '" selected>' + esc(currentValue) + ' (custom)</option>';
    }
    sel.innerHTML = html;
  }

  function populateCohortDropdown(programType, courseName, currentValue) {
    var sel = $('yb-app-edit-cohort-label');
    if (!sel) return;
    var courses = COURSE_CATALOG[programType] || [];
    // Match course against both DA and EN names
    var course = courses.find(function (c) { return c.name_da === courseName || c.name_en === courseName || catalogName(c) === courseName; });
    var cohorts = course ? course.cohorts : [];
    var html = '<option value="">---</option>';
    var matched = false;
    cohorts.forEach(function (co) {
      var displayLabel = cohortLabel(co);
      // Match against both DA and EN labels
      var isMatch = (currentValue === co.label_da || currentValue === co.label_en);
      if (isMatch) matched = true;
      html += '<option value="' + esc(displayLabel) + '"' + (isMatch ? ' selected' : '') + '>' + esc(displayLabel) + '</option>';
    });
    // Preserve non-catalog values
    if (currentValue && !matched) {
      html += '<option value="' + esc(currentValue) + '" selected>' + esc(currentValue) + ' (custom)</option>';
    }
    sel.innerHTML = html;
  }

  function populateCohortFilter() {
    var sel = $('yb-app-cohort-filter');
    if (!sel) return;
    var seen = {};
    var html = '<option value="">' + t('apps_all_cohorts') + '</option>';
    applications.forEach(function (a) {
      var cl = a.cohort_label || a.cohort || '';
      if (cl && !seen[cl]) {
        seen[cl] = true;
        html += '<option value="' + esc(cl) + '">' + esc(displayLocalized(cl)) + '</option>';
      }
    });
    sel.innerHTML = html;
  }

  function saveAppFields() {
    if (!currentAppId || !currentApp) return;

    var formEl = $('yb-app-edit-form');
    var btn = saveBtnStart(formEl);

    var updates = {};
    var fields = [
      { id: 'yb-app-edit-first-name', key: 'first_name' },
      { id: 'yb-app-edit-last-name', key: 'last_name' },
      { id: 'yb-app-edit-email', key: 'email' },
      { id: 'yb-app-edit-phone', key: 'phone' },
      { id: 'yb-app-edit-program-type', key: 'program_type' },
      { id: 'yb-app-edit-track', key: 'track' },
      { id: 'yb-app-edit-course-name', key: 'course_name' },
      { id: 'yb-app-edit-cohort-label', key: 'cohort_label' }
    ];

    fields.forEach(function (f) {
      var el = $(f.id);
      if (el) updates[f.key] = el.value.trim();
    });

    updates.updated_at = firebase.firestore.FieldValue.serverTimestamp();

    db.collection('applications').doc(currentAppId).update(updates).then(function () {
      // Update local cache
      Object.keys(updates).forEach(function (k) {
        if (k !== 'updated_at') currentApp[k] = updates[k];
      });
      var idx = applications.findIndex(function (a) { return a.id === currentAppId; });
      if (idx !== -1) Object.assign(applications[idx], currentApp);

      renderApplicationDetailCard();
      renderAppQuickActions();
      saveBtnSuccess(btn);
      toast(t('apps_fields_saved'));
    }).catch(function (err) {
      console.error('[lead-admin] App fields save error:', err);
      saveBtnError(btn);
      toast(t('error_save'), true);
    });
  }

  /* ══════════════════════════════════════════
     APPLICATION — SMS CONVERSATION
     ══════════════════════════════════════════ */

  function loadAppSMSConversation(appId) {
    var el = $('yb-app-sms-conversation');
    if (!el) return;

    db.collection('applications').doc(appId).collection('sms_messages')
      .orderBy('timestamp', 'asc').get().then(function (snap) {
        if (snap.empty) {
          el.innerHTML = '<p class="yb-lead__empty-text">' + t('apps_no_messages') + '</p>' +
            renderAppSMSReplyInput(appId);
          return;
        }

        var html = '<div class="yb-lead__sms-thread">';
        snap.forEach(function (doc) {
          var msg = doc.data();
          var dir = msg.direction === 'outbound' ? 'out' : 'in';
          var time = msg.timestamp ? new Date(msg.timestamp.seconds ? msg.timestamp.seconds * 1000 : msg.timestamp).toLocaleString() : '';
          html += '<div class="yb-lead__sms-bubble yb-lead__sms-bubble--' + dir + '">' +
            '<div class="yb-lead__sms-text">' + esc(msg.message || msg.body || '') + '</div>' +
            '<div class="yb-lead__sms-time">' + time + '</div>' +
          '</div>';
        });
        html += '</div>';
        html += renderAppSMSReplyInput(appId);
        el.innerHTML = html;
      }).catch(function (err) {
        console.error('[lead-admin] App SMS load error:', err);
        el.innerHTML = '<p class="yb-lead__empty-text">Error loading messages.</p>' +
          renderAppSMSReplyInput(appId);
      });
  }

  function renderAppSMSReplyInput(appId) {
    return '<div class="yb-lead__sms-reply" style="margin-top:0.75rem;">' +
      '<input type="text" id="yb-app-sms-reply-input" class="yb-lead__sms-reply-input" placeholder="' + t('apps_sms_reply_placeholder') + '">' +
      '<button class="yb-btn yb-btn--primary yb-btn--sm" data-action="app-sms-reply" data-id="' + appId + '">Send</button>' +
    '</div>';
  }

  function sendAppSMSReply() {
    if (!currentAppId || !currentApp) return;

    var input = $('yb-app-sms-reply-input');
    if (!input) return;

    var message = input.value.trim();
    if (!message) return;

    input.disabled = true;

    getAuthToken().then(function (token) {
      return fetch('/.netlify/functions/send-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ applicationId: currentAppId, message: message })
      });
    }).then(function (res) { return res.json(); })
    .then(function (data) {
      input.disabled = false;
      if (data.ok) {
        input.value = '';
        loadAppSMSConversation(currentAppId);
        toast('SMS sent!');
      } else {
        toast('SMS failed: ' + (data.error || 'Unknown error'), true);
      }
    }).catch(function (err) {
      input.disabled = false;
      console.error('[lead-admin] App SMS reply error:', err);
      toast('SMS failed', true);
    });
  }

  /* ══════════════════════════════════════════
     APPLICATION — SEND EMAIL (Single)
     ══════════════════════════════════════════ */

  function sendAppEmailPrompt() {
    if (!currentApp || !currentApp.email) {
      toast('No email address', true);
      return;
    }

    var subject = prompt('Email subject:', '');
    if (!subject) return;

    var body = prompt('Email body (HTML or plain text):', '');
    if (!body) return;

    getAuthToken().then(function (token) {
      return fetch('/.netlify/functions/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({
          applicationId: currentAppId,
          subject: subject,
          bodyHtml: '<p>' + body.replace(/\n/g, '<br>') + '</p>',
          bodyPlain: body
        })
      });
    }).then(function (res) { return res.json(); })
    .then(function (data) {
      if (data.ok) {
        toast('Email sent!');
      } else {
        toast('Email failed: ' + (data.error || 'Unknown error'), true);
      }
    }).catch(function (err) {
      console.error('[lead-admin] App email error:', err);
      toast('Email failed', true);
    });
  }

  /* ══════════════════════════════════════════
     APPLICATION — SEND ACCEPTANCE EMAIL
     ══════════════════════════════════════════ */

  function sendAcceptanceEmail() {
    if (!currentAppId || !currentApp) return;

    if (!confirm(t('apps_acceptance_confirm'))) return;

    getAuthToken().then(function (token) {
      return fetch('/.netlify/functions/send-acceptance-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ applicationId: currentAppId })
      });
    }).then(function (res) { return res.json(); })
    .then(function (data) {
      if (data.ok) {
        currentApp.acceptance_email_sent = true;
        if (data.firebaseUid) currentApp.firebase_uid = data.firebaseUid;
        var idx = applications.findIndex(function (a) { return a.id === currentAppId; });
        if (idx !== -1) {
          applications[idx].acceptance_email_sent = true;
          if (data.firebaseUid) applications[idx].firebase_uid = data.firebaseUid;
        }
        renderAppQuickActions();
        var msg = t('apps_acceptance_sent');
        if (data.newAccountCreated) msg += ' (New account created + role assigned)';
        else msg += ' (Role assigned)';
        toast(msg);
      } else {
        toast('Failed: ' + (data.error || 'Unknown error'), true);
      }
    }).catch(function (err) {
      console.error('[lead-admin] Acceptance email error:', err);
      toast('Failed to send acceptance email', true);
    });
  }

  /* ══════════════════════════════════════════
     APPLICATION — ACTIVATE USER ACCOUNT
     ══════════════════════════════════════════ */

  function activateApplicant() {
    if (!currentAppId || !currentApp) return;

    if (currentApp.firebase_uid) {
      toast(t('apps_user_already_activated'));
      return;
    }

    if (!confirm(t('apps_activate_confirm'))) return;

    getAuthToken().then(function (token) {
      return fetch('/.netlify/functions/activate-applicant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ applicationId: currentAppId })
      });
    }).then(function (res) { return res.json(); })
    .then(function (data) {
      if (data.ok) {
        currentApp.firebase_uid = data.firebaseUid;
        currentApp.status = 'Enrolled';
        var idx = applications.findIndex(function (a) { return a.id === currentAppId; });
        if (idx !== -1) {
          applications[idx].firebase_uid = data.firebaseUid;
          applications[idx].status = 'Enrolled';
        }
        renderAppQuickActions();
        updateActivateBtn();
        toast(t('apps_user_activated'));
      } else {
        toast('Failed: ' + (data.error || 'Unknown error'), true);
      }
    }).catch(function (err) {
      console.error('[lead-admin] Activate applicant error:', err);
      toast('Failed to activate user', true);
    });
  }

  function updateActivateBtn() {
    var btn = $('yb-app-activate-btn');
    if (!btn || !currentApp) return;
    if (currentApp.firebase_uid) {
      btn.style.opacity = '0.6';
      btn.textContent = '\u2705 ' + t('apps_user_already_activated');
    } else {
      btn.style.opacity = '';
      btn.textContent = '\ud83d\udc64 ' + t('apps_activate_user');
    }
  }

  /* ══════════════════════════════════════════
     APPLICATION — ARCHIVE / RESTORE
     ══════════════════════════════════════════ */

  function archiveApp(appId) {
    if (!confirm(t('apps_archive_confirm'))) return;

    db.collection('applications').doc(appId).update({
      archived: true,
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
      var idx = applications.findIndex(function (a) { return a.id === appId; });
      if (idx !== -1) applications[idx].archived = true;
      if (currentApp && currentApp.id === appId) currentApp.archived = true;

      if (currentAppId === appId) {
        renderAppQuickActions();
        renderApplicationDetailCard();
      }
      renderApplicationTable();
      renderApplicationStats();
      toast(t('apps_archived'));
    }).catch(function (err) {
      console.error('[lead-admin] Archive error:', err);
      toast(t('error_save'), true);
    });
  }

  function restoreApp(appId) {
    db.collection('applications').doc(appId).update({
      archived: false,
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
      var idx = applications.findIndex(function (a) { return a.id === appId; });
      if (idx !== -1) applications[idx].archived = false;
      if (currentApp && currentApp.id === appId) currentApp.archived = false;

      if (currentAppId === appId) {
        renderAppQuickActions();
        renderApplicationDetailCard();
      }
      renderApplicationTable();
      renderApplicationStats();
      toast(t('apps_restore') + '!');
    }).catch(function (err) {
      console.error('[lead-admin] Restore error:', err);
      toast(t('error_save'), true);
    });
  }

  function toggleShowArchivedApps() {
    showArchivedApps = !showArchivedApps;
    var btn = $('yb-app-archive-toggle');
    if (btn) {
      btn.innerHTML = '\ud83d\udce6 ' + (showArchivedApps ? t('apps_hide_archived') : t('apps_show_archived'));
    }
    renderApplicationTable();
    renderApplicationStats();
  }

  /* ══════════════════════════════════════════
     APPLICATION — NOTES
     ══════════════════════════════════════════ */

  function addAppNote() {
    if (!currentAppId || !currentApp) return;

    var input = $('yb-app-note-input');
    if (!input) return;

    var text = input.value.trim();
    if (!text) return;

    var note = {
      text: text,
      type: 'manual',
      author: (firebase.auth().currentUser || {}).email || 'admin',
      timestamp: new Date().toISOString()
    };

    var notes = Array.isArray(currentApp.notes) ? currentApp.notes.slice() : [];
    notes.unshift(note);

    db.collection('applications').doc(currentAppId).update({
      notes: notes,
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
      currentApp.notes = notes;
      var idx = applications.findIndex(function (a) { return a.id === currentAppId; });
      if (idx !== -1) applications[idx].notes = notes;
      input.value = '';
      renderAppNotesTimeline();
      toast(t('apps_note_added'));
    }).catch(function (err) {
      console.error('[lead-admin] App note error:', err);
      toast(t('error_save'), true);
    });
  }

  function renderAppNotesTimeline() {
    var el = $('yb-app-notes-timeline');
    if (!el || !currentApp) return;

    var notes = Array.isArray(currentApp.notes) ? currentApp.notes : [];
    if (!notes.length) {
      el.innerHTML = '<p class="yb-lead__empty-text">No notes yet.</p>';
      return;
    }

    el.innerHTML = notes.map(function (n) {
      var ts = n.timestamp ? new Date(n.timestamp).toLocaleString() : '';
      var typeTag = n.type ? '<span class="yb-lead__note-type">' + esc(n.type) + '</span>' : '';
      return '<div class="yb-lead__note-entry">' +
        '<div class="yb-lead__note-meta">' +
          '<span class="yb-lead__note-time">' + ts + '</span> ' +
          '<span class="yb-lead__note-author">' + esc(n.author || '') + '</span> ' +
          typeTag +
        '</div>' +
        '<div class="yb-lead__note-text">' + esc(n.text || '') + '</div>' +
      '</div>';
    }).join('');
  }

  /* ══════════════════════════════════════════
     APPLICATION — BULK SELECTION
     ══════════════════════════════════════════ */

  function toggleAppSelect(appId) {
    if (selectedAppIds.has(appId)) {
      selectedAppIds.delete(appId);
    } else {
      selectedAppIds.add(appId);
    }
    updateAppBulkBar();
    renderApplicationTable();
  }

  function toggleSelectAllApps() {
    var filtered = getFilteredApps();
    if (selectAllApps) {
      selectedAppIds.clear();
      selectAllApps = false;
    } else {
      filtered.forEach(function (a) { selectedAppIds.add(a.id); });
      selectAllApps = true;
    }
    updateAppBulkBar();
    renderApplicationTable();
  }

  function deselectAllApps() {
    selectedAppIds.clear();
    selectAllApps = false;
    updateAppBulkBar();
    renderApplicationTable();
  }

  function updateAppBulkBar() {
    var bar = $('yb-app-bulk-bar');
    var countEl = $('yb-app-bulk-count');
    if (!bar) return;

    if (selectedAppIds.size > 0) {
      bar.hidden = false;
      if (countEl) countEl.textContent = selectedAppIds.size + ' selected';
    } else {
      bar.hidden = true;
    }
  }

  /* ══════════════════════════════════════════
     APPLICATION — BULK ACTIONS
     ══════════════════════════════════════════ */

  function bulkAppStatusChange() {
    if (selectedAppIds.size === 0) return;

    openBulkStatusPicker(APP_STATUSES, selectedAppIds.size, function (status) {
      var batch = db.batch();
      selectedAppIds.forEach(function (id) {
        var ref = db.collection('applications').doc(id);
        batch.update(ref, { status: status, updated_at: firebase.firestore.FieldValue.serverTimestamp() });
      });

      batch.commit().then(function () {
        selectedAppIds.forEach(function (id) {
          var idx = applications.findIndex(function (a) { return a.id === id; });
          if (idx !== -1) applications[idx].status = status;
        });
        deselectAllApps();
        renderApplicationTable();
        renderApplicationStats();
        toast('Status updated for ' + selectedAppIds.size + ' applications');
      }).catch(function (err) {
        console.error('[lead-admin] Bulk status error:', err);
        toast(t('error_save'), true);
      });
    });
  }

  function bulkAppArchive() {
    if (selectedAppIds.size === 0) return;
    if (!confirm(t('apps_archive_confirm') + ' (' + selectedAppIds.size + ')')) return;

    var batch = db.batch();
    selectedAppIds.forEach(function (id) {
      var ref = db.collection('applications').doc(id);
      batch.update(ref, { archived: true, updated_at: firebase.firestore.FieldValue.serverTimestamp() });
    });

    batch.commit().then(function () {
      selectedAppIds.forEach(function (id) {
        var idx = applications.findIndex(function (a) { return a.id === id; });
        if (idx !== -1) applications[idx].archived = true;
      });
      deselectAllApps();
      renderApplicationTable();
      renderApplicationStats();
      toast(t('apps_archived'));
    }).catch(function (err) {
      console.error('[lead-admin] Bulk archive error:', err);
      toast(t('error_save'), true);
    });
  }

  function bulkAppEmail() {
    // Open the standard campaign wizard — user picks source (All / Leads / Applications) via DATAKILDE filter
    if (typeof window.openEmailCampaign === 'function') {
      window.openEmailCampaign([]);
    } else {
      toast('Campaign wizard not available', true);
    }
  }

  function bulkAppSMS() {
    // Open the standard campaign wizard — user picks source (All / Leads / Applications) via DATAKILDE filter
    if (typeof window.openSMSCampaign === 'function') {
      window.openSMSCampaign([]);
    } else {
      toast('Campaign wizard not available', true);
    }
  }

  /* ══════════════════════════════════════════
     APPLICATION — CSV EXPORT
     ══════════════════════════════════════════ */

  function exportAppsCsv() {
    var filtered = getFilteredApps();
    if (filtered.length === 0) {
      toast('No applications to export', true);
      return;
    }

    var headers = ['App ID', 'First Name', 'Last Name', 'Email', 'Phone', 'Program Type', 'Course Name', 'Cohort', 'Track', 'Payment Choice', 'Status', 'Archived', 'Created'];
    var rows = filtered.map(function (a) {
      return [
        a.app_id || a.id.substring(0, 8),
        a.first_name || '',
        a.last_name || '',
        a.email || '',
        a.phone || '',
        a.program_type || '',
        a.course_name || '',
        a.cohort_label || a.cohort || '',
        a.track || '',
        a.payment_choice || '',
        a.status || '',
        a.archived ? 'Yes' : 'No',
        a.created_at ? new Date(a.created_at.seconds ? a.created_at.seconds * 1000 : a.created_at).toISOString().substring(0, 10) : ''
      ].map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(',');
    });

    var csv = headers.join(',') + '\n' + rows.join('\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'applications-' + new Date().toISOString().substring(0, 10) + '.csv';
    link.click();
    URL.revokeObjectURL(url);
    toast(t('apps_csv_exported'));
  }

  /* ══════════════════════════════════════════
     CROSS-LINKING
     ══════════════════════════════════════════ */

  /* Jump from lead to application */
  function viewLinkedApplication(appId) {
    // Switch to Applications tab
    var appTabBtn = document.querySelector('[data-yb-admin-tab="applications"]');
    if (appTabBtn) appTabBtn.click();

    // Ensure applications are loaded
    var doShow = function () {
      // Find by app_id field or doc id
      var app = applications.find(function (a) { return a.app_id === appId || a.id === appId; });
      if (app) {
        showApplicationDetail(app.id);
      } else {
        toast('Application not found: ' + appId, true);
      }
    };

    if (!appLoaded) {
      // Load first, then navigate
      applications = [];
      db.collection('applications').orderBy('created_at', 'desc').limit(10000).get().then(function (snap) {
        snap.forEach(function (doc) {
          applications.push(Object.assign({ id: doc.id }, doc.data()));
        });
        appLoaded = true;
        renderApplicationTable();
        renderApplicationStats();
        doShow();
      }).catch(function (err) {
        console.error('[lead-admin] App load error:', err);
        toast(t('error_load'), true);
      });
    } else {
      doShow();
    }
  }

  /* Jump from application to lead */
  function viewLinkedLead(appId) {
    // Switch to Leads tab
    var leadsTabBtn = document.querySelector('[data-yb-admin-tab="leads"]');
    if (leadsTabBtn) leadsTabBtn.click();

    // Ensure leads are loaded
    var doShow = function () {
      var lead = leads.find(function (l) { return l.application_id === appId; });
      if (lead) {
        showLeadDetail(lead.id);
      } else {
        // Try querying Firestore directly
        db.collection('leads').where('application_id', '==', appId).limit(1).get().then(function (snap) {
          if (!snap.empty) {
            var doc = snap.docs[0];
            var leadData = Object.assign({ id: doc.id }, doc.data());
            // Add to local cache if not there
            if (!leads.find(function (l) { return l.id === leadData.id; })) {
              leads.push(leadData);
            }
            showLeadDetail(leadData.id);
          } else {
            toast('No lead found for application ' + appId, true);
          }
        }).catch(function (err) {
          console.error('[lead-admin] Lead lookup error:', err);
          toast('Could not find linked lead.', true);
        });
      }
    };

    if (!leadsLoaded) {
      loadLeads();
      leadsLoaded = true;
      // Give it a moment to load, then try
      setTimeout(doShow, 1500);
    } else {
      doShow();
    }
  }

  /* ══════════════════════════════════════════
     EVENT BINDING
     ══════════════════════════════════════════ */
  function bindLeadEvents() {
    // Delegated click handler
    document.addEventListener('click', function (e) {
      // Close modals on overlay click (must run BEFORE the data-action guard)
      if (e.target.classList.contains('yb-lead__modal-overlay')) {
        var parentModal = e.target.closest('.yb-lead__modal');
        if (parentModal) parentModal.hidden = true;
        return;
      }
      // Close modal via X button
      if (e.target.closest('.yb-lead__modal-close')) {
        var parentM = e.target.closest('.yb-lead__modal');
        if (parentM) parentM.hidden = true;
        return;
      }

      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-action');
      var id = btn.getAttribute('data-id');

      switch (action) {
        // Lead actions
        case 'view-lead': e.preventDefault(); showLeadDetail(id); break;
        case 'back-leads': backToLeadList(); break;
        case 'leads-refresh': loadLeads(); break;
        case 'leads-load-more': loadLeads(true); break;
        case 'delete-lead': deleteLead(id || currentLeadId); break;
        case 'restore-lead': restoreLead(id || currentLeadId); break;
        case 'toggle-show-archived': toggleShowArchived(); break;
        case 'lead-sms': openSMSComposer(); break;
        case 'lead-email': openEmailComposer(); break;
        case 'send-booking-sms': sendBookingSMS(); break;
        case 'send-booking-email': sendBookingEmail(); break;
        case 'lead-add-note': addNote('note'); break;
        case 'log-call': e.preventDefault(); logCall(); break;
        case 'toggle-expand':
          if (id) {
            if (expandedLeadIds.has(id)) expandedLeadIds.delete(id);
            else expandedLeadIds.add(id);
            renderLeadTable();
          }
          break;
        case 'sms-inline':
          if (id) {
            currentLeadId = id;
            currentLead = leads.find(function (l) { return l.id === id; });
            openSMSComposer();
          }
          break;
        case 'email-inline':
          if (id) {
            currentLeadId = id;
            currentLead = leads.find(function (l) { return l.id === id; });
            openEmailComposer();
          }
          break;
        case 'log-call-inline':
          e.preventDefault();
          if (id) {
            currentLeadId = id;
            currentLead = leads.find(function (l) { return l.id === id; });
            logCall();
          }
          break;
        case 'add-note-inline':
          if (id) {
            var noteInput = document.querySelector('.yb-lead__exp-note-input[data-lead-id="' + id + '"]');
            if (noteInput && noteInput.value.trim()) {
              var inlineLead = leads.find(function (ll) { return ll.id === id; });
              if (inlineLead) {
                var inlineNote = {
                  text: noteInput.value.trim(),
                  timestamp: new Date().toISOString(),
                  author: (firebase.auth().currentUser || {}).email || 'admin',
                  type: 'note'
                };
                var existingNotes = Array.isArray(inlineLead.notes) ? inlineLead.notes.slice() : [];
                existingNotes.push(inlineNote);
                db.collection('leads').doc(id).update({
                  notes: existingNotes,
                  updated_at: firebase.firestore.FieldValue.serverTimestamp()
                }).then(function () {
                  inlineLead.notes = existingNotes;
                  toast(t('leads_note_added'));
                  renderLeadTable();
                }).catch(function (err) { toast('Error: ' + err.message, true); });
              }
            }
          }
          break;
        case 'leads-export-csv': exportCSV(); break;
        case 'leads-select-all': toggleSelectAll(); break;
        case 'bulk-status': bulkUpdateStatus(); break;
        case 'bulk-sms': bulkSMS(); break;
        case 'bulk-email': bulkEmail(); break;
        case 'bulk-deselect': selectedIds.clear(); selectAll = false; renderLeadView(); updateBulkBar(); break;
        case 'bulk-archive': bulkArchive(); break;
        case 'sms-send': sendSMSFromComposer(); break;
        case 'sms-cancel': $('yb-lead-sms-modal').hidden = true; break;
        case 'email-send': sendEmailFromComposer(); break;
        case 'email-cancel': $('yb-lead-email-modal').hidden = true; break;
        case 'lead-note-submit': addNote('note'); break;

        // SMS conversation reply
        case 'sms-reply-send': sendSMSReply(); break;

        // Application actions
        case 'view-app': e.preventDefault(); showApplicationDetail(id); break;
        case 'back-apps': backToAppList(); break;
        case 'apps-refresh': loadApplications(); break;
        case 'app-update-status': updateAppStatus(); break;
        case 'app-send-email': sendAppEmailPrompt(); break;
        case 'app-send-sms': /* Open SMS section — scroll to it */ var smsEl = $('yb-app-sms-conversation'); if (smsEl) smsEl.scrollIntoView({ behavior: 'smooth' }); var smsInput = $('yb-app-sms-reply-input'); if (smsInput) smsInput.focus(); break;
        case 'app-sms-reply': sendAppSMSReply(); break;
        case 'app-send-acceptance': sendAcceptanceEmail(); break;
        case 'app-activate-user': activateApplicant(); break;
        case 'app-archive': archiveApp(id || currentAppId); break;
        case 'app-restore': restoreApp(id || currentAppId); break;
        case 'toggle-show-archived-apps': toggleShowArchivedApps(); break;
        case 'apps-export-csv': exportAppsCsv(); break;
        case 'app-bulk-status': bulkAppStatusChange(); break;
        case 'app-bulk-email': bulkAppEmail(); break;
        case 'app-bulk-sms': bulkAppSMS(); break;
        case 'app-bulk-archive': bulkAppArchive(); break;
        case 'app-deselect-all': deselectAllApps(); break;

        // Invoice actions from application profile
        case 'app-invoice-lookup': appInvoiceLookup(btn.dataset.ref); break;
        case 'app-invoice-refresh': appInvoiceRefresh(btn.dataset.ref); break;
        case 'app-invoice-view': appInvoiceQuickView(btn.dataset.booked); break;
        case 'app-invoice-pdf': appInvoiceDownloadPdf(btn.dataset.booked); break;
        case 'app-invoice-resend': appInvoiceResend(btn.dataset.booked, btn.dataset.email); break;
        case 'app-invoice-credit': appInvoiceCreditNote(btn.dataset.booked); break;
        case 'app-invoice-delete-draft': appInvoiceDeleteDraft(btn.dataset.draft); break;
        case 'app-invoice-modal-close':
          var invModal = $('yb-app-invoice-modal');
          if (invModal) invModal.hidden = true;
          break;

        // Cross-linking
        case 'view-linked-app':
          var linkedAppId = btn.getAttribute('data-app-id');
          if (linkedAppId) viewLinkedApplication(linkedAppId);
          break;
        case 'view-linked-lead':
          var linkedLeadAppId = btn.getAttribute('data-app-id');
          if (linkedLeadAppId) viewLinkedLead(linkedLeadAppId);
          break;
      }

    });

    // Checkbox and inline status changes
    document.addEventListener('change', function (e) {
      // Inline status/temperature/priority change from quick view
      if (e.target.classList.contains('yb-lead__exp-status-select')) {
        var selLeadId = e.target.getAttribute('data-lead-id');
        var selField = e.target.getAttribute('data-field');
        var selValue = e.target.value;
        if (selLeadId && selField) {
          var updateData = {};
          updateData[selField] = selValue;
          updateData.updated_at = firebase.firestore.FieldValue.serverTimestamp();
          db.collection('leads').doc(selLeadId).update(updateData).then(function () {
            var ll = leads.find(function (x) { return x.id === selLeadId; });
            if (ll) ll[selField] = selValue;
            toast(selField + ' updated');
            renderLeadView();
          }).catch(function (err) { toast('Error: ' + err.message, true); });
        }
        return;
      }
      if (e.target.classList.contains('yb-lead__cb')) {
        toggleSelectLead(e.target.getAttribute('data-lead-id'));
      }
      if (e.target.id === 'yb-lead-select-all') {
        toggleSelectAll();
      }
      // SMS template chip or select
      if (e.target.id === 'yb-sms-template-select') {
        var key = e.target.value;
        if (key && SMS_TEMPLATES[key]) {
          applySMSTemplate(key);
        }
      }
      // Email template selector (from Firestore)
      if (e.target.id === 'yb-email-template-select') {
        var opt = e.target.options[e.target.selectedIndex];
        if (opt && opt.value) {
          var subj = opt.dataset.subject || '';
          var body = opt.dataset.body || '';
          if (subj) $('yb-email-subject').value = subj;
          if (body) $('yb-email-body').value = body;
        }
      }
    });

    // SMS character count on input
    document.addEventListener('input', function (e) {
      if (e.target.id === 'yb-sms-message') {
        updateSMSCharCount();
      }
    });

    // Invoice payment status change (delegated)
    document.addEventListener('change', function (e) {
      if (e.target.id === 'yb-app-invoice-payment-status') {
        saveAppPaymentStatus(e.target.value);
      }
    });

    // Variable insert buttons
    document.addEventListener('click', function (e) {
      var varBtn = e.target.closest('.yb-lead__var-btn');
      if (!varBtn) return;
      var varText = varBtn.getAttribute('data-var');
      var targetId = varBtn.getAttribute('data-target');
      var ta = $(targetId);
      if (!ta || !varText) return;
      var start = ta.selectionStart || ta.value.length;
      var end = ta.selectionEnd || ta.value.length;
      ta.value = ta.value.substring(0, start) + varText + ta.value.substring(end);
      ta.focus();
      ta.setSelectionRange(start + varText.length, start + varText.length);
      if (targetId === 'yb-sms-message') updateSMSCharCount();
    });

    // Stats toggle (mobile collapsible)
    var statsToggle = $('yb-lead-stats-toggle');
    if (statsToggle) {
      statsToggle.addEventListener('click', function () {
        var grid = $('yb-lead-stats');
        var expanded = statsToggle.getAttribute('aria-expanded') === 'true';
        statsToggle.setAttribute('aria-expanded', !expanded);
        if (grid) grid.classList.toggle('is-expanded', !expanded);
      });
    }

    // Search form — Leads
    var searchForm = $('yb-lead-search-form');
    if (searchForm) {
      searchForm.addEventListener('submit', function (e) {
        e.preventDefault();
        searchTerm = ($('yb-lead-search-input') || {}).value || '';
        renderLeadView();
      });
      // Live search
      var searchInput = $('yb-lead-search-input');
      if (searchInput) {
        searchInput.addEventListener('input', function () {
          searchTerm = searchInput.value || '';
          renderLeadView();
        });
      }
    }

    // Search form — Applications
    var appSearchForm = $('yb-app-search-form');
    if (appSearchForm) {
      appSearchForm.addEventListener('submit', function (e) {
        e.preventDefault();
        appSearchTerm = ($('yb-app-search-input') || {}).value || '';
        renderApplicationTable();
      });
      var appSearchInput = $('yb-app-search-input');
      if (appSearchInput) {
        appSearchInput.addEventListener('input', function () {
          appSearchTerm = appSearchInput.value || '';
          renderApplicationTable();
        });
      }
    }

    // Filters — compact selects (source / priority / temperature)
    ['yb-lead-source-filter', 'yb-lead-priority-filter', 'yb-lead-temperature-filter'].forEach(function (filterId) {
      var el = $(filterId);
      if (el) {
        el.addEventListener('change', function () {
          if (filterId === 'yb-lead-source-filter') filterSource = el.value;
          if (filterId === 'yb-lead-priority-filter') filterPriority = el.value;
          if (filterId === 'yb-lead-temperature-filter') filterTemperature = el.value;
          loadLeads();
        });
      }
    });

    // Multi-select status chips
    var scEl = $('yb-lead-status-chips');
    if (scEl) {
      scEl.addEventListener('click', function (e) {
        var chip = e.target.closest('[data-status-chip]');
        if (!chip) return;
        var val = chip.getAttribute('data-status-chip');
        var idx = filterStatuses.indexOf(val);
        if (idx !== -1) filterStatuses.splice(idx, 1); else filterStatuses.push(val);
        renderLeadFilterChips();
        loadLeads();
      });
    }

    // Multi-select type chips
    var tcEl = $('yb-lead-type-chips');
    if (tcEl) {
      tcEl.addEventListener('click', function (e) {
        var chip = e.target.closest('[data-type-chip]');
        if (!chip) return;
        var val = chip.getAttribute('data-type-chip');
        var idx = filterTypes.indexOf(val);
        if (idx !== -1) filterTypes.splice(idx, 1); else filterTypes.push(val);
        filterSubType = '';
        filterSubTypeField = '';
        renderLeadFilterChips();
        renderSubTypeFilter(filterTypes.length === 1 ? filterTypes[0] : '');
        loadLeads();
      });
    }

    // Clear all filters button
    var clearFiltersBtn = $('yb-lead-clear-filters');
    if (clearFiltersBtn) {
      clearFiltersBtn.addEventListener('click', function () {
        filterStatuses = [];
        filterTypes = [];
        filterSource = '';
        filterPriority = '';
        filterTemperature = '';
        filterSubType = '';
        filterSubTypeField = '';
        var sel; // reset compact selects
        sel = $('yb-lead-source-filter'); if (sel) sel.value = '';
        sel = $('yb-lead-priority-filter'); if (sel) sel.value = '';
        sel = $('yb-lead-temperature-filter'); if (sel) sel.value = '';
        renderLeadFilterChips();
        var subtypeRow2 = $('yb-lead-subtype-row');
        if (subtypeRow2) subtypeRow2.hidden = true;
        loadLeads();
      });
    }

    // Sub-type filter chips
    var subtypeRow = $('yb-lead-subtype-row');
    if (subtypeRow) {
      subtypeRow.addEventListener('click', function (e) {
        var chip = e.target.closest('[data-subtype]');
        if (!chip) return;
        var val = chip.getAttribute('data-subtype');
        if (filterSubType === val) {
          filterSubType = '';
          filterSubTypeField = '';
        } else {
          filterSubType = val;
          filterSubTypeField = chip.getAttribute('data-subtype-field') || '';
        }
        subtypeRow.querySelectorAll('[data-subtype]').forEach(function (c) {
          c.classList.toggle('is-active', c.getAttribute('data-subtype') === filterSubType);
        });
        renderLeadView();
      });
    }

    // Filters — Applications
    var appStatusFilter = $('yb-app-status-filter');
    if (appStatusFilter) {
      appStatusFilter.addEventListener('change', function () {
        appFilterStatus = appStatusFilter.value;
        renderApplicationTable();
      });
    }
    var appTypeFilter = $('yb-app-type-filter');
    if (appTypeFilter) {
      appTypeFilter.addEventListener('change', function () {
        appFilterType = appTypeFilter.value;
        renderApplicationTable();
      });
    }
    var appTrackFilter = $('yb-app-track-filter');
    if (appTrackFilter) {
      appTrackFilter.addEventListener('change', function () {
        appFilterTrack = appTrackFilter.value;
        renderApplicationTable();
      });
    }
    var appCohortFilterEl = $('yb-app-cohort-filter');
    if (appCohortFilterEl) {
      appCohortFilterEl.addEventListener('change', function () {
        appFilterCohort = appCohortFilterEl.value;
        renderApplicationTable();
      });
    }

    // Cascading dropdowns for app edit form (program type → course → cohort)
    var appEditProgramType = $('yb-app-edit-program-type');
    if (appEditProgramType) {
      appEditProgramType.addEventListener('change', function () {
        populateCourseDropdown(appEditProgramType.value, '');
        populateCohortDropdown(appEditProgramType.value, '', '');
      });
    }
    var appEditCourseName = $('yb-app-edit-course-name');
    if (appEditCourseName) {
      appEditCourseName.addEventListener('change', function () {
        var progType = $('yb-app-edit-program-type');
        populateCohortDropdown(progType ? progType.value : '', appEditCourseName.value, '');
      });
    }

    // App select-all checkbox
    var appSelectAll = $('yb-app-select-all');
    if (appSelectAll) {
      appSelectAll.addEventListener('change', function () {
        toggleSelectAllApps();
      });
    }

    // App row checkbox (delegated)
    document.addEventListener('change', function (e) {
      if (e.target.classList.contains('yb-app-row-cb')) {
        var appId = e.target.getAttribute('data-id');
        if (appId) toggleAppSelect(appId);
      }
    });

    // Lead edit form
    var leadEditForm = $('yb-lead-edit-form');
    if (leadEditForm) {
      leadEditForm.addEventListener('submit', function (e) {
        e.preventDefault();
        saveLeadFields();
      });
    }

    // App edit form
    var appEditForm = $('yb-app-edit-form');
    if (appEditForm) {
      appEditForm.addEventListener('submit', function (e) {
        e.preventDefault();
        saveAppFields();
      });
    }

    // App status form
    var appStatusForm = $('yb-app-status-form');
    if (appStatusForm) {
      appStatusForm.addEventListener('submit', function (e) {
        e.preventDefault();
        updateAppStatus();
      });
    }

    // App note form
    var appNoteForm = $('yb-app-note-form');
    if (appNoteForm) {
      appNoteForm.addEventListener('submit', function (e) {
        e.preventDefault();
        addAppNote();
      });
    }

    // Status form — Leads
    var statusForm = $('yb-lead-status-form');
    if (statusForm) statusForm.addEventListener('submit', saveLeadStatus);

    // Sub-status updates when status changes
    var statusSelect = $('yb-lead-status-select');
    if (statusSelect) {
      statusSelect.addEventListener('change', updateSubStatusOptions);
    }

    // Sort buttons
    $$('.yb-lead__sort-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        toggleSort(btn.getAttribute('data-sort'));
      });
    });

    // Row click — Leads
    var table = $('yb-lead-table');
    if (table) {
      table.addEventListener('click', function (e) {
        // Don't trigger on checkbox, button, anchor, or expanded panel clicks
        if (e.target.closest('input[type="checkbox"]') || e.target.closest('button') || e.target.closest('a')) return;
        if (e.target.closest('.yb-lead__expanded-row')) return;
        var row = e.target.closest('.yb-lead__row');
        if (row) {
          var rowId = row.getAttribute('data-id');
          if (rowId) showLeadDetail(rowId);
        }
      });
    }

    // View toggle — Table / Kanban
    var viewToggle = $('yb-lead-view-toggle');
    if (viewToggle) {
      viewToggle.addEventListener('click', function (e) {
        var btn = e.target.closest('.yb-lead__view-btn');
        if (!btn) return;
        var view = btn.getAttribute('data-view');
        if (!view || view === leadViewMode) return;
        leadViewMode = view;
        $$('.yb-lead__view-btn').forEach(function (b) {
          b.classList.toggle('is-active', b.getAttribute('data-view') === view);
        });
        renderLeadView();
      });
    }

    // Row click — Applications
    var appTable = $('yb-app-table');
    if (appTable) {
      appTable.addEventListener('click', function (e) {
        if (e.target.closest('input[type="checkbox"]') || e.target.closest('button') || e.target.closest('a')) return;
        var row = e.target.closest('.yb-lead__row');
        if (row) {
          var rowAppId = row.getAttribute('data-app-id');
          if (rowAppId) showApplicationDetail(rowAppId);
        }
      });
    }

    // Stat card click -> filter (Leads)
    document.addEventListener('click', function (e) {
      var card = e.target.closest('[data-filter-status]');
      if (card) {
        var st = card.getAttribute('data-filter-status');
        filterStatuses = st ? [st] : [];
        renderLeadFilterChips();
        loadLeads();
      }
    });

    // SMS char counter
    var smsMsg = $('yb-sms-message');
    if (smsMsg) {
      smsMsg.addEventListener('input', function () {
        var count = smsMsg.value.length;
        var parts = Math.ceil(count / 160) || 1;
        $('yb-sms-char-count').textContent = count + '/160' + (parts > 1 ? ' (' + parts + ' SMS)' : '');
      });
    }

    // Note form submit
    var noteForm = $('yb-lead-note-form');
    if (noteForm) {
      noteForm.addEventListener('submit', function (e) {
        e.preventDefault();
        addNote('note');
      });
    }

    // SMS reply — Enter key
    document.addEventListener('keydown', function (e) {
      if (e.target && e.target.id === 'yb-sms-reply-input' && e.key === 'Enter') {
        e.preventDefault();
        sendSMSReply();
      }
    });
  }

  /* ══════════════════════════════════════════
     IFRAME MODAL POSITIONING
     In auto-sized iframes (member area), position:fixed doesn't work
     because the iframe viewport equals the full document height.
     We switch to position:absolute + calculate the visible offset.
     ══════════════════════════════════════════ */
  var isInIframe = window.self !== window.top;

  function positionModalInIframe(modal) {
    if (!isInIframe) return;
    // In an auto-sized iframe, position:fixed is effectively position:absolute
    // relative to the full iframe document. We need to calculate where the
    // user's visible viewport is within the iframe document.
    modal.style.position = 'absolute';
    try {
      // Same-origin: get parent scroll position and iframe offset
      var iframeEl = null;
      var parentIframes = parent.document.querySelectorAll('iframe');
      for (var i = 0; i < parentIframes.length; i++) {
        try {
          if (parentIframes[i].contentWindow === window) {
            iframeEl = parentIframes[i];
            break;
          }
        } catch (e) { /* cross-origin */ }
      }
      if (iframeEl) {
        var parentScrollY = parent.window.scrollY || parent.window.pageYOffset || 0;
        var iframeRect = iframeEl.getBoundingClientRect();
        var iframeTopInDoc = parentScrollY + iframeRect.top;
        // The visible top within the iframe document
        var visibleTop = Math.max(0, parentScrollY - iframeTopInDoc);
        var viewportH = parent.window.innerHeight;
        modal.style.top = visibleTop + 'px';
        modal.style.height = viewportH + 'px';
        modal.style.left = '0';
        modal.style.right = '0';
        modal.style.bottom = 'auto';
      }
    } catch (e) {
      // Cross-origin fallback: just scroll to top
      window.scrollTo(0, 0);
    }
  }

  /* ══════════════════════════════════════════
     INIT
     ══════════════════════════════════════════ */
  function createModals() {
    // SMS Composer Modal — uses existing .yb-lead__modal structure
    if (!$('yb-lead-sms-modal')) {
      var sms = document.createElement('div');
      sms.id = 'yb-lead-sms-modal';
      sms.className = 'yb-lead__modal';
      sms.hidden = true;
      sms.innerHTML =
        '<div class="yb-lead__modal-overlay"></div>' +
        '<div class="yb-lead__modal-box">' +
          '<button type="button" class="yb-lead__modal-close" aria-label="Close">&times;</button>' +
          '<h3>\ud83d\udcf1 Send SMS</h3>' +
          '<div class="yb-lead__modal-to">' +
            'Til: <strong id="yb-sms-recipient-info"></strong>' +
          '</div>' +
          '<div class="yb-lead__tpl-chips" id="yb-sms-tpl-chips"></div>' +
          '<textarea id="yb-sms-message" class="yb-lead__modal-textarea" rows="4" placeholder="Skriv din SMS her..."></textarea>' +
          '<div class="yb-lead__sms-charcount"><span id="yb-sms-charcount">0</span> tegn \u00b7 <span id="yb-sms-segments">1</span> segment(er)</div>' +
          '<div id="yb-sms-progress" class="yb-lead__send-progress" hidden>' +
            '<div class="yb-lead__progress-bar"><div id="yb-sms-progress-bar" class="yb-lead__progress-fill"></div></div>' +
          '</div>' +
          '<div class="yb-lead__modal-actions">' +
            '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="sms-cancel" type="button">Annuller</button>' +
            '<button class="yb-btn yb-btn--primary yb-btn--sm" data-action="sms-send" id="yb-sms-send-btn" type="button">\u27a4 Send SMS</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(sms);

      // Build template chips
      var chipsEl = $('yb-sms-tpl-chips');
      if (chipsEl) {
        Object.keys(SMS_TEMPLATES).forEach(function (key) {
          var tpl = SMS_TEMPLATES[key];
          var chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'yb-lead__tpl-chip' + (key === 'booking' ? ' is-booking' : '');
          chip.textContent = tpl.label;
          chip.addEventListener('click', function () { applySMSTemplate(key); });
          chipsEl.appendChild(chip);
        });
      }
    }

    // Email Composer Modal — uses existing .yb-lead__modal structure
    if (!$('yb-lead-email-modal')) {
      var email = document.createElement('div');
      email.id = 'yb-lead-email-modal';
      email.className = 'yb-lead__modal';
      email.hidden = true;
      email.innerHTML =
        '<div class="yb-lead__modal-overlay"></div>' +
        '<div class="yb-lead__modal-box">' +
          '<button type="button" class="yb-lead__modal-close" aria-label="Close">&times;</button>' +
          '<h3>\u2709\ufe0f Send Email</h3>' +
          '<div class="yb-lead__modal-to">' +
            'Til: <strong id="yb-email-recipient-info"></strong>' +
          '</div>' +
          '<select id="yb-email-template-select" class="yb-lead__modal-select"><option value="">V\u00e6lg skabelon...</option></select>' +
          '<input type="text" id="yb-email-subject" class="yb-lead__modal-input" placeholder="Emne...">' +
          '<textarea id="yb-email-body" class="yb-lead__modal-textarea" rows="8" placeholder="Skriv din email her..."></textarea>' +
          '<div class="yb-lead__modal-actions">' +
            '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="email-cancel" type="button">Annuller</button>' +
            '<button class="yb-btn yb-btn--primary yb-btn--sm" data-action="email-send" id="yb-email-send-btn" type="button">\u27a4 Send Email</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(email);
    }
  }

  function initLeadAdmin() {
    T = window._ybAdminT || {};

    if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) return;
    db = firebase.firestore();

    // Detect user role — use onAuthStateChanged for reliability
    function resolveRole(user) {
      if (!user) return;
      db.collection('users').doc(user.uid).get().then(function (doc) {
        if (doc.exists) {
          var data = doc.data();
          currentUserRole = data.role || 'user';
          // Re-render quick actions if a lead detail is already open
          if (currentLead) renderLeadQuickActions();
        }
      }).catch(function (err) {
        console.error('[lead-admin] Role fetch error:', err);
      });
    }
    var user = firebase.auth().currentUser;
    if (user) {
      resolveRole(user);
    }
    firebase.auth().onAuthStateChanged(function (u) {
      if (u && currentUserRole === 'user') resolveRole(u);
    });

    createModals();
    bindLeadEvents();
    renderLeadFilterChips();

    // Hook into tab switching — Leads (admin page)
    document.querySelectorAll('[data-yb-admin-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tab = btn.getAttribute('data-yb-admin-tab');
        if (tab === 'leads' && !leadsLoaded) {
          loadLeads();
          leadsLoaded = true;
        }
        if (tab === 'applications' && !appLoaded) {
          loadApplications();
          appLoaded = true;
        }
      });
    });

    // Hook into tab switching — CRM tabs on profile page (marketing/admin)
    document.querySelectorAll('[data-yb-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tab = btn.getAttribute('data-yb-tab');
        if (tab === 'crm-leads' && !leadsLoaded) {
          loadLeads();
          leadsLoaded = true;
        }
        if (tab === 'crm-applications' && !appLoaded) {
          loadApplications();
          appLoaded = true;
        }
      });
    });
  }

  // Expose data bridge for campaign-wizard.js
  window._ybLeadData = {
    getLeads: function () { return leads; },
    getApplications: function () { return applications; },
    getDb: function () { return db; },
    getAuthToken: function () { return getAuthToken(); },
    getTranslations: function () { return T; },
    toast: toast,
    getCurrentLead: function () { return currentLead; },
    getSelectedIds: function () { return selectedIds; },

    // Load ALL non-archived leads for campaign wizard (not paginated)
    loadAllLeadsForCampaign: function (callback) {
      var SKIP_STATUSES = ['Converted', 'Existing Applicant'];
      db.collection('leads').orderBy('created_at', 'desc').limit(2000).get()
        .then(function (snap) {
          var all = [];
          snap.forEach(function (doc) {
            var d = Object.assign({ id: doc.id }, doc.data());
            // Skip archived, converted, and leads that already have an application
            if (d.archived) return;
            if (d.application_id) return;
            if (SKIP_STATUSES.indexOf(d.status) !== -1) return;
            all.push(d);
          });
          callback(null, all);
        })
        .catch(function (err) { callback(err, null); });
    },

    // Load ALL applications for campaign wizard
    loadAllAppsForCampaign: function (callback) {
      db.collection('applications').orderBy('created_at', 'desc').limit(500).get()
        .then(function (snap) {
          var all = [];
          snap.forEach(function (doc) {
            all.push(Object.assign({ id: doc.id }, doc.data()));
          });
          callback(null, all);
        })
        .catch(function (err) { callback(err, null); });
    },

    // Expose system enums for sequences admin
    statuses: STATUSES,
    subStatuses: SUB_STATUSES,
    types: [
      { value: 'ytt', label: 'YTT' },
      { value: 'course', label: 'Course' },
      { value: 'bundle', label: 'Bundle' },
      { value: 'mentorship', label: 'Mentorship' },
      { value: 'careers', label: 'Careers' },
      { value: 'contact', label: 'Contact' }
    ],
    sources: [
      '200h YTT', '300h YTT', '50h YTT', '30h YTT',
      'Courses', 'Mentorship',
      'Facebook Ad', 'Apply page', 'Contact page', 'Careers page', 'Manual entry'
    ],
    programs: [
      { value: '4-week', label: '4-Week Intensive' },
      { value: '4-week-jul', label: '4-Week Vinyasa Plus (Jul)' },
      { value: '8-week', label: '8-Week Semi-Intensive' },
      { value: '18-week', label: '18-Week Flexible (Spring)' },
      { value: '18-week-aug', label: '18-Week Flexible (Autumn)' },
      { value: '300h', label: '300h Advanced' },
      { value: '50h', label: '50h Specialty' },
      { value: '30h', label: '30h Module' }
    ],
    subTypeOptions: SUB_TYPE_OPTIONS,

    // Called by campaign wizard when a campaign send completes
    onCampaignSent: function (type, results) {
      selectedIds.clear();
      selectAll = false;
      updateBulkBar();
      renderLeadView();
    }
  };

  // Bootstrap
  var checkInterval = setInterval(function () {
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
      clearInterval(checkInterval);
      initLeadAdmin();
    }
  }, 100);

})();
