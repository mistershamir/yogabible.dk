/**
 * YOGA BIBLE — MEMBER PAGE
 * Toggles guest/user view based on Firebase auth state.
 * Renders role badge, manages tab navigation with hash routing,
 * lazy-loads iframes for courses/schedule/profile tabs,
 * auto-resizes iframes to fit content,
 * and populates the dashboard hub with dynamic data.
 */
(function() {
  'use strict';

  var checkInterval = setInterval(function() {
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
      clearInterval(checkInterval);
      init();
    }
  }, 100);

  function getInitials(name) {
    var parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return parts[0].substring(0, 2).toUpperCase();
  }

  function init() {
    var auth = firebase.auth();
    var guest = document.getElementById('yb-member-guest');
    var user = document.getElementById('yb-member-user');
    var nameEl = document.getElementById('yb-member-name');
    var avatarEl = document.getElementById('yb-member-avatar');
    if (!guest || !user) return;

    var lang = window.location.pathname.indexOf('/en/') === 0 ? 'en' : 'da';

    auth.onAuthStateChanged(function(u) {
      try {
        if (u) {
          guest.style.display = 'none';
          user.style.display = '';
          var displayName = u.displayName || (u.email ? u.email.split('@')[0] : '');
          var firstName = displayName.split(' ')[0] || '';
          if (nameEl) nameEl.textContent = firstName;
          if (avatarEl) avatarEl.textContent = displayName ? getInitials(displayName) : '';
          renderDashboardGreeting(firstName);
          loadDashboardCourse(u.uid);
          routeFromHash();
        } else {
          guest.style.display = '';
          user.style.display = 'none';
        }
      } catch (e) {
        console.error('Member page auth state error:', e);
      }
    });

    // Listen for role/permissions data from firebase-auth.js
    document.addEventListener('yb:user-loaded', function(e) {
      try {
        var detail = e.detail;
        if (!detail) return;
        renderRoleBadge(detail.role, detail.roleDetails, lang);
      } catch (e2) {
        console.error('Member page role badge error:', e2);
      }
    });

    initTabNav();
  }

  // ══════════════════════════════════════
  // DASHBOARD HUB
  // ══════════════════════════════════════

  function renderDashboardGreeting(firstName) {
    var el = document.getElementById('yb-dash-greeting');
    if (!el) return;
    var T = window._ybDashT || {};
    var h = new Date().getHours();
    var greeting;
    if (h < 12) greeting = T.morning || 'God morgen';
    else if (h < 17) greeting = T.afternoon || 'God eftermiddag';
    else greeting = T.evening || 'God aften';
    el.textContent = greeting + ', ' + firstName;
  }

  var dashCourseLoaded = false;

  function loadDashboardCourse(uid) {
    if (dashCourseLoaded) return;
    dashCourseLoaded = true;

    var cardEl = document.getElementById('yb-dash-course');
    var bodyEl = document.getElementById('yb-dash-course-body');
    if (!cardEl || !bodyEl) return;

    var T = window._ybDashT || {};
    var isDa = window.location.pathname.indexOf('/en/') !== 0;
    var lang = isDa ? 'da' : 'en';

    var db = firebase.firestore();

    db.collection('enrollments')
      .where('userId', '==', uid)
      .get()
      .then(function(snap) {
        var courseIds = [];
        snap.forEach(function(doc) {
          var d = doc.data();
          if (d.status === 'active') courseIds.push(d.courseId);
        });
        if (!courseIds.length) {
          // No active courses — show "Explore courses" card
          bodyEl.innerHTML =
            '<h3 class="yb-dash__action-title">' + escHtml(T.no_courses_title || 'Explore courses') + '</h3>' +
            '<p class="yb-dash__action-desc">' + escHtml(T.no_courses_desc || 'Browse available courses') + ' &rarr;</p>';
          cardEl.style.display = '';
          cardEl.style.cursor = 'pointer';
          cardEl.onclick = function() {
            var tabBtn = document.querySelector('.yb-ma-tabs__btn[data-yb-ma-tab="courses"]');
            if (tabBtn) tabBtn.click();
          };
          return;
        }

        // Get first enrolled course + progress
        var courseId = courseIds[0];
        Promise.all([
          db.collection('courses').doc(courseId).get(),
          db.collection('courseProgress').doc(uid + '_' + courseId).get()
        ]).then(function(results) {
          var courseDoc = results[0];
          var progressDoc = results[1];
          if (!courseDoc.exists) return;

          var c = courseDoc.data();
          var title = c['title_' + lang] || c.title_da || c.title || 'Course';
          var progress = progressDoc.exists ? progressDoc.data() : null;
          var viewed = progress && progress.viewed ? Object.keys(progress.viewed).length : 0;
          var hasProgress = viewed > 0;
          var btnLabel = hasProgress ? (T.continue_label || 'Continue') : (T.start_label || 'Start');

          var html = '<h3 class="yb-dash__action-title">' + escHtml(T.course_card_title || 'Continue your course') + '</h3>';
          html += '<p class="yb-dash__action-desc">' + escHtml(title) + '</p>';
          if (hasProgress) {
            html += '<p class="yb-dash__action-meta">' + viewed + ' ' + (T.chapters_read || 'chapters read') + '</p>';
          }
          html += '<span class="yb-dash__action-btn">' + escHtml(btnLabel) + ' &rarr;</span>';

          bodyEl.innerHTML = html;
          cardEl.style.display = '';
          cardEl.onclick = function() {
            var tabBtn = document.querySelector('.yb-ma-tabs__btn[data-yb-ma-tab="courses"]');
            if (tabBtn) tabBtn.click();
          };
        });
      })
      .catch(function(err) {
        console.error('Dashboard course load error:', err);
      });
  }

  // ── Role Badge ──

  function renderRoleBadge(role, roleDetails, lang) {
    var badgeEl = document.getElementById('yb-member-role-badge');
    if (!badgeEl || !window.YBRoles) return;

    var label = window.YBRoles.getRoleLabel(role, lang);
    var detail = window.YBRoles.getRoleDetail(role, roleDetails, lang);
    var roleConfig = window.YBRoles.ROLES[role] || {};
    var color = roleConfig.color || '#6F6A66';

    var html = '<span class="yb-ma-role-badge__pill" style="color:' + color + ';border-color:' + color + '">';
    html += label;
    html += '</span>';
    if (detail) {
      html += '<span class="yb-ma-role-badge__detail">' + detail + '</span>';
    }

    badgeEl.innerHTML = html;
    badgeEl.style.display = '';
  }

  // ── Tab Navigation ──

  var VALID_TABS = ['hub', 'courses', 'live', 'events', 'schedule', 'glossary', 'journal', 'materials', 'profile', 'leads'];
  var IFRAME_TABS = ['schedule', 'profile', 'leads'];
  var loadedIframes = {};
  var resizeTimers = {};

  function initTabNav() {
    // Tab button clicks (in the tab bar)
    var tabBtns = document.querySelectorAll('[data-yb-ma-tab]');
    tabBtns.forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        // Only prevent default for elements that are links (hub cards use <a>)
        if (this.tagName === 'A') e.preventDefault();
        var tab = this.getAttribute('data-yb-ma-tab');
        if (VALID_TABS.indexOf(tab) !== -1) {
          showTab(tab);
        }
      });
    });

    // Profile sub-tab clicks
    initProfileSubTabs();

    // Browser back/forward
    window.addEventListener('popstate', function() {
      routeFromHash();
    });
  }

  // ── Profile sub-tab navigation ──
  var PROFILE_SUBS = ['profile', 'passes', 'visits', 'store', 'receipts', 'applications', 'giftcards'];

  function initProfileSubTabs() {
    var subBtns = document.querySelectorAll('[data-yb-profile-sub]');
    subBtns.forEach(function(btn) {
      btn.addEventListener('click', function() {
        var sub = btn.getAttribute('data-yb-profile-sub');
        if (PROFILE_SUBS.indexOf(sub) === -1) return;
        switchProfileSub(sub);
      });
    });
  }

  function switchProfileSub(sub) {
    // Update active state on sub-nav buttons
    var subBtns = document.querySelectorAll('[data-yb-profile-sub]');
    subBtns.forEach(function(btn) {
      if (btn.getAttribute('data-yb-profile-sub') === sub) {
        btn.classList.add('is-active');
      } else {
        btn.classList.remove('is-active');
      }
    });

    var iframe = document.getElementById('yb-ma-profile-iframe');
    if (!iframe) return;

    // If iframe not yet loaded, update the data-src before first load
    if (!loadedIframes['profile']) {
      var baseSrc = iframe.getAttribute('data-src') || '';
      iframe.setAttribute('data-src', baseSrc.replace(/#.*$/, '') + '#' + sub);
      return;
    }

    // Iframe already loaded — click the tab button inside profile.js
    try {
      var tabBtn = iframe.contentDocument.querySelector('[data-yb-tab="' + sub + '"]');
      if (tabBtn) {
        tabBtn.click();
      }
      // Reset resize polling for new content
      autoResizeIframe(iframe, 'profile');
    } catch (e) {
      // Cross-origin fallback: reload with new hash
      var src = iframe.src.replace(/#.*$/, '') + '#' + sub;
      iframe.src = src;
    }
  }

  function routeFromHash() {
    var hash = window.location.hash.slice(1);
    if (hash && VALID_TABS.indexOf(hash) !== -1) {
      showTab(hash, true);
    } else {
      showTab('hub', true);
    }
  }

  function showTab(tab, skipPush) {
    if (VALID_TABS.indexOf(tab) === -1) tab = 'hub';

    // Update URL hash
    if (!skipPush) {
      if (tab === 'hub') {
        history.pushState({}, '', window.location.pathname);
      } else {
        history.pushState({ tab: tab }, '', '#' + tab);
      }
    }

    // Update tab buttons — mark active
    var tabBtns = document.querySelectorAll('.yb-ma-tabs__btn[data-yb-ma-tab]');
    tabBtns.forEach(function(btn) {
      var btnTab = btn.getAttribute('data-yb-ma-tab');
      if (btnTab === tab) {
        btn.classList.add('is-active');
      } else {
        btn.classList.remove('is-active');
      }
    });

    // Show/hide tab panels
    var panels = document.querySelectorAll('[data-yb-ma-panel]');
    panels.forEach(function(panel) {
      var panelTab = panel.getAttribute('data-yb-ma-panel');
      if (panelTab === tab) {
        panel.hidden = false;
      } else {
        panel.hidden = true;
      }
    });

    // Lazy-load iframe if needed
    if (IFRAME_TABS.indexOf(tab) !== -1 && !loadedIframes[tab]) {
      var panel = document.getElementById('yb-ma-tp-' + tab);
      if (panel) {
        var iframe = panel.querySelector('iframe[data-src]');
        if (iframe) {
          iframe.src = iframe.getAttribute('data-src');
          iframe.removeAttribute('data-src');
          loadedIframes[tab] = true;

          // Auto-resize iframe when it loads
          iframe.addEventListener('load', function() {
            autoResizeIframe(iframe, tab);
          });
        }
      }
    }

    // Scroll tab bar to show active button
    scrollTabIntoView(tab);

    // Scroll page to top of tab content
    var tabsBar = document.getElementById('yb-ma-tabs');
    if (tabsBar) {
      var rect = tabsBar.getBoundingClientRect();
      if (rect.top < 0) {
        tabsBar.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }

  function scrollTabIntoView(tab) {
    var btn = document.querySelector('.yb-ma-tabs__btn[data-yb-ma-tab="' + tab + '"]');
    if (btn) {
      btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }

  function autoResizeIframe(iframe, tab) {
    function resize() {
      try {
        var doc = iframe.contentDocument || iframe.contentWindow.document;
        var h = doc.documentElement.scrollHeight;
        if (h > 100) {
          iframe.style.height = h + 'px';
        }
      } catch (e) {
        // Cross-origin — can't resize
      }
    }

    // Initial resize
    resize();

    // Poll for content changes (dynamic content loads in tabs)
    if (resizeTimers[tab]) clearInterval(resizeTimers[tab]);
    var count = 0;
    resizeTimers[tab] = setInterval(function() {
      resize();
      count++;
      // Stop polling after 30 seconds
      if (count > 60) {
        clearInterval(resizeTimers[tab]);
      }
    }, 500);
  }

  /* ══════════════════════════════════════════
     RECORDINGS — lazy-load when live tab opened
     ══════════════════════════════════════════ */
  var recordingsLoaded = false;
  var allRecordings = [];

  function loadRecordings() {
    if (recordingsLoaded) return;
    recordingsLoaded = true;

    var listEl = document.getElementById('yb-ma-recordings-list');
    var emptyEl = document.getElementById('yb-ma-recordings-empty');
    var toolbarEl = document.getElementById('yb-ma-recordings-toolbar');
    if (!listEl) return;

    var isDa = window.location.pathname.indexOf('/en/') !== 0;

    // Set bilingual placeholder/label text
    var searchEl = document.getElementById('yb-ma-rec-search');
    var instructorEl = document.getElementById('yb-ma-rec-instructor');
    var sortEl = document.getElementById('yb-ma-rec-sort');
    var countEl = document.getElementById('yb-ma-rec-count');
    if (searchEl) searchEl.placeholder = isDa ? 'Søg i optagelser…' : 'Search recordings…';
    if (instructorEl) instructorEl.options[0].text = isDa ? 'Alle instruktører' : 'All instructors';
    if (sortEl) {
      sortEl.options[0].text = isDa ? 'Nyeste først' : 'Newest first';
      sortEl.options[1].text = isDa ? 'Ældste først' : 'Oldest first';
    }

    function getToken() {
      if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) {
        return firebase.auth().currentUser.getIdToken();
      }
      return Promise.resolve('');
    }

    function formatDuration(mins) {
      if (!mins) return '';
      var h = Math.floor(mins / 60);
      var m = mins % 60;
      if (h > 0) return h + 'h ' + (m > 0 ? m + 'm' : '');
      return m + ' min';
    }

    function renderCard(item) {
      var title = isDa ? (item.title_da || item.title_en || '') : (item.title_en || item.title_da || '');
      var d = new Date(item.startDateTime);
      var dateStr = d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear();
      var dur = item.duration ? formatDuration(item.duration) : '';

      var card = '';
      card += '<div style="background:#1a1a1a;border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);transition:all 0.3s ease"'
        + ' onmouseover="this.style.borderColor=\'rgba(247,92,3,0.3)\';this.style.boxShadow=\'0 8px 30px rgba(0,0,0,0.3)\'"'
        + ' onmouseout="this.style.borderColor=\'rgba(255,255,255,0.06)\';this.style.boxShadow=\'none\'">';

      // Thumbnail with play button overlay
      if (item.recordingPlaybackId) {
        card += '<div style="aspect-ratio:16/9;background:#111;position:relative;cursor:pointer" data-rec-playback="' + item.recordingPlaybackId + '">';
        card += '<img src="https://image.mux.com/' + item.recordingPlaybackId + '/thumbnail.jpg?width=560&height=315&fit_mode=smartcrop" alt="" style="width:100%;height:100%;object-fit:cover;display:block" loading="lazy">';
        card += '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.15);transition:background 0.3s ease">';
        card += '<div style="width:52px;height:52px;border-radius:50%;background:rgba(247,92,3,0.9);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(0,0,0,0.4);transition:transform 0.2s ease">';
        card += '<svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><polygon points="6 3 20 12 6 21 6 3"/></svg>';
        card += '</div></div>';
        // Duration badge
        if (dur) {
          card += '<span style="position:absolute;bottom:10px;right:10px;background:rgba(0,0,0,0.8);color:#FFFCF9;font-size:0.7rem;font-weight:600;padding:3px 8px;border-radius:4px;letter-spacing:0.02em">' + dur + '</span>';
        }
        card += '</div>';
      }

      // Info
      card += '<div style="padding:1rem 1.15rem">';
      card += '<p style="color:#FFFCF9;font-size:0.9rem;font-weight:700;margin:0 0 0.4rem;line-height:1.35">' + escHtml(title) + '</p>';
      card += '<div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap">';
      card += '<span style="color:#999;font-size:0.75rem">' + dateStr + '</span>';
      if (item.instructor) {
        card += '<span style="color:rgba(255,255,255,0.15);font-size:0.65rem">&bull;</span>';
        card += '<span style="color:#999;font-size:0.75rem">' + escHtml(item.instructor) + '</span>';
      }
      card += '</div></div></div>';
      return card;
    }

    function renderList(items) {
      if (!items.length) {
        listEl.innerHTML = '';
        if (emptyEl) emptyEl.hidden = false;
        if (countEl) countEl.textContent = '';
        return;
      }
      if (emptyEl) emptyEl.hidden = true;

      var html = '';
      for (var i = 0; i < items.length; i++) {
        html += renderCard(items[i]);
      }
      listEl.innerHTML = html;

      // Count
      if (countEl) {
        var total = allRecordings.length;
        if (items.length < total) {
          countEl.textContent = items.length + ' / ' + total;
        } else {
          countEl.textContent = total + (isDa ? ' optagelser' : ' recordings');
        }
      }
    }

    function getFiltered() {
      var items = allRecordings.slice();
      // Search filter
      var q = (searchEl ? searchEl.value : '').toLowerCase().trim();
      if (q) {
        items = items.filter(function (item) {
          var title = (item.title_da || '') + ' ' + (item.title_en || '');
          var instr = item.instructor || '';
          return title.toLowerCase().indexOf(q) !== -1 || instr.toLowerCase().indexOf(q) !== -1;
        });
      }
      // Instructor filter
      var instrVal = instructorEl ? instructorEl.value : '';
      if (instrVal) {
        items = items.filter(function (item) { return item.instructor === instrVal; });
      }
      // Sort
      var sortVal = sortEl ? sortEl.value : 'newest';
      items.sort(function (a, b) {
        var ta = new Date(a.startDateTime).getTime();
        var tb = new Date(b.startDateTime).getTime();
        return sortVal === 'oldest' ? ta - tb : tb - ta;
      });
      return items;
    }

    function applyFilters() {
      renderList(getFiltered());
    }

    // Attach filter listeners
    if (searchEl) searchEl.addEventListener('input', applyFilters);
    if (instructorEl) instructorEl.addEventListener('change', applyFilters);
    if (sortEl) sortEl.addEventListener('change', applyFilters);

    getToken().then(function (token) {
      var opts = { headers: {} };
      if (token) opts.headers['Authorization'] = 'Bearer ' + token;
      return fetch('/.netlify/functions/live-admin?action=recordings', opts);
    }).then(function (r) {
      return r.json();
    }).then(function (data) {
      if (!data.ok || !data.items || !data.items.length) {
        if (emptyEl) emptyEl.hidden = false;
        return;
      }

      allRecordings = data.items;

      // Populate instructor dropdown
      if (instructorEl) {
        var instructors = {};
        for (var i = 0; i < allRecordings.length; i++) {
          var instr = allRecordings[i].instructor;
          if (instr && !instructors[instr]) instructors[instr] = true;
        }
        var names = Object.keys(instructors).sort();
        for (var j = 0; j < names.length; j++) {
          var opt = document.createElement('option');
          opt.value = names[j];
          opt.textContent = names[j];
          instructorEl.appendChild(opt);
        }
      }

      // Show toolbar
      if (toolbarEl) toolbarEl.style.display = 'flex';

      renderList(allRecordings);

      // Click to play — swap thumbnail with player element.
      // iOS: native <video> with HLS URL (WebKit supports HLS natively).
      // Desktop/Android: mux-player web component.
      var recIsIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

      listEl.addEventListener('click', function (e) {
        var card = e.target.closest('[data-rec-playback]');
        if (!card) return;
        var pid = card.getAttribute('data-rec-playback');
        card.removeAttribute('data-rec-playback');

        var el;
        if (recIsIOS) {
          el = document.createElement('video');
          el.setAttribute('playsinline', '');
          el.setAttribute('webkit-playsinline', '');
          el.setAttribute('controls', '');
          el.setAttribute('preload', 'auto');
          el.src = 'https://stream.mux.com/' + pid + '.m3u8';
          el.style.cssText = 'width:100%;aspect-ratio:16/9;object-fit:contain;background:#000';
        } else {
          el = document.createElement('mux-player');
          el.setAttribute('playback-id', pid);
          el.setAttribute('stream-type', 'on-demand');
          el.setAttribute('accent-color', '#f75c03');
          el.setAttribute('primary-color', '#FFFCF9');
          el.setAttribute('secondary-color', '#0F0F0F');
          el.setAttribute('default-show-remaining-time', '');
          el.setAttribute('playsinline', '');
          el.style.cssText = 'width:100%;aspect-ratio:16/9;--media-object-fit:contain';
        }

        card.innerHTML = '';
        card.appendChild(el);
      });
    }).catch(function () {
      if (emptyEl) emptyEl.hidden = false;
    });
  }

  function escHtml(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  // Hook into tab switching to lazy-load recordings + refresh schedule
  var origShowTab = showTab;
  showTab = function (tab, skipPush) {
    origShowTab(tab, skipPush);
    if (tab === 'live') {
      loadRecordings();
      // Re-fetch live schedule when tab becomes visible
      if (typeof window._liveScheduleFetch === 'function') {
        window._liveScheduleFetch();
      }
    }
  };
})();
