/**
 * YOGA BIBLE — COURSE VIEWER
 * Handles course content display, navigation, search, comments, and progress.
 * Requires Firebase Auth + Firestore (loaded via CDN in base.njk).
 *
 * Firestore collections used:
 *   courses/{courseId}                         — course metadata
 *   courses/{courseId}/modules/{moduleId}       — module metadata
 *   courses/{courseId}/modules/{mid}/chapters/{cid} — chapter content
 *   enrollments/{odcId_odcId}                  — user enrollment
 *   courseProgress/{odcId_odcId}                — reading progress
 *   courseComments/{auto}                       — user comments
 */
(function() {
  'use strict';

  // ════════════════════════════════════════
  // STATE
  // ════════════════════════════════════════

  var state = {
    user: null,
    courseId: null,
    course: null,
    modules: [],
    chaptersCache: {},   // moduleId -> chapter[]
    allChaptersLoaded: false,
    currentModule: null,
    currentChapter: null,
    enrollment: null,
    progress: null,      // { viewed: {}, lastModule, lastChapter }
    comments: [],
    sidebarOpen: false,
    searchOpen: false,
    lang: 'da'
  };

  var db, auth;

  // ════════════════════════════════════════
  // TRANSLATION HELPER
  // ════════════════════════════════════════

  function t(key) {
    return (window._ybCVTranslations || {})[key] || key;
  }

  function langKey(field) {
    return field + '_' + state.lang;
  }

  function localised(obj, field) {
    return obj[field + '_' + state.lang] || obj[field + '_da'] || '';
  }

  // ════════════════════════════════════════
  // INIT
  // ════════════════════════════════════════

  function init() {
    var wrapper = document.getElementById('yb-cv-wrapper');
    if (!wrapper) return;

    state.lang = window._ybCVLang || 'da';

    // Parse URL params
    var params = new URLSearchParams(window.location.search);
    state.courseId = params.get('course');

    if (!state.courseId) {
      showError(t('error_no_course'));
      return;
    }

    auth = firebase.auth();
    db = firebase.firestore();

    bindEvents();

    auth.onAuthStateChanged(function(user) {
      if (!user) {
        showGate('login');
        return;
      }
      state.user = user;
      checkEnrollment().then(function(enrolled) {
        if (!enrolled) {
          showGate('enroll');
          return;
        }
        showViewer();
        var moduleParam = params.get('module');
        var chapterParam = params.get('chapter');
        loadCourse(moduleParam, chapterParam);
      });
    });
  }

  // ════════════════════════════════════════
  // EVENTS
  // ════════════════════════════════════════

  function bindEvents() {
    // Sidebar toggle (mobile)
    var sidebarToggle = document.getElementById('yb-cv-sidebar-toggle');
    var overlay = document.getElementById('yb-cv-sidebar-overlay');
    if (sidebarToggle) sidebarToggle.addEventListener('click', toggleSidebar);
    if (overlay) overlay.addEventListener('click', closeSidebar);

    // Search toggle
    var searchToggle = document.getElementById('yb-cv-search-toggle');
    var searchClose = document.getElementById('yb-cv-search-close');
    var searchInput = document.getElementById('yb-cv-search-input');
    if (searchToggle) searchToggle.addEventListener('click', toggleSearch);
    if (searchClose) searchClose.addEventListener('click', closeSearch);
    if (searchInput) {
      var debounceTimer;
      searchInput.addEventListener('input', function() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function() {
          performSearch(searchInput.value);
        }, 250);
      });
    }

    // Chapter nav
    var prevBtn = document.getElementById('yb-cv-nav-prev');
    var nextBtn = document.getElementById('yb-cv-nav-next');
    if (prevBtn) prevBtn.addEventListener('click', navigatePrev);
    if (nextBtn) nextBtn.addEventListener('click', navigateNext);

    // Comments form
    var commentForm = document.getElementById('yb-cv-comment-form');
    if (commentForm) commentForm.addEventListener('submit', function(e) {
      e.preventDefault();
      var input = document.getElementById('yb-cv-comment-input');
      if (input && input.value.trim()) {
        addComment(input.value.trim());
        input.value = '';
      }
    });

    // My Comments
    var myCommentsBtn = document.getElementById('yb-cv-my-comments-btn');
    var myCommentsClose = document.getElementById('yb-cv-my-comments-close');
    if (myCommentsBtn) myCommentsBtn.addEventListener('click', showMyComments);
    if (myCommentsClose) myCommentsClose.addEventListener('click', hideMyComments);

    // Sidebar module/chapter clicks (delegated)
    var sidebarNav = document.getElementById('yb-cv-sidebar-modules');
    if (sidebarNav) sidebarNav.addEventListener('click', handleSidebarClick);

    // Search result clicks (delegated)
    var searchResults = document.getElementById('yb-cv-search-results');
    if (searchResults) searchResults.addEventListener('click', handleSearchResultClick);

    // Keyboard: Escape closes search/sidebar
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        if (state.searchOpen) closeSearch();
        if (state.sidebarOpen) closeSidebar();
      }
    });
  }

  // ════════════════════════════════════════
  // ENROLLMENT CHECK
  // ════════════════════════════════════════

  function checkEnrollment() {
    var enrollId = state.user.uid + '_' + state.courseId;
    return db.collection('enrollments').doc(enrollId).get()
      .then(function(doc) {
        if (doc.exists && doc.data().status === 'active') {
          state.enrollment = doc.data();
          return true;
        }
        return false;
      })
      .catch(function() {
        return false;
      });
  }

  // ════════════════════════════════════════
  // LOAD COURSE
  // ════════════════════════════════════════

  function loadCourse(moduleParam, chapterParam) {
    showLoading(true);

    db.collection('courses').doc(state.courseId).get()
      .then(function(doc) {
        if (!doc.exists) {
          showError(t('error_not_found'));
          return Promise.reject('not_found');
        }
        state.course = doc.data();
        updateCourseHeader();

        return db.collection('courses').doc(state.courseId)
          .collection('modules').orderBy('order').get();
      })
      .then(function(snapshot) {
        if (!snapshot) return;
        state.modules = [];
        snapshot.forEach(function(doc) {
          var data = doc.data();
          data.id = doc.id;
          state.modules.push(data);
        });
        renderSidebar();

        return loadProgress();
      })
      .then(function() {
        // Determine where to open
        var targetModule = moduleParam;
        var targetChapter = chapterParam;

        // Resume from last position if no params
        if (!targetModule && state.progress && state.progress.lastModule) {
          targetModule = state.progress.lastModule;
          targetChapter = state.progress.lastChapter;
        }

        // Fall back to first module
        if (!targetModule && state.modules.length) {
          targetModule = state.modules[0].id;
        }

        if (targetModule) {
          return openModule(targetModule, targetChapter);
        }
      })
      .then(function() {
        showLoading(false);
        // Preload remaining modules in background for search
        preloadAllChapters();
      })
      .catch(function(err) {
        if (err === 'not_found') return;
        console.error('Failed to load course:', err);
        showError(t('error_load_failed'));
      });
  }

  function preloadAllChapters() {
    var promises = state.modules.map(function(mod) {
      if (state.chaptersCache[mod.id]) return Promise.resolve();
      return db.collection('courses').doc(state.courseId)
        .collection('modules').doc(mod.id)
        .collection('chapters').orderBy('order').get()
        .then(function(snapshot) {
          var chapters = [];
          snapshot.forEach(function(doc) {
            var data = doc.data();
            data.id = doc.id;
            chapters.push(data);
          });
          state.chaptersCache[mod.id] = chapters;
        });
    });

    Promise.all(promises).then(function() {
      state.allChaptersLoaded = true;
      updateProgressUI();
    });
  }

  // ════════════════════════════════════════
  // MODULES & CHAPTERS
  // ════════════════════════════════════════

  function openModule(moduleId, chapterParam) {
    if (state.chaptersCache[moduleId]) {
      expandSidebarModule(moduleId);
      var chapters = state.chaptersCache[moduleId];
      var targetChapter = chapterParam || (chapters.length ? chapters[0].id : null);
      if (targetChapter) return openChapter(moduleId, targetChapter);
      return Promise.resolve();
    }

    return db.collection('courses').doc(state.courseId)
      .collection('modules').doc(moduleId)
      .collection('chapters').orderBy('order').get()
      .then(function(snapshot) {
        var chapters = [];
        snapshot.forEach(function(doc) {
          var data = doc.data();
          data.id = doc.id;
          chapters.push(data);
        });
        state.chaptersCache[moduleId] = chapters;
        renderSidebarChapters(moduleId);
        expandSidebarModule(moduleId);

        var targetChapter = chapterParam || (chapters.length ? chapters[0].id : null);
        if (targetChapter) return openChapter(moduleId, targetChapter);
      });
  }

  function openChapter(moduleId, chapterId) {
    var chapters = state.chaptersCache[moduleId];
    if (!chapters) return Promise.resolve();

    var chapter = null;
    for (var i = 0; i < chapters.length; i++) {
      if (chapters[i].id === chapterId) { chapter = chapters[i]; break; }
    }
    if (!chapter) return Promise.resolve();

    state.currentModule = moduleId;
    state.currentChapter = chapterId;

    // Update URL
    var url = new URL(window.location);
    url.searchParams.set('course', state.courseId);
    url.searchParams.set('module', moduleId);
    url.searchParams.set('chapter', chapterId);
    window.history.replaceState({}, '', url);

    // Show chapter view, hide my comments
    var chapterEl = document.getElementById('yb-cv-chapter');
    var myCommentsEl = document.getElementById('yb-cv-my-comments');
    if (chapterEl) chapterEl.hidden = false;
    if (myCommentsEl) myCommentsEl.hidden = true;

    // Render content
    renderChapterContent(chapter, moduleId);
    updateSidebarActive(moduleId, chapterId);
    updateChapterNav();
    markChapterViewed(moduleId, chapterId);

    // Close sidebar on mobile
    closeSidebar();

    // Scroll content to top
    var contentEl = document.getElementById('yb-cv-content');
    if (contentEl) contentEl.scrollTop = 0;

    // Load comments
    return loadComments(moduleId, chapterId);
  }

  // ════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════

  function updateCourseHeader() {
    var titleEl = document.getElementById('yb-cv-course-title');
    if (titleEl && state.course) {
      titleEl.textContent = localised(state.course, 'title');
    }
  }

  function renderChapterContent(chapter, moduleId) {
    var titleEl = document.getElementById('yb-cv-chapter-title');
    var eyebrowEl = document.getElementById('yb-cv-chapter-eyebrow');
    var contentEl = document.getElementById('yb-cv-chapter-content');

    // Find module title for eyebrow
    var mod = null;
    for (var i = 0; i < state.modules.length; i++) {
      if (state.modules[i].id === moduleId) { mod = state.modules[i]; break; }
    }

    if (eyebrowEl && mod) {
      eyebrowEl.textContent = localised(mod, 'title');
    }
    if (titleEl) {
      titleEl.textContent = localised(chapter, 'title');
    }
    if (contentEl) {
      contentEl.innerHTML = localised(chapter, 'content');
    }
  }

  // ════════════════════════════════════════
  // SIDEBAR
  // ════════════════════════════════════════

  function renderSidebar() {
    var container = document.getElementById('yb-cv-sidebar-modules');
    if (!container) return;

    var html = '';
    state.modules.forEach(function(mod) {
      html += '<div class="yb-cv-mod" data-module-id="' + mod.id + '">';
      html += '  <button class="yb-cv-mod__btn" data-action="toggle-module" data-module="' + mod.id + '">';
      html += '    <span class="yb-cv-mod__icon">' + (mod.icon || '') + '</span>';
      html += '    <span class="yb-cv-mod__title">' + esc(localised(mod, 'title')) + '</span>';
      html += '    <span class="yb-cv-mod__count" id="yb-cv-mod-count-' + mod.id + '"></span>';
      html += '    <svg class="yb-cv-mod__arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
      html += '  </button>';
      html += '  <div class="yb-cv-mod__chapters" id="yb-cv-chapters-' + mod.id + '" hidden>';
      html += '    <div class="yb-cv-mod__chapters-loading">' + t('loading') + '</div>';
      html += '  </div>';
      html += '</div>';
    });

    container.innerHTML = html;
  }

  function renderSidebarChapters(moduleId) {
    var container = document.getElementById('yb-cv-chapters-' + moduleId);
    if (!container) return;

    var chapters = state.chaptersCache[moduleId] || [];
    if (!chapters.length) {
      container.innerHTML = '<p class="yb-cv-mod__empty">—</p>';
      return;
    }

    var html = '';
    chapters.forEach(function(ch, idx) {
      var viewed = isChapterViewed(moduleId, ch.id);
      html += '<button class="yb-cv-ch' + (viewed ? ' yb-cv-ch--viewed' : '') + '"';
      html += ' data-action="open-chapter" data-module="' + moduleId + '" data-chapter="' + ch.id + '">';
      html += '  <span class="yb-cv-ch__check">' + (viewed ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : '<span class="yb-cv-ch__num">' + (idx + 1) + '</span>') + '</span>';
      html += '  <span class="yb-cv-ch__title">' + esc(localised(ch, 'title')) + '</span>';
      html += '</button>';
    });

    container.innerHTML = html;

    // Update count
    var countEl = document.getElementById('yb-cv-mod-count-' + moduleId);
    if (countEl) countEl.textContent = chapters.length;
  }

  function expandSidebarModule(moduleId) {
    // Ensure chapters are rendered
    var chaptersEl = document.getElementById('yb-cv-chapters-' + moduleId);
    if (!chaptersEl) return;

    if (state.chaptersCache[moduleId]) {
      renderSidebarChapters(moduleId);
    }
    chaptersEl.hidden = false;

    // Rotate arrow
    var modEl = document.querySelector('[data-module-id="' + moduleId + '"]');
    if (modEl) modEl.classList.add('yb-cv-mod--open');
  }

  function collapseSidebarModule(moduleId) {
    var chaptersEl = document.getElementById('yb-cv-chapters-' + moduleId);
    if (chaptersEl) chaptersEl.hidden = true;

    var modEl = document.querySelector('[data-module-id="' + moduleId + '"]');
    if (modEl) modEl.classList.remove('yb-cv-mod--open');
  }

  function updateSidebarActive(moduleId, chapterId) {
    // Remove all active
    var allCh = document.querySelectorAll('.yb-cv-ch--active');
    for (var i = 0; i < allCh.length; i++) allCh[i].classList.remove('yb-cv-ch--active');

    // Set active
    var activeEl = document.querySelector('[data-action="open-chapter"][data-module="' + moduleId + '"][data-chapter="' + chapterId + '"]');
    if (activeEl) activeEl.classList.add('yb-cv-ch--active');
  }

  function handleSidebarClick(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;

    var action = btn.getAttribute('data-action');
    var moduleId = btn.getAttribute('data-module');

    if (action === 'toggle-module') {
      var chaptersEl = document.getElementById('yb-cv-chapters-' + moduleId);
      if (chaptersEl && !chaptersEl.hidden) {
        collapseSidebarModule(moduleId);
      } else {
        openModule(moduleId);
      }
    }

    if (action === 'open-chapter') {
      var chapterId = btn.getAttribute('data-chapter');
      openChapter(moduleId, chapterId);
    }
  }

  function toggleSidebar() {
    state.sidebarOpen = !state.sidebarOpen;
    var sidebar = document.getElementById('yb-cv-sidebar');
    var overlay = document.getElementById('yb-cv-sidebar-overlay');
    if (sidebar) sidebar.classList.toggle('yb-cv-sidebar--open', state.sidebarOpen);
    if (overlay) overlay.classList.toggle('yb-cv-sidebar-overlay--visible', state.sidebarOpen);
    document.body.style.overflow = state.sidebarOpen ? 'hidden' : '';
  }

  function closeSidebar() {
    state.sidebarOpen = false;
    var sidebar = document.getElementById('yb-cv-sidebar');
    var overlay = document.getElementById('yb-cv-sidebar-overlay');
    if (sidebar) sidebar.classList.remove('yb-cv-sidebar--open');
    if (overlay) overlay.classList.remove('yb-cv-sidebar-overlay--visible');
    document.body.style.overflow = '';
  }

  // ════════════════════════════════════════
  // CHAPTER NAVIGATION
  // ════════════════════════════════════════

  function getFlatChapterList() {
    var flat = [];
    state.modules.forEach(function(mod) {
      var chapters = state.chaptersCache[mod.id] || [];
      chapters.forEach(function(ch) {
        flat.push({ moduleId: mod.id, chapterId: ch.id, chapter: ch });
      });
    });
    return flat;
  }

  function updateChapterNav() {
    var flat = getFlatChapterList();
    var currentIdx = -1;
    for (var i = 0; i < flat.length; i++) {
      if (flat[i].moduleId === state.currentModule && flat[i].chapterId === state.currentChapter) {
        currentIdx = i;
        break;
      }
    }

    var prevBtn = document.getElementById('yb-cv-nav-prev');
    var nextBtn = document.getElementById('yb-cv-nav-next');
    var prevLabel = document.getElementById('yb-cv-nav-prev-label');
    var nextLabel = document.getElementById('yb-cv-nav-next-label');

    if (prevBtn) {
      if (currentIdx > 0) {
        prevBtn.hidden = false;
        if (prevLabel) prevLabel.textContent = localised(flat[currentIdx - 1].chapter, 'title');
      } else {
        prevBtn.hidden = true;
      }
    }

    if (nextBtn) {
      if (currentIdx >= 0 && currentIdx < flat.length - 1) {
        nextBtn.hidden = false;
        if (nextLabel) nextLabel.textContent = localised(flat[currentIdx + 1].chapter, 'title');
      } else {
        nextBtn.hidden = true;
      }
    }
  }

  function navigatePrev() {
    var flat = getFlatChapterList();
    var currentIdx = -1;
    for (var i = 0; i < flat.length; i++) {
      if (flat[i].moduleId === state.currentModule && flat[i].chapterId === state.currentChapter) {
        currentIdx = i; break;
      }
    }
    if (currentIdx > 0) {
      var prev = flat[currentIdx - 1];
      openModule(prev.moduleId, prev.chapterId);
    }
  }

  function navigateNext() {
    var flat = getFlatChapterList();
    var currentIdx = -1;
    for (var i = 0; i < flat.length; i++) {
      if (flat[i].moduleId === state.currentModule && flat[i].chapterId === state.currentChapter) {
        currentIdx = i; break;
      }
    }
    if (currentIdx >= 0 && currentIdx < flat.length - 1) {
      var next = flat[currentIdx + 1];
      openModule(next.moduleId, next.chapterId);
    }
  }

  // ════════════════════════════════════════
  // SEARCH
  // ════════════════════════════════════════

  function toggleSearch() {
    state.searchOpen = !state.searchOpen;
    var searchEl = document.getElementById('yb-cv-search');
    if (searchEl) searchEl.hidden = !state.searchOpen;
    if (state.searchOpen) {
      var input = document.getElementById('yb-cv-search-input');
      if (input) { input.value = ''; input.focus(); }
      clearSearchResults();
    }
  }

  function closeSearch() {
    state.searchOpen = false;
    var searchEl = document.getElementById('yb-cv-search');
    if (searchEl) searchEl.hidden = true;
  }

  function performSearch(query) {
    if (!query || query.length < 2) {
      clearSearchResults();
      return;
    }

    var results = [];
    var q = query.toLowerCase();

    state.modules.forEach(function(mod) {
      var chapters = state.chaptersCache[mod.id] || [];
      chapters.forEach(function(ch) {
        var title = localised(ch, 'title').toLowerCase();
        var content = localised(ch, 'content').toLowerCase().replace(/<[^>]+>/g, '');

        if (title.indexOf(q) >= 0 || content.indexOf(q) >= 0) {
          results.push({
            moduleId: mod.id,
            chapterId: ch.id,
            moduleTitle: localised(mod, 'title'),
            chapterTitle: localised(ch, 'title'),
            snippet: getSnippet(content, q)
          });
        }
      });
    });

    renderSearchResults(results, query);
  }

  function getSnippet(text, query) {
    var idx = text.indexOf(query);
    if (idx < 0) return '';
    var start = Math.max(0, idx - 60);
    var end = Math.min(text.length, idx + query.length + 60);
    var snippet = (start > 0 ? '...' : '') + text.substring(start, end) + (end < text.length ? '...' : '');
    return snippet;
  }

  function renderSearchResults(results, query) {
    var container = document.getElementById('yb-cv-search-results');
    if (!container) return;

    if (!results.length) {
      container.innerHTML = '<p class="yb-cv-search__empty">' + t('search_no_results') + ' "' + esc(query) + '"</p>';
      return;
    }

    var html = '<p class="yb-cv-search__count">' + results.length + ' ' + t('search_results_count') + '</p>';
    results.forEach(function(r) {
      html += '<button class="yb-cv-search__result" data-module="' + r.moduleId + '" data-chapter="' + r.chapterId + '">';
      html += '  <span class="yb-cv-search__result-module">' + esc(r.moduleTitle) + '</span>';
      html += '  <span class="yb-cv-search__result-title">' + esc(r.chapterTitle) + '</span>';
      if (r.snippet) {
        html += '  <span class="yb-cv-search__result-snippet">' + highlightQuery(esc(r.snippet), query) + '</span>';
      }
      html += '</button>';
    });

    container.innerHTML = html;
  }

  function highlightQuery(text, query) {
    var escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp('(' + escaped + ')', 'gi'), '<mark>$1</mark>');
  }

  function clearSearchResults() {
    var container = document.getElementById('yb-cv-search-results');
    if (container) container.innerHTML = '';
  }

  function handleSearchResultClick(e) {
    var btn = e.target.closest('.yb-cv-search__result');
    if (!btn) return;
    var moduleId = btn.getAttribute('data-module');
    var chapterId = btn.getAttribute('data-chapter');
    closeSearch();
    openModule(moduleId, chapterId);
  }

  // ════════════════════════════════════════
  // COMMENTS
  // ════════════════════════════════════════

  function loadComments(moduleId, chapterId) {
    return db.collection('courseComments')
      .where('courseId', '==', state.courseId)
      .where('moduleId', '==', moduleId)
      .where('chapterId', '==', chapterId)
      .orderBy('createdAt', 'desc')
      .get()
      .then(function(snapshot) {
        state.comments = [];
        snapshot.forEach(function(doc) {
          var data = doc.data();
          data.id = doc.id;
          state.comments.push(data);
        });
        renderComments();
      })
      .catch(function(err) {
        // Likely missing composite index — show empty comments
        console.warn('Comments load failed (index may be needed):', err);
        state.comments = [];
        renderComments();
      });
  }

  function addComment(content) {
    var comment = {
      userId: state.user.uid,
      userName: state.user.displayName || state.user.email.split('@')[0],
      courseId: state.courseId,
      moduleId: state.currentModule,
      chapterId: state.currentChapter,
      content: content,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    return db.collection('courseComments').add(comment)
      .then(function(docRef) {
        comment.id = docRef.id;
        comment.createdAt = { toDate: function() { return new Date(); } };
        state.comments.unshift(comment);
        renderComments();
      })
      .catch(function(err) {
        console.error('Failed to add comment:', err);
      });
  }

  function deleteComment(commentId) {
    return db.collection('courseComments').doc(commentId).delete()
      .then(function() {
        state.comments = state.comments.filter(function(c) { return c.id !== commentId; });
        renderComments();
      });
  }

  function renderComments() {
    var container = document.getElementById('yb-cv-comments-list');
    if (!container) return;

    if (!state.comments.length) {
      container.innerHTML = '<p class="yb-cv-comments__empty">' + t('comments_empty') + '</p>';
      return;
    }

    var html = '';
    state.comments.forEach(function(c) {
      var date = c.createdAt && c.createdAt.toDate ? c.createdAt.toDate() : new Date();
      var isOwn = state.user && c.userId === state.user.uid;
      var initials = getInitials(c.userName || '');

      html += '<div class="yb-cv-comment' + (isOwn ? ' yb-cv-comment--own' : '') + '" data-comment-id="' + c.id + '">';
      html += '  <div class="yb-cv-comment__avatar">' + esc(initials) + '</div>';
      html += '  <div class="yb-cv-comment__body">';
      html += '    <div class="yb-cv-comment__meta">';
      html += '      <span class="yb-cv-comment__name">' + esc(c.userName || '') + '</span>';
      html += '      <span class="yb-cv-comment__date">' + formatDate(date) + '</span>';
      html += '    </div>';
      html += '    <p class="yb-cv-comment__text">' + esc(c.content) + '</p>';
      if (isOwn) {
        html += '    <button class="yb-cv-comment__delete" data-action="delete-comment" data-comment-id="' + c.id + '">' + t('comments_delete') + '</button>';
      }
      html += '  </div>';
      html += '</div>';
    });

    container.innerHTML = html;

    // Bind delete buttons
    container.querySelectorAll('[data-action="delete-comment"]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        deleteComment(btn.getAttribute('data-comment-id'));
      });
    });
  }

  // ════════════════════════════════════════
  // MY COMMENTS
  // ════════════════════════════════════════

  function showMyComments() {
    var chapterEl = document.getElementById('yb-cv-chapter');
    var myCommentsEl = document.getElementById('yb-cv-my-comments');
    var listEl = document.getElementById('yb-cv-my-comments-list');
    if (chapterEl) chapterEl.hidden = true;
    if (myCommentsEl) myCommentsEl.hidden = false;
    if (listEl) listEl.innerHTML = '<p class="yb-cv-my-comments__loading">' + t('loading') + '</p>';

    closeSidebar();

    db.collection('courseComments')
      .where('courseId', '==', state.courseId)
      .where('userId', '==', state.user.uid)
      .orderBy('createdAt', 'desc')
      .get()
      .then(function(snapshot) {
        var comments = [];
        snapshot.forEach(function(doc) {
          var data = doc.data();
          data.id = doc.id;
          comments.push(data);
        });
        renderMyCommentsList(comments);
      })
      .catch(function(err) {
        console.warn('My comments load failed:', err);
        renderMyCommentsList([]);
      });
  }

  function hideMyComments() {
    var chapterEl = document.getElementById('yb-cv-chapter');
    var myCommentsEl = document.getElementById('yb-cv-my-comments');
    if (chapterEl) chapterEl.hidden = false;
    if (myCommentsEl) myCommentsEl.hidden = true;
  }

  function renderMyCommentsList(comments) {
    var listEl = document.getElementById('yb-cv-my-comments-list');
    if (!listEl) return;

    if (!comments.length) {
      listEl.innerHTML = '<p class="yb-cv-my-comments__empty">' + t('my_comments_empty') + '</p>';
      return;
    }

    // Group by module/chapter
    var html = '';
    comments.forEach(function(c) {
      var date = c.createdAt && c.createdAt.toDate ? c.createdAt.toDate() : new Date();
      var chapterTitle = getChapterTitle(c.moduleId, c.chapterId);
      var moduleTitle = getModuleTitle(c.moduleId);

      html += '<div class="yb-cv-my-comment">';
      html += '  <div class="yb-cv-my-comment__location">';
      html += '    <span class="yb-cv-my-comment__module">' + esc(moduleTitle) + '</span>';
      html += '    <span class="yb-cv-my-comment__sep">/</span>';
      html += '    <button class="yb-cv-my-comment__chapter" data-action="goto-comment" data-module="' + c.moduleId + '" data-chapter="' + c.chapterId + '">' + esc(chapterTitle) + '</button>';
      html += '  </div>';
      html += '  <p class="yb-cv-my-comment__text">' + esc(c.content) + '</p>';
      html += '  <span class="yb-cv-my-comment__date">' + formatDate(date) + '</span>';
      html += '</div>';
    });

    listEl.innerHTML = html;

    // Bind goto buttons
    listEl.querySelectorAll('[data-action="goto-comment"]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var mid = btn.getAttribute('data-module');
        var cid = btn.getAttribute('data-chapter');
        hideMyComments();
        openModule(mid, cid);
      });
    });
  }

  function getChapterTitle(moduleId, chapterId) {
    var chapters = state.chaptersCache[moduleId];
    if (!chapters) return chapterId;
    for (var i = 0; i < chapters.length; i++) {
      if (chapters[i].id === chapterId) return localised(chapters[i], 'title');
    }
    return chapterId;
  }

  function getModuleTitle(moduleId) {
    for (var i = 0; i < state.modules.length; i++) {
      if (state.modules[i].id === moduleId) return localised(state.modules[i], 'title');
    }
    return moduleId;
  }

  // ════════════════════════════════════════
  // PROGRESS
  // ════════════════════════════════════════

  function loadProgress() {
    var progressId = state.user.uid + '_' + state.courseId;
    return db.collection('courseProgress').doc(progressId).get()
      .then(function(doc) {
        state.progress = doc.exists ? doc.data() : { viewed: {}, lastModule: null, lastChapter: null };
        updateProgressUI();
      })
      .catch(function() {
        state.progress = { viewed: {}, lastModule: null, lastChapter: null };
      });
  }

  function markChapterViewed(moduleId, chapterId) {
    var key = moduleId + '__' + chapterId;
    if (state.progress && state.progress.viewed && state.progress.viewed[key]) return;

    var progressId = state.user.uid + '_' + state.courseId;
    var update = {
      userId: state.user.uid,
      courseId: state.courseId,
      lastModule: moduleId,
      lastChapter: chapterId,
      lastAccessedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    update['viewed.' + key] = firebase.firestore.FieldValue.serverTimestamp();

    db.collection('courseProgress').doc(progressId).set(update, { merge: true })
      .then(function() {
        if (!state.progress) state.progress = { viewed: {} };
        if (!state.progress.viewed) state.progress.viewed = {};
        state.progress.viewed[key] = new Date();
        state.progress.lastModule = moduleId;
        state.progress.lastChapter = chapterId;
        updateProgressUI();
        // Update sidebar chapter check
        updateSidebarChapterViewed(moduleId, chapterId);
      })
      .catch(function(err) {
        console.warn('Failed to save progress:', err);
      });
  }

  function isChapterViewed(moduleId, chapterId) {
    var key = moduleId + '__' + chapterId;
    return state.progress && state.progress.viewed && state.progress.viewed[key];
  }

  function updateProgressUI() {
    var totalChapters = 0;
    var viewedChapters = 0;

    state.modules.forEach(function(mod) {
      var chapters = state.chaptersCache[mod.id] || [];
      totalChapters += chapters.length;
      chapters.forEach(function(ch) {
        if (isChapterViewed(mod.id, ch.id)) viewedChapters++;
      });
    });

    var pct = totalChapters > 0 ? Math.round((viewedChapters / totalChapters) * 100) : 0;

    var barEl = document.getElementById('yb-cv-progress-bar');
    var textEl = document.getElementById('yb-cv-progress-text');

    if (barEl) barEl.style.width = pct + '%';
    if (textEl) textEl.textContent = viewedChapters + ' ' + t('progress_of') + ' ' + totalChapters + ' — ' + pct + '%';
  }

  function updateSidebarChapterViewed(moduleId, chapterId) {
    var btn = document.querySelector('[data-action="open-chapter"][data-module="' + moduleId + '"][data-chapter="' + chapterId + '"]');
    if (!btn) return;
    btn.classList.add('yb-cv-ch--viewed');
    var checkSpan = btn.querySelector('.yb-cv-ch__check');
    if (checkSpan) {
      checkSpan.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    }
  }

  // ════════════════════════════════════════
  // UI STATE
  // ════════════════════════════════════════

  function showGate(type) {
    hide('yb-cv-loading');
    hide('yb-cv-viewer');
    hide('yb-cv-error-page');
    show('yb-cv-gate');

    var loginGate = document.getElementById('yb-cv-gate-login');
    var enrollGate = document.getElementById('yb-cv-gate-enroll');
    if (loginGate) loginGate.hidden = type !== 'login';
    if (enrollGate) enrollGate.hidden = type !== 'enroll';
  }

  function showViewer() {
    hide('yb-cv-gate');
    hide('yb-cv-error-page');
    show('yb-cv-viewer');
  }

  function showLoading(visible) {
    var loadingEl = document.getElementById('yb-cv-loading');
    if (loadingEl) loadingEl.hidden = !visible;
  }

  function showError(msg) {
    hide('yb-cv-gate');
    hide('yb-cv-viewer');
    hide('yb-cv-loading');
    show('yb-cv-error-page');
    var msgEl = document.getElementById('yb-cv-error-msg');
    if (msgEl) msgEl.textContent = msg;
  }

  function show(id) {
    var el = document.getElementById(id);
    if (el) el.hidden = false;
  }

  function hide(id) {
    var el = document.getElementById(id);
    if (el) el.hidden = true;
  }

  // ════════════════════════════════════════
  // HELPERS
  // ════════════════════════════════════════

  function esc(str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function getInitials(name) {
    if (!name) return '?';
    var parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name.substring(0, 2).toUpperCase();
  }

  function formatDate(date) {
    if (!date) return '';
    try {
      return date.toLocaleDateString(state.lang === 'en' ? 'en-GB' : 'da-DK', {
        day: 'numeric', month: 'short', year: 'numeric'
      });
    } catch (e) {
      return '';
    }
  }

  // ════════════════════════════════════════
  // BOOTSTRAP
  // ════════════════════════════════════════

  var checkInterval = setInterval(function() {
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
      clearInterval(checkInterval);
      init();
    }
  }, 100);

})();
