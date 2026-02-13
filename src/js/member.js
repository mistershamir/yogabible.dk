/**
 * YOGA BIBLE — MEMBER PAGE
 * Toggles guest/user view based on Firebase auth state.
 * Renders role badge, applies permission-based visibility,
 * and manages panel navigation with hash routing.
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
      if (u) {
        guest.style.display = 'none';
        user.style.display = '';
        var displayName = u.displayName || u.email.split('@')[0];
        if (nameEl) nameEl.textContent = displayName.split(' ')[0];
        if (avatarEl) avatarEl.textContent = getInitials(displayName);
        // Check hash after auth resolves
        routeFromHash();
      } else {
        guest.style.display = '';
        user.style.display = 'none';
      }
    });

    // Listen for role/permissions data from firebase-auth.js
    document.addEventListener('yb:user-loaded', function(e) {
      var detail = e.detail;
      if (!detail) return;
      renderRoleBadge(detail.role, detail.roleDetails, lang);
    });

    initPanelNav();
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

  // ── Panel Navigation ──

  var VALID_PANELS = ['glossary', 'journal', 'courses', 'schedule', 'profile'];

  function initPanelNav() {
    // Card click handlers
    var cards = document.querySelectorAll('[data-yb-panel]');
    cards.forEach(function(card) {
      card.addEventListener('click', function(e) {
        e.preventDefault();
        var panel = this.getAttribute('data-yb-panel');
        if (VALID_PANELS.indexOf(panel) !== -1) {
          showPanel(panel);
        }
      });
    });

    // Back button handlers
    var backBtns = document.querySelectorAll('[data-yb-back]');
    backBtns.forEach(function(btn) {
      btn.addEventListener('click', function() {
        showHub();
      });
    });

    // Browser back/forward
    window.addEventListener('popstate', function() {
      routeFromHash();
    });
  }

  function routeFromHash() {
    var hash = window.location.hash.slice(1);
    if (hash && VALID_PANELS.indexOf(hash) !== -1) {
      showPanel(hash, true);
    } else {
      showHub(true);
    }
  }

  function showPanel(panel, skipPush) {
    var hub = document.getElementById('yb-ma-hub');
    var panelEl = document.getElementById('yb-ma-panel-' + panel);
    if (!panelEl) return;

    // Update URL
    if (!skipPush) {
      history.pushState({ panel: panel }, '', '#' + panel);
    }

    // Hide hub
    if (hub) hub.hidden = true;

    // Hide all panels
    var allPanels = document.querySelectorAll('.yb-ma-panel');
    allPanels.forEach(function(p) { p.hidden = true; });

    // Show target panel
    panelEl.hidden = false;

    // Lazy-load iframe if needed
    var iframe = panelEl.querySelector('iframe[data-src]');
    if (iframe && !iframe.src) {
      iframe.src = iframe.getAttribute('data-src');
      iframe.removeAttribute('data-src');
      // Auto-resize iframe based on content
      iframe.addEventListener('load', function() {
        try {
          var body = iframe.contentDocument.body;
          var html = iframe.contentDocument.documentElement;
          var height = Math.max(body.scrollHeight, body.offsetHeight, html.scrollHeight, html.offsetHeight);
          iframe.style.height = height + 'px';
        } catch(e) {
          // Cross-origin or security error — keep min-height
        }
      });
    }

    // Scroll to top
    window.scrollTo(0, 0);
  }

  function showHub(skipPush) {
    var hub = document.getElementById('yb-ma-hub');

    // Update URL
    if (!skipPush) {
      history.pushState({}, '', window.location.pathname);
    }

    // Hide all panels
    var allPanels = document.querySelectorAll('.yb-ma-panel');
    allPanels.forEach(function(p) { p.hidden = true; });

    // Show hub
    if (hub) hub.hidden = false;

    // Scroll to top
    window.scrollTo(0, 0);
  }
})();
