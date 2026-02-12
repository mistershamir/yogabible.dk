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

  function init() {
    var auth = firebase.auth();
    var guest = document.getElementById('yb-member-guest');
    var user = document.getElementById('yb-member-user');
    var nameEl = document.getElementById('yb-member-name');
    if (!guest || !user) return;

    auth.onAuthStateChanged(function(u) {
      if (u) {
        guest.style.display = 'none';
        user.style.display = '';
        if (nameEl) {
          nameEl.textContent = (u.displayName || u.email.split('@')[0]).split(' ')[0];
        }
      } else {
        guest.style.display = '';
        user.style.display = 'none';
      }
    });
  }
})();
