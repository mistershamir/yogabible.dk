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
    bulkChapters: []
  };

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

            resultEl.innerHTML = html;
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
          lastActiveStr = s.lastActive.toLocaleDateString(lang === 'da' ? 'da-DK' : 'en-US', {
            year: 'numeric', month: 'short', day: 'numeric'
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
    var lookupForm = $('yb-admin-user-lookup-form');
    if (lookupForm) lookupForm.addEventListener('submit', lookupUser);

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
