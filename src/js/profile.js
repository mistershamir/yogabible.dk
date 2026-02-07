/**
 * YOGA BIBLE — PROFILE PAGE
 * Loads user data from Firestore, handles edits, password change, Mindbody sync
 */
(function() {
  'use strict';

  // Wait for Firebase to be ready
  var checkInterval = setInterval(function() {
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
      clearInterval(checkInterval);
      init();
    }
  }, 100);

  function init() {
    var auth = firebase.auth();
    var db = firebase.firestore();

    var guestEl = document.getElementById('yb-profile-guest');
    var userEl = document.getElementById('yb-profile-user');

    if (!guestEl || !userEl) return; // Not on profile page

    auth.onAuthStateChanged(function(user) {
      if (user) {
        guestEl.style.display = 'none';
        userEl.style.display = 'block';
        loadProfile(user, db);
      } else {
        guestEl.style.display = '';
        userEl.style.display = 'none';
      }
    });

    // ── Save personal details ──
    var profileForm = document.getElementById('yb-profile-form');
    if (profileForm) {
      profileForm.addEventListener('submit', function(e) {
        e.preventDefault();
        var user = auth.currentUser;
        if (!user) return;

        var firstName = document.getElementById('yb-profile-firstname').value.trim();
        var lastName = document.getElementById('yb-profile-lastname').value.trim();
        var phone = document.getElementById('yb-profile-phone').value.trim();
        var errorEl = document.getElementById('yb-profile-error');
        var successEl = document.getElementById('yb-profile-success');
        var btn = profileForm.querySelector('button[type="submit"]');
        var btnText = btn.textContent;

        if (!firstName || !lastName) {
          showMsg(errorEl, successEl, isDa() ? 'Fornavn og efternavn er påkrævet.' : 'First and last name are required.', true);
          return;
        }

        btn.disabled = true;
        btn.textContent = isDa() ? 'Gemmer...' : 'Saving...';

        var fullName = firstName + ' ' + lastName;

        // Update Firebase display name + Firestore
        user.updateProfile({ displayName: fullName }).then(function() {
          return db.collection('users').doc(user.uid).update({
            firstName: firstName,
            lastName: lastName,
            name: fullName,
            phone: phone,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        }).then(function() {
          showMsg(errorEl, successEl, isDa() ? 'Dine oplysninger er opdateret.' : 'Your details have been updated.', false);
          // Update sidebar
          var nameEl = document.getElementById('yb-profile-display-name');
          var avatarEl = document.getElementById('yb-profile-avatar');
          if (nameEl) nameEl.textContent = fullName;
          if (avatarEl) avatarEl.textContent = getInitials(fullName);
        }).catch(function(err) {
          showMsg(errorEl, successEl, err.message, true);
        }).finally(function() {
          btn.disabled = false;
          btn.textContent = btnText;
        });
      });
    }

    // ── Change password ──
    var pwForm = document.getElementById('yb-profile-password-form');
    if (pwForm) {
      pwForm.addEventListener('submit', function(e) {
        e.preventDefault();
        var user = auth.currentUser;
        if (!user) return;

        var newPw = document.getElementById('yb-profile-new-password').value;
        var confirmPw = document.getElementById('yb-profile-confirm-password').value;
        var errorEl = document.getElementById('yb-profile-pw-error');
        var successEl = document.getElementById('yb-profile-pw-success');
        var btn = pwForm.querySelector('button[type="submit"]');
        var btnText = btn.textContent;

        if (newPw.length < 6) {
          showMsg(errorEl, successEl, isDa() ? 'Adgangskoden skal være mindst 6 tegn.' : 'Password must be at least 6 characters.', true);
          return;
        }

        if (newPw !== confirmPw) {
          showMsg(errorEl, successEl, isDa() ? 'Adgangskoderne matcher ikke.' : 'Passwords do not match.', true);
          return;
        }

        btn.disabled = true;
        btn.textContent = isDa() ? 'Skifter...' : 'Changing...';

        user.updatePassword(newPw).then(function() {
          showMsg(errorEl, successEl, isDa() ? 'Din adgangskode er ændret.' : 'Your password has been changed.', false);
          pwForm.reset();
        }).catch(function(err) {
          if (err.code === 'auth/requires-recent-login') {
            showMsg(errorEl, successEl, isDa() ? 'Log venligst ud og ind igen før du skifter adgangskode.' : 'Please sign out and back in before changing your password.', true);
          } else {
            showMsg(errorEl, successEl, err.message, true);
          }
        }).finally(function() {
          btn.disabled = false;
          btn.textContent = btnText;
        });
      });
    }

    // ── Connect to Mindbody ──
    var mbConnectBtn = document.getElementById('yb-profile-mb-connect');
    if (mbConnectBtn) {
      mbConnectBtn.addEventListener('click', function() {
        var user = auth.currentUser;
        if (!user) return;

        var btnText = mbConnectBtn.textContent;
        mbConnectBtn.disabled = true;
        mbConnectBtn.textContent = isDa() ? 'Forbinder...' : 'Connecting...';

        db.collection('users').doc(user.uid).get().then(function(doc) {
          var data = doc.data() || {};
          var firstName = data.firstName || user.displayName.split(' ')[0] || '';
          var lastName = data.lastName || user.displayName.split(' ').slice(1).join(' ') || '';

          return fetch('/.netlify/functions/mb-client', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firstName: firstName, lastName: lastName, email: user.email })
          });
        }).then(function(res) { return res.json(); })
          .then(function(data) {
            if (data.client && data.client.Id) {
              return db.collection('users').doc(user.uid).update({
                mindbodyClientId: String(data.client.Id),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
              }).then(function() {
                // Refresh membership display
                loadProfile(user, db);
              });
            }
          }).catch(function(err) {
            console.warn('Mindbody connect failed:', err);
          }).finally(function() {
            mbConnectBtn.disabled = false;
            mbConnectBtn.textContent = btnText;
          });
      });
    }
  }

  // ── Load profile data from Firestore ──
  function loadProfile(user, db) {
    // Basic info from Firebase Auth
    var nameEl = document.getElementById('yb-profile-display-name');
    var emailEl = document.getElementById('yb-profile-display-email');
    var avatarEl = document.getElementById('yb-profile-avatar');

    if (nameEl) nameEl.textContent = user.displayName || user.email.split('@')[0];
    if (emailEl) emailEl.textContent = user.email;
    if (avatarEl) avatarEl.textContent = getInitials(user.displayName || user.email);

    // Email field (disabled)
    var emailInput = document.getElementById('yb-profile-email');
    if (emailInput) emailInput.value = user.email;

    // Load Firestore data
    db.collection('users').doc(user.uid).get().then(function(doc) {
      if (!doc.exists) return;
      var d = doc.data();

      // Personal fields
      var fnEl = document.getElementById('yb-profile-firstname');
      var lnEl = document.getElementById('yb-profile-lastname');
      var phEl = document.getElementById('yb-profile-phone');
      if (fnEl) fnEl.value = d.firstName || '';
      if (lnEl) lnEl.value = d.lastName || '';
      if (phEl) phEl.value = d.phone || '';

      // Member since
      var sinceEl = document.getElementById('yb-profile-member-since');
      if (sinceEl && d.createdAt) {
        var date = d.createdAt.toDate ? d.createdAt.toDate() : new Date(d.createdAt);
        var label = isDa() ? 'Medlem siden' : 'Member since';
        sinceEl.textContent = label + ' ' + date.toLocaleDateString(isDa() ? 'da-DK' : 'en-GB', { year: 'numeric', month: 'long' });
      }

      // Membership tier
      var tierEl = document.getElementById('yb-profile-tier');
      if (tierEl) {
        var tier = d.membershipTier || 'free';
        if (tier === 'free') {
          tierEl.textContent = isDa() ? 'Gratis' : 'Free';
          tierEl.className = 'yb-profile__info-value yb-profile__info-value--muted';
        } else {
          tierEl.textContent = isDa() ? 'Medlem' : 'Member';
          tierEl.className = 'yb-profile__info-value yb-profile__info-value--success';
        }
      }

      // Mindbody
      var mbStatusEl = document.getElementById('yb-profile-mb-status');
      var mbIdRow = document.getElementById('yb-profile-mb-id-row');
      var mbIdEl = document.getElementById('yb-profile-mb-id');
      var mbConnectBtn = document.getElementById('yb-profile-mb-connect');

      if (d.mindbodyClientId) {
        if (mbStatusEl) {
          mbStatusEl.textContent = isDa() ? 'Forbundet' : 'Connected';
          mbStatusEl.className = 'yb-profile__info-value yb-profile__info-value--success';
        }
        if (mbIdRow) mbIdRow.style.display = '';
        if (mbIdEl) mbIdEl.textContent = d.mindbodyClientId;
        if (mbConnectBtn) mbConnectBtn.style.display = 'none';
      } else {
        if (mbStatusEl) {
          mbStatusEl.textContent = isDa() ? 'Ikke forbundet' : 'Not connected';
          mbStatusEl.className = 'yb-profile__info-value yb-profile__info-value--muted';
        }
        if (mbIdRow) mbIdRow.style.display = 'none';
        if (mbConnectBtn) mbConnectBtn.style.display = '';
      }

      // Connected sites
      var dkEl = document.getElementById('yb-profile-site-dk');
      var comEl = document.getElementById('yb-profile-site-com');
      if (dkEl) {
        dkEl.textContent = d.yogabibleDkLinked ? (isDa() ? 'Forbundet' : 'Connected') : (isDa() ? 'Ikke forbundet' : 'Not connected');
        dkEl.className = 'yb-profile__info-value ' + (d.yogabibleDkLinked ? 'yb-profile__info-value--success' : 'yb-profile__info-value--muted');
      }
      if (comEl) {
        comEl.textContent = d.yogabibleComLinked ? (isDa() ? 'Forbundet' : 'Connected') : (isDa() ? 'Ikke forbundet' : 'Not connected');
        comEl.className = 'yb-profile__info-value ' + (d.yogabibleComLinked ? 'yb-profile__info-value--success' : 'yb-profile__info-value--muted');
      }

    }).catch(function(err) {
      console.warn('Could not load profile:', err);
    });
  }

  // ── Helpers ──
  function isDa() {
    return window.location.pathname.indexOf('/en/') !== 0;
  }

  function getInitials(name) {
    if (!name) return '?';
    var parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name.substring(0, 2).toUpperCase();
  }

  function showMsg(errorEl, successEl, message, isError) {
    if (isError) {
      if (errorEl) { errorEl.textContent = message; errorEl.hidden = false; }
      if (successEl) successEl.hidden = true;
    } else {
      if (successEl) { successEl.textContent = message; successEl.hidden = false; }
      if (errorEl) errorEl.hidden = true;
    }
    // Auto-hide success after 4s
    if (!isError && successEl) {
      setTimeout(function() { successEl.hidden = true; }, 4000);
    }
  }
})();
