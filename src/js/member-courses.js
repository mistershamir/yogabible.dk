/**
 * YOGA BIBLE — MEMBER AREA: MY COURSES
 * Standalone course listing and viewer for the member area.
 * Loads enrollments from Firestore, renders course cards,
 * and opens the course viewer inline.
 */
(function() {
  'use strict';

  var db, currentUser;
  var loaded = false;

  // Translation strings (set by template)
  var T = window._ybMemberCoursesT || {};

  // Wait for panel to become visible, then load
  function init() {
    var panel = document.getElementById('yb-ma-tp-courses');
    if (!panel) return;

    // Observe visibility (the tab panel uses hidden attribute)
    var observer = new MutationObserver(function() {
      if (!panel.hidden && !loaded) {
        loaded = true;
        observer.disconnect();
        waitForAuth();
      }
    });
    observer.observe(panel, { attributes: true, attributeFilter: ['hidden'] });

    // Also check immediately (if already visible)
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
          loadMyCourses();
        }
        auth.onAuthStateChanged(function(user) {
          currentUser = user;
          if (user) loadMyCourses();
        });
      }
    }, 100);
  }

  function isDa() {
    return window.location.pathname.indexOf('/en/') !== 0;
  }

  function esc(str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function loadMyCourses() {
    if (!currentUser || !db) return;
    var container = document.getElementById('yb-ma-courses-list');
    var emptyEl = document.getElementById('yb-ma-courses-empty');
    var loadingEl = document.getElementById('yb-ma-courses-loading');
    if (!container) return;

    db.collection('enrollments')
      .where('userId', '==', currentUser.uid)
      .get()
      .then(function(snap) {
        var courseIds = [];
        snap.forEach(function(doc) {
          var d = doc.data();
          if (d.status === 'active') courseIds.push(d.courseId);
        });
        if (!courseIds.length) {
          if (loadingEl) loadingEl.hidden = true;
          container.innerHTML = '';
          if (emptyEl) emptyEl.hidden = false;
          return;
        }
        if (emptyEl) emptyEl.hidden = true;

        var promises = courseIds.map(function(courseId) {
          return db.collection('courses').doc(courseId).get()
            .then(function(courseDoc) {
              if (!courseDoc.exists) return null;

              var modulesPromise = db.collection('courses').doc(courseId)
                .collection('modules').orderBy('order').get()
                .then(function(s) { return s.size; })
                .catch(function() { return 0; });

              var progressPromise = db.collection('courseProgress')
                .doc(currentUser.uid + '_' + courseId).get()
                .then(function(d) { return d.exists ? d.data() : null; })
                .catch(function() { return null; });

              return Promise.all([modulesPromise, progressPromise])
                .then(function(results) {
                  return {
                    id: courseId,
                    course: courseDoc.data(),
                    moduleCount: results[0],
                    progress: results[1]
                  };
                });
            })
            .catch(function() { return null; });
        });

        return Promise.all(promises);
      })
      .then(function(courses) {
        if (!courses) return;
        if (loadingEl) loadingEl.hidden = true;
        courses = courses.filter(function(c) { return c !== null; });
        if (!courses.length) {
          container.innerHTML = '';
          if (emptyEl) emptyEl.hidden = false;
          return;
        }
        renderCourseCards(container, courses);
      })
      .catch(function(err) {
        console.error('Error loading courses:', err);
        if (loadingEl) loadingEl.hidden = true;
        container.innerHTML = '<p style="color:#6F6A66;text-align:center">' +
          (isDa() ? 'Kunne ikke hente kurser.' : 'Could not load courses.') + '</p>';
      });
  }

  function renderCourseCards(container, courses) {
    var lang = isDa() ? 'da' : 'en';
    var html = courses.map(function(item) {
      var c = item.course;
      var title = c['title_' + lang] || c.title_da || c.title || 'Course';
      var desc = c['description_' + lang] || c.description_da || c.description || '';
      var icon = c.icon || '📖';

      var viewed = item.progress && item.progress.viewed ? Object.keys(item.progress.viewed).length : 0;
      var hasProgress = viewed > 0;
      var btnLabel = hasProgress
        ? (T.continue_btn || 'Continue')
        : (T.start_btn || 'Start');
      var modulesLabel = T.modules_label || 'modules';
      var chaptersLabel = T.chapters_label || 'chapters read';

      return '<div class="yb-ma-course-card">' +
        '<div class="yb-ma-course-card__icon">' + icon + '</div>' +
        '<div class="yb-ma-course-card__info">' +
          '<h3 class="yb-ma-course-card__title">' + esc(title) + '</h3>' +
          '<p class="yb-ma-course-card__desc">' + esc(desc) + '</p>' +
          '<span class="yb-ma-course-card__meta">' + item.moduleCount + ' ' + modulesLabel +
            (hasProgress ? ' &middot; ' + viewed + ' ' + chaptersLabel : '') +
          '</span>' +
        '</div>' +
        '<button class="yb-btn yb-btn--primary yb-ma-course-card__btn" ' +
          'data-yb-open-course="' + esc(item.id) + '" ' +
          (item.progress && item.progress.lastModule ? 'data-module="' + esc(item.progress.lastModule) + '" ' : '') +
          (item.progress && item.progress.lastChapter ? 'data-chapter="' + esc(item.progress.lastChapter) + '" ' : '') +
        '>' + esc(btnLabel) + '</button>' +
      '</div>';
    }).join('');

    container.innerHTML = html;

    // Bind open buttons
    container.querySelectorAll('[data-yb-open-course]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var courseId = btn.getAttribute('data-yb-open-course');
        var moduleId = btn.getAttribute('data-module') || null;
        var chapterId = btn.getAttribute('data-chapter') || null;
        openCourseViewer(courseId, moduleId, chapterId);
      });
    });
  }

  function openCourseViewer(courseId, moduleId, chapterId) {
    var listEl = document.getElementById('yb-ma-courses-list-wrap');
    var viewerEl = document.getElementById('yb-ma-course-viewer');
    if (!listEl || !viewerEl) return;

    listEl.hidden = true;
    viewerEl.hidden = false;
    viewerEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

    if (window.YBCourseViewer) {
      window.YBCourseViewer.init(courseId, {
        embedded: true,
        lang: isDa() ? 'da' : 'en',
        module: moduleId,
        chapter: chapterId,
        onBack: function() {
          closeCourseViewer();
        }
      });
    }
  }

  function closeCourseViewer() {
    var listEl = document.getElementById('yb-ma-courses-list-wrap');
    var viewerEl = document.getElementById('yb-ma-course-viewer');
    if (!listEl || !viewerEl) return;

    if (window.YBCourseViewer) {
      window.YBCourseViewer.destroy();
    }
    viewerEl.hidden = true;
    listEl.hidden = false;

    // Refresh course list to update progress
    loaded = false;
    loadMyCourses();
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
