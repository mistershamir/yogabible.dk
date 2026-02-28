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
  var API = '/.netlify/functions/live-admin';

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

      html += '<tr>';
      html += '<td>' + statusBadge(item.status) + '</td>';
      html += '<td><strong>' + esc(title) + '</strong></td>';
      html += '<td>' + fmtDate(item.startDateTime) + '</td>';
      html += '<td>' + sourceBadge(item.source) + '</td>';
      html += '<td>' + esc(item.instructor || '—') + '</td>';
      html += '<td style="font-size:0.75rem">' + esc(accessLabel(item.access)) + '</td>';
      html += '<td>';
      html += '<button class="yb-admin__icon-btn" data-action="live-edit" data-id="' + item.id + '" title="' + t('edit') + '">&#9998;</button> ';
      html += '<button class="yb-admin__icon-btn yb-admin__icon-btn--danger" data-action="live-delete" data-id="' + item.id + '" title="' + t('delete') + '">&#128465;</button>';
      html += '</td>';
      html += '</tr>';
    }
    tbody.innerHTML = html;
  }

  /* ══════════════════════════════════════════
     FORM
     ══════════════════════════════════════════ */
  function openForm(item) {
    var isEdit = !!item;
    $('yb-live-admin-form-title').textContent = isEdit ? t('live_form_edit_title') : t('live_form_title');
    $('yb-la-id').value = isEdit ? item.id : '';
    $('yb-la-source').value = (item && item.source) || 'manual';
    $('yb-la-status').value = (item && item.status) || 'scheduled';
    $('yb-la-title-da').value = (item && item.title_da) || '';
    $('yb-la-title-en').value = (item && item.title_en) || '';
    $('yb-la-desc-da').value = (item && item.description_da) || '';
    $('yb-la-desc-en').value = (item && item.description_en) || '';
    $('yb-la-instructor').value = (item && item.instructor) || '';
    $('yb-la-mux-playback').value = (item && item.muxPlaybackId) || '';
    $('yb-la-recording-id').value = (item && item.recordingPlaybackId) || '';
    $('yb-la-recurrence').value = (item && item.recurrence && item.recurrence.type) || 'none';
    $('yb-la-recurrence-end').value = (item && item.recurrence && item.recurrence.endDate) || '';
    $('yb-la-access-perms').value = (item && item.access && item.access.permissions) ? item.access.permissions.join(', ') : 'live-streaming';
    $('yb-la-cohorts').value = (item && item.cohorts && item.cohorts.length) ? item.cohorts.join(', ') : '';

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

    // Role checkboxes
    var roleCbs = document.querySelectorAll('.yb-la-role-cb');
    var roles = (item && item.access && item.access.roles) || ['trainee', 'teacher', 'admin'];
    for (var i = 0; i < roleCbs.length; i++) {
      roleCbs[i].checked = roles.indexOf(roleCbs[i].value) !== -1;
    }

    toggleSourceFields();
    toggleRecurrenceEnd();
    showView('form');
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
    var roleCbs = document.querySelectorAll('.yb-la-role-cb');
    var roles = [];
    for (var i = 0; i < roleCbs.length; i++) {
      if (roleCbs[i].checked) roles.push(roleCbs[i].value);
    }
    var permsStr = ($('yb-la-access-perms').value || '').trim();
    var perms = permsStr ? permsStr.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [];

    var data = {
      source: $('yb-la-source').value,
      status: $('yb-la-status').value,
      title_da: $('yb-la-title-da').value.trim(),
      title_en: $('yb-la-title-en').value.trim(),
      description_da: $('yb-la-desc-da').value.trim(),
      description_en: $('yb-la-desc-en').value.trim(),
      instructor: $('yb-la-instructor').value.trim(),
      startDateTime: $('yb-la-start').value ? new Date($('yb-la-start').value).toISOString() : '',
      endDateTime: $('yb-la-end').value ? new Date($('yb-la-end').value).toISOString() : '',
      muxPlaybackId: $('yb-la-mux-playback').value.trim() || null,
      recordingPlaybackId: $('yb-la-recording-id').value.trim() || null,
      access: { roles: roles, permissions: perms }
    };

    // Cohort restriction
    var cohortsStr = ($('yb-la-cohorts') ? $('yb-la-cohorts').value : '').trim();
    if (cohortsStr) {
      data.cohorts = cohortsStr.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    } else {
      data.cohorts = [];
    }

    var recType = $('yb-la-recurrence').value;
    if (recType !== 'none' && data.source === 'manual') {
      data.recurrence = { type: recType, endDate: $('yb-la-recurrence-end').value || null };
    } else {
      data.recurrence = { type: 'none' };
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

      html += '<tr' + (alreadyImported ? ' style="opacity:0.5"' : '') + '>';
      html += '<td><input type="checkbox" class="yb-la-mb-cb" data-idx="' + origIdx + '"' + (isSelected ? ' checked' : '') + '></td>';
      html += '<td><strong>' + esc(cls.name) + '</strong>' + (alreadyImported ? ' <span style="font-size:0.7rem;color:#6F6A66">(' + t('live_mb_already_imported') + ')</span>' : '') + '</td>';
      html += '<td>' + fmtDate(cls.startDateTime) + '</td>';
      html += '<td>' + esc(cls.instructor) + '</td>';
      html += '<td style="font-size:0.75rem">' + esc(cls.programName) + '</td>';
      html += '<td style="font-size:0.75rem">' + esc(cls.sessionTypeName || '') + '</td>';
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
            row.style.opacity = '0.5';
            // Add "already imported" label next to the title
            var titleCell = row.querySelectorAll('td')[1];
            if (titleCell && titleCell.querySelector('strong')) {
              titleCell.querySelector('strong').insertAdjacentHTML(
                'afterend',
                ' <span style="font-size:0.7rem;color:#6F6A66">(' + esc(t('live_mb_already_imported')) + ')</span>'
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
    });

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

    // MB import: select-all checkbox
    var mbSelectAll = $('yb-la-mb-select-all');
    if (mbSelectAll) mbSelectAll.addEventListener('change', function () { selectAllMb(mbSelectAll.checked); });

    // MB import: individual checkboxes (delegated)
    document.addEventListener('change', function (e) {
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

    // Tab listener — lazy load on first visit
    document.querySelectorAll('[data-yb-admin-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.getAttribute('data-yb-admin-tab') === 'live' && !loaded) {
          loadItems();
        }
      });
    });
  }

  /* ══════════════════════════════════════════
     INIT
     ══════════════════════════════════════════ */
  function init() {
    bindEvents();
    // If URL hash is #live, load immediately
    if (window.location.hash === '#live') {
      loadItems();
    }
  }

  var checkInterval = setInterval(function () {
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
      clearInterval(checkInterval);
      init();
    }
  }, 100);
})();
