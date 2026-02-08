/**
 * YOGA BIBLE — COURSE VIEWER
 * Handles course content display, navigation, search, comments, progress,
 * personal notes, TOC, font size, reading time, completion tracking, and more.
 * Requires Firebase Auth + Firestore (loaded via CDN in base.njk).
 *
 * Firestore collections used:
 *   courses/{courseId}                              — course metadata
 *   courses/{courseId}/modules/{moduleId}            — module metadata
 *   courses/{courseId}/modules/{mid}/chapters/{cid}  — chapter content
 *   enrollments/{userId_courseId}                    — user enrollment
 *   courseProgress/{userId_courseId}                  — reading progress (viewed + completed)
 *   courseComments/{auto}                            — user comments
 *   courseNotes/{userId_courseId_moduleId_chapterId}  — personal notes per chapter
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
    progress: null,      // { viewed: {}, completed: {}, lastModule, lastChapter }
    comments: [],
    currentNote: null,
    sidebarOpen: false,
    searchOpen: false,
    tocOpen: false,
    fontsizeOpen: false,
    completionShown: false,
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

    // Restore font size preference
    restoreFontSize();

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

    // TOC toggle and close
    var tocToggle = document.getElementById('yb-cv-toc-toggle');
    var tocClose = document.getElementById('yb-cv-toc-close');
    if (tocToggle) tocToggle.addEventListener('click', toggleTOC);
    if (tocClose) tocClose.addEventListener('click', closeTOC);

    // Font size toggle
    var fontsizeToggle = document.getElementById('yb-cv-fontsize-toggle');
    if (fontsizeToggle) fontsizeToggle.addEventListener('click', toggleFontSize);

    // Font size buttons (delegated)
    var fontsizePanel = document.getElementById('yb-cv-fontsize');
    if (fontsizePanel) fontsizePanel.addEventListener('click', handleFontSizeClick);

    // Notes save
    var notesSaveBtn = document.getElementById('yb-cv-notes-save');
    if (notesSaveBtn) notesSaveBtn.addEventListener('click', saveNote);

    // Print button
    var printBtn = document.getElementById('yb-cv-print-btn');
    if (printBtn) printBtn.addEventListener('click', function() { window.print(); });

    // Complete checkbox
    var completeCheckbox = document.getElementById('yb-cv-complete-checkbox');
    if (completeCheckbox) completeCheckbox.addEventListener('change', handleCompleteToggle);

    // Completion celebration close
    var completionClose = document.getElementById('yb-cv-completion-close');
    if (completionClose) completionClose.addEventListener('click', closeCompletionCelebration);

    // Keyboard: Escape closes search/sidebar/TOC/fontsize, arrows navigate chapters
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        if (state.searchOpen) closeSearch();
        if (state.sidebarOpen) closeSidebar();
        if (state.tocOpen) closeTOC();
        if (state.fontsizeOpen) closeFontSize();
      }

      // Arrow key navigation — only when not focused on input/textarea/select
      var tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      if (e.key === 'ArrowLeft') {
        navigatePrev();
      } else if (e.key === 'ArrowRight') {
        navigateNext();
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

    // Build TOC from rendered content
    buildTOC();

    // Calculate and display reading time
    updateReadingTime();

    // Render breadcrumb
    renderBreadcrumb(moduleId, chapter);

    // Update complete checkbox state
    updateCompleteCheckbox(moduleId, chapterId);

    // Close sidebar on mobile
    closeSidebar();

    // Close TOC and font size panels
    closeTOC();
    closeFontSize();

    // Scroll content to top (both the content pane and window)
    var contentEl = document.getElementById('yb-cv-content');
    if (contentEl) contentEl.scrollTop = 0;
    window.scrollTo(0, 0);

    // Load comments and notes in parallel
    var commentsPromise = loadComments(moduleId, chapterId);
    var notesPromise = loadNote(moduleId, chapterId);

    return Promise.all([commentsPromise, notesPromise]);
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
  // BREADCRUMB
  // ════════════════════════════════════════

  function renderBreadcrumb(moduleId, chapter) {
    var breadcrumbEl = document.getElementById('yb-cv-chapter-breadcrumb');
    if (!breadcrumbEl) return;

    var mod = null;
    for (var i = 0; i < state.modules.length; i++) {
      if (state.modules[i].id === moduleId) { mod = state.modules[i]; break; }
    }

    if (!mod) {
      breadcrumbEl.innerHTML = '';
      return;
    }

    var moduleTitle = esc(localised(mod, 'title'));
    var chapterTitle = esc(localised(chapter, 'title'));

    var html = '<button class="yb-cv-breadcrumb__module" data-action="breadcrumb-module" data-module="' + moduleId + '">' + moduleTitle + '</button>';
    html += '<span class="yb-cv-breadcrumb__sep"> / </span>';
    html += '<span class="yb-cv-breadcrumb__chapter">' + chapterTitle + '</span>';

    breadcrumbEl.innerHTML = html;

    // Bind breadcrumb module click
    var moduleBtn = breadcrumbEl.querySelector('[data-action="breadcrumb-module"]');
    if (moduleBtn) {
      moduleBtn.addEventListener('click', function() {
        var mid = moduleBtn.getAttribute('data-module');
        openModule(mid);
      });
    }
  }

  // ════════════════════════════════════════
  // READING TIME
  // ════════════════════════════════════════

  function updateReadingTime() {
    var readingTimeEl = document.getElementById('yb-cv-reading-time');
    if (!readingTimeEl) return;

    var contentEl = document.getElementById('yb-cv-chapter-content');
    if (!contentEl) {
      readingTimeEl.textContent = '';
      return;
    }

    // Strip HTML and count words
    var text = contentEl.textContent || contentEl.innerText || '';
    var words = text.trim().split(/\s+/).filter(function(w) { return w.length > 0; });
    var minutes = Math.max(1, Math.round(words.length / 200));

    if (state.lang === 'en') {
      readingTimeEl.textContent = minutes + ' min read';
    } else {
      readingTimeEl.textContent = minutes + ' min læsning';
    }
  }

  // ════════════════════════════════════════
  // TABLE OF CONTENTS (TOC)
  // ════════════════════════════════════════

  function buildTOC() {
    var contentEl = document.getElementById('yb-cv-chapter-content');
    var tocListEl = document.getElementById('yb-cv-toc-list');
    if (!contentEl || !tocListEl) return;

    var headings = contentEl.querySelectorAll('h2, h3');
    if (!headings.length) {
      tocListEl.innerHTML = '';
      // Hide TOC toggle if no headings
      var tocToggle = document.getElementById('yb-cv-toc-toggle');
      if (tocToggle) tocToggle.hidden = true;
      return;
    }

    // Show TOC toggle
    var tocToggle = document.getElementById('yb-cv-toc-toggle');
    if (tocToggle) tocToggle.hidden = false;

    var html = '';
    for (var i = 0; i < headings.length; i++) {
      var heading = headings[i];
      var slug = slugify(heading.textContent);
      // Ensure unique ID by appending index if needed
      var id = slug || 'heading-' + i;
      heading.setAttribute('id', id);

      var isH3 = heading.tagName.toLowerCase() === 'h3';
      html += '<li class="yb-cv-toc__item' + (isH3 ? ' yb-cv-toc__item--indent' : '') + '">';
      html += '<a class="yb-cv-toc__link" href="#' + id + '" data-toc-target="' + id + '">' + esc(heading.textContent) + '</a>';
      html += '</li>';
    }

    tocListEl.innerHTML = html;

    // Bind TOC link clicks for smooth scroll
    var tocLinks = tocListEl.querySelectorAll('.yb-cv-toc__link');
    for (var j = 0; j < tocLinks.length; j++) {
      tocLinks[j].addEventListener('click', handleTOCClick);
    }
  }

  function handleTOCClick(e) {
    e.preventDefault();
    var targetId = e.currentTarget.getAttribute('data-toc-target');
    var targetEl = document.getElementById(targetId);
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    closeTOC();
  }

  function slugify(text) {
    return (text || '')
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-æøåäöü]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 80);
  }

  function toggleTOC() {
    state.tocOpen = !state.tocOpen;
    var tocEl = document.getElementById('yb-cv-toc');
    if (tocEl) tocEl.hidden = !state.tocOpen;
  }

  function closeTOC() {
    state.tocOpen = false;
    var tocEl = document.getElementById('yb-cv-toc');
    if (tocEl) tocEl.hidden = true;
  }

  // ════════════════════════════════════════
  // FONT SIZE
  // ════════════════════════════════════════

  function toggleFontSize() {
    state.fontsizeOpen = !state.fontsizeOpen;
    var panel = document.getElementById('yb-cv-fontsize');
    if (panel) panel.hidden = !state.fontsizeOpen;
  }

  function closeFontSize() {
    state.fontsizeOpen = false;
    var panel = document.getElementById('yb-cv-fontsize');
    if (panel) panel.hidden = true;
  }

  function handleFontSizeClick(e) {
    var btn = e.target.closest('[data-fontsize]');
    if (!btn) return;
    var size = btn.getAttribute('data-fontsize');
    applyFontSize(size);
    try { localStorage.setItem('yb-cv-fontsize', size); } catch (err) { /* ignore */ }
    closeFontSize();
  }

  function applyFontSize(size) {
    var contentEl = document.getElementById('yb-cv-chapter-content');
    if (!contentEl) return;

    // Remove all size classes
    contentEl.classList.remove(
      'yb-cv-chapter__body--small',
      'yb-cv-chapter__body--medium',
      'yb-cv-chapter__body--large'
    );

    // Apply requested size
    if (size === 'small' || size === 'medium' || size === 'large') {
      contentEl.classList.add('yb-cv-chapter__body--' + size);
    }

    // Update active state on buttons
    var panel = document.getElementById('yb-cv-fontsize');
    if (panel) {
      var buttons = panel.querySelectorAll('[data-fontsize]');
      for (var i = 0; i < buttons.length; i++) {
        var isActive = buttons[i].getAttribute('data-fontsize') === size;
        buttons[i].classList.toggle('yb-cv-fontsize__btn--active', isActive);
      }
    }
  }

  function restoreFontSize() {
    try {
      var saved = localStorage.getItem('yb-cv-fontsize');
      if (saved) {
        applyFontSize(saved);
      }
    } catch (err) { /* ignore */ }
  }

  // ════════════════════════════════════════
  // PERSONAL NOTES
  // ════════════════════════════════════════

  function getNoteId(moduleId, chapterId) {
    return state.user.uid + '_' + state.courseId + '_' + moduleId + '_' + chapterId;
  }

  function loadNote(moduleId, chapterId) {
    var noteInput = document.getElementById('yb-cv-notes-input');
    var noteStatus = document.getElementById('yb-cv-notes-status');
    if (noteInput) noteInput.value = '';
    if (noteStatus) noteStatus.textContent = '';
    state.currentNote = null;

    var noteId = getNoteId(moduleId, chapterId);
    return db.collection('courseNotes').doc(noteId).get()
      .then(function(doc) {
        if (doc.exists) {
          state.currentNote = doc.data();
          if (noteInput) noteInput.value = state.currentNote.content || '';
        }
      })
      .catch(function(err) {
        console.warn('Failed to load note:', err);
      });
  }

  function saveNote() {
    var noteInput = document.getElementById('yb-cv-notes-input');
    var noteStatus = document.getElementById('yb-cv-notes-status');
    if (!noteInput || !state.currentModule || !state.currentChapter) return;

    var content = noteInput.value.trim();
    var noteId = getNoteId(state.currentModule, state.currentChapter);

    var noteData = {
      userId: state.user.uid,
      courseId: state.courseId,
      moduleId: state.currentModule,
      chapterId: state.currentChapter,
      content: content,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (noteStatus) noteStatus.textContent = t('notes_saving') || '...';

    db.collection('courseNotes').doc(noteId).set(noteData, { merge: true })
      .then(function() {
        state.currentNote = noteData;
        state.currentNote.content = content;
        if (noteStatus) {
          noteStatus.textContent = t('notes_saved') || (state.lang === 'en' ? 'Note saved' : 'Note gemt');
          // Clear status after 3 seconds
          setTimeout(function() {
            if (noteStatus) noteStatus.textContent = '';
          }, 3000);
        }
      })
      .catch(function(err) {
        console.error('Failed to save note:', err);
        if (noteStatus) noteStatus.textContent = t('notes_error') || 'Error';
      });
  }

  // ════════════════════════════════════════
  // MARK CHAPTER COMPLETE
  // ════════════════════════════════════════

  function handleCompleteToggle() {
    var checkbox = document.getElementById('yb-cv-complete-checkbox');
    if (!checkbox || !state.currentModule || !state.currentChapter) return;

    if (checkbox.checked) {
      markChapterComplete(state.currentModule, state.currentChapter);
    } else {
      unmarkChapterComplete(state.currentModule, state.currentChapter);
    }
  }

  function markChapterComplete(moduleId, chapterId) {
    var key = moduleId + '__' + chapterId;
    var progressId = state.user.uid + '_' + state.courseId;
    var update = {};
    update['completed.' + key] = firebase.firestore.FieldValue.serverTimestamp();

    db.collection('courseProgress').doc(progressId).set(update, { merge: true })
      .then(function() {
        if (!state.progress) state.progress = { viewed: {}, completed: {} };
        if (!state.progress.completed) state.progress.completed = {};
        state.progress.completed[key] = new Date();
        updateCompleteCheckbox(moduleId, chapterId);
        updateProgressUI();
        // Check if all chapters are now complete
        checkCourseDone();
      })
      .catch(function(err) {
        console.warn('Failed to mark complete:', err);
        // Revert checkbox
        var checkbox = document.getElementById('yb-cv-complete-checkbox');
        if (checkbox) checkbox.checked = false;
      });
  }

  function unmarkChapterComplete(moduleId, chapterId) {
    var key = moduleId + '__' + chapterId;
    var progressId = state.user.uid + '_' + state.courseId;
    var update = {};
    update['completed.' + key] = firebase.firestore.FieldValue.delete();

    db.collection('courseProgress').doc(progressId).update(update)
      .then(function() {
        if (state.progress && state.progress.completed) {
          delete state.progress.completed[key];
        }
        updateCompleteCheckbox(moduleId, chapterId);
        updateProgressUI();
      })
      .catch(function(err) {
        console.warn('Failed to unmark complete:', err);
        // Revert checkbox
        var checkbox = document.getElementById('yb-cv-complete-checkbox');
        if (checkbox) checkbox.checked = true;
      });
  }

  function isChapterComplete(moduleId, chapterId) {
    var key = moduleId + '__' + chapterId;
    return state.progress && state.progress.completed && state.progress.completed[key];
  }

  function updateCompleteCheckbox(moduleId, chapterId) {
    var checkbox = document.getElementById('yb-cv-complete-checkbox');
    var label = document.getElementById('yb-cv-complete-text');
    if (!checkbox) return;

    var completed = isChapterComplete(moduleId, chapterId);
    checkbox.checked = !!completed;
    if (label) {
      label.textContent = completed ? t('mark_complete_done') : t('mark_complete');
    }
  }

  // ════════════════════════════════════════
  // COMPLETION CELEBRATION
  // ════════════════════════════════════════

  function checkCourseDone() {
    if (!state.allChaptersLoaded) return;

    // Check localStorage flag — only show once per course
    var shownKey = 'yb-cv-completion-shown-' + state.courseId;
    try {
      if (localStorage.getItem(shownKey)) return;
    } catch (err) { /* ignore */ }

    var totalChapters = 0;
    var completedChapters = 0;

    state.modules.forEach(function(mod) {
      var chapters = state.chaptersCache[mod.id] || [];
      totalChapters += chapters.length;
      chapters.forEach(function(ch) {
        if (isChapterComplete(mod.id, ch.id)) completedChapters++;
      });
    });

    if (totalChapters > 0 && completedChapters === totalChapters) {
      showCompletionCelebration();
      try { localStorage.setItem(shownKey, '1'); } catch (err) { /* ignore */ }
    }
  }

  function showCompletionCelebration() {
    var overlay = document.getElementById('yb-cv-completion');
    if (overlay) overlay.hidden = false;
    state.completionShown = true;
  }

  function closeCompletionCelebration() {
    var overlay = document.getElementById('yb-cv-completion');
    if (overlay) overlay.hidden = true;
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
        state.progress = doc.exists
          ? doc.data()
          : { viewed: {}, completed: {}, lastModule: null, lastChapter: null };
        // Ensure completed map exists
        if (!state.progress.completed) state.progress.completed = {};
        if (!state.progress.viewed) state.progress.viewed = {};
        updateProgressUI();
      })
      .catch(function() {
        state.progress = { viewed: {}, completed: {}, lastModule: null, lastChapter: null };
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
        if (!state.progress) state.progress = { viewed: {}, completed: {} };
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
    var completedChapters = 0;

    state.modules.forEach(function(mod) {
      var chapters = state.chaptersCache[mod.id] || [];
      totalChapters += chapters.length;
      chapters.forEach(function(ch) {
        if (isChapterComplete(mod.id, ch.id)) completedChapters++;
      });
    });

    var pct = totalChapters > 0 ? Math.round((completedChapters / totalChapters) * 100) : 0;

    var barEl = document.getElementById('yb-cv-progress-bar');
    var textEl = document.getElementById('yb-cv-progress-text');

    if (barEl) barEl.style.width = pct + '%';
    if (textEl) textEl.textContent = completedChapters + ' ' + t('progress_of') + ' ' + totalChapters + ' — ' + pct + '%';
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
