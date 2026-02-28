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

  function loadRecordings() {
    if (recordingsLoaded) return;
    recordingsLoaded = true;

    var listEl = document.getElementById('yb-ma-recordings-list');
    var emptyEl = document.getElementById('yb-ma-recordings-empty');
    if (!listEl) return;

    var isDa = window.location.pathname.indexOf('/en/') !== 0;

    function getToken() {
      if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) {
        return firebase.auth().currentUser.getIdToken();
      }
      return Promise.resolve('');
    }

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
      if (emptyEl) emptyEl.hidden = true;

      var html = '';
      for (var i = 0; i < data.items.length; i++) {
        var item = data.items[i];
        var title = isDa ? (item.title_da || item.title_en || '') : (item.title_en || item.title_da || '');
        var d = new Date(item.startDateTime);
        var dateStr = d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear();

        html += '<div style="background:#1a1a1a;border-radius:10px;overflow:hidden;border:1px solid transparent;transition:border-color 0.3s ease">';

        // Thumbnail / player embed
        if (item.recordingPlaybackId) {
          html += '<div style="aspect-ratio:16/9;background:#111;position:relative;cursor:pointer" data-rec-playback="' + item.recordingPlaybackId + '">';
          html += '<img src="https://image.mux.com/' + item.recordingPlaybackId + '/thumbnail.jpg?width=560&height=315&fit_mode=smartcrop" alt="" style="width:100%;height:100%;object-fit:cover;display:block">';
          html += '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">';
          html += '<div style="width:48px;height:48px;border-radius:50%;background:rgba(247,92,3,0.9);display:flex;align-items:center;justify-content:center">';
          html += '<svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><polygon points="6 3 20 12 6 21 6 3"/></svg>';
          html += '</div></div></div>';
        }

        html += '<div style="padding:0.85rem 1rem">';
        html += '<p style="color:#FFFCF9;font-size:0.9rem;font-weight:700;margin:0 0 0.25rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(title) + '</p>';
        html += '<span style="color:#6F6A66;font-size:0.75rem">' + dateStr;
        if (item.instructor) html += ' &middot; ' + escHtml(item.instructor);
        html += '</span>';
        html += '</div></div>';
      }
      listEl.innerHTML = html;

      // Click to play — swap thumbnail with mux-player
      listEl.addEventListener('click', function (e) {
        var card = e.target.closest('[data-rec-playback]');
        if (!card) return;
        var pid = card.getAttribute('data-rec-playback');
        card.innerHTML = '<mux-player playback-id="' + pid + '" accent-color="#f75c03" style="width:100%;aspect-ratio:16/9"></mux-player>';
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

  // Hook into tab switching to lazy-load recordings
  var origShowTab = showTab;
  showTab = function (tab, skipPush) {
    origShowTab(tab, skipPush);
    if (tab === 'live') loadRecordings();
  };
})();
