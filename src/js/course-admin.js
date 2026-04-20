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
  var analyticsLoaded = false;

  /* ═══════════════════════════════════════
     ROLE PROTECTION
     Shared between saveUserRole + bulkUserRole.
     Ordering: lowest → highest priority.
     Must stay in sync with netlify/functions/apply.js ROLE_PRIORITY
     and netlify/functions/applications.js protectedRoles.
     ═══════════════════════════════════════ */
  var ROLE_PRIORITY = ['member', 'student', 'trainee', 'teacher', 'marketing', 'instructor', 'admin', 'owner'];
  var PROTECTED_ROLES = ['admin', 'owner', 'instructor'];

  function getRolePriority(role) {
    var idx = ROLE_PRIORITY.indexOf(role);
    return idx === -1 ? 0 : idx;
  }

  function isProtectedRole(role) {
    return PROTECTED_ROLES.indexOf(role) !== -1;
  }

  // Writes an audit entry to the unified `role_audit` collection.
  // Returns a promise.
  function logRoleAudit(entry) {
    var currentAuthUser = firebase.auth().currentUser;
    var doc = {
      uid: entry.uid,
      email: entry.email || null,
      previousRole: entry.previousRole || 'member',
      previousDetails: entry.previousDetails || {},
      newRole: entry.newRole || 'member',
      newDetails: entry.newDetails || {},
      trigger: entry.trigger || 'admin_manual',
      source: entry.source || 'admin_panel',
      actor_uid: currentAuthUser ? currentAuthUser.uid : 'unknown',
      actor_email: currentAuthUser ? currentAuthUser.email : 'unknown',
      created_at: firebase.firestore.FieldValue.serverTimestamp()
    };
    return db.collection('role_audit').add(doc);
  }

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
     COURSE CATALOGUE (for user role editor)
     ═══════════════════════════════════════ */
  var usersCatalogData = null;
  var usersCatalogLoaded = false;
  var usersCatalogLoading = null;

  function fetchUsersCatalog() {
    if (usersCatalogLoaded) return Promise.resolve(usersCatalogData);
    if (usersCatalogLoading) return usersCatalogLoading;
    usersCatalogLoading = fetch('/.netlify/functions/catalog')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        usersCatalogData = (data && data.ok && Array.isArray(data.catalog)) ? data.catalog : [];
        usersCatalogLoaded = true;
        usersCatalogLoading = null;
        return usersCatalogData;
      })
      .catch(function (err) {
        console.warn('[course-admin] catalog fetch failed:', err.message);
        usersCatalogData = [];
        usersCatalogLoaded = true;
        usersCatalogLoading = null;
        return usersCatalogData;
      });
    return usersCatalogLoading;
  }

  // Cohort suffix mirrors activate-applicant.buildCohortId & live-admin.cohortSuffixFromCourseId.
  function cohortSuffixForCourseId(courseId) {
    if (!courseId) return '';
    var c = String(courseId).toUpperCase();
    if (c.indexOf('YTT200-18W') === 0) return '-18W';
    if (c === 'YTT200-4W-VP') return '';
    if (c.indexOf('YTT200-4W') === 0) return '-4W';
    if (c.indexOf('YTT200-8W') === 0) return '-8W';
    if (c.indexOf('YTT300') === 0) return '-300H';
    if (c.indexOf('YTT500') === 0) return '-500H';
    return '';
  }

  function deriveProgramFromCourseId(courseId) {
    if (!courseId) return '';
    var c = String(courseId).toUpperCase();
    if (c.indexOf('YTT100') === 0) return '100h';
    if (c.indexOf('YTT200') === 0) return '200h';
    if (c.indexOf('YTT300') === 0) return '300h';
    if (c.indexOf('YTT500') === 0) return '500h';
    return '';
  }

  function deriveMethodFromCourseId(courseId) {
    if (!courseId) return '';
    var c = String(courseId).toUpperCase();
    if (c === 'YTT200-4W-VP') return 'vinyasa';
    if (c.indexOf('YTT200-4W') === 0) return 'triangle';
    if (c.indexOf('YTT200-8W') === 0) return 'triangle';
    if (c.indexOf('YTT200-18W') === 0) return 'triangle';
    if (c.indexOf('YTT300') === 0) return ''; // overridable — depends on specialization
    return '';
  }

  function isMethodDerivable(courseId) {
    if (!courseId) return false;
    var c = String(courseId).toUpperCase();
    return c.indexOf('YTT300') !== 0; // everything except 300h has a fixed method
  }

  function getEducationPrograms() {
    if (!usersCatalogData) return [];
    var seen = {}; var out = [];
    for (var i = 0; i < usersCatalogData.length; i++) {
      var row = usersCatalogData[i];
      if (!row.course_id || !row.active) continue;
      if (row.category !== 'Education') continue;
      if (seen[row.course_id]) continue;
      seen[row.course_id] = true;
      out.push({ course_id: row.course_id, course_name: row.course_name || row.course_id });
    }
    out.sort(function (a, b) { return a.course_name.localeCompare(b.course_name); });
    return out;
  }

  function getCohortsForCourseId(courseId) {
    if (!usersCatalogData || !courseId) return [];
    var out = [];
    var suffix = cohortSuffixForCourseId(courseId);
    for (var i = 0; i < usersCatalogData.length; i++) {
      var row = usersCatalogData[i];
      if (row.course_id !== courseId || !row.active) continue;
      if (!row.cohort_id) continue;
      out.push({
        cohort_id: row.cohort_id,
        cohort_label: row.cohort_label || row.cohort_id,
        buildId: row.cohort_id + suffix
      });
    }
    // De-dupe by buildId
    var seen = {}; var uniq = [];
    for (var j = 0; j < out.length; j++) { if (!seen[out[j].buildId]) { seen[out[j].buildId] = true; uniq.push(out[j]); } }
    // Sort by cohort_id descending (newest first)
    uniq.sort(function (a, b) { return b.cohort_id.localeCompare(a.cohort_id); });
    return uniq;
  }

  /* ═══════════════════════════════════════
     TAB SWITCHING (sidebar navigation)
     with History API routing
     ═══════════════════════════════════════ */

  // Routing map: URL slug ↔ tab name
  var ROUTE_TO_TAB = {
    'analytics': 'analytics',
    'leads': 'leads',
    'applications': 'applications',
    'users': 'users',
    'courses': 'courses',
    'catalog': 'catalog',
    'documents': 'documents',
    'knowledge': 'knowledge',
    'campaigns': 'email-lists',
    'ads': 'ads',
    'careers': 'careers',
    'social': 'social',
    'appointments': 'appointments',
    'live': 'live',
    'billing': 'billing',
    'nurture': 'email-lists',
    'email-lists': 'email-lists'
  };

  // Reverse: tab name → URL slug (prefer canonical slug)
  var TAB_TO_ROUTE = {
    'analytics': 'analytics',
    'leads': 'leads',
    'applications': 'applications',
    'users': 'users',
    'courses': 'courses',
    'catalog': 'catalog',
    'documents': 'documents',
    'knowledge': 'knowledge',
    'email-lists': 'campaigns',
    'ads': 'ads',
    'careers': 'careers',
    'social': 'social',
    'appointments': 'appointments',
    'live': 'live',
    'billing': 'billing'
  };

  // Language prefix — detected once from the initial URL
  var langPrefix = window.location.pathname.indexOf('/en/') === 0 ? '/en' : '';

  function getLangPrefix(path) {
    return (path || window.location.pathname).indexOf('/en/') === 0 ? '/en' : '';
  }

  function buildAdminUrl(routeSlug) {
    var prefix = langPrefix;
    return routeSlug === 'analytics' ? prefix + '/admin/' : prefix + '/admin/' + routeSlug + '/';
  }

  function getTabFromUrl(path) {
    var p = (path || window.location.pathname).replace(/\/+$/, '');
    // Strip /en prefix if present
    if (p.indexOf('/en/') === 0) p = p.substring(3);
    var parts = p.split('/').filter(Boolean); // e.g. ['admin', 'leads']
    if (parts.length >= 2 && parts[0] === 'admin') {
      var slug = parts[1];
      return ROUTE_TO_TAB[slug] || 'analytics';
    }
    return 'analytics';
  }

  function activateTab(tabName, pushState) {
    // Toggle active on nav items
    document.querySelectorAll('[data-yb-admin-tab]').forEach(function (b) { b.classList.remove('is-active'); });
    var btn = document.querySelector('[data-yb-admin-tab="' + tabName + '"]');
    if (btn) btn.classList.add('is-active');

    // Toggle active on panels
    document.querySelectorAll('[data-yb-admin-panel]').forEach(function (p) { p.classList.remove('is-active'); });
    var panel = document.querySelector('[data-yb-admin-panel="' + tabName + '"]');
    if (panel) panel.classList.add('is-active');

    // Push URL if requested (not on popstate or initial load)
    if (pushState) {
      var routeSlug = TAB_TO_ROUTE[tabName] || tabName;
      var url = buildAdminUrl(routeSlug);
      if (window.location.pathname !== url) {
        history.pushState({ tab: tabName }, '', url);
      }
    }

    // Lazy loaders
    if (tabName === 'users' && !usersLoaded) {
      loadAllUsers();
      usersLoaded = true;
    }
    if (tabName === 'analytics' && !analyticsLoaded) {
      loadAnalytics();
      loadConversionAnalytics();
      analyticsLoaded = true;
    }
  }

  function initTabs() {
    var sidebar = document.getElementById('yb-admin-sidebar');
    var toggleBtn = document.getElementById('yb-admin-sidebar-toggle');

    // Add overlay element for mobile
    if (sidebar && !document.getElementById('yb-admin-sidebar-overlay')) {
      var overlay = document.createElement('div');
      overlay.className = 'yb-admin__sidebar-overlay';
      overlay.id = 'yb-admin-sidebar-overlay';
      sidebar.parentNode.insertBefore(overlay, sidebar);
      overlay.addEventListener('click', closeSidebar);
    }

    // Mobile sidebar toggle
    if (toggleBtn) {
      toggleBtn.addEventListener('click', function () {
        if (sidebar.classList.contains('is-open')) {
          closeSidebar();
        } else {
          openSidebar();
        }
      });
    }

    // Close button inside sidebar
    var closeBtn = document.getElementById('yb-admin-sidebar-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', closeSidebar);
    }

    function openSidebar() {
      if (sidebar) sidebar.classList.add('is-open');
      if (toggleBtn) toggleBtn.classList.add('is-hidden');
      var ov = document.getElementById('yb-admin-sidebar-overlay');
      if (ov) ov.classList.add('is-visible');
    }

    function closeSidebar() {
      if (sidebar) sidebar.classList.remove('is-open');
      if (toggleBtn) toggleBtn.classList.remove('is-hidden');
      var ov = document.getElementById('yb-admin-sidebar-overlay');
      if (ov) ov.classList.remove('is-visible');
    }

    // Tab click handlers — pushState + activate
    document.querySelectorAll('[data-yb-admin-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tabName = btn.getAttribute('data-yb-admin-tab');
        activateTab(tabName, true);
        closeSidebar();
      });
    });

    // Browser back/forward
    window.addEventListener('popstate', function () {
      // Update prefix in case back/forward crosses language boundary
      langPrefix = getLangPrefix();
      activateTab(getTabFromUrl(), false);
    });

    // Initial load — activate tab from URL
    var initialTab = getTabFromUrl();
    activateTab(initialTab, false);
    // Replace current history entry so back works correctly
    var initialSlug = TAB_TO_ROUTE[initialTab] || initialTab;
    var initialUrl = buildAdminUrl(initialSlug);
    history.replaceState({ tab: initialTab }, '', initialUrl);
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
    fetchUsersCatalog(); // kick off in background

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

            // Append role editor — wait for catalogue so program dropdown is populated
            return fetchUsersCatalog().then(function () {
              html += renderRoleEditor(uid, u);
              resultEl.innerHTML = html;

              // Bind role form submit + trainee dynamic handlers
              var roleForm = $('yb-admin-role-form');
              if (roleForm) roleForm.addEventListener('submit', saveUserRole);
              bindRoleEditorHandlers(u);
            });
          });
      })
      .catch(function (err) {
        console.error('Lookup error:', err);
        resultEl.innerHTML = '<p class="yb-admin__empty" style="color:#dc2626">' + (err.message || t('error_load')) + '</p>';
      });
  }

  /* ═══════════════════════════════════════
     COMPREHENSIVE ANALYTICS DASHBOARD
     7 rows, parallel Firestore loading
     ═══════════════════════════════════════ */
  var convPeriodDays = 7;

  // Shared data cache — populated once, re-filtered on period change
  var yaCache = {
    leads: null, applications: null, funnelDocs: null, conversionDocs: null,
    emailLogs: null, emailBounces: null, emailTracking: null,
    sequences: null, seqEnrollments: null
  };

  // Firestore timestamp → JS Date
  function toDate(v) {
    if (!v) return null;
    if (v.toDate) return v.toDate();
    if (typeof v === 'string') return new Date(v);
    if (v.seconds) return new Date(v.seconds * 1000);
    return null;
  }

  function cutoffDate() {
    if (!convPeriodDays) return null;
    var d = new Date(); d.setDate(d.getDate() - convPeriodDays); return d;
  }

  function fmtNum(n) { return (n || 0).toLocaleString('da-DK'); }
  function fmtDKK(n) { return (n || 0).toLocaleString('da-DK') + ' kr'; }
  function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : 0; }

  function fetchCol(name) {
    return db.collection(name).get().then(function (snap) {
      var arr = [];
      snap.forEach(function (doc) { arr.push(Object.assign({ _id: doc.id }, doc.data())); });
      return arr;
    }).catch(function () { return []; });
  }

  function statCard(value, label, colorClass) {
    return '<div class="ya-stat' + (colorClass ? ' ya-stat--' + colorClass : '') + '">' +
      '<span class="ya-stat__value">' + value + '</span>' +
      '<span class="ya-stat__label">' + label + '</span></div>';
  }

  /* ── Main loader ── */
  function loadAnalytics() {
    // Fetch all data in parallel (only once — cache it)
    var needsFetch = !yaCache.leads;
    var p = needsFetch ? Promise.all([
      fetchCol('leads').then(function (d) { yaCache.leads = d; }),
      fetchCol('applications').then(function (d) { yaCache.applications = d; }),
      fetchCol('lead_funnel').then(function (d) { yaCache.funnelDocs = d; }),
      fetchCol('ad_conversions').then(function (d) { yaCache.conversionDocs = d; }),
      fetchCol('email_log').then(function (d) { yaCache.emailLogs = d; }),
      fetchCol('email_bounces').then(function (d) { yaCache.emailBounces = d; }),
      fetchCol('email_tracking').then(function (d) { yaCache.emailTracking = d; }),
      fetchCol('sequences').then(function (d) { yaCache.sequences = d; }),
      fetchCol('sequence_enrollments').then(function (d) { yaCache.seqEnrollments = d; })
    ]) : Promise.resolve();

    p.then(function () {
      renderRow1KPI();
      renderRow2Pipeline();
      renderRow3Sources();
      renderRow4Cohort();
      renderRow5Email();
      renderRow6Engagement();
      renderRow7Revenue();
    }).catch(function (err) {
      console.error('Analytics load error:', err);
    });
  }

  function loadConversionAnalytics() {
    // Now handled by loadAnalytics — this is called for period changes
    loadAnalytics();
  }

  /* ── ROW 1: KPI Stat Cards ── */
  function renderRow1KPI() {
    var el = $('ya-row-kpi');
    if (!el) return;
    var cut = cutoffDate();
    var leads = yaCache.leads || [];
    var apps = yaCache.applications || [];
    var convDocs = yaCache.conversionDocs || [];
    var emailLogs = yaCache.emailLogs || [];

    // New leads in period
    var newLeads = leads.filter(function (l) {
      if (!cut) return true;
      var d = toDate(l.created_at);
      return d && d >= cut;
    }).length;

    // Open applications (all-time)
    var closedStatuses = ['archived', 'enrolled', 'rejected'];
    var openApps = apps.filter(function (a) { return closedStatuses.indexOf(a.status) === -1; }).length;

    // Revenue from ad_conversions
    var purchases = convDocs.filter(function (c) {
      if (c.conversion_action !== 'purchase') return false;
      if (!cut) return true;
      var d = toDate(c.created_at) || (c.created_at ? new Date(c.created_at) : null);
      return d && d >= cut;
    });
    var revenue = 0;
    purchases.forEach(function (c) { revenue += (c.value || 0); });

    // Email open rate
    var periodEmails = emailLogs.filter(function (e) {
      if (!cut) return true;
      var d = toDate(e.sent_at);
      return d && d >= cut;
    });
    var sent = periodEmails.length;
    var opened = periodEmails.filter(function (e) { return e.status === 'opened'; }).length;
    var openRate = pct(opened, sent);

    el.innerHTML =
      '<div class="ya-cards">' +
        statCard(fmtNum(newLeads), t('ya_kpi_new_leads'), 'orange') +
        statCard(fmtNum(openApps), t('ya_kpi_open_apps')) +
        statCard(fmtDKK(revenue), t('ya_kpi_revenue'), 'green') +
        statCard(openRate + '%', t('ya_kpi_open_rate')) +
      '</div>';
  }

  /* ── ROW 2: Lead Pipeline Funnel ── */
  function renderRow2Pipeline() {
    var el = $('ya-row-pipeline');
    if (!el) return;
    var leads = yaCache.leads || [];

    // Count by status
    var statusMap = {};
    leads.forEach(function (l) {
      var s = (l.status || 'New').toLowerCase();
      statusMap[s] = (statusMap[s] || 0) + 1;
    });

    var stages = [
      { key: 'new', label: t('ya_pipe_new'), color: '#E8E4E0', textDark: true },
      { key: 'contacted', label: t('ya_pipe_contacted'), color: '#fed7aa' , textDark: true },
      { key: 'qualified', label: t('ya_pipe_qualified'), color: '#ff9966' },
      { key: 'applied', label: t('ya_pipe_applied'), color: '#f75c03' },
      { key: 'accepted', label: t('ya_pipe_accepted'), color: '#d94f02' },
      { key: 'converted', label: t('ya_pipe_converted'), color: '#16a34a' },
      { key: 'enrolled', label: t('ya_pipe_enrolled'), color: '#16a34a' }
    ];

    // Also count applications statuses for applied/accepted
    var apps = yaCache.applications || [];
    var appPending = apps.filter(function (a) { return !a.status || a.status === 'pending' || a.status === 'submitted'; }).length;
    var appAccepted = apps.filter(function (a) { return a.status === 'accepted'; }).length;

    var counts = {};
    stages.forEach(function (s) { counts[s.key] = statusMap[s.key] || 0; });
    // Supplement with application data
    if (appPending > counts.applied) counts.applied = appPending;
    if (appAccepted > counts.accepted) counts.accepted = appAccepted;

    var total = leads.length || 1;
    var maxCount = 0;
    stages.forEach(function (s) { if (counts[s.key] > maxCount) maxCount = counts[s.key]; });
    if (!maxCount) maxCount = 1;

    var title = el.querySelector('.ya-title');
    var html = title ? title.outerHTML : '';
    html += '<div class="ya-funnel">';
    stages.forEach(function (s) {
      var c = counts[s.key];
      var w = Math.max(pct(c, maxCount), 6);
      html += '<div class="ya-funnel__row">' +
        '<span class="ya-funnel__label">' + s.label + '</span>' +
        '<div class="ya-funnel__track">' +
          '<div class="ya-funnel__bar" style="width:' + w + '%;background:' + s.color + '">' +
            '<span class="ya-funnel__count' + (s.textDark ? ' ya-funnel__count--dark' : '') + '">' + c + '</span>' +
          '</div>' +
        '</div>' +
        '<span class="ya-funnel__pct">' + pct(c, total) + '%</span>' +
      '</div>';
    });
    html += '</div>';
    el.innerHTML = html;
  }

  /* ── ROW 3: Lead Sources ── */
  function renderRow3Sources() {
    var el = $('ya-row-sources');
    if (!el) return;
    var leads = yaCache.leads || [];
    var cut = cutoffDate();

    // All-time source counts
    var sourceMap = {};
    leads.forEach(function (l) {
      var s = (l.source || 'other').toLowerCase();
      if (s === 'facebook' || s === 'meta') s = 'meta';
      else if (s === 'website' || s === 'web') s = 'website';
      else if (s === 'manual' || s === 'admin') s = 'manual';
      else if (s !== 'instagram' && s !== 'google') s = 'other';
      sourceMap[s] = (sourceMap[s] || 0) + 1;
    });

    var totalLeads = leads.length || 1;
    var sourceOrder = ['meta', 'website', 'instagram', 'google', 'manual', 'other'];
    var sourceColors = { meta: '#1877F2', website: '#f75c03', instagram: '#E1306C', google: '#34A853', manual: '#6F6A66', other: '#a8a29e' };
    var sourceLabels = { meta: 'Meta Ads', website: t('ya_src_website'), instagram: 'Instagram', google: 'Google', manual: t('ya_src_manual'), other: t('ya_src_other') };

    // Build conic-gradient segments
    var segments = [];
    var acc = 0;
    sourceOrder.forEach(function (s) {
      var c = sourceMap[s] || 0;
      if (c > 0) {
        var p = (c / totalLeads) * 100;
        segments.push({ source: s, count: c, pct: p, start: acc, color: sourceColors[s] });
        acc += p;
      }
    });

    var conicStops = segments.map(function (s) {
      return s.color + ' ' + s.start.toFixed(1) + '% ' + (s.start + s.pct).toFixed(1) + '%';
    }).join(', ');

    // Weekly trend (last 8 weeks)
    var weekBuckets = [];
    for (var wi = 7; wi >= 0; wi--) {
      var wStart = new Date(); wStart.setDate(wStart.getDate() - (wi + 1) * 7);
      var wEnd = new Date(); wEnd.setDate(wEnd.getDate() - wi * 7);
      weekBuckets.push({ start: wStart, end: wEnd, label: wStart.toLocaleDateString('da-DK', { day: 'numeric', month: 'short' }), meta: 0, website: 0, other: 0, total: 0 });
    }
    leads.forEach(function (l) {
      var d = toDate(l.created_at);
      if (!d) return;
      var s = (l.source || 'other').toLowerCase();
      if (s === 'facebook' || s === 'meta') s = 'meta';
      else if (s === 'website' || s === 'web') s = 'website';
      else s = 'other';
      weekBuckets.forEach(function (b) {
        if (d >= b.start && d < b.end) {
          b[s] = (b[s] || 0) + 1;
          b.total++;
        }
      });
    });

    var title = el.querySelector('.ya-title');
    var html = title ? title.outerHTML : '';
    html += '<div class="ya-split">';

    // Left: donut
    html += '<div class="ya-donut-wrap">' +
      '<div class="ya-donut" style="background:conic-gradient(' + (conicStops || '#E8E4E0 0% 100%') + ')"></div>' +
      '<div class="ya-donut__legend">';
    segments.forEach(function (s) {
      html += '<div class="ya-donut__item">' +
        '<span class="ya-donut__dot" style="background:' + s.color + '"></span>' +
        '<span>' + (sourceLabels[s.source] || s.source) + '</span>' +
        '<strong>' + s.count + ' (' + Math.round(s.pct) + '%)</strong></div>';
    });
    html += '</div></div>';

    // Right: weekly trend table
    html += '<div class="ya-trend-wrap"><table class="yb-admin__table ya-trend-table"><thead><tr>' +
      '<th>' + t('ya_week') + '</th><th>Meta</th><th>' + t('ya_src_website') + '</th><th>' + t('ya_src_other') + '</th><th>Total</th>' +
      '</tr></thead><tbody>';
    weekBuckets.forEach(function (b) {
      html += '<tr><td>' + b.label + '</td><td>' + b.meta + '</td><td>' + b.website + '</td><td>' + b.other + '</td>' +
        '<td><strong>' + b.total + '</strong></td></tr>';
    });
    html += '</tbody></table></div></div>';
    el.innerHTML = html;
  }

  /* ── ROW 4: Cohort Health ── */
  function renderRow4Cohort() {
    var el = $('ya-row-cohort');
    if (!el) return;
    var leads = yaCache.leads || [];
    var apps = yaCache.applications || [];
    var funnelDocs = yaCache.funnelDocs || [];

    var cohorts = [
      { name: '4W Intensive (Apr)', keys: ['4-week', '4w', '4-week-intensive'], capacity: 12 },
      { name: '4W Vinyasa Plus (Jul)', keys: ['4-week-jul', '4w-jul', 'vinyasa-plus'], capacity: 18 },
      { name: '8W Semi-Intensive (May-Jun)', keys: ['8-week', '8w', '8-week-semi'], capacity: 16 },
      { name: '18W Flexible (Aug-Dec)', keys: ['18-week-aug', '18w-aug', '18-week-flexible-aug'], capacity: 24 },
      { name: '300h Advanced', keys: ['300h', '300-hour', 'advanced'], capacity: 12 }
    ];

    function matchKeys(val, keys) {
      if (!val) return false;
      var v = val.toLowerCase();
      return keys.some(function (k) { return v.indexOf(k) !== -1; });
    }

    var title = el.querySelector('.ya-title');
    var html = title ? title.outerHTML : '';
    html += '<div class="yb-admin__table-wrap"><table class="yb-admin__table"><thead><tr>' +
      '<th>' + t('ya_cohort_program') + '</th>' +
      '<th>' + t('ya_cohort_cap') + '</th>' +
      '<th>' + t('ya_cohort_leads') + '</th>' +
      '<th>' + t('ya_cohort_apps') + '</th>' +
      '<th>' + t('ya_cohort_enrolled') + '</th>' +
      '<th>' + t('ya_cohort_fill') + '</th>' +
      '</tr></thead><tbody>';

    cohorts.forEach(function (c) {
      var lCount = leads.filter(function (l) { return matchKeys(l.ytt_program_type || l.type, c.keys); }).length;
      var aCount = apps.filter(function (a) { return matchKeys(a.ytt_program_type || a.course_id, c.keys); }).length;
      var eCount = funnelDocs.filter(function (f) {
        return f.funnel_stage === 'purchased' && matchKeys(f.programName || f.programId, c.keys);
      }).length;
      var fillPct = pct(eCount, c.capacity);
      var fillColor = fillPct >= 80 ? '#16a34a' : fillPct >= 50 ? '#f75c03' : '#dc2626';

      html += '<tr>' +
        '<td><strong>' + c.name + '</strong></td>' +
        '<td>' + c.capacity + '</td>' +
        '<td>' + lCount + '</td>' +
        '<td>' + aCount + '</td>' +
        '<td>' + eCount + '</td>' +
        '<td><div class="ya-fill-cell">' +
          '<div class="ya-fill-bar"><div class="ya-fill-bar__inner" style="width:' + Math.min(fillPct, 100) + '%;background:' + fillColor + '"></div></div>' +
          '<span class="ya-fill-pct" style="color:' + fillColor + '">' + fillPct + '%</span>' +
        '</div></td>' +
      '</tr>';
    });
    html += '</tbody></table></div>';
    el.innerHTML = html;
  }

  /* ── ROW 5: Email & Sequence Performance ── */
  function renderRow5Email() {
    var el = $('ya-row-email');
    if (!el) return;
    var cut = cutoffDate();
    var logs = yaCache.emailLogs || [];
    var bounces = yaCache.emailBounces || [];
    var tracking = yaCache.emailTracking || [];
    var sequences = yaCache.sequences || [];
    var enrollments = yaCache.seqEnrollments || [];

    // Period-filtered email stats
    var periodLogs = logs.filter(function (e) {
      if (!cut) return true;
      var d = toDate(e.sent_at);
      return d && d >= cut;
    });

    var totalSent = periodLogs.length;
    var totalOpened = periodLogs.filter(function (e) { return e.status === 'opened'; }).length;
    var periodBounces = bounces.filter(function (b) {
      if (!cut) return true;
      var d = toDate(b.created_at || b.bounced_at);
      return d && d >= cut;
    }).length;
    var periodClicks = tracking.filter(function (t) {
      if (!cut) return true;
      var d = toDate(t.clicked_at || t.created_at);
      return d && d >= cut;
    }).length;

    var title = el.querySelector('.ya-title');
    var html = title ? title.outerHTML : '';

    // Mini stat cards
    html += '<div class="ya-cards ya-cards--mini">' +
      statCard(fmtNum(totalSent), t('ya_email_sent')) +
      statCard(pct(totalOpened, totalSent) + '%', t('ya_email_open_rate'), 'green') +
      statCard(pct(periodBounces, totalSent) + '%', t('ya_email_bounce'), 'red') +
      statCard(pct(periodClicks, totalSent) + '%', t('ya_email_click_rate'), 'orange') +
    '</div>';

    // Sequence performance table
    html += '<h4 class="ya-subtitle">' + t('ya_seq_title') + '</h4>';

    // Build sequence name map
    var seqNameMap = {};
    sequences.forEach(function (s) { seqNameMap[s._id] = s.name || s._id; });

    // Group enrollments by sequence_id
    var seqGroups = {};
    enrollments.forEach(function (e) {
      var sid = e.sequence_id;
      if (!sid) return;
      if (!seqGroups[sid]) seqGroups[sid] = { active: 0, completed: 0, converted: 0, cancelled: 0, total: 0 };
      seqGroups[sid].total++;
      var st = (e.status || 'active').toLowerCase();
      if (st === 'active') seqGroups[sid].active++;
      else if (st === 'completed') seqGroups[sid].completed++;
      else if (st === 'converted') seqGroups[sid].converted++;
      else if (st === 'cancelled') seqGroups[sid].cancelled++;
    });

    var seqIds = Object.keys(seqGroups);
    if (seqIds.length) {
      html += '<div class="yb-admin__table-wrap"><table class="yb-admin__table"><thead><tr>' +
        '<th>' + t('ya_seq_name') + '</th><th>' + t('ya_seq_active') + '</th>' +
        '<th>' + t('ya_seq_completed') + '</th><th>' + t('ya_seq_converted') + '</th>' +
        '<th>' + t('ya_seq_cancelled') + '</th><th>' + t('ya_seq_completion_rate') + '</th>' +
        '<th>' + t('ya_seq_conversion_rate') + '</th></tr></thead><tbody>';

      seqIds.forEach(function (sid) {
        var g = seqGroups[sid];
        var compRate = pct(g.completed + g.converted, g.total);
        var convRate = pct(g.converted, g.total);
        html += '<tr>' +
          '<td><strong>' + esc(seqNameMap[sid] || sid.substring(0, 12) + '...') + '</strong></td>' +
          '<td>' + g.active + '</td><td>' + g.completed + '</td>' +
          '<td><span class="ya-badge ya-badge--green">' + g.converted + '</span></td>' +
          '<td>' + g.cancelled + '</td>' +
          '<td>' + compRate + '%</td>' +
          '<td><strong style="color:#16a34a">' + convRate + '%</strong></td></tr>';
      });
      html += '</tbody></table></div>';
    } else {
      html += '<p class="yb-admin__empty">' + t('ya_no_data') + '</p>';
    }

    el.innerHTML = html;
  }

  /* ── ROW 6: Lead Engagement Summary ── */
  function renderRow6Engagement() {
    var el = $('ya-row-engagement');
    if (!el) return;
    var leads = yaCache.leads || [];
    var now = new Date();
    var fourteenDaysAgo = new Date(); fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    var highEngagement = 0;
    var scheduleViewers = 0;
    var reEngaged = 0;
    var coldLeads = 0;

    leads.forEach(function (l) {
      var ec = (l.email_engagement && l.email_engagement.total_clicks) || 0;
      var sp = (l.site_engagement && l.site_engagement.total_pageviews) || 0;
      if (ec >= 3 && sp >= 3) highEngagement++;

      var sv = (l.schedule_engagement && l.schedule_engagement.total_visits) || 0;
      if (sv >= 1) scheduleViewers++;

      if (l.re_engaged) reEngaged++;

      var la = toDate(l.last_activity);
      if (la && la < fourteenDaysAgo) coldLeads++;
      else if (!la && l.created_at) {
        var ca = toDate(l.created_at);
        if (ca && ca < fourteenDaysAgo) coldLeads++;
      }
    });

    var title = el.querySelector('.ya-title');
    var html = title ? title.outerHTML : '';
    html += '<div class="ya-cards">' +
      statCard(fmtNum(highEngagement), t('ya_eng_high'), 'green') +
      statCard(fmtNum(scheduleViewers), t('ya_eng_schedule'), 'orange') +
      statCard(fmtNum(reEngaged), t('ya_eng_reengaged')) +
      statCard(fmtNum(coldLeads), t('ya_eng_cold'), 'red') +
    '</div>';
    el.innerHTML = html;
  }

  /* ── ROW 7: Revenue & Conversions (preserved logic) ── */
  function renderRow7Revenue() {
    var el = $('ya-row-revenue');
    if (!el) return;
    var cut = cutoffDate();
    var funnelDocs = yaCache.funnelDocs || [];
    var conversionDocs = yaCache.conversionDocs || [];

    var filteredFunnel = funnelDocs;
    if (cut) {
      filteredFunnel = funnelDocs.filter(function (d) {
        var ts = toDate(d.createdAt) || (d.cta_timestamp ? new Date(d.cta_timestamp) : null);
        return !ts || ts >= cut;
      });
    }

    // Count funnel stages
    var stages = { cta_click: 0, auth_complete: 0, checkout_opened: 0, purchased: 0, checkout_abandoned: 0 };
    var productPurchases = {};

    filteredFunnel.forEach(function (d) {
      if (d.cta_click_at || (d.history && d.history.some(function (h) { return h.stage === 'cta_click'; }))) stages.cta_click++;
      if (d.auth_complete_at) stages.auth_complete++;
      if (d.checkout_opened_at) stages.checkout_opened++;
      if (d.funnel_stage === 'purchased') {
        stages.purchased++;
        var pName = d.programName || d.programId || 'Unknown';
        productPurchases[pName] = (productPurchases[pName] || 0) + 1;
      }
      if (d.funnel_stage === 'checkout_abandoned') stages.checkout_abandoned++;
    });

    // Source breakdown from ad_conversions
    var filteredConv = conversionDocs;
    if (cut) {
      filteredConv = conversionDocs.filter(function (c) {
        var d = toDate(c.created_at) || (c.created_at ? new Date(c.created_at) : null);
        return !d || d >= cut;
      });
    }
    var sources = { meta: 0, google: 0, organic: 0 };
    filteredConv.forEach(function (c) {
      if (c.conversion_action !== 'purchase') return;
      if (c.platform === 'meta') sources.meta++;
      else if (c.platform === 'google') sources.google++;
      else sources.organic++;
    });

    var title = el.querySelector('.ya-title');
    var html = title ? title.outerHTML : '';

    // Purchase funnel
    html += '<h4 class="ya-subtitle">' + t('conv_funnel_title') + '</h4>';
    var funnelStages = [
      { label: t('conv_funnel_cta'), count: stages.cta_click, color: '#E8E4E0', textDark: true },
      { label: t('conv_funnel_auth'), count: stages.auth_complete, color: '#ff9966' },
      { label: t('conv_funnel_checkout'), count: stages.checkout_opened, color: '#f75c03' },
      { label: t('conv_funnel_purchased'), count: stages.purchased, color: '#16a34a' },
      { label: t('conv_funnel_abandoned'), count: stages.checkout_abandoned, color: '#dc2626' }
    ];
    var maxC = Math.max.apply(null, funnelStages.map(function (s) { return s.count; })) || 1;

    html += '<div class="ya-funnel" style="margin-bottom:24px">';
    funnelStages.forEach(function (s) {
      var w = Math.max(Math.round((s.count / maxC) * 100), 6);
      html += '<div class="ya-funnel__row">' +
        '<span class="ya-funnel__label">' + s.label + '</span>' +
        '<div class="ya-funnel__track">' +
          '<div class="ya-funnel__bar" style="width:' + w + '%;background:' + s.color + '">' +
            '<span class="ya-funnel__count' + (s.textDark ? ' ya-funnel__count--dark' : '') + '">' + s.count + '</span>' +
          '</div>' +
        '</div>' +
      '</div>';
    });
    html += '</div>';

    // Products + Sources side by side
    html += '<div class="ya-split">';

    // By product
    html += '<div><h4 class="ya-subtitle">' + t('conv_by_product') + '</h4>';
    var prodKeys = Object.keys(productPurchases).sort(function (a, b) { return productPurchases[b] - productPurchases[a]; });
    if (!prodKeys.length) {
      html += '<p class="yb-admin__empty" style="font-size:13px">' + t('conv_no_data') + '</p>';
    } else {
      prodKeys.forEach(function (name) {
        html += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #E8E4E0;font-size:13px">' +
          '<span>' + esc(name) + '</span><span style="font-weight:700;color:#f75c03">' + productPurchases[name] + '</span></div>';
      });
    }
    html += '</div>';

    // By source
    html += '<div><h4 class="ya-subtitle">' + t('conv_by_source') + '</h4>';
    var totalSourced = sources.meta + sources.google + sources.organic;
    if (!totalSourced) {
      html += '<p class="yb-admin__empty" style="font-size:13px">' + t('conv_no_data') + '</p>';
    } else {
      var srcRows = [
        { label: 'Meta Ads', count: sources.meta, color: '#1877F2' },
        { label: 'Google Ads', count: sources.google, color: '#34A853' },
        { label: t('conv_platform_organic'), count: sources.organic, color: '#6F6A66' }
      ];
      srcRows.forEach(function (s) {
        var p = Math.round((s.count / totalSourced) * 100);
        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #E8E4E0;font-size:13px">' +
          '<span style="display:flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:50%;background:' + s.color + ';display:inline-block"></span>' + s.label + '</span>' +
          '<span style="font-weight:700">' + s.count + ' <span style="color:#6F6A66;font-weight:400">(' + p + '%)</span></span></div>';
      });
    }
    html += '</div></div>';

    // Recent conversions
    html += '<h4 class="ya-subtitle" style="margin-top:24px">' + t('conv_recent') + '</h4>';
    var recentItems = [];
    filteredFunnel.filter(function (d) { return d.funnel_stage === 'purchased'; }).forEach(function (d) {
      var ts = toDate(d.purchased_at) || toDate(d.updatedAt) || new Date();
      recentItems.push({ name: d.programName || d.programId || '—', email: d.email || '—', time: ts, source: 'funnel' });
    });
    filteredConv.filter(function (c) { return c.conversion_action === 'purchase'; }).forEach(function (c) {
      recentItems.push({ name: c.content_name || c.conversion_action, email: c.hashed_email ? '(hashed)' : '—', time: new Date(c.created_at || c.conversion_time), source: c.platform || '—' });
    });
    recentItems.sort(function (a, b) { return b.time - a.time; });
    recentItems = recentItems.slice(0, 20);

    if (!recentItems.length) {
      html += '<p class="yb-admin__empty">' + t('conv_no_data') + '</p>';
    } else {
      html += '<div class="yb-admin__table-wrap"><table class="yb-admin__table" style="font-size:13px"><thead><tr>' +
        '<th>Product</th><th>Email</th><th>Source</th><th>Date</th></tr></thead><tbody>';
      recentItems.forEach(function (item) {
        var srcBadge = item.source === 'meta' ? '<span style="color:#1877F2;font-weight:600">Meta</span>'
          : item.source === 'google' ? '<span style="color:#34A853;font-weight:600">Google</span>'
          : '<span style="color:#6F6A66">' + esc(item.source) + '</span>';
        html += '<tr><td>' + esc(item.name) + '</td><td style="color:#6F6A66">' + esc(item.email) + '</td>' +
          '<td>' + srcBadge + '</td>' +
          '<td style="color:#6F6A66">' + item.time.toLocaleDateString('da-DK') + ' ' + item.time.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' }) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }

    el.innerHTML = html;
  }

  // Period filter buttons
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.yb-admin__conv-period');
    if (!btn) return;
    convPeriodDays = parseInt(btn.getAttribute('data-conv-days')) || 0;
    document.querySelectorAll('.yb-admin__conv-period').forEach(function (b) {
      b.classList.remove('yb-admin__btn--active');
    });
    btn.classList.add('yb-admin__btn--active');
    // Re-render period-sensitive rows (cache already populated)
    renderRow1KPI();
    renderRow3Sources();
    renderRow5Email();
    renderRow7Revenue();
  });

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

    // Trainee program select — catalogue-driven (course_id)
    var programs = getEducationPrograms();
    var selectedCourseId = currentDetails.courseId || '';
    html += '<div class="yb-admin__field" id="yb-admin-role-trainee-fields" style="flex:1;display:' + (currentRole === 'trainee' ? '' : 'none') + '">';
    html += '<label for="yb-admin-role-courseid">' + t('role_program') + '</label>';
    html += '<select id="yb-admin-role-courseid" class="yb-admin__select">';
    html += '<option value="">—</option>';
    programs.forEach(function(p) {
      html += '<option value="' + esc(p.course_id) + '"' + (selectedCourseId === p.course_id ? ' selected' : '') + '>' +
        esc(p.course_name) + ' (' + esc(p.course_id) + ')</option>';
    });
    html += '</select>';
    html += '<small style="color:#6F6A66;font-size:0.7rem">Catalogue-driven. Stored as courseId.</small>';
    html += '</div>';

    // Trainee method — auto-derived, read-only unless 300h
    var derivedMethod = deriveMethodFromCourseId(selectedCourseId);
    var currentMethod = currentDetails.method || derivedMethod || '';
    var methodEditable = !isMethodDerivable(selectedCourseId); // editable only if NOT derivable (i.e., 300h)
    html += '<div class="yb-admin__field" id="yb-admin-role-method-fields" style="flex:1;display:' + (currentRole === 'trainee' ? '' : 'none') + '">';
    html += '<label for="yb-admin-role-method">Method</label>';
    html += '<select id="yb-admin-role-method" class="yb-admin__select"' + (methodEditable ? '' : ' disabled') + '>';
    html += '<option value="">—</option>';
    if (R.TRAINEE_METHODS) {
      Object.keys(R.TRAINEE_METHODS).forEach(function(k) {
        var meth = R.TRAINEE_METHODS[k];
        html += '<option value="' + k + '"' + (currentMethod === k ? ' selected' : '') + '>' + (meth['label_' + lang] || meth.label_da) + '</option>';
      });
    }
    html += '</select>';
    html += '<small id="yb-admin-role-method-hint" style="color:#6F6A66;font-size:0.7rem">' +
      (methodEditable ? 'Select manually for 300h.' : 'Auto-derived from program.') + '</small>';
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

    // Trainee cohorts — multi-select from catalogue (array)
    html += '<div id="yb-admin-role-cohort-wrap" style="display:' + (currentRole === 'trainee' ? '' : 'none') + '">';
    html += '<div class="yb-admin__field">';
    html += '<label>' + t('role_cohort') + ' (multi)</label>';
    html += '<div id="yb-admin-role-cohort-pills" class="yb-admin__pill-group" style="display:flex;flex-wrap:wrap;gap:0.35rem;margin-bottom:0.5rem;min-height:1.5rem"></div>';
    html += '<div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap">';
    html += '<select id="yb-admin-role-cohort-add" class="yb-admin__select" style="max-width:320px"><option value="">Add cohort…</option></select>';
    html += '<button type="button" id="yb-admin-role-cohort-add-btn" class="yb-btn yb-btn--outline yb-btn--sm">+ Add</button>';
    html += '</div>';
    html += '<small style="color:#6F6A66;font-size:0.7rem">Saved as roleDetails.cohort (array, buildCohortId format).</small>';
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

  /**
   * Renders the cohort pills for the role editor — uses data-* payload on each pill.
   */
  function renderRoleCohortPills(pillsArr) {
    var wrap = $('yb-admin-role-cohort-pills');
    if (!wrap) return;
    if (!pillsArr.length) {
      wrap.innerHTML = '<span style="color:#6F6A66;font-size:0.75rem;font-style:italic">No cohorts assigned</span>';
      return;
    }
    wrap.innerHTML = pillsArr.map(function (p, i) {
      return '<span class="yb-admin__pill" style="display:inline-flex;align-items:center;gap:0.35rem;background:#fff4ec;border:1px solid #f75c03;color:#f75c03;padding:3px 10px;border-radius:999px;font-size:0.75rem;font-weight:600">' +
        esc(p.label || p.buildId) +
        ' <small style="color:#6F6A66;font-weight:400">(' + esc(p.buildId) + ')</small>' +
        ' <button type="button" class="yb-admin-role-cohort-remove" data-idx="' + i + '" ' +
        'style="background:none;border:none;color:#f75c03;cursor:pointer;padding:0;margin-left:0.25rem;font-size:1rem;line-height:1" aria-label="Remove">&times;</button>' +
        '</span>';
    }).join('');
  }

  function readRoleCohortPills() {
    var wrap = $('yb-admin-role-cohort-pills');
    if (!wrap || !wrap._pills) return [];
    return wrap._pills;
  }

  function refreshRoleCohortAddOptions() {
    var sel = $('yb-admin-role-cohort-add');
    var cidSel = $('yb-admin-role-courseid');
    if (!sel) return;
    var courseId = cidSel ? cidSel.value : '';
    var opts = ['<option value="">Add cohort…</option>'];
    if (courseId) {
      var cohorts = getCohortsForCourseId(courseId);
      var existing = {};
      var pills = readRoleCohortPills();
      pills.forEach(function (p) { existing[p.buildId] = true; });
      cohorts.forEach(function (c) {
        if (existing[c.buildId]) return;
        opts.push('<option value="' + esc(c.buildId) + '" data-cohort-id="' + esc(c.cohort_id) +
          '" data-label="' + esc(c.cohort_label) + '">' +
          esc(c.cohort_label) + ' — ' + esc(c.buildId) + '</option>');
      });
    }
    sel.innerHTML = opts.join('');
  }

  /**
   * Bind dynamic handlers for the trainee portion of the role editor.
   * Called after renderRoleEditor's HTML is inserted into the DOM.
   */
  function bindRoleEditorHandlers(userData) {
    var currentDetails = (userData && userData.roleDetails) || {};

    // Seed cohort pills from existing roleDetails.cohort (string or array)
    var initial = [];
    var existingCohort = currentDetails.cohort;
    var existingIds = Array.isArray(currentDetails.cohortIds) ? currentDetails.cohortIds : [];
    var existingLabels = Array.isArray(currentDetails.cohortLabels) ? currentDetails.cohortLabels : [];
    if (typeof existingCohort === 'string' && existingCohort) existingCohort = [existingCohort];
    if (Array.isArray(existingCohort)) {
      existingCohort.forEach(function (bid, i) {
        initial.push({
          buildId: bid,
          cohortId: existingIds[i] || '',
          label: existingLabels[i] || (currentDetails.cohortLabel || '') || bid
        });
      });
    }
    var pillsWrap = $('yb-admin-role-cohort-pills');
    if (pillsWrap) pillsWrap._pills = initial;
    renderRoleCohortPills(initial);
    refreshRoleCohortAddOptions();

    // Role change → show/hide trainee block (existing behaviour handled elsewhere).
    // CourseId change → update method (auto-derive unless 300h), refresh cohort options.
    var cidSel = $('yb-admin-role-courseid');
    var methSel = $('yb-admin-role-method');
    var methHint = $('yb-admin-role-method-hint');
    if (cidSel) {
      cidSel.addEventListener('change', function () {
        var cid = cidSel.value;
        var derived = deriveMethodFromCourseId(cid);
        var editable = !isMethodDerivable(cid);
        if (methSel) {
          methSel.disabled = !editable;
          if (!editable) methSel.value = derived;
        }
        if (methHint) methHint.textContent = editable ? 'Select manually for 300h.' : 'Auto-derived from program.';
        refreshRoleCohortAddOptions();
      });
    }

    // Remove cohort pill (delegated)
    if (pillsWrap) {
      pillsWrap.addEventListener('click', function (e) {
        var btn = e.target.closest('.yb-admin-role-cohort-remove');
        if (!btn) return;
        var idx = parseInt(btn.getAttribute('data-idx'), 10);
        var arr = pillsWrap._pills || [];
        if (!isNaN(idx) && idx >= 0 && idx < arr.length) {
          arr.splice(idx, 1);
          renderRoleCohortPills(arr);
          refreshRoleCohortAddOptions();
        }
      });
    }

    // Add cohort
    var addBtn = $('yb-admin-role-cohort-add-btn');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        var sel = $('yb-admin-role-cohort-add');
        if (!sel || !sel.value) return;
        var opt = sel.options[sel.selectedIndex];
        var arr = pillsWrap._pills || [];
        if (arr.some(function (p) { return p.buildId === sel.value; })) return;
        arr.push({
          buildId: sel.value,
          cohortId: opt ? (opt.getAttribute('data-cohort-id') || '') : '',
          label: opt ? (opt.getAttribute('data-label') || sel.value) : sel.value
        });
        pillsWrap._pills = arr;
        renderRoleCohortPills(arr);
        refreshRoleCohortAddOptions();
      });
    }
  }

  function saveUserRole(e) {
    e.preventDefault();
    var form = $('yb-admin-role-form');
    if (!form) return;
    var uid = form.getAttribute('data-uid');
    if (!uid) return;

    var roleSelect = $('yb-admin-role-select');
    var courseIdSelect = $('yb-admin-role-courseid');
    var methodSelect = $('yb-admin-role-method');
    var teacherTypeSelect = $('yb-admin-role-teacher-type');

    var newRole = roleSelect ? roleSelect.value : 'member';
    var roleDetails = {};

    if (newRole === 'trainee') {
      var courseId = courseIdSelect ? courseIdSelect.value : '';
      if (courseId) {
        roleDetails.courseId = courseId;
        // Legacy derived fields for backwards compatibility.
        var derivedProg = deriveProgramFromCourseId(courseId);
        if (derivedProg) roleDetails.program = derivedProg;
        // Method: use explicit selection if editable, else derive.
        var methVal = methodSelect ? methodSelect.value : '';
        if (!methVal) methVal = deriveMethodFromCourseId(courseId);
        if (methVal) roleDetails.method = methVal;
      } else {
        // No courseId — still allow legacy method value if user set one.
        if (methodSelect && methodSelect.value) roleDetails.method = methodSelect.value;
      }
      // Multi-cohort array
      var pills = readRoleCohortPills();
      if (pills.length) {
        roleDetails.cohort = pills.map(function (p) { return p.buildId; });
        roleDetails.cohortIds = pills.map(function (p) { return p.cohortId || ''; });
        roleDetails.cohortLabels = pills.map(function (p) { return p.label || ''; });
      }
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

    toast(lang === 'da' ? 'Henter aktuel rolle…' : 'Loading current role…');

    // Re-fetch the current role from Firestore — never trust state.userDetail cache
    db.collection('users').doc(uid).get().then(function (doc) {
      if (!doc.exists) {
        toast(lang === 'da' ? 'Bruger ikke fundet' : 'User not found', true);
        return;
      }

      var data = doc.data() || {};
      var previousRole = data.role || 'member';
      var previousDetails = data.roleDetails || {};
      var userEmail = data.email || '(no email)';

      // Priority check — block protected role downgrades without explicit confirmation
      var currentPriority = getRolePriority(previousRole);
      var newPriority = getRolePriority(newRole);
      var isProtected = isProtectedRole(previousRole);
      var isDowngrade = currentPriority > newPriority;

      if (isProtected && previousRole !== newRole) {
        var warnLines = [];
        if (lang === 'da') {
          warnLines.push('⚠️  ADVARSEL: Du er ved at ændre en BESKYTTET rolle.');
          warnLines.push('');
          warnLines.push('Bruger: ' + userEmail);
          warnLines.push('Nuværende rolle: ' + previousRole + '  (beskyttet)');
          warnLines.push('Ny rolle: ' + newRole);
          warnLines.push('');
          warnLines.push('Skriv præcis følgende for at bekræfte:');
        } else {
          warnLines.push('⚠️  WARNING: You are changing a PROTECTED role.');
          warnLines.push('');
          warnLines.push('User: ' + userEmail);
          warnLines.push('Current role: ' + previousRole + '  (protected)');
          warnLines.push('New role: ' + newRole);
          warnLines.push('');
          warnLines.push('Type exactly the following to confirm:');
        }
        warnLines.push('');
        warnLines.push('  I understand this will downgrade admin users');

        var confirmText = prompt(warnLines.join('\n'), '');
        if (confirmText !== 'I understand this will downgrade admin users') {
          toast(lang === 'da' ? 'Annulleret' : 'Cancelled', true);
          return;
        }
      } else if (isDowngrade) {
        var msg = lang === 'da'
          ? 'Du er ved at nedgradere ' + userEmail + ' fra "' + previousRole + '" til "' + newRole + '". Fortsæt?'
          : 'You are about to downgrade ' + userEmail + ' from "' + previousRole + '" to "' + newRole + '". Proceed?';
        if (!confirm(msg)) {
          toast(lang === 'da' ? 'Annulleret' : 'Cancelled');
          return;
        }
      }

      toast(t('saving'));
      var currentAuthUser = firebase.auth().currentUser;
      var actorUid = currentAuthUser ? currentAuthUser.uid : 'unknown';
      var actorEmail = currentAuthUser ? currentAuthUser.email : 'unknown';
      var serverTs = firebase.firestore.FieldValue.serverTimestamp();

      db.collection('users').doc(uid).update({
        role: newRole,
        roleDetails: roleDetails,
        updatedAt: serverTs
      }).then(function () {
        // Unified audit log (role_audit) — matches netlify functions
        db.collection('role_audit').add({
          uid: uid,
          email: userEmail,
          previousRole: previousRole,
          previousDetails: previousDetails,
          newRole: newRole,
          newDetails: roleDetails,
          trigger: 'admin_manual',
          source: 'admin_panel',
          actor_uid: actorUid,
          actor_email: actorEmail,
          wasProtected: isProtected,
          wasDowngrade: isDowngrade,
          created_at: serverTs
        }).catch(function (err) { console.error('[saveUserRole] audit write failed:', err); });

        // Legacy role_changes log kept for backwards compatibility with older tooling
        db.collection('role_changes').add({
          userId: uid,
          action: 'role_change',
          previousRole: previousRole,
          previousDetails: previousDetails,
          newRole: newRole,
          newDetails: roleDetails,
          source: 'admin_manual',
          changedBy: actorUid,
          changedAt: serverTs
        }).catch(function (err) { console.error('[saveUserRole] legacy audit write failed:', err); });

        toast(t('role_saved'));
      }).catch(function (err) {
        console.error('Role save error:', err);
        toast(err.message || t('error_save'), true);
      });
    }).catch(function (err) {
      console.error('[saveUserRole] fetch failed:', err);
      toast((lang === 'da' ? 'Kunne ikke hente bruger: ' : 'Failed to load user: ') + err.message, true);
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

    // Bar is always visible; selection-only buttons toggled by selection count
    var hasSelection = selectedUserIds.size > 0;

    bar.querySelectorAll('.yb-lead__bulk-sel-only').forEach(function (btn) {
      btn.hidden = !hasSelection;
    });

    var countEl = $('yb-user-bulk-count');
    if (countEl) {
      if (hasSelection) {
        var selected = state.users.filter(function (u) { return selectedUserIds.has(u.id); });
        var withPhone = selected.filter(function (u) { return u.phone; }).length;
        var withEmail = selected.filter(function (u) { return u.email; }).length;
        countEl.innerHTML = '<strong>' + selectedUserIds.size + '</strong> ' + t('users_selected') +
          ' &nbsp;&middot;&nbsp; \ud83d\udcf1 ' + withPhone + ' &nbsp;&middot;&nbsp; \u2709\ufe0f ' + withEmail;
        countEl.hidden = false;
      } else {
        countEl.hidden = true;
      }
    }
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
    var R = window.YBRoles;
    if (!R) { toast('Roles module not loaded', true); return; }

    // Remove existing modal if any
    var existing = document.getElementById('yb-bulk-role-modal');
    if (existing) existing.remove();

    var VALID_ROLES = ['member', 'trainee', 'student', 'teacher', 'marketing', 'admin'];

    // Build modal HTML
    var html = '<div id="yb-bulk-role-modal" class="yb-bulk-role-modal">';
    html += '<div class="yb-bulk-role-modal__overlay"></div>';
    html += '<div class="yb-bulk-role-modal__box">';

    // Header
    html += '<div class="yb-bulk-role-modal__header">';
    html += '<h3 class="yb-bulk-role-modal__title">' + esc(t('users_bulk_role_title')) + '</h3>';
    html += '<span class="yb-bulk-role-modal__count">' + selectedUserIds.size + (lang === 'da' ? ' brugere valgt' : ' users selected') + '</span>';
    html += '<button type="button" class="yb-bulk-role-modal__close" id="yb-bulk-role-close">&times;</button>';
    html += '</div>';

    // Body
    html += '<div class="yb-bulk-role-modal__body">';

    // Role select — placeholder first so accidental clicks can't silently default to 'member'
    html += '<div class="yb-admin__field">';
    html += '<label>' + esc(t('role_label')) + '</label>';
    html += '<select id="yb-bulk-role-select" class="yb-admin__select">';
    html += '<option value="" selected disabled>' + (lang === 'da' ? '— vælg rolle —' : '— choose role —') + '</option>';
    VALID_ROLES.forEach(function(r) {
      html += '<option value="' + r + '">' + esc(R.getRoleLabel(r, lang)) + '</option>';
    });
    html += '</select>';
    html += '</div>';

    // Trainee fields
    html += '<div id="yb-bulk-role-trainee" class="yb-bulk-role-modal__fields" style="display:none">';
    // Program
    html += '<div class="yb-admin__field">';
    html += '<label>' + esc(t('role_program')) + '</label>';
    html += '<select id="yb-bulk-role-program" class="yb-admin__select"><option value="">—</option>';
    Object.keys(R.TRAINEE_PROGRAMS).forEach(function(k) {
      var p = R.TRAINEE_PROGRAMS[k];
      html += '<option value="' + k + '">' + esc(p['label_' + lang] || p.label_da) + '</option>';
    });
    html += '</select></div>';
    // Method
    html += '<div class="yb-admin__field">';
    html += '<label>Method</label>';
    html += '<select id="yb-bulk-role-method" class="yb-admin__select"><option value="">—</option>';
    if (R.TRAINEE_METHODS) {
      Object.keys(R.TRAINEE_METHODS).forEach(function(k) {
        var m = R.TRAINEE_METHODS[k];
        html += '<option value="' + k + '">' + esc(m['label_' + lang] || m.label_da) + '</option>';
      });
    }
    html += '</select></div>';
    // Cohort
    html += '<div class="yb-admin__field">';
    html += '<label>' + esc(t('role_cohort')) + '</label>';
    html += '<input type="text" id="yb-bulk-role-cohort" placeholder="2026-spring">';
    html += '</div>';
    // Trainee course types
    html += '<div class="yb-admin__field">';
    html += '<label>Courses (optional)</label>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:0.5rem 1rem;margin-top:0.25rem">';
    Object.keys(R.STUDENT_COURSES).forEach(function(k) {
      var sc = R.STUDENT_COURSES[k];
      html += '<label style="font-size:0.85rem;display:flex;align-items:center;gap:0.35rem;cursor:pointer">';
      html += '<input type="checkbox" class="yb-bulk-role-trainee-ct" value="' + k + '">';
      html += esc(sc['label_' + lang] || sc.label_da) + '</label>';
    });
    html += '<label style="font-size:0.85rem;display:flex;align-items:center;gap:0.35rem;cursor:pointer">';
    html += '<input type="checkbox" class="yb-bulk-role-trainee-mentor" value="mentorship">Mentorship</label>';
    html += '</div></div>';
    html += '</div>'; // end trainee

    // Teacher fields
    html += '<div id="yb-bulk-role-teacher" class="yb-bulk-role-modal__fields" style="display:none">';
    html += '<div class="yb-admin__field">';
    html += '<label>' + esc(t('role_teacher_type')) + '</label>';
    html += '<select id="yb-bulk-role-teacher-type" class="yb-admin__select"><option value="">—</option>';
    Object.keys(R.TEACHER_TYPES).forEach(function(k) {
      var tt = R.TEACHER_TYPES[k];
      html += '<option value="' + k + '">' + esc(tt['label_' + lang] || tt.label_da) + '</option>';
    });
    html += '</select></div>';
    html += '</div>'; // end teacher

    // Student fields
    html += '<div id="yb-bulk-role-student" class="yb-bulk-role-modal__fields" style="display:none">';
    html += '<div class="yb-admin__field">';
    html += '<label>Courses</label>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:0.5rem 1rem;margin-top:0.25rem">';
    Object.keys(R.STUDENT_COURSES).forEach(function(k) {
      var sc = R.STUDENT_COURSES[k];
      html += '<label style="font-size:0.85rem;display:flex;align-items:center;gap:0.35rem;cursor:pointer">';
      html += '<input type="checkbox" class="yb-bulk-role-student-ct" value="' + k + '">';
      html += esc(sc['label_' + lang] || sc.label_da) + '</label>';
    });
    html += '<label style="font-size:0.85rem;display:flex;align-items:center;gap:0.35rem;cursor:pointer">';
    html += '<input type="checkbox" class="yb-bulk-role-student-mentor" value="mentorship">Mentorship</label>';
    html += '</div></div>';
    html += '</div>'; // end student

    html += '</div>'; // end body

    // Footer
    html += '<div class="yb-bulk-role-modal__footer">';
    html += '<button type="button" class="yb-btn yb-btn--primary" id="yb-bulk-role-apply">' + esc(t('users_bulk_role_apply')) + '</button>';
    html += '</div>';

    html += '</div></div>'; // end box, end modal

    // Inject modal
    document.body.insertAdjacentHTML('beforeend', html);

    var modal = document.getElementById('yb-bulk-role-modal');
    var roleSelect = document.getElementById('yb-bulk-role-select');
    var traineeWrap = document.getElementById('yb-bulk-role-trainee');
    var teacherWrap = document.getElementById('yb-bulk-role-teacher');
    var studentWrap = document.getElementById('yb-bulk-role-student');

    // Show/hide conditional fields based on role
    function toggleFields() {
      var v = roleSelect.value;
      traineeWrap.style.display = v === 'trainee' ? '' : 'none';
      teacherWrap.style.display = v === 'teacher' ? '' : 'none';
      studentWrap.style.display = v === 'student' ? '' : 'none';
    }
    roleSelect.addEventListener('change', toggleFields);

    // Close handlers
    function closeModal() { if (modal) modal.remove(); }
    document.getElementById('yb-bulk-role-close').addEventListener('click', closeModal);
    modal.querySelector('.yb-bulk-role-modal__overlay').addEventListener('click', closeModal);

    // Apply handler
    document.getElementById('yb-bulk-role-apply').addEventListener('click', function() {
      var newRole = roleSelect.value;
      // Empty placeholder or invalid role → refuse
      if (!newRole || VALID_ROLES.indexOf(newRole) === -1) {
        toast(lang === 'da' ? 'Vælg en rolle først' : 'Please choose a role first', true);
        return;
      }

      // Build roleDetails
      var roleDetails = {};
      if (newRole === 'trainee') {
        var prog = document.getElementById('yb-bulk-role-program');
        var meth = document.getElementById('yb-bulk-role-method');
        var coh = document.getElementById('yb-bulk-role-cohort');
        if (prog && prog.value) roleDetails.program = prog.value;
        if (meth && meth.value) roleDetails.method = meth.value;
        if (coh && coh.value.trim()) roleDetails.cohort = coh.value.trim();
        var tct = []; document.querySelectorAll('.yb-bulk-role-trainee-ct:checked').forEach(function(c) { tct.push(c.value); });
        if (tct.length) roleDetails.courseTypes = tct;
        var tm = document.querySelector('.yb-bulk-role-trainee-mentor:checked');
        if (tm) roleDetails.mentorship = true;
      }
      if (newRole === 'student') {
        var sct = []; document.querySelectorAll('.yb-bulk-role-student-ct:checked').forEach(function(c) { sct.push(c.value); });
        if (sct.length) roleDetails.courseTypes = sct;
        var sm = document.querySelector('.yb-bulk-role-student-mentor:checked');
        if (sm) roleDetails.mentorship = true;
      }
      if (newRole === 'teacher') {
        var tt = document.getElementById('yb-bulk-role-teacher-type');
        if (tt && tt.value) roleDetails.teacherType = tt.value;
      }

      // Freeze the selection snapshot so UI changes during the confirmation flow don't affect us
      var targetIds = Array.from(selectedUserIds);
      if (targetIds.length === 0) return;

      toast(lang === 'da' ? 'Henter aktuelle roller…' : 'Loading current roles…');

      // Re-fetch each user's CURRENT role from Firestore — never trust state.users cache
      // This guards against stale UI state where a user's role was updated in another tab.
      var fetches = targetIds.map(function (id) {
        return db.collection('users').doc(id).get().then(function (doc) {
          if (!doc.exists) {
            return { id: id, missing: true };
          }
          var data = doc.data() || {};
          return {
            id: id,
            missing: false,
            email: data.email || '(no email)',
            displayName: [data.firstName, data.lastName].filter(Boolean).join(' ') || data.displayName || '',
            currentRole: data.role || 'member',
            currentDetails: data.roleDetails || {}
          };
        }).catch(function (err) {
          console.error('[bulkUserRole] fetch failed for', id, err);
          return { id: id, missing: true, error: err.message };
        });
      });

      Promise.all(fetches).then(function (rows) {
        var valid = rows.filter(function (r) { return !r.missing; });
        var missing = rows.filter(function (r) { return r.missing; });

        if (valid.length === 0) {
          toast(lang === 'da' ? 'Ingen gyldige brugere fundet' : 'No valid users found', true);
          return;
        }

        var newPriority = getRolePriority(newRole);

        var protectedHits = valid.filter(function (r) { return isProtectedRole(r.currentRole); });
        var downgrades = valid.filter(function (r) { return getRolePriority(r.currentRole) > newPriority; });
        var upgradesOrSame = valid.filter(function (r) { return getRolePriority(r.currentRole) <= newPriority; });

        // Step 1: Always show the list of affected users for confirmation
        var lines = [];
        if (lang === 'da') {
          lines.push('Du er ved at ændre rolle til "' + newRole + '" for ' + valid.length + ' bruger(e):');
        } else {
          lines.push('You are about to change role to "' + newRole + '" for ' + valid.length + ' user(s):');
        }
        lines.push('');
        valid.forEach(function (r) {
          var nameSuffix = r.displayName ? ' (' + r.displayName + ')' : '';
          lines.push('  • ' + r.email + nameSuffix + '  —  ' + (lang === 'da' ? 'nuværende: ' : 'current: ') + r.currentRole);
        });
        if (missing.length) {
          lines.push('');
          lines.push((lang === 'da' ? 'Bemærk: ' : 'Note: ') + missing.length + (lang === 'da' ? ' bruger(e) kunne ikke hentes og springes over.' : ' user(s) could not be loaded and will be skipped.'));
        }
        lines.push('');
        lines.push(lang === 'da' ? 'Fortsæt?' : 'Proceed?');

        if (!confirm(lines.join('\n'))) {
          toast(lang === 'da' ? 'Annulleret' : 'Cancelled');
          return;
        }

        // Step 2: If ANY protected roles or downgrades are involved, require a SECOND explicit confirmation
        if (protectedHits.length > 0 || downgrades.length > 0) {
          var warnLines = [];
          if (lang === 'da') {
            warnLines.push('⚠️  ADVARSEL: Denne handling vil nedgradere privilegerede brugere.');
          } else {
            warnLines.push('⚠️  WARNING: This action will downgrade privileged users.');
          }
          warnLines.push('');

          if (protectedHits.length > 0) {
            warnLines.push(lang === 'da'
              ? 'Beskyttede roller der nedgraderes (' + protectedHits.length + '):'
              : 'Protected roles being downgraded (' + protectedHits.length + '):');
            protectedHits.forEach(function (r) {
              warnLines.push('  🛡  ' + r.email + '  —  ' + r.currentRole + ' → ' + newRole);
            });
            warnLines.push('');
          }

          var nonProtectedDowngrades = downgrades.filter(function (r) { return !isProtectedRole(r.currentRole); });
          if (nonProtectedDowngrades.length > 0) {
            warnLines.push(lang === 'da'
              ? 'Andre nedgraderinger (' + nonProtectedDowngrades.length + '):'
              : 'Other downgrades (' + nonProtectedDowngrades.length + '):');
            nonProtectedDowngrades.forEach(function (r) {
              warnLines.push('  ↓  ' + r.email + '  —  ' + r.currentRole + ' → ' + newRole);
            });
            warnLines.push('');
          }

          warnLines.push(lang === 'da'
            ? 'Skriv præcis følgende for at bekræfte:'
            : 'Type exactly the following to confirm:');
          warnLines.push('');
          warnLines.push('  I understand this will downgrade admin users');

          var confirmText = prompt(warnLines.join('\n'), '');
          if (confirmText !== 'I understand this will downgrade admin users') {
            toast(lang === 'da' ? 'Annulleret — bekræftelsestekst matchede ikke' : 'Cancelled — confirmation text did not match', true);
            return;
          }
        }

        // Step 3: Build the batch — for every user, write BOTH the user update and a role_audit entry
        var batch = db.batch();
        var currentAuthUser = firebase.auth().currentUser;
        var actorUid = currentAuthUser ? currentAuthUser.uid : 'unknown';
        var actorEmail = currentAuthUser ? currentAuthUser.email : 'unknown';
        var serverTs = firebase.firestore.FieldValue.serverTimestamp();

        valid.forEach(function (r) {
          // User update
          batch.update(db.collection('users').doc(r.id), {
            role: newRole,
            roleDetails: roleDetails,
            updatedAt: serverTs
          });
          // Audit entry (one per user) — written atomically with the update
          var auditRef = db.collection('role_audit').doc();
          batch.set(auditRef, {
            uid: r.id,
            email: r.email,
            previousRole: r.currentRole,
            previousDetails: r.currentDetails || {},
            newRole: newRole,
            newDetails: roleDetails,
            trigger: 'admin_bulk',
            source: 'admin_bulk',
            actor_uid: actorUid,
            actor_email: actorEmail,
            wasProtected: isProtectedRole(r.currentRole),
            wasDowngrade: getRolePriority(r.currentRole) > newPriority,
            batch_size: valid.length,
            created_at: serverTs
          });
        });

        toast(t('saving'));
        closeModal();

        batch.commit().then(function () {
          var updatedIds = {};
          valid.forEach(function (r) { updatedIds[r.id] = true; });
          state.users.forEach(function (u) {
            if (updatedIds[u.id]) {
              u.role = newRole;
              u.roleDetails = roleDetails;
            }
          });
          selectedUserIds.clear();
          selectAllUsers = false;
          renderUserTable();
          renderUserStats(state.users);
          updateUserBulkBar();
          toast(t('saved') + ' (' + valid.length + ')');
        }).catch(function (err) {
          console.error('[bulkUserRole] batch commit failed:', err);
          toast(t('error_save') + ': ' + err.message, true);
        });
      }).catch(function (err) {
        console.error('[bulkUserRole] fetch failed:', err);
        toast((lang === 'da' ? 'Kunne ikke hente brugere: ' : 'Failed to load users: ') + err.message, true);
      });
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
    if (selectedUserIds.size === 0) { bulkUserEmail(); return; }
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
    if (selectedUserIds.size === 0) { bulkUserSMS(); return; }
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
    el.innerHTML = '<p class="yb-admin__empty">' + t('loading') + '</p>';
    fetchUsersCatalog().then(function () {
      el.innerHTML = renderRoleEditor(uid, u);
      var roleForm = $('yb-admin-role-form');
      if (roleForm) {
        roleForm.addEventListener('submit', function (e) {
          saveUserRole(e);
          setTimeout(function () { showUserDetail(uid); }, 1200);
        });
      }
      bindRoleEditorHandlers(u);
    });
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
      // Analytics is now the default active tab — load on auth
      loadAnalytics();
      loadConversionAnalytics();
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
