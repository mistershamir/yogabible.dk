/**
 * YOGA BIBLE - FIREBASE AUTHENTICATION
 * Handles user auth, Firestore profiles, and content gating
 */

(function() {
  'use strict';

  // Firebase config
  var firebaseConfig = {
    apiKey: "AIzaSyCpgPECf2lBdvQ7fZ8Q6ePZZLo2-qKgMTE",
    authDomain: "yoga-bible-dk-com.firebaseapp.com",
    projectId: "yoga-bible-dk-com",
    storageBucket: "yoga-bible-dk-com.firebasestorage.app",
    messagingSenderId: "875649922217",
    appId: "1:875649922217:web:9d406b4522fd084ba4e5b8"
  };

  // Initialize Firebase (compat SDK loaded via CDN)
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  var auth = firebase.auth();
  var db = firebase.firestore();

  // ============================================
  // AUTH STATE
  // ============================================

  var currentUser = null;

  auth.onAuthStateChanged(function(user) {
    currentUser = user;
    updateHeaderUI(user);
    handleContentGating(user);

    if (user) {
      ensureUserProfile(user);
    }
  });

  // ============================================
  // FIRESTORE USER PROFILE
  // ============================================

  function ensureUserProfile(user) {
    var userRef = db.collection('users').doc(user.uid);

    userRef.get().then(function(doc) {
      if (!doc.exists) {
        // Create new profile
        userRef.set({
          uid: user.uid,
          email: user.email,
          name: user.displayName || '',
          role: 'user',
          membershipTier: 'free',
          membershipExpiresAt: null,
          mindbodyClientId: null,
          yogabibleDkLinked: true,
          yogabibleComLinked: false,
          locale: detectLocale(),
          photoUrl: '',
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      } else {
        // Mark yogabible.dk as linked
        var data = doc.data();
        if (!data.yogabibleDkLinked) {
          userRef.update({
            yogabibleDkLinked: true,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        }
      }
    }).catch(function(err) {
      console.warn('Could not sync user profile:', err);
    });
  }

  function detectLocale() {
    var host = window.location.hostname.toLowerCase();
    return host.indexOf('en.') === 0 ? 'en' : 'da';
  }

  // ============================================
  // HEADER UI UPDATE
  // ============================================

  function updateHeaderUI(user) {
    var loginBtn = document.getElementById('yb-auth-login-btn');
    var userMenu = document.getElementById('yb-auth-user-menu');
    var userName = document.getElementById('yb-auth-user-name');
    var userAvatar = document.getElementById('yb-auth-user-avatar');
    var mobileLoginBtn = document.getElementById('yb-auth-mobile-login');
    var mobileUserSection = document.getElementById('yb-auth-mobile-user');
    var mobileUserName = document.getElementById('yb-auth-mobile-name');

    if (user) {
      var displayName = user.displayName || user.email.split('@')[0];
      var initials = getInitials(displayName);

      // Desktop: hide login, show user menu
      if (loginBtn) loginBtn.style.display = 'none';
      if (userMenu) userMenu.style.display = 'flex';
      if (userName) userName.textContent = displayName;
      if (userAvatar) userAvatar.textContent = initials;

      // Mobile: hide login, show user section
      if (mobileLoginBtn) mobileLoginBtn.style.display = 'none';
      if (mobileUserSection) mobileUserSection.style.display = 'block';
      if (mobileUserName) mobileUserName.textContent = displayName;
    } else {
      // Desktop: show login, hide user menu
      if (loginBtn) loginBtn.style.display = '';
      if (userMenu) userMenu.style.display = 'none';

      // Mobile: show login, hide user section
      if (mobileLoginBtn) mobileLoginBtn.style.display = '';
      if (mobileUserSection) mobileUserSection.style.display = 'none';
    }
  }

  function getInitials(name) {
    if (!name) return '?';
    var parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

  // ============================================
  // AUTH MODAL
  // ============================================

  var modal = document.getElementById('yb-auth-modal');
  var scrollY = 0;

  function openAuthModal(view) {
    if (!modal) return;

    showView(view || 'login');

    // Clear form fields and errors
    modal.querySelectorAll('input').forEach(function(input) {
      if (input.type !== 'hidden') input.value = '';
    });
    modal.querySelectorAll('.yb-auth-error').forEach(function(el) {
      el.textContent = '';
      el.hidden = true;
    });

    // Lock body scroll
    scrollY = window.scrollY;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
      document.body.style.top = '-' + scrollY + 'px';
    }

    modal.setAttribute('aria-hidden', 'false');

    // Focus first input
    setTimeout(function() {
      var firstInput = modal.querySelector('.yb-auth-view:not([hidden]) input');
      if (firstInput) firstInput.focus();
    }, 50);
  }

  function closeAuthModal() {
    if (!modal) return;

    modal.setAttribute('aria-hidden', 'true');
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.width = '';
    document.body.style.top = '';
    window.scrollTo(0, scrollY);
  }

  function showView(viewName) {
    if (!modal) return;
    modal.querySelectorAll('.yb-auth-view').forEach(function(v) {
      v.hidden = v.id !== 'yb-auth-' + viewName;
    });
  }

  // Expose globally
  window.openYBAuthModal = openAuthModal;
  window.closeYBAuthModal = closeAuthModal;

  // Close handlers
  document.addEventListener('click', function(e) {
    if (e.target.closest('[data-yb-auth-close]')) {
      e.preventDefault();
      closeAuthModal();
    }
    if (e.target.closest('[data-yb-auth-open]')) {
      e.preventDefault();
      var view = e.target.closest('[data-yb-auth-open]').getAttribute('data-yb-auth-open');
      openAuthModal(view || 'login');
    }
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && modal && modal.getAttribute('aria-hidden') === 'false') {
      closeAuthModal();
    }
  });

  // View switching links inside modal
  document.addEventListener('click', function(e) {
    var switchBtn = e.target.closest('[data-yb-auth-switch]');
    if (switchBtn) {
      e.preventDefault();
      showView(switchBtn.getAttribute('data-yb-auth-switch'));
    }
  });

  // ============================================
  // LOGIN
  // ============================================

  var loginForm = document.getElementById('yb-auth-login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', function(e) {
      e.preventDefault();
      var email = document.getElementById('yb-login-email').value.trim();
      var password = document.getElementById('yb-login-password').value;
      var errorEl = document.getElementById('yb-login-error');
      var submitBtn = loginForm.querySelector('button[type="submit"]');

      if (!email || !password) {
        showError(errorEl, detectLocale() === 'da' ? 'Udfyld alle felter.' : 'Please fill in all fields.');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = detectLocale() === 'da' ? 'Logger ind...' : 'Signing in...';

      auth.signInWithEmailAndPassword(email, password)
        .then(function() {
          closeAuthModal();
        })
        .catch(function(error) {
          showError(errorEl, getAuthErrorMessage(error.code));
        })
        .finally(function() {
          submitBtn.disabled = false;
          submitBtn.textContent = detectLocale() === 'da' ? 'Log ind' : 'Sign in';
        });
    });
  }

  // ============================================
  // REGISTER
  // ============================================

  var registerForm = document.getElementById('yb-auth-register-form');
  if (registerForm) {
    registerForm.addEventListener('submit', function(e) {
      e.preventDefault();
      var name = document.getElementById('yb-register-name').value.trim();
      var email = document.getElementById('yb-register-email').value.trim();
      var password = document.getElementById('yb-register-password').value;
      var errorEl = document.getElementById('yb-register-error');
      var submitBtn = registerForm.querySelector('button[type="submit"]');

      if (!name || !email || !password) {
        showError(errorEl, detectLocale() === 'da' ? 'Udfyld alle felter.' : 'Please fill in all fields.');
        return;
      }

      if (password.length < 6) {
        showError(errorEl, detectLocale() === 'da' ? 'Adgangskoden skal være mindst 6 tegn.' : 'Password must be at least 6 characters.');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = detectLocale() === 'da' ? 'Opretter...' : 'Creating account...';

      auth.createUserWithEmailAndPassword(email, password)
        .then(function(result) {
          return result.user.updateProfile({ displayName: name });
        })
        .then(function() {
          closeAuthModal();
        })
        .catch(function(error) {
          showError(errorEl, getAuthErrorMessage(error.code));
        })
        .finally(function() {
          submitBtn.disabled = false;
          submitBtn.textContent = detectLocale() === 'da' ? 'Opret konto' : 'Create account';
        });
    });
  }

  // ============================================
  // RESET PASSWORD
  // ============================================

  var resetForm = document.getElementById('yb-auth-reset-form');
  if (resetForm) {
    resetForm.addEventListener('submit', function(e) {
      e.preventDefault();
      var email = document.getElementById('yb-reset-email').value.trim();
      var errorEl = document.getElementById('yb-reset-error');
      var successEl = document.getElementById('yb-reset-success');
      var submitBtn = resetForm.querySelector('button[type="submit"]');

      if (!email) {
        showError(errorEl, detectLocale() === 'da' ? 'Indtast din email.' : 'Please enter your email.');
        return;
      }

      submitBtn.disabled = true;

      auth.sendPasswordResetEmail(email)
        .then(function() {
          if (errorEl) { errorEl.hidden = true; }
          if (successEl) {
            successEl.textContent = detectLocale() === 'da'
              ? 'Vi har sendt dig en email med et link til at nulstille din adgangskode.'
              : 'We\'ve sent you an email with a link to reset your password.';
            successEl.hidden = false;
          }
        })
        .catch(function(error) {
          showError(errorEl, getAuthErrorMessage(error.code));
        })
        .finally(function() {
          submitBtn.disabled = false;
        });
    });
  }

  // ============================================
  // LOGOUT
  // ============================================

  document.addEventListener('click', function(e) {
    if (e.target.closest('[data-yb-auth-logout]')) {
      e.preventDefault();
      auth.signOut();
    }
  });

  // ============================================
  // CONTENT GATING
  // ============================================

  function handleContentGating(user) {
    // Journal listing: add lock badge to gated cards
    document.querySelectorAll('.yj-card[data-yj-gated="true"]').forEach(function(card) {
      var existingLock = card.querySelector('.yb-gated-badge');
      if (!user && !existingLock) {
        var badge = document.createElement('span');
        badge.className = 'yb-gated-badge';
        badge.textContent = detectLocale() === 'da' ? 'Kun for medlemmer' : 'Members only';
        var imgWrap = card.querySelector('.yj-card__img-wrap');
        if (imgWrap) imgWrap.appendChild(badge);
      } else if (user && existingLock) {
        existingLock.remove();
      }
    });

    // Journal post: gate content if page has data-yb-gated attribute
    var gatedPost = document.querySelector('[data-yb-gated-post="true"]');
    if (!gatedPost) return;

    var contentEls = gatedPost.querySelectorAll('.yj-post-body');
    var gateWall = document.getElementById('yb-gate-wall');

    if (user) {
      // Check membership tier
      db.collection('users').doc(user.uid).get().then(function(doc) {
        var tier = doc.exists ? doc.data().membershipTier : 'free';

        if (tier === 'free') {
          showGateWall(contentEls, gateWall, 'upgrade');
        } else {
          hideGateWall(contentEls, gateWall);
        }
      }).catch(function() {
        hideGateWall(contentEls, gateWall);
      });
    } else {
      showGateWall(contentEls, gateWall, 'login');
    }
  }

  function showGateWall(contentEls, gateWall, type) {
    contentEls.forEach(function(el) {
      el.classList.add('yb-gated-blur');
    });
    if (gateWall) {
      gateWall.hidden = false;
      var loginCta = gateWall.querySelector('.yb-gate-login');
      var upgradeCta = gateWall.querySelector('.yb-gate-upgrade');
      if (loginCta) loginCta.hidden = type !== 'login';
      if (upgradeCta) upgradeCta.hidden = type !== 'upgrade';
    }
  }

  function hideGateWall(contentEls, gateWall) {
    contentEls.forEach(function(el) {
      el.classList.remove('yb-gated-blur');
    });
    if (gateWall) gateWall.hidden = true;
  }

  // ============================================
  // ERROR HELPERS
  // ============================================

  function showError(el, message) {
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
  }

  function getAuthErrorMessage(code) {
    var isDa = detectLocale() === 'da';
    var messages = {
      'auth/email-already-in-use': isDa ? 'Denne email er allerede i brug.' : 'This email is already in use.',
      'auth/invalid-email': isDa ? 'Ugyldig email-adresse.' : 'Invalid email address.',
      'auth/user-disabled': isDa ? 'Denne konto er deaktiveret.' : 'This account has been disabled.',
      'auth/user-not-found': isDa ? 'Ingen konto fundet med denne email.' : 'No account found with this email.',
      'auth/wrong-password': isDa ? 'Forkert adgangskode.' : 'Incorrect password.',
      'auth/weak-password': isDa ? 'Adgangskoden er for svag.' : 'Password is too weak.',
      'auth/too-many-requests': isDa ? 'For mange forsøg. Prøv igen senere.' : 'Too many attempts. Please try again later.',
      'auth/invalid-credential': isDa ? 'Forkert email eller adgangskode.' : 'Incorrect email or password.'
    };
    return messages[code] || (isDa ? 'Der opstod en fejl. Prøv igen.' : 'An error occurred. Please try again.');
  }

  console.log('✅ Firebase Auth initialized');
})();
