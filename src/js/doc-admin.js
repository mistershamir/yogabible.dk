/**
 * YOGA BIBLE — DOCUMENT ADMIN
 * CRUD for training documents (PDFs) stored in Firestore 'documents' collection.
 * Follows the same patterns as course-admin.js and catalog-admin.js.
 */
(function() {
  'use strict';

  var db, lang, state = { documents: [], docId: null };

  // ── Helpers ──
  function $(id) { return document.getElementById(id); }
  function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function isDa() { return window.location.pathname.indexOf('/en/') !== 0; }
  function t(k) {
    var T = window._ybDocAdminT || {};
    return T[k] || k;
  }

  function toast(msg, isError) {
    var el = document.getElementById('yb-admin-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'yb-admin-toast';
      el.style.cssText = 'position:fixed;bottom:2rem;left:50%;transform:translateX(-50%);padding:0.75rem 1.5rem;border-radius:12px;font-size:0.9rem;z-index:9999;transition:opacity .3s;pointer-events:none;font-family:inherit';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.background = isError ? '#dc3545' : '#0F0F0F';
    el.style.color = '#fff';
    el.style.opacity = '1';
    clearTimeout(el._timer);
    el._timer = setTimeout(function() { el.style.opacity = '0'; }, 2500);
  }

  // ── View switching ──
  function showView(name) {
    var views = document.querySelectorAll('#yb-doc-v-list, #yb-doc-v-form');
    views.forEach(function(v) { v.hidden = true; });
    var target = $('yb-doc-v-' + name);
    if (target) target.hidden = false;
  }

  // ── Load documents ──
  function loadDocuments() {
    db.collection('documents').orderBy('order').get()
      .then(function(snap) {
        state.documents = [];
        snap.forEach(function(doc) {
          state.documents.push(Object.assign({ id: doc.id }, doc.data()));
        });
        renderDocList();
      })
      .catch(function(err) {
        console.error('Error loading documents:', err);
        toast(t('error_load'), true);
      });
  }

  // ── Render list ──
  function renderDocList() {
    var container = $('yb-doc-list-container');
    if (!container) return;

    if (!state.documents.length) {
      container.innerHTML = '<p style="color:var(--yb-muted,#6F6A66);text-align:center;padding:2rem 0">' + esc(t('doc_no_documents')) + '</p>';
      return;
    }

    var catLabels = {
      manual: t('doc_cat_manual'),
      workbook: t('doc_cat_workbook'),
      reference: t('doc_cat_reference'),
      schedule: t('doc_cat_schedule')
    };

    var html = state.documents.map(function(d) {
      var title = isDa() ? (d.title_da || d.title_en) : (d.title_en || d.title_da);
      var desc = isDa() ? (d.description_da || d.description_en) : (d.description_en || d.description_da);
      var perms = (d.requiredPermissions || []).join(', ') || t('doc_perm_none');
      var catLabel = catLabels[d.category] || d.category;

      return '<div style="display:flex;align-items:center;gap:1rem;padding:1rem;border:1px solid var(--yb-border,#E8E4E0);border-radius:12px;margin-bottom:0.5rem;background:#fff">' +
        '<div style="width:40px;height:40px;border-radius:10px;background:var(--yb-light-bg,#F5F3F0);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--yb-brand,#f75c03)">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
        '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-weight:600;font-size:0.95rem">' + esc(title) + '</div>' +
          '<div style="font-size:0.8rem;color:var(--yb-muted,#6F6A66)">' +
            '<span style="display:inline-block;padding:0.1rem 0.4rem;border-radius:4px;background:rgba(247,92,3,0.1);color:var(--yb-brand,#f75c03);font-size:0.7rem;font-weight:600;margin-right:0.5rem">' + esc(catLabel) + '</span>' +
            esc(perms) +
          '</div>' +
          (desc ? '<div style="font-size:0.8rem;color:var(--yb-muted,#6F6A66);margin-top:0.15rem">' + esc(desc) + '</div>' : '') +
        '</div>' +
        '<div style="display:flex;gap:0.35rem;flex-shrink:0">' +
          '<button class="yb-btn yb-btn--outline yb-btn--small" data-action="edit-doc" data-id="' + esc(d.id) + '">' + esc(t('edit')) + '</button>' +
          '<button class="yb-btn yb-btn--outline yb-btn--small" data-action="delete-doc" data-id="' + esc(d.id) + '" style="color:#dc3545;border-color:#dc3545">' + esc(t('delete')) + '</button>' +
        '</div>' +
      '</div>';
    }).join('');

    container.innerHTML = html;
  }

  // ── Show form ──
  function showDocForm(docId) {
    state.docId = docId || null;
    var doc = null;
    if (docId) {
      doc = state.documents.find(function(d) { return d.id === docId; });
    }

    $('yb-doc-id').value = docId || '';
    $('yb-doc-title-da').value = doc ? (doc.title_da || '') : '';
    $('yb-doc-title-en').value = doc ? (doc.title_en || '') : '';
    $('yb-doc-desc-da').value = doc ? (doc.description_da || '') : '';
    $('yb-doc-desc-en').value = doc ? (doc.description_en || '') : '';
    $('yb-doc-url').value = doc ? (doc.fileUrl || '') : '';
    $('yb-doc-category').value = doc ? (doc.category || 'manual') : 'manual';
    $('yb-doc-order').value = doc ? (doc.order || 1) : (state.documents.length + 1);

    // Reset permission checkboxes
    var permIds = ['100h', '200h', '300h', '500h', 'triangle', 'vinyasa'];
    var docPerms = doc ? (doc.requiredPermissions || []) : [];
    permIds.forEach(function(p) {
      var cb = $('yb-doc-perm-' + p);
      if (cb) cb.checked = docPerms.indexOf(cb.value) !== -1;
    });

    // Reset browser state
    closeBrowser();

    showView('form');
  }

  // ── Build permissions array from checkboxes ──
  function buildPermissions() {
    var perms = [];
    var ids = ['100h', '200h', '300h', '500h', 'triangle', 'vinyasa'];
    ids.forEach(function(p) {
      var cb = $('yb-doc-perm-' + p);
      if (cb && cb.checked) perms.push(cb.value);
    });
    return perms;
  }

  // ── Save document ──
  function saveDocument(e) {
    e.preventDefault();
    var docId = $('yb-doc-id').value;
    var titleDa = $('yb-doc-title-da').value.trim();
    var titleEn = $('yb-doc-title-en').value.trim();

    if (!titleDa && !titleEn) return;

    var perms = buildPermissions();

    // Extract program and method from permissions
    var program = null, method = null;
    perms.forEach(function(p) {
      if (p.indexOf('materials:') === 0) program = p.replace('materials:', '');
      if (p.indexOf('method:') === 0) method = p.replace('method:', '');
    });

    var data = {
      title_da: titleDa,
      title_en: titleEn,
      description_da: $('yb-doc-desc-da').value.trim(),
      description_en: $('yb-doc-desc-en').value.trim(),
      fileUrl: $('yb-doc-url').value.trim(),
      category: $('yb-doc-category').value,
      order: parseInt($('yb-doc-order').value, 10) || 1,
      requiredPermissions: perms,
      program: program,
      method: method,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    // Generate ID from title if new
    if (!docId) {
      docId = (titleDa || titleEn).toLowerCase()
        .replace(/[æ]/g, 'ae').replace(/[ø]/g, 'oe').replace(/[å]/g, 'aa')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    }

    db.collection('documents').doc(docId).set(data, { merge: true })
      .then(function() {
        toast(t('saved'));
        loadDocuments();
        showView('list');
      })
      .catch(function(err) {
        console.error('Error saving document:', err);
        toast(t('error_save'), true);
      });
  }

  // ── Delete document ──
  function deleteDocument(docId) {
    if (!confirm(t('doc_confirm_delete'))) return;
    db.collection('documents').doc(docId).delete()
      .then(function() {
        toast(t('saved'));
        loadDocuments();
      })
      .catch(function(err) {
        console.error('Error deleting document:', err);
        toast(t('error_save'), true);
      });
  }

  // ═══════════════════════════════════
  // CLOUDINARY FILE BROWSER
  // ═══════════════════════════════════

  var browserOpen = false;
  var browserPath = 'yoga-bible-DK/materials';
  var browserFolders = [];
  var browserResources = [];
  var browserLoaded = false;

  var FOLDER_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
  var FILE_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB'];
    var i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
  }

  function getAuthHeaders() {
    return firebase.auth().currentUser.getIdToken().then(function(token) {
      return { 'Authorization': 'Bearer ' + token };
    });
  }

  function toggleBrowser() {
    browserOpen = !browserOpen;
    var panel = $('yb-doc-browser');
    if (panel) panel.hidden = !browserOpen;
    if (browserOpen && !browserLoaded) {
      loadBrowserContents();
    }
  }

  function closeBrowser() {
    browserOpen = false;
    browserLoaded = false;
    browserPath = 'yoga-bible-DK/materials';
    browserFolders = [];
    browserResources = [];
    var panel = $('yb-doc-browser');
    if (panel) panel.hidden = true;
    var search = $('yb-doc-browser-search');
    if (search) search.value = '';
  }

  function loadBrowserContents(path) {
    if (path) browserPath = path;
    var container = $('yb-doc-browser-list');
    if (!container) return;
    container.innerHTML = '<div class="yb-doc-browser__empty">' + esc(t('loading')) + '</div>';

    getAuthHeaders().then(function(headers) {
      return Promise.all([
        fetch('/.netlify/functions/cloudinary-browser?action=folders&path=' + encodeURIComponent(browserPath), { headers: headers }).then(function(r) { return r.json(); }),
        fetch('/.netlify/functions/cloudinary-browser?action=resources&path=' + encodeURIComponent(browserPath), { headers: headers }).then(function(r) { return r.json(); })
      ]);
    }).then(function(results) {
      browserFolders = results[0].ok ? results[0].folders : [];
      browserResources = results[1].ok ? results[1].resources : [];
      browserLoaded = true;
      renderBrowser();
    }).catch(function(err) {
      console.error('Browser load error:', err);
      container.innerHTML = '<div class="yb-doc-browser__empty" style="color:#dc3545">' + esc(t('error_load')) + '</div>';
    });
  }

  function renderBreadcrumb() {
    var bc = $('yb-doc-breadcrumb');
    if (!bc) return;
    // Split path: yoga-bible-DK / materials / subfolder
    var parts = browserPath.split('/');
    var html = '';
    var cumPath = '';

    for (var i = 0; i < parts.length; i++) {
      if (i > 0) {
        cumPath += '/';
        html += '<span class="yb-doc-browser__bc-sep">/</span>';
      }
      cumPath += parts[i];

      // Only make folders from "materials" onward clickable
      if (i >= 1 && i < parts.length - 1) {
        html += '<a href="#" class="yb-doc-browser__bc-link" data-action="browse-path" data-path="' + esc(cumPath) + '">' + esc(parts[i]) + '</a>';
      } else if (i < 1) {
        // "yoga-bible-DK" — just show as text
        html += '<span style="color:var(--yb-muted,#6F6A66)">' + esc(parts[i]) + '</span>';
      } else {
        // Current (last) segment
        html += '<span class="yb-doc-browser__bc-current">' + esc(parts[i]) + '</span>';
      }
    }
    bc.innerHTML = html;
  }

  function renderBrowser() {
    renderBreadcrumb();
    var container = $('yb-doc-browser-list');
    if (!container) return;

    var searchTerm = ($('yb-doc-browser-search') || {}).value || '';
    searchTerm = searchTerm.toLowerCase().trim();

    var html = '';

    // Render folders first
    for (var i = 0; i < browserFolders.length; i++) {
      var f = browserFolders[i];
      var fName = f.name || f.path.split('/').pop();
      if (searchTerm && fName.toLowerCase().indexOf(searchTerm) === -1) continue;

      html += '<div class="yb-doc-browser__item" data-action="browse-path" data-path="' + esc(f.path) + '">' +
        '<div class="yb-doc-browser__item-icon yb-doc-browser__item-icon--folder">' + FOLDER_ICON + '</div>' +
        '<div class="yb-doc-browser__item-body">' +
          '<div class="yb-doc-browser__item-name">' + esc(fName) + '</div>' +
        '</div>' +
      '</div>';
    }

    // Render files
    for (var j = 0; j < browserResources.length; j++) {
      var r = browserResources[j];
      var fileName = r.public_id.split('/').pop();
      if (r.format) fileName += '.' + r.format;
      if (searchTerm && fileName.toLowerCase().indexOf(searchTerm) === -1) continue;

      var date = r.created_at ? new Date(r.created_at).toLocaleDateString() : '';
      var size = formatBytes(r.bytes);

      html += '<div class="yb-doc-browser__item" data-action="select-file" data-url="' + esc(r.secure_url) + '">' +
        '<div class="yb-doc-browser__item-icon yb-doc-browser__item-icon--file">' + FILE_ICON + '</div>' +
        '<div class="yb-doc-browser__item-body">' +
          '<div class="yb-doc-browser__item-name">' + esc(fileName) + '</div>' +
          '<div class="yb-doc-browser__item-meta">' + esc(size) + (date ? ' · ' + esc(date) : '') + '</div>' +
        '</div>' +
      '</div>';
    }

    if (!html) {
      var emptyMsg = searchTerm ? t('doc_browser_no_match') : t('doc_browser_empty');
      html = '<div class="yb-doc-browser__empty">' + esc(emptyMsg) + '</div>';
    }

    container.innerHTML = html;
  }

  function selectFile(url) {
    var urlInput = $('yb-doc-url');
    if (urlInput) urlInput.value = url;
    closeBrowser();
    toast(t('doc_file_selected'));
  }

  function filterBrowser() {
    renderBrowser();
  }

  function uploadFile(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      toast(t('doc_upload_pdf_only'), true);
      return;
    }

    var progressWrap = $('yb-doc-upload-progress');
    var progressFill = $('yb-doc-progress-fill');
    var progressText = $('yb-doc-progress-text');
    if (progressWrap) progressWrap.hidden = false;
    if (progressFill) progressFill.style.width = '0%';
    if (progressText) progressText.textContent = t('doc_uploading');

    getAuthHeaders().then(function(headers) {
      return fetch('/.netlify/functions/cloudinary-browser?action=sign_upload&folder=' + encodeURIComponent(browserPath), {
        headers: headers
      }).then(function(r) { return r.json(); });
    }).then(function(data) {
      if (!data.ok) throw new Error(data.error || 'Sign failed');
      var params = data.upload_params;

      var fd = new FormData();
      fd.append('file', file);
      fd.append('timestamp', params.timestamp);
      fd.append('signature', params.signature);
      fd.append('api_key', params.api_key);
      fd.append('folder', params.folder);

      var xhr = new XMLHttpRequest();
      xhr.open('POST', 'https://api.cloudinary.com/v1_1/' + params.cloud_name + '/' + params.resource_type + '/upload');

      xhr.upload.addEventListener('progress', function(e) {
        if (e.lengthComputable) {
          var pct = Math.round((e.loaded / e.total) * 100);
          if (progressFill) progressFill.style.width = pct + '%';
          if (progressText) progressText.textContent = pct + '%';
        }
      });

      xhr.onload = function() {
        if (progressWrap) progressWrap.hidden = true;
        if (xhr.status === 200) {
          var result = JSON.parse(xhr.responseText);
          selectFile(result.secure_url);
          // Re-open browser to show the new file
          browserLoaded = false;
          toast(t('doc_uploaded'));
        } else {
          console.error('Upload failed:', xhr.status, xhr.responseText);
          toast(t('doc_upload_error'), true);
        }
      };

      xhr.onerror = function() {
        if (progressWrap) progressWrap.hidden = true;
        toast(t('doc_upload_error'), true);
      };

      xhr.send(fd);
    }).catch(function(err) {
      if (progressWrap) progressWrap.hidden = true;
      console.error('Upload error:', err);
      toast(t('doc_upload_error'), true);
    });
  }

  // ── Event delegation ──
  document.addEventListener('click', function(e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var action = el.getAttribute('data-action');

    switch (action) {
      case 'new-doc':
        showDocForm();
        break;
      case 'edit-doc':
        showDocForm(el.getAttribute('data-id'));
        break;
      case 'delete-doc':
        deleteDocument(el.getAttribute('data-id'));
        break;
      case 'back-docs':
        e.preventDefault();
        showView('list');
        break;
      case 'toggle-browser':
        toggleBrowser();
        break;
      case 'browse-path':
        e.preventDefault();
        loadBrowserContents(el.getAttribute('data-path'));
        break;
      case 'select-file':
        e.preventDefault();
        selectFile(el.getAttribute('data-url'));
        break;
    }
  });

  // ── Form submit ──
  var form = $('yb-doc-form');
  if (form) form.addEventListener('submit', saveDocument);

  // ── Browser search input ──
  var searchInput = $('yb-doc-browser-search');
  if (searchInput) searchInput.addEventListener('input', filterBrowser);

  // ── Browser file upload input ──
  var fileInput = $('yb-doc-browser-file');
  if (fileInput) fileInput.addEventListener('change', function() {
    if (fileInput.files.length) uploadFile(fileInput.files[0]);
    fileInput.value = '';
  });

  // ── Init: wait for Firebase, load when Documents tab is shown ──
  var initInterval = setInterval(function() {
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
      clearInterval(initInterval);
      db = firebase.firestore();

      // Load documents when the Documents tab panel becomes visible
      var panel = document.querySelector('[data-yb-admin-panel="documents"]');
      if (panel) {
        var observer = new MutationObserver(function() {
          if (panel.classList.contains('is-active') || !panel.hidden) {
            loadDocuments();
            observer.disconnect();
          }
        });
        observer.observe(panel, { attributes: true, attributeFilter: ['class', 'hidden'] });

        // Check if already active
        if (panel.classList.contains('is-active')) {
          loadDocuments();
        }
      }
    }
  }, 100);

  console.log('✅ Document Admin module loaded');
})();
