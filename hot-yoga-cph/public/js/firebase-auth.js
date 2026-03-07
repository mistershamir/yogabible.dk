/**
 * HOT YOGA COPENHAGEN - FIREBASE AUTHENTICATION
 * Adapted from Yoga Bible DK. Handles user auth, Firestore profiles, and Mindbody sync.
 * Firebase project: hot-yoga-copenhagen-3a104
 */

(function() {
  'use strict';

  // Firebase config — injected at build time from Netlify env vars
  var firebaseConfig = {
    apiKey: "__FIREBASE_API_KEY__",
    authDomain: "__FIREBASE_AUTH_DOMAIN__",
    projectId: "__FIREBASE_PROJECT_ID__",
    storageBucket: "__FIREBASE_STORAGE_BUCKET__",
    messagingSenderId: "__FIREBASE_MESSAGING_SENDER_ID__",
    appId: "__FIREBASE_APP_ID__"
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
      // Sync with Mindbody to check membership status
      if (window.syncMindbodyClient) {
        window.syncMindbodyClient(user);
      }
    }
  });

  // ============================================
  // FIRESTORE USER PROFILE
  // ============================================

  function ensureUserProfile(user) {
    var userRef = db.collection('users').doc(user.uid);
    var reg = window._ybRegistration || {};
    var displayName = user.displayName || '';
    var nameParts = displayName.split(' ');

    userRef.get().then(function(doc) {
      if (!doc.exists) {
        var firstName = reg.firstName || nameParts[0] || '';
        var lastName = reg.lastName || nameParts.slice(1).join(' ') || '';
        var consents = reg.consents || null;

        // Create new Firestore profile
        var profileData = {
          uid: user.uid,
          email: user.email,
          firstName: firstName,
          lastName: lastName,
          name: displayName,
          phone: '',
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
        };

        // Store consent summary on user profile
        if (consents) {
          profileData.consents = consents;
        }

        userRef.set(profileData);

        // Write audit trail records to separate consents collection
        if (consents) {
          storeConsentAuditTrail(user.uid, user.email, consents);
        }

        // Create Mindbody client in background
        createMindbodyClient(firstName, lastName, user.email);

        // Clean up temp registration data
        delete window._ybRegistration;
      } else {
        // Existing user — ensure yogabible.dk is linked
        var data = doc.data();
        var updates = {};
        if (!data.yogabibleDkLinked) updates.yogabibleDkLinked = true;
        // Backfill firstName/lastName if missing
        if (!data.firstName && displayName) {
          updates.firstName = nameParts[0] || '';
          updates.lastName = nameParts.slice(1).join(' ') || '';
        }
        if (Object.keys(updates).length) {
          updates.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
          userRef.update(updates);
        }
        // If no Mindbody client ID yet, try to link existing MB client
        if (!data.mindbodyClientId) {
          linkExistingMindbodyClient(user.email);
        }
      }
    }).catch(function(err) {
      console.warn('Could not sync user profile:', err);
    });
  }

  function createMindbodyClient(firstName, lastName, email) {
    // ALWAYS check if client exists first to prevent duplicates
    fetch('/.netlify/functions/mb-client?email=' + encodeURIComponent(email))
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.found && data.client && data.client.id) {
          // Client already exists in Mindbody — link, don't create duplicate
          var mbId = String(data.client.id);
          storeMindbodyClientId(mbId);
          console.log('Mindbody client found (existing):', mbId);

          // Pull name/phone/DOB from existing MB profile into Firestore
          var user = auth.currentUser;
          if (user) {
            var updates = {
              mindbodyClientId: mbId,
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            if (data.client.firstName && data.client.lastName) {
              updates.firstName = data.client.firstName;
              updates.lastName = data.client.lastName;
              updates.name = data.client.firstName + ' ' + data.client.lastName;
              user.updateProfile({ displayName: data.client.firstName + ' ' + data.client.lastName });
            }
            if (data.client.phone) updates.phone = data.client.phone;
            if (data.client.birthDate) updates.dateOfBirth = data.client.birthDate;
            db.collection('users').doc(user.uid).update(updates);
          }
          return;
        }

        // No existing client — create new one
        return fetch('/.netlify/functions/mb-client', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ firstName: firstName, lastName: lastName, email: email })
        }).then(function(res) {
          return res.json().then(function(createData) {
            if (createData.client && (createData.client.id || createData.client.Id)) {
              var newId = String(createData.client.id || createData.client.Id);
              storeMindbodyClientId(newId);
              console.log('Mindbody client created:', newId);
            }
          });
        });
      }).catch(function(err) {
        console.warn('Mindbody client sync failed:', err);
      });
  }

  function linkExistingMindbodyClient(email) {
    return fetch('/.netlify/functions/mb-client?email=' + encodeURIComponent(email))
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.found && data.client && data.client.id) {
          var mbId = String(data.client.id);
          var user = auth.currentUser;
          if (!user) return;

          // Store MB client ID + pull phone/DOB if available and missing locally
          var updates = {
            mindbodyClientId: mbId,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          };

          db.collection('users').doc(user.uid).get().then(function(doc) {
            var d = doc.exists ? doc.data() : {};
            // Pull phone from Mindbody if user hasn't set one yet
            if (!d.phone && data.client.phone) {
              updates.phone = data.client.phone;
            }
            // Pull birthDate from Mindbody if user hasn't set one yet
            // MB returns ISO datetime (e.g. 1990-03-15T00:00:00) — we extract YYYY-MM-DD
            // No dd/mm vs mm/dd conflict: both systems use ISO internally
            if (!d.dateOfBirth && data.client.birthDate) {
              var bd = data.client.birthDate;
              if (bd && bd.indexOf('T') !== -1) bd = bd.split('T')[0];
              if (bd && bd !== '0001-01-01') updates.dateOfBirth = bd;
            }
            return db.collection('users').doc(user.uid).update(updates);
          });

          console.log('Linked existing Mindbody client:', mbId);
        }
      });
  }

  function storeMindbodyClientId(mbId) {
    var user = auth.currentUser;
    if (user) {
      db.collection('users').doc(user.uid).update({
        mindbodyClientId: mbId,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
  }

  /**
   * Writes individual consent records to Firestore `consents` collection.
   * Each record is a separate document — serves as legal proof that the user agreed.
   */
  function storeConsentAuditTrail(uid, email, consents) {
    var documents = ['termsAndConditions', 'privacyPolicy', 'codeOfConduct'];
    var docLabels = {
      termsAndConditions: 'Terms & Conditions',
      privacyPolicy: 'Privacy Policy',
      codeOfConduct: 'Code of Conduct'
    };

    documents.forEach(function(docType) {
      if (consents[docType] && consents[docType].accepted) {
        db.collection('consents').add({
          userId: uid,
          email: email,
          document: docType,
          documentLabel: docLabels[docType] || docType,
          accepted: true,
          timestamp: consents[docType].timestamp,
          version: consents[docType].version,
          userAgent: navigator.userAgent,
          locale: detectLocale(),
          source: 'registration',
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(function(err) {
          console.warn('Could not store consent record for ' + docType + ':', err);
        });
      }
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
    // Desktop (utility bar)
    var loginLink = document.getElementById('yb-auth-login-link');
    var userLink = document.getElementById('yb-auth-user-link');
    var userName = document.getElementById('yb-auth-user-name');
    var userAvatar = document.getElementById('yb-auth-user-avatar');
    // Mobile (drawer)
    var mobileLoginBtn = document.getElementById('yb-auth-mobile-login');
    var mobileUserSection = document.getElementById('yb-auth-mobile-user');
    var mobileUserName = document.getElementById('yb-auth-mobile-name');

    if (user) {
      var displayName = user.displayName || user.email.split('@')[0];
      var initials = getInitials(displayName);

      // Desktop: hide login link, show user info
      if (loginLink) loginLink.style.display = 'none';
      if (userLink) userLink.style.display = 'inline-flex';
      if (userName) userName.textContent = displayName;
      if (userAvatar) userAvatar.textContent = initials;

      // Mobile: hide login, show user section
      if (mobileLoginBtn) mobileLoginBtn.style.display = 'none';
      if (mobileUserSection) mobileUserSection.style.display = 'flex';
      if (mobileUserName) mobileUserName.textContent = displayName;
    } else {
      // Desktop: show login link, hide user info
      if (loginLink) loginLink.style.display = '';
      if (userLink) userLink.style.display = 'none';

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
    // Toggle data-view on modal box for split layout (register = wider with image panel)
    var box = modal.querySelector('.yb-auth-modal__box');
    if (box) box.setAttribute('data-view', viewName);
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

      var isMigrating = false;

      auth.signInWithEmailAndPassword(email, password)
        .then(function() {
          closeAuthModal();
        })
        .catch(function(error) {
          // For user-not-found or invalid-credential: validate against Mindbody.
          // If MB credentials are valid, sync the Firebase account with the same password
          // and retry — so users never need a separate password for the new front end.
          if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential' || error.code === 'auth/too-many-requests') {
            isMigrating = true;
            submitBtn.textContent = detectLocale() === 'da' ? 'Tjekker konto...' : 'Checking account...';

            fetch('/.netlify/functions/mb-auth', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: email, password: password })
            })
              .then(function(res) { return res.json(); })
              .then(function(data) {
                if (!data.success) {
                  // All auth methods failed — show error with a direct reset link
                  showErrorWithReset(errorEl);
                  return;
                }
                // Prefer custom token (avoids propagation delay + project mismatch)
                var signIn = data.customToken
                  ? auth.signInWithCustomToken(data.customToken)
                  : auth.signInWithEmailAndPassword(email, password);
                return signIn
                  .then(function() {
                    closeAuthModal();
                  })
                  .catch(function(retryErr) {
                    console.warn('Retry after MB sync failed:', retryErr.code);
                    showError(errorEl, detectLocale() === 'da'
                      ? 'Prøv igen om et øjeblik.'
                      : 'Please try again in a moment.');
                  });
              })
              .catch(function() {
                showErrorWithReset(errorEl);
              })
              .finally(function() {
                submitBtn.disabled = false;
                submitBtn.textContent = detectLocale() === 'da' ? 'Log ind' : 'Sign in';
              });
          } else {
            showError(errorEl, getAuthErrorMessage(error.code));
          }
        })
        .finally(function() {
          if (!isMigrating) {
            submitBtn.disabled = false;
            submitBtn.textContent = detectLocale() === 'da' ? 'Log ind' : 'Sign in';
          }
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
      var firstName = document.getElementById('yb-register-firstname').value.trim();
      var lastName = document.getElementById('yb-register-lastname').value.trim();
      var email = document.getElementById('yb-register-email').value.trim();
      var password = document.getElementById('yb-register-password').value;
      var termsChecked = document.getElementById('yb-register-terms').checked;
      var conductChecked = document.getElementById('yb-register-conduct').checked;
      var errorEl = document.getElementById('yb-register-error');
      var submitBtn = registerForm.querySelector('button[type="submit"]');

      if (!firstName || !lastName || !email || !password) {
        showError(errorEl, detectLocale() === 'da' ? 'Udfyld alle felter.' : 'Please fill in all fields.');
        return;
      }

      if (password.length < 6) {
        showError(errorEl, detectLocale() === 'da' ? 'Adgangskoden skal være mindst 6 tegn.' : 'Password must be at least 6 characters.');
        return;
      }

      if (!termsChecked || !conductChecked) {
        showError(errorEl, detectLocale() === 'da'
          ? 'Du skal acceptere vores vilkår, privatlivspolitik og code of conduct.'
          : 'You must agree to our terms, privacy policy and code of conduct.');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = detectLocale() === 'da' ? 'Opretter...' : 'Creating account...';

      var fullName = firstName + ' ' + lastName;
      var consentTimestamp = new Date().toISOString();

      auth.createUserWithEmailAndPassword(email, password)
        .then(function(result) {
          // Store first/last name + consent data for profile creation
          window._ybRegistration = {
            firstName: firstName,
            lastName: lastName,
            consents: {
              termsAndConditions: { accepted: true, timestamp: consentTimestamp, version: '2026-02-09' },
              privacyPolicy: { accepted: true, timestamp: consentTimestamp, version: '2026-02-09' },
              codeOfConduct: { accepted: true, timestamp: consentTimestamp, version: '2026-02-09' }
            }
          };
          return result.user.updateProfile({ displayName: fullName });
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

      // For MB-only users (no Firebase account yet), ensure the account exists
      // before sending the reset email — otherwise Firebase sends nothing.
      fetch('/.netlify/functions/migrate-mb-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email })
      })
        .catch(function() { return { found: false }; }) // don't block on MB errors
        .then(function() {
          var resetUrl = window.location.origin + (detectLocale() === 'da' ? '/auth-action/' : '/en/auth-action/');
          return auth.sendPasswordResetEmail(email, { url: resetUrl, handleCodeInApp: true });
        })
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
  // GOOGLE SIGN-IN
  // ============================================

  var googleProvider = new firebase.auth.GoogleAuthProvider();

  var googleBtn = document.getElementById('yb-google-signin');
  if (googleBtn) {
    googleBtn.addEventListener('click', function() {
      googleBtn.disabled = true;

      auth.signInWithPopup(googleProvider)
        .then(function() {
          closeAuthModal();
        })
        .catch(function(error) {
          // Ignore user-dismissed popups — not an error worth showing
          if (error.code !== 'auth/popup-closed-by-user' && error.code !== 'auth/cancelled-popup-request') {
            showError(document.getElementById('yb-login-error'), getAuthErrorMessage(error.code));
          }
        })
        .finally(function() {
          googleBtn.disabled = false;
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
    el.style.color = '';
    el.hidden = false;
  }

  // When all auth methods fail, show error with an inline link to the reset view
  function showErrorWithReset(el) {
    if (!el) return;
    var isDa = detectLocale() === 'da';
    el.innerHTML = isDa
      ? 'Forkert email eller adgangskode. <a href="#" data-yb-auth-switch="reset" style="color:inherit;font-weight:700;text-decoration:underline">Nulstil adgangskode &rarr;</a>'
      : 'Incorrect email or password. <a href="#" data-yb-auth-switch="reset" style="color:inherit;font-weight:700;text-decoration:underline">Reset password &rarr;</a>';
    el.style.color = '';
    el.hidden = false;
  }

  function showSuccess(el, message) {
    if (!el) return;
    el.textContent = message;
    el.style.color = '#2a7a2a';
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

  // ============================================
  // AUTH BRIDGE (postMessage from parent iframe)
  // ============================================
  // When the profile page is embedded in an iframe on the Framer site,
  // login-cta.js sends a Firebase ID token via postMessage.
  // We exchange it for a custom token via a Netlify function and sign in.

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.type !== 'hyc-auth-bridge' || !data.idToken) return;

    // If already logged in, notify parent and skip
    if (auth.currentUser) {
      if (window.parent !== window) {
        window.parent.postMessage({ type: 'hyc-profile-authenticated' }, '*');
      }
      return;
    }

    fetch('/.netlify/functions/auth-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: data.idToken })
    })
      .then(function (res) { return res.json(); })
      .then(function (result) {
        if (result.customToken) {
          return auth.signInWithCustomToken(result.customToken);
        }
      })
      .then(function () {
        // Tell parent iframe that auth succeeded — hides the loader
        if (window.parent !== window) {
          window.parent.postMessage({ type: 'hyc-profile-authenticated' }, '*');
        }
      })
      .catch(function (err) {
        console.warn('Auth bridge sign-in failed:', err);
      });
  });

  console.log('Firebase Auth initialized');
})();
