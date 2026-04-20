/**
 * YOGA BIBLE — CATALOG ADMIN
 * Manage course catalog items via catalog-admin Netlify function.
 * CRUD + seed + filters + inline active toggle + bulk operations.
 */
(function () {
  'use strict';

  /* ══════════════════════════════════════════
     STATE
     ══════════════════════════════════════════ */
  var T = {};
  var catalogItems = [];
  var catalogLoaded = false;
  var currentCatalogId = null;
  var catalogSearchTerm = '';
  var catalogFilterCategory = '';
  var catalogFilterActive = '';
  var selectedCatalogIds = {};  // object used as Set: { id: true }

  /* ══════════════════════════════════════════
     HELPERS
     ══════════════════════════════════════════ */
  function t(k) { return T[k] || k; }
  function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function $(id) { return document.getElementById(id); }

  function selectedCount() {
    var n = 0;
    for (var k in selectedCatalogIds) if (selectedCatalogIds[k]) n++;
    return n;
  }

  function selectedIdList() {
    var ids = [];
    for (var k in selectedCatalogIds) if (selectedCatalogIds[k]) ids.push(k);
    return ids;
  }

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
      return fetch('/.netlify/functions/catalog-admin' + qs, opts);
    }).then(function (res) { return res.json(); });
  }

  /* ══════════════════════════════════════════
     LOAD
     ══════════════════════════════════════════ */
  function loadCatalog() {
    apiCall('GET').then(function (data) {
      if (!data.ok) { toast(data.error || t('error_load'), true); return; }
      catalogItems = data.items || [];
      renderCatalogTable();
    }).catch(function (err) {
      console.error('[catalog-admin] Load error:', err);
      toast(t('error_load'), true);
    });
  }

  /* ══════════════════════════════════════════
     BULK BAR
     ══════════════════════════════════════════ */
  function updateBulkBar() {
    var bar = $('yb-catalog-bulk-bar');
    var countEl = $('yb-catalog-bulk-count');
    var n = selectedCount();
    if (bar) bar.hidden = n === 0;
    if (countEl) countEl.textContent = n + ' ' + t('catalog_selected');
    // Sync select-all checkbox
    var selAll = $('yb-catalog-select-all');
    if (selAll) {
      var visibleIds = getFilteredIds();
      selAll.checked = visibleIds.length > 0 && visibleIds.every(function (id) { return selectedCatalogIds[id]; });
    }
  }

  function getFilteredIds() {
    return catalogItems.filter(function (item) {
      if (catalogFilterCategory && item.category !== catalogFilterCategory) return false;
      if (catalogFilterActive === 'true' && !item.active) return false;
      if (catalogFilterActive === 'false' && item.active) return false;
      if (catalogSearchTerm) {
        var s = catalogSearchTerm.toLowerCase();
        var haystack = ((item.course_name || '') + ' ' + (item.course_id || '') + ' ' + (item.cohort_label || '') + ' ' + (item.track || '')).toLowerCase();
        if (haystack.indexOf(s) === -1) return false;
      }
      return true;
    }).map(function (item) { return item.id; });
  }

  /* ══════════════════════════════════════════
     RENDER TABLE
     ══════════════════════════════════════════ */
  function renderCatalogTable() {
    var tbody = $('yb-catalog-table-body');
    var countEl = $('yb-catalog-count');
    if (!tbody) return;

    var filtered = catalogItems.filter(function (item) {
      if (catalogFilterCategory && item.category !== catalogFilterCategory) return false;
      if (catalogFilterActive === 'true' && !item.active) return false;
      if (catalogFilterActive === 'false' && item.active) return false;
      if (catalogSearchTerm) {
        var s = catalogSearchTerm.toLowerCase();
        var haystack = ((item.course_name || '') + ' ' + (item.course_id || '') + ' ' + (item.cohort_label || '') + ' ' + (item.track || '')).toLowerCase();
        if (haystack.indexOf(s) === -1) return false;
      }
      return true;
    });

    if (countEl) countEl.textContent = filtered.length + ' ' + t('catalog_items');

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;color:#6F6A66">' + esc(t('catalog_empty')) + '</td></tr>';
      updateBulkBar();
      return;
    }

    // Group by course_id
    var groups = {};
    var groupOrder = [];
    filtered.forEach(function (item) {
      var key = item.course_id || 'unknown';
      if (!groups[key]) { groups[key] = []; groupOrder.push(key); }
      groups[key].push(item);
    });

    var html = '';
    groupOrder.forEach(function (courseId) {
      var items = groups[courseId];
      // Group header
      html += '<tr class="yb-admin__group-row"><td colspan="8" style="background:#F5F3F0;font-weight:700;padding:0.5rem 0.75rem;border-top:2px solid #E8E4E0">' + esc(courseId) + ' \u2014 ' + esc(items[0].course_name || '') + '</td></tr>';
      items.forEach(function (item) {
        var checked = selectedCatalogIds[item.id] ? ' checked' : '';
        var activeLabel = item.active ? '<span style="color:#16a34a">&#9679;</span> ' + t('catalog_active') : '<span style="color:#6F6A66">&#9675;</span> ' + t('catalog_inactive');
        html += '<tr>'
          + '<td class="yb-lead__th-cb"><input type="checkbox" class="yb-catalog-row-cb" data-id="' + item.id + '"' + checked + '></td>'
          + '<td>' + esc(item.course_name || '') + '</td>'
          + '<td>' + esc(item.category || '') + '</td>'
          + '<td>' + esc(item.cohort_label || '') + '</td>'
          + '<td><button class="yb-btn yb-btn--ghost yb-btn--xs" data-action="catalog-toggle-active" data-id="' + item.id + '">' + activeLabel + '</button></td>'
          + '<td>' + esc(item.open_status || '') + '</td>'
          + '<td>' + (item.price_full ? item.price_full.toLocaleString() + ' ' + (item.currency || 'DKK') : '\u2014') + '</td>'
          + '<td class="yb-admin__actions-cell">'
            + '<button class="yb-btn yb-btn--outline yb-btn--xs" data-action="catalog-edit" data-id="' + item.id + '">' + t('edit') + '</button> '
            + '<button class="yb-btn yb-btn--outline yb-btn--xs" data-action="catalog-duplicate" data-id="' + item.id + '">' + t('duplicate') + '</button> '
            + '<button class="yb-btn yb-btn--ghost yb-btn--xs" data-action="catalog-delete" data-id="' + item.id + '" style="color:#dc2626">' + t('delete') + '</button>'
          + '</td>'
          + '</tr>';
      });
    });

    tbody.innerHTML = html;
    updateBulkBar();
  }

  /* ══════════════════════════════════════════
     LIST / FORM VIEWS
     ══════════════════════════════════════════ */
  function showCatalogList() {
    var listView = $('yb-catalog-v-list');
    var formView = $('yb-catalog-v-form');
    if (listView) listView.hidden = false;
    if (formView) formView.hidden = true;
    currentCatalogId = null;
  }

  function showCatalogForm(itemId) {
    var listView = $('yb-catalog-v-list');
    var formView = $('yb-catalog-v-form');
    var titleEl = $('yb-catalog-form-title');
    if (listView) listView.hidden = true;
    if (formView) formView.hidden = false;

    currentCatalogId = itemId || null;

    // Clear form
    var form = $('yb-catalog-form');
    if (form) form.reset();
    $('yb-cat-id').value = '';
    $('yb-cat-active').checked = true;

    if (titleEl) titleEl.textContent = itemId ? t('catalog_edit_title') : t('catalog_new_title');

    if (itemId) {
      var item = catalogItems.find(function (x) { return x.id === itemId; });
      if (!item) return;
      populateForm(item);
    }

    // Toggle external URL visibility
    toggleExternalUrlField();
  }

  function populateForm(item) {
    $('yb-cat-id').value = item.id || '';
    $('yb-cat-course-id').value = item.course_id || '';
    $('yb-cat-course-name').value = item.course_name || '';
    $('yb-cat-category').value = item.category || 'Education';
    $('yb-cat-track').value = item.track || '';
    $('yb-cat-cohort-id').value = item.cohort_id || '';
    $('yb-cat-cohort-label').value = item.cohort_label || '';
    $('yb-cat-start-date').value = item.start_date || '';
    $('yb-cat-end-date').value = item.end_date || '';
    $('yb-cat-capacity').value = item.capacity || 0;
    $('yb-cat-open-status').value = item.open_status || '';
    $('yb-cat-payment-full').value = item.payment_url_full || '';
    $('yb-cat-payment-deposit').value = item.payment_url_deposit || '';
    $('yb-cat-price-full').value = item.price_full || '';
    $('yb-cat-currency').value = item.currency || 'DKK';
    $('yb-cat-deposit-amount').value = item.deposit_amount || '';
    $('yb-cat-max-instalments').value = item.max_instalments || 0;
    $('yb-cat-sort-key').value = item.sort_key || '';
    $('yb-cat-notes').value = item.notes || '';
    $('yb-cat-active').checked = !!item.active;
    $('yb-cat-waitlist-enabled').checked = !!item.waitlist_enabled;
    $('yb-cat-allow-deposit').checked = !!item.allow_deposit;
    $('yb-cat-allow-instalments').checked = !!item.allow_instalments;
    $('yb-cat-external-only').checked = !!item.external_only;
    $('yb-cat-external-url').value = item.external_url || '';
    toggleExternalUrlField();
  }

  function readForm() {
    return {
      course_id: $('yb-cat-course-id').value.trim(),
      course_name: $('yb-cat-course-name').value.trim(),
      category: $('yb-cat-category').value,
      track: $('yb-cat-track').value.trim(),
      cohort_id: $('yb-cat-cohort-id').value.trim(),
      cohort_label: $('yb-cat-cohort-label').value.trim(),
      start_date: $('yb-cat-start-date').value.trim(),
      end_date: $('yb-cat-end-date').value.trim(),
      capacity: parseInt($('yb-cat-capacity').value) || 0,
      open_status: $('yb-cat-open-status').value.trim(),
      payment_url_full: $('yb-cat-payment-full').value.trim(),
      payment_url_deposit: $('yb-cat-payment-deposit').value.trim(),
      price_full: parseInt($('yb-cat-price-full').value) || 0,
      currency: $('yb-cat-currency').value.trim() || 'DKK',
      deposit_amount: $('yb-cat-deposit-amount').value.trim(),
      max_instalments: parseInt($('yb-cat-max-instalments').value) || 0,
      sort_key: $('yb-cat-sort-key').value.trim(),
      notes: $('yb-cat-notes').value.trim(),
      active: $('yb-cat-active').checked,
      waitlist_enabled: $('yb-cat-waitlist-enabled').checked,
      allow_deposit: $('yb-cat-allow-deposit').checked,
      allow_instalments: $('yb-cat-allow-instalments').checked,
      external_only: $('yb-cat-external-only').checked,
      external_url: $('yb-cat-external-url').value.trim()
    };
  }

  function toggleExternalUrlField() {
    var chk = $('yb-cat-external-only');
    var wrap = $('yb-cat-external-url-wrap');
    if (chk && wrap) wrap.hidden = !chk.checked;
  }

  /* ══════════════════════════════════════════
     CRUD
     ══════════════════════════════════════════ */
  function saveCatalogItem(e) {
    e.preventDefault();
    var data = readForm();
    var id = $('yb-cat-id').value;

    var method = id ? 'PUT' : 'POST';
    if (id) data.id = id;

    var saveBtn = e.target.querySelector('[type="submit"]') || e.target.querySelector('.yb-btn--primary');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.classList.add('yb-btn--muted'); }

    apiCall(method, null, data).then(function (res) {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.classList.remove('yb-btn--muted'); }
      if (!res.ok) { toast(res.error || t('error_save'), true); return; }
      toast(t('saved'));
      showCatalogList();
      loadCatalog();
    }).catch(function (err) {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.classList.remove('yb-btn--muted'); }
      console.error('[catalog-admin] Save error:', err);
      toast(t('error_save'), true);
    });
  }

  function toggleCatalogActive(id) {
    var item = catalogItems.find(function (x) { return x.id === id; });
    if (!item) return;
    apiCall('PUT', null, { id: id, active: !item.active }).then(function (res) {
      if (!res.ok) { toast(res.error || t('error_save'), true); return; }
      item.active = !item.active;
      renderCatalogTable();
    }).catch(function (err) {
      toast(t('error_save'), true);
    });
  }

  function duplicateCatalogItem(id) {
    var item = catalogItems.find(function (x) { return x.id === id; });
    if (!item) return;
    showCatalogForm(null);
    // Pre-fill from the source item but clear cohort-specific fields
    populateForm(item);
    $('yb-cat-id').value = '';
    $('yb-cat-cohort-id').value = '';
    $('yb-cat-cohort-label').value = '';
    $('yb-cat-start-date').value = '';
    $('yb-cat-end-date').value = '';
    $('yb-cat-sort-key').value = '';
    var titleEl = $('yb-catalog-form-title');
    if (titleEl) titleEl.textContent = t('catalog_new_title');
  }

  function deleteCatalogItem(id) {
    if (!confirm(t('catalog_confirm_delete'))) return;
    apiCall('DELETE', null, { id: id }).then(function (res) {
      if (!res.ok) { toast(res.error || t('error_save'), true); return; }
      catalogItems = catalogItems.filter(function (x) { return x.id !== id; });
      delete selectedCatalogIds[id];
      renderCatalogTable();
      toast(t('saved'));
    }).catch(function (err) {
      toast(t('error_save'), true);
    });
  }

  /* ══════════════════════════════════════════
     BULK OPERATIONS
     ══════════════════════════════════════════ */
  function bulkDeleteCatalog() {
    var ids = selectedIdList();
    if (!ids.length) return;
    var msg = t('catalog_bulk_delete_confirm').replace('{count}', ids.length);
    if (!confirm(msg)) return;

    apiCall('POST', null, { action: 'bulkDelete', ids: ids }).then(function (res) {
      if (!res.ok) { toast(res.error || t('error_save'), true); return; }
      // Remove from local state
      catalogItems = catalogItems.filter(function (x) { return ids.indexOf(x.id) === -1; });
      ids.forEach(function (id) { delete selectedCatalogIds[id]; });
      renderCatalogTable();
      toast(t('saved'));
    }).catch(function (err) {
      console.error('[catalog-admin] Bulk delete error:', err);
      toast(t('error_save'), true);
    });
  }

  function bulkToggleCatalog(active) {
    var ids = selectedIdList();
    if (!ids.length) return;

    apiCall('POST', null, { action: 'bulkUpdate', ids: ids, updates: { active: active } }).then(function (res) {
      if (!res.ok) { toast(res.error || t('error_save'), true); return; }
      // Update local state
      catalogItems.forEach(function (item) {
        if (ids.indexOf(item.id) !== -1) item.active = active;
      });
      renderCatalogTable();
      toast(t('saved'));
    }).catch(function (err) {
      console.error('[catalog-admin] Bulk toggle error:', err);
      toast(t('error_save'), true);
    });
  }

  /* ══════════════════════════════════════════
     SEED
     ══════════════════════════════════════════ */
  function seedCatalog() {
    if (!confirm(t('catalog_seed_confirm'))) return;
    getAuthToken().then(function (token) {
      return fetch('/.netlify/functions/catalog-seed?confirm=seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }
      });
    }).then(function (res) { return res.json(); })
    .then(function (data) {
      if (!data.ok) {
        if (data.skipped) {
          toast(t('catalog_already_seeded'));
        } else {
          toast(data.error || t('error_save'), true);
        }
        return;
      }
      toast(t('catalog_seeded') + ' (' + (data.count || 0) + ')');
      loadCatalog();
    }).catch(function (err) {
      console.error('[catalog-admin] Seed error:', err);
      toast(t('error_save'), true);
    });
  }

  /* ══════════════════════════════════════════
     EVENT BINDING
     ══════════════════════════════════════════ */
  function bindCatalogEvents() {
    // Actions (delegated)
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-action');
      var id = btn.getAttribute('data-id');

      switch (action) {
        case 'catalog-new': showCatalogForm(null); break;
        case 'catalog-edit': showCatalogForm(id); break;
        case 'catalog-cancel': showCatalogList(); break;
        case 'catalog-refresh': loadCatalog(); break;
        case 'catalog-toggle-active': toggleCatalogActive(id); break;
        case 'catalog-duplicate': duplicateCatalogItem(id); break;
        case 'catalog-delete': deleteCatalogItem(id); break;
        case 'catalog-seed': seedCatalog(); break;
        case 'catalog-bulk-delete': bulkDeleteCatalog(); break;
        case 'catalog-bulk-activate': bulkToggleCatalog(true); break;
        case 'catalog-bulk-deactivate': bulkToggleCatalog(false); break;
        case 'catalog-deselect-all':
          selectedCatalogIds = {};
          renderCatalogTable();
          break;
      }
    });

    // Row checkbox changes (delegated)
    document.addEventListener('change', function (e) {
      if (e.target.classList.contains('yb-catalog-row-cb')) {
        var id = e.target.getAttribute('data-id');
        if (e.target.checked) {
          selectedCatalogIds[id] = true;
        } else {
          delete selectedCatalogIds[id];
        }
        updateBulkBar();
      }
    });

    // Select-all checkbox
    var selAll = $('yb-catalog-select-all');
    if (selAll) selAll.addEventListener('change', function () {
      var visibleIds = getFilteredIds();
      if (selAll.checked) {
        visibleIds.forEach(function (id) { selectedCatalogIds[id] = true; });
      } else {
        visibleIds.forEach(function (id) { delete selectedCatalogIds[id]; });
      }
      renderCatalogTable();
    });

    // Form submit
    var form = $('yb-catalog-form');
    if (form) form.addEventListener('submit', saveCatalogItem);

    // Search
    var searchForm = $('yb-catalog-search-form');
    if (searchForm) searchForm.addEventListener('submit', function (e) {
      e.preventDefault();
      catalogSearchTerm = ($('yb-catalog-search-input') || {}).value || '';
      renderCatalogTable();
    });
    var searchInput = $('yb-catalog-search-input');
    if (searchInput) searchInput.addEventListener('input', function () {
      catalogSearchTerm = searchInput.value;
      renderCatalogTable();
    });

    // Category filter
    var catFilter = $('yb-catalog-category-filter');
    if (catFilter) catFilter.addEventListener('change', function () {
      catalogFilterCategory = catFilter.value;
      renderCatalogTable();
    });

    // Active filter
    var actFilter = $('yb-catalog-active-filter');
    if (actFilter) actFilter.addEventListener('change', function () {
      catalogFilterActive = actFilter.value;
      renderCatalogTable();
    });

    // External-only checkbox toggles URL field visibility
    var extChk = $('yb-cat-external-only');
    if (extChk) extChk.addEventListener('change', toggleExternalUrlField);
  }

  /* ══════════════════════════════════════════
     INIT
     ══════════════════════════════════════════ */
  function initCatalogAdmin() {
    var panel = document.querySelector('[data-yb-admin-panel="catalog"]');
    if (!panel) return;

    T = window._ybAdminT || {};
    bindCatalogEvents();

    // Hook into tab switching
    document.querySelectorAll('[data-yb-admin-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tab = btn.getAttribute('data-yb-admin-tab');
        if (tab === 'catalog' && !catalogLoaded) {
          loadCatalog();
          catalogLoaded = true;
        }
      });
    });
  }

  // Bootstrap — gated on firebaseReady
  if (window.firebaseReady) {
    window.firebaseReady.then(initCatalogAdmin);
  } else {
    var checkInterval = setInterval(function () {
      if (window.firebaseReady) {
        clearInterval(checkInterval);
        window.firebaseReady.then(initCatalogAdmin);
      } else if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
        clearInterval(checkInterval);
        initCatalogAdmin();
      }
    }, 100);
  }

})();
