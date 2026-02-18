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
  var PAGE_SIZE = 50;
  var searchTerm = '';
  var filterStatus = '';
  var filterType = '';
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
  var KANBAN_COLUMNS = ['New', 'Contacted', 'No Answer', 'Follow-up', 'Engaged', 'Qualified', 'Negotiating', 'Converted'];

  // Application state
  var applications = [];
  var appLoaded = false;
  var currentAppId = null;
  var currentApp = null;
  var appSearchTerm = '';
  var appFilterStatus = '';
  var appFilterType = '';

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

  function fmtDate(d) {
    if (!d) return '\u2014';
    var date = d.toDate ? d.toDate() : new Date(d);
    if (isNaN(date.getTime())) return '\u2014';
    return date.toLocaleDateString('da-DK', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function fmtDateTime(d) {
    if (!d) return '\u2014';
    var date = d.toDate ? d.toDate() : new Date(d);
    if (isNaN(date.getTime())) return '\u2014';
    return date.toLocaleDateString('da-DK', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' ' + date.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
  }

  function fmtDateInput(d) {
    if (!d) return '';
    var date = d.toDate ? d.toDate() : new Date(d);
    if (isNaN(date.getTime())) return '';
    return date.toISOString().split('T')[0];
  }

  function relativeTime(d) {
    if (!d) return '';
    var date = d.toDate ? d.toDate() : new Date(d);
    if (isNaN(date.getTime())) return '';
    var diff = Date.now() - date.getTime();
    var mins = Math.floor(diff / 60000);
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    var days = Math.floor(hrs / 24);
    if (days < 7) return days + 'd ago';
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
    { value: 'Qualified', label: 'Qualified', color: '#B3E5FC', text: '#01579B', icon: '\u2705' },
    { value: 'Negotiating', label: 'Negotiating', color: '#FFE0B2', text: '#E65100', icon: '\ud83e\udd1d' },
    { value: 'Converted', label: 'Converted', color: '#d4edda', text: '#155724', icon: '\ud83c\udf89' },
    { value: 'Existing Applicant', label: 'Existing Applicant', color: '#cce5ff', text: '#004085', icon: '\ud83d\udcc4' },
    { value: 'On Hold', label: 'On Hold', color: '#FFF9C4', text: '#F57F17', icon: '\u23f8\ufe0f' },
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
    'Qualified': ['Ready to Apply', 'Needs Payment Info', 'Considering Dates'],
    'Negotiating': ['Payment Plan', 'Scholarship Request', 'Group Discount'],
    'Converted': ['Application Submitted', 'Payment Received', 'Enrolled'],
    'Existing Applicant': ['Re-inquiry', 'Upgrade Request', 'Referral'],
    'On Hold': ['Travel Issues', 'Financial', 'Personal Reasons', 'Next Cohort'],
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

    // Filter by archived state — only show archived when explicitly toggled
    if (showArchived) {
      query = query.where('archived', '==', true);
    } else if (filterStatus === 'Archived') {
      query = query.where('status', '==', 'Archived');
    } else {
      // Firestore doesn't support != well, so we filter client-side for non-archived
    }

    if (filterStatus && filterStatus !== 'Archived') query = query.where('status', '==', filterStatus);
    if (filterType) query = query.where('type', '==', filterType);
    if (filterSource) query = query.where('source', '==', filterSource);
    if (filterPriority) query = query.where('priority', '==', filterPriority);
    if (filterTemperature) query = query.where('temperature', '==', filterTemperature);
    if (lastDoc) query = query.startAfter(lastDoc);

    query.limit(PAGE_SIZE).get().then(function (snap) {
      snap.forEach(function (doc) {
        var data = Object.assign({ id: doc.id }, doc.data());
        // Client-side filter: skip archived leads unless showing archived
        if (!showArchived && data.archived === true) return;
        leads.push(data);
      });
      lastDoc = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;

      renderLeadView();
      renderLeadStats();
      updateBulkBar();

      var loadMore = $('yb-lead-load-more-wrap');
      if (loadMore && leadViewMode === 'table') loadMore.hidden = snap.docs.length < PAGE_SIZE;

    }).catch(function (err) {
      console.error('[lead-admin] Load error:', err);
      toast(t('error_load'), true);
    });
  }

  /* ══════════════════════════════════════════
     RENDER LEAD TABLE
     ══════════════════════════════════════════ */
  function getFilteredLeads() {
    var filtered = leads;
    if (searchTerm) {
      var s = searchTerm.toLowerCase();
      filtered = leads.filter(function (l) {
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
    }
  }

  function renderLeadTable() {
    var tbody = $('yb-lead-table-body');
    if (!tbody) return;

    var filtered = getFilteredLeads();

    // Update count display
    var countEl = $('yb-lead-count');
    if (countEl) countEl.textContent = filtered.length + ' ' + t('leads_of') + ' ' + leads.length;

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="15" style="text-align:center;padding:2rem;color:var(--yb-muted)">' + t('leads_no_leads') + '</td></tr>';
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
          unreadBadge +
        '</td>' +
        '<td class="yb-lead__cell-contact">' +
          '<div class="yb-lead__cell-email-text">' + esc(l.email || '') + '</div>' +
          (l.phone ? '<div class="yb-lead__cell-phone-text">' + esc(l.phone) + '</div>' : '') +
        '</td>' +
        '<td><span class="yb-lead__type-badge">' + typeBadge(l.type) + '</span></td>' +
        '<td class="yb-lead__cell-program">' + esc((l.program || l.cohort_label || '').substring(0, 30)) + '</td>' +
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
    var lastTwoNotes = notes.slice(-2).reverse();

    var lcColor = lcRecencyColor(l.last_contact);

    var appBadge = l.application_id
      ? '<span class="yb-lead__app-badge--inline" style="color:#155724">\u2713 App</span>'
      : '<span style="color:#6F6A66">\u2014</span>';

    var html = '<tr class="yb-lead__expanded-row" data-expanded-for="' + l.id + '">' +
      '<td colspan="15" class="yb-lead__expanded-cell">' +
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

    // Row 2: Location + Accommodation
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

    // Row 3: Notes preview
    if (lastTwoNotes.length) {
      html += '<div class="yb-lead__exp-notes">';
      lastTwoNotes.forEach(function (n) {
        var noteIcons = { call: '\ud83d\udcde', email: '\u2709\ufe0f', sms: '\ud83d\udcf1', note: '\ud83d\udcdd', system: '\u2699\ufe0f' };
        html += '<div class="yb-lead__exp-note">' +
          '<span class="yb-lead__exp-note-icon">' + (noteIcons[n.type] || '\ud83d\udcdd') + '</span>' +
          '<span class="yb-lead__exp-note-time">' + relativeTime(n.timestamp) + '</span>' +
          '<span class="yb-lead__exp-note-text">' + esc((n.text || '').substring(0, 120)) + (n.text && n.text.length > 120 ? '\u2026' : '') + '</span>' +
        '</div>';
      });
      html += '</div>';
    }

    // Row 4: Message excerpt
    if (l.message) {
      html += '<div class="yb-lead__exp-message">\ud83d\udcac ' + esc(l.message.substring(0, 200)) + (l.message.length > 200 ? '\u2026' : '') + '</div>';
    }

    // Quick action buttons
    html += '<div class="yb-lead__exp-actions">';
    if (l.phone) {
      html += '<a href="tel:' + esc(l.phone) + '" class="yb-btn yb-btn--outline yb-btn--sm" data-action="log-call-inline" data-id="' + l.id + '">\ud83d\udcde ' + t('leads_call') + '</a>';
      html += '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="sms-inline" data-id="' + l.id + '">\ud83d\udcf1 ' + t('leads_sms') + '</button>';
      html += '<a href="https://wa.me/' + esc((l.phone || '').replace(/[^0-9+]/g, '')) + '" target="_blank" rel="noopener" class="yb-btn yb-btn--outline yb-btn--sm">WhatsApp</a>';
    }
    if (l.email) {
      html += '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="email-inline" data-id="' + l.id + '">\u2709 ' + t('leads_email') + '</button>';
    }
    html += '<button class="yb-btn yb-btn--primary yb-btn--sm" data-action="view-lead" data-id="' + l.id + '">' + t('leads_detail_title') + ' \u2192</button>';
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

    var total = leads.length;
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
  }

  /* ══════════════════════════════════════════
     KANBAN BOARD VIEW
     ══════════════════════════════════════════ */
  function renderKanban() {
    var el = $('yb-lead-kanban');
    if (!el) return;

    var filtered = getFilteredLeads();

    // Update count display
    var countEl = $('yb-lead-count');
    if (countEl) countEl.textContent = filtered.length + ' ' + t('leads_of') + ' ' + leads.length;

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
      '<span class="yb-lead__card-label">' + t('leads_source') + '</span>' +
      '<span class="yb-lead__card-value">' + esc(l.source || '\u2014') + '</span>' +
    '</div>';
    html += '<div class="yb-lead__card-row">' +
      '<span class="yb-lead__card-label">' + t('leads_col_date') + '</span>' +
      '<span class="yb-lead__card-value">' + fmtDateTime(l.created_at) + '</span>' +
    '</div>';
    html += '</div>'; // end card 1

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
        '<span class="yb-lead__card-value">' + esc(l.cohort_label) + '</span>' +
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

    html += '</div>'; // end yb-lead__detail-cards wrapper

    el.innerHTML = html;
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
      (phone ? '<a href="tel:' + esc(phone) + '" class="yb-btn yb-btn--outline yb-btn--sm" data-action="log-call">\ud83d\udcde ' + t('leads_call') + '</a>' : '') +
      (phone ? '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="lead-sms">\ud83d\udcf1 ' + t('leads_sms') + '</button>' : '') +
      (phone ? '<a href="https://wa.me/' + esc(phone.replace(/[^0-9+]/g, '')) + '" target="_blank" class="yb-btn yb-btn--outline yb-btn--sm">\ud83d\udcac WhatsApp</a>' : '') +
      (email ? '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="lead-email">\u2709\ufe0f ' + t('leads_email') + '</button>' : '') +
      '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="lead-add-note">\ud83d\udcdd ' + t('leads_add_note') + '</button>';

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

    subStatusSelect.innerHTML = '<option value="">-- ' + t('leads_no_sub_status') + ' --</option>' +
      subs.map(function (s) {
        return '<option value="' + esc(s) + '">' + esc(s) + '</option>';
      }).join('');
  }

  function saveLeadStatus(e) {
    e.preventDefault();
    if (!currentLeadId) return;

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

      renderLeadDetailCard();
      renderLeadStats();
      toast(t('saved'));
    }).catch(function (err) {
      console.error('[lead-admin] Save error:', err);
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
    ytt: "Hi {{first_name}}! Thank you for your interest in our Yoga Teacher Training. We have just sent detailed information to your email - please check your inbox and spam or promotions folder. Feel free to reply here or call anytime with questions. Warm regards, Yoga Bible",
    course: "Hi {{first_name}}! Thank you for your interest in our {{program}} course. We have just sent you all the details by email - please check your inbox and spam or promotions folder. Reply here anytime with questions! Warm regards, Yoga Bible",
    mentorship: "Hi {{first_name}}! Thank you for your interest in our Personlig Mentorship program. We have sent you more information by email - check your inbox and spam or promotions folder. Looking forward to connecting! Warm regards, Yoga Bible",
    'default': "Hi {{first_name}}! Thank you for reaching out to Yoga Bible. We have sent you information by email - please check your inbox and spam or promotions folder. Feel free to reply here or call us with any questions! Warm regards, Yoga Bible"
  };

  function updateSMSCharCount() {
    var ta = $('yb-sms-message');
    if (!ta) return;
    var len = ta.value.length;
    var segments = Math.ceil(len / 160) || 1;
    var charEl = $('yb-sms-char-count');
    var segEl = $('yb-sms-segment-count');
    if (charEl) charEl.textContent = len + '/160';
    if (segEl) segEl.textContent = segments > 1 ? '(' + segments + ' ' + t('leads_sms_segments') + ')' : '';
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
        var leadIds = recipients.map(function (l) { return l.id; });
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

    if (selectedIds.size === 0) {
      bar.hidden = true;
      return;
    }

    bar.hidden = false;
    var selected = leads.filter(function (l) { return selectedIds.has(l.id); });
    var withPhone = selected.filter(function (l) { return l.phone; }).length;
    var withEmail = selected.filter(function (l) { return l.email; }).length;
    $('yb-lead-bulk-count').innerHTML = '<strong>' + selectedIds.size + '</strong> ' + t('leads_selected') +
      ' &nbsp;·&nbsp; 📱 ' + withPhone + ' &nbsp;·&nbsp; ✉️ ' + withEmail;
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
    var newStatus = prompt(t('leads_bulk_status_prompt'), 'Contacted');
    if (!newStatus) return;

    // Validate
    if (!STATUSES.find(function (s) { return s.value === newStatus; })) {
      toast(t('leads_invalid_status'), true);
      return;
    }

    var batch = db.batch();
    selectedIds.forEach(function (id) {
      batch.update(db.collection('leads').doc(id), {
        status: newStatus,
        updated_at: firebase.firestore.FieldValue.serverTimestamp()
      });
    });

    batch.commit().then(function () {
      // Update local
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
  }

  function bulkSMS() {
    var selected = leads.filter(function (l) { return selectedIds.has(l.id); });
    var withPhone = selected.filter(function (l) { return l.phone; });
    if (!withPhone.length) { toast(t('leads_no_phone'), true); return; }
    openSMSComposer(selected);
  }

  function bulkEmail() {
    var selected = leads.filter(function (l) { return selectedIds.has(l.id); });
    var withEmail = selected.filter(function (l) { return l.email; });
    if (!withEmail.length) { toast(t('leads_no_email_addr'), true); return; }
    openEmailComposer(selected);
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

    var headers = ['Name', 'Email', 'Phone', 'Type', 'Program', 'Status', 'Sub-Status', 'Priority', 'Temperature', 'Source', 'Accommodation', 'City', 'Follow-up', 'Last Contact', 'Call Attempts', 'Created'];
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
        l.source || '',
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

    var query = db.collection('applications').orderBy('created_at', 'desc');

    if (appFilterStatus) query = query.where('status', '==', appFilterStatus);
    if (appFilterType) query = query.where('program_type', '==', appFilterType);

    query.limit(200).get().then(function (snap) {
      snap.forEach(function (doc) {
        applications.push(Object.assign({ id: doc.id }, doc.data()));
      });

      renderApplicationTable();
      renderApplicationStats();
    }).catch(function (err) {
      console.error('[lead-admin] Applications load error:', err);
      toast(t('error_load'), true);
    });
  }

  /* ── Filter applications ── */
  function getFilteredApps() {
    var filtered = applications;
    if (appSearchTerm) {
      var s = appSearchTerm.toLowerCase();
      filtered = applications.filter(function (a) {
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
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--yb-muted)">No applications found.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(function (a) {
      return '<tr class="yb-lead__row" data-app-id="' + a.id + '">' +
        '<td class="yb-lead__cell-date">' + esc(a.app_id || a.id.substring(0, 8)) + '</td>' +
        '<td class="yb-lead__cell-name">' + esc((a.first_name || '') + ' ' + (a.last_name || '')).trim() + '</td>' +
        '<td class="yb-lead__cell-contact"><div class="yb-lead__cell-email-text">' + esc(a.email || '') + '</div></td>' +
        '<td><span class="yb-lead__type-badge">' + esc(a.program_type || '\u2014') + '</span></td>' +
        '<td class="yb-lead__cell-program">' + esc((a.course_name || a.cohort || '').substring(0, 30)) + '</td>' +
        '<td>' + esc(a.track || '\u2014') + '</td>' +
        '<td>' + esc(a.payment_choice || '\u2014') + '</td>' +
        '<td>' + appStatusBadgeHtml(a.status) + '</td>' +
        '<td class="yb-lead__cell-date">' + relativeTime(a.created_at) + '</td>' +
        '<td class="yb-lead__cell-actions">' +
          '<button class="yb-admin__icon-btn" data-action="view-app" data-id="' + a.id + '" title="View">\u2192</button>' +
        '</td>' +
      '</tr>';
    }).join('');
  }

  /* ── Render Application Stats ── */
  function renderApplicationStats() {
    var el = $('yb-app-stats');
    if (!el) return;

    var total = applications.length;
    var counts = {};
    APP_STATUSES.forEach(function (s) { counts[s.value] = 0; });
    var typeCounts = {};
    applications.forEach(function (a) {
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

    el.innerHTML = html;
  }

  /* ── Show Application Detail ── */
  function showApplicationDetail(appId) {
    currentAppId = appId;
    currentApp = applications.find(function (a) { return a.id === appId; });
    if (!currentApp) return;

    var listView = $('yb-admin-v-app-list');
    var detailView = $('yb-admin-v-app-detail');
    if (listView) listView.hidden = true;
    if (detailView) detailView.hidden = false;

    var headingEl = $('yb-app-detail-heading');
    if (headingEl) headingEl.textContent = (currentApp.first_name || '') + ' ' + (currentApp.last_name || '') + ' \u2014 ' + (currentApp.app_id || appId.substring(0, 8));

    renderApplicationDetailCard();
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
    if (a.cohort) {
      html += '<div class="yb-lead__card-row">' +
        '<span class="yb-lead__card-label">Cohort</span>' +
        '<span class="yb-lead__card-value">' + esc(a.cohort) + '</span>' +
      '</div>';
    }
    if (a.track) {
      html += '<div class="yb-lead__card-row">' +
        '<span class="yb-lead__card-label">Track</span>' +
        '<span class="yb-lead__card-value">' + esc(a.track) + '</span>' +
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
        '<span class="yb-lead__card-value">' + esc(a.payment_choice) + '</span>' +
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

    // Status selector
    html += '<div class="yb-lead__card-row">' +
      '<span class="yb-lead__card-label">Change Status</span>' +
      '<span class="yb-lead__card-value">' +
        '<select id="yb-app-status-select" class="yb-admin__select" style="display:inline-block;width:auto;margin-right:0.5rem">' +
        APP_STATUSES.map(function (s) {
          return '<option value="' + esc(s.value) + '"' + (a.status === s.value ? ' selected' : '') + '>' + s.icon + ' ' + esc(s.label) + '</option>';
        }).join('') +
        '</select>' +
        '<button class="yb-btn yb-btn--primary yb-btn--sm" data-action="app-update-status">' + t('save') + '</button>' +
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

  /* ── Update Application Status ── */
  function updateAppStatus() {
    if (!currentAppId || !currentApp) return;

    var select = $('yb-app-status-select');
    if (!select) return;

    var newStatus = select.value;
    if (newStatus === currentApp.status) return;

    db.collection('applications').doc(currentAppId).update({
      status: newStatus,
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
      currentApp.status = newStatus;
      var idx = applications.findIndex(function (a) { return a.id === currentAppId; });
      if (idx !== -1) applications[idx].status = newStatus;

      renderApplicationDetailCard();
      renderApplicationStats();
      toast(t('saved'));
    }).catch(function (err) {
      console.error('[lead-admin] App status update error:', err);
      toast(t('error_save'), true);
    });
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
      db.collection('applications').orderBy('created_at', 'desc').limit(200).get().then(function (snap) {
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

    // Checkbox changes
    document.addEventListener('change', function (e) {
      if (e.target.classList.contains('yb-lead__cb')) {
        toggleSelectLead(e.target.getAttribute('data-lead-id'));
      }
      if (e.target.id === 'yb-lead-select-all') {
        toggleSelectAll();
      }
      // SMS template selector
      if (e.target.id === 'yb-sms-template-select') {
        var key = e.target.value;
        if (key && SMS_TEMPLATES[key]) {
          $('yb-sms-message').value = SMS_TEMPLATES[key];
          updateSMSCharCount();
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

    // Filters — Leads
    ['yb-lead-status-filter', 'yb-lead-type-filter', 'yb-lead-source-filter', 'yb-lead-priority-filter', 'yb-lead-temperature-filter'].forEach(function (filterId) {
      var el = $(filterId);
      if (el) {
        el.addEventListener('change', function () {
          if (filterId === 'yb-lead-status-filter') filterStatus = el.value;
          if (filterId === 'yb-lead-type-filter') filterType = el.value;
          if (filterId === 'yb-lead-source-filter') filterSource = el.value;
          if (filterId === 'yb-lead-priority-filter') filterPriority = el.value;
          if (filterId === 'yb-lead-temperature-filter') filterTemperature = el.value;
          loadLeads();
        });
      }
    });

    // Filters — Applications
    var appStatusFilter = $('yb-app-status-filter');
    if (appStatusFilter) {
      appStatusFilter.addEventListener('change', function () {
        appFilterStatus = appStatusFilter.value;
        loadApplications();
      });
    }
    var appTypeFilter = $('yb-app-type-filter');
    if (appTypeFilter) {
      appTypeFilter.addEventListener('change', function () {
        appFilterType = appTypeFilter.value;
        loadApplications();
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
        if (e.target.closest('button')) return;
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
        filterStatus = st || '';
        var filterEl = $('yb-lead-status-filter');
        if (filterEl) filterEl.value = filterStatus;
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
     INIT
     ══════════════════════════════════════════ */
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

    bindLeadEvents();

    // Hook into tab switching — Leads
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
  }

  // Bootstrap
  var checkInterval = setInterval(function () {
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
      clearInterval(checkInterval);
      initLeadAdmin();
    }
  }, 100);

})();
