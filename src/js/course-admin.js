/**
 * YOGA BIBLE — COURSE ADMIN
 * Manage courses, modules, chapters (CRUD + bulk import) & enrollments
 * Analytics, student progress, draft/published status, duplicate chapter,
 * rich text toolbar, word count
 */
(function () {
  'use strict';

  /* ═══════════════════════════════════════
     STATE
     ═══════════════════════════════════════ */
  var db, auth;
  var T = {};          // translations
  var lang = 'da';
  var currentUser = null;

  var state = {
    courses: [],
    courseId: null,
    modules: [],
    moduleId: null,
    chapters: [],
    chapterId: null,
    enrollments: [],
    bulkChapters: [],
    users: [],
    userDetailUid: null,
    userDetail: null
  };

  var usersLoaded = false;

  // User management enhanced state
  var userSearchTerm = '';
  var userFilterRole = '';
  var userFilterTier = '';
  var userFilterWaiver = '';
  var userFilterMb = '';
  var selectedUserIds = new Set();
  var selectAllUsers = false;

  /* ═══════════════════════════════════════
     HELPERS
     ═══════════════════════════════════════ */
  function t(k) { return T[k] || k; }
  function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function $(id) { return document.getElementById(id); }
  function slug(str) {
    return str.toLowerCase()
      .replace(/[æ]/g, 'ae').replace(/[ø]/g, 'oe').replace(/[å]/g, 'aa')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 60);
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

  /* ═══════════════════════════════════════
     TAB SWITCHING
     ═══════════════════════════════════════ */
  function initTabs() {
    document.querySelectorAll('[data-yb-admin-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tabName = btn.getAttribute('data-yb-admin-tab');
        // Toggle active on buttons
        document.querySelectorAll('[data-yb-admin-tab]').forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        // Toggle active on panels
        document.querySelectorAll('[data-yb-admin-panel]').forEach(function (p) { p.classList.remove('is-active'); });
        var panel = document.querySelector('[data-yb-admin-panel="' + tabName + '"]');
        if (panel) panel.classList.add('is-active');

        // Load users on first visit
        if (tabName === 'users' && !usersLoaded) {
          loadAllUsers();
          usersLoaded = true;
        }

        // Load analytics when analytics tab is clicked
        if (tabName === 'analytics') {
          loadAnalytics();
        }
      });
    });
  }

  /* ═══════════════════════════════════════
     VIEW SWITCHING
     ═══════════════════════════════════════ */
  function showView(name) {
    document.querySelectorAll('.yb-admin__view').forEach(function (v) { v.hidden = true; });
    var el = $('yb-admin-v-' + name);
    if (el) el.hidden = false;
    updateBreadcrumb();
  }

  function updateBreadcrumb() {
    var bc = $('yb-admin-breadcrumb');
    if (!bc) return;
    var parts = ['<span class="yb-admin__bc-link" data-action="back-courses">' + t('courses_title') + '</span>'];
    if (state.courseId) {
      var c = state.courses.find(function (x) { return x.id === state.courseId; });
      var cName = c ? (c.title_en || c.title_da || state.courseId) : state.courseId;
      parts.push('<span class="yb-admin__bc-link" data-action="select-course" data-id="' + state.courseId + '">' + esc(cName) + '</span>');
    }
    if (state.moduleId) {
      var m = state.modules.find(function (x) { return x.id === state.moduleId; });
      var mName = m ? (m.title_en || m.title_da || state.moduleId) : state.moduleId;
      parts.push('<span class="yb-admin__bc-link" data-action="select-module" data-id="' + state.moduleId + '">' + esc(mName) + '</span>');
    }
    bc.innerHTML = parts.join(' <span class="yb-admin__bc-sep">/</span> ');
  }

  /* ═══════════════════════════════════════
     COURSES
     ═══════════════════════════════════════ */
  function loadCourses() {
    db.collection('courses').get().then(function (snap) {
      state.courses = [];
      snap.forEach(function (doc) { state.courses.push(Object.assign({ id: doc.id }, doc.data())); });
      renderCourseList();
    }).catch(function (err) { console.error(err); toast(t('error_load'), true); });
  }

  function renderCourseList() {
    var el = $('yb-admin-course-list');
    if (!el) return;
    if (!state.courses.length) { el.innerHTML = '<p class="yb-admin__empty">' + t('no_courses') + '</p>'; return; }

    el.innerHTML = state.courses.map(function (c) {
      var courseStatus = c.status || 'published';
      var statusBadgeClass = courseStatus === 'published' ? 'yb-admin__badge--ok' : 'yb-admin__badge--muted';
      var statusLabel = courseStatus === 'published' ? t('status_published') || 'Published' : t('status_draft') || 'Draft';

      return '<div class="yb-admin__card">' +
        '<div class="yb-admin__card-icon">' + (c.icon || '📚') + '</div>' +
        '<div class="yb-admin__card-body">' +
          '<h3>' + esc(c.title_en || c.title_da) + '</h3>' +
          '<p>' + esc(c.description_en || c.description_da || '') + '</p>' +
          (c.program ? '<span class="yb-admin__badge">' + esc(c.program) + '</span> ' : '') +
          '<span class="yb-admin__badge ' + statusBadgeClass + '">' + statusLabel + '</span>' +
        '</div>' +
        '<div class="yb-admin__card-actions">' +
          '<button class="yb-admin__icon-btn" data-action="toggle-course-status" data-id="' + c.id + '" title="' + (courseStatus === 'published' ? (t('set_draft') || 'Set as Draft') : (t('set_published') || 'Publish')) + '">' +
            (courseStatus === 'published' ? '&#9724;' : '&#9654;') +
          '</button>' +
          '<button class="yb-admin__icon-btn" data-action="edit-course" data-id="' + c.id + '" title="' + t('edit') + '">&#9998;</button>' +
          '<button class="yb-admin__icon-btn yb-admin__icon-btn--danger" data-action="delete-course" data-id="' + c.id + '" title="' + t('delete') + '">&times;</button>' +
          '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="select-course" data-id="' + c.id + '">' + t('modules_title') + ' &rarr;</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function showCourseForm(courseId) {
    var c = courseId ? state.courses.find(function (x) { return x.id === courseId; }) : null;
    $('yb-cf-id').value = courseId || '';
    $('yb-cf-title').value = c ? c.title_en || c.title_da || '' : '';
    $('yb-cf-desc').value = c ? c.description_en || c.description_da || '' : '';
    $('yb-cf-icon').value = c ? c.icon || '' : '🧘';
    $('yb-cf-program').value = c ? c.program || '' : '';

    // Status field
    var statusEl = $('yb-cf-status');
    if (statusEl) {
      statusEl.value = c ? (c.status || 'published') : 'published';
    }

    $('yb-admin-course-form-title').textContent = c ? t('edit') + ': ' + (c.title_en || c.title_da) : t('new_course');
    showView('course-form');
  }

  function saveCourse(e) {
    e.preventDefault();
    var title = $('yb-cf-title').value.trim();
    var desc = $('yb-cf-desc').value.trim();
    var id = $('yb-cf-id').value || slug(title || 'course');

    var statusEl = $('yb-cf-status');
    var statusVal = statusEl ? statusEl.value : 'published';

    var data = {
      title_da: title,
      title_en: title,
      description_da: desc,
      description_en: desc,
      icon: $('yb-cf-icon').value.trim() || '📚',
      program: $('yb-cf-program').value.trim(),
      status: statusVal
    };
    if (!$('yb-cf-id').value) data.createdAt = firebase.firestore.FieldValue.serverTimestamp();

    db.collection('courses').doc(id).set(data, { merge: true })
      .then(function () { toast(t('saved')); loadCourses(); showView('courses'); })
      .catch(function (err) { console.error(err); toast(t('error_save'), true); });
  }

  function deleteCourse(courseId) {
    if (!confirm(t('confirm_delete_course'))) return;
    var courseRef = db.collection('courses').doc(courseId);
    courseRef.collection('modules').get().then(function (modSnap) {
      var promises = [];
      modSnap.forEach(function (modDoc) {
        promises.push(
          modDoc.ref.collection('chapters').get().then(function (chapSnap) {
            var batch = db.batch();
            chapSnap.forEach(function (ch) { batch.delete(ch.ref); });
            return batch.commit();
          }).then(function () { return modDoc.ref.delete(); })
        );
      });
      return Promise.all(promises);
    }).then(function () {
      return courseRef.delete();
    }).then(function () {
      state.courseId = null;
      toast(t('saved'));
      loadCourses();
      showView('courses');
    }).catch(function (err) { console.error(err); toast(t('error_save'), true); });
  }

  function selectCourse(courseId) {
    state.courseId = courseId;
    state.moduleId = null;
    loadModules(courseId);
    loadEnrollments(courseId);
    loadStudentProgress(courseId);
    showView('modules');
  }

  /* ═══════════════════════════════════════
     TOGGLE COURSE STATUS (Draft/Published)
     ═══════════════════════════════════════ */
  function toggleCourseStatus(courseId) {
    var c = state.courses.find(function (x) { return x.id === courseId; });
    if (!c) return;
    var currentStatus = c.status || 'published';
    var newStatus = currentStatus === 'published' ? 'draft' : 'published';

    db.collection('courses').doc(courseId).update({ status: newStatus })
      .then(function () {
        c.status = newStatus;
        renderCourseList();
        var label = newStatus === 'published' ? (t('status_published') || 'Published') : (t('status_draft') || 'Draft');
        toast(esc(c.title_en || c.title_da) + ' → ' + label);
      })
      .catch(function (err) { console.error(err); toast(t('error_save'), true); });
  }

  /* ═══════════════════════════════════════
     MODULES
     ═══════════════════════════════════════ */
  function loadModules(courseId) {
    db.collection('courses').doc(courseId).collection('modules').orderBy('order').get()
      .then(function (snap) {
        state.modules = [];
        snap.forEach(function (doc) { state.modules.push(Object.assign({ id: doc.id }, doc.data())); });
        renderModuleList();
        var c = state.courses.find(function (x) { return x.id === courseId; });
        var heading = $('yb-admin-modules-heading');
        if (heading && c) heading.textContent = (c.title_en || c.title_da) + ' — ' + t('modules_title');
      }).catch(function (err) { console.error(err); toast(t('error_load'), true); });
  }

  function renderModuleList() {
    var el = $('yb-admin-module-list');
    if (!el) return;
    if (!state.modules.length) { el.innerHTML = '<p class="yb-admin__empty">' + t('no_modules') + '</p>'; return; }

    el.innerHTML = state.modules.map(function (m, idx) {
      return '<div class="yb-admin__item">' +
        '<span class="yb-admin__item-order">' + (m.order || idx + 1) + '</span>' +
        '<span class="yb-admin__item-icon">' + (m.icon || '📖') + '</span>' +
        '<div class="yb-admin__item-body">' +
          '<strong>' + esc(m.title_en || m.title_da) + '</strong>' +
          '<small>' + esc(m.description_en || m.description_da || '') + '</small>' +
        '</div>' +
        '<div class="yb-admin__item-actions">' +
          '<button class="yb-admin__sm-btn" data-action="move-module" data-id="' + m.id + '" data-dir="-1" ' + (idx === 0 ? 'disabled' : '') + '>&uarr;</button>' +
          '<button class="yb-admin__sm-btn" data-action="move-module" data-id="' + m.id + '" data-dir="1" ' + (idx === state.modules.length - 1 ? 'disabled' : '') + '>&darr;</button>' +
          '<button class="yb-admin__sm-btn" data-action="edit-module" data-id="' + m.id + '">&#9998;</button>' +
          '<button class="yb-admin__sm-btn yb-admin__sm-btn--danger" data-action="delete-module" data-id="' + m.id + '">&times;</button>' +
          '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="select-module" data-id="' + m.id + '">' + t('chapters_title') + ' &rarr;</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function showModuleForm(moduleId) {
    var m = moduleId ? state.modules.find(function (x) { return x.id === moduleId; }) : null;
    $('yb-mf-id').value = moduleId || '';
    $('yb-mf-title').value = m ? m.title_en || m.title_da || '' : '';
    $('yb-mf-desc').value = m ? m.description_en || m.description_da || '' : '';
    $('yb-mf-icon').value = m ? m.icon || '' : '📖';
    $('yb-mf-order').value = m ? m.order || 1 : state.modules.length + 1;
    $('yb-admin-module-form-title').textContent = m ? t('edit') + ': ' + (m.title_en || m.title_da) : t('new_module');
    showView('module-form');
  }

  function saveModule(e) {
    e.preventDefault();
    var title = $('yb-mf-title').value.trim();
    var desc = $('yb-mf-desc').value.trim();
    var id = $('yb-mf-id').value || slug(title || 'module');
    var data = {
      title_da: title,
      title_en: title,
      description_da: desc,
      description_en: desc,
      icon: $('yb-mf-icon').value.trim() || '📖',
      order: parseInt($('yb-mf-order').value, 10) || 1
    };

    db.collection('courses').doc(state.courseId).collection('modules').doc(id).set(data, { merge: true })
      .then(function () { toast(t('saved')); loadModules(state.courseId); showView('modules'); })
      .catch(function (err) { console.error(err); toast(t('error_save'), true); });
  }

  function deleteModule(moduleId) {
    if (!confirm(t('confirm_delete_module'))) return;
    var modRef = db.collection('courses').doc(state.courseId).collection('modules').doc(moduleId);
    modRef.collection('chapters').get().then(function (snap) {
      var batch = db.batch();
      snap.forEach(function (ch) { batch.delete(ch.ref); });
      return batch.commit();
    }).then(function () {
      return modRef.delete();
    }).then(function () {
      toast(t('saved'));
      loadModules(state.courseId);
    }).catch(function (err) { console.error(err); toast(t('error_save'), true); });
  }

  function moveModule(moduleId, dir) {
    var idx = state.modules.findIndex(function (m) { return m.id === moduleId; });
    var swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= state.modules.length) return;

    var batch = db.batch();
    var ref1 = db.collection('courses').doc(state.courseId).collection('modules').doc(state.modules[idx].id);
    var ref2 = db.collection('courses').doc(state.courseId).collection('modules').doc(state.modules[swapIdx].id);
    batch.update(ref1, { order: swapIdx + 1 });
    batch.update(ref2, { order: idx + 1 });
    batch.commit().then(function () { loadModules(state.courseId); })
      .catch(function (err) { console.error(err); toast(t('error_save'), true); });
  }

  function selectModule(moduleId) {
    state.moduleId = moduleId;
    updateBreadcrumb();
    loadChapters(state.courseId, moduleId);
    showView('chapters');
  }

  /* ═══════════════════════════════════════
     CHAPTERS
     ═══════════════════════════════════════ */
  function loadChapters(courseId, moduleId) {
    db.collection('courses').doc(courseId).collection('modules').doc(moduleId)
      .collection('chapters').orderBy('order').get()
      .then(function (snap) {
        state.chapters = [];
        snap.forEach(function (doc) { state.chapters.push(Object.assign({ id: doc.id }, doc.data())); });
        renderChapterList();
        var m = state.modules.find(function (x) { return x.id === moduleId; });
        var heading = $('yb-admin-chapters-heading');
        if (heading && m) heading.textContent = (m.title_en || m.title_da) + ' — ' + t('chapters_title');
      }).catch(function (err) { console.error(err); toast(t('error_load'), true); });
  }

  function renderChapterList() {
    var el = $('yb-admin-chapter-list');
    if (!el) return;
    if (!state.chapters.length) { el.innerHTML = '<p class="yb-admin__empty">' + t('no_chapters') + '</p>'; return; }

    el.innerHTML = state.chapters.map(function (ch, idx) {
      var preview = (ch.content_en || ch.content_da || '').replace(/<[^>]+>/g, '').substring(0, 80);
      return '<div class="yb-admin__item">' +
        '<span class="yb-admin__item-order">' + (ch.order || idx + 1) + '</span>' +
        '<div class="yb-admin__item-body">' +
          '<strong>' + esc(ch.title_en || ch.title_da) + '</strong>' +
          '<small>' + esc(preview) + (preview.length >= 80 ? '...' : '') + '</small>' +
        '</div>' +
        '<div class="yb-admin__item-actions">' +
          '<button class="yb-admin__sm-btn" data-action="move-chapter" data-id="' + ch.id + '" data-dir="-1" ' + (idx === 0 ? 'disabled' : '') + '>&uarr;</button>' +
          '<button class="yb-admin__sm-btn" data-action="move-chapter" data-id="' + ch.id + '" data-dir="1" ' + (idx === state.chapters.length - 1 ? 'disabled' : '') + '>&darr;</button>' +
          '<button class="yb-admin__sm-btn" data-action="duplicate-chapter" data-id="' + ch.id + '" title="' + (t('duplicate') || 'Duplicate') + '">&#9851;</button>' +
          '<button class="yb-admin__sm-btn" data-action="edit-chapter" data-id="' + ch.id + '">&#9998;</button>' +
          '<button class="yb-admin__sm-btn yb-admin__sm-btn--danger" data-action="delete-chapter" data-id="' + ch.id + '">&times;</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function showChapterForm(chapterId) {
    var ch = chapterId ? state.chapters.find(function (x) { return x.id === chapterId; }) : null;
    $('yb-chf-id').value = chapterId || '';
    $('yb-chf-title').value = ch ? ch.title_en || ch.title_da || '' : '';
    $('yb-chf-order').value = ch ? ch.order || 1 : state.chapters.length + 1;
    $('yb-chf-content').value = ch ? ch.content_en || ch.content_da || '' : '';
    $('yb-admin-chapter-form-title').textContent = ch ? t('edit') + ': ' + (ch.title_en || ch.title_da) : t('new_chapter');
    updatePreview();
    updateWordCount();
    showView('chapter-form');
  }

  function saveChapter(e) {
    e.preventDefault();
    var title = $('yb-chf-title').value.trim();
    var content = $('yb-chf-content').value;
    var id = $('yb-chf-id').value || slug(title || 'chapter');
    if (!$('yb-chf-id').value) {
      var orderNum = String($('yb-chf-order').value).padStart(2, '0');
      id = orderNum + '-' + id;
    }
    var data = {
      title_da: title,
      title_en: title,
      order: parseInt($('yb-chf-order').value, 10) || 1,
      content_da: content,
      content_en: content
    };

    db.collection('courses').doc(state.courseId).collection('modules').doc(state.moduleId)
      .collection('chapters').doc(id).set(data, { merge: true })
      .then(function () { toast(t('saved')); loadChapters(state.courseId, state.moduleId); showView('chapters'); })
      .catch(function (err) { console.error(err); toast(t('error_save'), true); });
  }

  function deleteChapter(chapterId) {
    if (!confirm(t('confirm_delete_chapter'))) return;
    db.collection('courses').doc(state.courseId).collection('modules').doc(state.moduleId)
      .collection('chapters').doc(chapterId).delete()
      .then(function () { toast(t('saved')); loadChapters(state.courseId, state.moduleId); })
      .catch(function (err) { console.error(err); toast(t('error_save'), true); });
  }

  function moveChapter(chapterId, dir) {
    var idx = state.chapters.findIndex(function (c) { return c.id === chapterId; });
    var swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= state.chapters.length) return;

    var basePath = db.collection('courses').doc(state.courseId).collection('modules').doc(state.moduleId).collection('chapters');
    var batch = db.batch();
    batch.update(basePath.doc(state.chapters[idx].id), { order: swapIdx + 1 });
    batch.update(basePath.doc(state.chapters[swapIdx].id), { order: idx + 1 });
    batch.commit().then(function () { loadChapters(state.courseId, state.moduleId); })
      .catch(function (err) { console.error(err); toast(t('error_save'), true); });
  }

  function updatePreview() {
    var textarea = $('yb-chf-content');
    var preview = $('yb-admin-preview-body');
    if (textarea && preview) preview.innerHTML = textarea.value;
  }

  /* ═══════════════════════════════════════
     DUPLICATE CHAPTER
     ═══════════════════════════════════════ */
  function duplicateChapter(chapterId) {
    var ch = state.chapters.find(function (x) { return x.id === chapterId; });
    if (!ch) return;

    var newTitle = 'Copy of ' + (ch.title_en || ch.title_da || 'Chapter');
    var maxOrder = 0;
    state.chapters.forEach(function (c) {
      if ((c.order || 0) > maxOrder) maxOrder = c.order || 0;
    });
    var newOrder = maxOrder + 1;
    var orderNum = String(newOrder).padStart(2, '0');
    var newId = orderNum + '-' + slug(newTitle);

    var data = {
      title_da: newTitle,
      title_en: newTitle,
      order: newOrder,
      content_da: ch.content_da || '',
      content_en: ch.content_en || ''
    };

    var basePath = db.collection('courses').doc(state.courseId)
      .collection('modules').doc(state.moduleId).collection('chapters');

    basePath.doc(newId).set(data)
      .then(function () {
        toast(t('duplicated') || 'Duplicated!');
        loadChapters(state.courseId, state.moduleId);
      })
      .catch(function (err) { console.error(err); toast(t('error_save'), true); });
  }

  /* ═══════════════════════════════════════
     RICH TEXT TOOLBAR
     ═══════════════════════════════════════ */
  function insertTag(tag) {
    var textarea = $('yb-chf-content');
    if (!textarea) return;

    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    var selected = textarea.value.substring(start, end);
    var before = textarea.value.substring(0, start);
    var after = textarea.value.substring(end);
    var replacement = '';

    switch (tag) {
      case 'bold':
        replacement = '<strong>' + (selected || t('bold_text') || 'bold text') + '</strong>';
        break;
      case 'italic':
        replacement = '<em>' + (selected || t('italic_text') || 'italic text') + '</em>';
        break;
      case 'h2':
        replacement = '<h2>' + (selected || t('heading') || 'Heading') + '</h2>';
        break;
      case 'h3':
        replacement = '<h3>' + (selected || t('subheading') || 'Subheading') + '</h3>';
        break;
      case 'ul':
        if (selected) {
          var items = selected.split('\n').filter(function (l) { return l.trim(); });
          replacement = '<ul>\n' + items.map(function (item) { return '  <li>' + item.trim() + '</li>'; }).join('\n') + '\n</ul>';
        } else {
          replacement = '<ul>\n  <li>' + (t('list_item') || 'Item') + '</li>\n</ul>';
        }
        break;
      case 'ol':
        if (selected) {
          var items = selected.split('\n').filter(function (l) { return l.trim(); });
          replacement = '<ol>\n' + items.map(function (item) { return '  <li>' + item.trim() + '</li>'; }).join('\n') + '\n</ol>';
        } else {
          replacement = '<ol>\n  <li>' + (t('list_item') || 'Item') + '</li>\n</ol>';
        }
        break;
      case 'quote':
        replacement = '<blockquote>' + (selected || t('quote_text') || 'Quote') + '</blockquote>';
        break;
      case 'link':
        var url = window.prompt(t('enter_url') || 'Enter URL:', 'https://');
        if (!url) return;
        replacement = '<a href="' + url + '">' + (selected || t('link_text') || 'Link text') + '</a>';
        break;
      default:
        return;
    }

    textarea.value = before + replacement + after;
    textarea.focus();

    // Place cursor after the insertion
    var newPos = before.length + replacement.length;
    textarea.selectionStart = newPos;
    textarea.selectionEnd = newPos;

    updatePreview();
    updateWordCount();
  }

  /* ═══════════════════════════════════════
     WORD COUNT
     ═══════════════════════════════════════ */
  function updateWordCount() {
    var textarea = $('yb-chf-content');
    var countEl = $('yb-admin-word-count');
    if (!textarea || !countEl) return;

    var text = textarea.value.replace(/<[^>]+>/g, ' ').trim();
    var words = text ? text.split(/\s+/).length : 0;
    var label = lang === 'da' ? 'ord' : 'words';
    countEl.textContent = words + ' ' + label;
  }

  /* ═══════════════════════════════════════
     BULK IMPORT
     ═══════════════════════════════════════ */
  function textToHtml(text) {
    var lines = text.split('\n');
    var html = '';
    var inList = false;
    var listType = '';

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();

      if (!line) {
        if (inList) { html += '</' + listType + '>\n'; inList = false; }
        continue;
      }

      if (line.match(/^###\s/)) { if (inList) { html += '</' + listType + '>\n'; inList = false; } html += '<h3>' + esc(line.replace(/^###\s*/, '')) + '</h3>\n'; continue; }
      if (line.match(/^##\s/)) { if (inList) { html += '</' + listType + '>\n'; inList = false; } html += '<h2>' + esc(line.replace(/^##\s*/, '')) + '</h2>\n'; continue; }

      if (line.match(/^[-*]\s/)) {
        if (!inList || listType !== 'ul') {
          if (inList) html += '</' + listType + '>\n';
          html += '<ul>\n'; inList = true; listType = 'ul';
        }
        html += '  <li>' + esc(line.replace(/^[-*]\s*/, '')) + '</li>\n';
        continue;
      }

      if (line.match(/^\d+[.)]\s/)) {
        if (!inList || listType !== 'ol') {
          if (inList) html += '</' + listType + '>\n';
          html += '<ol>\n'; inList = true; listType = 'ol';
        }
        html += '  <li>' + esc(line.replace(/^\d+[.)]\s*/, '')) + '</li>\n';
        continue;
      }

      if (inList) { html += '</' + listType + '>\n'; inList = false; }
      html += '<p>' + esc(line) + '</p>\n';
    }

    if (inList) html += '</' + listType + '>\n';
    return html;
  }

  function parseBulk() {
    var text = $('yb-admin-bulk-text').value.trim();
    if (!text) return;

    var splitMode = 'headings';
    document.querySelectorAll('[name="bulk-split"]').forEach(function (r) { if (r.checked) splitMode = r.value; });

    var chunks = [];

    if (splitMode === 'headings') {
      var parts = text.split(/\n(?=##\s|[A-ZÆØÅ][A-ZÆØÅ\s]{3,}$)/m);
      parts.forEach(function (part) {
        part = part.trim();
        if (!part) return;
        var firstLine = part.split('\n')[0].trim();
        var title = firstLine.replace(/^##\s*/, '');
        var body = part.split('\n').slice(1).join('\n').trim();
        chunks.push({ title: title, raw: body });
      });
    } else if (splitMode === 'blank') {
      var parts = text.split(/\n\s*\n\s*\n/);
      parts.forEach(function (part, idx) {
        part = part.trim();
        if (!part) return;
        var firstLine = part.split('\n')[0].trim().replace(/^##\s*/, '');
        var body = part.split('\n').slice(1).join('\n').trim();
        chunks.push({ title: firstLine || ('Chapter ' + (idx + 1)), raw: body || part });
      });
    } else if (splitMode === 'hr') {
      var parts = text.split(/\n-{3,}\n|\n={3,}\n/);
      parts.forEach(function (part, idx) {
        part = part.trim();
        if (!part) return;
        var firstLine = part.split('\n')[0].trim().replace(/^##\s*/, '');
        var body = part.split('\n').slice(1).join('\n').trim();
        chunks.push({ title: firstLine || ('Chapter ' + (idx + 1)), raw: body || part });
      });
    }

    chunks.forEach(function (ch) {
      ch.content = textToHtml(ch.raw);
    });

    state.bulkChapters = chunks;
    renderBulkPreview();
  }

  function renderBulkPreview() {
    var step1 = $('yb-admin-bulk-step1');
    var step2 = $('yb-admin-bulk-step2');
    var count = $('yb-admin-bulk-count');
    var cards = $('yb-admin-bulk-cards');
    if (!state.bulkChapters.length) {
      toast(t('bulk_empty'), true);
      return;
    }

    step1.hidden = true;
    step2.hidden = false;
    count.textContent = state.bulkChapters.length + ' ' + t('bulk_detected');

    cards.innerHTML = state.bulkChapters.map(function (ch, idx) {
      var preview = ch.content.replace(/<[^>]+>/g, '').substring(0, 120);
      return '<div class="yb-admin__bulk-card" data-bulk-idx="' + idx + '">' +
        '<div class="yb-admin__bulk-card-head">' +
          '<span class="yb-admin__bulk-card-num">' + (idx + 1) + '</span>' +
          '<input type="text" class="yb-admin__bulk-card-title" value="' + esc(ch.title) + '" data-bulk-title="' + idx + '">' +
          '<button class="yb-admin__sm-btn yb-admin__sm-btn--danger" data-action="bulk-remove" data-idx="' + idx + '">&times;</button>' +
        '</div>' +
        '<div class="yb-admin__bulk-card-preview">' + esc(preview) + (preview.length >= 120 ? '...' : '') + '</div>' +
      '</div>';
    }).join('');
  }

  function createBulkChapters() {
    if (!state.bulkChapters.length) return;

    document.querySelectorAll('[data-bulk-title]').forEach(function (inp) {
      var idx = parseInt(inp.getAttribute('data-bulk-title'), 10);
      if (state.bulkChapters[idx]) state.bulkChapters[idx].title = inp.value.trim();
    });

    var startOrder = state.chapters.length + 1;
    var basePath = db.collection('courses').doc(state.courseId)
      .collection('modules').doc(state.moduleId).collection('chapters');

    var batch = db.batch();
    state.bulkChapters.forEach(function (ch, idx) {
      var orderNum = String(startOrder + idx).padStart(2, '0');
      var id = orderNum + '-' + slug(ch.title || 'chapter-' + (startOrder + idx));

      batch.set(basePath.doc(id), {
        order: startOrder + idx,
        title_da: ch.title,
        title_en: ch.title,
        content_da: ch.content,
        content_en: ch.content
      });
    });

    var progressEl = $('yb-admin-bulk-progress');
    var statusEl = $('yb-admin-bulk-status');
    var createBtn = $('yb-admin-bulk-create-btn');
    if (createBtn) createBtn.disabled = true;
    if (progressEl) progressEl.hidden = false;
    if (statusEl) statusEl.textContent = t('bulk_creating');

    batch.commit().then(function () {
      var fill = $('yb-admin-bulk-fill');
      if (fill) fill.style.width = '100%';
      if (statusEl) statusEl.textContent = state.bulkChapters.length + ' ' + t('bulk_success');
      toast(state.bulkChapters.length + ' ' + t('bulk_success'));
      state.bulkChapters = [];
      setTimeout(function () {
        loadChapters(state.courseId, state.moduleId);
        showView('chapters');
        $('yb-admin-bulk-step1').hidden = false;
        $('yb-admin-bulk-step2').hidden = true;
        if (progressEl) progressEl.hidden = true;
        if (fill) fill.style.width = '0';
        $('yb-admin-bulk-text').value = '';
        if (createBtn) createBtn.disabled = false;
      }, 1500);
    }).catch(function (err) {
      console.error(err);
      toast(t('error_save'), true);
      if (createBtn) createBtn.disabled = false;
    });
  }

  /* ═══════════════════════════════════════
     ENROLLMENTS
     ═══════════════════════════════════════ */
  function loadEnrollments(courseId) {
    db.collection('enrollments').where('courseId', '==', courseId).get()
      .then(function (snap) {
        state.enrollments = [];
        var userIds = [];
        snap.forEach(function (doc) {
          var data = Object.assign({ id: doc.id }, doc.data());
          state.enrollments.push(data);
          if (data.userId && !data.userName) userIds.push(data.userId);
        });

        // If enrollments lack user info, fetch from users collection
        if (userIds.length) {
          var lookups = userIds.map(function (uid) {
            return db.collection('users').doc(uid).get().then(function (uDoc) {
              if (!uDoc.exists) return;
              var u = uDoc.data();
              state.enrollments.forEach(function (e) {
                if (e.userId === uid) {
                  e.userName = u.name || ((u.firstName || '') + ' ' + (u.lastName || '')).trim() || '';
                  e.userEmail = u.email || '';
                }
              });
            }).catch(function () {}); // skip if can't read
          });
          Promise.all(lookups).then(function () { renderEnrollments(); });
        } else {
          renderEnrollments();
        }
      }).catch(function (err) { console.error(err); });
  }

  function renderEnrollments() {
    var el = $('yb-admin-enroll-list');
    if (!el) return;
    if (!state.enrollments.length) { el.innerHTML = '<p class="yb-admin__empty">' + t('no_enrollments') + '</p>'; return; }

    el.innerHTML = state.enrollments.map(function (e) {
      var statusClass = e.status === 'active' ? 'yb-admin__badge--ok' : 'yb-admin__badge--muted';
      var statusLabel = e.status === 'active' ? t('status_active') : t('status_revoked');
      var displayName = e.userName || '';
      var displayEmail = e.userEmail || '';
      var userLabel = displayName
        ? esc(displayName) + ' <small style="color:#6F6A66">' + esc(displayEmail) + '</small>'
        : esc(displayEmail || e.userId);
      return '<div class="yb-admin__enroll-row">' +
        '<span>' + userLabel + '</span>' +
        '<span class="yb-admin__badge ' + statusClass + '">' + statusLabel + '</span>' +
        (e.status === 'active'
          ? '<button class="yb-admin__sm-btn yb-admin__sm-btn--danger" data-action="revoke-enroll" data-id="' + e.id + '">' + t('revoke_btn') + '</button>'
          : '<button class="yb-admin__sm-btn" data-action="activate-enroll" data-id="' + e.id + '">' + t('enroll_btn') + '</button>') +
      '</div>';
    }).join('');
  }

  function enrollUser(e) {
    e.preventDefault();
    var input = $('yb-admin-enroll-input');
    var val = input.value.trim();
    if (!val || !state.courseId) return;

    var promise;
    if (val.indexOf('@') > -1) {
      promise = db.collection('users').where('email', '==', val).limit(1).get()
        .then(function (snap) {
          if (snap.empty) throw new Error('User not found: ' + val);
          var doc = snap.docs[0];
          var u = doc.data();
          return {
            uid: doc.id,
            name: u.name || ((u.firstName || '') + ' ' + (u.lastName || '')).trim() || '',
            email: u.email || val
          };
        });
    } else {
      promise = Promise.resolve({ uid: val, name: '', email: '' });
    }

    toast('Looking up user...');
    promise.then(function (user) {
      var docId = user.uid + '_' + state.courseId;
      return db.collection('enrollments').doc(docId).set({
        userId: user.uid,
        userName: user.name,
        userEmail: user.email,
        courseId: state.courseId,
        enrolledAt: firebase.firestore.FieldValue.serverTimestamp(),
        enrolledBy: 'admin',
        status: 'active'
      });
    }).then(function () {
      toast(t('saved'));
      input.value = '';
      loadEnrollments(state.courseId);
    }).catch(function (err) {
      console.error('Enroll error:', err);
      var msg = err.message || t('error_save');
      if (msg.indexOf('permission') > -1 || msg.indexOf('Permission') > -1) {
        msg = 'Permission denied — update Firestore rules to allow admin to read users collection';
      }
      toast(msg, true);
    });
  }

  function toggleEnrollment(enrollId, newStatus) {
    db.collection('enrollments').doc(enrollId).update({ status: newStatus })
      .then(function () { toast(t('saved')); loadEnrollments(state.courseId); })
      .catch(function (err) { console.error(err); toast(t('error_save'), true); });
  }

  /* ═══════════════════════════════════════
     USER LOOKUP
     ═══════════════════════════════════════ */
  function lookupUser(e) {
    e.preventDefault();
    var input = $('yb-admin-user-lookup-input');
    var resultEl = $('yb-admin-user-lookup-result');
    var email = input.value.trim();
    if (!email || !resultEl) return;

    resultEl.innerHTML = '<p class="yb-admin__empty">' + t('loading') + '</p>';

    db.collection('users').where('email', '==', email).limit(1).get()
      .then(function (snap) {
        if (snap.empty) {
          resultEl.innerHTML = '<p class="yb-admin__empty">' + t('user_lookup_no_result') + '</p>';
          return;
        }
        var userDoc = snap.docs[0];
        var u = userDoc.data();
        var uid = userDoc.id;
        var name = u.name || ((u.firstName || '') + ' ' + (u.lastName || '')).trim() || '';

        // Find all enrollments for this user
        return db.collection('enrollments').where('userId', '==', uid).get()
          .then(function (enrollSnap) {
            var enrollments = [];
            enrollSnap.forEach(function (doc) { enrollments.push(doc.data()); });

            var html = '<div class="yb-admin__card" style="margin-bottom:1rem">' +
              '<div class="yb-admin__card-body">' +
                '<h3>' + esc(name || email) + '</h3>' +
                '<p>' + esc(u.email || email) + ' &middot; <small style="color:#6F6A66">' + esc(uid) + '</small></p>' +
              '</div>' +
            '</div>';

            if (enrollments.length) {
              html += '<h3 style="font-size:0.95rem;font-weight:700;margin-bottom:0.5rem">' + t('user_lookup_courses') + '</h3>';
              html += enrollments.map(function (en) {
                var course = state.courses.find(function (c) { return c.id === en.courseId; });
                var courseName = course ? (course.title_en || course.title_da) : en.courseId;
                var statusClass = en.status === 'active' ? 'yb-admin__badge--ok' : 'yb-admin__badge--muted';
                var statusLabel = en.status === 'active' ? t('status_active') : t('status_revoked');
                return '<div class="yb-admin__enroll-row">' +
                  '<span>' + (course ? (course.icon || '') + ' ' : '') + esc(courseName) + '</span>' +
                  '<span class="yb-admin__badge ' + statusClass + '">' + statusLabel + '</span>' +
                '</div>';
              }).join('');
            } else {
              html += '<p class="yb-admin__empty">' + t('no_enrollments') + '</p>';
            }

            // Append role editor
            html += renderRoleEditor(uid, u);

            resultEl.innerHTML = html;

            // Bind role form submit
            var roleForm = $('yb-admin-role-form');
            if (roleForm) roleForm.addEventListener('submit', saveUserRole);
          });
      })
      .catch(function (err) {
        console.error('Lookup error:', err);
        resultEl.innerHTML = '<p class="yb-admin__empty" style="color:#dc2626">' + (err.message || t('error_load')) + '</p>';
      });
  }

  /* ═══════════════════════════════════════
     ANALYTICS
     ═══════════════════════════════════════ */
  function loadAnalytics() {
    var statCourses = $('yb-admin-stat-courses');
    var statEnrollments = $('yb-admin-stat-enrollments');
    var statStudents = $('yb-admin-stat-students');
    var statProgress = $('yb-admin-stat-progress');
    var tableEl = $('yb-admin-analytics-courses');

    // Show loading state
    if (statCourses) statCourses.textContent = '...';
    if (statEnrollments) statEnrollments.textContent = '...';
    if (statStudents) statStudents.textContent = '...';
    if (statProgress) statProgress.textContent = '...';
    if (tableEl) tableEl.innerHTML = '<p class="yb-admin__empty">' + t('loading') + '</p>';

    var allCourses = [];
    var allEnrollments = [];
    var allProgress = [];

    // Fetch all courses
    var coursesPromise = db.collection('courses').get().then(function (snap) {
      snap.forEach(function (doc) { allCourses.push(Object.assign({ id: doc.id }, doc.data())); });
    });

    // Fetch all enrollments
    var enrollPromise = db.collection('enrollments').get().then(function (snap) {
      snap.forEach(function (doc) { allEnrollments.push(Object.assign({ id: doc.id }, doc.data())); });
    });

    // Fetch all courseProgress docs
    var progressPromise = db.collection('courseProgress').get().then(function (snap) {
      snap.forEach(function (doc) { allProgress.push(Object.assign({ id: doc.id }, doc.data())); });
    });

    Promise.all([coursesPromise, enrollPromise, progressPromise]).then(function () {
      // Total courses
      var totalCourses = allCourses.length;

      // Active enrollments
      var activeEnrollments = allEnrollments.filter(function (e) { return e.status === 'active'; });
      var totalActive = activeEnrollments.length;

      // Unique active students
      var uniqueStudents = {};
      activeEnrollments.forEach(function (e) {
        if (e.userId) uniqueStudents[e.userId] = true;
      });
      var totalStudents = Object.keys(uniqueStudents).length;

      // Average completion %
      var totalPercent = 0;
      var progressCount = 0;
      allProgress.forEach(function (p) {
        var viewed = p.viewed;
        if (viewed && typeof viewed === 'object') {
          var keys = Object.keys(viewed);
          var total = keys.length;
          var done = 0;
          keys.forEach(function (k) { if (viewed[k]) done++; });
          if (total > 0) {
            totalPercent += (done / total) * 100;
            progressCount++;
          }
        }
      });
      var avgProgress = progressCount > 0 ? Math.round(totalPercent / progressCount) : 0;

      // Render stat cards
      if (statCourses) statCourses.textContent = totalCourses;
      if (statEnrollments) statEnrollments.textContent = totalActive;
      if (statStudents) statStudents.textContent = totalStudents;
      if (statProgress) statProgress.textContent = avgProgress + '%';

      // Per-course stats table
      if (tableEl) {
        if (!allCourses.length) {
          tableEl.innerHTML = '<p class="yb-admin__empty">' + t('no_courses') + '</p>';
          return;
        }

        tableEl.innerHTML = allCourses.map(function (course) {
          // Enrollments for this course
          var courseEnrollments = activeEnrollments.filter(function (e) { return e.courseId === course.id; });
          var enrollCount = courseEnrollments.length;

          // Progress for this course
          var courseProgressDocs = allProgress.filter(function (p) {
            return p.id && p.id.indexOf('_' + course.id) > -1;
          });

          var coursePercent = 0;
          var courseProgressCount = 0;
          var completedCount = 0;
          courseProgressDocs.forEach(function (p) {
            var viewed = p.viewed;
            if (viewed && typeof viewed === 'object') {
              var keys = Object.keys(viewed);
              var total = keys.length;
              var done = 0;
              keys.forEach(function (k) { if (viewed[k]) done++; });
              if (total > 0) {
                var pct = (done / total) * 100;
                coursePercent += pct;
                courseProgressCount++;
                if (pct >= 100) completedCount++;
              }
            }
          });

          var avgCoursePct = courseProgressCount > 0 ? Math.round(coursePercent / courseProgressCount) : 0;
          var completionRate = enrollCount > 0 ? Math.round((completedCount / enrollCount) * 100) : 0;

          return '<div class="yb-admin__analytics-row">' +
            '<span class="yb-admin__analytics-icon">' + (course.icon || '📚') + '</span>' +
            '<span class="yb-admin__analytics-name">' + esc(course.title_en || course.title_da) + '</span>' +
            '<span class="yb-admin__analytics-stat">' + enrollCount + ' ' + (t('enrolled') || 'enrolled') + '</span>' +
            '<span class="yb-admin__analytics-stat">' + avgCoursePct + '% ' + (t('avg_progress') || 'avg') + '</span>' +
            '<span class="yb-admin__analytics-stat">' + completionRate + '% ' + (t('completion') || 'completion') + '</span>' +
          '</div>';
        }).join('');
      }
    }).catch(function (err) {
      console.error('Analytics error:', err);
      toast(t('error_load'), true);
    });
  }

  /* ═══════════════════════════════════════
     STUDENT PROGRESS (per course)
     ═══════════════════════════════════════ */
  function loadStudentProgress(courseId) {
    var el = $('yb-admin-student-progress');
    if (!el) return;

    el.innerHTML = '<p class="yb-admin__empty">' + t('loading') + '</p>';

    // First count total chapters across all modules for this course
    var totalChapters = 0;
    var chaptersPromise = db.collection('courses').doc(courseId).collection('modules').get()
      .then(function (modSnap) {
        var chapterCounts = [];
        modSnap.forEach(function (modDoc) {
          chapterCounts.push(
            modDoc.ref.collection('chapters').get().then(function (chapSnap) {
              totalChapters += chapSnap.size;
            })
          );
        });
        return Promise.all(chapterCounts);
      });

    // Fetch enrollments for this course
    var courseEnrollments = [];
    var enrollPromise = db.collection('enrollments').where('courseId', '==', courseId).get()
      .then(function (snap) {
        snap.forEach(function (doc) {
          var data = Object.assign({ id: doc.id }, doc.data());
          if (data.status === 'active') courseEnrollments.push(data);
        });
      });

    Promise.all([chaptersPromise, enrollPromise]).then(function () {
      if (!courseEnrollments.length) {
        el.innerHTML = '<p class="yb-admin__empty">' + t('no_enrollments') + '</p>';
        return;
      }

      // For each enrolled student, fetch progress
      var progressPromises = courseEnrollments.map(function (enrollment) {
        var progressDocId = enrollment.userId + '_' + courseId;
        return db.collection('courseProgress').doc(progressDocId).get()
          .then(function (pDoc) {
            var chaptersRead = 0;
            var lastActive = null;

            if (pDoc.exists) {
              var pData = pDoc.data();
              var viewed = pData.viewed;
              if (viewed && typeof viewed === 'object') {
                Object.keys(viewed).forEach(function (k) {
                  if (viewed[k]) chaptersRead++;
                });
              }
              if (pData.lastViewed && pData.lastViewed.toDate) {
                lastActive = pData.lastViewed.toDate();
              } else if (pData.updatedAt && pData.updatedAt.toDate) {
                lastActive = pData.updatedAt.toDate();
              }
            }

            // Get user name from enrollment or users collection
            var namePromise;
            if (enrollment.userName) {
              namePromise = Promise.resolve({
                name: enrollment.userName,
                email: enrollment.userEmail || ''
              });
            } else {
              namePromise = db.collection('users').doc(enrollment.userId).get()
                .then(function (uDoc) {
                  if (!uDoc.exists) return { name: '', email: '' };
                  var u = uDoc.data();
                  return {
                    name: u.name || ((u.firstName || '') + ' ' + (u.lastName || '')).trim() || '',
                    email: u.email || ''
                  };
                }).catch(function () { return { name: '', email: '' }; });
            }

            return namePromise.then(function (userInfo) {
              return {
                userId: enrollment.userId,
                name: userInfo.name,
                email: userInfo.email,
                chaptersRead: chaptersRead,
                totalChapters: totalChapters,
                lastActive: lastActive
              };
            });
          }).catch(function () {
            return {
              userId: enrollment.userId,
              name: enrollment.userName || '',
              email: enrollment.userEmail || '',
              chaptersRead: 0,
              totalChapters: totalChapters,
              lastActive: null
            };
          });
      });

      return Promise.all(progressPromises);
    }).then(function (students) {
      if (!students || !students.length) {
        el.innerHTML = '<p class="yb-admin__empty">' + t('no_enrollments') + '</p>';
        return;
      }

      el.innerHTML = students.map(function (s) {
        var pct = s.totalChapters > 0 ? Math.round((s.chaptersRead / s.totalChapters) * 100) : 0;
        var lastActiveStr = '';
        if (s.lastActive) {
          lastActiveStr = s.lastActive.toLocaleDateString('da-DK', {
            day: '2-digit', month: '2-digit', year: 'numeric'
          });
        }
        var displayName = s.name || s.email || s.userId;
        var chaptersLabel = lang === 'da' ? 'kapitler læst' : 'chapters read';

        return '<div class="yb-admin__student-row">' +
          '<div class="yb-admin__student-info">' +
            '<strong>' + esc(displayName) + '</strong>' +
            (s.email ? ' <small style="color:#6F6A66">' + esc(s.email) + '</small>' : '') +
          '</div>' +
          '<div class="yb-admin__student-bar-wrap">' +
            '<div class="yb-admin__student-bar" style="width:' + pct + '%"></div>' +
          '</div>' +
          '<div class="yb-admin__student-stats">' +
            '<span>' + s.chaptersRead + '/' + s.totalChapters + ' ' + chaptersLabel + '</span>' +
            '<span>' + pct + '%</span>' +
            (lastActiveStr ? '<small style="color:#6F6A66">' + (lang === 'da' ? 'Sidst aktiv: ' : 'Last active: ') + lastActiveStr + '</small>' : '') +
          '</div>' +
        '</div>';
      }).join('');
    }).catch(function (err) {
      console.error('Student progress error:', err);
      el.innerHTML = '<p class="yb-admin__empty" style="color:#dc2626">' + (t('error_load') || 'Error loading data') + '</p>';
    });
  }

  /* ═══════════════════════════════════════
     USER ROLE MANAGEMENT
     ═══════════════════════════════════════ */

  /**
   * Renders the role management form for a user found via lookup.
   * Appended to the user lookup result area.
   */
  function renderRoleEditor(uid, userData) {
    var R = window.YBRoles;
    if (!R) return '';

    var currentRole = userData.role || 'member';
    // Map legacy 'user' role to 'member'
    if (currentRole === 'user') currentRole = 'member';
    var currentDetails = userData.roleDetails || {};

    var html = '<div class="yb-admin__section-divider" style="margin:1.5rem 0"></div>';
    html += '<h3 style="font-size:0.95rem;font-weight:700;margin-bottom:0.75rem">' + t('role_title') + '</h3>';
    html += '<form id="yb-admin-role-form" data-uid="' + uid + '">';
    html += '<div class="yb-admin__form-row">';

    // Role select
    html += '<div class="yb-admin__field" style="flex:1">';
    html += '<label for="yb-admin-role-select">' + t('role_label') + '</label>';
    html += '<select id="yb-admin-role-select" class="yb-admin__select">';
    var roles = ['member', 'trainee', 'student', 'teacher', 'marketing', 'admin'];
    roles.forEach(function(r) {
      var label = R.getRoleLabel(r, lang);
      html += '<option value="' + r + '"' + (r === currentRole ? ' selected' : '') + '>' + label + '</option>';
    });
    html += '</select>';
    html += '</div>';

    // Trainee program select (shown conditionally)
    html += '<div class="yb-admin__field" id="yb-admin-role-trainee-fields" style="flex:1;display:' + (currentRole === 'trainee' ? '' : 'none') + '">';
    html += '<label for="yb-admin-role-program">' + t('role_program') + '</label>';
    html += '<select id="yb-admin-role-program" class="yb-admin__select">';
    html += '<option value="">—</option>';
    Object.keys(R.TRAINEE_PROGRAMS).forEach(function(k) {
      var prog = R.TRAINEE_PROGRAMS[k];
      html += '<option value="' + k + '"' + (currentDetails.program === k ? ' selected' : '') + '>' + (prog['label_' + lang] || prog.label_da) + '</option>';
    });
    html += '</select>';
    html += '</div>';

    // Trainee method select (shown conditionally)
    html += '<div class="yb-admin__field" id="yb-admin-role-method-fields" style="flex:1;display:' + (currentRole === 'trainee' ? '' : 'none') + '">';
    html += '<label for="yb-admin-role-method">Method</label>';
    html += '<select id="yb-admin-role-method" class="yb-admin__select">';
    html += '<option value="">—</option>';
    if (R.TRAINEE_METHODS) {
      Object.keys(R.TRAINEE_METHODS).forEach(function(k) {
        var meth = R.TRAINEE_METHODS[k];
        html += '<option value="' + k + '"' + (currentDetails.method === k ? ' selected' : '') + '>' + (meth['label_' + lang] || meth.label_da) + '</option>';
      });
    }
    html += '</select>';
    html += '</div>';

    // Teacher type select (shown conditionally)
    html += '<div class="yb-admin__field" id="yb-admin-role-teacher-fields" style="flex:1;display:' + (currentRole === 'teacher' ? '' : 'none') + '">';
    html += '<label for="yb-admin-role-teacher-type">' + t('role_teacher_type') + '</label>';
    html += '<select id="yb-admin-role-teacher-type" class="yb-admin__select">';
    html += '<option value="">—</option>';
    Object.keys(R.TEACHER_TYPES).forEach(function(k) {
      var tt = R.TEACHER_TYPES[k];
      html += '<option value="' + k + '"' + (currentDetails.teacherType === k ? ' selected' : '') + '>' + (tt['label_' + lang] || tt.label_da) + '</option>';
    });
    html += '</select>';
    html += '</div>';

    // Student course types (shown conditionally) — checkboxes for multi-select
    html += '<div class="yb-admin__field" id="yb-admin-role-student-fields" style="flex:1;display:' + (currentRole === 'student' ? '' : 'none') + '">';
    html += '<label>Courses</label>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:0.5rem 1rem;margin-top:0.25rem">';
    var existingCourseTypes = (currentDetails.courseTypes || []);
    Object.keys(R.STUDENT_COURSES).forEach(function(k) {
      var sc = R.STUDENT_COURSES[k];
      var checked = existingCourseTypes.indexOf(k) !== -1 ? ' checked' : '';
      html += '<label style="font-size:0.85rem;display:flex;align-items:center;gap:0.35rem;cursor:pointer">';
      html += '<input type="checkbox" class="yb-admin-role-coursetype" value="' + k + '"' + checked + '>';
      html += (sc['label_' + lang] || sc.label_da);
      html += '</label>';
    });
    // Mentorship checkbox
    var mentorChecked = currentDetails.mentorship ? ' checked' : '';
    html += '<label style="font-size:0.85rem;display:flex;align-items:center;gap:0.35rem;cursor:pointer">';
    html += '<input type="checkbox" id="yb-admin-role-mentorship" value="mentorship"' + mentorChecked + '>';
    html += 'Mentorship';
    html += '</label>';
    html += '</div>';
    html += '</div>';

    html += '</div>'; // end form-row

    // Trainee cohort (shown conditionally)
    html += '<div id="yb-admin-role-cohort-wrap" style="display:' + (currentRole === 'trainee' ? '' : 'none') + '">';
    html += '<div class="yb-admin__field" style="max-width:220px">';
    html += '<label for="yb-admin-role-cohort">' + t('role_cohort') + '</label>';
    html += '<input type="text" id="yb-admin-role-cohort" placeholder="2026-spring" value="' + esc(currentDetails.cohort || '') + '">';
    html += '</div>';
    html += '</div>';

    // Trainee courseTypes checkboxes (shown when trainee — they can also have courses)
    html += '<div id="yb-admin-role-trainee-courses-wrap" style="display:' + (currentRole === 'trainee' ? '' : 'none') + '">';
    html += '<div class="yb-admin__field">';
    html += '<label>Courses (optional)</label>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:0.5rem 1rem;margin-top:0.25rem">';
    Object.keys(R.STUDENT_COURSES).forEach(function(k) {
      var sc = R.STUDENT_COURSES[k];
      var checked = existingCourseTypes.indexOf(k) !== -1 ? ' checked' : '';
      html += '<label style="font-size:0.85rem;display:flex;align-items:center;gap:0.35rem;cursor:pointer">';
      html += '<input type="checkbox" class="yb-admin-role-trainee-coursetype" value="' + k + '"' + checked + '>';
      html += (sc['label_' + lang] || sc.label_da);
      html += '</label>';
    });
    var trainMentorChecked = currentDetails.mentorship ? ' checked' : '';
    html += '<label style="font-size:0.85rem;display:flex;align-items:center;gap:0.35rem;cursor:pointer">';
    html += '<input type="checkbox" id="yb-admin-role-trainee-mentorship" value="mentorship"' + trainMentorChecked + '>';
    html += 'Mentorship';
    html += '</label>';
    html += '</div>';
    html += '</div>';
    html += '</div>';

    html += '<div class="yb-admin__form-actions" style="margin-top:1rem">';
    html += '<button type="submit" class="yb-btn yb-btn--primary">' + t('role_save') + '</button>';
    html += '</div>';
    html += '</form>';

    return html;
  }

  function saveUserRole(e) {
    e.preventDefault();
    var form = $('yb-admin-role-form');
    if (!form) return;
    var uid = form.getAttribute('data-uid');
    if (!uid) return;

    var roleSelect = $('yb-admin-role-select');
    var programSelect = $('yb-admin-role-program');
    var methodSelect = $('yb-admin-role-method');
    var teacherTypeSelect = $('yb-admin-role-teacher-type');
    var cohortInput = $('yb-admin-role-cohort');

    var newRole = roleSelect ? roleSelect.value : 'member';
    var roleDetails = {};

    if (newRole === 'trainee') {
      if (programSelect && programSelect.value) roleDetails.program = programSelect.value;
      if (methodSelect && methodSelect.value) roleDetails.method = methodSelect.value;
      if (cohortInput && cohortInput.value.trim()) roleDetails.cohort = cohortInput.value.trim();
      // Collect trainee courseTypes
      var traineeCourseTypes = [];
      document.querySelectorAll('.yb-admin-role-trainee-coursetype:checked').forEach(function(cb) {
        traineeCourseTypes.push(cb.value);
      });
      if (traineeCourseTypes.length) roleDetails.courseTypes = traineeCourseTypes;
      var traineeMentorship = $('yb-admin-role-trainee-mentorship');
      if (traineeMentorship && traineeMentorship.checked) roleDetails.mentorship = true;
    }
    if (newRole === 'student') {
      // Collect student courseTypes
      var studentCourseTypes = [];
      document.querySelectorAll('.yb-admin-role-coursetype:checked').forEach(function(cb) {
        studentCourseTypes.push(cb.value);
      });
      if (studentCourseTypes.length) roleDetails.courseTypes = studentCourseTypes;
      var studentMentorship = $('yb-admin-role-mentorship');
      if (studentMentorship && studentMentorship.checked) roleDetails.mentorship = true;
    }
    if (newRole === 'teacher') {
      if (teacherTypeSelect && teacherTypeSelect.value) roleDetails.teacherType = teacherTypeSelect.value;
    }

    var previousRole = state.userDetail ? (state.userDetail.role || 'member') : 'member';
    var previousDetails = state.userDetail ? (state.userDetail.roleDetails || {}) : {};

    toast(t('saving'));
    db.collection('users').doc(uid).update({
      role: newRole,
      roleDetails: roleDetails,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function() {
      // Audit log
      db.collection('role_changes').add({
        userId: uid,
        action: 'role_change',
        previousRole: previousRole,
        previousDetails: previousDetails,
        newRole: newRole,
        newDetails: roleDetails,
        source: 'admin_manual',
        changedBy: firebase.auth().currentUser ? firebase.auth().currentUser.uid : 'unknown',
        changedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      toast(t('role_saved'));
    }).catch(function(err) {
      console.error('Role save error:', err);
      toast(err.message || t('error_save'), true);
    });
  }

  function suspendUser(uid) {
    if (!uid) return;
    if (!confirm(t('users_suspend_confirm'))) return;

    var previousRole = state.userDetail ? (state.userDetail.role || 'member') : 'member';

    db.collection('users').doc(uid).update({
      suspended: true,
      suspendedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
      // Log role change
      db.collection('role_changes').add({
        userId: uid,
        action: 'suspend',
        previousRole: previousRole,
        source: 'admin_manual',
        changedBy: firebase.auth().currentUser ? firebase.auth().currentUser.uid : 'unknown',
        changedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      toast(t('users_suspended'));
      showUserDetail(uid);
    }).catch(function (err) {
      console.error('Suspend error:', err);
      toast(err.message || t('error_save'), true);
    });
  }

  function unsuspendUser(uid) {
    if (!uid) return;
    if (!confirm(t('users_unsuspend_confirm'))) return;

    db.collection('users').doc(uid).update({
      suspended: false,
      suspendedAt: firebase.firestore.FieldValue.delete(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
      // Log role change
      db.collection('role_changes').add({
        userId: uid,
        action: 'unsuspend',
        source: 'admin_manual',
        changedBy: firebase.auth().currentUser ? firebase.auth().currentUser.uid : 'unknown',
        changedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      toast(t('users_unsuspended'));
      showUserDetail(uid);
    }).catch(function (err) {
      console.error('Unsuspend error:', err);
      toast(err.message || t('error_save'), true);
    });
  }

  function bindRoleFormEvents() {
    // Toggle conditional fields when role changes
    document.addEventListener('change', function(e) {
      if (e.target.id !== 'yb-admin-role-select') return;
      var role = e.target.value;
      var traineeFields = $('yb-admin-role-trainee-fields');
      var methodFields = $('yb-admin-role-method-fields');
      var teacherFields = $('yb-admin-role-teacher-fields');
      var studentFields = $('yb-admin-role-student-fields');
      var cohortWrap = $('yb-admin-role-cohort-wrap');
      var traineeCoursesWrap = $('yb-admin-role-trainee-courses-wrap');
      if (traineeFields) traineeFields.style.display = role === 'trainee' ? '' : 'none';
      if (methodFields) methodFields.style.display = role === 'trainee' ? '' : 'none';
      if (teacherFields) teacherFields.style.display = role === 'teacher' ? '' : 'none';
      if (studentFields) studentFields.style.display = role === 'student' ? '' : 'none';
      if (cohortWrap) cohortWrap.style.display = role === 'trainee' ? '' : 'none';
      if (traineeCoursesWrap) traineeCoursesWrap.style.display = role === 'trainee' ? '' : 'none';
    });
  }

  /* ═══════════════════════════════════════
     USER MANAGEMENT (Users tab)
     ═══════════════════════════════════════ */
  /* ═══════════════════════════════════════
     USERS — LOAD / FILTER / RENDER
     ═══════════════════════════════════════ */
  function loadAllUsers() {
    var tbody = $('yb-user-table-body');
    if (tbody) tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:2rem">' + t('loading') + '</td></tr>';

    db.collection('users').orderBy('createdAt', 'desc').get()
      .then(function (snap) {
        state.users = [];
        snap.forEach(function (doc) { state.users.push(Object.assign({ id: doc.id }, doc.data())); });
        renderUserStats(state.users);
        renderUserTable();
        // Expose user data bridge for campaign wizard
        window._ybUserData = { getUsers: function () { return state.users; } };
      })
      .catch(function () {
        // Fallback: createdAt index may not exist
        db.collection('users').get()
          .then(function (snap) {
            state.users = [];
            snap.forEach(function (doc) { state.users.push(Object.assign({ id: doc.id }, doc.data())); });
            renderUserStats(state.users);
            renderUserTable();
            window._ybUserData = { getUsers: function () { return state.users; } };
          })
          .catch(function (err) {
            console.error(err);
            if (tbody) tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:2rem;color:#dc2626">' + t('error_load') + '</td></tr>';
          });
      });
  }

  function getFilteredUsers() {
    var filtered = state.users.slice();

    // Search filter (name, email, phone)
    if (userSearchTerm) {
      var q = userSearchTerm.toLowerCase();
      filtered = filtered.filter(function (u) {
        var name = (u.name || ((u.firstName || '') + ' ' + (u.lastName || '')).trim() || '').toLowerCase();
        var email = (u.email || '').toLowerCase();
        var phone = (u.phone || '').toLowerCase();
        return name.indexOf(q) > -1 || email.indexOf(q) > -1 || phone.indexOf(q) > -1;
      });
    }

    // Role filter
    if (userFilterRole) {
      filtered = filtered.filter(function (u) {
        var r = u.role || 'member';
        if (r === 'user') r = 'member';
        return r === userFilterRole;
      });
    }

    // Membership tier filter
    if (userFilterTier) {
      filtered = filtered.filter(function (u) {
        var tier = (u.tier || u.membershipTier || '').toLowerCase();
        if (userFilterTier === 'none') return !tier;
        return tier === userFilterTier;
      });
    }

    // Waiver status filter
    if (userFilterWaiver) {
      filtered = filtered.filter(function (u) {
        var signed = !!u.waiverSigned;
        return userFilterWaiver === 'signed' ? signed : !signed;
      });
    }

    // MindBody link filter
    if (userFilterMb) {
      filtered = filtered.filter(function (u) {
        var linked = !!(u.mindbodyId || u.mindbodyClientId);
        return userFilterMb === 'linked' ? linked : !linked;
      });
    }

    return filtered;
  }

  function renderUserStats(users) {
    var el = $('yb-admin-user-stats');
    if (!el) return;

    var total = users.length;
    var members = 0, students = 0, trainees = 0, teachers = 0, admins = 0, mbLinked = 0, waiverSigned = 0;
    users.forEach(function (u) {
      var r = u.role || 'member';
      if (r === 'user') r = 'member';
      if (r === 'member') members++;
      else if (r === 'student') students++;
      else if (r === 'trainee') trainees++;
      else if (r === 'teacher') teachers++;
      else if (r === 'admin') admins++;
      if (u.mindbodyId || u.mindbodyClientId) mbLinked++;
      if (u.waiverSigned) waiverSigned++;
    });

    el.innerHTML =
      '<div class="yb-lead__stat-card yb-lead__stat-card--total"><span class="yb-lead__stat-value">' + total + '</span><span class="yb-lead__stat-label">' + t('users_stat_total') + '</span></div>' +
      '<div class="yb-lead__stat-card"><span class="yb-lead__stat-value">' + members + '</span><span class="yb-lead__stat-label">' + t('users_stat_members') + '</span></div>' +
      '<div class="yb-lead__stat-card"><span class="yb-lead__stat-value">' + (students + trainees) + '</span><span class="yb-lead__stat-label">' + t('users_stat_students') + '</span></div>' +
      '<div class="yb-lead__stat-card"><span class="yb-lead__stat-value">' + teachers + '</span><span class="yb-lead__stat-label">' + t('users_stat_teachers') + '</span></div>' +
      '<div class="yb-lead__stat-card"><span class="yb-lead__stat-value">' + admins + '</span><span class="yb-lead__stat-label">' + t('users_stat_admins') + '</span></div>' +
      '<div class="yb-lead__stat-card"><span class="yb-lead__stat-value">' + mbLinked + '</span><span class="yb-lead__stat-label">' + t('users_stat_mb_linked') + '</span></div>' +
      '<div class="yb-lead__stat-card"><span class="yb-lead__stat-value">' + waiverSigned + '</span><span class="yb-lead__stat-label">' + t('users_stat_waiver_signed') + '</span></div>';
  }

  function renderUserTable() {
    var tbody = $('yb-user-table-body');
    if (!tbody) return;

    var filtered = getFilteredUsers();

    // Update result count
    var countEl = $('yb-user-count');
    if (countEl) countEl.textContent = filtered.length + ' ' + t('users_of') + ' ' + state.users.length;

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:2rem;color:#6F6A66">' + t('users_no_users') + '</td></tr>';
      return;
    }

    var R = window.YBRoles;

    tbody.innerHTML = filtered.map(function (u) {
      var isChecked = selectedUserIds.has(u.id);
      var name = u.name || ((u.firstName || '') + ' ' + (u.lastName || '')).trim() || '\u2014';
      var email = u.email || '\u2014';
      var phone = u.phone || '';
      var role = u.role || 'member';
      if (role === 'user') role = 'member';
      var roleLabel = R ? R.getRoleLabel(role, lang) : role;
      var tier = u.tier || u.membershipTier || '';
      var waiverStatus = u.waiverSigned ? '\u2705' : '\u274c';
      var mbStatus = (u.mindbodyId || u.mindbodyClientId) ? '\u2705' : '\u274c';
      var joined = '';
      if (u.createdAt) {
        var d = u.createdAt.toDate ? u.createdAt.toDate() : new Date(u.createdAt);
        joined = d.toLocaleDateString('da-DK', { day: '2-digit', month: '2-digit', year: 'numeric' });
      }

      return '<tr class="yb-lead__row' + (isChecked ? ' is-selected' : '') + '">' +
        '<td class="yb-lead__th-cb"><input type="checkbox" class="yb-user-row-cb" data-id="' + u.id + '"' + (isChecked ? ' checked' : '') + '></td>' +
        '<td>' + esc(name) + '</td>' +
        '<td style="font-size:0.8rem;color:#6F6A66">' + esc(email) + '</td>' +
        '<td style="font-size:0.8rem">' + (phone ? '<a href="tel:' + esc(phone) + '" class="yb-lead__cell-phone-link" onclick="event.stopPropagation()">' + esc(phone) + '</a>' : '\u2014') + '</td>' +
        '<td><span class="yb-admin__badge">' + esc(roleLabel) + '</span></td>' +
        '<td style="font-size:0.8rem">' + esc(tier || '\u2014') + '</td>' +
        '<td style="text-align:center">' + waiverStatus + '</td>' +
        '<td style="text-align:center">' + mbStatus + '</td>' +
        '<td style="font-size:0.8rem;color:#6F6A66">' + esc(joined) + '</td>' +
        '<td><button class="yb-admin__icon-btn" data-action="view-user" data-id="' + u.id + '" title="' + t('users_view') + '">\u2192</button></td>' +
      '</tr>';
    }).join('');

    // Update select-all checkbox state
    var selectAllCb = $('yb-user-select-all');
    if (selectAllCb) selectAllCb.checked = selectAllUsers && filtered.length > 0;
  }

  /* ═══════════════════════════════════════
     USERS — BULK SELECTION
     ═══════════════════════════════════════ */
  function toggleUserSelectAll() {
    selectAllUsers = !selectAllUsers;
    var filtered = getFilteredUsers();
    if (selectAllUsers) {
      filtered.forEach(function (u) { selectedUserIds.add(u.id); });
    } else {
      selectedUserIds.clear();
    }
    renderUserTable();
    updateUserBulkBar();
  }

  function toggleUserSelect(userId) {
    if (selectedUserIds.has(userId)) {
      selectedUserIds.delete(userId);
    } else {
      selectedUserIds.add(userId);
    }
    updateUserBulkBar();
  }

  function updateUserBulkBar() {
    var bar = $('yb-user-bulk-bar');
    if (!bar) return;
    if (selectedUserIds.size === 0) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    var selected = state.users.filter(function (u) { return selectedUserIds.has(u.id); });
    var withPhone = selected.filter(function (u) { return u.phone; }).length;
    var withEmail = selected.filter(function (u) { return u.email; }).length;
    var countEl = $('yb-user-bulk-count');
    if (countEl) countEl.innerHTML = '<strong>' + selectedUserIds.size + '</strong> ' + t('users_selected') +
      ' &nbsp;&middot;&nbsp; \ud83d\udcf1 ' + withPhone + ' &nbsp;&middot;&nbsp; \u2709\ufe0f ' + withEmail;
  }

  function deselectAllUsers() {
    selectedUserIds.clear();
    selectAllUsers = false;
    renderUserTable();
    updateUserBulkBar();
  }

  /* ═══════════════════════════════════════
     USERS — BULK ACTIONS
     ═══════════════════════════════════════ */
  function bulkUserRole() {
    if (selectedUserIds.size === 0) return;
    var VALID_ROLES = ['member', 'trainee', 'student', 'teacher', 'marketing', 'admin'];
    var newRole = prompt(t('users_bulk_role_prompt'), 'member');
    if (!newRole) return;
    newRole = newRole.toLowerCase().trim();
    if (VALID_ROLES.indexOf(newRole) === -1) {
      toast(t('users_invalid_role'), true);
      return;
    }

    var batch = db.batch();
    selectedUserIds.forEach(function (id) {
      batch.update(db.collection('users').doc(id), { role: newRole });
    });

    toast(t('saving'));
    batch.commit().then(function () {
      state.users.forEach(function (u) {
        if (selectedUserIds.has(u.id)) u.role = newRole;
      });
      selectedUserIds.clear();
      selectAllUsers = false;
      renderUserTable();
      renderUserStats(state.users);
      updateUserBulkBar();
      toast(t('saved'));
    }).catch(function (err) {
      console.error(err);
      toast(t('error_save') + ': ' + err.message, true);
    });
  }

  function bulkUserEmail() {
    if (typeof window.openEmailCampaign === 'function') {
      window.openEmailCampaign([]);
    } else {
      toast('Campaign wizard not available', true);
    }
  }

  function bulkUserSMS() {
    if (typeof window.openSMSCampaign === 'function') {
      window.openSMSCampaign([]);
    } else {
      toast('Campaign wizard not available', true);
    }
  }

  function bulkUserEmailSelected() {
    var selected = state.users.filter(function (u) { return selectedUserIds.has(u.id); });
    var withEmail = selected.filter(function (u) { return u.email; });
    if (!withEmail.length) { toast(t('users_no_email_addr'), true); return; }
    var recipients = withEmail.map(function (u) {
      return {
        id: u.id,
        first_name: u.firstName || u.name || '',
        last_name: u.lastName || '',
        email: u.email,
        phone: u.phone || ''
      };
    });
    if (typeof window.openEmailCampaign === 'function') {
      window.openEmailCampaign(recipients);
    } else {
      toast('Campaign wizard not available', true);
    }
  }

  function bulkUserSMSSelected() {
    var selected = state.users.filter(function (u) { return selectedUserIds.has(u.id); });
    var withPhone = selected.filter(function (u) { return u.phone; });
    if (!withPhone.length) { toast(t('users_no_phone'), true); return; }
    var recipients = withPhone.map(function (u) {
      return {
        id: u.id,
        first_name: u.firstName || u.name || '',
        last_name: u.lastName || '',
        email: u.email || '',
        phone: u.phone
      };
    });
    if (typeof window.openSMSCampaign === 'function') {
      window.openSMSCampaign(recipients);
    } else {
      toast('Campaign wizard not available', true);
    }
  }

  /* ═══════════════════════════════════════
     USERS — CSV EXPORT
     ═══════════════════════════════════════ */
  function exportUsersCSV() {
    var filtered = getFilteredUsers();
    if (!filtered.length) { toast(t('users_no_users'), true); return; }

    var headers = ['Name', 'Email', 'Phone', 'Role', 'Membership Tier', 'Waiver Signed', 'MindBody Linked', 'MindBody ID', 'Yoga Level', 'Practice Frequency', 'Date of Birth', 'Locale', 'Created'];
    var rows = filtered.map(function (u) {
      var name = u.name || ((u.firstName || '') + ' ' + (u.lastName || '')).trim();
      var joined = '';
      if (u.createdAt) {
        var d = u.createdAt.toDate ? u.createdAt.toDate() : new Date(u.createdAt);
        joined = d.toISOString().substring(0, 10);
      }
      return [
        name,
        u.email || '',
        u.phone || '',
        u.role || 'member',
        u.tier || u.membershipTier || '',
        u.waiverSigned ? 'Yes' : 'No',
        (u.mindbodyId || u.mindbodyClientId) ? 'Yes' : 'No',
        u.mindbodyId || u.mindbodyClientId || '',
        u.yogaLevel || '',
        u.practiceFrequency || '',
        u.dateOfBirth || '',
        u.locale || '',
        joined
      ].map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(',');
    });

    var csv = headers.join(',') + '\n' + rows.join('\n');
    var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'yoga-bible-users-' + new Date().toISOString().split('T')[0] + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast(t('users_exported'));
  }

  /* ═══════════════════════════════════════
     USERS — QUICK ACTIONS (detail view)
     ═══════════════════════════════════════ */
  function renderUserQuickActions() {
    var el = $('yb-user-actions');
    if (!el || !state.userDetail) return;

    var u = state.userDetail;
    var phone = u.phone || '';
    var email = u.email || '';

    var html =
      (phone ? '<a href="tel:' + esc(phone) + '" class="yb-btn yb-btn--outline yb-btn--sm">\ud83d\udcde ' + t('users_call') + '</a>' : '') +
      (phone ? '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="user-detail-sms">\ud83d\udcf1 ' + t('users_sms') + '</button>' : '') +
      (phone ? '<a href="https://wa.me/' + esc(phone.replace(/[^0-9+]/g, '')) + '" target="_blank" rel="noopener" class="yb-btn yb-btn--outline yb-btn--sm">\ud83d\udcac WhatsApp</a>' : '') +
      (email ? '<a href="mailto:' + esc(email) + '" class="yb-btn yb-btn--outline yb-btn--sm">\u2709\ufe0f ' + t('users_email') + '</a>' : '') +
      '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="user-add-note">\ud83d\udcdd ' + t('users_add_note') + '</button>' +
      '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="user-bill">\ud83d\udcb3 ' + t('users_bill') + '</button>';

    el.innerHTML = html || '<p class="yb-lead__empty-text">' + t('users_empty') + '</p>';
  }

  /* ═══════════════════════════════════════
     USERS — NOTES TIMELINE
     ═══════════════════════════════════════ */
  function addUserNote(type) {
    var uid = state.userDetailUid;
    if (!uid || !state.userDetail) return;

    var input = $('yb-user-note-input');
    var noteText = input ? input.value.trim() : '';
    if (!noteText) {
      noteText = prompt(t('users_note_placeholder'));
      if (!noteText) return;
    }

    var newNote = {
      text: noteText,
      timestamp: new Date().toISOString(),
      author: (firebase.auth().currentUser || {}).email || 'admin',
      type: type || 'note'
    };

    var existing = state.userDetail.notes;
    var notesArray = [];
    if (typeof existing === 'string' && existing) {
      notesArray.push({ text: existing, timestamp: '', author: '', type: 'note' });
    } else if (Array.isArray(existing)) {
      notesArray = existing.slice();
    }
    notesArray.unshift(newNote);

    db.collection('users').doc(uid).update({
      notes: notesArray
    }).then(function () {
      state.userDetail.notes = notesArray;
      var idx = -1;
      for (var i = 0; i < state.users.length; i++) { if (state.users[i].id === uid) { idx = i; break; } }
      if (idx !== -1) state.users[idx].notes = notesArray;
      if (input) input.value = '';
      renderUserNotesTimeline();
      toast(t('users_note_added'));
    }).catch(function (err) {
      console.error('[course-admin] User note error:', err);
      toast(t('error_save'), true);
    });
  }

  function renderUserNotesTimeline() {
    var el = $('yb-user-notes-timeline');
    if (!el || !state.userDetail) return;

    var notes = Array.isArray(state.userDetail.notes) ? state.userDetail.notes : [];
    if (!notes.length) {
      el.innerHTML = '<p class="yb-lead__empty-text">' + t('users_no_notes') + '</p>';
      return;
    }

    var typeIcon = { call: '\ud83d\udcde', email: '\u2709\ufe0f', sms: '\ud83d\udcf1', note: '\ud83d\udcdd', system: '\u2699\ufe0f' };

    el.innerHTML = notes.map(function (n) {
      var icon = typeIcon[n.type || 'note'] || '\ud83d\udcdd';
      var ts = '';
      if (n.timestamp) {
        try { ts = new Date(n.timestamp).toLocaleString(); } catch (e) { ts = n.timestamp; }
      }
      return '<div class="yb-lead__note-item yb-lead__note-item--' + (n.type || 'note') + '">' +
        '<div class="yb-lead__note-header">' +
          '<span class="yb-lead__note-icon">' + icon + '</span>' +
          '<span class="yb-lead__note-author">' + esc(n.author || '') + '</span>' +
          '<span class="yb-lead__note-time">' + ts + '</span>' +
        '</div>' +
        '<div class="yb-lead__note-text">' + esc(n.text || '') + '</div>' +
      '</div>';
    }).join('');
  }

  /* ═══════════════════════════════════════
     USERS — INVOICE SECTION
     ═══════════════════════════════════════ */
  function loadUserInvoices(user) {
    var el = $('yb-admin-user-invoices');
    if (!el) return;

    var email = (user && user.email) || '';
    if (!email) {
      el.innerHTML = '<p class="yb-lead__empty-text">' + t('users_no_invoices') + '</p>';
      return;
    }

    el.innerHTML = '<p class="yb-admin__empty" style="color:var(--yb-muted)">' + t('users_invoice_looking_up') + '</p>';

    // Search e-conomic customers by email
    var token;
    firebase.auth().currentUser.getIdToken().then(function (tk) {
      token = tk;
      return fetch('/.netlify/functions/economic-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ action: 'searchCustomers', query: email })
      }).then(function (r) { return r.json(); });
    }).then(function (custRes) {
      if (!custRes.ok || !custRes.data || !custRes.data.length) {
        el.innerHTML = '<p class="yb-lead__empty-text">' + t('users_no_invoices') + '</p>' +
          '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="user-invoice-lookup">\ud83d\udd0d ' + t('users_invoice_lookup') + '</button>';
        return;
      }

      // Find best match by email
      var match = custRes.data.find(function (c) { return c.email && c.email.toLowerCase() === email.toLowerCase(); });
      if (!match) match = custRes.data[0];

      // Fetch invoices for this customer
      return fetch('/.netlify/functions/economic-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ action: 'searchInvoicesByCustomer', customerNumber: match.customerNumber })
      }).then(function (r) { return r.json(); }).then(function (invRes) {
        if (!invRes.ok) {
          el.innerHTML = '<p class="yb-lead__empty-text">' + t('users_no_invoices') + '</p>';
          return;
        }
        renderUserInvoices(el, invRes.data, user);
      });
    }).catch(function (err) {
      console.error('[course-admin] User invoice lookup error:', err);
      el.innerHTML = '<p class="yb-lead__empty-text">' + t('users_no_invoices') + '</p>';
    });
  }

  function renderUserInvoices(el, data, user) {
    var booked = data.booked || [];
    var drafts = data.drafts || [];

    if (!booked.length && !drafts.length) {
      el.innerHTML = '<p class="yb-lead__empty-text">' + t('users_no_invoices') + '</p>';
      return;
    }

    var html = '<div class="yb-admin__table-wrap"><table class="yb-admin__table"><thead><tr>' +
      '<th>#</th><th>' + t('billing_col_type') + '</th><th>' + t('billing_col_date') + '</th>' +
      '<th>' + t('billing_col_total') + '</th><th>' + t('billing_col_remainder') + '</th>' +
      '<th>' + t('billing_col_status') + '</th><th></th>' +
      '</tr></thead><tbody>';

    drafts.forEach(function (d) {
      var total = d.grossAmount != null ? d.grossAmount : (d.netAmount || 0);
      html += '<tr>' +
        '<td>' + d.draftInvoiceNumber + '</td>' +
        '<td><span class="yb-billing__type-badge yb-billing__type-badge--draft">' + t('billing_filter_draft') + '</span></td>' +
        '<td>' + (d.date || '\u2014') + '</td>' +
        '<td>' + formatInvAmount(total) + '</td>' +
        '<td>\u2014</td>' +
        '<td><span class="yb-billing__status--draft">' + t('billing_filter_draft') + '</span></td>' +
        '<td><button class="yb-btn yb-btn--outline yb-btn--sm" data-action="user-invoice-view-draft" data-draft="' + d.draftInvoiceNumber + '">' + (lang === 'da' ? 'Vis' : 'View') + '</button></td>' +
        '</tr>';
    });

    booked.forEach(function (inv) {
      var total = inv.grossAmount != null ? inv.grossAmount : (inv.netAmount || 0);
      var remainder = inv.remainder != null ? formatInvAmount(inv.remainder) : '\u2014';
      var isPaid = inv.remainder != null && inv.remainder === 0;
      var isPartial = inv.remainder != null && inv.remainder > 0 && inv.remainder < total;
      var statusLabel = isPaid ? t('billing_status_paid') : (isPartial ? t('billing_status_partial') : t('billing_status_unpaid'));
      var statusClass = isPaid ? 'yb-billing__status--paid' : (isPartial ? 'yb-billing__status--partial' : 'yb-billing__status--unpaid');

      html += '<tr>' +
        '<td>' + inv.bookedInvoiceNumber + '</td>' +
        '<td><span class="yb-billing__type-badge yb-billing__type-badge--booked">' + t('billing_filter_booked') + '</span></td>' +
        '<td>' + (inv.date || '\u2014') + '</td>' +
        '<td>' + formatInvAmount(total) + '</td>' +
        '<td>' + remainder + '</td>' +
        '<td><span class="' + statusClass + '">' + statusLabel + '</span></td>' +
        '<td><button class="yb-btn yb-btn--outline yb-btn--sm" data-action="user-invoice-view-booked" data-booked="' + inv.bookedInvoiceNumber + '">' + (lang === 'da' ? 'Vis' : 'View') + '</button></td>' +
        '</tr>';
    });

    html += '</tbody></table></div>';

    // Payment status selector
    var payStatus = (user && user.invoicePaymentStatus) || 'pending';
    html += '<div style="margin-top:0.75rem;display:flex;align-items:center;gap:0.5rem">';
    html += '<label style="font-size:0.8rem;font-weight:600;color:var(--yb-muted)">' + t('invoice_payment_status') + ':</label>';
    html += '<select id="yb-user-invoice-payment-status" class="yb-admin__select" style="max-width:160px;font-size:0.8rem">';
    html += '<option value="pending"' + (payStatus === 'pending' ? ' selected' : '') + '>' + t('invoice_pay_pending') + '</option>';
    html += '<option value="paid"' + (payStatus === 'paid' ? ' selected' : '') + '>' + t('invoice_pay_paid') + '</option>';
    html += '<option value="unpaid"' + (payStatus === 'unpaid' ? ' selected' : '') + '>' + t('invoice_pay_unpaid') + '</option>';
    html += '<option value="partial"' + (payStatus === 'partial' ? ' selected' : '') + '>' + t('invoice_pay_partial') + '</option>';
    html += '</select></div>';

    el.innerHTML = html;
  }

  function formatInvAmount(n) {
    return new Intl.NumberFormat(lang === 'da' ? 'da-DK' : 'en-DK', { style: 'currency', currency: 'DKK', minimumFractionDigits: 2 }).format(n);
  }

  function saveUserPaymentStatus(status) {
    var uid = state.userDetailUid;
    if (!uid) return;
    db.collection('users').doc(uid).update({
      invoicePaymentStatus: status,
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
      if (state.userDetail) state.userDetail.invoicePaymentStatus = status;
      toast(lang === 'da' ? 'Betalingsstatus gemt' : 'Payment status saved');
    }).catch(function (err) {
      console.error('[course-admin] Save payment status error:', err);
      toast(t('error_save'), true);
    });
  }

  function showUserDetail(uid) {
    state.userDetailUid = uid;

    var listView = $('yb-admin-v-user-list');
    var detailView = $('yb-admin-v-user-detail');
    if (listView) listView.hidden = true;
    if (detailView) detailView.hidden = false;

    var profileCard = $('yb-admin-user-profile-card');
    var roleEditor = $('yb-admin-user-role-editor');
    var enrollments = $('yb-admin-user-enrollments');
    var progress = $('yb-admin-user-progress');
    var consents = $('yb-admin-user-consents');

    if (profileCard) profileCard.innerHTML = '<p class="yb-admin__empty">' + t('loading') + '</p>';

    db.collection('users').doc(uid).get()
      .then(function (doc) {
        if (!doc.exists) {
          if (profileCard) profileCard.innerHTML = '<p class="yb-admin__empty">' + t('users_empty') + '</p>';
          return;
        }
        var u = doc.data();
        state.userDetail = u;

        renderUserProfile(uid, u, profileCard);
        renderUserQuickActions();
        renderUserRoleEditorDetail(uid, u, roleEditor);
        loadUserEnrollments(uid, enrollments);
        loadUserProgress(uid, progress);
        loadUserConsents(uid, consents);
        loadUserInvoices(u);
        renderUserNotesTimeline();
        populateEnrollCourseDropdown();

        var heading = $('yb-admin-user-detail-heading');
        var name = u.name || ((u.firstName || '') + ' ' + (u.lastName || '')).trim() || u.email || '';
        if (heading) heading.textContent = name || t('users_detail_title');
      })
      .catch(function (err) {
        console.error(err);
        if (profileCard) profileCard.innerHTML = '<p class="yb-admin__empty" style="color:#dc2626">' + (err.message || t('error_load')) + '</p>';
      });
  }

  function renderUserProfile(uid, u, el) {
    if (!el) return;

    var R = window.YBRoles;
    var name = u.name || ((u.firstName || '') + ' ' + (u.lastName || '')).trim() || '';
    var email = u.email || '';
    var role = u.role || 'member';
    if (role === 'user') role = 'member';
    var roleLabel = R ? R.getRoleLabel(role, lang) : role;

    var initials = '';
    if (name) {
      var parts = name.trim().split(/\s+/);
      initials = parts.length > 1 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : name.substring(0, 2).toUpperCase();
    } else {
      initials = email.substring(0, 2).toUpperCase();
    }

    var html = '<div class="yb-admin__card" style="flex-wrap:wrap">' +
      '<div class="yb-admin__user-avatar">' + esc(initials) + '</div>' +
      '<div class="yb-admin__card-body">' +
        '<h3>' + esc(name || email) + '</h3>' +
        '<p style="font-size:0.85rem;color:#6F6A66;margin:0">' + esc(email) + ' &middot; <small>' + esc(uid) + '</small></p>' +
        '<span class="yb-admin__badge" style="margin-top:0.35rem">' + esc(roleLabel) + '</span>' +
      '</div>' +
      '<div class="yb-admin__user-meta">';

    if (u.phone) html += '<div class="yb-admin__user-meta-item"><span class="yb-admin__user-meta-label">' + t('users_profile_phone') + '</span><a href="tel:' + esc(u.phone) + '" style="color:#f75c03">' + esc(u.phone) + '</a></div>';
    if (u.dateOfBirth) html += '<div class="yb-admin__user-meta-item"><span class="yb-admin__user-meta-label">' + t('users_profile_dob') + '</span><span>' + esc(u.dateOfBirth) + '</span></div>';
    if (u.yogaLevel) html += '<div class="yb-admin__user-meta-item"><span class="yb-admin__user-meta-label">' + t('users_profile_level') + '</span><span>' + esc(u.yogaLevel) + '</span></div>';
    if (u.practiceFrequency) html += '<div class="yb-admin__user-meta-item"><span class="yb-admin__user-meta-label">' + t('users_profile_frequency') + '</span><span>' + esc(u.practiceFrequency) + '</span></div>';
    if (u.tier) html += '<div class="yb-admin__user-meta-item"><span class="yb-admin__user-meta-label">' + t('users_profile_tier') + '</span><span>' + esc(u.tier) + '</span></div>';
    if (u.createdAt) {
      var d = u.createdAt.toDate ? u.createdAt.toDate() : new Date(u.createdAt);
      var dateStr = d.toLocaleDateString('da-DK', { day: '2-digit', month: '2-digit', year: 'numeric' });
      html += '<div class="yb-admin__user-meta-item"><span class="yb-admin__user-meta-label">' + t('users_profile_created') + '</span><span>' + esc(dateStr) + '</span></div>';
    }
    html += '<div class="yb-admin__user-meta-item"><span class="yb-admin__user-meta-label">' + t('users_profile_mindbody') + '</span><span>' + (u.mindbodyId ? t('users_profile_linked') : t('users_profile_not_linked')) + '</span></div>';

    html += '</div>';

    // Suspend / Reactivate button
    var isSuspended = u.suspended === true;
    html += '<div style="margin-top:1rem;padding-top:1rem;border-top:1px solid #E8E4E0;width:100%">';
    if (isSuspended) {
      html += '<span class="yb-admin__badge yb-admin__badge--danger" style="margin-right:0.75rem">' + t('users_suspended_badge') + '</span>';
      html += '<button class="yb-btn yb-btn--outline yb-btn--sm" data-action="unsuspend-user" data-uid="' + esc(uid) + '">' + t('users_unsuspend') + '</button>';
    } else {
      html += '<button class="yb-btn yb-btn--outline yb-btn--sm yb-admin__icon-btn--danger" data-action="suspend-user" data-uid="' + esc(uid) + '">' + t('users_suspend') + '</button>';
    }
    html += '</div>';

    html += '</div>';
    el.innerHTML = html;
  }

  function renderUserRoleEditorDetail(uid, u, el) {
    if (!el) return;
    el.innerHTML = renderRoleEditor(uid, u);
    var roleForm = $('yb-admin-role-form');
    if (roleForm) {
      roleForm.addEventListener('submit', function (e) {
        saveUserRole(e);
        setTimeout(function () { showUserDetail(uid); }, 1200);
      });
    }
  }

  function loadUserEnrollments(uid, el) {
    if (!el) return;
    el.innerHTML = '<p class="yb-admin__empty">' + t('loading') + '</p>';

    db.collection('enrollments').where('userId', '==', uid).get()
      .then(function (snap) {
        if (snap.empty) {
          el.innerHTML = '<p class="yb-admin__empty">' + t('users_no_enrollments') + '</p>';
          return;
        }
        var enrollments = [];
        snap.forEach(function (doc) { enrollments.push(Object.assign({ id: doc.id }, doc.data())); });

        el.innerHTML = enrollments.map(function (en) {
          var course = state.courses.find(function (c) { return c.id === en.courseId; });
          var courseName = course ? (course.title_en || course.title_da) : en.courseId;
          var courseIcon = course ? (course.icon || '📚') : '📚';
          var statusClass = en.status === 'active' ? 'yb-admin__badge--ok' : 'yb-admin__badge--muted';
          var statusLabel = en.status === 'active' ? t('status_active') : t('status_revoked');
          return '<div class="yb-admin__enroll-row">' +
            '<span>' + courseIcon + ' ' + esc(courseName) + '</span>' +
            '<span class="yb-admin__badge ' + statusClass + '">' + statusLabel + '</span>' +
            (en.status === 'active'
              ? '<button class="yb-admin__sm-btn yb-admin__sm-btn--danger" data-action="revoke-user-enroll" data-id="' + en.id + '">' + t('revoke_btn') + '</button>'
              : '<button class="yb-admin__sm-btn" data-action="activate-user-enroll" data-id="' + en.id + '">' + t('enroll_btn') + '</button>') +
          '</div>';
        }).join('');
      })
      .catch(function (err) {
        console.error(err);
        el.innerHTML = '<p class="yb-admin__empty" style="color:#dc2626">' + t('error_load') + '</p>';
      });
  }

  function loadUserProgress(uid, el) {
    if (!el) return;
    el.innerHTML = '<p class="yb-admin__empty">' + t('loading') + '</p>';

    // Try userId field first, fall back to doc ID pattern
    db.collection('courseProgress').where('userId', '==', uid).get()
      .then(function (snap) {
        if (snap.empty) {
          el.innerHTML = '<p class="yb-admin__empty">' + t('users_no_progress') + '</p>';
          return;
        }
        var progressDocs = [];
        snap.forEach(function (doc) { progressDocs.push(Object.assign({ id: doc.id }, doc.data())); });

        el.innerHTML = progressDocs.map(function (p) {
          var courseId = p.courseId || (p.id.indexOf('_') > -1 ? p.id.split('_').slice(1).join('_') : p.id);
          var course = state.courses.find(function (c) { return c.id === courseId; });
          var courseName = course ? (course.title_en || course.title_da) : courseId;

          var viewed = p.viewed || {};
          var keys = Object.keys(viewed);
          var total = keys.length;
          var done = 0;
          keys.forEach(function (k) { if (viewed[k]) done++; });
          var pct = total > 0 ? Math.round((done / total) * 100) : 0;

          return '<div class="yb-admin__student-row">' +
            '<div class="yb-admin__student-info" style="flex:1"><strong>' + esc(courseName) + '</strong></div>' +
            '<div class="yb-admin__student-bar-wrap" style="flex:0 0 100px"><div class="yb-admin__student-bar" style="width:' + pct + '%"></div></div>' +
            '<div class="yb-admin__student-stats"><span>' + done + '/' + total + ' ' + t('student_progress_chapters_read') + '</span> <span>' + pct + '%</span></div>' +
          '</div>';
        }).join('');
      })
      .catch(function () {
        el.innerHTML = '<p class="yb-admin__empty">' + t('users_no_progress') + '</p>';
      });
  }

  function loadUserConsents(uid, el) {
    if (!el) return;
    el.innerHTML = '<p class="yb-admin__empty">' + t('loading') + '</p>';

    db.collection('consents').doc(uid).get()
      .then(function (doc) {
        if (!doc.exists) {
          el.innerHTML = '<p class="yb-admin__empty">' + t('users_no_consents') + '</p>';
          return;
        }
        var c = doc.data();

        var items = [
          { label: t('users_consent_terms'), val: c.terms },
          { label: t('users_consent_privacy'), val: c.privacy },
          { label: t('users_consent_code'), val: c.codeOfConduct }
        ];

        el.innerHTML = items.map(function (item) {
          var accepted = !!item.val;
          var statusClass = accepted ? 'yb-admin__badge--ok' : 'yb-admin__badge--muted';
          var statusLabel = accepted ? t('users_consent_accepted') : t('users_consent_pending');
          var dateStr = '';
          if (item.val && item.val.toDate) {
            dateStr = item.val.toDate().toLocaleDateString('da-DK', { day: '2-digit', month: '2-digit', year: 'numeric' });
          }
          return '<div class="yb-admin__enroll-row">' +
            '<span style="flex:1">' + item.label + '</span>' +
            '<span class="yb-admin__badge ' + statusClass + '">' + statusLabel + '</span>' +
            (dateStr ? '<small style="color:#6F6A66">' + esc(dateStr) + '</small>' : '') +
          '</div>';
        }).join('');
      })
      .catch(function () {
        el.innerHTML = '<p class="yb-admin__empty">' + t('users_no_consents') + '</p>';
      });
  }

  function populateEnrollCourseDropdown() {
    var select = $('yb-admin-user-enroll-course');
    if (!select) return;

    if (!state.courses.length) {
      db.collection('courses').get().then(function (snap) {
        state.courses = [];
        snap.forEach(function (doc) { state.courses.push(Object.assign({ id: doc.id }, doc.data())); });
        fillCourseDropdown(select);
      });
    } else {
      fillCourseDropdown(select);
    }
  }

  function fillCourseDropdown(select) {
    var html = '<option value="">' + t('users_enroll_select') + '</option>';
    state.courses.forEach(function (c) {
      html += '<option value="' + c.id + '">' + (c.icon || '📚') + ' ' + esc(c.title_en || c.title_da) + '</option>';
    });
    select.innerHTML = html;
  }

  function enrollUserFromDetail() {
    var select = $('yb-admin-user-enroll-course');
    var uid = state.userDetailUid;
    if (!select || !uid || !select.value) return;

    var courseId = select.value;
    var u = state.userDetail || {};
    var name = u.name || ((u.firstName || '') + ' ' + (u.lastName || '')).trim() || '';
    var email = u.email || '';

    var docId = uid + '_' + courseId;
    toast(t('saving'));

    db.collection('enrollments').doc(docId).set({
      userId: uid,
      userName: name,
      userEmail: email,
      courseId: courseId,
      enrolledAt: firebase.firestore.FieldValue.serverTimestamp(),
      enrolledBy: 'admin',
      status: 'active'
    }).then(function () {
      toast(t('saved'));
      select.value = '';
      var formWrap = $('yb-admin-user-enroll-form-wrap');
      if (formWrap) formWrap.hidden = true;
      loadUserEnrollments(uid, $('yb-admin-user-enrollments'));
    }).catch(function (err) {
      console.error(err);
      toast(err.message || t('error_save'), true);
    });
  }

  function toggleUserEnrollment(enrollId, newStatus) {
    db.collection('enrollments').doc(enrollId).update({ status: newStatus })
      .then(function () {
        toast(t('saved'));
        if (state.userDetailUid) {
          loadUserEnrollments(state.userDetailUid, $('yb-admin-user-enrollments'));
        }
      })
      .catch(function (err) { console.error(err); toast(t('error_save'), true); });
  }

  function backToUserList() {
    var listView = $('yb-admin-v-user-list');
    var detailView = $('yb-admin-v-user-detail');
    if (listView) listView.hidden = false;
    if (detailView) detailView.hidden = true;
    state.userDetailUid = null;
    state.userDetail = null;
  }

  /* ═══════════════════════════════════════
     EVENT BINDING
     ═══════════════════════════════════════ */
  function bindEvents() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-action');
      var id = btn.getAttribute('data-id');
      var dir = parseInt(btn.getAttribute('data-dir'), 10);
      var idx = parseInt(btn.getAttribute('data-idx'), 10);

      switch (action) {
        case 'new-course': showCourseForm(null); break;
        case 'edit-course': showCourseForm(id); break;
        case 'delete-course': deleteCourse(id); break;
        case 'select-course': selectCourse(id); break;
        case 'back-courses': state.courseId = null; state.moduleId = null; showView('courses'); break;
        case 'toggle-course-status': toggleCourseStatus(id); break;

        case 'new-module': showModuleForm(null); break;
        case 'edit-module': showModuleForm(id); break;
        case 'delete-module': deleteModule(id); break;
        case 'move-module': moveModule(id, dir); break;
        case 'select-module': selectModule(id); break;
        case 'back-modules': state.moduleId = null; showView('modules'); break;

        case 'new-chapter': showChapterForm(null); break;
        case 'edit-chapter': showChapterForm(id); break;
        case 'delete-chapter': deleteChapter(id); break;
        case 'move-chapter': moveChapter(id, dir); break;
        case 'back-chapters': showView('chapters'); break;
        case 'duplicate-chapter': duplicateChapter(id); break;

        case 'bulk-import': showView('bulk'); break;
        case 'bulk-remove':
          state.bulkChapters.splice(idx, 1);
          renderBulkPreview();
          break;

        case 'revoke-enroll': toggleEnrollment(id, 'revoked'); break;
        case 'activate-enroll': toggleEnrollment(id, 'active'); break;

        // User management actions
        case 'view-user': showUserDetail(id); break;
        case 'back-users': backToUserList(); break;
        case 'user-enroll-toggle':
          var enrollWrap = $('yb-admin-user-enroll-form-wrap');
          if (enrollWrap) enrollWrap.hidden = !enrollWrap.hidden;
          break;
        case 'user-enroll-save': enrollUserFromDetail(); break;
        case 'revoke-user-enroll': toggleUserEnrollment(id, 'revoked'); break;
        case 'activate-user-enroll': toggleUserEnrollment(id, 'active'); break;
        case 'suspend-user': suspendUser(btn.getAttribute('data-uid')); break;
        case 'unsuspend-user': unsuspendUser(btn.getAttribute('data-uid')); break;

        // Enhanced user management actions
        case 'users-refresh': usersLoaded = false; loadAllUsers(); usersLoaded = true; break;
        case 'users-export-csv': exportUsersCSV(); break;
        case 'user-bulk-email': bulkUserEmail(); break;
        case 'user-bulk-sms': bulkUserSMS(); break;
        case 'user-bulk-email-selected': bulkUserEmailSelected(); break;
        case 'user-bulk-sms-selected': bulkUserSMSSelected(); break;
        case 'user-bulk-role': bulkUserRole(); break;
        case 'user-deselect-all': deselectAllUsers(); break;
        case 'user-add-note': addUserNote('note'); break;
        case 'user-detail-sms':
          if (state.userDetail && state.userDetail.phone) {
            var smsUser = {
              id: state.userDetailUid,
              first_name: state.userDetail.firstName || state.userDetail.name || '',
              last_name: state.userDetail.lastName || '',
              email: state.userDetail.email || '',
              phone: state.userDetail.phone
            };
            if (typeof window.openSMSCampaign === 'function') {
              window.openSMSCampaign([smsUser]);
            }
          }
          break;
        case 'user-bill':
          if (state.userDetail && typeof window.billingFromUser === 'function') {
            var u = state.userDetail;
            var uName = u.name || ((u.firstName || '') + ' ' + (u.lastName || '')).trim();
            window.billingFromUser({
              name: uName,
              email: u.email || '',
              phone: u.phone || ''
            });
          }
          break;
        case 'user-invoice-lookup':
          if (state.userDetail) loadUserInvoices(state.userDetail);
          break;
        case 'user-invoice-view-draft':
          // Open billing modal for draft via billing-admin
          if (window._ybBillingViewDraft) window._ybBillingViewDraft(btn.dataset.draft);
          break;
        case 'user-invoice-view-booked':
          // Open billing modal for booked via billing-admin
          if (window._ybBillingViewBooked) window._ybBillingViewBooked(btn.dataset.booked);
          break;

        // Rich text toolbar actions
        case 'toolbar-bold': insertTag('bold'); break;
        case 'toolbar-italic': insertTag('italic'); break;
        case 'toolbar-h2': insertTag('h2'); break;
        case 'toolbar-h3': insertTag('h3'); break;
        case 'toolbar-ul': insertTag('ul'); break;
        case 'toolbar-ol': insertTag('ol'); break;
        case 'toolbar-quote': insertTag('quote'); break;
        case 'toolbar-link': insertTag('link'); break;
      }
    });

    // Forms
    var courseForm = $('yb-admin-course-form');
    if (courseForm) courseForm.addEventListener('submit', saveCourse);
    var moduleForm = $('yb-admin-module-form');
    if (moduleForm) moduleForm.addEventListener('submit', saveModule);
    var chapterForm = $('yb-admin-chapter-form');
    if (chapterForm) chapterForm.addEventListener('submit', saveChapter);
    var enrollForm = $('yb-admin-enroll-form');
    if (enrollForm) enrollForm.addEventListener('submit', enrollUser);
    // User search (live filtering)
    var userSearchForm = $('yb-user-search-form');
    if (userSearchForm) {
      userSearchForm.addEventListener('submit', function (e) { e.preventDefault(); });
      var userSearchInput = $('yb-user-search-input');
      if (userSearchInput) {
        userSearchInput.addEventListener('input', function () {
          userSearchTerm = userSearchInput.value.trim();
          renderUserTable();
        });
      }
    }

    // User filters (instant filtering on change)
    ['yb-user-role-filter', 'yb-user-tier-filter', 'yb-user-waiver-filter', 'yb-user-mb-filter'].forEach(function (filterId) {
      var filterEl = $(filterId);
      if (filterEl) {
        filterEl.addEventListener('change', function () {
          if (filterId === 'yb-user-role-filter') userFilterRole = filterEl.value;
          if (filterId === 'yb-user-tier-filter') userFilterTier = filterEl.value;
          if (filterId === 'yb-user-waiver-filter') userFilterWaiver = filterEl.value;
          if (filterId === 'yb-user-mb-filter') userFilterMb = filterEl.value;
          renderUserTable();
        });
      }
    });

    // User select-all checkbox
    var userSelectAllCb = $('yb-user-select-all');
    if (userSelectAllCb) {
      userSelectAllCb.addEventListener('change', function () { toggleUserSelectAll(); });
    }

    // User row checkboxes (delegated)
    document.addEventListener('change', function (e) {
      if (e.target.classList.contains('yb-user-row-cb')) {
        var userId = e.target.getAttribute('data-id');
        if (userId) toggleUserSelect(userId);
      }
      if (e.target.id === 'yb-user-invoice-payment-status') {
        saveUserPaymentStatus(e.target.value);
      }
    });

    // User note form
    var userNoteForm = $('yb-user-note-form');
    if (userNoteForm) {
      userNoteForm.addEventListener('submit', function (e) {
        e.preventDefault();
        addUserNote('note');
      });
    }

    // Bulk buttons
    var bulkPreview = $('yb-admin-bulk-preview-btn');
    if (bulkPreview) bulkPreview.addEventListener('click', parseBulk);
    var bulkCreate = $('yb-admin-bulk-create-btn');
    if (bulkCreate) bulkCreate.addEventListener('click', createBulkChapters);
    var bulkBack = $('yb-admin-bulk-back-btn');
    if (bulkBack) bulkBack.addEventListener('click', function () {
      $('yb-admin-bulk-step1').hidden = false;
      $('yb-admin-bulk-step2').hidden = true;
    });

    // Live preview and word count on textarea input
    document.addEventListener('input', function (e) {
      if (e.target.id === 'yb-chf-content') {
        updatePreview();
        updateWordCount();
      }
    });
  }

  /* ═══════════════════════════════════════
     INIT
     ═══════════════════════════════════════ */
  function init() {
    var wrapper = $('yb-admin');
    if (!wrapper) return;

    T = window._ybAdminT || {};
    lang = window._ybAdminLang || 'da';
    auth = firebase.auth();
    db = firebase.firestore();

    bindEvents();
    bindRoleFormEvents();
    initTabs();

    var gateEl = $('yb-admin-gate');
    var panelEl = $('yb-admin-panel');

    auth.onAuthStateChanged(function (user) {
      if (!user) {
        currentUser = null;
        if (gateEl) gateEl.style.display = '';
        if (panelEl) panelEl.style.display = 'none';
        return;
      }
      currentUser = user;
      if (gateEl) gateEl.style.display = 'none';
      if (panelEl) panelEl.style.display = '';
      loadCourses();
    });
  }

  /* ═══════════════════════════════════════
     BOOTSTRAP
     ═══════════════════════════════════════ */
  var checkInterval = setInterval(function () {
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
      clearInterval(checkInterval);
      init();
    }
  }, 100);

})();
