/**
 * YOGA BIBLE — SEQUENCES ADMIN
 * Manages email/SMS automation sequences: CRUD, step builder, enrollment management.
 * Loaded on the admin panel under the "Campaign" tab (sequences sub-nav).
 */
(function () {
  'use strict';

  /* ═══════════════════════════════════════════
     STATE
     ═══════════════════════════════════════════ */
  var sequences = [];
  var currentSequence = null;
  var enrollments = [];
  var leadSearchResults = [];
  var _seqInit = false;
  var _searchTimer = null;

  /* ═══════════════════════════════════════════
     HELPERS (mirror email-lists-admin.js)
     ═══════════════════════════════════════════ */
  function $(id) { return document.getElementById(id); }
  function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function toast(msg, isError) {
    if (window._ybLeadData && window._ybLeadData.toast) {
      window._ybLeadData.toast(msg, isError);
    } else {
      alert(msg);
    }
  }

  function getToken() {
    if (window.firebase && firebase.auth().currentUser) {
      return firebase.auth().currentUser.getIdToken();
    }
    return Promise.reject(new Error('Not authenticated'));
  }

  function api(method, path, body) {
    return getToken().then(function (token) {
      var opts = {
        method: method,
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }
      };
      if (body) opts.body = JSON.stringify(body);
      return fetch('/.netlify/functions/' + path, opts).then(function (r) { return r.json(); });
    });
  }

  function formatDate(d) {
    if (!d) return '—';
    var date = new Date(d);
    return date.toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function formatDateTime(d) {
    if (!d) return '—';
    var date = new Date(d);
    return date.toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric' }) +
      ' ' + date.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
  }

  /* ═══════════════════════════════════════════
     FALLBACK DATA
     ═══════════════════════════════════════════ */
  var FALLBACK_TYPES = [
    { value: '', label: 'All Types' },
    { value: 'ytt', label: 'YTT' },
    { value: 'course', label: 'Course' },
    { value: 'bundle', label: 'Bundle' },
    { value: 'mentorship', label: 'Mentorship' },
    { value: 'careers', label: 'Careers' },
    { value: 'contact', label: 'Contact' }
  ];

  var FALLBACK_SOURCES = [
    '', 'Facebook Ad', '200h YTT', '300h YTT', '50h YTT', '30h YTT',
    'Courses', 'Mentorship', 'Apply page', 'Contact page', 'Careers page', 'Manual entry'
  ];

  var FALLBACK_PROGRAMS = [
    { value: '', label: 'All Programs' },
    { value: '4-week', label: '4-Week Intensive' },
    { value: '4-week-jul', label: '4-Week July Intensive' },
    { value: '8-week', label: '8-Week Semi-Intensive' },
    { value: '18-week', label: '18-Week Flexible (Spring)' },
    { value: '18-week-aug', label: '18-Week Flexible (Autumn)' },
    { value: '300h', label: '300h Advanced' },
    { value: '50h', label: '50h Specialty' },
    { value: '30h', label: '30h Module' }
  ];

  var FALLBACK_STATUSES = [
    { value: 'New', label: 'New', color: '#fff3cd', text: '#856404' },
    { value: 'Contacted', label: 'Contacted', color: '#d1ecf1', text: '#0c5460' },
    { value: 'No Answer', label: 'No Answer', color: '#FFE0CC', text: '#BF360C' },
    { value: 'Follow-up', label: 'Follow-up', color: '#e8daef', text: '#6c3483' },
    { value: 'Engaged', label: 'Engaged', color: '#DCEDC8', text: '#33691E' },
    { value: 'Strongly Interested', label: 'Strongly Interested', color: '#FFF9C4', text: '#F57F17' },
    { value: 'Qualified', label: 'Qualified', color: '#B3E5FC', text: '#01579B' },
    { value: 'Negotiating', label: 'Negotiating', color: '#FFE0B2', text: '#E65100' },
    { value: 'Converted', label: 'Converted', color: '#d4edda', text: '#155724' },
    { value: 'Existing Applicant', label: 'Existing Applicant', color: '#cce5ff', text: '#004085' },
    { value: 'On Hold', label: 'On Hold', color: '#FFF9C4', text: '#F57F17' },
    { value: 'Interested In Next Round', label: 'Interested In Next Round', color: '#E0F2F1', text: '#00695C' },
    { value: 'Not too keen', label: 'Not too keen', color: '#CFD8DC', text: '#37474F' },
    { value: 'Unsubscribed', label: 'Unsubscribed', color: '#f8d7da', text: '#721c24' },
    { value: 'Lost', label: 'Lost', color: '#ECEFF1', text: '#546E7F' },
    { value: 'Closed', label: 'Closed', color: '#f5f5f5', text: '#9e9e9e' },
    { value: 'Archived', label: 'Archived', color: '#EFEBE9', text: '#795548' }
  ];

  var EXIT_STATUSES = ['converted', 'unsubscribed', 'lost', 'closed', 'not too keen', 'archived'];

  var TRIGGER_LABELS = {
    manual: 'Manual',
    new_lead: 'New Lead',
    status_change: 'Status Change'
  };

  var CHANNEL_OPTIONS = [
    { value: 'email', label: 'Email Only' },
    { value: 'sms', label: 'SMS Only' },
    { value: 'both', label: 'Both Email + SMS' }
  ];

  var VAR_HINTS = '{{first_name}}, {{last_name}}, {{email}}, {{phone}}, {{program}}, {{unsubscribe_url}}';

  /* ═══════════════════════════════════════════
     DATA BRIDGE ACCESSORS
     ═══════════════════════════════════════════ */
  function getLeadTypes() {
    if (window._ybLeadData && window._ybLeadData.types) {
      return window._ybLeadData.types;
    }
    return FALLBACK_TYPES;
  }

  function getLeadSources() {
    if (window._ybLeadData && window._ybLeadData.sources) {
      return window._ybLeadData.sources;
    }
    return FALLBACK_SOURCES;
  }

  function getLeadPrograms() {
    if (window._ybLeadData && window._ybLeadData.programs) {
      return window._ybLeadData.programs;
    }
    return FALLBACK_PROGRAMS;
  }

  function getStatuses() {
    if (window._ybLeadData && window._ybLeadData.statuses) {
      return window._ybLeadData.statuses;
    }
    return FALLBACK_STATUSES;
  }

  /* ═══════════════════════════════════════════
     INIT
     ═══════════════════════════════════════════ */
  function initSequences() {
    var panel = document.querySelector('[data-yb-admin-panel="email-lists"]');
    if (!panel) return;

    // Attach delegated listeners on the sequences sections
    var seqSec = $('yb-el-sec-sequences');
    if (!seqSec) return;

    seqSec.addEventListener('click', handleClick);
    seqSec.addEventListener('change', handleChange);
    seqSec.addEventListener('input', handleInput);

    populateConditionDropdowns();
    loadSequences();
  }

  // Listen for sequences sub-nav activation
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-subnav="sequences"]');
    if (btn && !_seqInit) {
      _seqInit = true;
      setTimeout(initSequences, 50);
    }
  });

  /* ═══════════════════════════════════════════
     EVENT HANDLERS
     ═══════════════════════════════════════════ */
  function handleClick(e) {
    var action = e.target.closest('[data-action]');
    if (!action) return;
    var a = action.getAttribute('data-action');

    switch (a) {
      case 'seq-new':           openBuilder(null); break;
      case 'seq-refresh':       loadSequences(); break;
      case 'seq-back-list':     showListView(); break;
      case 'seq-add-step':      addStep(); break;
      case 'seq-save':          saveSequence(); break;
      case 'seq-clear-enrollment-closes':
        $('yb-seq-enrollment-closes').value = '';
        updateEnrollmentStatus('');
        break;
    }

    // Sequence card actions
    var seqId = action.getAttribute('data-seq-id');
    if (a === 'seq-edit' && seqId) openBuilder(seqId);
    if (a === 'seq-enrollments' && seqId) openEnrollments(seqId);
    if (a === 'seq-duplicate' && seqId) duplicateSequence(seqId);
    if (a === 'seq-delete' && seqId) deleteSequence(seqId);
    if (a === 'seq-toggle-active' && seqId) toggleActive(seqId);

    // Step actions
    var stepIdx = action.getAttribute('data-step-idx');
    if (stepIdx !== null && stepIdx !== undefined) {
      stepIdx = parseInt(stepIdx);
      if (a === 'seq-step-up') moveStep(stepIdx, -1);
      if (a === 'seq-step-down') moveStep(stepIdx, 1);
      if (a === 'seq-step-remove') removeStep(stepIdx);
    }

    // Enrollment actions
    var enrollId = action.getAttribute('data-enroll-id');
    if (a === 'seq-enroll-pause' && enrollId) toggleEnrollmentPause(enrollId, true);
    if (a === 'seq-enroll-resume' && enrollId) toggleEnrollmentPause(enrollId, false);
    if (a === 'seq-enroll-remove' && enrollId) removeEnrollment(enrollId);

    // Lead search result click
    var leadId = action.getAttribute('data-lead-id');
    if (a === 'seq-enroll-lead' && leadId) enrollLead(leadId);
  }

  function handleChange(e) {
    // Enrollment closes date change
    if (e.target.id === 'yb-seq-enrollment-closes') {
      var val = e.target.value;
      updateEnrollmentStatus(val ? new Date(val + 'T00:00:00Z').toISOString() : '');
    }

    // Trigger type change — show/hide conditions panel
    if (e.target.id === 'yb-seq-trigger-type') {
      var val = e.target.value;
      var panel = $('yb-seq-conditions-panel');
      var statusField = $('yb-seq-cond-status-field');
      if (panel) panel.hidden = (val === 'manual');
      if (statusField) statusField.hidden = (val !== 'status_change');
    }

    // Channel change on steps — show/hide email/sms sections
    if (e.target.className && e.target.className.indexOf('yb-seq__channel-select') !== -1) {
      var stepEl = e.target.closest('.yb-seq__step');
      if (stepEl) {
        var channel = e.target.value;
        var emailSec = stepEl.querySelector('.yb-seq__step-email');
        var smsSec = stepEl.querySelector('.yb-seq__step-sms');
        if (emailSec) emailSec.hidden = (channel === 'sms');
        if (smsSec) smsSec.hidden = (channel === 'email');
      }
    }
  }

  function handleInput(e) {
    // Lead search for enrollments
    if (e.target.id === 'yb-seq-lead-search') {
      var term = e.target.value.trim();
      clearTimeout(_searchTimer);
      if (term.length < 2) {
        hideLeadResults();
        return;
      }
      _searchTimer = setTimeout(function () { searchLeads(term); }, 300);
    }

    // SMS character count
    if (e.target.className && e.target.className.indexOf('yb-seq__sms-text') !== -1) {
      var counter = e.target.parentNode.querySelector('.yb-seq__sms-count');
      if (counter) {
        counter.textContent = e.target.value.length + ' chars';
      }
    }
  }

  /* ═══════════════════════════════════════════
     POPULATE CONDITION DROPDOWNS
     ═══════════════════════════════════════════ */
  function populateConditionDropdowns() {
    // Lead Type
    var typeSelect = $('yb-seq-cond-type');
    if (typeSelect) {
      var types = getLeadTypes();
      var typeHtml = '<option value="">All Types</option>';
      types.forEach(function (t) {
        if (t.value === '' && t.label) return; // skip the "All Types" from fallback, we already have it
        var val = typeof t === 'string' ? t : t.value;
        var lbl = typeof t === 'string' ? t : (t.label || t.value);
        if (!val) return;
        typeHtml += '<option value="' + esc(val) + '">' + esc(lbl) + '</option>';
      });
      typeSelect.innerHTML = typeHtml;
    }

    // Source Contains
    var sourceSelect = $('yb-seq-cond-source');
    if (sourceSelect) {
      var sources = getLeadSources();
      var srcHtml = '<option value="">All Sources</option>';
      sources.forEach(function (s) {
        var val = typeof s === 'string' ? s : (s.value || s);
        var lbl = typeof s === 'string' ? s : (s.label || s.value || s);
        if (!val) return;
        srcHtml += '<option value="' + esc(val) + '">' + esc(lbl) + '</option>';
      });
      sourceSelect.innerHTML = srcHtml;
    }

    // Program
    var progSelect = $('yb-seq-cond-program');
    if (progSelect) {
      var programs = getLeadPrograms();
      var progHtml = '<option value="">All Programs</option>';
      programs.forEach(function (p) {
        var val = typeof p === 'string' ? p : p.value;
        var lbl = typeof p === 'string' ? p : (p.label || p.value);
        if (!val) return;
        progHtml += '<option value="' + esc(val) + '">' + esc(lbl) + '</option>';
      });
      progSelect.innerHTML = progHtml;
    }

    // Status (for status_change trigger)
    var statusSelect = $('yb-seq-cond-status');
    if (statusSelect) {
      var statuses = getStatuses();
      var statHtml = '<option value="">Any Status</option>';
      statuses.forEach(function (s) {
        statHtml += '<option value="' + esc(s.value) + '">' + esc(s.label) + '</option>';
      });
      statusSelect.innerHTML = statHtml;
    }
  }

  /* ═══════════════════════════════════════════
     VIEW SWITCHING
     ═══════════════════════════════════════════ */
  function showListView() {
    $('yb-seq-v-list').hidden = false;
    $('yb-seq-v-builder').hidden = true;
    $('yb-seq-v-enrollments').hidden = true;
    currentSequence = null;
    enrollments = [];
  }

  function showBuilderView() {
    $('yb-seq-v-list').hidden = true;
    $('yb-seq-v-builder').hidden = false;
    $('yb-seq-v-enrollments').hidden = true;
  }

  function showEnrollmentsView() {
    $('yb-seq-v-list').hidden = true;
    $('yb-seq-v-builder').hidden = true;
    $('yb-seq-v-enrollments').hidden = false;
  }

  /* ═══════════════════════════════════════════
     SEQUENCES LIST
     ═══════════════════════════════════════════ */
  function loadSequences() {
    var container = $('yb-seq-card-list');
    if (container) container.innerHTML = '<p style="color:#6F6A66;padding:20px;text-align:center;">Loading sequences...</p>';

    api('GET', 'sequences').then(function (data) {
      if (!data.ok) { toast('Failed to load sequences', true); return; }
      sequences = (data.sequences || []).map(function (seq) {
        // Normalize: backend stores trigger as nested object { type, conditions }
        // but UI code references seq.trigger_type and seq.conditions as flat fields
        if (seq.trigger && !seq.trigger_type) {
          seq.trigger_type = seq.trigger.type || 'manual';
          seq.conditions = seq.trigger.conditions || {};
        }
        if (!seq.trigger_type) seq.trigger_type = 'manual';
        if (!seq.conditions) seq.conditions = {};
        return seq;
      });
      renderSequenceCards();
      renderStats();
    }).catch(function (err) { toast('Error: ' + err.message, true); });
  }

  function renderSequenceCards() {
    var container = $('yb-seq-card-list');
    if (!container) return;

    if (sequences.length === 0) {
      container.innerHTML = '<p class="yb-admin__empty" style="padding:40px;text-align:center;">' +
        'No sequences yet. Click "New Sequence" to create your first automation.' +
        '</p>';
      return;
    }

    var html = '';
    sequences.forEach(function (seq) {
      var triggerCls = 'yb-seq__badge yb-seq__badge--' + (seq.trigger_type || 'manual');
      var statusCls = seq.active ? 'yb-seq__badge--active' : 'yb-seq__badge--paused';
      var stepCount = (seq.steps && seq.steps.length) || 0;
      var activeEnrollments = seq.enrollment_stats ? (seq.enrollment_stats.active || 0) : 0;
      var completedEnrollments = seq.enrollment_stats ? (seq.enrollment_stats.completed || 0) : 0;

      html += '<div class="yb-seq__card">' +
        '<div class="yb-seq__card-header">' +
          '<div>' +
            '<h3>' + esc(seq.name) + '</h3>' +
            (seq.description ? '<p style="color:#6F6A66;font-size:13px;margin:4px 0 0;">' + esc(seq.description) + '</p>' : '') +
          '</div>' +
          '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">' +
            '<span class="' + triggerCls + '">' + esc(TRIGGER_LABELS[seq.trigger_type] || seq.trigger_type || 'Manual') + '</span>' +
            '<span class="yb-seq__badge ' + statusCls + '">' + (seq.active ? 'Active' : 'Paused') + '</span>' +
            enrollmentStatusBadge(seq.enrollment_closes) +
          '</div>' +
        '</div>' +
        '<div class="yb-seq__card-body">' +
          '<div class="yb-seq__card-stat"><strong>' + stepCount + '</strong> step' + (stepCount !== 1 ? 's' : '') + '</div>' +
          '<div class="yb-seq__card-stat"><strong>' + activeEnrollments + '</strong> active</div>' +
          '<div class="yb-seq__card-stat"><strong>' + completedEnrollments + '</strong> completed</div>' +
          (seq.trigger_type !== 'manual' && seq.conditions ? renderConditionSummary(seq.conditions) : '') +
        '</div>' +
        '<div class="yb-seq__card-actions">' +
          '<button class="yb-btn yb-btn--outline yb-btn--xs" data-action="seq-edit" data-seq-id="' + seq.id + '">Edit</button> ' +
          '<button class="yb-btn yb-btn--outline yb-btn--xs" data-action="seq-enrollments" data-seq-id="' + seq.id + '">Enrollments</button> ' +
          '<button class="yb-btn yb-btn--outline yb-btn--xs" data-action="seq-toggle-active" data-seq-id="' + seq.id + '">' +
            (seq.active ? 'Pause' : 'Activate') +
          '</button> ' +
          '<button class="yb-btn yb-btn--outline yb-btn--xs" data-action="seq-duplicate" data-seq-id="' + seq.id + '">Duplicate</button> ' +
          '<button class="yb-btn yb-btn--outline yb-btn--xs" data-action="seq-delete" data-seq-id="' + seq.id + '" style="color:#ef5350;">Delete</button>' +
        '</div>' +
      '</div>';
    });

    container.innerHTML = html;
  }

  function renderConditionSummary(conditions) {
    var parts = [];
    if (conditions.lead_type) parts.push('Type: ' + conditions.lead_type);
    if (conditions.source) parts.push('Source: ' + conditions.source);
    if (conditions.program) parts.push('Program: ' + conditions.program);
    if (conditions.new_status) parts.push('Status \u2192 ' + conditions.new_status);
    if (parts.length === 0) return '';
    return '<div class="yb-seq__card-conditions">' + esc(parts.join(' \u00B7 ')) + '</div>';
  }

  function renderStats() {
    var totalEl = $('yb-seq-stat-total');
    var activeEl = $('yb-seq-stat-active');
    var enrollEl = $('yb-seq-stat-enrollments');
    var compEl = $('yb-seq-stat-completed');

    var activeCount = 0;
    var totalEnrollments = 0;
    var totalCompleted = 0;

    sequences.forEach(function (s) {
      if (s.active) activeCount++;
      if (s.enrollment_stats) {
        totalEnrollments += (s.enrollment_stats.active || 0);
        totalCompleted += (s.enrollment_stats.completed || 0);
      }
    });

    if (totalEl) totalEl.textContent = sequences.length;
    if (activeEl) activeEl.textContent = activeCount;
    if (enrollEl) enrollEl.textContent = totalEnrollments;
    if (compEl) compEl.textContent = totalCompleted;
  }

  /* ═══════════════════════════════════════════
     SEQUENCE ACTIONS
     ═══════════════════════════════════════════ */
  function toggleActive(seqId) {
    var seq = sequences.find(function (s) { return s.id === seqId; });
    if (!seq) return;

    var newState = !seq.active;
    api('PUT', 'sequences?id=' + seqId, { active: newState }).then(function (data) {
      if (data.ok) {
        seq.active = newState;
        toast('Sequence ' + (newState ? 'activated' : 'paused'));
        renderSequenceCards();
        renderStats();
      } else {
        toast('Error: ' + (data.error || 'Unknown'), true);
      }
    }).catch(function (err) { toast('Error: ' + err.message, true); });
  }

  function duplicateSequence(seqId) {
    var seq = sequences.find(function (s) { return s.id === seqId; });
    if (!seq) return;

    var copy = {
      name: seq.name + ' (Copy)',
      description: seq.description || '',
      active: false,
      trigger: {
        type: seq.trigger_type || (seq.trigger && seq.trigger.type) || 'manual',
        conditions: seq.conditions ? JSON.parse(JSON.stringify(seq.conditions)) : {}
      },
      exit_conditions: seq.exit_conditions ? seq.exit_conditions.slice() : [],
      steps: seq.steps ? JSON.parse(JSON.stringify(seq.steps)) : []
    };

    api('POST', 'sequences', copy).then(function (data) {
      if (data.ok) {
        toast('Sequence duplicated');
        loadSequences();
      } else {
        toast('Error: ' + (data.error || 'Unknown'), true);
      }
    }).catch(function (err) { toast('Error: ' + err.message, true); });
  }

  function deleteSequence(seqId) {
    var seq = sequences.find(function (s) { return s.id === seqId; });
    var name = seq ? seq.name : seqId;
    if (!confirm('Delete sequence "' + name + '" and all its enrollments? This cannot be undone.')) return;

    api('DELETE', 'sequences?id=' + seqId).then(function (data) {
      if (data.ok) {
        toast('Sequence deleted');
        loadSequences();
      } else {
        toast('Error: ' + (data.error || 'Unknown'), true);
      }
    }).catch(function (err) { toast('Error: ' + err.message, true); });
  }

  /* ═══════════════════════════════════════════
     ENROLLMENT CLOSES INDICATOR
     ═══════════════════════════════════════════ */
  function updateEnrollmentStatus(isoDate) {
    var el = $('yb-seq-enrollment-status');
    if (!el) return;

    if (!isoDate) {
      el.innerHTML = '<span style="color:#6F6A66;">No enrollment deadline — accepts leads indefinitely</span>';
      return;
    }

    var closes = new Date(isoDate);
    var now = new Date();
    var diff = closes.getTime() - now.getTime();
    var days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    var dateStr = closes.toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric' });

    if (diff > 0) {
      el.innerHTML = '<span style="color:#155724;font-weight:600;">&#9679;</span> ' +
        '<span style="color:#155724;">Enrollment open</span> — closes in <strong>' + days + ' day' + (days !== 1 ? 's' : '') + '</strong> (' + dateStr + ')';
    } else {
      var agoD = Math.abs(days);
      el.innerHTML = '<span style="color:#c62828;font-weight:600;">&#9679;</span> ' +
        '<span style="color:#c62828;">Enrollment closed</span> since ' + dateStr + ' (' + agoD + ' day' + (agoD !== 1 ? 's' : '') + ' ago)';
    }
  }

  function enrollmentStatusBadge(isoDate) {
    if (!isoDate) return '';
    var closes = new Date(isoDate);
    var now = new Date();
    var diff = closes.getTime() - now.getTime();
    var days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    var dateStr = closes.toLocaleDateString('da-DK', { day: 'numeric', month: 'short' });

    if (diff > 0) {
      return '<span class="yb-seq__badge" style="background:#d4edda;color:#155724;font-size:11px;">Closes ' + dateStr + ' (' + days + 'd)</span>';
    } else {
      return '<span class="yb-seq__badge" style="background:#f8d7da;color:#721c24;font-size:11px;">Closed ' + dateStr + '</span>';
    }
  }

  /* ═══════════════════════════════════════════
     SEQUENCE BUILDER
     ═══════════════════════════════════════════ */
  var builderSteps = []; // working copy of steps while editing

  function openBuilder(seqId) {
    showBuilderView();

    var title = $('yb-seq-builder-title');
    $('yb-seq-id').value = '';
    $('yb-seq-name').value = '';
    $('yb-seq-desc').value = '';
    $('yb-seq-active').checked = true;
    $('yb-seq-enrollment-closes').value = '';
    updateEnrollmentStatus('');
    $('yb-seq-trigger-type').value = 'manual';
    $('yb-seq-conditions-panel').hidden = true;
    $('yb-seq-cond-status-field').hidden = true;
    $('yb-seq-cond-type').value = '';
    $('yb-seq-cond-source').value = '';
    $('yb-seq-cond-program').value = '';
    $('yb-seq-cond-status').value = '';
    builderSteps = [];

    // Reset exit conditions
    var exitChecks = $('yb-seq-exit-checks');
    if (exitChecks) {
      var cbs = exitChecks.querySelectorAll('input[type="checkbox"]');
      cbs.forEach(function (cb) {
        // Default checked for converted and unsubscribed
        cb.checked = (cb.value === 'converted' || cb.value === 'unsubscribed');
      });
    }

    if (seqId) {
      // Edit existing
      var seq = sequences.find(function (s) { return s.id === seqId; });
      if (!seq) { toast('Sequence not found', true); showListView(); return; }

      currentSequence = seq;
      if (title) title.textContent = 'Edit Sequence';
      $('yb-seq-id').value = seq.id;
      $('yb-seq-name').value = seq.name || '';
      $('yb-seq-desc').value = seq.description || '';
      $('yb-seq-active').checked = !!seq.active;

      // Enrollment closes date
      var ecVal = seq.enrollment_closes || '';
      if (ecVal) {
        // Convert ISO string to YYYY-MM-DD for date input
        var ecDate = new Date(ecVal);
        $('yb-seq-enrollment-closes').value = ecDate.toISOString().split('T')[0];
      } else {
        $('yb-seq-enrollment-closes').value = '';
      }
      updateEnrollmentStatus(ecVal);

      $('yb-seq-trigger-type').value = seq.trigger_type || 'manual';

      // Trigger conditions
      var triggerVal = seq.trigger_type || 'manual';
      $('yb-seq-conditions-panel').hidden = (triggerVal === 'manual');
      $('yb-seq-cond-status-field').hidden = (triggerVal !== 'status_change');

      if (seq.conditions) {
        if (seq.conditions.lead_type) $('yb-seq-cond-type').value = seq.conditions.lead_type;
        if (seq.conditions.source) $('yb-seq-cond-source').value = seq.conditions.source;
        if (seq.conditions.program) $('yb-seq-cond-program').value = seq.conditions.program;
        if (seq.conditions.new_status) $('yb-seq-cond-status').value = seq.conditions.new_status;
      }

      // Exit conditions
      if (seq.exit_conditions && exitChecks) {
        var cbs2 = exitChecks.querySelectorAll('input[type="checkbox"]');
        cbs2.forEach(function (cb) {
          cb.checked = seq.exit_conditions.indexOf(cb.value) !== -1;
        });
      }

      // Steps
      builderSteps = seq.steps ? JSON.parse(JSON.stringify(seq.steps)) : [];
    } else {
      currentSequence = null;
      if (title) title.textContent = 'New Sequence';
      // Start with one empty step
      builderSteps = [createEmptyStep()];
    }

    renderSteps();
  }

  function createEmptyStep() {
    return {
      delay_days: 0,
      delay_hours: 0,
      channel: 'email',
      condition: '',
      email_subject: '',
      email_body: '',
      sms_message: ''
    };
  }

  function renderSteps() {
    var container = $('yb-seq-steps-container');
    if (!container) return;

    if (builderSteps.length === 0) {
      container.innerHTML = '<p style="color:#6F6A66;text-align:center;padding:20px;">No steps yet. Click "Add Step" to begin.</p>';
      return;
    }

    var html = '';
    builderSteps.forEach(function (step, idx) {
      var isFirst = idx === 0;
      var isLast = idx === builderSteps.length - 1;
      var showEmail = (step.channel === 'email' || step.channel === 'both');
      var showSms = (step.channel === 'sms' || step.channel === 'both');

      html += '<div class="yb-seq__step" data-step-index="' + idx + '">' +
        // Timeline dot + line
        '<div class="yb-seq__step-timeline">' +
          (idx > 0 ? '<div class="yb-seq__step-line"></div>' : '') +
          '<div class="yb-seq__step-dot">' + (idx + 1) + '</div>' +
          (!isLast ? '<div class="yb-seq__step-line yb-seq__step-line--after"></div>' : '') +
        '</div>' +

        '<div class="yb-seq__step-content">' +
          // Header with step number + actions
          '<div class="yb-seq__step-header">' +
            '<strong>Step ' + (idx + 1) + '</strong>' +
            '<div class="yb-seq__step-actions">' +
              (isFirst ? '' : '<button type="button" class="yb-btn yb-btn--outline yb-btn--xs" data-action="seq-step-up" data-step-idx="' + idx + '" title="Move up">&uarr;</button> ') +
              (isLast ? '' : '<button type="button" class="yb-btn yb-btn--outline yb-btn--xs" data-action="seq-step-down" data-step-idx="' + idx + '" title="Move down">&darr;</button> ') +
              '<button type="button" class="yb-btn yb-btn--outline yb-btn--xs" data-action="seq-step-remove" data-step-idx="' + idx + '" style="color:#ef5350;" title="Remove">&times;</button>' +
            '</div>' +
          '</div>' +

          // Delay
          '<div class="yb-seq__step-delay">' +
            '<label>Send after</label>' +
            '<input type="number" class="yb-seq__delay-days" min="0" value="' + (step.delay_days || 0) + '" style="width:60px;"> days' +
            '<input type="number" class="yb-seq__delay-hours" min="0" max="23" value="' + (step.delay_hours || 0) + '" style="width:60px;"> hours' +
          '</div>' +

          // Channel
          '<div class="yb-seq__step-channel">' +
            '<label>Channel</label>' +
            '<select class="yb-seq__channel-select yb-admin__select">' +
              CHANNEL_OPTIONS.map(function (ch) {
                return '<option value="' + ch.value + '"' + (step.channel === ch.value ? ' selected' : '') + '>' + esc(ch.label) + '</option>';
              }).join('') +
            '</select>' +
          '</div>' +

          // Condition (optional)
          '<div class="yb-seq__step-condition">' +
            '<label>Condition <small style="color:#6F6A66;">(optional, e.g. status:New)</small></label>' +
            '<input type="text" class="yb-seq__condition-input" value="' + esc(step.condition || '') + '" placeholder="Leave blank to always send">' +
          '</div>' +

          // Email section (Danish — default)
          '<div class="yb-seq__step-email"' + (showEmail ? '' : ' hidden') + '>' +
            '<div class="yb-admin__field">' +
              '<label>Email Subject</label>' +
              '<input type="text" class="yb-seq__email-subject" value="' + esc(step.email_subject || '') + '" placeholder="Subject line...">' +
            '</div>' +
            '<div class="yb-admin__field">' +
              '<label>Email Body <small style="color:#6F6A66;">(HTML)</small></label>' +
              '<textarea class="yb-seq__email-body" rows="8" placeholder="Email content...">' + esc(step.email_body || '') + '</textarea>' +
            '</div>' +
            '<p class="yb-seq__var-hints">Variables: ' + VAR_HINTS + '</p>' +
            // English version (collapsible)
            '<details class="yb-seq__en-section" style="margin-top:12px;border:1px solid #E8E4E0;border-radius:8px;padding:0 12px;">' +
              '<summary style="cursor:pointer;padding:10px 0;color:#6F6A66;font-size:13px;">English Version <small>(international leads)</small>' +
                (step.email_subject_en ? ' <span style="color:#f75c03;font-weight:600;">&#x2713;</span>' : '') +
              '</summary>' +
              '<div class="yb-admin__field" style="margin-top:8px;">' +
                '<label>English Subject</label>' +
                '<input type="text" class="yb-seq__email-subject-en" value="' + esc(step.email_subject_en || '') + '" placeholder="English subject line...">' +
              '</div>' +
              '<div class="yb-admin__field">' +
                '<label>English Body <small style="color:#6F6A66;">(HTML)</small></label>' +
                '<textarea class="yb-seq__email-body-en" rows="8" placeholder="English email content...">' + esc(step.email_body_en || '') + '</textarea>' +
              '</div>' +
              '<p class="yb-seq__var-hints" style="margin-bottom:12px;">Falls back to Danish if empty. Variables: ' + VAR_HINTS + '</p>' +
            '</details>' +
          '</div>' +

          // SMS section
          '<div class="yb-seq__step-sms"' + (showSms ? '' : ' hidden') + '>' +
            '<div class="yb-admin__field">' +
              '<label>SMS Message</label>' +
              '<textarea class="yb-seq__sms-text" rows="3" placeholder="SMS text...">' + esc(step.sms_message || '') + '</textarea>' +
              '<span class="yb-seq__sms-count">' + (step.sms_message || '').length + ' chars</span>' +
            '</div>' +
            '<p class="yb-seq__var-hints">Variables: ' + VAR_HINTS + '</p>' +
          '</div>' +

        '</div>' + // end step-content
      '</div>'; // end step
    });

    container.innerHTML = html;
  }

  function collectStepsFromDOM() {
    var stepEls = document.querySelectorAll('#yb-seq-steps-container .yb-seq__step');
    var collected = [];

    stepEls.forEach(function (stepEl, idx) {
      var delayDays = stepEl.querySelector('.yb-seq__delay-days');
      var delayHours = stepEl.querySelector('.yb-seq__delay-hours');
      var channelSel = stepEl.querySelector('.yb-seq__channel-select');
      var condInput = stepEl.querySelector('.yb-seq__condition-input');
      var emailSubject = stepEl.querySelector('.yb-seq__email-subject');
      var emailBody = stepEl.querySelector('.yb-seq__email-body');
      var emailSubjectEn = stepEl.querySelector('.yb-seq__email-subject-en');
      var emailBodyEn = stepEl.querySelector('.yb-seq__email-body-en');
      var smsText = stepEl.querySelector('.yb-seq__sms-text');

      var stepData = {
        delay_days: delayDays ? parseInt(delayDays.value) || 0 : 0,
        delay_hours: delayHours ? parseInt(delayHours.value) || 0 : 0,
        channel: channelSel ? channelSel.value : 'email',
        condition: condInput ? condInput.value.trim() : '',
        email_subject: emailSubject ? emailSubject.value.trim() : '',
        email_body: emailBody ? emailBody.value.trim() : '',
        sms_message: smsText ? smsText.value.trim() : ''
      };

      // Include English fields only if they have content
      var enSubject = emailSubjectEn ? emailSubjectEn.value.trim() : '';
      var enBody = emailBodyEn ? emailBodyEn.value.trim() : '';
      if (enSubject) stepData.email_subject_en = enSubject;
      if (enBody) stepData.email_body_en = enBody;

      collected.push(stepData);
    });

    return collected;
  }

  function syncStepsFromDOM() {
    builderSteps = collectStepsFromDOM();
  }

  function addStep() {
    syncStepsFromDOM();
    // Default next step: delay 1 day more than last step
    var newStep = createEmptyStep();
    if (builderSteps.length > 0) {
      var last = builderSteps[builderSteps.length - 1];
      newStep.delay_days = (last.delay_days || 0) + 2;
    }
    builderSteps.push(newStep);
    renderSteps();

    // Scroll to the new step
    var container = $('yb-seq-steps-container');
    if (container) {
      var steps = container.querySelectorAll('.yb-seq__step');
      if (steps.length > 0) {
        steps[steps.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  function moveStep(idx, direction) {
    syncStepsFromDOM();
    var newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= builderSteps.length) return;

    var temp = builderSteps[idx];
    builderSteps[idx] = builderSteps[newIdx];
    builderSteps[newIdx] = temp;
    renderSteps();
  }

  function removeStep(idx) {
    syncStepsFromDOM();
    if (builderSteps.length <= 1) {
      if (!confirm('Remove the last step? The sequence will have no steps.')) return;
    }
    builderSteps.splice(idx, 1);
    renderSteps();
  }

  /* ═══════════════════════════════════════════
     SAVE SEQUENCE
     ═══════════════════════════════════════════ */
  function saveSequence() {
    var name = $('yb-seq-name').value.trim();
    if (!name) { toast('Sequence name is required', true); return; }

    syncStepsFromDOM();

    // Validate steps have content
    var valid = true;
    builderSteps.forEach(function (step, idx) {
      var hasEmail = (step.channel === 'email' || step.channel === 'both');
      var hasSms = (step.channel === 'sms' || step.channel === 'both');

      if (hasEmail && !step.email_subject && !step.email_body) {
        toast('Step ' + (idx + 1) + ': Email subject and body are required', true);
        valid = false;
      }
      if (hasSms && !step.sms_message) {
        toast('Step ' + (idx + 1) + ': SMS message is required', true);
        valid = false;
      }
    });
    if (!valid) return;

    // Collect trigger conditions
    var triggerType = $('yb-seq-trigger-type').value;
    var conditions = {};
    if (triggerType !== 'manual') {
      var condType = $('yb-seq-cond-type').value;
      var condSource = $('yb-seq-cond-source').value;
      var condProgram = $('yb-seq-cond-program').value;
      var condStatus = $('yb-seq-cond-status').value;
      if (condType) conditions.lead_type = condType;
      if (condSource) conditions.source = condSource;
      if (condProgram) conditions.program = condProgram;
      if (triggerType === 'status_change' && condStatus) conditions.new_status = condStatus;
    }

    // Collect exit conditions
    var exitConditions = [];
    var exitChecks = $('yb-seq-exit-checks');
    if (exitChecks) {
      var cbs = exitChecks.querySelectorAll('input[type="checkbox"]:checked');
      cbs.forEach(function (cb) { exitConditions.push(cb.value); });
    }

    // Enrollment closes — convert date input to ISO string
    var ecInput = $('yb-seq-enrollment-closes').value;
    var enrollmentCloses = ecInput ? new Date(ecInput + 'T00:00:00Z').toISOString() : '';

    var body = {
      name: name,
      description: $('yb-seq-desc').value.trim(),
      active: $('yb-seq-active').checked,
      enrollment_closes: enrollmentCloses,
      trigger: { type: triggerType, conditions: conditions },
      exit_conditions: exitConditions,
      steps: builderSteps
    };

    var id = $('yb-seq-id').value;
    if (id) {
      api('PUT', 'sequences?id=' + id, body).then(function (data) {
        if (data.ok) {
          toast('Sequence updated');
          loadSequences();
          showListView();
        } else {
          toast('Error: ' + (data.error || 'Unknown'), true);
        }
      }).catch(function (err) { toast('Error: ' + err.message, true); });
    } else {
      api('POST', 'sequences', body).then(function (data) {
        if (data.ok) {
          toast('Sequence created');
          loadSequences();
          showListView();
        } else {
          toast('Error: ' + (data.error || 'Unknown'), true);
        }
      }).catch(function (err) { toast('Error: ' + err.message, true); });
    }
  }

  /* ═══════════════════════════════════════════
     ENROLLMENT MANAGEMENT
     ═══════════════════════════════════════════ */
  function openEnrollments(seqId) {
    var seq = sequences.find(function (s) { return s.id === seqId; });
    if (!seq) { toast('Sequence not found', true); return; }

    currentSequence = seq;
    showEnrollmentsView();

    var title = $('yb-seq-enroll-title');
    if (title) title.textContent = 'Enrollments — ' + esc(seq.name);

    // Clear search
    var search = $('yb-seq-lead-search');
    if (search) search.value = '';
    hideLeadResults();

    loadEnrollments(seqId);
  }

  function loadEnrollments(seqId) {
    var tbody = $('yb-seq-enroll-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="yb-admin__empty">Loading enrollments...</td></tr>';

    api('GET', 'sequences?action=enrollments&sequence_id=' + seqId).then(function (data) {
      if (!data.ok) { toast('Failed to load enrollments', true); return; }
      enrollments = data.enrollments || [];
      renderEnrollments();
    }).catch(function (err) { toast('Error: ' + err.message, true); });
  }

  function renderEnrollments() {
    var tbody = $('yb-seq-enroll-tbody');
    if (!tbody) return;

    if (enrollments.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="yb-admin__empty">No enrollments yet. Search for leads above to enroll them.</td></tr>';
      return;
    }

    var html = '';
    enrollments.forEach(function (e) {
      var statusCls = 'yb-seq__enrollment-badge yb-seq__enrollment-badge--' + (e.status || 'active');
      var stepLabel = e.current_step !== undefined ? ('Step ' + (e.current_step + 1)) : '—';
      var totalSteps = currentSequence && currentSequence.steps ? currentSequence.steps.length : '?';

      html += '<tr>' +
        '<td><strong>' + esc(e.lead_name || e.lead_first_name || '—') + '</strong></td>' +
        '<td>' + esc(e.lead_email || '—') + '</td>' +
        '<td>' + stepLabel + ' / ' + totalSteps + '</td>' +
        '<td><span class="' + statusCls + '">' + esc(e.status || 'active') + '</span></td>' +
        '<td>' + formatDateTime(e.next_send_at) + '</td>' +
        '<td>' + formatDate(e.started_at || e.created_at) + '</td>' +
        '<td>' + renderEnrollmentActions(e) + '</td>' +
      '</tr>';
    });

    tbody.innerHTML = html;
  }

  function renderEnrollmentActions(enrollment) {
    var html = '';
    if (enrollment.status === 'active') {
      html += '<button class="yb-btn yb-btn--outline yb-btn--xs" data-action="seq-enroll-pause" data-enroll-id="' + enrollment.id + '">Pause</button> ';
    } else if (enrollment.status === 'paused') {
      html += '<button class="yb-btn yb-btn--outline yb-btn--xs" data-action="seq-enroll-resume" data-enroll-id="' + enrollment.id + '">Resume</button> ';
    }
    html += '<button class="yb-btn yb-btn--outline yb-btn--xs" data-action="seq-enroll-remove" data-enroll-id="' + enrollment.id + '" style="color:#ef5350;">Remove</button>';
    return html;
  }

  function toggleEnrollmentPause(enrollId, pause) {
    if (!currentSequence) return;

    var action = pause ? 'pause' : 'resume';
    api('POST', 'sequences?action=' + action, {
      enrollment_id: enrollId,
      sequence_id: currentSequence.id
    }).then(function (data) {
      if (data.ok) {
        toast('Enrollment ' + (pause ? 'paused' : 'resumed'));
        loadEnrollments(currentSequence.id);
      } else {
        toast('Error: ' + (data.error || 'Unknown'), true);
      }
    }).catch(function (err) { toast('Error: ' + err.message, true); });
  }

  function removeEnrollment(enrollId) {
    if (!currentSequence) return;
    if (!confirm('Remove this enrollment? The lead will stop receiving messages from this sequence.')) return;

    api('POST', 'sequences?action=unenroll', { enrollment_ids: [enrollId] }).then(function (data) {
      if (data.ok) {
        toast('Enrollment removed');
        loadEnrollments(currentSequence.id);
      } else {
        toast('Error: ' + (data.error || 'Unknown'), true);
      }
    }).catch(function (err) { toast('Error: ' + err.message, true); });
  }

  /* ═══════════════════════════════════════════
     LEAD SEARCH (for enrolling)
     ═══════════════════════════════════════════ */
  function searchLeads(term) {
    api('GET', 'leads?search=' + encodeURIComponent(term) + '&limit=10').then(function (data) {
      if (!data.ok) return;
      leadSearchResults = data.leads || [];
      renderLeadResults();
    }).catch(function () { hideLeadResults(); });
  }

  function renderLeadResults() {
    var container = $('yb-seq-lead-results');
    if (!container) return;

    if (leadSearchResults.length === 0) {
      container.innerHTML = '<div class="yb-seq__lead-result" style="color:#6F6A66;">No leads found</div>';
      container.hidden = false;
      return;
    }

    var html = '';
    leadSearchResults.forEach(function (lead) {
      var name = (lead.first_name || '') + ' ' + (lead.last_name || '');
      name = name.trim() || '(unnamed)';
      var typeBadge = lead.type
        ? '<span style="background:#FFF3E0;color:#E65100;padding:1px 6px;border-radius:8px;font-size:11px;margin-left:6px;">' + esc(lead.type) + '</span>'
        : '';

      // Check if already enrolled
      var alreadyEnrolled = enrollments.some(function (e) {
        return e.lead_id === lead.id && (e.status === 'active' || e.status === 'paused');
      });

      if (alreadyEnrolled) {
        html += '<div class="yb-seq__lead-result yb-seq__lead-result--disabled">' +
          '<span>' + esc(name) + typeBadge + '</span>' +
          '<span style="color:#6F6A66;font-size:12px;">' + esc(lead.email || '') + '</span>' +
          '<span style="color:#66BB6A;font-size:11px;">Already enrolled</span>' +
        '</div>';
      } else {
        html += '<div class="yb-seq__lead-result" data-action="seq-enroll-lead" data-lead-id="' + lead.id + '">' +
          '<span>' + esc(name) + typeBadge + '</span>' +
          '<span style="color:#6F6A66;font-size:12px;">' + esc(lead.email || '') + '</span>' +
        '</div>';
      }
    });

    container.innerHTML = html;
    container.hidden = false;
  }

  function hideLeadResults() {
    var container = $('yb-seq-lead-results');
    if (container) {
      container.hidden = true;
      container.innerHTML = '';
    }
    leadSearchResults = [];
  }

  function enrollLead(leadId) {
    if (!currentSequence) return;

    api('POST', 'sequences?action=enroll', {
      sequence_id: currentSequence.id,
      lead_ids: [leadId]
    }).then(function (data) {
      if (data.ok) {
        toast('Lead enrolled in sequence');
        hideLeadResults();
        var search = $('yb-seq-lead-search');
        if (search) search.value = '';
        loadEnrollments(currentSequence.id);
      } else {
        toast('Error: ' + (data.error || 'Unknown'), true);
      }
    }).catch(function (err) { toast('Error: ' + err.message, true); });
  }

  // Close lead results when clicking outside
  document.addEventListener('click', function (e) {
    var searchWrap = e.target.closest('.yb-seq__lead-search-wrap');
    if (!searchWrap) {
      hideLeadResults();
    }
  });

  /* ═══════════════════════════════════════════
     DATA BRIDGE (expose for other modules)
     ═══════════════════════════════════════════ */
  window._ybSequenceData = {
    sequences: sequences,
    reload: function () { loadSequences(); },
    getSequences: function () { return sequences; }
  };

})();
