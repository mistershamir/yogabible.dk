/**
 * YOGA BIBLE — LEAD ADMIN (Enhanced)
 * Full-featured Lead Manager for the admin panel.
 * Reads/writes directly to Firestore (client-side SDK).
 *
 * Features:
 *  - Sortable table with multi-column display
 *  - Primary status + sub-status + priority + temperature
 *  - Structured notes timeline (not plain text)
 *  - Follow-up scheduling with date picker
 *  - Call logging & attempt tracking
 *  - Inline SMS & email composers
 *  - Bulk select + bulk actions (status, email, SMS)
 *  - Source / date range / accommodation filters
 *  - CSV export
 *  - Pipeline stats
 */
(function () {
  'use strict';

  /* ── state ── */
  var db;
  var T = {};
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

  /* ── helpers ── */
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

  function getAuthToken() {
    return firebase.auth().currentUser.getIdToken();
  }

  /* ═══════════════════════════════════════
     STATUS SYSTEM
     ═══════════════════════════════════════ */
  var STATUSES = [
    { value: 'New', label: 'New', color: '#fff3cd', text: '#856404', icon: '\u2728' },
    { value: 'Contacted', label: 'Contacted', color: '#d1ecf1', text: '#0c5460', icon: '\ud83d\udce7' },
    { value: 'Follow-up', label: 'Follow-up', color: '#e8daef', text: '#6c3483', icon: '\ud83d\udd04' },
    { value: 'Engaged', label: 'Engaged', color: '#DCEDC8', text: '#33691E', icon: '\ud83d\udcac' },
    { value: 'Qualified', label: 'Qualified', color: '#B3E5FC', text: '#01579B', icon: '\u2705' },
    { value: 'Negotiating', label: 'Negotiating', color: '#FFE0B2', text: '#E65100', icon: '\ud83e\udd1d' },
    { value: 'Converted', label: 'Converted', color: '#d4edda', text: '#155724', icon: '\ud83c\udf89' },
    { value: 'Existing Applicant', label: 'Existing Applicant', color: '#cce5ff', text: '#004085', icon: '\ud83d\udcc4' },
    { value: 'On Hold', label: 'On Hold', color: '#FFF9C4', text: '#F57F17', icon: '\u23f8\ufe0f' },
    { value: 'Unsubscribed', label: 'Unsubscribed', color: '#f8d7da', text: '#721c24', icon: '\ud83d\udeab' },
    { value: 'Lost', label: 'Lost', color: '#ECEFF1', text: '#546E7F', icon: '\ud83d\udc4e' },
    { value: 'Closed', label: 'Closed', color: '#f5f5f5', text: '#9e9e9e', icon: '\u2716' }
  ];

  var SUB_STATUSES = {
    'New': ['Incoming', 'Needs Review', 'Auto-assigned'],
    'Contacted': ['First Email Sent', 'Called - No Answer', 'Called - Spoke', 'SMS Sent', 'WhatsApp Sent'],
    'Follow-up': ['Scheduled Call', 'Waiting Reply', 'Second Follow-up', 'Third Follow-up', 'Final Attempt'],
    'Engaged': ['Asking Questions', 'Price Discussion', 'Scheduling Visit', 'Reviewing Materials'],
    'Qualified': ['Ready to Apply', 'Needs Payment Info', 'Considering Dates'],
    'Negotiating': ['Payment Plan', 'Scholarship Request', 'Group Discount'],
    'Converted': ['Application Submitted', 'Payment Received', 'Enrolled'],
    'Existing Applicant': ['Re-inquiry', 'Upgrade Request', 'Referral'],
    'On Hold': ['Travel Issues', 'Financial', 'Personal Reasons', 'Next Cohort'],
    'Unsubscribed': ['Email Only', 'All Communications'],
    'Lost': ['No Response', 'Chose Competitor', 'Budget', 'Not Interested', 'Wrong Fit'],
    'Closed': ['Spam', 'Duplicate', 'Invalid Contact', 'Completed']
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

  function getStatusMeta(status) {
    return STATUSES.find(function (s) { return s.value === status; }) || STATUSES[0];
  }

  function statusBadgeHtml(status) {
    var m = getStatusMeta(status || 'New');
    return '<span class="yb-lead__badge" style="background:' + m.color + ';color:' + m.text + '">' +
      m.icon + ' ' + esc(m.label) + '</span>';
  }

  function priorityBadgeHtml(priority) {
    var p = PRIORITIES.find(function (x) { return x.value === priority; });
    if (!p || !p.value) return '';
    return '<span class="yb-lead__priority" title="' + p.label + '" style="color:' + p.color + '">' + p.icon + '</span>';
  }

  function temperatureBadgeHtml(temp) {
    var t = TEMPERATURES.find(function (x) { return x.value === temp; });
    if (!t || !t.value) return '';
    return '<span class="yb-lead__temp" title="' + t.label + '">' + t.icon + '</span>';
  }

  function typeBadge(type) {
    var labels = { ytt: 'YTT', course: 'Course', bundle: 'Bundle', mentorship: 'Mentorship', careers: 'Career', contact: 'Contact' };
    return labels[(type || '').toLowerCase()] || type || '\u2014';
  }

  /* ═══════════════════════════════════════
     LOAD LEADS
     ═══════════════════════════════════════ */
  function loadLeads(append) {
    if (!append) {
      leads = [];
      lastDoc = null;
      selectedIds.clear();
      selectAll = false;
    }

    var query = db.collection('leads').orderBy(sortField, sortDir);

    if (filterStatus) query = query.where('status', '==', filterStatus);
    if (filterType) query = query.where('type', '==', filterType);
    if (filterSource) query = query.where('source', '==', filterSource);
    if (filterPriority) query = query.where('priority', '==', filterPriority);
    if (filterTemperature) query = query.where('temperature', '==', filterTemperature);
    if (lastDoc) query = query.startAfter(lastDoc);

    query.limit(PAGE_SIZE).get().then(function (snap) {
      snap.forEach(function (doc) {
        leads.push(Object.assign({ id: doc.id }, doc.data()));
      });
      lastDoc = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;

      renderLeadTable();
      renderLeadStats();
      updateBulkBar();

      var loadMore = $('yb-lead-load-more-wrap');
      if (loadMore) loadMore.hidden = snap.docs.length < PAGE_SIZE;

    }).catch(function (err) {
      console.error('[lead-admin] Load error:', err);
      toast(t('error_load'), true);
    });
  }

  /* ═══════════════════════════════════════
     RENDER LEAD TABLE
     ═══════════════════════════════════════ */
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

  function renderLeadTable() {
    var tbody = $('yb-lead-table-body');
    if (!tbody) return;

    var filtered = getFilteredLeads();

    // Update count display
    var countEl = $('yb-lead-count');
    if (countEl) countEl.textContent = filtered.length + ' ' + t('leads_of') + ' ' + leads.length;

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--yb-muted)">' + t('leads_no_leads') + '</td></tr>';
      return;
    }

    var selectAllChecked = selectAll ? ' checked' : '';

    // Update header checkbox
    var headerCb = $('yb-lead-select-all');
    if (headerCb) headerCb.checked = selectAll;

    tbody.innerHTML = filtered.map(function (l) {
      var isSelected = selectedIds.has(l.id);
      var followupClass = '';
      if (l.followup_date) {
        var fDate = l.followup_date.toDate ? l.followup_date.toDate() : new Date(l.followup_date);
        var today = new Date();
        today.setHours(0, 0, 0, 0);
        if (fDate <= today) followupClass = ' yb-lead__row--overdue';
        else if (fDate <= new Date(today.getTime() + 86400000)) followupClass = ' yb-lead__row--due-today';
      }

      return '<tr class="yb-lead__row' + followupClass + (isSelected ? ' is-selected' : '') + '" data-id="' + l.id + '">' +
        '<td class="yb-lead__cell-cb"><input type="checkbox" class="yb-lead__cb" data-lead-id="' + l.id + '"' + (isSelected ? ' checked' : '') + '></td>' +
        '<td class="yb-lead__cell-date">' + relativeTime(l.created_at) + '</td>' +
        '<td class="yb-lead__cell-name">' +
          priorityBadgeHtml(l.priority) + temperatureBadgeHtml(l.temperature) +
          esc((l.first_name || '') + ' ' + (l.last_name || '')).trim() +
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
        '<td class="yb-lead__cell-actions">' +
          '<button class="yb-admin__icon-btn" data-action="view-lead" data-id="' + l.id + '" title="' + t('users_view') + '">\u2192</button>' +
        '</td>' +
        '</tr>';
    }).join('');
  }

  /* ═══════════════════════════════════════
     RENDER STATS (Pipeline)
     ═══════════════════════════════════════ */
  function renderLeadStats() {
    var el = $('yb-lead-stats');
    if (!el) return;

    var total = leads.length;
    var counts = {};
    STATUSES.forEach(function (s) { counts[s.value] = 0; });
    leads.forEach(function (l) {
      var st = l.status || 'New';
      if (counts[st] !== undefined) counts[st]++;
    });

    // Pipeline funnel stats
    var pipeline = leads.filter(function (l) {
      return ['New', 'Contacted', 'Follow-up', 'Engaged', 'Qualified', 'Negotiating'].indexOf(l.status) !== -1;
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

  /* ═══════════════════════════════════════
     VIEW LEAD DETAIL
     ═══════════════════════════════════════ */
  function showLeadDetail(leadId) {
    currentLeadId = leadId;
    currentLead = leads.find(function (l) { return l.id === leadId; });
    if (!currentLead) return;

    $('yb-admin-v-lead-list').hidden = true;
    $('yb-admin-v-lead-detail').hidden = false;

    $('yb-lead-detail-heading').textContent = (currentLead.first_name || '') + ' ' + (currentLead.last_name || '');

    renderLeadDetailCard();
    renderLeadQuickActions();
    populateStatusForm();
    renderLeadNotes();
    loadLeadActivity();
  }

  function backToLeadList() {
    $('yb-admin-v-lead-list').hidden = false;
    $('yb-admin-v-lead-detail').hidden = true;
    currentLeadId = null;
    currentLead = null;
    renderLeadTable(); // refresh in case changes were made
  }

  function renderLeadDetailCard() {
    var el = $('yb-lead-detail-card');
    if (!el || !currentLead) return;
    var l = currentLead;

    var statusMeta = getStatusMeta(l.status);
    var priorityMeta = PRIORITIES.find(function (p) { return p.value === l.priority; });
    var tempMeta = TEMPERATURES.find(function (t) { return t.value === l.temperature; });

    // Build two-column layout for detail info
    var html = '<div class="yb-lead__detail-grid">';

    // Left column — contact info
    html += '<div class="yb-lead__detail-section">';
    html += '<h4 class="yb-lead__detail-section-title">' + t('leads_contact_info') + '</h4>';
    html += '<div class="yb-lead__detail-row"><span class="yb-lead__detail-label">' + t('users_col_email') + '</span>' +
      '<a href="mailto:' + esc(l.email) + '" class="yb-lead__detail-link">' + esc(l.email) + '</a></div>';
    html += '<div class="yb-lead__detail-row"><span class="yb-lead__detail-label">' + t('users_profile_phone') + '</span>' +
      (l.phone ? '<a href="tel:' + esc(l.phone) + '" class="yb-lead__detail-link">' + esc(l.phone) + '</a>' : '\u2014') + '</div>';
    html += '<div class="yb-lead__detail-row"><span class="yb-lead__detail-label">' + t('leads_source') + '</span>' + esc(l.source || '\u2014') + '</div>';
    html += '<div class="yb-lead__detail-row"><span class="yb-lead__detail-label">' + t('leads_col_date') + '</span>' + fmtDateTime(l.created_at) + '</div>';
    if (l.city_country) {
      html += '<div class="yb-lead__detail-row"><span class="yb-lead__detail-label">' + t('leads_city') + '</span>' + esc(l.city_country) + '</div>';
    }
    html += '</div>';

    // Right column — program info
    html += '<div class="yb-lead__detail-section">';
    html += '<h4 class="yb-lead__detail-section-title">' + t('leads_program_info') + '</h4>';
    html += '<div class="yb-lead__detail-row"><span class="yb-lead__detail-label">' + t('leads_col_type') + '</span>' +
      '<span class="yb-lead__type-badge">' + typeBadge(l.type) + '</span></div>';
    if (l.program) {
      html += '<div class="yb-lead__detail-row"><span class="yb-lead__detail-label">' + t('leads_col_program') + '</span>' + esc(l.program) + '</div>';
    }
    if (l.ytt_program_type) {
      html += '<div class="yb-lead__detail-row"><span class="yb-lead__detail-label">YTT Format</span>' + esc(l.ytt_program_type) + '</div>';
    }
    if (l.cohort_label) {
      html += '<div class="yb-lead__detail-row"><span class="yb-lead__detail-label">' + t('leads_cohort') + '</span>' + esc(l.cohort_label) + '</div>';
    }
    if (l.preferred_month) {
      html += '<div class="yb-lead__detail-row"><span class="yb-lead__detail-label">' + t('leads_preferred_month') + '</span>' + esc(l.preferred_month) + '</div>';
    }
    if (l.accommodation && l.accommodation !== 'No') {
      html += '<div class="yb-lead__detail-row"><span class="yb-lead__detail-label">' + t('leads_accommodation') + '</span>' +
        '<span class="yb-lead__badge" style="background:#E8F5E9;color:#2E7D32">\ud83c\udfe0 ' + esc(l.accommodation) + '</span></div>';
    }
    if (l.housing_months) {
      html += '<div class="yb-lead__detail-row"><span class="yb-lead__detail-label">' + t('leads_housing_months') + '</span>' + esc(l.housing_months) + '</div>';
    }
    if (l.service) {
      html += '<div class="yb-lead__detail-row"><span class="yb-lead__detail-label">' + t('leads_service') + '</span>' + esc(l.service) + '</div>';
    }
    if (l.message) {
      html += '<div class="yb-lead__detail-row yb-lead__detail-row--full"><span class="yb-lead__detail-label">' + t('leads_message') + '</span>' +
        '<div class="yb-lead__detail-message">' + esc(l.message) + '</div></div>';
    }
    html += '</div>';

    // Status bar
    html += '<div class="yb-lead__detail-status-bar">';
    html += '<div class="yb-lead__detail-row"><span class="yb-lead__detail-label">' + t('leads_col_status') + '</span>' + statusBadgeHtml(l.status) +
      (l.sub_status ? ' <span class="yb-lead__sub-status">' + esc(l.sub_status) + '</span>' : '') + '</div>';
    if (l.priority) {
      html += '<div class="yb-lead__detail-row"><span class="yb-lead__detail-label">' + t('leads_priority') + '</span>' + priorityBadgeHtml(l.priority) + ' ' + (priorityMeta ? priorityMeta.label : '') + '</div>';
    }
    if (l.temperature) {
      html += '<div class="yb-lead__detail-row"><span class="yb-lead__detail-label">' + t('leads_temperature') + '</span>' + temperatureBadgeHtml(l.temperature) + ' ' + (tempMeta ? tempMeta.label : '') + '</div>';
    }
    html += '<div class="yb-lead__detail-row"><span class="yb-lead__detail-label">' + t('leads_last_contact') + '</span>' + fmtDateTime(l.last_contact) + '</div>';
    html += '<div class="yb-lead__detail-row"><span class="yb-lead__detail-label">' + t('leads_followup') + '</span>' + fmtDate(l.followup_date) + '</div>';
    html += '<div class="yb-lead__detail-row"><span class="yb-lead__detail-label">' + t('leads_call_attempts') + '</span>' + (l.call_attempts || 0) + '</div>';
    html += '<div class="yb-lead__detail-row"><span class="yb-lead__detail-label">' + t('leads_sms_status') + '</span>' + esc(l.sms_status || '\u2014') + '</div>';
    if (l.application_id) {
      html += '<div class="yb-lead__detail-row"><span class="yb-lead__detail-label">' + t('leads_application_id') + '</span>' +
        '<span class="yb-lead__badge" style="background:#d4edda;color:#155724">' + esc(l.application_id) + '</span></div>';
    }
    html += '</div>';

    html += '</div>'; // end grid

    el.innerHTML = html;
  }

  /* ═══════════════════════════════════════
     QUICK ACTIONS
     ═══════════════════════════════════════ */
  function renderLeadQuickActions() {
    var el = $('yb-lead-actions');
    if (!el || !currentLead) return;

    var phone = currentLead.phone || '';
    var email = currentLead.email || '';

    el.innerHTML =
      (phone ? '<a href="tel:' + esc(phone) + '" class="yb-btn yb-btn--outline yb-btn--sm" data-action="log-call">\ud83d\udcde ' + t('leads_call') + '</a>' : '') +
      (phone ? '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="lead-sms">\ud83d\udcf1 ' + t('leads_sms') + '</button>' : '') +
      (phone ? '<a href="https://wa.me/' + esc(phone.replace(/[^0-9+]/g, '')) + '" target="_blank" class="yb-btn yb-btn--outline yb-btn--sm">\ud83d\udcac WhatsApp</a>' : '') +
      (email ? '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="lead-email">\u2709\ufe0f ' + t('leads_email') + '</button>' : '') +
      '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="lead-add-note">\ud83d\udcdd ' + t('leads_add_note') + '</button>' +
      '<button class="yb-btn yb-btn--outline yb-btn--sm yb-admin__icon-btn--danger" data-action="delete-lead" data-id="' + currentLeadId + '">\ud83d\uddd1 ' + t('delete') + '</button>';
  }

  /* ═══════════════════════════════════════
     STATUS + SETTINGS FORM
     ═══════════════════════════════════════ */
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

  /* ═══════════════════════════════════════
     NOTES TIMELINE
     ═══════════════════════════════════════ */
  function renderLeadNotes() {
    var el = $('yb-lead-notes-timeline');
    if (!el || !currentLead) return;

    var notes = currentLead.notes;

    // Support old format (plain string) and new format (array of objects)
    if (typeof notes === 'string' && notes) {
      // Old format — show as single note
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

  /* ═══════════════════════════════════════
     DELETE LEAD
     ═══════════════════════════════════════ */
  function deleteLead(leadId) {
    if (!confirm(t('leads_confirm_delete'))) return;

    db.collection('leads').doc(leadId).delete().then(function () {
      leads = leads.filter(function (l) { return l.id !== leadId; });
      backToLeadList();
      renderLeadTable();
      renderLeadStats();
      toast(t('saved'));
    }).catch(function (err) {
      console.error('[lead-admin] Delete error:', err);
      toast(t('error_save'), true);
    });
  }

  /* ═══════════════════════════════════════
     ACTIVITY LOG (Email + SMS)
     ═══════════════════════════════════════ */
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

  /* ═══════════════════════════════════════
     SMS COMPOSER
     ═══════════════════════════════════════ */
  function openSMSComposer(leadOrLeads) {
    var modal = $('yb-lead-sms-modal');
    if (!modal) return;

    var isBulk = Array.isArray(leadOrLeads);
    var recipients = isBulk ? leadOrLeads : [leadOrLeads || currentLead];
    var recipientCount = recipients.filter(function (l) { return l && l.phone; }).length;

    $('yb-sms-recipient-info').textContent = isBulk ?
      recipientCount + ' ' + t('leads_recipients') :
      (recipients[0].first_name || '') + ' (' + (recipients[0].phone || '') + ')';

    $('yb-sms-message').value = isBulk ? '' : ('Hi ' + (recipients[0].first_name || '') + '! ');
    $('yb-sms-char-count').textContent = '0/160';

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

  /* ═══════════════════════════════════════
     EMAIL COMPOSER
     ═══════════════════════════════════════ */
  function openEmailComposer(leadOrLeads) {
    var modal = $('yb-lead-email-modal');
    if (!modal) return;

    var isBulk = Array.isArray(leadOrLeads);
    var recipients = isBulk ? leadOrLeads : [leadOrLeads || currentLead];

    $('yb-email-recipient-info').textContent = isBulk ?
      recipients.length + ' ' + t('leads_recipients') :
      (recipients[0].first_name || '') + ' (' + (recipients[0].email || '') + ')';

    $('yb-email-subject').value = '';
    $('yb-email-body').value = '';

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

  /* helper — add note without prompt */
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

  /* ═══════════════════════════════════════
     BULK OPERATIONS
     ═══════════════════════════════════════ */
  function updateBulkBar() {
    var bar = $('yb-lead-bulk-bar');
    if (!bar) return;

    if (selectedIds.size === 0) {
      bar.hidden = true;
      return;
    }

    bar.hidden = false;
    $('yb-lead-bulk-count').textContent = selectedIds.size + ' ' + t('leads_selected');
  }

  function toggleSelectAll() {
    selectAll = !selectAll;
    var filtered = getFilteredLeads();
    if (selectAll) {
      filtered.forEach(function (l) { selectedIds.add(l.id); });
    } else {
      selectedIds.clear();
    }
    renderLeadTable();
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
      renderLeadTable();
      renderLeadStats();
      updateBulkBar();
      toast(t('saved'));
    }).catch(function (err) {
      toast(t('error_save') + ': ' + err.message, true);
    });
  }

  function bulkSMS() {
    var selected = leads.filter(function (l) { return selectedIds.has(l.id) && l.phone; });
    if (!selected.length) { toast(t('leads_no_phone'), true); return; }
    openSMSComposer(selected);
  }

  function bulkEmail() {
    var selected = leads.filter(function (l) { return selectedIds.has(l.id) && l.email; });
    if (!selected.length) { toast(t('leads_no_email_addr'), true); return; }
    openEmailComposer(selected);
  }

  /* ═══════════════════════════════════════
     CSV EXPORT
     ═══════════════════════════════════════ */
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

  /* ═══════════════════════════════════════
     SORT
     ═══════════════════════════════════════ */
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

  /* ═══════════════════════════════════════
     SMS prompt (legacy fallback)
     ═══════════════════════════════════════ */
  function promptSendSMS() {
    if (!currentLead || !currentLead.phone) return;
    openSMSComposer();
  }

  /* ═══════════════════════════════════════
     EVENT BINDING
     ═══════════════════════════════════════ */
  function bindLeadEvents() {
    // Delegated click handler
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-action');
      var id = btn.getAttribute('data-id');

      switch (action) {
        case 'view-lead': e.preventDefault(); showLeadDetail(id); break;
        case 'back-leads': backToLeadList(); break;
        case 'leads-refresh': loadLeads(); break;
        case 'leads-load-more': loadLeads(true); break;
        case 'delete-lead': deleteLead(id || currentLeadId); break;
        case 'lead-sms': openSMSComposer(); break;
        case 'lead-email': openEmailComposer(); break;
        case 'lead-add-note': addNote('note'); break;
        case 'log-call': e.preventDefault(); logCall(); break;
        case 'leads-export-csv': exportCSV(); break;
        case 'leads-select-all': toggleSelectAll(); break;
        case 'bulk-status': bulkUpdateStatus(); break;
        case 'bulk-sms': bulkSMS(); break;
        case 'bulk-email': bulkEmail(); break;
        case 'bulk-deselect': selectedIds.clear(); selectAll = false; renderLeadTable(); updateBulkBar(); break;
        case 'sms-send': sendSMSFromComposer(); break;
        case 'sms-cancel': $('yb-lead-sms-modal').hidden = true; break;
        case 'email-send': sendEmailFromComposer(); break;
        case 'email-cancel': $('yb-lead-email-modal').hidden = true; break;
        case 'lead-note-submit':
          addNote('note');
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
    });

    // Search form
    var searchForm = $('yb-lead-search-form');
    if (searchForm) {
      searchForm.addEventListener('submit', function (e) {
        e.preventDefault();
        searchTerm = ($('yb-lead-search-input') || {}).value || '';
        renderLeadTable();
      });
      // Live search
      var searchInput = $('yb-lead-search-input');
      if (searchInput) {
        searchInput.addEventListener('input', function () {
          searchTerm = searchInput.value || '';
          renderLeadTable();
        });
      }
    }

    // Filters
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

    // Status form
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

    // Row click
    var table = $('yb-lead-table');
    if (table) {
      table.addEventListener('click', function (e) {
        // Don't trigger on checkbox or button clicks
        if (e.target.closest('input[type="checkbox"]') || e.target.closest('button')) return;
        var row = e.target.closest('.yb-lead__row');
        if (row) {
          var id = row.getAttribute('data-id');
          if (id) showLeadDetail(id);
        }
      });
    }

    // Stat card click → filter
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
  }

  /* ═══════════════════════════════════════
     INIT
     ═══════════════════════════════════════ */
  function initLeadAdmin() {
    T = window._ybAdminT || {};

    if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) return;
    db = firebase.firestore();

    bindLeadEvents();

    // Hook into tab switching
    document.querySelectorAll('[data-yb-admin-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.getAttribute('data-yb-admin-tab') === 'leads' && !leadsLoaded) {
          loadLeads();
          leadsLoaded = true;
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
