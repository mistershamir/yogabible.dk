/**
 * YOGA BIBLE — DOCUMENT ADMIN
 * Full CRUD for training documents stored in Firestore 'documents' collection.
 * Features: search, category filter, permission filter, active toggle, edit, delete.
 */
(function() {
  'use strict';

  var db, lang, state = {
    documents: [],
    docId: null,
    filterSearch: '',
    filterCat: 'all',
    filterPerm: 'all'
  };

  // ── Helpers ──
  function $(id) { return document.getElementById(id); }
  function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function isDa() { return window.location.pathname.indexOf('/en/') !== 0; }
  function t(k) { var T = window._ybDocAdminT || {}; return T[k] || k; }

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
    document.querySelectorAll('#yb-doc-v-list, #yb-doc-v-form').forEach(function(v) { v.hidden = true; });
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
    var countEl = $('yb-doc-count');
    if (!container) return;

    var search = state.filterSearch.toLowerCase();
    var catFilter = state.filterCat;
    var permFilter = state.filterPerm;

    var docs = state.documents.filter(function(d) {
      if (catFilter !== 'all' && d.category !== catFilter) return false;
      if (permFilter !== 'all') {
        var perms = d.requiredPermissions || [];
        if (perms.indexOf(permFilter) === -1) return false;
      }
      if (search) {
        var haystack = ((d.title_da || '') + ' ' + (d.title_en || '') + ' ' + (d.description_da || '') + ' ' + (d.description_en || '')).toLowerCase();
        if (haystack.indexOf(search) === -1) return false;
      }
      return true;
    });

    if (countEl) countEl.textContent = t('doc_count').replace('{n}', docs.length);

    if (!docs.length) {
      container.innerHTML = '<p style="color:var(--yb-muted,#6F6A66);text-align:center;padding:2rem 0">' + esc(t('doc_no_documents')) + '</p>';
      return;
    }

    var PERM_COLORS = {
      'materials:100h': '#8b5cf6',
      'materials:200h': '#f75c03',
      'materials:300h': '#0891b2',
      'materials:500h': '#059669',
      'method:triangle': '#d97706',
      'method:vinyasa':  '#db2777'
    };
    var PERM_LABELS = {
      'materials:100h': '100h', 'materials:200h': '200h',
      'materials:300h': '300h', 'materials:500h': '500h',
      'method:triangle': 'Triangle', 'method:vinyasa': 'Vinyasa'
    };
    var CAT_LABELS = {
      manual: t('doc_cat_manual'), workbook: t('doc_cat_workbook'),
      reference: t('doc_cat_reference'), schedule: t('doc_cat_schedule')
    };

    var html = docs.map(function(d) {
      var title = isDa() ? (d.title_da || d.title_en) : (d.title_en || d.title_da);
      var desc  = isDa() ? (d.description_da || d.description_en) : (d.description_en || d.description_da);
      var catLabel = CAT_LABELS[d.category] || d.category;
      var isActive = d.active !== false; // default true if field missing
      var isDrive = d.fileUrl && d.fileUrl.indexOf('drive.google.com') !== -1;

      // Permission badges
      var permBadges = (d.requiredPermissions || []).map(function(p) {
        var color = PERM_COLORS[p] || '#6F6A66';
        var label = PERM_LABELS[p] || p;
        return '<span style="display:inline-block;padding:0.1rem 0.45rem;border-radius:4px;background:' + color + '1a;color:' + color + ';font-size:0.7rem;font-weight:700;border:1px solid ' + color + '33">' + esc(label) + '</span>';
      }).join(' ');

      var noPerms = !(d.requiredPermissions || []).length
        ? '<span style="font-size:0.72rem;color:var(--yb-muted,#6F6A66);font-style:italic">' + esc(t('doc_perm_none')) + '</span>'
        : '';

      // Active toggle switch
      var toggleChecked = isActive ? 'checked' : '';
      var toggleSwitch =
        '<label class="yb-toggle yb-toggle--sm" title="' + esc(isActive ? t('doc_field_active') : t('doc_inactive_badge')) + '">' +
          '<input type="checkbox" class="yb-doc-active-toggle" data-id="' + esc(d.id) + '" ' + toggleChecked + '>' +
          '<span class="yb-toggle__track"></span>' +
        '</label>';

      // URL source icon
      var sourceIcon = isDrive
        ? '<span title="Google Drive" style="font-size:0.7rem;padding:0.15rem 0.4rem;background:#e8f4fd;color:#1a73e8;border-radius:4px;font-weight:600">Drive</span>'
        : '<span title="Cloudinary" style="font-size:0.7rem;padding:0.15rem 0.4rem;background:rgba(247,92,3,0.08);color:var(--yb-brand,#f75c03);border-radius:4px;font-weight:600">CDN</span>';

      return '<div style="display:flex;align-items:center;gap:0.75rem;padding:0.9rem 1rem;border:1px solid var(--yb-border,#E8E4E0);border-radius:12px;margin-bottom:0.5rem;background:' + (isActive ? '#fff' : '#fafafa') + ';opacity:' + (isActive ? '1' : '0.65') + '">' +
        // Doc icon
        '<div style="width:38px;height:38px;border-radius:9px;background:var(--yb-light-bg,#F5F3F0);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--yb-brand,#f75c03)">' +
          '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
        '</div>' +
        // Main info
        '<div style="flex:1;min-width:0">' +
          '<div style="font-weight:600;font-size:0.9rem;margin-bottom:0.2rem">' + esc(title) +
            (isActive ? '' : ' <span style="font-size:0.72rem;color:#dc3545;font-weight:400">(' + esc(t('doc_inactive_badge')) + ')</span>') +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:0.3rem;flex-wrap:wrap;margin-bottom:' + (desc ? '0.2rem' : '0') + '">' +
            '<span style="display:inline-block;padding:0.1rem 0.45rem;border-radius:4px;background:rgba(247,92,3,0.1);color:var(--yb-brand,#f75c03);font-size:0.7rem;font-weight:600">' + esc(catLabel) + '</span>' +
            permBadges + noPerms +
            (d.fileUrl ? sourceIcon : '') +
          '</div>' +
          (desc ? '<div style="font-size:0.78rem;color:var(--yb-muted,#6F6A66);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(desc) + '</div>' : '') +
        '</div>' +
        // Controls
        '<div style="display:flex;align-items:center;gap:0.5rem;flex-shrink:0">' +
          toggleSwitch +
          '<button class="yb-btn yb-btn--outline yb-btn--small" data-action="edit-doc" data-id="' + esc(d.id) + '">' + esc(t('edit')) + '</button>' +
          '<button class="yb-btn yb-btn--outline yb-btn--small" data-action="delete-doc" data-id="' + esc(d.id) + '" style="color:#dc3545;border-color:#dc3545">&#x1F5D1;</button>' +
        '</div>' +
      '</div>';
    }).join('');

    container.innerHTML = html;

    // Wire up active toggles
    container.querySelectorAll('.yb-doc-active-toggle').forEach(function(toggle) {
      toggle.addEventListener('change', function() {
        var docId = toggle.getAttribute('data-id');
        var active = toggle.checked;
        db.collection('documents').doc(docId).update({ active: active, updatedAt: firebase.firestore.FieldValue.serverTimestamp() })
          .then(function() {
            toast(active ? t('doc_toggle_on') : t('doc_toggle_off'));
            var doc = state.documents.find(function(d) { return d.id === docId; });
            if (doc) doc.active = active;
            renderDocList();
          })
          .catch(function(err) {
            console.error('Toggle error:', err);
            toggle.checked = !active; // revert
            toast(t('error_save'), true);
          });
      });
    });
  }

  // ── Show form ──
  function showDocForm(docId) {
    state.docId = docId || null;
    var doc = docId ? state.documents.find(function(d) { return d.id === docId; }) : null;

    $('yb-doc-id').value = docId || '';
    $('yb-doc-title-da').value = doc ? (doc.title_da || '') : '';
    $('yb-doc-title-en').value = doc ? (doc.title_en || '') : '';
    $('yb-doc-desc-da').value = doc ? (doc.description_da || '') : '';
    $('yb-doc-desc-en').value = doc ? (doc.description_en || '') : '';
    $('yb-doc-url').value = doc ? (doc.fileUrl || '') : '';
    $('yb-doc-category').value = doc ? (doc.category || 'manual') : 'manual';
    $('yb-doc-order').value = doc ? (doc.order || 1) : (state.documents.length + 1);
    if ($('yb-doc-active')) $('yb-doc-active').checked = doc ? (doc.active !== false) : true;

    // Drive hint
    var gdriveHint = $('yb-doc-gdrive-hint');
    if (gdriveHint) {
      gdriveHint.style.display = (doc && doc.fileUrl && doc.fileUrl.indexOf('drive.google.com') !== -1) ? 'block' : 'none';
    }

    // Permissions
    ['100h', '200h', '300h', '500h', 'triangle', 'vinyasa'].forEach(function(p) {
      var cb = $('yb-doc-perm-' + p);
      if (cb) cb.checked = (doc && doc.requiredPermissions || []).indexOf(cb.value) !== -1;
    });

    closeBrowser();
    showView('form');
  }

  // ── Build permissions array ──
  function buildPermissions() {
    var perms = [];
    ['100h', '200h', '300h', '500h', 'triangle', 'vinyasa'].forEach(function(p) {
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
      active: $('yb-doc-active') ? $('yb-doc-active').checked : true,
      requiredPermissions: perms,
      program: program,
      method: method,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

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
        console.error('Save error:', err);
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
        console.error('Delete error:', err);
        toast(t('error_save'), true);
      });
  }

  // ═════════════════════════════════════
  // CLOUDINARY FILE BROWSER
  // ═════════════════════════════════════
  var browserOpen = false, browserPath = 'yoga-bible-DK/materials';
  var browserFolders = [], browserResources = [], browserLoaded = false;

  var FOLDER_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
  var FILE_ICON  = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';

  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    var u = ['B','KB','MB','GB'], i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + u[i];
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
    if (browserOpen && !browserLoaded) loadBrowserContents();
  }

  function closeBrowser() {
    browserOpen = false; browserLoaded = false;
    browserPath = 'yoga-bible-DK/materials';
    browserFolders = []; browserResources = [];
    var panel = $('yb-doc-browser');
    if (panel) panel.hidden = true;
    var s = $('yb-doc-browser-search');
    if (s) s.value = '';
  }

  function loadBrowserContents(path) {
    if (path) browserPath = path;
    var container = $('yb-doc-browser-list');
    if (!container) return;
    container.innerHTML = '<div class="yb-doc-browser__empty">' + esc(t('loading')) + '</div>';

    getAuthHeaders().then(function(headers) {
      return Promise.all([
        fetch('/.netlify/functions/bunny-browser?action=folders&path=' + encodeURIComponent(browserPath), { headers: headers }).then(function(r) { return r.json(); }),
        fetch('/.netlify/functions/bunny-browser?action=resources&path=' + encodeURIComponent(browserPath), { headers: headers }).then(function(r) { return r.json(); })
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
    var parts = browserPath.split('/'), html = '', cumPath = '';
    for (var i = 0; i < parts.length; i++) {
      if (i > 0) { cumPath += '/'; html += '<span class="yb-doc-browser__bc-sep">/</span>'; }
      cumPath += parts[i];
      if (i >= 1 && i < parts.length - 1) {
        html += '<a href="#" class="yb-doc-browser__bc-link" data-action="browse-path" data-path="' + esc(cumPath) + '">' + esc(parts[i]) + '</a>';
      } else if (i < 1) {
        html += '<span style="color:var(--yb-muted,#6F6A66)">' + esc(parts[i]) + '</span>';
      } else {
        html += '<span class="yb-doc-browser__bc-current">' + esc(parts[i]) + '</span>';
      }
    }
    bc.innerHTML = html;
  }

  function renderBrowser() {
    renderBreadcrumb();
    var container = $('yb-doc-browser-list');
    if (!container) return;
    var searchTerm = (($('yb-doc-browser-search') || {}).value || '').toLowerCase().trim();
    var html = '';

    browserFolders.forEach(function(f) {
      var fName = f.name || f.path.split('/').pop();
      if (searchTerm && fName.toLowerCase().indexOf(searchTerm) === -1) return;
      html += '<div class="yb-doc-browser__item" data-action="browse-path" data-path="' + esc(f.path) + '">' +
        '<div class="yb-doc-browser__item-icon yb-doc-browser__item-icon--folder">' + FOLDER_ICON + '</div>' +
        '<div class="yb-doc-browser__item-body"><div class="yb-doc-browser__item-name">' + esc(fName) + '</div></div></div>';
    });

    browserResources.forEach(function(r) {
      var fileName = r.public_id.split('/').pop() + (r.format ? '.' + r.format : '');
      if (searchTerm && fileName.toLowerCase().indexOf(searchTerm) === -1) return;
      var date = r.created_at ? new Date(r.created_at).toLocaleDateString() : '';
      html += '<div class="yb-doc-browser__item" data-action="select-file" data-url="' + esc(r.secure_url) + '">' +
        '<div class="yb-doc-browser__item-icon yb-doc-browser__item-icon--file">' + FILE_ICON + '</div>' +
        '<div class="yb-doc-browser__item-body"><div class="yb-doc-browser__item-name">' + esc(fileName) + '</div>' +
        '<div class="yb-doc-browser__item-meta">' + esc(formatBytes(r.bytes)) + (date ? ' · ' + esc(date) : '') + '</div></div></div>';
    });

    if (!html) html = '<div class="yb-doc-browser__empty">' + esc(searchTerm ? t('doc_browser_no_match') : t('doc_browser_empty')) + '</div>';
    container.innerHTML = html;
  }

  function selectFile(url) {
    var urlInput = $('yb-doc-url');
    if (urlInput) urlInput.value = url;
    closeBrowser();
    toast(t('doc_file_selected'));
  }

  function uploadFile(file) {
    if (!file || !file.name.toLowerCase().endsWith('.pdf')) { toast(t('doc_upload_pdf_only'), true); return; }
    var progressWrap = $('yb-doc-upload-progress');
    var progressFill = $('yb-doc-progress-fill');
    var progressText = $('yb-doc-progress-text');
    if (progressWrap) progressWrap.hidden = false;
    if (progressFill) progressFill.style.width = '0%';
    if (progressText) progressText.textContent = t('doc_uploading');

    getAuthHeaders().then(function(headers) {
      return fetch('/.netlify/functions/bunny-browser?action=sign_upload&folder=' + encodeURIComponent(browserPath), { headers: headers }).then(function(r) { return r.json(); });
    }).then(function(data) {
      if (!data.ok) throw new Error(data.error || 'Sign failed');
      var p = data.upload_params;
      var uploadUrl = p.upload_url + encodeURIComponent(file.name);
      var xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl);
      xhr.setRequestHeader('AccessKey', p.headers.AccessKey);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.upload.addEventListener('progress', function(e) {
        if (e.lengthComputable) {
          var pct = Math.round((e.loaded / e.total) * 100);
          if (progressFill) progressFill.style.width = pct + '%';
          if (progressText) progressText.textContent = pct + '%';
        }
      });
      xhr.onload = function() {
        if (progressWrap) progressWrap.hidden = true;
        if (xhr.status === 201 || xhr.status === 200) {
          var cdnUrl = p.cdn_base + encodeURIComponent(file.name);
          browserLoaded = false; selectFile(cdnUrl); toast(t('doc_uploaded'));
        } else { toast(t('doc_upload_error'), true); }
      };
      xhr.onerror = function() { if (progressWrap) progressWrap.hidden = true; toast(t('doc_upload_error'), true); };
      xhr.send(file);
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
      case 'new-doc':        showDocForm(); break;
      case 'edit-doc':       showDocForm(el.getAttribute('data-id')); break;
      case 'delete-doc':     deleteDocument(el.getAttribute('data-id')); break;
      case 'back-docs':      e.preventDefault(); showView('list'); break;
      case 'toggle-browser': toggleBrowser(); break;
      case 'browse-path':    e.preventDefault(); loadBrowserContents(el.getAttribute('data-path')); break;
      case 'select-file':    e.preventDefault(); selectFile(el.getAttribute('data-url')); break;
    }

    // Category filter chips
    var chip = e.target.closest('[data-filter-cat]');
    if (chip) {
      document.querySelectorAll('[data-filter-cat]').forEach(function(c) { c.classList.remove('is-active'); });
      chip.classList.add('is-active');
      state.filterCat = chip.getAttribute('data-filter-cat');
      renderDocList();
    }
  });

  // ── Search input ──
  var searchInput = $('yb-doc-search');
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      state.filterSearch = searchInput.value;
      renderDocList();
    });
  }

  // ── Permission filter ──
  var permFilter = $('yb-doc-filter-perm');
  if (permFilter) {
    permFilter.addEventListener('change', function() {
      state.filterPerm = permFilter.value;
      renderDocList();
    });
  }

  // ── Drive hint ──
  var urlInput = $('yb-doc-url');
  var gdriveHint = $('yb-doc-gdrive-hint');
  if (urlInput && gdriveHint) {
    urlInput.addEventListener('input', function() {
      gdriveHint.style.display = urlInput.value.indexOf('drive.google.com') !== -1 ? 'block' : 'none';
    });
  }

  // ── Seed: Check status button ──
  var seedPreviewBtn = $('yb-doc-seed-preview-btn');
  var seedBtn        = $('yb-doc-seed-btn');
  var seedPreview    = $('yb-doc-seed-preview');
  var seedTable      = $('yb-doc-seed-table');
  var seedStatus     = $('yb-doc-seed-status');

  function renderSeedTable(materials) {
    if (!seedTable) return;
    var hasMissing = materials.some(function(m) { return !m.exists; });
    if (seedBtn) seedBtn.disabled = !hasMissing;

    var catLabels = {
      manual: t('doc_cat_manual'), workbook: t('doc_cat_workbook'),
      reference: t('doc_cat_reference'), schedule: t('doc_cat_schedule')
    };

    var rows = materials.map(function(m) {
      var statusColor = m.exists ? 'green' : '#f75c03';
      var statusLabel = m.exists ? t('doc_seed_status_exists') : t('doc_seed_status_missing');
      var perms = (m.requiredPermissions || []).map(function(p) {
        return '<span style="font-size:0.68rem;padding:0.1rem 0.35rem;background:rgba(247,92,3,0.1);color:var(--yb-brand,#f75c03);border-radius:4px">' + esc(p) + '</span>';
      }).join(' ');
      return '<tr style="border-bottom:1px solid var(--yb-border,#E8E4E0)">' +
        '<td style="padding:0.5rem 0.25rem;font-size:0.82rem;font-weight:600">' + esc(m.title_en) + '</td>' +
        '<td style="padding:0.5rem 0.4rem;font-size:0.78rem;color:var(--yb-muted,#6F6A66)">' + esc(catLabels[m.category] || m.category) + '</td>' +
        '<td style="padding:0.5rem 0.4rem">' + perms + '</td>' +
        '<td style="padding:0.5rem 0.25rem;font-size:0.78rem;font-weight:600;color:' + statusColor + ';white-space:nowrap">' + esc(statusLabel) + '</td>' +
      '</tr>';
    }).join('');

    seedTable.innerHTML = '<table style="width:100%;border-collapse:collapse">' +
      '<thead><tr style="border-bottom:2px solid var(--yb-border,#E8E4E0)">' +
        '<th style="text-align:left;padding:0.3rem 0.25rem;font-size:0.75rem;color:var(--yb-muted,#6F6A66);font-weight:600">Title</th>' +
        '<th style="text-align:left;padding:0.3rem 0.4rem;font-size:0.75rem;color:var(--yb-muted,#6F6A66);font-weight:600">Category</th>' +
        '<th style="text-align:left;padding:0.3rem 0.4rem;font-size:0.75rem;color:var(--yb-muted,#6F6A66);font-weight:600">Permissions</th>' +
        '<th style="text-align:left;padding:0.3rem 0.25rem;font-size:0.75rem;color:var(--yb-muted,#6F6A66);font-weight:600">Status</th>' +
      '</tr></thead>' +
      '<tbody>' + rows + '</tbody></table>';

    if (seedPreview) seedPreview.style.display = '';
  }

  if (seedPreviewBtn) {
    seedPreviewBtn.addEventListener('click', function() {
      seedPreviewBtn.disabled = true;
      seedPreviewBtn.textContent = t('doc_seed_checking');
      if (seedStatus) seedStatus.style.display = 'none';

      getAuthHeaders().then(function(headers) {
        return fetch('/.netlify/functions/seed-trainee-materials', { headers: headers });
      }).then(function(r) { return r.json(); }).then(function(data) {
        if (!data.ok) throw new Error(data.error || 'Check failed');
        renderSeedTable(data.materials);
      }).catch(function(err) {
        console.error('[seed check] Error:', err);
        if (seedStatus) { seedStatus.textContent = t('doc_seed_err'); seedStatus.style.color = '#dc3545'; seedStatus.style.display = ''; }
      }).finally(function() {
        seedPreviewBtn.disabled = false;
        seedPreviewBtn.textContent = t('doc_seed_preview');
      });
    });
  }

  if (seedBtn) {
    seedBtn.addEventListener('click', function() {
      seedBtn.disabled = true;
      seedBtn.textContent = t('doc_seed_running');
      if (seedStatus) seedStatus.style.display = 'none';

      getAuthHeaders().then(function(headers) {
        headers['Content-Type'] = 'application/json';
        return fetch('/.netlify/functions/seed-trainee-materials', { method: 'POST', headers: headers });
      }).then(function(r) { return r.json(); }).then(function(data) {
        if (!data.ok) throw new Error(data.error || 'Seed failed');
        var msg = data.created === 0
          ? t('doc_seed_ok_none')
          : t('doc_seed_ok').replace('{created}', data.created).replace('{skipped}', data.skipped);
        if (seedStatus) { seedStatus.textContent = msg; seedStatus.style.color = 'green'; seedStatus.style.display = ''; }
        // Re-check status to refresh the table, then reload list
        getAuthHeaders().then(function(h) {
          return fetch('/.netlify/functions/seed-trainee-materials', { headers: h });
        }).then(function(r) { return r.json(); }).then(function(d) {
          if (d.ok) renderSeedTable(d.materials);
        }).catch(function() {});
        setTimeout(loadDocuments, 1200);
      }).catch(function(err) {
        console.error('[seed] Error:', err);
        if (seedStatus) { seedStatus.textContent = t('doc_seed_err'); seedStatus.style.color = '#dc3545'; seedStatus.style.display = ''; }
        seedBtn.disabled = false;
        seedBtn.textContent = t('doc_seed_btn');
      });
    });
  }

  // ── Form submit ──
  var form = $('yb-doc-form');
  if (form) form.addEventListener('submit', saveDocument);

  // ── Browser inputs ──
  var browserSearch = $('yb-doc-browser-search');
  if (browserSearch) browserSearch.addEventListener('input', function() { renderBrowser(); });
  var fileInput = $('yb-doc-browser-file');
  if (fileInput) fileInput.addEventListener('change', function() { if (fileInput.files.length) uploadFile(fileInput.files[0]); fileInput.value = ''; });

  // ── Init ──
  var initInterval = setInterval(function() {
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
      clearInterval(initInterval);
      db = firebase.firestore();
      var panel = document.querySelector('[data-yb-admin-panel="documents"]');
      if (panel) {
        var observer = new MutationObserver(function() {
          if (panel.classList.contains('is-active') || !panel.hidden) { loadDocuments(); observer.disconnect(); }
        });
        observer.observe(panel, { attributes: true, attributeFilter: ['class', 'hidden'] });
        if (panel.classList.contains('is-active')) loadDocuments();
      }
    }
  }, 100);

  console.log('✅ Document Admin loaded');
})();
