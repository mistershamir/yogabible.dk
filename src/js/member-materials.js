/**
 * YOGA BIBLE — MEMBER AREA: TRAINING MATERIALS
 * Loads documents from Firestore, filters by user permissions (ALL-match),
 * and renders material cards grouped by category.
 * Follows the same patterns as member-courses.js.
 */
(function() {
  'use strict';

  var db, currentUser, userPermissions = [];
  var loaded = false;

  // Translation strings (set by template)
  var T = window._ybMemberMaterialsT || {};

  function isDa() {
    return window.location.pathname.indexOf('/en/') !== 0;
  }

  function esc(str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // Convert a Google Drive share/view URL to a direct download URL.
  // Input:  https://drive.google.com/file/d/FILE_ID/view?...
  // Output: https://drive.google.com/uc?export=download&id=FILE_ID
  function driveDownloadUrl(url) {
    if (!url || url.indexOf('drive.google.com') === -1) return url;
    var match = url.match(/\/file\/d\/([^/?#]+)/);
    if (match) return 'https://drive.google.com/uc?export=download&id=' + match[1];
    return url;
  }

  function t(key) {
    return T[key] || key;
  }

  // Category display config
  var CAT_CONFIG = {
    manual:    { icon: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>' },
    workbook:  { icon: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>' },
    reference: { icon: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>' },
    schedule:  { icon: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>' }
  };

  // ── Init: Wait for panel visibility ──
  function init() {
    var panel = document.getElementById('yb-ma-tp-materials');
    if (!panel) return;

    var observer = new MutationObserver(function() {
      if (!panel.hidden && !loaded) {
        loaded = true;
        observer.disconnect();
        waitForAuth();
      }
    });
    observer.observe(panel, { attributes: true, attributeFilter: ['hidden'] });

    // Check if already visible
    if (!panel.hidden) {
      loaded = true;
      observer.disconnect();
      waitForAuth();
    }
  }

  function waitForAuth() {
    var check = setInterval(function() {
      if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
        clearInterval(check);
        db = firebase.firestore();
        var auth = firebase.auth();
        if (auth.currentUser) {
          currentUser = auth.currentUser;
          loadPermissionsThenDocuments();
        }
        auth.onAuthStateChanged(function(user) {
          if (user && !currentUser) {
            currentUser = user;
            loadPermissionsThenDocuments();
          }
        });
      }
    }, 100);
  }

  function loadPermissionsThenDocuments() {
    if (!currentUser || !db) return;

    // Get user role data to compute permissions
    db.collection('users').doc(currentUser.uid).get()
      .then(function(userDoc) {
        if (!userDoc.exists) {
          userPermissions = [];
          loadDocuments();
          return;
        }
        var userData = userDoc.data();
        var role = userData.role || 'member';

        // Use YBRoles if available to compute permissions
        if (window.YBRoles && window.YBRoles.computePermissions) {
          userPermissions = window.YBRoles.computePermissions(role, userData.roleDetails || {});
        } else {
          // Fallback: build basic permission list
          userPermissions = [];
          if (role === 'admin' || role === 'teacher') {
            userPermissions = ['materials:100h', 'materials:200h', 'materials:300h', 'materials:500h',
                               'method:triangle', 'method:vinyasa'];
          } else if (role === 'trainee' && userData.roleDetails) {
            if (userData.roleDetails.program) userPermissions.push('materials:' + userData.roleDetails.program);
            if (userData.roleDetails.method) userPermissions.push('method:' + userData.roleDetails.method);
          }
        }

        loadDocuments();
      })
      .catch(function(err) {
        console.error('Error loading user data for materials:', err);
        userPermissions = [];
        loadDocuments();
      });
  }

  function loadDocuments() {
    var container = document.getElementById('yb-mat-list');
    var loadingEl = document.getElementById('yb-mat-loading');
    var emptyEl = document.getElementById('yb-mat-empty');
    if (!container) return;

    db.collection('documents').orderBy('order').get()
      .then(function(snap) {
        var allDocs = [];
        snap.forEach(function(doc) {
          allDocs.push(Object.assign({ id: doc.id }, doc.data()));
        });

        // Filter: user must have ALL requiredPermissions
        var filtered = allDocs.filter(function(doc) {
          var required = doc.requiredPermissions || [];
          if (!required.length) return true; // No permissions required — visible to all with tab access
          return required.every(function(perm) {
            return userPermissions.indexOf(perm) !== -1;
          });
        });

        if (loadingEl) loadingEl.hidden = true;

        if (!filtered.length) {
          container.innerHTML = '';
          if (emptyEl) emptyEl.hidden = false;
          return;
        }

        if (emptyEl) emptyEl.hidden = true;
        renderMaterials(container, filtered);
      })
      .catch(function(err) {
        console.error('Error loading materials:', err);
        if (loadingEl) loadingEl.hidden = true;
        container.innerHTML = '<p style="color:#6F6A66;text-align:center">' +
          (isDa() ? 'Kunne ikke hente materialer.' : 'Could not load materials.') + '</p>';
      });
  }

  function renderMaterials(container, docs) {
    var lang = isDa() ? 'da' : 'en';

    // Group by category
    var groups = {};
    var catOrder = ['manual', 'workbook', 'reference', 'schedule'];
    docs.forEach(function(d) {
      var cat = d.category || 'manual';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(d);
    });

    var catLabels = {
      manual: t('materials_cat_manual'),
      workbook: t('materials_cat_workbook'),
      reference: t('materials_cat_reference'),
      schedule: t('materials_cat_schedule')
    };

    var html = '';
    catOrder.forEach(function(cat) {
      if (!groups[cat] || !groups[cat].length) return;

      html += '<div class="yb-mat__group">';
      html += '<h3 class="yb-mat__group-title">' + esc(catLabels[cat] || cat) + '</h3>';
      html += '<div class="yb-mat__cards">';

      groups[cat].forEach(function(d) {
        var title = d['title_' + lang] || d.title_da || d.title_en || 'Document';
        var desc = d['description_' + lang] || d.description_da || d.description_en || '';
        var config = CAT_CONFIG[d.category] || CAT_CONFIG.manual;

        html += '<div class="yb-mat__card">';
        html += '<div class="yb-mat__card-icon">';
        html += '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + config.icon + '</svg>';
        html += '</div>';
        html += '<div class="yb-mat__card-body">';
        html += '<h4 class="yb-mat__card-title">' + esc(title) + '</h4>';
        if (desc) {
          html += '<p class="yb-mat__card-desc">' + esc(desc) + '</p>';
        }
        html += '</div>';
        html += '<div class="yb-mat__card-actions">';
        if (d.fileUrl) {
          var downloadUrl = driveDownloadUrl(d.fileUrl);
          html += '<a href="' + esc(d.fileUrl) + '" target="_blank" rel="noopener" class="yb-btn yb-btn--primary yb-btn--small">' + esc(t('materials_open')) + '</a>';
          html += '<a href="' + esc(downloadUrl) + '" target="_blank" rel="noopener" class="yb-btn yb-btn--outline yb-btn--small">';
          html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
          html += '</a>';
        }
        html += '</div>';
        html += '</div>';
      });

      html += '</div>';
      html += '</div>';
    });

    container.innerHTML = html;
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
