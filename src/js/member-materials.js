/**
 * YOGA BIBLE — MEMBER AREA: TRAINING MATERIALS
 * Fetches documents from the server-side member-documents endpoint,
 * which handles permission filtering via the Firebase Admin SDK.
 * This avoids any Firestore client-side security rule issues.
 */
(function() {
  'use strict';

  var loaded = false;
  var T = window._ybMemberMaterialsT || {};

  function isDa() { return window.location.pathname.indexOf('/en/') !== 0; }

  function esc(str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // Convert a Google Drive share/view URL to a direct download URL.
  function driveDownloadUrl(url) {
    if (!url || url.indexOf('drive.google.com') === -1) return url;
    var match = url.match(/\/file\/d\/([^/?#]+)/);
    if (match) return 'https://drive.google.com/uc?export=download&id=' + match[1];
    return url;
  }

  function t(key) { return T[key] || key; }

  var CAT_CONFIG = {
    manual:    { icon: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>' },
    workbook:  { icon: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>' },
    reference: { icon: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>' },
    schedule:  { icon: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>' }
  };

  // ── Init ──
  function init() {
    var panel = document.getElementById('yb-ma-tp-materials');
    if (!panel) return;

    var observer = new MutationObserver(function() {
      if (!panel.hidden && !loaded) {
        loaded = true;
        observer.disconnect();
        loadMaterials();
      }
    });
    observer.observe(panel, { attributes: true, attributeFilter: ['hidden'] });

    if (!panel.hidden) {
      loaded = true;
      loadMaterials();
    }
  }

  // ── Fetch from server-side endpoint ──
  function loadMaterials() {
    var container  = document.getElementById('yb-mat-list');
    var loadingEl  = document.getElementById('yb-mat-loading');
    var emptyEl    = document.getElementById('yb-mat-empty');
    if (!container) return;

    // Wait for Firebase auth to be ready, then get token
    function tryFetch(attempts) {
      if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) {
        if (attempts > 50) { showError(container, loadingEl); return; }
        return setTimeout(function() { tryFetch(attempts + 1); }, 100);
      }

      var auth = firebase.auth();
      var user = auth.currentUser;

      if (!user) {
        // Wait for auth state
        var unsub = auth.onAuthStateChanged(function(u) {
          unsub();
          if (!u) { showError(container, loadingEl); return; }
          fetchWithUser(u, container, loadingEl, emptyEl);
        });
        return;
      }

      fetchWithUser(user, container, loadingEl, emptyEl);
    }

    tryFetch(0);
  }

  function fetchWithUser(user, container, loadingEl, emptyEl) {
    user.getIdToken().then(function(token) {
      return fetch('/.netlify/functions/member-documents', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
    }).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function(data) {
      if (loadingEl) loadingEl.hidden = true;
      if (!data.ok || !data.documents || !data.documents.length) {
        container.innerHTML = '';
        if (emptyEl) emptyEl.hidden = false;
        return;
      }
      if (emptyEl) emptyEl.hidden = true;
      renderMaterials(container, data.documents);
    }).catch(function(err) {
      console.error('[member-materials] Error:', err);
      showError(container, loadingEl);
    });
  }

  function showError(container, loadingEl) {
    if (loadingEl) loadingEl.hidden = true;
    container.innerHTML = '<p style="color:#6F6A66;text-align:center">' +
      (isDa() ? 'Kunne ikke hente materialer.' : 'Could not load materials.') + '</p>';
  }

  // ── Render ──
  function renderMaterials(container, docs) {
    var lang = isDa() ? 'da' : 'en';
    var groups = {};
    var catOrder = ['manual', 'workbook', 'reference', 'schedule'];
    docs.forEach(function(d) {
      var cat = d.category || 'manual';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(d);
    });

    var catLabels = {
      manual:    t('materials_cat_manual'),
      workbook:  t('materials_cat_workbook'),
      reference: t('materials_cat_reference'),
      schedule:  t('materials_cat_schedule')
    };

    var html = '';
    catOrder.forEach(function(cat) {
      if (!groups[cat] || !groups[cat].length) return;
      html += '<div class="yb-mat__group">';
      html += '<h3 class="yb-mat__group-title">' + esc(catLabels[cat] || cat) + '</h3>';
      html += '<div class="yb-mat__cards">';

      groups[cat].forEach(function(d) {
        var title  = d['title_' + lang]       || d.title_da       || d.title_en       || 'Document';
        var desc   = d['description_' + lang] || d.description_da || d.description_en || '';
        var config = CAT_CONFIG[d.category]   || CAT_CONFIG.manual;
        var downloadUrl = driveDownloadUrl(d.fileUrl);

        html += '<div class="yb-mat__card">';
        html += '<div class="yb-mat__card-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + config.icon + '</svg></div>';
        html += '<div class="yb-mat__card-body">';
        html += '<h4 class="yb-mat__card-title">' + esc(title) + '</h4>';
        if (desc) html += '<p class="yb-mat__card-desc">' + esc(desc) + '</p>';
        html += '</div>';
        html += '<div class="yb-mat__card-actions">';
        if (d.fileUrl) {
          html += '<a href="' + esc(d.fileUrl) + '" target="_blank" rel="noopener" class="yb-btn yb-btn--primary yb-btn--small">' + esc(t('materials_open')) + '</a>';
          html += '<a href="' + esc(downloadUrl) + '" target="_blank" rel="noopener" class="yb-btn yb-btn--outline yb-btn--small">';
          html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
          html += '</a>';
        }
        html += '</div></div>';
      });

      html += '</div></div>';
    });

    container.innerHTML = html;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
