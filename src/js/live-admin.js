(function () {
  'use strict';

  /* ══════════════════════════════════════════
     STATE
     ══════════════════════════════════════════ */
  var T = window._ybAdminT || {};
  var LANG = window._ybAdminLang || 'da';
  var items = [];
  var loaded = false;
  var mbClasses = [];
  var mbSelectedIdxs = new Set();
  var liveSelectedIds = new Set();
  var API = '/.netlify/functions/live-admin';

  // ── Catalogue data (fetched once, cached) ──
  var catalogData = null;       // raw array from /.netlify/functions/catalog
  var catalogPrograms = [];     // [{ course_id, course_name, category }] unique programs
  var catalogCohortMap = {};    // course_id → [{ cohort_id, cohort_label, buildId }]
  var catalogLoading = false;
  var catalogLoaded = false;

  /* ══════════════════════════════════════════
     HELPERS
     ══════════════════════════════════════════ */
  function t(k) { return T[k] || k; }
  function $(id) { return document.getElementById(id); }
  function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  function toast(msg, isError) {
    var el = $('yb-admin-toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'yb-admin__toast' + (isError ? ' yb-admin__toast--error' : '');
    el.hidden = false;
    clearTimeout(el._tid);
    el._tid = setTimeout(function () { el.hidden = true; }, 3500);
  }

  function getToken() {
    if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) {
      return firebase.auth().currentUser.getIdToken();
    }
    return Promise.resolve('');
  }

  function apiFetch(action, opts) {
    opts = opts || {};
    return getToken().then(function (token) {
      var url = API + '?action=' + action;
      if (opts.params) {
        for (var k in opts.params) {
          url += '&' + k + '=' + encodeURIComponent(opts.params[k]);
        }
      }
      var fetchOpts = {
        method: opts.method || 'GET',
        headers: { 'Content-Type': 'application/json' }
      };
      if (token) fetchOpts.headers['Authorization'] = 'Bearer ' + token;
      if (opts.body) fetchOpts.body = JSON.stringify(opts.body);
      return fetch(url, fetchOpts).then(function (r) { return r.json(); });
    });
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    var day = String(d.getDate()).padStart(2, '0');
    var mon = String(d.getMonth() + 1).padStart(2, '0');
    var yr = d.getFullYear();
    var h = String(d.getHours()).padStart(2, '0');
    var m = String(d.getMinutes()).padStart(2, '0');
    return day + '/' + mon + '/' + yr + ' ' + h + ':' + m;
  }

  function statusBadge(status) {
    var cls = 'yb-admin__status-badge';
    var label = t('live_status_' + status) || status;
    if (status === 'live') cls += ' yb-admin__status-badge--live';
    else if (status === 'ended') cls += ' yb-admin__status-badge--muted';
    else if (status === 'cancelled') cls += ' yb-admin__status-badge--danger';
    return '<span class="' + cls + '">' + esc(label) + '</span>';
  }

  function sourceBadge(source) {
    return '<span class="yb-admin__source-badge yb-admin__source-badge--' + (source || 'manual') + '">' +
      esc(t(source === 'mindbody' ? 'live_source_mindbody' : 'live_source_manual')) + '</span>';
  }

  function accessLabel(access) {
    if (!access) return '—';
    var parts = [];
    if (access.roles && access.roles.length) parts.push(access.roles.join(', '));
    if (access.permissions && access.permissions.length) parts.push(access.permissions.join(', '));
    return parts.join(' · ') || '—';
  }

  /* ══════════════════════════════════════════
     CATALOGUE
     ══════════════════════════════════════════ */

  /**
   * Derive the cohort suffix from a course_id.
   * Must match activate-applicant.js buildCohortId() format exactly.
   */
  /**
   * Derive the cohort suffix from a course_id.
   * Must match activate-applicant.js buildCohortId() format:
   *   buildCohortId appends suffix based on ytt_program_type:
   *     '18-week'    → '-18W'
   *     '4-week'     → '-4W'
   *     '8-week'     → '-8W'
   *     '300h'       → '-300H'
   *     '4-week-jul' → '' (no suffix — known gap in buildCohortId)
   *   Non-YTT courses have no ytt_program_type → no suffix.
   */
  function cohortSuffixFromCourseId(courseId) {
    if (!courseId) return '';
    var c = courseId.toUpperCase();
    if (c.indexOf('YTT200-18W') === 0) return '-18W';
    // Vinyasa Plus: ytt_program_type is '4-week-jul' → no suffix in buildCohortId
    if (c === 'YTT200-4W-VP') return '';
    if (c.indexOf('YTT200-4W') === 0) return '-4W';
    if (c.indexOf('YTT200-8W') === 0) return '-8W';
    if (c.indexOf('YTT300') === 0) return '-300H';
    if (c.indexOf('YTT500') === 0) return '-500H';
    // Non-YTT courses: no ytt_program_type → no suffix
    return '';
  }

  function fetchCatalog(callback) {
    if (catalogLoaded && catalogData) { if (callback) callback(); return; }
    if (catalogLoading) return;
    catalogLoading = true;

    fetch('/.netlify/functions/catalog')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        catalogLoading = false;
        if (!data.ok || !data.catalog) {
          console.warn('[live-admin] Catalog fetch failed:', data.error);
          catalogLoaded = true;
          if (callback) callback();
          return;
        }
        catalogData = data.catalog;
        buildCatalogMaps();
        catalogLoaded = true;
        if (callback) callback();
      })
      .catch(function (err) {
        catalogLoading = false;
        catalogLoaded = true;
        console.error('[live-admin] Catalog fetch error:', err);
        if (callback) callback();
      });
  }

  function buildCatalogMaps() {
    var seen = {};
    catalogPrograms = [];
    catalogCohortMap = {};

    for (var i = 0; i < catalogData.length; i++) {
      var row = catalogData[i];
      if (!row.course_id || !row.active) continue;
      // Skip bundles — they're payment packages, not access categories
      if (row.category === 'Bundle') continue;

      // Unique programs (dedupe by course_id — one per program type)
      if (!seen[row.course_id]) {
        seen[row.course_id] = true;
        catalogPrograms.push({
          course_id: row.course_id,
          course_name: row.course_name || row.course_id,
          category: row.category || ''
        });
      }

      // Cohorts per program
      if (!catalogCohortMap[row.course_id]) catalogCohortMap[row.course_id] = [];
      var suffix = cohortSuffixFromCourseId(row.course_id);
      var buildId = (row.cohort_id || '') + suffix;
      catalogCohortMap[row.course_id].push({
        cohort_id: row.cohort_id || '',
        cohort_label: row.cohort_label || row.cohort_id || '',
        buildId: buildId
      });
    }

    // Sort programs by category then name
    var catOrder = { Education: 0, Course: 1, Mentorship: 2 };
    catalogPrograms.sort(function (a, b) {
      var ca = catOrder[a.category] !== undefined ? catOrder[a.category] : 9;
      var cb = catOrder[b.category] !== undefined ? catOrder[b.category] : 9;
      if (ca !== cb) return ca - cb;
      return a.course_name.localeCompare(b.course_name);
    });
  }

  /* ── Pill rendering helpers ── */

  function renderProgramPills(containerId, selectedIds) {
    var container = $(containerId);
    if (!container) return;
    if (!catalogPrograms.length) {
      container.innerHTML = '<span class="yb-la__loading-text">Loading catalogue…</span>';
      return;
    }

    var html = '';
    var lastCat = '';
    for (var i = 0; i < catalogPrograms.length; i++) {
      var p = catalogPrograms[i];
      // Category header
      if (p.category !== lastCat) {
        if (lastCat) html += '<br>';
        html += '<span class="yb-la__pill-category">' + esc(p.category) + '</span>';
        lastCat = p.category;
      }
      var isActive = selectedIds.indexOf(p.course_id) !== -1;
      html += '<button type="button" class="yb-la-prog-pill' + (isActive ? ' yb-la-pill--active' : '') + '" data-course-id="' + esc(p.course_id) + '">' +
        esc(p.course_name) +
        ' <span class="yb-la__pill-id">(' + esc(p.course_id) + ')</span>' +
        '</button> ';
    }
    container.innerHTML = html;
  }

  function renderCohortPills(containerId, selectedPrograms, selectedCohorts) {
    var container = $(containerId);
    if (!container) return;

    if (!selectedPrograms || !selectedPrograms.length) {
      container.innerHTML = '<span class="yb-la__loading-text">Select a program first</span>';
      return;
    }

    var html = '';
    for (var pi = 0; pi < selectedPrograms.length; pi++) {
      var progId = selectedPrograms[pi];
      var cohorts = catalogCohortMap[progId] || [];
      if (!cohorts.length) continue;

      // Find program name
      var progName = progId;
      for (var j = 0; j < catalogPrograms.length; j++) {
        if (catalogPrograms[j].course_id === progId) { progName = catalogPrograms[j].course_name; break; }
      }
      html += '<span class="yb-la__pill-category">' + esc(progName) + '</span>';

      for (var ci = 0; ci < cohorts.length; ci++) {
        var c = cohorts[ci];
        var isActive = selectedCohorts.indexOf(c.buildId) !== -1;
        html += '<button type="button" class="yb-la-cohort-pill' + (isActive ? ' yb-la-pill--active' : '') + '" data-build-id="' + esc(c.buildId) + '">' +
          esc(c.cohort_label) +
          ' <span class="yb-la__pill-id--sm">(' + esc(c.buildId) + ')</span>' +
          '</button> ';
      }
    }
    if (!html) {
      html = '<span class="yb-la__loading-text">No cohorts found for selected programs</span>';
    }
    container.innerHTML = html;
  }

  function getSelectedProgramIds(containerId) {
    var pills = document.querySelectorAll('#' + containerId + ' .yb-la-prog-pill.yb-la-pill--active');
    var ids = [];
    for (var i = 0; i < pills.length; i++) {
      ids.push(pills[i].getAttribute('data-course-id'));
    }
    return ids;
  }

  function getSelectedCohortBuildIds(containerId) {
    var pills = document.querySelectorAll('#' + containerId + ' .yb-la-cohort-pill.yb-la-pill--active');
    var ids = [];
    for (var i = 0; i < pills.length; i++) {
      ids.push(pills[i].getAttribute('data-build-id'));
    }
    return ids;
  }

  /* ── Pill helpers for roles + perms ── */
  function getActivePillValues(scopeEl, selector) {
    var pills = scopeEl.querySelectorAll(selector + '.yb-la-pill--active');
    var vals = [];
    for (var i = 0; i < pills.length; i++) vals.push(pills[i].getAttribute('data-value'));
    return vals;
  }

  function setPillsActive(scopeEl, selector, values) {
    var pills = scopeEl.querySelectorAll(selector);
    var set = {};
    for (var i = 0; i < values.length; i++) set[values[i]] = true;
    for (var j = 0; j < pills.length; j++) {
      var v = pills[j].getAttribute('data-value');
      if (set[v]) pills[j].classList.add('yb-la-pill--active');
      else pills[j].classList.remove('yb-la-pill--active');
    }
  }

  function toggleTeacherSection(scopeEl) {
    var teacherActive = scopeEl.querySelector('.yb-la-role-pill.yb-la-pill--active[data-value="teacher"]');
    var sections = scopeEl.querySelectorAll('.yb-la__teacher-section');
    for (var i = 0; i < sections.length; i++) sections[i].hidden = !teacherActive;
  }

  function titleCase(s) {
    return (s || '').replace(/(?:^|[-:])([a-z])/g, function (m, c) { return m.replace(c, c.toUpperCase()); });
  }

  function programLabel(progId) {
    for (var i = 0; i < catalogPrograms.length; i++) {
      if (catalogPrograms[i].course_id === progId) return catalogPrograms[i].course_name;
    }
    return progId;
  }

  function cohortLabel(buildId) {
    for (var pid in catalogCohortMap) {
      var arr = catalogCohortMap[pid] || [];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].buildId === buildId) return arr[i].cohort_label;
      }
    }
    return buildId;
  }

  function updateAccessSummary(summaryId, programContainerId, cohortContainerId) {
    var el = $(summaryId);
    if (!el) return;

    var progs = getSelectedProgramIds(programContainerId);
    var cohorts = getSelectedCohortBuildIds(cohortContainerId);

    // Scope: form vs bulk
    var isForm = programContainerId === 'yb-la-programs-container';
    var scope = isForm ? $('yb-live-admin-v-form') : $('yb-live-bulk-access-panel');
    if (!scope) { el.textContent = 'Visible to: everyone (no restrictions)'; return; }

    var roles = getActivePillValues(scope, '.yb-la-role-pill').map(titleCase);
    var perms = getActivePillValues(scope, '.yb-la-perm-pill');

    // Toggle teacher section visibility based on role pills
    toggleTeacherSection(scope);

    if (!roles.length && !progs.length && !cohorts.length && !perms.length) {
      el.textContent = 'Visible to: everyone (no restrictions)';
      return;
    }

    var who = roles.length ? '[' + roles.join(', ') + ']' : '[everyone]';
    var programLabels = progs.map(programLabel);
    var cohortLabels = cohorts.map(cohortLabel);
    var programPart = '';
    if (progs.length && cohorts.length) {
      programPart = ' enrolled in [' + programLabels.join(', ') + ' — ' + cohortLabels.join(', ') + ']';
    } else if (progs.length) {
      programPart = ' enrolled in [' + programLabels.join(', ') + ']';
    }
    var permPart = perms.length ? ' with [' + perms.map(function (p) {
      return titleCase(p.replace(/^[a-z]+:/, ''));
    }).join(', ') + '] permission' : '';

    el.textContent = 'This session is visible to: ' + who + programPart + permPart;
  }

  /* ══════════════════════════════════════════
     VIEWS
     ══════════════════════════════════════════ */
  function showView(name) {
    var views = ['yb-live-admin-v-list', 'yb-live-admin-v-form', 'yb-live-admin-v-mb'];
    for (var i = 0; i < views.length; i++) {
      var el = $(views[i]);
      if (el) el.hidden = views[i] !== 'yb-live-admin-v-' + name;
    }
  }

  /* ══════════════════════════════════════════
     LIST
     ══════════════════════════════════════════ */
  function loadItems() {
    apiFetch('list').then(function (res) {
      if (res.ok) {
        items = res.items || [];
        loaded = true;
        renderTable();
      } else {
        toast(res.error || t('error_load'), true);
      }
    }).catch(function () {
      toast(t('error_load'), true);
    });
  }

  function getFilteredItems() {
    var filter = ($('yb-live-admin-filter') || {}).value || 'upcoming';
    var sourceFilter = ($('yb-live-admin-source-filter') || {}).value || '';
    var now = new Date().toISOString();

    return items.filter(function (item) {
      // Time filter
      if (filter === 'upcoming' && item.startDateTime && item.startDateTime < now && item.status !== 'live') return false;
      if (filter === 'past' && item.startDateTime && item.startDateTime >= now) return false;

      // Source filter
      if (sourceFilter && item.source !== sourceFilter) return false;

      return true;
    });
  }

  function renderTable() {
    var tbody = $('yb-live-admin-table-body');
    var emptyEl = $('yb-live-admin-empty');
    var countEl = $('yb-live-admin-count');
    if (!tbody) return;

    var filtered = getFilteredItems();

    if (countEl) countEl.textContent = filtered.length + ' session' + (filtered.length !== 1 ? 's' : '');
    if (emptyEl) emptyEl.hidden = filtered.length > 0;

    if (!filtered.length) {
      tbody.innerHTML = '';
      return;
    }

    var html = '';
    for (var i = 0; i < filtered.length; i++) {
      var item = filtered[i];
      var titleField = LANG === 'en' ? 'title_en' : 'title_da';
      var title = item[titleField] || item.title_da || item.title_en || '—';
      var isSelected = liveSelectedIds.has(item.id);

      html += '<tr>';
      html += '<td><input type="checkbox" class="yb-la-live-cb" data-id="' + item.id + '"' + (isSelected ? ' checked' : '') + '></td>';
      html += '<td>' + statusBadge(item.status) + recordingBadge(item) + '</td>';
      html += '<td><strong>' + esc(title) + '</strong></td>';
      html += '<td>' + fmtDate(item.startDateTime) + '</td>';
      html += '<td>' + sourceBadge(item.source) + '</td>';
      html += '<td>' + esc(item.instructor || '—') + '</td>';
      html += '<td class="yb-la__td-sm">' + esc(accessLabel(item.access)) + '</td>';
      html += '<td>';
      html += '<button class="yb-admin__icon-btn" data-action="live-edit" data-id="' + item.id + '" title="' + t('edit') + '">&#9998;</button> ';
      html += '<button class="yb-admin__icon-btn yb-admin__icon-btn--danger" data-action="live-delete" data-id="' + item.id + '" title="' + t('delete') + '">&#128465;</button>';
      html += '</td>';
      html += '</tr>';
    }
    tbody.innerHTML = html;
    updateLiveSelectAllCb();
    updateLiveBulkBar();
  }

  /* ══════════════════════════════════════════
     FORM
     ══════════════════════════════════════════ */
  // Toggle co-teachers field visibility based on stream type
  function toggleStreamTypeFields(type) {
    var coTeachersField = $('yb-la-coteachers-field');
    var meetingUrlField = $('yb-la-meeting-url-field');
    if (coTeachersField) { if (type === 'panel') coTeachersField.classList.remove('yb-la__hidden-field'); else coTeachersField.classList.add('yb-la__hidden-field'); }
    if (meetingUrlField) { if (type === 'meet') meetingUrlField.classList.remove('yb-la__hidden-field'); else meetingUrlField.classList.add('yb-la__hidden-field'); }
  }

  var streamTypeSelect = $('yb-la-stream-type');
  if (streamTypeSelect) {
    streamTypeSelect.addEventListener('change', function () {
      toggleStreamTypeFields(this.value);
    });
  }

  function openForm(item) {
    var isEdit = !!item;
    $('yb-live-admin-form-title').textContent = isEdit ? t('live_form_edit_title') : t('live_form_title');
    $('yb-la-id').value = isEdit ? item.id : '';
    var idDisplay = $('yb-la-id-display');
    var idText = $('yb-la-id-text');
    if (idDisplay && idText) {
      if (isEdit) { idText.textContent = item.id; idDisplay.style.display = 'block'; }
      else { idDisplay.style.display = 'none'; }
    }
    $('yb-la-source').value = (item && item.source) || 'manual';
    $('yb-la-status').value = (item && item.status) || 'scheduled';
    $('yb-la-title-da').value = (item && item.title_da) || '';
    $('yb-la-title-en').value = (item && item.title_en) || '';
    $('yb-la-desc-da').value = (item && item.description_da) || '';
    $('yb-la-desc-en').value = (item && item.description_en) || '';
    $('yb-la-instructor').value = (item && item.instructor) || '';
    if ($('yb-la-teacher-email')) $('yb-la-teacher-email').value = (item && item.teacherEmail) || '';
    $('yb-la-mux-playback').value = (item && item.muxPlaybackId) || '';
    $('yb-la-recording-id').value = (item && item.recordingPlaybackId) || '';
    $('yb-la-recurrence').value = (item && item.recurrence && item.recurrence.type) || 'none';
    $('yb-la-recurrence-end').value = (item && item.recurrence && item.recurrence.endDate) || '';
    // Program & cohort pills (catalogue-driven)
    var itemPrograms = (item && item.programs) || [];
    var itemCohorts = (item && item.cohorts) || [];
    fetchCatalog(function () {
      renderProgramPills('yb-la-programs-container', itemPrograms);
      renderCohortPills('yb-la-cohorts-container', itemPrograms, itemCohorts);
      updateAccessSummary('yb-la-access-summary', 'yb-la-programs-container', 'yb-la-cohorts-container');
    });

    // Legacy cohort text field (hidden, kept for backwards compat display)
    var legacyCohort = $('yb-la-cohorts');
    if (legacyCohort) legacyCohort.value = (item && item.cohorts && item.cohorts.length) ? item.cohorts.join(', ') : '';

    // Stream type (migrate from old interactive boolean)
    var streamTypeSel = $('yb-la-stream-type');
    if (streamTypeSel) {
      var st = (item && item.streamType) || (item && item.interactive ? 'interactive' : 'broadcast');
      streamTypeSel.value = st;
      toggleStreamTypeFields(st);
    }

    // Meeting URL
    var meetingUrlInput = $('yb-la-meeting-url');
    if (meetingUrlInput) {
      meetingUrlInput.value = (item && item.meetingUrl) || '';
    }

    // Co-teachers
    var coteachersInput = $('yb-la-coteachers');
    if (coteachersInput) {
      coteachersInput.value = (item && item.coTeachers && item.coTeachers.length) ? item.coTeachers.join(', ') : '';
    }

    // Start/end datetime-local
    if (item && item.startDateTime) {
      $('yb-la-start').value = item.startDateTime.slice(0, 16);
    } else {
      $('yb-la-start').value = '';
    }
    if (item && item.endDateTime) {
      $('yb-la-end').value = item.endDateTime.slice(0, 16);
    } else {
      $('yb-la-end').value = '';
    }

    // Role + permission pills
    var formScope = $('yb-live-admin-v-form');
    if (formScope) {
      var roles = (item && item.access && item.access.roles) || ['trainee', 'teacher', 'admin'];
      var permsList = (item && item.access && item.access.permissions) || ['live-streaming'];
      setPillsActive(formScope, '.yb-la-role-pill', roles);
      setPillsActive(formScope, '.yb-la-perm-pill', permsList);
      toggleTeacherSection(formScope);
    }

    // Recording asset id (hidden field)
    var recAssetEl = $('yb-la-recording-asset-id');
    if (recAssetEl) recAssetEl.value = (item && item.recordingAssetId) || '';

    // "Link existing recording" toggle — only shown on create
    var linkWrap = $('yb-la-link-existing-wrap');
    if (linkWrap) linkWrap.hidden = isEdit;
    var linkToggle = $('yb-la-link-existing-toggle');
    if (linkToggle) linkToggle.checked = false;

    // AI content section — show only for ended sessions with recordings
    var aiSection = $('yb-la-ai-section');
    if (aiSection) {
      var showAi = isEdit && item.status === 'ended' && item.recordingPlaybackId;
      aiSection.hidden = !showAi;
      if (showAi) {
        // Bilingual fields (prefer _da/_en, fall back to legacy)
        $('yb-la-ai-summary-da').value = item.aiSummary_da || item.aiSummary || '';
        $('yb-la-ai-summary-en').value = item.aiSummary_en || item.aiSummary || '';
        $('yb-la-ai-quiz-da').value = item.aiQuiz_da ? (typeof item.aiQuiz_da === 'string' ? formatJsonStr(item.aiQuiz_da) : JSON.stringify(item.aiQuiz_da, null, 2)) : (item.aiQuiz ? (typeof item.aiQuiz === 'string' ? formatJsonStr(item.aiQuiz) : JSON.stringify(item.aiQuiz, null, 2)) : '');
        $('yb-la-ai-quiz-en').value = item.aiQuiz_en ? (typeof item.aiQuiz_en === 'string' ? formatJsonStr(item.aiQuiz_en) : JSON.stringify(item.aiQuiz_en, null, 2)) : (item.aiQuiz ? (typeof item.aiQuiz === 'string' ? formatJsonStr(item.aiQuiz) : JSON.stringify(item.aiQuiz, null, 2)) : '');
        // Legacy fields
        $('yb-la-ai-summary').value = item.aiSummary || '';
        $('yb-la-ai-quiz').value = item.aiQuiz ? (typeof item.aiQuiz === 'string' ? formatJsonStr(item.aiQuiz) : JSON.stringify(item.aiQuiz, null, 2)) : '';
        var statusEl = $('yb-la-ai-status');
        var st = item.aiStatus || 'none';
        statusEl.textContent = st === 'translating' ? 'translating' : st;
        statusEl.style.background = st === 'complete' ? '#16a34a' : st === 'processing' || st === 'preparing_audio' || st === 'transcribing' || st === 'generating_summary' || st === 'translating' || st === 'captions_requested' ? '#f75c03' : st === 'error' ? '#dc2626' : '#E8E4E0';
        statusEl.style.color = st === 'none' ? '#6F6A66' : '#fff';
        // Default to DA tab
        if (window._aiLangTab) window._aiLangTab('da');
        // Hide preview
        var previewEl = $('yb-la-ai-preview');
        if (previewEl) previewEl.hidden = true;
        // Clear quiz error
        var quizErr = $('yb-la-ai-quiz-error');
        if (quizErr) quizErr.hidden = true;
      }
    }

    toggleSourceFields();
    toggleRecurrenceEnd();
    showView('form');
  }

  function formatJsonStr(s) {
    try { return JSON.stringify(JSON.parse(s), null, 2); } catch (e) { return s; }
  }

  function toggleSourceFields() {
    var source = $('yb-la-source').value;
    var mbWrap = $('yb-la-mb-wrap');
    var recWrap = $('yb-la-recurrence-wrap');
    if (mbWrap) mbWrap.hidden = source !== 'mindbody';
    if (recWrap) recWrap.hidden = source === 'mindbody';
  }

  function toggleRecurrenceEnd() {
    var val = $('yb-la-recurrence').value;
    var wrap = $('yb-la-recurrence-end-wrap');
    if (wrap) wrap.hidden = val === 'none';
  }

  function collectFormData() {
    var formScope = $('yb-live-admin-v-form');
    var roles = formScope ? getActivePillValues(formScope, '.yb-la-role-pill') : [];
    var perms = formScope ? getActivePillValues(formScope, '.yb-la-perm-pill') : [];

    var data = {
      source: $('yb-la-source').value,
      status: $('yb-la-status').value,
      title_da: $('yb-la-title-da').value.trim(),
      title_en: $('yb-la-title-en').value.trim(),
      description_da: $('yb-la-desc-da').value.trim(),
      description_en: $('yb-la-desc-en').value.trim(),
      instructor: $('yb-la-instructor').value.trim(),
      teacherEmail: $('yb-la-teacher-email') ? $('yb-la-teacher-email').value.trim() || null : null,
      startDateTime: $('yb-la-start').value ? new Date($('yb-la-start').value).toISOString() : '',
      endDateTime: $('yb-la-end').value ? new Date($('yb-la-end').value).toISOString() : '',
      muxPlaybackId: $('yb-la-mux-playback').value.trim() || null,
      recordingPlaybackId: $('yb-la-recording-id').value.trim() || null,
      recordingAssetId: ($('yb-la-recording-asset-id') ? $('yb-la-recording-asset-id').value.trim() : '') || null,
      access: { roles: roles, permissions: perms }
    };

    // Programs & cohorts from pill selectors
    data.programs = getSelectedProgramIds('yb-la-programs-container');
    data.cohorts = getSelectedCohortBuildIds('yb-la-cohorts-container');

    // Auto-add method permissions derived from program selection
    var autoPerms = derivedMethodPerms(data.programs);
    for (var k = 0; k < autoPerms.length; k++) {
      if (data.access.permissions.indexOf(autoPerms[k]) === -1) {
        data.access.permissions.push(autoPerms[k]);
      }
    }

    // Stream type + co-teachers + meeting URL
    var streamTypeSel = $('yb-la-stream-type');
    data.streamType = streamTypeSel ? streamTypeSel.value : 'broadcast';
    data.interactive = data.streamType === 'interactive'; // backwards compat

    // Meeting URL (for Google Meet / external meeting sessions)
    if (data.streamType === 'meet') {
      var meetUrl = ($('yb-la-meeting-url') ? $('yb-la-meeting-url').value : '').trim();
      if (!meetUrl) {
        alert(isDa ? 'Indtast en meeting URL' : 'Please enter a meeting URL');
        return;
      }
      data.meetingUrl = meetUrl;
    } else {
      data.meetingUrl = null;
    }

    var coTeachersStr = ($('yb-la-coteachers') ? $('yb-la-coteachers').value : '').trim();
    if (coTeachersStr && data.streamType === 'panel') {
      data.coTeachers = coTeachersStr.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    } else {
      data.coTeachers = [];
    }

    var recType = $('yb-la-recurrence').value;
    if (recType !== 'none' && data.source === 'manual') {
      data.recurrence = { type: recType, endDate: $('yb-la-recurrence-end').value || null };
    } else {
      data.recurrence = { type: 'none' };
    }

    // AI content — bilingual fields + legacy fallback
    var aiSection = $('yb-la-ai-section');
    if (aiSection && !aiSection.hidden) {
      var summaryDa = $('yb-la-ai-summary-da').value.trim();
      var summaryEn = $('yb-la-ai-summary-en').value.trim();
      var quizDa = $('yb-la-ai-quiz-da').value.trim();
      var quizEn = $('yb-la-ai-quiz-en').value.trim();
      data.aiSummary_da = summaryDa;
      data.aiSummary_en = summaryEn;
      data.aiSummary = summaryDa || summaryEn; // legacy field
      var quizErr = $('yb-la-ai-quiz-error');
      if (quizErr) quizErr.hidden = true;
      if (quizDa) {
        try { JSON.parse(quizDa); data.aiQuiz_da = quizDa; } catch (e) {
          if (quizErr) { quizErr.textContent = 'Quiz DA JSON ugyldig: ' + e.message; quizErr.hidden = false; }
        }
      }
      if (quizEn) {
        try { JSON.parse(quizEn); data.aiQuiz_en = quizEn; } catch (e) {
          if (quizErr) { quizErr.textContent = 'Quiz EN JSON invalid: ' + e.message; quizErr.hidden = false; }
        }
      }
      data.aiQuiz = quizDa || quizEn; // legacy field
    }

    return data;
  }

  function submitForm(e) {
    e.preventDefault();
    var id = $('yb-la-id').value;
    var data = collectFormData();

    if (id) {
      data.id = id;
      apiFetch('update', { method: 'POST', body: data }).then(function (res) {
        if (res.ok) {
          toast(t('live_saved'));
          showView('list');
          loadItems();
        } else {
          toast(res.error || t('error_save'), true);
        }
      });
    } else {
      apiFetch('create', { method: 'POST', body: data }).then(function (res) {
        if (res.ok) {
          toast(t('live_saved'));
          showView('list');
          loadItems();
        } else {
          toast(res.error || t('error_save'), true);
        }
      });
    }
  }

  /* ══════════════════════════════════════════
     MINDBODY IMPORT
     ══════════════════════════════════════════ */
  function openMbImport() {
    var now = new Date();
    $('yb-la-mb-start').value = now.toISOString().split('T')[0];
    var future = new Date(now.getTime() + 30 * 86400000);
    $('yb-la-mb-end').value = future.toISOString().split('T')[0];
    mbClasses = [];
    mbSelectedIdxs.clear();
    updateMbBulkBar();
    showView('mb');
  }

  function fetchMbClasses() {
    var startDate = $('yb-la-mb-start').value;
    var endDate = $('yb-la-mb-end').value;
    var btn = $('yb-la-mb-fetch-btn');
    if (btn) { btn.textContent = t('live_mb_fetching'); btn.disabled = true; }

    apiFetch('mb-classes', { params: { startDate: startDate, endDate: endDate } }).then(function (res) {
      if (btn) { btn.textContent = t('live_mb_fetch_btn'); btn.disabled = false; }
      if (res.ok) {
        mbClasses = res.classes || [];
        mbSelectedIdxs.clear();
        populateMbFilters();
        renderMbTable();
        // Show filters & result bar
        var filtersEl = $('yb-la-mb-filters');
        var resultBar = $('yb-la-mb-result-bar');
        if (filtersEl) filtersEl.hidden = false;
        if (resultBar) resultBar.hidden = false;
      } else {
        toast(res.error || t('error_load'), true);
      }
    }).catch(function () {
      if (btn) { btn.textContent = t('live_mb_fetch_btn'); btn.disabled = false; }
      toast(t('error_load'), true);
    });
  }

  // ── MB Filters ──
  function populateMbFilters() {
    var programs = {};
    var instructors = {};
    var sessionTypes = {};
    var days = {};

    var dayNames = LANG === 'en'
      ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
      : ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'];

    for (var i = 0; i < mbClasses.length; i++) {
      var cls = mbClasses[i];
      if (cls.programName) programs[cls.programName] = true;
      if (cls.instructor) instructors[cls.instructor] = true;
      if (cls.sessionTypeName) sessionTypes[cls.sessionTypeName] = true;
      if (cls.startDateTime) {
        var d = new Date(cls.startDateTime);
        var dayIdx = d.getDay();
        days[dayIdx] = dayNames[dayIdx];
      }
    }

    fillSelect('yb-la-mb-filter-program', programs, t('live_mb_filter_program'));
    fillSelect('yb-la-mb-filter-instructor', instructors, t('live_mb_filter_instructor'));
    fillSelect('yb-la-mb-filter-session-type', sessionTypes, t('live_mb_filter_session_type'));
    fillDaySelect('yb-la-mb-filter-day', days, t('live_mb_filter_day'));
  }

  function fillSelect(id, keysObj, allLabel) {
    var sel = $(id);
    if (!sel) return;
    var current = sel.value;
    sel.innerHTML = '<option value="">' + esc(allLabel) + '</option>';
    var keys = Object.keys(keysObj).sort();
    for (var i = 0; i < keys.length; i++) {
      sel.innerHTML += '<option value="' + esc(keys[i]) + '">' + esc(keys[i]) + '</option>';
    }
    if (current) sel.value = current;
  }

  function fillDaySelect(id, daysMap, allLabel) {
    var sel = $(id);
    if (!sel) return;
    var current = sel.value;
    sel.innerHTML = '<option value="">' + esc(allLabel) + '</option>';
    // Sort by day index (0-6)
    var idxs = Object.keys(daysMap).map(Number).sort(function (a, b) { return a - b; });
    for (var i = 0; i < idxs.length; i++) {
      sel.innerHTML += '<option value="' + idxs[i] + '">' + esc(daysMap[idxs[i]]) + '</option>';
    }
    if (current) sel.value = current;
  }

  function getFilteredMbClasses() {
    var search = ($('yb-la-mb-search') ? $('yb-la-mb-search').value : '').toLowerCase().trim();
    var program = ($('yb-la-mb-filter-program') ? $('yb-la-mb-filter-program').value : '');
    var instructor = ($('yb-la-mb-filter-instructor') ? $('yb-la-mb-filter-instructor').value : '');
    var sessionType = ($('yb-la-mb-filter-session-type') ? $('yb-la-mb-filter-session-type').value : '');
    var dayFilter = ($('yb-la-mb-filter-day') ? $('yb-la-mb-filter-day').value : '');

    var result = [];
    for (var i = 0; i < mbClasses.length; i++) {
      var cls = mbClasses[i];

      // Search filter
      if (search) {
        var haystack = ((cls.name || '') + ' ' + (cls.instructor || '')).toLowerCase();
        if (haystack.indexOf(search) === -1) continue;
      }
      // Program filter
      if (program && cls.programName !== program) continue;
      // Instructor filter
      if (instructor && cls.instructor !== instructor) continue;
      // Session type filter
      if (sessionType && cls.sessionTypeName !== sessionType) continue;
      // Day filter
      if (dayFilter !== '' && cls.startDateTime) {
        var d = new Date(cls.startDateTime);
        if (String(d.getDay()) !== dayFilter) continue;
      }

      result.push({ idx: i, cls: cls });
    }
    return result;
  }

  // ── MB Table Rendering ──
  function renderMbTable() {
    var tbody = $('yb-live-mb-table-body');
    var emptyEl = $('yb-live-mb-empty');
    if (!tbody) return;

    var filtered = getFilteredMbClasses();

    // Update count
    var countEl = $('yb-la-mb-count');
    if (countEl) countEl.textContent = filtered.length + ' ' + t('live_mb_count') + (mbClasses.length !== filtered.length ? ' / ' + mbClasses.length + ' ' + t('live_filter_all').toLowerCase() : '');

    if (emptyEl) emptyEl.hidden = filtered.length > 0;

    if (!filtered.length) {
      tbody.innerHTML = '';
      updateMbSelectAllCb();
      updateMbBulkBar();
      return;
    }

    // Check which MB class IDs are already imported
    var importedMbIds = {};
    for (var ii = 0; ii < items.length; ii++) {
      if (items[ii].mbClassId) importedMbIds[items[ii].mbClassId] = true;
    }

    var html = '';
    for (var i = 0; i < filtered.length; i++) {
      var entry = filtered[i];
      var cls = entry.cls;
      var origIdx = entry.idx;
      var isSelected = mbSelectedIdxs.has(origIdx);
      var alreadyImported = !!importedMbIds[cls.id];

      html += '<tr' + (alreadyImported ? ' class="yb-la__row-imported"' : '') + '>';
      html += '<td><input type="checkbox" class="yb-la-mb-cb" data-idx="' + origIdx + '"' + (isSelected ? ' checked' : '') + '></td>';
      html += '<td><strong>' + esc(cls.name) + '</strong>' + (alreadyImported ? ' <span class="yb-la__imported-label">(' + t('live_mb_already_imported') + ')</span>' : '') + '</td>';
      html += '<td>' + fmtDate(cls.startDateTime) + '</td>';
      html += '<td>' + esc(cls.instructor) + '</td>';
      html += '<td class="yb-la__td-sm">' + esc(cls.programName) + '</td>';
      html += '<td class="yb-la__td-sm">' + esc(cls.sessionTypeName || '') + '</td>';
      html += '<td>';
      if (!alreadyImported) {
        html += '<button class="yb-btn yb-btn--primary yb-btn--sm" data-action="live-mb-import-one" data-idx="' + origIdx + '">+ Import</button>';
      }
      html += '</td>';
      html += '</tr>';
    }
    tbody.innerHTML = html;
    updateMbSelectAllCb();
    updateMbBulkBar();
  }

  // ── MB Selection ──
  function toggleMbSelection(idx, checked) {
    if (checked) {
      mbSelectedIdxs.add(idx);
    } else {
      mbSelectedIdxs.delete(idx);
    }
    updateMbSelectAllCb();
    updateMbBulkBar();
  }

  function selectAllMb(checked) {
    var filtered = getFilteredMbClasses();
    if (checked) {
      for (var i = 0; i < filtered.length; i++) {
        mbSelectedIdxs.add(filtered[i].idx);
      }
    } else {
      for (var i = 0; i < filtered.length; i++) {
        mbSelectedIdxs.delete(filtered[i].idx);
      }
    }
    renderMbTable();
  }

  function deselectAllMb() {
    mbSelectedIdxs.clear();
    renderMbTable();
  }

  function updateMbSelectAllCb() {
    var cb = $('yb-la-mb-select-all');
    if (!cb) return;
    var filtered = getFilteredMbClasses();
    if (!filtered.length) { cb.checked = false; return; }
    var allChecked = filtered.every(function (e) { return mbSelectedIdxs.has(e.idx); });
    var someChecked = filtered.some(function (e) { return mbSelectedIdxs.has(e.idx); });
    cb.checked = allChecked;
    cb.indeterminate = someChecked && !allChecked;
  }

  function updateMbBulkBar() {
    var bar = $('yb-la-mb-bulk-bar');
    var countEl = $('yb-la-mb-bulk-count');
    if (!bar) return;
    var count = mbSelectedIdxs.size;
    bar.hidden = count === 0;
    if (countEl) countEl.textContent = count + ' ' + t('live_mb_selected');
  }

  // ── MB Import ──
  function buildMbImportData(cls) {
    return {
      source: 'mindbody',
      mbClassId: cls.id,
      mbClassName: cls.name,
      mbProgramId: cls.programId,
      mbSessionTypeId: cls.sessionTypeId,
      title_da: cls.name,
      title_en: cls.name,
      description_da: cls.description || '',
      description_en: cls.description || '',
      instructor: cls.instructor,
      startDateTime: cls.startDateTime,
      endDateTime: cls.endDateTime,
      status: 'scheduled',
      access: { roles: ['trainee', 'teacher', 'admin'], permissions: ['live-streaming'] }
    };
  }

  function importMbClass(idx, btn) {
    var cls = mbClasses[idx];
    if (!cls) return;

    // Show loading state on the button
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="yb-admin__spinner-sm"></span> ' + t('live_mb_importing');
    }

    var data = buildMbImportData(cls);

    apiFetch('create', { method: 'POST', body: data }).then(function (res) {
      if (res.ok) {
        toast(t('live_mb_imported'));
        mbSelectedIdxs.delete(idx);
        // Mark this row as imported immediately (don't wait for full reload)
        if (btn) {
          var row = btn.closest('tr');
          if (row) {
            row.classList.add('yb-la__row-imported');
            // Add "already imported" label next to the title
            var titleCell = row.querySelectorAll('td')[1];
            if (titleCell && titleCell.querySelector('strong')) {
              titleCell.querySelector('strong').insertAdjacentHTML(
                'afterend',
                ' <span class="yb-la__imported-label">(' + esc(t('live_mb_already_imported')) + ')</span>'
              );
            }
          }
          btn.disabled = true;
          btn.className = 'yb-btn yb-btn--outline yb-btn--sm';
          btn.innerHTML = '&#10003; ' + t('live_mb_imported_label');
        }
        loadItems(); // Refresh items in background so re-render knows it's imported
      } else {
        toast(res.error || t('error_save'), true);
        // Restore button on error
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '+ Import';
        }
      }
    }).catch(function () {
      toast(t('error_save'), true);
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '+ Import';
      }
    });
  }

  function bulkImportMb() {
    if (!mbSelectedIdxs.size) return;

    var idxArr = Array.from(mbSelectedIdxs);
    var total = idxArr.length;
    var done = 0;
    var failed = 0;

    // Disable bulk import button and show progress
    var bulkBtn = document.querySelector('[data-action="live-mb-bulk-import"]');
    if (bulkBtn) {
      bulkBtn.disabled = true;
      bulkBtn.innerHTML = '<span class="yb-admin__spinner-sm"></span> 0 / ' + total;
    }

    // Import sequentially to avoid overwhelming the API
    function importNext() {
      if (!idxArr.length) {
        mbSelectedIdxs.clear();
        loadItems();
        var msg = (done - failed) + ' ' + t('live_mb_bulk_imported');
        if (failed) msg += ' (' + failed + ' failed)';
        toast(msg, failed > 0);
        // Re-render table to show imported states
        renderMbTable();
        if (bulkBtn) {
          bulkBtn.disabled = false;
          bulkBtn.innerHTML = '&#128229; ' + t('live_mb_bulk_import');
        }
        return;
      }
      var idx = idxArr.shift();
      var cls = mbClasses[idx];
      if (!cls) { done++; importNext(); return; }

      var data = buildMbImportData(cls);

      apiFetch('create', { method: 'POST', body: data }).then(function (res) {
        done++;
        if (!res.ok) failed++;
        // Update progress
        if (bulkBtn) bulkBtn.innerHTML = '<span class="yb-admin__spinner-sm"></span> ' + done + ' / ' + total;
        importNext();
      }).catch(function () {
        done++;
        failed++;
        if (bulkBtn) bulkBtn.innerHTML = '<span class="yb-admin__spinner-sm"></span> ' + done + ' / ' + total;
        importNext();
      });
    }

    toast(t('live_mb_importing') + ' ' + total + '...');
    importNext();
  }

  /* ══════════════════════════════════════════
     LIVE LIST — BULK SELECTION & ACTIONS
     ══════════════════════════════════════════ */
  function toggleLiveSelection(id, checked) {
    if (checked) {
      liveSelectedIds.add(id);
    } else {
      liveSelectedIds.delete(id);
    }
    updateLiveSelectAllCb();
    updateLiveBulkBar();
  }

  function selectAllLive(checked) {
    var filtered = getFilteredItems();
    if (checked) {
      for (var i = 0; i < filtered.length; i++) {
        liveSelectedIds.add(filtered[i].id);
      }
    } else {
      for (var i = 0; i < filtered.length; i++) {
        liveSelectedIds.delete(filtered[i].id);
      }
    }
    renderTable();
  }

  function deselectAllLive() {
    liveSelectedIds.clear();
    var panel = $('yb-live-bulk-access-panel');
    if (panel) panel.hidden = true;
    renderTable();
  }

  function updateLiveSelectAllCb() {
    var cb = $('yb-live-select-all');
    if (!cb) return;
    var filtered = getFilteredItems();
    if (!filtered.length) { cb.checked = false; cb.indeterminate = false; return; }
    var allChecked = filtered.every(function (e) { return liveSelectedIds.has(e.id); });
    var someChecked = filtered.some(function (e) { return liveSelectedIds.has(e.id); });
    cb.checked = allChecked;
    cb.indeterminate = someChecked && !allChecked;
  }

  function updateLiveBulkBar() {
    var bar = $('yb-live-bulk-bar');
    var countEl = $('yb-live-bulk-count');
    if (!bar) return;
    var count = liveSelectedIds.size;
    bar.hidden = count === 0;
    if (countEl) countEl.textContent = count + ' ' + t('live_bulk_selected');
    // Hide the access panel if nothing selected
    if (count === 0) {
      var panel = $('yb-live-bulk-access-panel');
      if (panel) panel.hidden = true;
    }
  }

  function toggleBulkAccessPanel() {
    var panel = $('yb-live-bulk-access-panel');
    if (panel) panel.hidden = !panel.hidden;
  }

  function collectBulkAccessData() {
    var bulkScope = $('yb-live-bulk-access-panel');
    var roles = bulkScope ? getActivePillValues(bulkScope, '.yb-la-role-pill') : [];
    var perms = bulkScope ? getActivePillValues(bulkScope, '.yb-la-perm-pill') : [];
    var programs = getSelectedProgramIds('yb-la-bulk-programs-container');
    var cohorts = getSelectedCohortBuildIds('yb-la-bulk-cohorts-container');

    // Auto-add method permissions from program selection
    var autoPerms = derivedMethodPerms(programs);
    for (var k = 0; k < autoPerms.length; k++) {
      if (perms.indexOf(autoPerms[k]) === -1) perms.push(autoPerms[k]);
    }

    return {
      access: { roles: roles, permissions: perms },
      programs: programs,
      cohorts: cohorts
    };
  }

  /**
   * Map program course_ids → implied method: permissions.
   * Vinyasa Plus (YTT200-4W-VP) auto-implies method:vinyasa.
   */
  function derivedMethodPerms(programIds) {
    var out = [];
    if (!programIds) return out;
    for (var i = 0; i < programIds.length; i++) {
      if (programIds[i] === 'YTT200-4W-VP') {
        if (out.indexOf('method:vinyasa') === -1) out.push('method:vinyasa');
      }
    }
    return out;
  }

  function bulkUpdateAccess() {
    if (!liveSelectedIds.size) return;
    var ids = Array.from(liveSelectedIds);
    var updates = collectBulkAccessData();

    apiFetch('bulk-update', { method: 'POST', body: { ids: ids, updates: updates } }).then(function (res) {
      if (res.ok) {
        toast(res.updated + ' ' + t('live_bulk_updated'));
        liveSelectedIds.clear();
        var panel = $('yb-live-bulk-access-panel');
        if (panel) panel.hidden = true;
        loadItems();
      } else {
        toast(res.error || t('error_save'), true);
      }
    }).catch(function () {
      toast(t('error_save'), true);
    });
  }

  function bulkDeleteLive() {
    if (!liveSelectedIds.size) return;
    if (!confirm(t('live_confirm_bulk_delete'))) return;

    var ids = Array.from(liveSelectedIds);
    var total = ids.length;
    var done = 0;
    var failed = 0;

    function deleteNext() {
      if (!ids.length) {
        liveSelectedIds.clear();
        loadItems();
        var msg = (done - failed) + ' ' + t('live_bulk_deleted');
        if (failed) msg += ' (' + failed + ' failed)';
        toast(msg, failed > 0);
        return;
      }
      var id = ids.shift();
      apiFetch('delete', { method: 'POST', body: { id: id } }).then(function (res) {
        done++;
        if (!res.ok) failed++;
        deleteNext();
      }).catch(function () {
        done++;
        failed++;
        deleteNext();
      });
    }

    toast(t('live_mb_importing') + ' ' + total + '...');
    deleteNext();
  }

  /* ══════════════════════════════════════════
     DELETE
     ══════════════════════════════════════════ */
  function deleteItem(id) {
    if (!confirm(t('live_confirm_delete'))) return;
    apiFetch('delete', { method: 'POST', body: { id: id } }).then(function (res) {
      if (res.ok) {
        toast(t('live_deleted'));
        loadItems();
      } else {
        toast(res.error || t('error_save'), true);
      }
    });
  }

  /* ══════════════════════════════════════════
     MUX ASSET BROWSER
     ══════════════════════════════════════════ */
  var muxBrowserAssets = [];
  var muxBrowserCursor = null;
  var muxBrowserLoading = false;

  function openMuxBrowser() {
    var modal = $('yb-la-mux-modal');
    if (!modal) return;
    modal.hidden = false;
    muxBrowserCursor = null;
    muxBrowserAssets = [];
    loadMuxAssets();
  }

  function closeMuxBrowser() {
    var modal = $('yb-la-mux-modal');
    if (modal) modal.hidden = true;
  }

  function fmtDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '—';
    var s = Math.floor(seconds);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    return (h > 0 ? h + ':' : '') + String(m).padStart(h > 0 ? 2 : 1, '0') + ':' + String(sec).padStart(2, '0');
  }

  function fmtAssetDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    var day = String(d.getDate()).padStart(2, '0');
    var mon = String(d.getMonth() + 1).padStart(2, '0');
    var yr = d.getFullYear();
    var h = String(d.getHours()).padStart(2, '0');
    var m = String(d.getMinutes()).padStart(2, '0');
    return day + '/' + mon + '/' + yr + ' ' + h + ':' + m;
  }

  function loadMuxAssets() {
    if (muxBrowserLoading) return;
    muxBrowserLoading = true;

    var body = $('yb-la-mux-modal-body');
    if (body && !muxBrowserAssets.length) body.innerHTML = '<p class="yb-la__loading-text">Loading assets…</p>';

    var days = ($('yb-la-mux-date-filter') || {}).value || '30';
    var params = { limit: 20, days: days };
    if (muxBrowserCursor) params.cursor = muxBrowserCursor;

    getToken().then(function (token) {
      var url = '/.netlify/functions/mux-stream?action=list-assets';
      for (var k in params) url += '&' + k + '=' + encodeURIComponent(params[k]);
      return fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
    }).then(function (r) { return r.json(); }).then(function (res) {
      muxBrowserLoading = false;
      if (!res.ok) {
        if (body) body.innerHTML = '<p class="yb-la__error-text">' + esc(res.error || 'Failed to load Mux assets') + '</p>';
        return;
      }
      var assets = res.assets || [];
      for (var i = 0; i < assets.length; i++) muxBrowserAssets.push(assets[i]);
      muxBrowserCursor = res.cursor || null;
      renderMuxAssets();
      var loadMoreBtn = $('yb-la-mux-load-more');
      if (loadMoreBtn) loadMoreBtn.hidden = !muxBrowserCursor;
    }).catch(function (err) {
      muxBrowserLoading = false;
      if (body) body.innerHTML = '<p class="yb-la__error-text">Error: ' + esc(err.message) + '</p>';
    });
  }

  function renderMuxAssets() {
    var body = $('yb-la-mux-modal-body');
    if (!body) return;
    if (!muxBrowserAssets.length) {
      body.innerHTML = '<p class="yb-la__loading-text">No recordings found for this time range.</p>';
      return;
    }
    var html = '<div class="yb-la__mux-asset-grid">';
    for (var i = 0; i < muxBrowserAssets.length; i++) {
      var a = muxBrowserAssets[i];
      var playbackId = a.playback_id || '';
      var thumb = playbackId ? 'https://image.mux.com/' + playbackId + '/thumbnail.jpg?width=320&height=180&fit_mode=smartcrop' : '';
      html += '<div class="yb-la__mux-asset-card">';
      if (thumb) {
        html += '<img class="yb-la__mux-asset-thumb" src="' + esc(thumb) + '" alt="" loading="lazy">';
      } else {
        html += '<div class="yb-la__mux-asset-thumb yb-la__mux-asset-thumb--empty">No thumbnail</div>';
      }
      html += '<div class="yb-la__mux-asset-meta">';
      html += '<div class="yb-la__mux-asset-date">' + esc(fmtAssetDate(a.created_at)) + '</div>';
      html += '<div class="yb-la__mux-asset-row"><span>Duration</span><strong>' + esc(fmtDuration(a.duration)) + '</strong></div>';
      if (a.resolution) html += '<div class="yb-la__mux-asset-row"><span>Resolution</span><strong>' + esc(a.resolution) + '</strong></div>';
      html += '<div class="yb-la__mux-asset-ids">';
      html += '<div><span>Playback</span> <code>' + esc(playbackId) + '</code></div>';
      html += '<div><span>Asset</span> <code>' + esc(a.id || '') + '</code></div>';
      html += '</div>';
      html += '<button type="button" class="yb-btn yb-btn--outline yb-btn--sm yb-la__mux-asset-select" ' +
        'data-action="live-mux-select" ' +
        'data-playback-id="' + esc(playbackId) + '" ' +
        'data-asset-id="' + esc(a.id || '') + '" ' +
        'data-created-at="' + esc(a.created_at || '') + '">Select</button>';
      html += '</div></div>';
    }
    html += '</div>';
    body.innerHTML = html;
  }

  function selectMuxAsset(playbackId, assetId, createdAt) {
    var recInput = $('yb-la-recording-id');
    var recAssetInput = $('yb-la-recording-asset-id');
    if (recInput) recInput.value = playbackId || '';
    if (recAssetInput) recAssetInput.value = assetId || '';

    // If "Link existing recording" toggle is active on a new session, pre-fill start time
    var linkToggle = $('yb-la-link-existing-toggle');
    if (linkToggle && linkToggle.checked && createdAt) {
      var startInput = $('yb-la-start');
      if (startInput && !startInput.value) {
        var d = new Date(createdAt);
        var iso = d.getFullYear() + '-' +
          String(d.getMonth() + 1).padStart(2, '0') + '-' +
          String(d.getDate()).padStart(2, '0') + 'T' +
          String(d.getHours()).padStart(2, '0') + ':' +
          String(d.getMinutes()).padStart(2, '0');
        startInput.value = iso;
      }
    }

    closeMuxBrowser();
    toast('Recording linked: ' + (playbackId || '(no playback id)'));
  }

  function recordingBadge(item) {
    if (item.status !== 'ended') return '';
    var aiSt = item.aiStatus || '';
    if (aiSt === 'processing' || aiSt === 'preparing_audio' || aiSt === 'transcribing' ||
        aiSt === 'generating_summary' || aiSt === 'uploading_subtitles' || aiSt === 'translating') {
      return ' <span class="yb-la__rec-badge yb-la__rec-badge--processing">Processing</span>';
    }
    if (item.recordingPlaybackId) {
      return ' <span class="yb-la__rec-badge yb-la__rec-badge--ready">Recording</span>';
    }
    return ' <span class="yb-la__rec-badge yb-la__rec-badge--missing">No recording</span>';
  }

  /* ══════════════════════════════════════════
     EVENT BINDING
     ══════════════════════════════════════════ */
  function bindEvents() {
    document.addEventListener('click', function (e) {
      var btn;

      btn = e.target.closest('[data-action="live-new"]');
      if (btn) { openForm(null); return; }

      btn = e.target.closest('[data-action="live-cancel"]');
      if (btn) { showView('list'); return; }

      btn = e.target.closest('[data-action="live-import-mb"]');
      if (btn) { openMbImport(); return; }

      btn = e.target.closest('[data-action="live-mb-fetch"]');
      if (btn) { fetchMbClasses(); return; }

      btn = e.target.closest('[data-action="live-mb-import-one"]');
      if (btn) {
        var idx = parseInt(btn.getAttribute('data-idx'), 10);
        importMbClass(idx, btn);
        return;
      }

      btn = e.target.closest('[data-action="live-mb-bulk-import"]');
      if (btn) { bulkImportMb(); return; }

      btn = e.target.closest('[data-action="live-mb-deselect"]');
      if (btn) { deselectAllMb(); return; }

      btn = e.target.closest('[data-action="live-edit"]');
      if (btn) {
        var editId = btn.getAttribute('data-id');
        var item = items.find(function (x) { return x.id === editId; });
        if (item) openForm(item);
        return;
      }

      btn = e.target.closest('[data-action="live-delete"]');
      if (btn) {
        deleteItem(btn.getAttribute('data-id'));
        return;
      }

      // ── Bulk actions for live list ──
      btn = e.target.closest('[data-action="live-bulk-access"]');
      if (btn) {
        toggleBulkAccessPanel();
        // Ensure catalog is loaded for bulk panel pills
        fetchCatalog(function () {
          renderProgramPills('yb-la-bulk-programs-container', []);
          renderCohortPills('yb-la-bulk-cohorts-container', [], []);
        });
        return;
      }

      btn = e.target.closest('[data-action="live-bulk-access-close"]');
      if (btn) { var p = $('yb-live-bulk-access-panel'); if (p) p.hidden = true; return; }

      btn = e.target.closest('[data-action="live-bulk-access-apply"]');
      if (btn) { bulkUpdateAccess(); return; }

      btn = e.target.closest('[data-action="live-bulk-delete"]');
      if (btn) { bulkDeleteLive(); return; }

      btn = e.target.closest('[data-action="live-bulk-deselect"]');
      if (btn) { deselectAllLive(); return; }

      btn = e.target.closest('[data-action="live-ai-lang"]');
      if (btn) {
        var lang = btn.getAttribute('data-lang');
        if (window._aiLangTab) window._aiLangTab(lang);
        return;
      }

      // ── Mux asset browser ──
      btn = e.target.closest('[data-action="live-browse-mux"]');
      if (btn) { openMuxBrowser(); return; }

      btn = e.target.closest('[data-action="live-mux-close"]');
      if (btn) { closeMuxBrowser(); return; }

      btn = e.target.closest('[data-action="live-mux-select"]');
      if (btn) {
        selectMuxAsset(btn.getAttribute('data-playback-id'), btn.getAttribute('data-asset-id'), btn.getAttribute('data-created-at'));
        return;
      }
    });

    // Mux date filter + load more
    var muxDateFilter = $('yb-la-mux-date-filter');
    if (muxDateFilter) muxDateFilter.addEventListener('change', function () {
      muxBrowserCursor = null;
      muxBrowserAssets = [];
      loadMuxAssets();
    });
    var muxLoadMore = $('yb-la-mux-load-more');
    if (muxLoadMore) muxLoadMore.addEventListener('click', function () { loadMuxAssets(); });

    // Form submit
    var form = $('yb-live-admin-form');
    if (form) form.addEventListener('submit', submitForm);

    // Source toggle
    var sourceSelect = $('yb-la-source');
    if (sourceSelect) sourceSelect.addEventListener('change', toggleSourceFields);

    // Recurrence toggle
    var recSelect = $('yb-la-recurrence');
    if (recSelect) recSelect.addEventListener('change', toggleRecurrenceEnd);

    // List view filters
    var filterEl = $('yb-live-admin-filter');
    if (filterEl) filterEl.addEventListener('change', renderTable);
    var sourceFilterEl = $('yb-live-admin-source-filter');
    if (sourceFilterEl) sourceFilterEl.addEventListener('change', renderTable);

    // Live list: select-all checkbox
    var liveSelectAll = $('yb-live-select-all');
    if (liveSelectAll) liveSelectAll.addEventListener('change', function () { selectAllLive(liveSelectAll.checked); });

    // MB import: select-all checkbox
    var mbSelectAll = $('yb-la-mb-select-all');
    if (mbSelectAll) mbSelectAll.addEventListener('change', function () { selectAllMb(mbSelectAll.checked); });

    // Live list + MB import: individual checkboxes (delegated)
    document.addEventListener('change', function (e) {
      if (e.target.classList.contains('yb-la-live-cb')) {
        var id = e.target.getAttribute('data-id');
        toggleLiveSelection(id, e.target.checked);
      }
      if (e.target.classList.contains('yb-la-mb-cb')) {
        var idx = parseInt(e.target.getAttribute('data-idx'), 10);
        toggleMbSelection(idx, e.target.checked);
      }
    });

    // MB import: search
    var mbSearch = $('yb-la-mb-search');
    if (mbSearch) {
      var searchTimer;
      mbSearch.addEventListener('input', function () {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(renderMbTable, 200);
      });
    }

    // MB import: filter dropdowns
    ['yb-la-mb-filter-program', 'yb-la-mb-filter-instructor', 'yb-la-mb-filter-session-type', 'yb-la-mb-filter-day'].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('change', renderMbTable);
    });

    // ── Role / Permission pill click delegation ──
    document.addEventListener('click', function (e) {
      var rolePill = e.target.closest('.yb-la-role-pill');
      if (rolePill) {
        e.preventDefault();
        rolePill.classList.toggle('yb-la-pill--active');
        var scope = rolePill.closest('#yb-live-admin-v-form, #yb-live-bulk-access-panel');
        if (scope) {
          toggleTeacherSection(scope);
          var isFormScope = scope.id === 'yb-live-admin-v-form';
          updateAccessSummary(
            isFormScope ? 'yb-la-access-summary' : 'yb-la-bulk-access-summary',
            isFormScope ? 'yb-la-programs-container' : 'yb-la-bulk-programs-container',
            isFormScope ? 'yb-la-cohorts-container' : 'yb-la-bulk-cohorts-container'
          );
        }
        return;
      }
      var permPill = e.target.closest('.yb-la-perm-pill');
      if (permPill) {
        e.preventDefault();
        permPill.classList.toggle('yb-la-pill--active');
        var scope2 = permPill.closest('#yb-live-admin-v-form, #yb-live-bulk-access-panel');
        if (scope2) {
          var isFormScope2 = scope2.id === 'yb-live-admin-v-form';
          updateAccessSummary(
            isFormScope2 ? 'yb-la-access-summary' : 'yb-la-bulk-access-summary',
            isFormScope2 ? 'yb-la-programs-container' : 'yb-la-bulk-programs-container',
            isFormScope2 ? 'yb-la-cohorts-container' : 'yb-la-bulk-cohorts-container'
          );
        }
        return;
      }
    });

    // ── Program / Cohort pill click delegation ──
    document.addEventListener('click', function (e) {
      var pill;

      // Program pill toggle (form or bulk)
      pill = e.target.closest('.yb-la-prog-pill');
      if (pill) {
        e.preventDefault();
        pill.classList.toggle('yb-la-pill--active');
        // Determine which container context (form vs bulk)
        var isFormCtx = pill.closest('#yb-la-programs-container');
        var isBulkCtx = pill.closest('#yb-la-bulk-programs-container');
        if (isFormCtx) {
          var selProgs = getSelectedProgramIds('yb-la-programs-container');
          var selCohorts = getSelectedCohortBuildIds('yb-la-cohorts-container');
          renderCohortPills('yb-la-cohorts-container', selProgs, selCohorts);
          updateAccessSummary('yb-la-access-summary', 'yb-la-programs-container', 'yb-la-cohorts-container');
        } else if (isBulkCtx) {
          var bSelProgs = getSelectedProgramIds('yb-la-bulk-programs-container');
          var bSelCohorts = getSelectedCohortBuildIds('yb-la-bulk-cohorts-container');
          renderCohortPills('yb-la-bulk-cohorts-container', bSelProgs, bSelCohorts);
          updateAccessSummary('yb-la-bulk-access-summary', 'yb-la-bulk-programs-container', 'yb-la-bulk-cohorts-container');
        }
        return;
      }

      // Cohort pill toggle
      pill = e.target.closest('.yb-la-cohort-pill');
      if (pill) {
        e.preventDefault();
        pill.classList.toggle('yb-la-pill--active');
        var isFormCtx2 = pill.closest('#yb-la-cohorts-container');
        if (isFormCtx2) {
          updateAccessSummary('yb-la-access-summary', 'yb-la-programs-container', 'yb-la-cohorts-container');
        } else {
          updateAccessSummary('yb-la-bulk-access-summary', 'yb-la-bulk-programs-container', 'yb-la-bulk-cohorts-container');
        }
        return;
      }
    });

    // AI language tab switcher
    var _currentAiLang = 'da';
    window._aiLangTab = function (lang) {
      _currentAiLang = lang;
      var daEls = document.querySelectorAll('.yb-la-ai-lang-da');
      var enEls = document.querySelectorAll('.yb-la-ai-lang-en');
      for (var i = 0; i < daEls.length; i++) daEls[i].hidden = lang !== 'da';
      for (var j = 0; j < enEls.length; j++) enEls[j].hidden = lang !== 'en';
      var tabDa = $('yb-la-ai-tab-da');
      var tabEn = $('yb-la-ai-tab-en');
      if (tabDa) { tabDa.className = (lang === 'da' ? 'yb-btn yb-btn--sm' : 'yb-btn yb-btn--outline yb-btn--sm') + ' yb-la__lang-tab yb-la__lang-tab--left'; }
      if (tabEn) { tabEn.className = (lang === 'en' ? 'yb-btn yb-btn--sm' : 'yb-btn yb-btn--outline yb-btn--sm') + ' yb-la__lang-tab yb-la__lang-tab--right'; }
      // Hide preview on tab switch
      var previewEl = $('yb-la-ai-preview');
      if (previewEl) previewEl.hidden = true;
      var previewBtn2 = $('yb-la-ai-preview-btn');
      if (previewBtn2) previewBtn2.textContent = 'Preview summary';
    };

    // AI summary preview toggle
    var previewBtn = $('yb-la-ai-preview-btn');
    if (previewBtn) previewBtn.addEventListener('click', function () {
      var previewEl = $('yb-la-ai-preview');
      if (previewEl.hidden) {
        var activeField = _currentAiLang === 'en' ? $('yb-la-ai-summary-en') : $('yb-la-ai-summary-da');
        previewEl.innerHTML = activeField ? activeField.value : '';
        previewEl.hidden = false;
        previewBtn.textContent = 'Hide preview';
      } else {
        previewEl.hidden = true;
        previewBtn.textContent = 'Preview summary';
      }
    });

    // AI reprocess button
    var reprocessBtn = $('yb-la-ai-reprocess-btn');
    if (reprocessBtn) reprocessBtn.addEventListener('click', function () {
      var id = $('yb-la-id').value;
      if (!id) return;
      if (!confirm('Re-run AI processing on this session? This will overwrite the current summary and quiz.')) return;
      reprocessBtn.disabled = true;
      reprocessBtn.textContent = '↻ Processing...';
      // Call ai-backfill reprocess endpoint
      var secret = prompt('Enter AI_INTERNAL_SECRET:');
      if (!secret) { reprocessBtn.disabled = false; reprocessBtn.textContent = '↻ Reprocess AI'; return; }
      fetch('/.netlify/functions/ai-backfill?reprocess=' + id + '&secret=' + encodeURIComponent(secret))
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (res.ok) {
            toast('AI reprocessed successfully (' + res.lang + ')');
            // Reload the item to get fresh AI content
            apiFetch('get', { params: { id: id } }).then(function (r) {
              if (r.ok && r.item) {
                $('yb-la-ai-summary-da').value = r.item.aiSummary_da || r.item.aiSummary || '';
                $('yb-la-ai-summary-en').value = r.item.aiSummary_en || r.item.aiSummary || '';
                $('yb-la-ai-quiz-da').value = r.item.aiQuiz_da ? formatJsonStr(r.item.aiQuiz_da) : (r.item.aiQuiz ? formatJsonStr(r.item.aiQuiz) : '');
                $('yb-la-ai-quiz-en').value = r.item.aiQuiz_en ? formatJsonStr(r.item.aiQuiz_en) : (r.item.aiQuiz ? formatJsonStr(r.item.aiQuiz) : '');
                $('yb-la-ai-summary').value = r.item.aiSummary || '';
                $('yb-la-ai-quiz').value = r.item.aiQuiz ? formatJsonStr(r.item.aiQuiz) : '';
                var statusEl = $('yb-la-ai-status');
                statusEl.textContent = 'complete';
                statusEl.style.background = '#16a34a';
                statusEl.style.color = '#fff';
              }
            });
          } else {
            toast(res.error || 'Reprocess failed', true);
          }
          reprocessBtn.disabled = false;
          reprocessBtn.textContent = '↻ Reprocess AI';
        })
        .catch(function (err) {
          toast('Reprocess error: ' + err.message, true);
          reprocessBtn.disabled = false;
          reprocessBtn.textContent = '↻ Reprocess AI';
        });
    });

    // Tab listener — lazy load on first visit
    document.querySelectorAll('[data-yb-admin-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.getAttribute('data-yb-admin-tab') === 'live' && !loaded) {
          loadItems();
          fetchCatalog();
        }
      });
    });
  }

  /* ══════════════════════════════════════════
     INIT
     ══════════════════════════════════════════ */
  function init() {
    bindEvents();
  }

  var checkInterval = setInterval(function () {
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
      clearInterval(checkInterval);
      init();
    }
  }, 100);
})();
