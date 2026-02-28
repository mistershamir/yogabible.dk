/**
 * YOGA BIBLE — MEMBER PAGE
 * Toggles guest/user view based on Firebase auth state.
 * Renders role badge, manages tab navigation with hash routing,
 * lazy-loads iframes for courses/schedule/profile tabs,
 * and auto-resizes iframes to fit content.
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
          if (nameEl) nameEl.textContent = displayName.split(' ')[0] || '';
          if (avatarEl) avatarEl.textContent = displayName ? getInitials(displayName) : '';
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

    // Browser back/forward
    window.addEventListener('popstate', function() {
      routeFromHash();
    });
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
      card += '<div class="yb-rec-card" style="background:#1a1a1a;border-radius:10px;overflow:hidden;border:1px solid #222;transition:border-color 0.3s ease">';

      // Thumbnail with play button overlay
      if (item.recordingPlaybackId) {
        card += '<div style="aspect-ratio:16/9;background:#111;position:relative;cursor:pointer" data-rec-playback="' + item.recordingPlaybackId + '">';
        card += '<img src="https://image.mux.com/' + item.recordingPlaybackId + '/thumbnail.jpg?width=560&height=315&fit_mode=smartcrop" alt="" style="width:100%;height:100%;object-fit:cover;display:block" loading="lazy">';
        card += '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">';
        card += '<div style="width:52px;height:52px;border-radius:50%;background:rgba(247,92,3,0.9);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 15px rgba(0,0,0,0.4)">';
        card += '<svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><polygon points="6 3 20 12 6 21 6 3"/></svg>';
        card += '</div></div>';
        // Duration badge
        if (dur) {
          card += '<span style="position:absolute;bottom:8px;right:8px;background:rgba(0,0,0,0.75);color:#fff;font-size:0.7rem;padding:2px 6px;border-radius:4px">' + dur + '</span>';
        }
        card += '</div>';
      }

      // Info
      card += '<div style="padding:0.85rem 1rem">';
      card += '<p style="color:#FFFCF9;font-size:0.85rem;font-weight:700;margin:0 0 0.35rem;line-height:1.35">' + escHtml(title) + '</p>';
      card += '<div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap">';
      card += '<span style="color:#6F6A66;font-size:0.72rem">' + dateStr + '</span>';
      if (item.instructor) {
        card += '<span style="color:#6F6A66;font-size:0.72rem">&middot;</span>';
        card += '<span style="color:#999;font-size:0.72rem">' + escHtml(item.instructor) + '</span>';
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

      // Click to play — swap thumbnail with full mux-player (on-demand with controls)
      listEl.addEventListener('click', function (e) {
        var card = e.target.closest('[data-rec-playback]');
        if (!card) return;
        var pid = card.getAttribute('data-rec-playback');
        card.innerHTML = '<mux-player'
          + ' playback-id="' + pid + '"'
          + ' stream-type="on-demand"'
          + ' accent-color="#f75c03"'
          + ' primary-color="#FFFCF9"'
          + ' secondary-color="#0F0F0F"'
          + ' default-show-remaining-time'
          + ' style="width:100%;aspect-ratio:16/9;--media-object-fit:contain"'
          + ' autoplay'
          + '></mux-player>';
        card.removeAttribute('data-rec-playback');
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
