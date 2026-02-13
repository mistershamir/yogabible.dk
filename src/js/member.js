/**
 * YOGA BIBLE — MEMBER PAGE
 * Toggles guest/user view based on Firebase auth state
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
  }
})();
