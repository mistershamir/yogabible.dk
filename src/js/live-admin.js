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
    showView('mb');
  }

  function fetchMbClasses() {
    var startDate = $('yb-la-mb-start').value;
    var endDate = $('yb-la-mb-end').value;

    apiFetch('mb-classes', { params: { startDate: startDate, endDate: endDate } }).then(function (res) {
      if (res.ok) {
        mbClasses = res.classes || [];
        renderMbTable();
      } else {
        toast(res.error || t('error_load'), true);
      }
    });
  }

  function renderMbTable() {
    var tbody = $('yb-live-mb-table-body');
    var emptyEl = $('yb-live-mb-empty');
    if (!tbody) return;

    if (emptyEl) emptyEl.hidden = mbClasses.length > 0;

    if (!mbClasses.length) {
      tbody.innerHTML = '';
      return;
    }

    var html = '';
    for (var i = 0; i < mbClasses.length; i++) {
      var cls = mbClasses[i];
      html += '<tr>';
      html += '<td><input type="checkbox" class="yb-la-mb-cb" data-idx="' + i + '"></td>';
      html += '<td><strong>' + esc(cls.name) + '</strong></td>';
      html += '<td>' + fmtDate(cls.startDateTime) + '</td>';
      html += '<td>' + esc(cls.instructor) + '</td>';
      html += '<td style="font-size:0.75rem">' + esc(cls.programName) + '</td>';
      html += '<td><button class="yb-btn yb-btn--primary yb-btn--sm" data-action="live-mb-import-one" data-idx="' + i + '">+ Import</button></td>';
      html += '</tr>';
    }
    tbody.innerHTML = html;
  }

  function importMbClass(idx) {
    var cls = mbClasses[idx];
    if (!cls) return;

    var data = {
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

    apiFetch('create', { method: 'POST', body: data }).then(function (res) {
      if (res.ok) {
        toast(t('live_mb_imported'));
        loadItems();
      } else {
        toast(res.error || t('error_save'), true);
      }
    });
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
        importMbClass(idx);
        return;
      }

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

    // Filters
    var filterEl = $('yb-live-admin-filter');
    if (filterEl) filterEl.addEventListener('change', renderTable);
    var sourceFilterEl = $('yb-live-admin-source-filter');
    if (sourceFilterEl) sourceFilterEl.addEventListener('change', renderTable);

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
