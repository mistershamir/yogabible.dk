/**
 * YOGA BIBLE — SEQUENCE AUTOMATION ADMIN
 * Manage email/SMS sequences: create, edit, enroll leads, view history.
 * Uses sequences Netlify function for all operations.
 */
(function () {
  'use strict';

  /* ══════════════════════════════════════════
     STATE
     ══════════════════════════════════════════ */
  var sequences = [];
  var loaded = false;
  var editingId = null;
  var stepCounter = 0;
  var currentSeqId = null; // for enrollment view
  var enrollments = [];

  /* ══════════════════════════════════════════
     HELPERS
     ══════════════════════════════════════════ */
  function $(id) { return document.getElementById(id); }
  function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  function toast(msg, isError) {
    var el = $('yb-admin-toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'yb-admin__toast' + (isError ? ' yb-admin__toast--error' : '');
    el.hidden = false;
    clearTimeout(el._tid);
    el._tid = setTimeout(function () { el.hidden = true; }, 3000);
  }

  function getAuthToken() {
    return firebase.auth().currentUser.getIdToken();
  }

  function apiCall(method, params, body) {
    var qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return getAuthToken().then(function (token) {
      var opts = {
        method: method,
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }
      };
      if (body) opts.body = JSON.stringify(body);
      return fetch('/.netlify/functions/sequences' + qs, opts);
    }).then(function (res) { return res.json(); });
  }

  function T(key, fallback) {
    return (window._ybAdminT && window._ybAdminT[key]) || fallback || key;
  }

  function formatDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return iso; }
  }

  /* ══════════════════════════════════════════
     VIEWS
     ══════════════════════════════════════════ */
  function showView(view) {
    var list = $('yb-seq-v-list');
    var builder = $('yb-seq-v-builder');
    var enrollView = $('yb-seq-v-enrollments');
    if (list) list.hidden = view !== 'list';
    if (builder) builder.hidden = view !== 'builder';
    if (enrollView) enrollView.hidden = view !== 'enrollments';

    // Toggle toolbar visibility
    var toolbar = document.querySelector('.yb-seq__toolbar');
    if (toolbar) toolbar.style.display = view === 'list' ? '' : 'none';
  }

  /* ══════════════════════════════════════════
     LOAD SEQUENCES
     ══════════════════════════════════════════ */
  function loadSequences() {
    apiCall('GET').then(function (data) {
      if (!data.ok) { toast(data.error || 'Load error', true); return; }
      sequences = data.items || [];
      loaded = true;
      renderList();
    }).catch(function (err) {
      console.error('[sequences-admin] Load error:', err);
      toast('Failed to load sequences', true);
    });
  }

  /* ══════════════════════════════════════════
     RENDER SEQUENCE LIST
     ══════════════════════════════════════════ */
  function renderList() {
    var container = $('yb-seq-list');
    if (!container) return;

    showView('list');

    if (!sequences.length) {
      container.innerHTML = '<div class="yb-admin__empty">' +
        '<p>No sequences yet.</p>' +
        '<p>Click <strong>+ ' + esc(T('seq_create', 'Create New Sequence')) + '</strong> to create your first sequence.</p>' +
        '</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < sequences.length; i++) {
      var s = sequences[i];
      var stats = s.stats || {};
      var statusClass = s.active !== false ? 'yb-seq__status--active' : 'yb-seq__status--inactive';
      var statusLabel = s.active !== false ? T('seq_active', 'Active') : T('seq_paused', 'Paused');
      var stepCount = (s.steps || []).length;
      var triggerLabel = getTriggerLabel(s.trigger);

      html += '<div class="yb-seq__card" data-id="' + esc(s.id) + '">' +
        '<div class="yb-seq__card-header">' +
          '<div class="yb-seq__card-title-row">' +
            '<h3 class="yb-seq__card-title">' + esc(s.name) + '</h3>' +
            '<span class="yb-seq__status ' + statusClass + '">' + statusLabel + '</span>' +
          '</div>' +
          '<p class="yb-seq__card-desc">' + esc(s.description || '') + '</p>' +
        '</div>' +
        '<div class="yb-seq__card-meta">' +
          '<span class="yb-seq__meta-item">' + stepCount + ' ' + T('seq_steps', 'Steps').toLowerCase() + '</span>' +
          '<span class="yb-seq__meta-sep">|</span>' +
          '<span class="yb-seq__meta-item">' + triggerLabel + '</span>' +
          '<span class="yb-seq__meta-sep">|</span>' +
          '<span class="yb-seq__meta-item">' + (stats.active || 0) + ' ' + T('seq_active', 'active').toLowerCase() + ', ' + (stats.completed || 0) + ' ' + T('seq_completed', 'completed').toLowerCase() + '</span>' +
        '</div>' +
        '<div class="yb-seq__card-actions">' +
          '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="seq-edit" data-id="' + esc(s.id) + '">Edit</button>' +
          '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="seq-enrollments" data-id="' + esc(s.id) + '">' + T('seq_enrollments', 'Enrolled') + ' (' + (stats.total_enrolled || 0) + ')</button>' +
          '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="seq-toggle" data-id="' + esc(s.id) + '" data-active="' + (s.active !== false ? 'true' : 'false') + '">' +
            (s.active !== false ? 'Pause' : 'Activate') +
          '</button>' +
        '</div>' +
      '</div>';
    }

    container.innerHTML = html;
  }

  function getTriggerLabel(trigger) {
    if (!trigger) return T('seq_trigger_manual', 'Manual');
    switch (trigger.type) {
      case 'new_lead': return T('seq_trigger_new_lead', 'New Lead');
      case 'status_change': return T('seq_trigger_status_change', 'Status Change');
      default: return T('seq_trigger_manual', 'Manual');
    }
  }

  /* ══════════════════════════════════════════
     SEQUENCE BUILDER
     ══════════════════════════════════════════ */
  function openBuilder(seq) {
    editingId = seq ? seq.id : null;
    showView('builder');

    var title = $('yb-seq-builder-title');
    if (title) title.textContent = editingId ? 'Edit Sequence' : T('seq_create', 'Create New Sequence');

    // Populate form
    $('yb-seq-id').value = editingId || '';
    $('yb-seq-name').value = seq ? seq.name : '';
    $('yb-seq-desc').value = seq ? seq.description || '' : '';

    // Trigger
    var trigger = seq ? (seq.trigger || { type: 'manual' }) : { type: 'manual' };
    var triggerRadios = document.querySelectorAll('[name="seq-trigger"]');
    triggerRadios.forEach(function (r) { r.checked = r.value === trigger.type; });
    updateTriggerConditions(trigger.type);

    if (trigger.conditions) {
      var condType = $('yb-seq-cond-type');
      var condSource = $('yb-seq-cond-source');
      var condProgram = $('yb-seq-cond-program');
      var condNewStatus = $('yb-seq-cond-new-status');
      if (condType) condType.value = trigger.conditions.lead_type || '';
      if (condSource) condSource.value = trigger.conditions.source_contains || '';
      if (condProgram) condProgram.value = trigger.conditions.program_type || '';
      if (condNewStatus) condNewStatus.value = trigger.conditions.new_status || '';
    }

    // Exit conditions
    var exitConds = seq ? (seq.exit_conditions || []) : ['converted', 'unsubscribed'];
    document.querySelectorAll('[name="seq-exit"]').forEach(function (cb) {
      cb.checked = exitConds.indexOf(cb.value) !== -1;
    });

    // Steps
    stepCounter = 0;
    var stepsContainer = $('yb-seq-steps');
    if (stepsContainer) stepsContainer.innerHTML = '';
    var steps = seq ? (seq.steps || []) : [];
    for (var i = 0; i < steps.length; i++) {
      addStepUI(steps[i]);
    }

    // Delete button
    var delBtn = $('yb-seq-delete-btn');
    if (delBtn) delBtn.hidden = !editingId;
  }

  function updateTriggerConditions(type) {
    var condBox = $('yb-seq-trigger-conditions');
    var statusField = $('yb-seq-status-change-field');
    if (condBox) condBox.hidden = type === 'manual';
    if (statusField) statusField.hidden = type !== 'status_change';
  }

  /* ── Step UI ── */
  function addStepUI(stepData) {
    stepCounter++;
    var num = stepCounter;
    var data = stepData || {};

    var stepsContainer = $('yb-seq-steps');
    if (!stepsContainer) return;

    var div = document.createElement('div');
    div.className = 'yb-seq__step';
    div.setAttribute('data-step-num', num);

    div.innerHTML =
      '<div class="yb-seq__step-header">' +
        '<span class="yb-seq__step-dot"></span>' +
        '<span class="yb-seq__step-label">' + T('seq_step_n', 'Step') + ' ' + num + '</span>' +
        '<div class="yb-seq__step-header-right">' +
          '<button type="button" class="yb-seq__step-move" data-action="seq-step-up" data-step="' + num + '" title="Move up">&#9650;</button>' +
          '<button type="button" class="yb-seq__step-move" data-action="seq-step-down" data-step="' + num + '" title="Move down">&#9660;</button>' +
          '<button type="button" class="yb-seq__step-remove" data-action="seq-step-remove" data-step="' + num + '" title="Remove">&times;</button>' +
        '</div>' +
      '</div>' +
      '<div class="yb-seq__step-body">' +
        '<div class="yb-admin__form-row">' +
          '<div class="yb-admin__field">' +
            '<label>' + T('seq_delay', 'Delay') + '</label>' +
            '<div class="yb-seq__delay-row">' +
              '<input type="number" class="yb-seq__delay-input" data-field="delay_days" min="0" value="' + (data.delay_days || 0) + '"> <span>' + T('seq_days', 'days') + '</span>' +
              '<input type="number" class="yb-seq__delay-input" data-field="delay_hours" min="0" max="23" value="' + (data.delay_hours || 0) + '"> <span>' + T('seq_hours', 'hours') + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="yb-admin__field">' +
            '<label>' + T('seq_channel', 'Channel') + '</label>' +
            '<select class="yb-admin__select" data-field="channel">' +
              '<option value="email"' + (data.channel === 'email' || !data.channel ? ' selected' : '') + '>' + T('seq_channel_email', 'Email') + '</option>' +
              '<option value="sms"' + (data.channel === 'sms' ? ' selected' : '') + '>' + T('seq_channel_sms', 'SMS') + '</option>' +
              '<option value="email+sms"' + (data.channel === 'email+sms' ? ' selected' : '') + '>' + T('seq_channel_both', 'Email + SMS') + '</option>' +
            '</select>' +
          '</div>' +
        '</div>' +
        '<div class="yb-admin__field yb-seq__email-fields">' +
          '<label>' + T('seq_subject', 'Subject') + '</label>' +
          '<input type="text" data-field="subject" value="' + esc(data.subject || '') + '" placeholder="Email subject line...">' +
        '</div>' +
        '<div class="yb-admin__field yb-seq__email-fields">' +
          '<label>' + T('seq_body', 'Body') + ' <small>(HTML, use {{first_name}}, {{program}}, {{unsubscribe_url}})</small></label>' +
          '<textarea data-field="body_html" rows="6" placeholder="<p>Hi {{first_name}}...</p>">' + esc(data.body_html || '') + '</textarea>' +
        '</div>' +
        '<div class="yb-admin__field yb-seq__sms-fields"' + (data.channel !== 'sms' && data.channel !== 'email+sms' ? ' hidden' : '') + '>' +
          '<label>' + T('seq_sms_text', 'SMS text') + '</label>' +
          '<textarea data-field="sms_text" rows="3" placeholder="Hi {{first_name}}...">' + esc(data.sms_text || '') + '</textarea>' +
        '</div>' +
        '<div class="yb-admin__field">' +
          '<label>' + T('seq_condition', 'Condition') + ' <small>(optional)</small></label>' +
          '<select class="yb-admin__select" data-field="condition">' +
            '<option value="">None</option>' +
            '<option value="status_not_converted"' + (data.condition && data.condition.status_not === 'Converted' ? ' selected' : '') + '>Status not Converted</option>' +
            '<option value="status_not_lost"' + (data.condition && data.condition.status_not === 'Lost' ? ' selected' : '') + '>Status not Lost</option>' +
            '<option value="has_phone"' + (data.condition && data.condition.has_phone ? ' selected' : '') + '>Has phone number</option>' +
          '</select>' +
        '</div>' +
      '</div>';

    stepsContainer.appendChild(div);

    // Channel change handler
    var channelSelect = div.querySelector('[data-field="channel"]');
    channelSelect.addEventListener('change', function () {
      var val = this.value;
      var emailFields = div.querySelectorAll('.yb-seq__email-fields');
      var smsFields = div.querySelectorAll('.yb-seq__sms-fields');
      emailFields.forEach(function (f) { f.hidden = val === 'sms'; });
      smsFields.forEach(function (f) { f.hidden = val === 'email'; });
    });
    // Initialize visibility
    channelSelect.dispatchEvent(new Event('change'));
  }

  function collectSteps() {
    var stepEls = document.querySelectorAll('.yb-seq__step');
    var steps = [];
    stepEls.forEach(function (el, i) {
      var getField = function (name) {
        var input = el.querySelector('[data-field="' + name + '"]');
        return input ? input.value : '';
      };

      var condValue = getField('condition');
      var condition = null;
      if (condValue === 'status_not_converted') condition = { status_not: 'Converted' };
      else if (condValue === 'status_not_lost') condition = { status_not: 'Lost' };
      else if (condValue === 'has_phone') condition = { has_phone: true };

      steps.push({
        step_number: i + 1,
        delay_days: parseInt(getField('delay_days')) || 0,
        delay_hours: parseInt(getField('delay_hours')) || 0,
        channel: getField('channel') || 'email',
        subject: getField('subject'),
        body_html: getField('body_html'),
        sms_text: getField('sms_text') || null,
        condition: condition
      });
    });
    return steps;
  }

  /* ── Save sequence ── */
  function saveSequence() {
    var name = $('yb-seq-name').value.trim();
    if (!name) { toast('Name is required', true); return; }

    // Trigger
    var triggerType = 'manual';
    document.querySelectorAll('[name="seq-trigger"]').forEach(function (r) {
      if (r.checked) triggerType = r.value;
    });
    var conditions = {};
    if (triggerType !== 'manual') {
      var ct = $('yb-seq-cond-type');
      var cs = $('yb-seq-cond-source');
      var cp = $('yb-seq-cond-program');
      if (ct && ct.value) conditions.lead_type = ct.value;
      if (cs && cs.value) conditions.source_contains = cs.value;
      if (cp && cp.value) conditions.program_type = cp.value;
      if (triggerType === 'status_change') {
        var ns = $('yb-seq-cond-new-status');
        if (ns && ns.value) conditions.new_status = ns.value;
      }
    }

    // Exit conditions
    var exitConds = [];
    document.querySelectorAll('[name="seq-exit"]:checked').forEach(function (cb) {
      exitConds.push(cb.value);
    });

    var payload = {
      name: name,
      description: $('yb-seq-desc').value.trim(),
      trigger: { type: triggerType, conditions: conditions },
      exit_conditions: exitConds,
      steps: collectSteps()
    };

    var method = editingId ? 'PUT' : 'POST';
    var params = editingId ? { id: editingId } : null;

    apiCall(method, params, payload).then(function (data) {
      if (!data.ok) { toast(data.error || 'Save failed', true); return; }
      toast(T('seq_saved', 'Sequence saved!'));
      loadSequences();
    }).catch(function (err) {
      console.error('[sequences-admin] Save error:', err);
      toast('Save failed', true);
    });
  }

  /* ── Delete sequence ── */
  function deleteSequence() {
    if (!editingId) return;
    if (!confirm(T('seq_delete_confirm', 'Delete this sequence?'))) return;

    apiCall('DELETE', { id: editingId }).then(function (data) {
      if (!data.ok) { toast(data.error || 'Delete failed', true); return; }
      toast(T('seq_deleted', 'Sequence deleted'));
      editingId = null;
      loadSequences();
    }).catch(function (err) {
      toast('Delete failed', true);
    });
  }

  /* ══════════════════════════════════════════
     ENROLLMENT MANAGEMENT
     ══════════════════════════════════════════ */
  function openEnrollments(seqId) {
    currentSeqId = seqId;
    showView('enrollments');

    var seq = sequences.find(function (s) { return s.id === seqId; });
    var title = $('yb-seq-enrollments-title');
    if (title && seq) title.textContent = seq.name + ' — ' + T('seq_enrollments', 'Enrolled');

    loadEnrollments();
  }

  function loadEnrollments() {
    if (!currentSeqId) return;

    apiCall('GET', { action: 'enrollments', sequence_id: currentSeqId }).then(function (data) {
      if (!data.ok) { toast(data.error || 'Load error', true); return; }
      enrollments = data.items || [];
      renderEnrollments();
    }).catch(function (err) {
      toast('Failed to load enrollments', true);
    });
  }

  function renderEnrollments() {
    var tbody = $('yb-seq-enrollment-body');
    if (!tbody) return;

    if (!enrollments.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="yb-admin__empty">No leads enrolled in this sequence yet.</td></tr>';
      return;
    }

    var html = '';
    for (var i = 0; i < enrollments.length; i++) {
      var e = enrollments[i];
      var statusClass = 'yb-seq__enroll-status--' + (e.status || 'active');
      var historyCount = (e.step_history || []).length;

      html += '<tr>' +
        '<td>' +
          '<strong>' + esc(e.lead_name || '') + '</strong><br>' +
          '<small>' + esc(e.lead_email || '') + '</small>' +
        '</td>' +
        '<td>' + (e.current_step || 1) + ' <small>(' + historyCount + ' sent)</small></td>' +
        '<td><span class="yb-seq__enroll-status ' + statusClass + '">' + esc(e.status || 'active') + '</span></td>' +
        '<td><small>' + formatDate(e.next_send_at) + '</small></td>' +
        '<td><small>' + formatDate(e.started_at) + '</small></td>' +
        '<td>';

      if (e.status === 'active') {
        html += '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="seq-pause-enrollment" data-id="' + esc(e.id) + '">Pause</button> ';
        html += '<button class="yb-btn yb-btn--outline yb-btn--sm yb-admin__icon-btn--danger" data-action="seq-unenroll" data-id="' + esc(e.id) + '">Remove</button>';
      } else if (e.status === 'paused') {
        html += '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="seq-resume-enrollment" data-id="' + esc(e.id) + '">Resume</button> ';
        html += '<button class="yb-btn yb-btn--outline yb-btn--sm yb-admin__icon-btn--danger" data-action="seq-unenroll" data-id="' + esc(e.id) + '">Remove</button>';
      }

      html += '</td></tr>';
    }

    tbody.innerHTML = html;
  }

  /* ── Search leads for enrollment ── */
  function searchLeadsForEnroll() {
    var input = $('yb-seq-enroll-search');
    var query = input ? input.value.trim() : '';
    if (!query) return;

    // Search leads via leads API
    getAuthToken().then(function (token) {
      return fetch('/.netlify/functions/leads?search=' + encodeURIComponent(query) + '&limit=20', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
    }).then(function (res) { return res.json(); })
    .then(function (data) {
      var results = $('yb-seq-lead-results');
      if (!results) return;
      results.hidden = false;

      var leads = data.items || data.leads || [];
      if (!leads.length) {
        results.innerHTML = '<p class="yb-admin__empty">No leads found.</p>';
        return;
      }

      // Filter out already enrolled leads
      var enrolledIds = new Set(enrollments.map(function (e) { return e.lead_id; }));

      var html = '<div class="yb-seq__lead-result-list">';
      for (var i = 0; i < leads.length; i++) {
        var l = leads[i];
        var alreadyEnrolled = enrolledIds.has(l.id);
        html += '<div class="yb-seq__lead-result-item">' +
          '<div>' +
            '<strong>' + esc(l.first_name || '') + ' ' + esc(l.last_name || '') + '</strong>' +
            '<br><small>' + esc(l.email || '') + '</small>' +
          '</div>' +
          '<button class="yb-btn yb-btn--sm ' + (alreadyEnrolled ? 'yb-btn--outline' : 'yb-btn--primary') + '"' +
            (alreadyEnrolled ? ' disabled' : ' data-action="seq-enroll-lead" data-lead-id="' + esc(l.id) + '"') + '>' +
            (alreadyEnrolled ? 'Already enrolled' : 'Enroll') +
          '</button>' +
        '</div>';
      }
      html += '</div>';
      results.innerHTML = html;
    }).catch(function (err) {
      toast('Search failed', true);
    });
  }

  function enrollLead(leadId) {
    if (!currentSeqId || !leadId) return;

    apiCall('POST', { action: 'enroll' }, {
      sequence_id: currentSeqId,
      lead_ids: [leadId]
    }).then(function (data) {
      if (!data.ok) { toast(data.error || 'Enroll failed', true); return; }
      toast('Lead enrolled!');
      loadEnrollments();
      // Hide search results
      var results = $('yb-seq-lead-results');
      if (results) results.hidden = true;
      var input = $('yb-seq-enroll-search');
      if (input) input.value = '';
    }).catch(function (err) {
      toast('Enroll failed', true);
    });
  }

  function pauseEnrollment(enrollmentId) {
    apiCall('POST', { action: 'pause' }, { enrollment_id: enrollmentId })
    .then(function (data) {
      if (!data.ok) { toast(data.error, true); return; }
      toast('Enrollment paused');
      loadEnrollments();
    });
  }

  function resumeEnrollment(enrollmentId) {
    apiCall('POST', { action: 'resume' }, { enrollment_id: enrollmentId })
    .then(function (data) {
      if (!data.ok) { toast(data.error, true); return; }
      toast('Enrollment resumed');
      loadEnrollments();
    });
  }

  function unenrollLead(enrollmentId) {
    if (!confirm('Remove this lead from the sequence?')) return;
    apiCall('POST', { action: 'unenroll' }, { enrollment_ids: [enrollmentId] })
    .then(function (data) {
      if (!data.ok) { toast(data.error, true); return; }
      toast('Lead removed from sequence');
      loadEnrollments();
    });
  }

  /* ══════════════════════════════════════════
     STEP REORDER
     ══════════════════════════════════════════ */
  function moveStep(stepNum, direction) {
    var container = $('yb-seq-steps');
    if (!container) return;
    var steps = Array.from(container.querySelectorAll('.yb-seq__step'));
    var idx = steps.findIndex(function (el) { return el.getAttribute('data-step-num') === String(stepNum); });
    if (idx === -1) return;

    var targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= steps.length) return;

    if (direction === 'up') {
      container.insertBefore(steps[idx], steps[targetIdx]);
    } else {
      container.insertBefore(steps[targetIdx], steps[idx]);
    }

    // Renumber step labels
    container.querySelectorAll('.yb-seq__step').forEach(function (el, i) {
      var label = el.querySelector('.yb-seq__step-label');
      if (label) label.textContent = T('seq_step_n', 'Step') + ' ' + (i + 1);
    });
  }

  function removeStep(stepNum) {
    var el = document.querySelector('.yb-seq__step[data-step-num="' + stepNum + '"]');
    if (el) el.remove();
    // Renumber
    var container = $('yb-seq-steps');
    if (container) {
      container.querySelectorAll('.yb-seq__step').forEach(function (el, i) {
        var label = el.querySelector('.yb-seq__step-label');
        if (label) label.textContent = T('seq_step_n', 'Step') + ' ' + (i + 1);
      });
    }
  }

  /* ══════════════════════════════════════════
     EVENT DELEGATION
     ══════════════════════════════════════════ */
  function initPanel() {
    var panel = document.querySelector('[data-yb-admin-panel="sequences"]');
    if (!panel) return;

    panel.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-action');

      switch (action) {
        case 'seq-create':
          openBuilder(null);
          break;
        case 'seq-refresh':
          loadSequences();
          break;
        case 'seq-back':
          showView('list');
          break;
        case 'seq-edit':
          var seq = sequences.find(function (s) { return s.id === btn.getAttribute('data-id'); });
          if (seq) openBuilder(seq);
          break;
        case 'seq-enrollments':
          openEnrollments(btn.getAttribute('data-id'));
          break;
        case 'seq-toggle':
          toggleSequence(btn.getAttribute('data-id'), btn.getAttribute('data-active') === 'true');
          break;
        case 'seq-add-step':
          addStepUI(null);
          break;
        case 'seq-step-up':
          moveStep(parseInt(btn.getAttribute('data-step')), 'up');
          break;
        case 'seq-step-down':
          moveStep(parseInt(btn.getAttribute('data-step')), 'down');
          break;
        case 'seq-step-remove':
          removeStep(parseInt(btn.getAttribute('data-step')));
          break;
        case 'seq-delete':
          deleteSequence();
          break;
        case 'seq-search-leads':
          searchLeadsForEnroll();
          break;
        case 'seq-enroll-lead':
          enrollLead(btn.getAttribute('data-lead-id'));
          break;
        case 'seq-pause-enrollment':
          pauseEnrollment(btn.getAttribute('data-id'));
          break;
        case 'seq-resume-enrollment':
          resumeEnrollment(btn.getAttribute('data-id'));
          break;
        case 'seq-unenroll':
          unenrollLead(btn.getAttribute('data-id'));
          break;
      }
    });

    // Form submit
    var form = $('yb-seq-form');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        saveSequence();
      });
    }

    // Trigger radio change
    var triggerRadios = panel.querySelectorAll('[name="seq-trigger"]');
    triggerRadios.forEach(function (r) {
      r.addEventListener('change', function () {
        updateTriggerConditions(this.value);
      });
    });

    // Enter key in enroll search
    var enrollSearch = $('yb-seq-enroll-search');
    if (enrollSearch) {
      enrollSearch.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); searchLeadsForEnroll(); }
      });
    }
  }

  function toggleSequence(id, currentlyActive) {
    apiCall('PUT', { id: id }, { active: !currentlyActive }).then(function (data) {
      if (!data.ok) { toast(data.error, true); return; }
      toast(currentlyActive ? 'Sequence paused' : 'Sequence activated');
      loadSequences();
    });
  }

  /* ══════════════════════════════════════════
     TAB ACTIVATION + INIT
     ══════════════════════════════════════════ */
  function onTabActivate() {
    if (!loaded) loadSequences();
  }

  // Watch for tab clicks
  document.addEventListener('click', function (e) {
    var tab = e.target.closest('[data-yb-admin-tab="sequences"]');
    if (tab) setTimeout(onTabActivate, 50);
  });

  // Also handle if sequences tab is activated by URL hash
  if (window.location.hash === '#sequences') {
    setTimeout(onTabActivate, 500);
  }

  // Init on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPanel);
  } else {
    initPanel();
  }

})();
