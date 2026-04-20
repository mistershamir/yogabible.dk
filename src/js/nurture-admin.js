/**
 * Nurture Dashboard — Admin Panel
 * Pipeline overview, sequence health, quick enrollment, recent activity.
 */
(function () {
  'use strict';

  var initialized = false;
  var sequences = [];
  var unenrolledLeads = [];
  var allLeads = [];

  // ── Helpers ──────────────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function getToken() {
    if (window.getAuthToken) {
      return window.getAuthToken().then(function (t) { return t || ''; });
    }
    if (window.firebase && firebase.auth) {
      var u = firebase.auth().currentUser;
      if (u) return u.getIdToken();
    }
    return Promise.resolve('');
  }

  function api(method, path, body) {
    return getToken().then(function (token) {
      var opts = {
        method: method,
        headers: { 'Content-Type': 'application/json' }
      };
      if (token) opts.headers['Authorization'] = 'Bearer ' + token;
      if (body) opts.body = JSON.stringify(body);
      return fetch('/.netlify/functions/' + path, opts).then(function (r) { return r.json(); });
    });
  }

  function formatDate(d) {
    if (!d) return '—';
    // Handle Firestore Timestamp objects ({_seconds, _nanoseconds})
    var date;
    if (d._seconds !== undefined) {
      date = new Date(d._seconds * 1000);
    } else {
      date = d instanceof Date ? d : new Date(d);
    }
    if (isNaN(date.getTime())) return '—';
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return date.getDate() + '. ' + months[date.getMonth()] + ' ' + date.getFullYear();
  }

  function formatDateTime(d) {
    if (!d) return '—';
    var date;
    if (d && d._seconds !== undefined) {
      date = new Date(d._seconds * 1000);
    } else {
      date = d instanceof Date ? d : new Date(d);
    }
    if (isNaN(date.getTime())) return '—';
    return formatDate(d) + ' ' + String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
  }

  function toast(msg, isError) {
    if (window.YBAdmin && window.YBAdmin.toast) {
      window.YBAdmin.toast(msg, isError);
    } else {
      console[isError ? 'error' : 'log']('[nurture]', msg);
    }
  }

  // ── Pipeline Stages ──────────────────────────────────────────────────────
  var PIPELINE_STAGES = [
    { key: 'New', label: 'New', color: '#2563eb' },
    { key: 'Contacted', label: 'Contacted', color: '#7c3aed' },
    { key: 'No Answer', label: 'No Answer', color: '#6F6A66' },
    { key: 'Follow-up', label: 'Follow-up', color: '#f75c03' },
    { key: 'Engaged', label: 'Engaged', color: '#16a34a' },
    { key: 'Qualified', label: 'Qualified', color: '#16a34a' },
    { key: 'Negotiating', label: 'Negotiating', color: '#f75c03' },
    { key: 'Converted', label: 'Converted', color: '#16a34a' }
  ];

  function renderPipeline(leads) {
    var container = $('yb-nur-stages');
    if (!container) return;

    var counts = {};
    PIPELINE_STAGES.forEach(function (s) { counts[s.key] = 0; });

    leads.forEach(function (lead) {
      var status = lead.status || 'New';
      if (counts[status] !== undefined) counts[status]++;
    });

    var total = leads.length || 1;
    var html = '';
    PIPELINE_STAGES.forEach(function (stage, i) {
      var count = counts[stage.key] || 0;
      var pct = Math.round((count / total) * 100);
      html += '<div class="yb-nur__stage">' +
        '<div class="yb-nur__stage-bar" style="background:' + stage.color + ';width:' + Math.max(pct, 2) + '%;"></div>' +
        '<div class="yb-nur__stage-info">' +
          '<span class="yb-nur__stage-label">' + esc(stage.label) + '</span>' +
          '<span class="yb-nur__stage-count">' + count + '</span>' +
        '</div>' +
      '</div>';
    });
    container.innerHTML = html;
  }

  // ── Sequence Health ──────────────────────────────────────────────────────
  function loadSequenceHealth() {
    api('GET', 'sequences').then(function (data) {
      if (!data.ok) return;
      sequences = data.sequences || [];
      renderSequenceHealth();
      populateSequenceDropdown();
    });
  }

  function renderSequenceHealth() {
    var grid = $('yb-nur-health-grid');
    if (!grid) return;

    if (sequences.length === 0) {
      grid.innerHTML = '<p class="yb-admin__empty">No sequences found. Create sequences in the Sequences tab first.</p>';
      return;
    }

    var html = '';
    sequences.forEach(function (seq) {
      // Normalize trigger info
      var triggerType = seq.trigger_type || (seq.trigger && seq.trigger.type) || 'manual';
      var stats = seq.enrollment_stats || { total: 0, active: 0, paused: 0, completed: 0, exited: 0 };
      var stepCount = (seq.steps && seq.steps.length) || 0;

      html += '<div class="yb-nur__health-card' + (!seq.active ? ' yb-nur__health-card--inactive' : '') + '">' +
        '<div class="yb-nur__health-card-head">' +
          '<strong>' + esc(seq.name) + '</strong>' +
          '<span class="yb-seq__badge yb-seq__badge--' + (seq.active ? 'active' : 'paused') + '">' + (seq.active ? 'Active' : 'Paused') + '</span>' +
        '</div>' +
        '<div class="yb-nur__health-card-stats">' +
          '<span>' + stepCount + ' steps</span>' +
          '<span>' + stats.active + ' active</span>' +
          '<span>' + stats.paused + ' paused</span>' +
          '<span>' + stats.completed + ' completed</span>' +
          '<span>' + stats.exited + ' exited</span>' +
        '</div>' +
        '<div class="yb-nur__health-card-trigger">Trigger: ' + esc(triggerType) + '</div>' +
      '</div>';
    });
    grid.innerHTML = html;
  }

  function populateSequenceDropdown() {
    var select = $('yb-nur-enroll-seq');
    if (!select) return;
    var html = '<option value="">Select sequence...</option>';
    sequences.forEach(function (seq) {
      if (seq.active) {
        html += '<option value="' + esc(seq.id) + '">' + esc(seq.name) + '</option>';
      }
    });
    select.innerHTML = html;
  }

  function processNow() {
    if (processNow._running) return;
    processNow._running = true;
    toast('Processing sequences...');
    api('POST', 'sequences?action=process').then(function (data) {
      if (data.ok) {
        toast('Processed ' + (data.processed || 0) + ' enrollments');
        loadSequenceHealth();
        loadRecentActivity();
      } else {
        toast('Error: ' + (data.error || 'Unknown'), true);
      }
    }).catch(function (err) { toast('Error: ' + err.message, true); })
      .finally(function () { processNow._running = false; });
  }

  // ── Quick Enrollment ────────────────────────────────────────────────────
  function loadUnenrolledLeads() {
    // Load all leads (no type filter to avoid composite index requirement)
    // and sequence enrollments, then filter client-side
    Promise.all([
      api('GET', 'leads?limit=500'),
      api('GET', 'sequences?action=enrollments&all=true')
    ]).then(function (results) {
      var leadsData = results[0];
      var enrollData = results[1];

      // Filter to YTT leads client-side (avoids Firestore composite index issue)
      var rawLeads = (leadsData.ok ? leadsData.leads : []) || [];
      allLeads = rawLeads.filter(function (l) { return l.type === 'ytt'; });

      // Build set of lead IDs with active enrollments
      var enrolledIds = new Set();
      var enrollments = enrollData.ok ? (enrollData.enrollments || []) : [];
      enrollments.forEach(function (e) {
        if (e.status === 'active' || e.status === 'paused') {
          enrolledIds.add(e.lead_id);
        }
      });

      // Filter to unconverted, unsubscribed, unenrolled
      unenrolledLeads = allLeads.filter(function (lead) {
        if (lead.converted === true || lead.converted === 'true') return false;
        if (lead.unsubscribed === true) return false;
        if (enrolledIds.has(lead.id)) return false;
        return true;
      });

      renderPipeline(allLeads);
      renderUnenrolledLeads();
      updateEnrollButtons();
    }).catch(function (err) {
      toast('Error loading leads: ' + err.message, true);
    });
  }

  function renderUnenrolledLeads() {
    var tbody = $('yb-nur-leads-tbody');
    if (!tbody) return;

    var filter = ($('yb-nur-program-filter') || {}).value || '';
    var filtered = filter
      ? unenrolledLeads.filter(function (l) { return l.ytt_program_type === filter; })
      : unenrolledLeads;

    var countEl = $('yb-nur-unenrolled-count');
    if (countEl) countEl.textContent = filtered.length + ' of ' + unenrolledLeads.length + ' leads not in any sequence';

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="yb-admin__empty">All leads are enrolled in sequences.</td></tr>';
      return;
    }

    var html = '';
    filtered.forEach(function (lead) {
      var assignedSeq = getSequenceForLead(lead);
      html += '<tr>' +
        '<td><input type="checkbox" class="yb-nur__lead-cb" data-lead-id="' + esc(lead.id) + '"></td>' +
        '<td>' + esc(lead.first_name || lead.name || '—') + ' ' + esc(lead.last_name || '') + '</td>' +
        '<td>' + esc(lead.email || '—') + '</td>' +
        '<td>' + esc(lead.ytt_program_type || '—') + '</td>' +
        '<td>' + esc(lead.status || 'New') + '</td>' +
        '<td>' + formatDate(lead.created_at) + '</td>' +
        '<td style="font-size:12px;color:#6F6A66;">' + esc(assignedSeq || 'None') + '</td>' +
      '</tr>';
    });
    tbody.innerHTML = html;
  }

  function getSequenceForLead(lead) {
    var program = lead.ytt_program_type || '';
    var cohort = (lead.cohort_label || '').toLowerCase();

    if (program === '4-week' && (cohort.includes('apr') || cohort.includes('april') || !cohort)) {
      return 'April 4W Intensive — Conversion Push';
    }
    if (program === '4-week-jul' || cohort.includes('jul') || cohort.includes('vinyasa')) {
      return 'July Vinyasa Plus — International Nurture';
    }
    if (program === '8-week' || cohort.includes('8') || cohort.includes('maj') || cohort.includes('may')) {
      return '8W Semi-Intensive May–Jun — DK Nurture';
    }
    if (program === '18-week-aug' || program === '18-week' || cohort.includes('aug') || cohort.includes('18')) {
      return '18W Flexible Aug–Dec — DK Nurture';
    }
    return 'YTT Onboarding — 2026';
  }

  function updateEnrollButtons() {
    var cbs = document.querySelectorAll('.yb-nur__lead-cb:checked');
    var enrollBtn = $('yb-nur-enroll-selected');
    var autoBtn = $('yb-nur-auto-enroll');

    if (enrollBtn) enrollBtn.disabled = cbs.length === 0;
    if (autoBtn) autoBtn.disabled = unenrolledLeads.length === 0;
  }

  function enrollSelected() {
    var seqId = ($('yb-nur-enroll-seq') || {}).value;
    if (!seqId) { toast('Select a sequence first', true); return; }

    var cbs = document.querySelectorAll('.yb-nur__lead-cb:checked');
    var leadIds = [];
    cbs.forEach(function (cb) { leadIds.push(cb.getAttribute('data-lead-id')); });

    if (leadIds.length === 0) { toast('Select at least one lead', true); return; }

    toast('Enrolling ' + leadIds.length + ' leads...');
    api('POST', 'sequences?action=enroll', {
      sequence_id: seqId,
      lead_ids: leadIds
    }).then(function (data) {
      if (data.ok) {
        toast('Enrolled ' + (data.enrolled || leadIds.length) + ' leads');
        loadUnenrolledLeads();
        loadSequenceHealth();
      } else {
        toast('Error: ' + (data.error || 'Unknown'), true);
      }
    }).catch(function (err) { toast('Error: ' + err.message, true); });
  }

  function autoEnrollAll() {
    if (unenrolledLeads.length === 0) return;

    // Build mapping: sequence name -> lead IDs
    var assignments = {};
    unenrolledLeads.forEach(function (lead) {
      var seqName = getSequenceForLead(lead);
      if (!seqName) return;
      if (!assignments[seqName]) assignments[seqName] = [];
      assignments[seqName].push(lead);
    });

    // Show preview
    var preview = 'Auto-assign preview:\n\n';
    var total = 0;
    for (var name in assignments) {
      preview += assignments[name].length + ' → ' + name + '\n';
      total += assignments[name].length;
    }
    preview += '\nTotal: ' + total + ' leads\n\nProceed?';

    if (!confirm(preview)) return;

    // Build sequence name -> id map
    var seqIdMap = {};
    sequences.forEach(function (seq) {
      seqIdMap[seq.name] = seq.id;
    });

    // Enroll each group
    var promises = [];
    for (var seqName in assignments) {
      var seqId = seqIdMap[seqName];
      if (!seqId) {
        toast('Sequence "' + seqName + '" not found — skipping', true);
        continue;
      }
      var ids = assignments[seqName].map(function (l) { return l.id; });
      promises.push(
        api('POST', 'sequences?action=enroll', { sequence_id: seqId, lead_ids: ids })
      );
    }

    toast('Enrolling ' + total + ' leads across ' + Object.keys(assignments).length + ' sequences...');
    Promise.all(promises).then(function (results) {
      var enrolled = 0;
      results.forEach(function (r) { if (r.ok) enrolled += (r.enrolled || 0); });
      toast('Enrolled ' + enrolled + ' leads');
      loadUnenrolledLeads();
      loadSequenceHealth();
    }).catch(function (err) { toast('Error: ' + err.message, true); });
  }

  // ── Recent Activity ──────────────────────────────────────────────────────
  function loadRecentActivity() {
    // Load recent sequence emails from email_log
    api('GET', 'leads?action=email_log&source=sequence&limit=20').then(function (data) {
      renderRecentActivity(data.ok ? (data.emails || data.logs || []) : []);
    }).catch(function () {
      // Fallback: try querying directly
      renderRecentActivity([]);
    });
  }

  function renderRecentActivity(logs) {
    var tbody = $('yb-nur-activity-tbody');
    if (!tbody) return;

    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="yb-admin__empty">No recent sequence activity. Activity will appear here after sequences start sending.</td></tr>';
      return;
    }

    var html = '';
    logs.forEach(function (log) {
      var channel = log.source === 'sequence' ? 'Email' : (log.channel || 'Email');
      html += '<tr>' +
        '<td>' + esc(log.lead_name || log.to || '—') + '</td>' +
        '<td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(log.subject || log.message || '—') + '</td>' +
        '<td>' + esc(channel) + '</td>' +
        '<td>' + formatDateTime(log.sent_at) + '</td>' +
        '<td><span class="yb-seq__enrollment-badge yb-seq__enrollment-badge--' + (log.status === 'sent' ? 'active' : 'exited') + '">' + esc(log.status || '—') + '</span></td>' +
      '</tr>';
    });
    tbody.innerHTML = html;
  }

  // ── Event Handling ──────────────────────────────────────────────────────
  function handleClick(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.getAttribute('data-action');

    switch (action) {
      case 'nur-refresh':
        loadAll();
        break;
      case 'nur-process-now':
        processNow();
        break;
    }
  }

  function handleChange(e) {
    if (e.target.id === 'yb-nur-program-filter') {
      renderUnenrolledLeads();
    }
    if (e.target.classList.contains('yb-nur__lead-cb') || e.target.id === 'yb-nur-select-all') {
      if (e.target.id === 'yb-nur-select-all') {
        var checked = e.target.checked;
        document.querySelectorAll('.yb-nur__lead-cb').forEach(function (cb) { cb.checked = checked; });
      }
      updateEnrollButtons();
    }
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  function loadAll() {
    loadSequenceHealth();
    loadUnenrolledLeads();
    loadRecentActivity();
  }

  function init() {
    if (initialized) {
      loadAll();
      return;
    }
    initialized = true;

    var nurSec = $('yb-el-sec-nurture');
    if (nurSec) {
      nurSec.addEventListener('click', handleClick);
      nurSec.addEventListener('change', handleChange);
    }

    var enrollBtn = $('yb-nur-enroll-selected');
    if (enrollBtn) enrollBtn.addEventListener('click', enrollSelected);

    var autoBtn = $('yb-nur-auto-enroll');
    if (autoBtn) autoBtn.addEventListener('click', autoEnrollAll);

    loadAll();
  }

  // ── Public API ──────────────────────────────────────────────────────────
  window.YBNurtureAdmin = {
    init: init,
    reload: loadAll
  };

})();
