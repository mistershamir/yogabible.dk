/**
 * YOGA BIBLE — COURSE ADMIN
 * Manage courses, modules, chapters (CRUD + bulk import) & enrollments
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
     SIDEBAR TREE
     ═══════════════════════════════════════ */
  function renderTree() {
    var el = $('yb-admin-tree');
    if (!el) return;
    if (!state.courses.length) { el.innerHTML = '<p class="yb-admin__tree-empty">' + t('no_courses') + '</p>'; return; }

    el.innerHTML = state.courses.map(function (c) {
      var active = c.id === state.courseId ? ' is-active' : '';
      return '<div class="yb-admin__tree-course' + active + '" data-action="select-course" data-id="' + c.id + '">' +
        '<span>' + (c.icon || '📚') + ' ' + esc(c.title_en || c.title_da) + '</span></div>';
    }).join('');
  }

  /* ═══════════════════════════════════════
     COURSES
     ═══════════════════════════════════════ */
  function loadCourses() {
    db.collection('courses').get().then(function (snap) {
      state.courses = [];
      snap.forEach(function (doc) { state.courses.push(Object.assign({ id: doc.id }, doc.data())); });
      renderCourseList();
      renderTree();
    }).catch(function (err) { console.error(err); toast(t('error_load'), true); });
  }

  function renderCourseList() {
    var el = $('yb-admin-course-list');
    if (!el) return;
    if (!state.courses.length) { el.innerHTML = '<p class="yb-admin__empty">' + t('no_courses') + '</p>'; return; }

    el.innerHTML = state.courses.map(function (c) {
      return '<div class="yb-admin__card">' +
        '<div class="yb-admin__card-icon">' + (c.icon || '📚') + '</div>' +
        '<div class="yb-admin__card-body">' +
          '<h3>' + esc(c.title_en || c.title_da) + '</h3>' +
          '<p>' + esc(c.description_en || c.description_da || '') + '</p>' +
          (c.program ? '<span class="yb-admin__badge">' + esc(c.program) + '</span>' : '') +
        '</div>' +
        '<div class="yb-admin__card-actions">' +
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
    $('yb-admin-course-form-title').textContent = c ? t('edit') + ': ' + (c.title_en || c.title_da) : t('new_course');
    showView('course-form');
  }

  function saveCourse(e) {
    e.preventDefault();
    var title = $('yb-cf-title').value.trim();
    var desc = $('yb-cf-desc').value.trim();
    var id = $('yb-cf-id').value || slug(title || 'course');
    var data = {
      title_da: title,
      title_en: title,
      description_da: desc,
      description_en: desc,
      icon: $('yb-cf-icon').value.trim() || '📚',
      program: $('yb-cf-program').value.trim()
    };
    if (!$('yb-cf-id').value) data.createdAt = firebase.firestore.FieldValue.serverTimestamp();

    db.collection('courses').doc(id).set(data, { merge: true })
      .then(function () { toast(t('saved')); loadCourses(); showView('courses'); })
      .catch(function (err) { console.error(err); toast(t('error_save'), true); });
  }

  function deleteCourse(courseId) {
    if (!confirm(t('confirm_delete_course'))) return;
    // Cascade: delete chapters, modules, then course
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
    renderTree();
    loadModules(courseId);
    loadEnrollments(courseId);
    showView('modules');
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
    showView('chapter-form');
  }

  function saveChapter(e) {
    e.preventDefault();
    var title = $('yb-chf-title').value.trim();
    var content = $('yb-chf-content').value;
    var id = $('yb-chf-id').value || slug(title || 'chapter');
    // Ensure unique ID with order prefix
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
     BULK IMPORT
     ═══════════════════════════════════════ */
  function textToHtml(text) {
    var lines = text.split('\n');
    var html = '';
    var inList = false;
    var listType = '';

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();

      // Skip empty lines — close list if open
      if (!line) {
        if (inList) { html += '</' + listType + '>\n'; inList = false; }
        continue;
      }

      // Headings
      if (line.match(/^###\s/)) { if (inList) { html += '</' + listType + '>\n'; inList = false; } html += '<h3>' + esc(line.replace(/^###\s*/, '')) + '</h3>\n'; continue; }
      if (line.match(/^##\s/)) { if (inList) { html += '</' + listType + '>\n'; inList = false; } html += '<h2>' + esc(line.replace(/^##\s*/, '')) + '</h2>\n'; continue; }

      // Bullet list
      if (line.match(/^[-*]\s/)) {
        if (!inList || listType !== 'ul') {
          if (inList) html += '</' + listType + '>\n';
          html += '<ul>\n'; inList = true; listType = 'ul';
        }
        html += '  <li>' + esc(line.replace(/^[-*]\s*/, '')) + '</li>\n';
        continue;
      }

      // Numbered list
      if (line.match(/^\d+[.)]\s/)) {
        if (!inList || listType !== 'ol') {
          if (inList) html += '</' + listType + '>\n';
          html += '<ol>\n'; inList = true; listType = 'ol';
        }
        html += '  <li>' + esc(line.replace(/^\d+[.)]\s*/, '')) + '</li>\n';
        continue;
      }

      // Regular paragraph
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
      // Split on lines starting with ## (or lines that are ALL CAPS and > 3 chars)
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
      // Split on double blank lines
      var parts = text.split(/\n\s*\n\s*\n/);
      parts.forEach(function (part, idx) {
        part = part.trim();
        if (!part) return;
        var firstLine = part.split('\n')[0].trim().replace(/^##\s*/, '');
        var body = part.split('\n').slice(1).join('\n').trim();
        chunks.push({ title: firstLine || ('Chapter ' + (idx + 1)), raw: body || part });
      });
    } else if (splitMode === 'hr') {
      // Split on --- or ===
      var parts = text.split(/\n-{3,}\n|\n={3,}\n/);
      parts.forEach(function (part, idx) {
        part = part.trim();
        if (!part) return;
        var firstLine = part.split('\n')[0].trim().replace(/^##\s*/, '');
        var body = part.split('\n').slice(1).join('\n').trim();
        chunks.push({ title: firstLine || ('Chapter ' + (idx + 1)), raw: body || part });
      });
    }

    // Convert raw text to HTML for each chunk
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

    // Update titles from inputs
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

      // Write same content to both _da and _en fields
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
        // reset bulk UI
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
        snap.forEach(function (doc) { state.enrollments.push(Object.assign({ id: doc.id }, doc.data())); });
        renderEnrollments();
      }).catch(function (err) { console.error(err); });
  }

  function renderEnrollments() {
    var el = $('yb-admin-enroll-list');
    if (!el) return;
    if (!state.enrollments.length) { el.innerHTML = '<p class="yb-admin__empty">' + t('no_enrollments') + '</p>'; return; }

    el.innerHTML = state.enrollments.map(function (e) {
      var statusClass = e.status === 'active' ? 'yb-admin__badge--ok' : 'yb-admin__badge--muted';
      var statusLabel = e.status === 'active' ? t('status_active') : t('status_revoked');
      return '<div class="yb-admin__enroll-row">' +
        '<span>' + esc(e.userId) + '</span>' +
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

    // If it looks like email, find user by email
    var promise;
    if (val.indexOf('@') > -1) {
      promise = db.collection('users').where('email', '==', val).limit(1).get()
        .then(function (snap) {
          if (snap.empty) throw new Error('User not found: ' + val);
          var uid = snap.docs[0].id;
          return uid;
        });
    } else {
      promise = Promise.resolve(val);
    }

    promise.then(function (uid) {
      var docId = uid + '_' + state.courseId;
      return db.collection('enrollments').doc(docId).set({
        userId: uid,
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
      console.error(err);
      toast(err.message || t('error_save'), true);
    });
  }

  function toggleEnrollment(enrollId, newStatus) {
    db.collection('enrollments').doc(enrollId).update({ status: newStatus })
      .then(function () { toast(t('saved')); loadEnrollments(state.courseId); })
      .catch(function (err) { console.error(err); toast(t('error_save'), true); });
  }

  /* ═══════════════════════════════════════
     EVENT BINDING
     ═══════════════════════════════════════ */
  function bindEvents() {
    // Delegated click handler
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
        case 'back-courses': state.courseId = null; state.moduleId = null; renderTree(); showView('courses'); break;

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

        case 'bulk-import': showView('bulk'); break;
        case 'bulk-remove':
          state.bulkChapters.splice(idx, 1);
          renderBulkPreview();
          break;
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

    // Live preview on textarea input
    document.addEventListener('input', function (e) {
      if (e.target.id === 'yb-chf-content') {
        updatePreview();
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

    var gateEl = $('yb-admin-gate');
    var loadingEl = $('yb-admin-loading');
    var panelEl = $('yb-admin-panel');

    auth.onAuthStateChanged(function (user) {
      if (!user) {
        currentUser = null;
        if (gateEl) gateEl.hidden = false;
        if (loadingEl) loadingEl.hidden = true;
        if (panelEl) panelEl.hidden = true;
        return;
      }
      currentUser = user;
      if (gateEl) gateEl.hidden = true;
      if (loadingEl) loadingEl.hidden = true;
      if (panelEl) panelEl.hidden = false;
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
