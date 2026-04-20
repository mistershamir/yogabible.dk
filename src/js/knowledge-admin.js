/**
 * YOGA BIBLE — KNOWLEDGE BASE ADMIN
 * Manage agent knowledge sections per brand via knowledge-admin Netlify function.
 * Three brand tabs: Yoga Bible, Hot Yoga CPH, Vibro Yoga.
 */
(function () {
  'use strict';

  /* ══════════════════════════════════════════
     STATE
     ══════════════════════════════════════════ */
  var sections = [];
  var loaded = false;
  var currentBrand = 'yoga-bible';
  var editingId = null;

  var BRAND_LABELS = {
    'yoga-bible': 'Yoga Bible',
    'hot-yoga-cph': 'Hot Yoga CPH',
    'vibro-yoga': 'Vibro Yoga'
  };

  var BRAND_COLORS = {
    'yoga-bible': '#f75c03',
    'hot-yoga-cph': '#3f99a5',
    'vibro-yoga': '#8B5CF6'
  };

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
    if (window.getAuthToken) {
      return window.getAuthToken().then(function (t) {
        if (!t) throw new Error('Not authenticated');
        return t;
      });
    }
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
      return fetch('/.netlify/functions/knowledge-admin' + qs, opts);
    }).then(function (res) { return res.json(); });
  }

  /* ══════════════════════════════════════════
     LOAD
     ══════════════════════════════════════════ */
  function loadSections() {
    apiCall('GET', { brand: currentBrand }).then(function (data) {
      if (!data.ok) { toast(data.error || 'Load error', true); return; }
      sections = data.items || [];
      loaded = true;
      renderSections();
    }).catch(function (err) {
      console.error('[knowledge-admin] Load error:', err);
      toast('Failed to load knowledge sections', true);
    });
  }

  /* ══════════════════════════════════════════
     RENDER SECTIONS LIST
     ══════════════════════════════════════════ */
  function renderSections() {
    var container = $('yb-kb-sections');
    if (!container) return;

    if (!sections.length) {
      container.innerHTML = '<div class="yb-admin__empty">' +
        '<p>No knowledge sections for ' + esc(BRAND_LABELS[currentBrand]) + ' yet.</p>' +
        '<p>Click <strong>+ New Section</strong> to add the first one.</p>' +
        '</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < sections.length; i++) {
      var s = sections[i];
      var preview = (s.content || '').substring(0, 120).replace(/\n/g, ' ');
      if ((s.content || '').length > 120) preview += '...';
      var statusClass = s.active !== false ? 'yb-kb__status--active' : 'yb-kb__status--inactive';
      var statusLabel = s.active !== false ? 'Active' : 'Inactive';

      html += '<div class="yb-kb__card" data-id="' + esc(s.id) + '">' +
        '<div class="yb-kb__card-header">' +
          '<div class="yb-kb__card-title-row">' +
            '<span class="yb-kb__card-key">' + esc(s.section_key) + '</span>' +
            '<span class="yb-kb__status ' + statusClass + '">' + statusLabel + '</span>' +
          '</div>' +
          '<h3 class="yb-kb__card-title">' + esc(s.title) + '</h3>' +
        '</div>' +
        '<p class="yb-kb__card-preview">' + esc(preview) + '</p>' +
        '<div class="yb-kb__card-footer">' +
          '<span class="yb-kb__card-meta">Sort: ' + (s.sort_order || 0) + '</span>' +
          '<button type="button" class="yb-btn yb-btn--outline yb-btn--sm" data-action="kb-edit" data-id="' + esc(s.id) + '">Edit</button>' +
        '</div>' +
      '</div>';
    }

    container.innerHTML = html;
  }

  /* ══════════════════════════════════════════
     EDITOR
     ══════════════════════════════════════════ */
  function showEditor(section) {
    editingId = section ? section.id : null;
    $('yb-kb-sections').hidden = true;
    var toolbar = document.querySelector('.yb-kb__toolbar');
    if (toolbar) toolbar.hidden = true;
    $('yb-kb-editor').hidden = false;

    $('yb-kb-editor-title').textContent = section ? 'Edit: ' + section.title : 'New Section';
    $('yb-kb-id').value = section ? section.id : '';
    $('yb-kb-brand').value = currentBrand;
    $('yb-kb-section-key').value = section ? section.section_key : '';
    $('yb-kb-title').value = section ? section.title : '';
    $('yb-kb-content').value = section ? section.content : '';
    $('yb-kb-sort').value = section ? (section.sort_order || 0) : sections.length;
    $('yb-kb-active').checked = section ? section.active !== false : true;
    $('yb-kb-delete-btn').hidden = !section;

    // Focus section key for new, content for edit
    if (section) {
      $('yb-kb-content').focus();
    } else {
      $('yb-kb-section-key').focus();
    }
  }

  function hideEditor() {
    $('yb-kb-editor').hidden = true;
    $('yb-kb-sections').hidden = false;
    var toolbar = document.querySelector('.yb-kb__toolbar');
    if (toolbar) toolbar.hidden = false;
    editingId = null;
  }

  function saveSection(e) {
    e.preventDefault();
    var id = $('yb-kb-id').value;
    var payload = {
      brand: currentBrand,
      section_key: $('yb-kb-section-key').value.trim().toLowerCase().replace(/\s+/g, '_'),
      title: $('yb-kb-title').value.trim(),
      content: $('yb-kb-content').value,
      sort_order: parseInt($('yb-kb-sort').value) || 0,
      active: $('yb-kb-active').checked
    };

    if (!payload.section_key || !payload.title) {
      toast('Section key and title are required', true);
      return;
    }

    var method = id ? 'PUT' : 'POST';
    if (id) payload.id = id;

    var saveBtn = e.target.querySelector('[type="submit"]') || e.target.querySelector('.yb-btn--primary');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.classList.add('yb-btn--muted'); }

    apiCall(method, null, payload).then(function (data) {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.classList.remove('yb-btn--muted'); }
      if (!data.ok) { toast(data.error || 'Save error', true); return; }
      toast('Saved!');
      hideEditor();
      loadSections();
    }).catch(function (err) {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.classList.remove('yb-btn--muted'); }
      console.error('[knowledge-admin] Save error:', err);
      toast('Failed to save', true);
    });
  }

  function deleteSection() {
    if (!editingId) return;
    if (!confirm('Delete this knowledge section? This cannot be undone.')) return;

    apiCall('DELETE', { id: editingId }).then(function (data) {
      if (!data.ok) { toast(data.error || 'Delete error', true); return; }
      toast('Deleted');
      hideEditor();
      loadSections();
    }).catch(function (err) {
      console.error('[knowledge-admin] Delete error:', err);
      toast('Failed to delete', true);
    });
  }

  /* ══════════════════════════════════════════
     BRAND TAB SWITCHING
     ══════════════════════════════════════════ */
  function switchBrand(brand) {
    currentBrand = brand;

    // Update tab active state
    var tabs = document.querySelectorAll('.yb-kb__brand-tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('is-active', tabs[i].getAttribute('data-kb-brand') === brand);
    }

    // Update title
    var title = $('yb-kb-brand-title');
    if (title) title.textContent = BRAND_LABELS[brand] + ' — Knowledge Base';

    // Hide editor if open
    hideEditor();

    // Reload
    loadSections();
  }

  /* ══════════════════════════════════════════
     EVENT DELEGATION
     ══════════════════════════════════════════ */
  function handleClick(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) {
      // Check if clicked a card
      var card = e.target.closest('.yb-kb__card');
      if (card && !e.target.closest('button')) {
        var id = card.getAttribute('data-id');
        var section = sections.find(function (s) { return s.id === id; });
        if (section) showEditor(section);
      }
      return;
    }

    var action = btn.getAttribute('data-action');

    if (action === 'kb-add-section') {
      showEditor(null);
    } else if (action === 'kb-refresh') {
      loadSections();
    } else if (action === 'kb-back') {
      hideEditor();
    } else if (action === 'kb-edit') {
      var editId = btn.getAttribute('data-id');
      var sec = sections.find(function (s) { return s.id === editId; });
      if (sec) showEditor(sec);
    } else if (action === 'kb-delete') {
      deleteSection();
    }
  }

  function handleBrandClick(e) {
    var tab = e.target.closest('[data-kb-brand]');
    if (!tab) return;
    var brand = tab.getAttribute('data-kb-brand');
    if (brand) switchBrand(brand);
  }

  /* ══════════════════════════════════════════
     INIT
     ══════════════════════════════════════════ */
  function init() {
    var panel = document.querySelector('[data-yb-admin-panel="knowledge"]');
    if (!panel) return;

    // Event listeners
    panel.addEventListener('click', handleClick);
    panel.addEventListener('click', handleBrandClick);

    var form = $('yb-kb-form');
    if (form) form.addEventListener('submit', saveSection);

    // Load on first tab activation
    var observer = new MutationObserver(function () {
      if (panel.classList.contains('is-active') && !loaded) {
        loadSections();
      }
    });
    observer.observe(panel, { attributes: true, attributeFilter: ['class'] });

    // Also load if tab is already active
    if (panel.classList.contains('is-active')) {
      loadSections();
    }
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
