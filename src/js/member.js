/**
 * YOGA BIBLE — MEMBER PAGE
 * Toggles guest/user view based on Firebase auth state.
 * Renders role badge, applies permission-based visibility,
 * and manages panel navigation with hash routing for glossary/journal.
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

  // ── Panel Navigation (glossary + journal only) ──

  var VALID_PANELS = ['glossary', 'journal'];

  function initPanelNav() {
    // Card click handlers for embedded panels
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

    if (!skipPush) {
      history.pushState({ panel: panel }, '', '#' + panel);
    }

    if (hub) hub.hidden = true;

    var allPanels = document.querySelectorAll('.yb-ma-panel');
    allPanels.forEach(function(p) { p.hidden = true; });

    panelEl.hidden = false;
    window.scrollTo(0, 0);
  }

  function showHub(skipPush) {
    var hub = document.getElementById('yb-ma-hub');

    if (!skipPush) {
      history.pushState({}, '', window.location.pathname);
    }

    var allPanels = document.querySelectorAll('.yb-ma-panel');
    allPanels.forEach(function(p) { p.hidden = true; });

    if (hub) hub.hidden = false;
    window.scrollTo(0, 0);
  }
})();
