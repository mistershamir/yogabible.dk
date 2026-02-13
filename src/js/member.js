/**
 * YOGA BIBLE — MEMBER PAGE
 * Toggles guest/user view based on Firebase auth state.
 * Renders role badge and applies permission-based visibility.
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
  }

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
})();
