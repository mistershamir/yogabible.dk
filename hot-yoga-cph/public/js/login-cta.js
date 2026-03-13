// =====================================================================
// HOT YOGA COPENHAGEN — Login CTA + User Area Modal (fully self-contained)
// Drop into a Framer HTML Embed. Renders a login/profile button.
// Logged out: "Log ind" → opens its OWN auth modal (login/register/reset).
// Logged in: "Min profil" → opens user-area popup with passes,
//            quick actions, and logout — all inside the Framer page.
// Brand: #3f99a5 (HYC teal)
// API:   https://profile.hotyogacph.dk/.netlify/functions
// Embed: <div id="hyc-login-cta"></div>
//        <script src="https://profile.hotyogacph.dk/js/login-cta.js"></script>
// =====================================================================
(function () {
  'use strict';

  if (window.__hyc_login_cta_loaded) return;
  window.__hyc_login_cta_loaded = true;

  // ── Config ──────────────────────────────────────────────────────────
  var BRAND        = '#3f99a5';
  var BRAND_DARK   = '#357f89';
  var BRAND_LIGHT  = '#e8f4f6';
  var BRAND_RGBA12 = 'rgba(63,153,165,.12)';
  var API_BASE     = 'https://profile.hotyogacph.dk/.netlify/functions';
  var PROFILE_URL  = 'https://profile.hotyogacph.dk';
  var FIREBASE_VER = '12.10.0';
  var FIREBASE_CDN = 'https://www.gstatic.com/firebasejs/' + FIREBASE_VER;

  // Firebase config — placeholders replaced at Netlify build time
  var FIREBASE_CONFIG = {
    apiKey:            "__FIREBASE_API_KEY__",
    authDomain:        "__FIREBASE_AUTH_DOMAIN__",
    projectId:         "__FIREBASE_PROJECT_ID__",
    storageBucket:     "__FIREBASE_STORAGE_BUCKET__",
    messagingSenderId: "__FIREBASE_MESSAGING_SENDER_ID__",
    appId:             "__FIREBASE_APP_ID__"
  };

  // ── Language ────────────────────────────────────────────────────────
  var isDa = window.location.pathname.indexOf('/en/') !== 0;
  function t(da, en) { return isDa ? da : en; }

  // ── State ─────────────────────────────────────────────────────────
  var container = null;
  var currentUser = null;
  var mbClientId = null;

  var firebaseReady = false;
  var modalEl = null;
  var modalMode = null; // 'auth-login' | 'auth-register' | 'auth-forgot' | 'user-area'

  // ── Target document (escape iframe if possible) ───────────────────
  // Framer wraps navigation HTML embeds in an iframe. The modal must
  // render in the TOP document so it covers the full viewport.
  var targetDoc = document;
  var isFramed = false;
  try {
    if (window.self !== window.top) {
      isFramed = true;
      // Try to access parent — works for same-origin / srcdoc iframes
      var topDoc = window.top.document;
      if (topDoc && topDoc.body) {
        // The Framer page may embed this script in multiple iframes.
        // Only ONE instance should own the parent-document injection;
        // others must bail out to avoid duplicate modals + event listeners.
        if (window.top.__hyc_login_cta_injected) return;
        window.top.__hyc_login_cta_injected = true;
        targetDoc = topDoc;
      }
    }
  } catch (e) {
    // Cross-origin iframe — cannot access parent document.
    // Modal will render inside iframe (limited viewport).
    isFramed = true;
  }

  // ── Helpers ───────────────────────────────────────────────────────
  function esc(str) {
    var d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }
  // Shortcut: get element in the target document (parent page if framed)
  function $t(id) { return targetDoc.getElementById(id); }

  // ── SVG Icons ─────────────────────────────────────────────────────
  var ICON = {
    login:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>',
    profile:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    logout:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
    close:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    cart:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>',
    check:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
    back:     '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>',
    spinner:  '<div class="hyc-ua__spinner"></div>'
  };


  // ═══════════════════════════════════════════════════════════════════
  // FIREBASE SDK LOADER
  // ═══════════════════════════════════════════════════════════════════

  function loadScript(url, cb) {
    var s = document.createElement('script');
    s.src = url;
    s.onload = function () { cb(null); };
    s.onerror = function () { cb(new Error('Failed to load ' + url)); };
    document.head.appendChild(s);
  }

  function loadFirebaseSDK(callback) {
    // Try SESSION persistence (sessionStorage — not IndexedDB, so no hang).
    // Falls back to NONE if SESSION is blocked (cross-origin sandbox).
    function onFirebaseReady() {
      if (typeof firebase !== 'undefined' && firebase.auth) {
        firebase.auth().setPersistence(firebase.auth.Auth.Persistence.SESSION)
          .then(function () { callback(); })
          .catch(function () {
            // SESSION blocked (cross-origin) — fall back to NONE + manual persistence
            firebase.auth().setPersistence(firebase.auth.Auth.Persistence.NONE)
              .then(function () { callback(); })
              .catch(function () { callback(); });
          });
      } else {
        callback();
      }
    }

    // If Firebase is already loaded (e.g. by checkout-embed.js)
    if (typeof firebase !== 'undefined' && firebase.apps) {
      if (!firebase.apps.length) {
        try { firebase.initializeApp(FIREBASE_CONFIG); } catch (e) { /* already init */ }
      }
      return onFirebaseReady();
    }

    var scripts = [
      FIREBASE_CDN + '/firebase-app-compat.js',
      FIREBASE_CDN + '/firebase-auth-compat.js',
      FIREBASE_CDN + '/firebase-firestore-compat.js'
    ];

    var i = 0;
    function next(err) {
      if (err) console.warn('[HYC Login CTA] Script load error:', err.message);
      if (i >= scripts.length) {
        try {
          if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
        } catch (e) {
          console.warn('[HYC Login CTA] Firebase init error:', e.message);
        }
        return onFirebaseReady();
      }
      loadScript(scripts[i++], next);
    }
    next(null);
  }


  // ═══════════════════════════════════════════════════════════════════
  // FIREBASE AUTH FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════

  function doLogin(email, password, callback) {
    firebase.auth().signInWithEmailAndPassword(email, password)
      .then(function () { callback(null); })
      .catch(function (err) { callback(err); });
  }

  function doRegister(email, password, firstName, lastName, phone, callback) {
    firebase.auth().createUserWithEmailAndPassword(email, password)
      .then(function (cred) {
        var fullName = firstName + ' ' + lastName;
        var consents = {
          termsAndConditions: { accepted: true, timestamp: new Date().toISOString(), version: '2026-02-09' },
          privacyPolicy:     { accepted: true, timestamp: new Date().toISOString(), version: '2026-02-09' },
          codeOfConduct:     { accepted: true, timestamp: new Date().toISOString(), version: '2026-02-09' }
        };
        // Create Firestore user profile
        createFirestoreProfile(cred.user, firstName, lastName, phone, consents);
        // Create MB client (triggers welcome email)
        findOrCreateClient(firstName, lastName, email, phone).catch(function () {});
        return cred.user.updateProfile({ displayName: fullName });
      })
      .then(function () { callback(null); })
      .catch(function (err) { callback(err); });
  }

  function doForgotPassword(email, callback) {
    // Send branded reset email via Resend (better deliverability than
    // Firebase's built-in noreply@*.firebaseapp.com emails).
    var apiBase = 'https://www.hotyogacph.dk/.netlify/functions';
    fetch(apiBase + '/send-password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, lang: isDa ? 'da' : 'en' })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.ok) { callback(null); }
        else { callback({ code: 'custom', message: data.error || 'Failed' }); }
      })
      .catch(function (err) { callback(err); });
  }

  function authErrorMsg(err) {
    var code = err.code || '';
    if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
      return t('Forkert email eller adgangskode.', 'Incorrect email or password.');
    }
    if (code === 'auth/email-already-in-use') {
      return t('Denne email er allerede i brug.', 'This email is already in use.');
    }
    if (code === 'auth/weak-password') {
      return t('Adgangskoden skal v\u00e6re mindst 6 tegn.', 'Password must be at least 6 characters.');
    }
    if (code === 'auth/invalid-email') {
      return t('Ugyldig email-adresse.', 'Invalid email address.');
    }
    if (code === 'auth/too-many-requests') {
      return t('For mange fors\u00f8g. Pr\u00f8v igen senere.', 'Too many attempts. Please try again later.');
    }
    return err.message || t('Der opstod en fejl.', 'An error occurred.');
  }


  // ═══════════════════════════════════════════════════════════════════
  // FIRESTORE + MINDBODY CLIENT
  // ═══════════════════════════════════════════════════════════════════

  function createFirestoreProfile(user, firstName, lastName, phone, consents) {
    try {
      firebase.firestore().collection('users').doc(user.uid).set({
        uid: user.uid,
        email: user.email || '',
        firstName: firstName,
        lastName: lastName,
        phone: phone || '',
        displayName: (firstName + ' ' + lastName).trim(),
        consents: consents || {},
        source: 'login-cta',
        sourceSite: 'hotyogacph.dk',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true }).catch(function () {});
    } catch (e) { /* Firestore not ready */ }
  }

  function findOrCreateClient(firstName, lastName, email, phone) {
    return fetch(API_BASE + '/mb-client?email=' + encodeURIComponent(email))
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.found && data.client) return data.client.id;
        return fetch(API_BASE + '/mb-client', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            firstName: firstName,
            lastName: lastName || firstName,
            email: email,
            phone: phone || ''
          })
        })
        .then(function (res) { return res.json(); })
        .then(function (d) {
          if (d.client) return d.client.id;
          throw new Error('Could not create client');
        });
      });
  }

  function resolveMbClient(user) {
    if (typeof firebase === 'undefined' || !firebase.firestore) return;
    var userRef = firebase.firestore().collection('users').doc(user.uid);
    userRef.get()
      .then(function (doc) {
        if (doc.exists && doc.data().mindbodyClientId) {
          mbClientId = doc.data().mindbodyClientId;
          return;
        }
        // No Firestore profile or no mindbodyClientId — look up MB client by email and link
        linkMindbodyClient(user, userRef, doc.exists);
      })
      .catch(function () {});
  }

  function linkMindbodyClient(user, userRef, profileExists) {
    fetch(API_BASE + '/mb-client?email=' + encodeURIComponent(user.email))
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data.found || !data.client || !data.client.id) return;
        var clientId = String(data.client.id);
        mbClientId = clientId;

        if (profileExists) {
          // Profile exists but missing MB link — update it
          userRef.update({
            mindbodyClientId: clientId,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          }).catch(function () {});
        } else {
          // No profile at all (migrated user) — create one
          var displayName = user.displayName || user.email.split('@')[0];
          var nameParts = displayName.split(' ');
          userRef.set({
            uid: user.uid,
            email: user.email,
            firstName: nameParts[0] || '',
            lastName: nameParts.slice(1).join(' ') || '',
            displayName: displayName,
            phone: '',
            role: 'member',
            mindbodyClientId: clientId,
            source: 'login-cta',
            sourceSite: 'hotyogacph.dk',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          }, { merge: true }).catch(function () {});
        }
      })
      .catch(function () {});
  }


  // ═══════════════════════════════════════════════════════════════════
  // CSS INJECTION
  // ═══════════════════════════════════════════════════════════════════

  function injectCSS() {
    // Build CSS as a plain string first, then inject into both documents.
    // The CTA button lives in the iframe document; the modal lives in the
    // parent (targetDoc).  We inject into the iframe FIRST so the button
    // is always styled, then additionally into the parent for the modal.
    var css = [

      // ── CTA button ──────────────────────────────────────────────
      // Override Framer srcdoc defaults (body { display:flex } and * { box-sizing:border-box })
      'html,body{margin:0;padding:0;min-height:0;overflow:visible;background:transparent}',
      '.hyc-cta{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;display:inline-flex;align-items:center;gap:0.5rem;-webkit-font-smoothing:antialiased;overflow:visible}',
      '.hyc-cta__btn{display:inline-flex;align-items:center;gap:0.4rem;padding:0.55rem 1.25rem;border-radius:999px;font-family:inherit;font-size:0.88rem;font-weight:700;text-decoration:none;border:1.5px solid transparent;cursor:pointer;transition:all .2s;white-space:nowrap;line-height:1.2;box-sizing:content-box}',
      '.hyc-cta__btn svg{width:16px;height:16px;flex-shrink:0}',
      '.hyc-cta__btn--login{background:' + BRAND + ';color:#fff;border-color:' + BRAND + '}',
      '.hyc-cta__btn--login:hover{background:' + BRAND_DARK + ';border-color:' + BRAND_DARK + ';transform:translateY(-1px);box-shadow:0 4px 12px rgba(63,153,165,.3)}',
      '.hyc-cta__btn--user{background:' + BRAND + ';color:#fff;border-color:' + BRAND + '}',
      '.hyc-cta__btn--user:hover{background:' + BRAND_DARK + ';border-color:' + BRAND_DARK + ';transform:translateY(-1px);box-shadow:0 4px 12px rgba(63,153,165,.3)}',

      // ── Modal overlay ─────────────────────────────────────────
      '.hyc-ua{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px}',
      '.hyc-ua[aria-hidden="true"]{display:none}',
      '.hyc-ua__overlay{position:absolute;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}',

      // ── Modal box ─────────────────────────────────────────────
      '.hyc-ua__box{position:relative;background:#FFFCF9;border-radius:20px;width:100%;max-width:420px;max-height:90vh;overflow-y:auto;padding:32px 28px 28px;box-shadow:0 24px 64px rgba(0,0,0,.15);border:1px solid #E8E4E0;animation:hyc-ua-in .25s ease}',
      '@keyframes hyc-ua-in{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}',
      // Warm glow accent
      '.hyc-ua__box::before{content:"";position:absolute;top:-60px;right:-60px;width:180px;height:180px;background:radial-gradient(circle,' + BRAND_RGBA12 + ' 0%,transparent 70%);pointer-events:none}',

      // ── Close button ──────────────────────────────────────────
      '.hyc-ua__close{position:absolute;top:12px;right:12px;background:none;border:none;color:#6F6A66;cursor:pointer;width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:50%;z-index:2;transition:background .15s,color .15s}',
      '.hyc-ua__close:hover{background:#F5F3F0;color:#0F0F0F}',
      '.hyc-ua__close svg{width:20px;height:20px}',

      // ── User area: header ─────────────────────────────────────
      '.hyc-ua__header{display:flex;align-items:center;gap:14px;margin-bottom:24px}',
      '.hyc-ua__avatar{width:48px;height:48px;border-radius:50%;background:' + BRAND + ';color:#fff;display:flex;align-items:center;justify-content:center;font-size:1.2rem;font-weight:700;flex-shrink:0}',
      '.hyc-ua__greeting{font-size:0.82rem;color:#6F6A66;margin:0}',
      '.hyc-ua__name{font-size:1.15rem;font-weight:700;color:#0F0F0F;margin:2px 0 0}',

      // ── User area: pass cards ─────────────────────────────────
      '.hyc-ua__section{margin-bottom:20px}',
      '.hyc-ua__section-label{font-size:0.7rem;font-weight:700;color:#6F6A66;text-transform:uppercase;letter-spacing:.06em;margin:0 0 8px}',
      '.hyc-ua__pass{background:linear-gradient(135deg,' + BRAND_LIGHT + ',#FFFCF9);border:1.5px solid ' + BRAND + ';border-radius:12px;padding:14px 16px;margin-bottom:8px}',
      '.hyc-ua__pass-name{font-weight:700;color:#0F0F0F;font-size:0.9rem;margin:0 0 6px}',
      '.hyc-ua__pass-stats{display:flex;flex-wrap:wrap;gap:12px;font-size:0.82rem;color:#6F6A66}',
      '.hyc-ua__pass-stat strong{color:' + BRAND + ';font-weight:700}',
      '.hyc-ua__pass-stat--low{color:#c0392b}',
      '.hyc-ua__no-pass{background:#F5F3F0;border:1.5px dashed #E8E4E0;border-radius:12px;padding:20px;text-align:center;color:#6F6A66;font-size:0.88rem;line-height:1.5}',

      // ── User area: quick actions ──────────────────────────────
      '.hyc-ua__actions{display:flex;flex-direction:column;gap:8px;margin-bottom:20px}',
      '.hyc-ua__action{display:flex;align-items:center;gap:12px;padding:12px 16px;background:#fff;border:1.5px solid #E8E4E0;border-radius:12px;text-decoration:none;color:#0F0F0F;cursor:pointer;transition:all .15s;font-family:inherit;font-size:0.88rem;font-weight:600;width:100%;text-align:left}',
      '.hyc-ua__action:hover{border-color:' + BRAND + ';background:' + BRAND_LIGHT + ';color:' + BRAND + '}',
      '.hyc-ua__action svg{width:18px;height:18px;color:' + BRAND + ';flex-shrink:0}',
      '.hyc-ua__action-text{flex:1}',
      '.hyc-ua__action-arrow{color:#E8E4E0;font-size:1.1rem;transition:color .15s}',
      '.hyc-ua__action:hover .hyc-ua__action-arrow{color:' + BRAND + '}',

      // ── User area: divider + logout ───────────────────────────
      '.hyc-ua__divider{border:none;border-top:1px solid #E8E4E0;margin:0 0 20px}',
      '.hyc-ua__logout{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;padding:10px;background:none;border:1.5px solid #E8E4E0;border-radius:12px;color:#6F6A66;font-family:inherit;font-size:0.82rem;font-weight:600;cursor:pointer;transition:all .15s}',
      '.hyc-ua__logout:hover{color:#c0392b;border-color:#c0392b;background:#fef5f5}',
      '.hyc-ua__logout svg{width:16px;height:16px}',

      // ── Spinner ───────────────────────────────────────────────
      '.hyc-ua__spinner{width:16px;height:16px;border:2px solid #E8E4E0;border-top-color:' + BRAND + ';border-radius:50%;animation:hyc-ua-spin .7s linear infinite;display:inline-block}',
      '@keyframes hyc-ua-spin{to{transform:rotate(360deg)}}',
      '.hyc-ua__loading{display:flex;align-items:center;justify-content:center;gap:8px;padding:24px 0;color:#6F6A66;font-size:0.85rem}',

      // ═════════════════════════════════════════════════════════
      // AUTH FORM STYLES
      // ═════════════════════════════════════════════════════════

      // ── Auth header ───────────────────────────────────────────
      '.hyc-auth__header{text-align:left;margin-bottom:24px}',
      '.hyc-auth__title{font-size:1.5rem;font-weight:700;color:#0F0F0F;margin:0 0 6px}',
      '.hyc-auth__subtitle{font-size:.9rem;color:#6F6A66;margin:0}',

      // ── Auth form fields ──────────────────────────────────────
      '.hyc-auth__form{display:flex;flex-direction:column;gap:16px}',
      '.hyc-auth__field{display:flex;flex-direction:column;gap:6px}',
      '.hyc-auth__field label{font-size:.82rem;font-weight:700;color:#0F0F0F;text-transform:uppercase;letter-spacing:.04em}',
      '.hyc-auth__field input{font-family:inherit;font-size:.95rem;padding:12px 16px;border:1px solid ' + BRAND + ';border-radius:12px;background:#fff;color:#0F0F0F;transition:border-color .15s,box-shadow .15s;outline:none;width:100%;min-width:0;box-sizing:border-box}',
      '.hyc-auth__field input::placeholder{color:#B5B0AB}',
      '.hyc-auth__field input:focus{border-color:' + BRAND + ';box-shadow:0 0 0 3px ' + BRAND_RGBA12 + '}',
      '.hyc-auth__row{display:grid;grid-template-columns:1fr 1fr;gap:12px;overflow:hidden}',

      // ── Submit button ─────────────────────────────────────────
      '.hyc-auth__submit{font-family:inherit;font-size:1rem;font-weight:700;padding:14px 24px;background:' + BRAND + ';color:#fff;border:none;border-radius:12px;cursor:pointer;transition:background .2s,transform .15s;margin-top:4px}',
      '.hyc-auth__submit:hover{background:' + BRAND_DARK + '}',
      '.hyc-auth__submit:active{transform:scale(.98)}',
      '.hyc-auth__submit:disabled{opacity:.6;cursor:not-allowed}',

      // ── Error / success ───────────────────────────────────────
      '.hyc-auth__error{font-size:.85rem;color:#d32f2f;background:#fdecea;padding:10px 14px;border-radius:8px;display:none}',
      '.hyc-auth__error.is-visible{display:block}',
      '.hyc-auth__success{font-size:.85rem;color:#2e7d32;background:#edf7ed;padding:10px 14px;border-radius:8px;display:none}',
      '.hyc-auth__success.is-visible{display:block}',

      // ── Links / dividers ──────────────────────────────────────
      '.hyc-auth__links{text-align:center;margin-top:12px}',
      '.hyc-auth__links a{font-size:.85rem;color:' + BRAND + ';text-decoration:none;cursor:pointer}',
      '.hyc-auth__links a:hover{text-decoration:underline}',
      '.hyc-auth__divider{text-align:center;margin-top:20px;padding-top:20px;border-top:1px solid #E8E4E0;font-size:.85rem;color:#6F6A66}',
      '.hyc-auth__divider a{color:' + BRAND + ';text-decoration:none;font-weight:700;margin-left:4px;cursor:pointer}',
      '.hyc-auth__divider a:hover{text-decoration:underline}',

      // ── Back link ─────────────────────────────────────────────
      '.hyc-auth__back{display:inline-flex;align-items:center;gap:4px;font-size:.82rem;font-weight:600;color:#6F6A66;text-decoration:none;margin-bottom:12px;cursor:pointer;transition:color .15s;background:none;border:none;padding:0;font-family:inherit}',
      '.hyc-auth__back:hover{color:' + BRAND + '}',

      // ── Consent checkboxes ────────────────────────────────────
      '.hyc-auth__consent{display:flex;flex-direction:column;gap:10px;margin-top:4px;margin-bottom:16px}',
      '.hyc-auth__consent-item{display:flex;align-items:flex-start;gap:10px;font-size:.82rem;color:#0F0F0F;line-height:1.45;cursor:pointer}',
      '.hyc-auth__consent-item input[type="checkbox"]{appearance:none;-webkit-appearance:none;width:18px;height:18px;min-width:18px;border:1.5px solid #E8E4E0;border-radius:4px;margin-top:1px;cursor:pointer;position:relative;transition:border-color .15s,background .15s}',
      '.hyc-auth__consent-item input[type="checkbox"]:checked{background:' + BRAND + ';border-color:' + BRAND + '}',
      '.hyc-auth__consent-item input[type="checkbox"]:checked::after{content:"";position:absolute;left:5px;top:1px;width:5px;height:10px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}',
      '.hyc-auth__consent-item a{color:' + BRAND + ';text-decoration:underline;font-weight:600}',
      '.hyc-auth__consent-item a:hover{color:' + BRAND_DARK + '}',

      // ── Fullscreen profile iframe modal ──────────────────────
      '.hyc-ua__box--profile{max-width:960px;width:100%;height:90vh;max-height:90vh;padding:0;display:flex;flex-direction:column;overflow:hidden}',
      '.hyc-ua__box--profile::before{display:none}',
      '.hyc-ua__box--profile .hyc-ua__close{z-index:10;background:rgba(255,252,249,.92);box-shadow:0 2px 8px rgba(0,0,0,.1);border-radius:50%}',
      '.hyc-ua__box--profile #hyc-ua-content{flex:1;min-height:0}',
      '.hyc-ua__iframe-wrap{width:100%;height:100%;position:relative;overflow:hidden;border-radius:0 0 20px 20px}',
      '.hyc-ua__iframe{width:100%;height:100%;border:none;display:block}',
      '.hyc-ua__iframe-loader{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:#FFFCF9;z-index:1;transition:opacity .3s}',
      '.hyc-ua__iframe-loader.is-hidden{opacity:0;pointer-events:none}',
      '.hyc-ua__iframe-loader span{font-size:.9rem;color:#6F6A66}',

      // ── Responsive ────────────────────────────────────────────
      '@media (max-width:480px){',
        '.hyc-cta__btn{font-size:0.82rem;padding:0.5rem 1rem}',
        '.hyc-ua__box{padding:24px 20px 20px;border-radius:16px;max-height:95vh}',
        '.hyc-ua{padding:8px}',
        '.hyc-ua__header{gap:10px}',
        '.hyc-ua__avatar{width:40px;height:40px;font-size:1rem}',
        '.hyc-ua__name{font-size:1.05rem}',
        '.hyc-ua__action{padding:10px 14px;font-size:0.82rem}',
        '.hyc-auth__row{grid-template-columns:1fr}',
        '.hyc-ua__box--profile{max-width:100%;height:100vh;max-height:100vh;border-radius:0}',
        '.hyc-ua__iframe-wrap{border-radius:0}',
      '}',
      '@media (max-width:360px){',
        '.hyc-ua__box{padding:20px 16px 16px}',
        '.hyc-ua__pass{padding:12px 14px}',
        '.hyc-ua__pass-stats{gap:8px;font-size:0.78rem}',
      '}'

    ].join('\n');

    // 1. Always inject into the current document (iframe) for CTA button styles
    if (!document.getElementById('hyc-login-cta-css')) {
      var s = document.createElement('style');
      s.id = 'hyc-login-cta-css';
      s.textContent = css;
      document.head.appendChild(s);
    }

    // 2. Also inject into the parent document (if framed) for modal styles
    if (isFramed && targetDoc !== document && !targetDoc.getElementById('hyc-login-cta-css')) {
      var s2 = targetDoc.createElement('style');
      s2.id = 'hyc-login-cta-css';
      s2.textContent = css;
      targetDoc.head.appendChild(s2);
    }
  }


  // ═══════════════════════════════════════════════════════════════════
  // MODAL MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════

  function createModal() {
    if (modalEl) return;
    // Also guard against a previous instance that already injected the modal
    var existing = targetDoc.getElementById('hyc-ua-modal');
    if (existing) { modalEl = existing; return; }
    // Create in targetDoc (parent page if framed) so modal covers full viewport
    modalEl = targetDoc.createElement('div');
    modalEl.className = 'hyc-ua';
    modalEl.id = 'hyc-ua-modal';
    modalEl.setAttribute('aria-hidden', 'true');
    modalEl.setAttribute('role', 'dialog');
    modalEl.innerHTML =
      '<div class="hyc-ua__overlay"></div>' +
      '<div class="hyc-ua__box">' +
        '<button class="hyc-ua__close" type="button" aria-label="' + t('Luk', 'Close') + '">' + ICON.close + '</button>' +
        '<div id="hyc-ua-content"></div>' +
      '</div>';
    targetDoc.body.appendChild(modalEl);

    modalEl.querySelector('.hyc-ua__overlay').addEventListener('click', closeModal);
    modalEl.querySelector('.hyc-ua__close').addEventListener('click', closeModal);
    // Listen on both documents for Escape key
    targetDoc.addEventListener('keydown', escHandler);
    if (targetDoc !== document) document.addEventListener('keydown', escHandler);
  }

  function escHandler(e) {
    if (e.key === 'Escape' && modalEl && modalEl.getAttribute('aria-hidden') === 'false') {
      closeModal();
    }
  }

  function openModal(mode) {
    if (!modalEl) createModal();
    modalMode = mode;
    modalEl.setAttribute('aria-hidden', 'false');
    targetDoc.body.style.overflow = 'hidden';

    var box = modalEl.querySelector('.hyc-ua__box');
    var contentEl = targetDoc.getElementById('hyc-ua-content');
    if (!contentEl) return;

    if (mode === 'user-area') {
      box.classList.add('hyc-ua__box--profile');
      modalEl.setAttribute('aria-label', t('Min profil', 'My profile'));
      renderProfileIframe(contentEl);
    } else {
      box.classList.remove('hyc-ua__box--profile');
      modalEl.setAttribute('aria-label', t('Log ind', 'Sign in'));
      if (mode === 'auth-login') renderAuthLogin(contentEl);
      else if (mode === 'auth-register') renderAuthRegister(contentEl);
      else if (mode === 'auth-forgot') renderAuthForgot(contentEl);
    }
  }

  function closeModal() {
    if (!modalEl) return;
    modalEl.setAttribute('aria-hidden', 'true');
    targetDoc.body.style.overflow = '';

    // Clean up profile iframe to free resources
    var box = modalEl.querySelector('.hyc-ua__box');
    if (box) box.classList.remove('hyc-ua__box--profile');
    var iframe = targetDoc.getElementById('hyc-ua-iframe');
    if (iframe) iframe.src = 'about:blank';

    modalMode = null;
  }


  // ═══════════════════════════════════════════════════════════════════
  // AUTH MODAL: LOGIN
  // ═══════════════════════════════════════════════════════════════════

  function renderAuthLogin(contentEl) {
    var html = '';
    html += '<div class="hyc-auth__header">';
    html +=   '<h2 class="hyc-auth__title">' + t('Velkommen tilbage', 'Welcome back') + '</h2>';
    html +=   '<p class="hyc-auth__subtitle">' + t('Log ind for at se din profil og book klasser', 'Sign in to view your profile and book classes') + '</p>';
    html += '</div>';

    html += '<form id="hyc-auth-login-form" class="hyc-auth__form" name="login" action="" novalidate>';
    html +=   '<div class="hyc-auth__field">';
    html +=     '<label for="hyc-auth-email">Email</label>';
    html +=     '<input type="email" id="hyc-auth-email" name="username" required autocomplete="username" placeholder="din@email.dk">';
    html +=   '</div>';
    html +=   '<div class="hyc-auth__field">';
    html +=     '<label for="hyc-auth-password">' + t('Adgangskode', 'Password') + '</label>';
    html +=     '<input type="password" id="hyc-auth-password" name="password" required autocomplete="current-password" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022">';
    html +=   '</div>';
    html +=   '<div class="hyc-auth__error" id="hyc-auth-login-error"></div>';
    html +=   '<button type="submit" class="hyc-auth__submit" id="hyc-auth-login-btn">' + t('Log ind', 'Sign in') + '</button>';
    html += '</form>';

    html += '<div class="hyc-auth__links">';
    html +=   '<a id="hyc-auth-goto-forgot">' + t('Glemt adgangskode?', 'Forgot password?') + '</a>';
    html += '</div>';

    html += '<div class="hyc-auth__divider">';
    html +=   t('Har du ikke en konto?', 'Don\'t have an account?');
    html +=   '<a id="hyc-auth-goto-register">' + t('Opret profil', 'Create profile') + '</a>';
    html += '</div>';

    contentEl.innerHTML = html;

    // Wire login form
    var form = $t('hyc-auth-login-form');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var errorEl = $t('hyc-auth-login-error');
      errorEl.classList.remove('is-visible');

      var email = $t('hyc-auth-email').value.trim();
      var password = $t('hyc-auth-password').value;

      if (!email || !password) {
        errorEl.textContent = t('Udfyld alle felter.', 'Please fill in all fields.');
        errorEl.classList.add('is-visible');
        return;
      }

      var btn = $t('hyc-auth-login-btn');
      btn.disabled = true;
      btn.textContent = t('Logger ind...', 'Signing in...');

      doLogin(email, password, function (err) {
        btn.disabled = false;
        btn.textContent = t('Log ind', 'Sign in');
        if (err) {
          var code = err.code || '';
          if (code === 'auth/user-not-found' || code === 'auth/invalid-credential') {
            // Try migrating from Mindbody with their password
            fetch(API_BASE + '/migrate-mb-user', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: email, password: password })
            })
              .then(function(res) { return res.json(); })
              .then(function(data) {
                if (data.created) {
                  // Account created — sign in seamlessly
                  doLogin(email, password, function(err2) {
                    if (err2) {
                      errorEl.textContent = authErrorMsg(err2);
                      errorEl.classList.add('is-visible');
                      return;
                    }
                    closeModal();
                  });
                  return;
                }
                // Account exists in Firebase — wrong password. Auto-send reset email.
                if (data.hasFirebaseAccount) {
                  var apiBase = 'https://www.hotyogacph.dk/.netlify/functions';
                  fetch(apiBase + '/send-password-reset', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: email, lang: isDa ? 'da' : 'en' })
                  }).catch(function() {});
                  errorEl.innerHTML = t(
                    'Forkert adgangskode. Vi har sendt en email til <strong>' + email + '</strong> s\u00e5 du kan nulstille din adgangskode. Tjek din indbakke (og spam).',
                    'Incorrect password. We\u2019ve sent an email to <strong>' + email + '</strong> to reset your password. Check your inbox (and spam).'
                  );
                  errorEl.classList.add('is-visible');
                  return;
                }
                // Not in MB — show generic error
                errorEl.innerHTML = t(
                  'Vi kunne ikke finde en konto med disse oplysninger. Allerede klient hos os? <a href="#" onclick="return false" id="hyc-err-register" style="color:inherit;font-weight:700;text-decoration:underline">Opret profil</a> med samme email som du booker med. Har du allerede en konto her? <a href="#" onclick="return false" id="hyc-err-forgot" style="color:inherit;font-weight:700;text-decoration:underline">Nulstil adgangskode \u2192</a>',
                  'We couldn\'t find an account with these details. Already a client? <a href="#" onclick="return false" id="hyc-err-register" style="color:inherit;font-weight:700;text-decoration:underline">Create a profile</a> with the same email you book with. Already have one here? <a href="#" onclick="return false" id="hyc-err-forgot" style="color:inherit;font-weight:700;text-decoration:underline">Reset password \u2192</a>'
                );
                errorEl.classList.add('is-visible');
                var regLink = targetDoc.getElementById('hyc-err-register');
                var forgotLink = targetDoc.getElementById('hyc-err-forgot');
                if (regLink) regLink.addEventListener('click', function () { openModal('auth-register'); });
                if (forgotLink) forgotLink.addEventListener('click', function () { openModal('auth-forgot'); });
              })
              .catch(function() {
                errorEl.innerHTML = t(
                  'Vi kunne ikke finde en konto med disse oplysninger. Allerede klient hos os? <a href="#" onclick="return false" id="hyc-err-register2" style="color:inherit;font-weight:700;text-decoration:underline">Opret profil</a> med samme email som du booker med. Har du allerede en konto her? <a href="#" onclick="return false" id="hyc-err-forgot2" style="color:inherit;font-weight:700;text-decoration:underline">Nulstil adgangskode \u2192</a>',
                  'We couldn\'t find an account with these details. Already a client? <a href="#" onclick="return false" id="hyc-err-register2" style="color:inherit;font-weight:700;text-decoration:underline">Create a profile</a> with the same email you book with. Already have one here? <a href="#" onclick="return false" id="hyc-err-forgot2" style="color:inherit;font-weight:700;text-decoration:underline">Reset password \u2192</a>'
                );
                errorEl.classList.add('is-visible');
              })
              .finally(function() {
                btn.disabled = false;
                btn.textContent = t('Log ind', 'Sign in');
              });
            return;
          } else {
            errorEl.textContent = authErrorMsg(err);
            errorEl.classList.add('is-visible');
          }
          return;
        }
        // Auth state change will handle UI update and close modal
        closeModal();
      });
    });

    // Navigation links
    $t('hyc-auth-goto-forgot').addEventListener('click', function (e) {
      e.preventDefault();
      openModal('auth-forgot');
    });
    $t('hyc-auth-goto-register').addEventListener('click', function (e) {
      e.preventDefault();
      openModal('auth-register');
    });

    // Focus first input — wait until after modal animation (250ms) and
    // only focus if the user hasn't already clicked into a field
    setTimeout(function () {
      var el = $t('hyc-auth-email');
      if (el && targetDoc.activeElement !== $t('hyc-auth-password')) el.focus();
    }, 320);
  }


  // ═══════════════════════════════════════════════════════════════════
  // AUTH MODAL: REGISTER
  // ═══════════════════════════════════════════════════════════════════

  function renderAuthRegister(contentEl) {
    var html = '';

    html += '<button type="button" class="hyc-auth__back" id="hyc-auth-back-login">';
    html +=   ICON.back + ' ' + t('Tilbage', 'Back');
    html += '</button>';

    html += '<div class="hyc-auth__header">';
    html +=   '<h2 class="hyc-auth__title">' + t('Opret din profil', 'Create your profile') + '</h2>';
    html +=   '<p class="hyc-auth__subtitle">' + t('Det tager kun et minut', 'It only takes a minute') + '</p>';
    html += '</div>';

    html += '<form id="hyc-auth-reg-form" class="hyc-auth__form" name="register" action="" novalidate>';
    html +=   '<div class="hyc-auth__row">';
    html +=     '<div class="hyc-auth__field">';
    html +=       '<label for="hyc-reg-firstname">' + t('Fornavn', 'First name') + '</label>';
    html +=       '<input type="text" id="hyc-reg-firstname" name="given-name" required autocomplete="given-name" placeholder="' + t('Fornavn', 'First name') + '">';
    html +=     '</div>';
    html +=     '<div class="hyc-auth__field">';
    html +=       '<label for="hyc-reg-lastname">' + t('Efternavn', 'Last name') + '</label>';
    html +=       '<input type="text" id="hyc-reg-lastname" name="family-name" required autocomplete="family-name" placeholder="' + t('Efternavn', 'Last name') + '">';
    html +=     '</div>';
    html +=   '</div>';
    html +=   '<div class="hyc-auth__field">';
    html +=     '<label for="hyc-reg-email">Email</label>';
    html +=     '<input type="email" id="hyc-reg-email" name="email" required autocomplete="email" placeholder="din@email.dk">';
    html +=   '</div>';
    html +=   '<div class="hyc-auth__field">';
    html +=     '<label for="hyc-reg-phone">' + t('Telefon', 'Phone') + '</label>';
    html +=     '<input type="tel" id="hyc-reg-phone" name="tel" autocomplete="tel" placeholder="+45 12 34 56 78">';
    html +=   '</div>';
    html +=   '<div class="hyc-auth__field">';
    html +=     '<label for="hyc-reg-password">' + t('Adgangskode', 'Password') + '</label>';
    html +=     '<input type="password" id="hyc-reg-password" name="new-password" required autocomplete="new-password" placeholder="' + t('Mindst 6 tegn', 'At least 6 characters') + '">';
    html +=   '</div>';

    // Consent checkboxes
    html +=   '<div class="hyc-auth__consent">';
    html +=     '<label class="hyc-auth__consent-item">';
    html +=       '<input type="checkbox" id="hyc-reg-terms" required>';
    html +=       '<span>' + t(
                    'Jeg accepterer <a href="' + PROFILE_URL + '/terms-conditions/" target="_blank" rel="noopener">Handelsbetingelser</a> og <a href="' + PROFILE_URL + '/privacy-policy/" target="_blank" rel="noopener">Privatlivspolitik</a>',
                    'I agree to the <a href="' + PROFILE_URL + '/en/terms-conditions/" target="_blank" rel="noopener">Terms &amp; Conditions</a> and <a href="' + PROFILE_URL + '/en/privacy-policy/" target="_blank" rel="noopener">Privacy Policy</a>'
                  ) + '</span>';
    html +=     '</label>';
    html +=     '<label class="hyc-auth__consent-item">';
    html +=       '<input type="checkbox" id="hyc-reg-conduct" required>';
    html +=       '<span>' + t(
                    'Jeg accepterer <a href="' + PROFILE_URL + '/code-of-conduct/" target="_blank" rel="noopener">Code of Conduct</a>',
                    'I agree to the <a href="' + PROFILE_URL + '/en/code-of-conduct/" target="_blank" rel="noopener">Code of Conduct</a>'
                  ) + '</span>';
    html +=     '</label>';
    html +=   '</div>';

    html +=   '<div class="hyc-auth__error" id="hyc-auth-reg-error"></div>';
    html +=   '<button type="submit" class="hyc-auth__submit" id="hyc-auth-reg-btn">' + t('Opret profil', 'Create profile') + '</button>';
    html += '</form>';

    html += '<div class="hyc-auth__divider">';
    html +=   t('Har du allerede en konto?', 'Already have an account?');
    html +=   '<a id="hyc-auth-goto-login-from-reg">' + t('Log ind', 'Sign in') + '</a>';
    html += '</div>';

    contentEl.innerHTML = html;

    // Wire register form
    var form = $t('hyc-auth-reg-form');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var errorEl = $t('hyc-auth-reg-error');
      errorEl.classList.remove('is-visible');

      var firstName = $t('hyc-reg-firstname').value.trim();
      var lastName  = $t('hyc-reg-lastname').value.trim();
      var email     = $t('hyc-reg-email').value.trim();
      var phone     = $t('hyc-reg-phone').value.trim();
      var password  = $t('hyc-reg-password').value;
      var terms     = $t('hyc-reg-terms').checked;
      var conduct   = $t('hyc-reg-conduct').checked;

      if (!firstName || !lastName || !email || !password) {
        errorEl.textContent = t('Udfyld alle obligatoriske felter.', 'Please fill in all required fields.');
        errorEl.classList.add('is-visible');
        return;
      }
      if (password.length < 6) {
        errorEl.textContent = t('Adgangskoden skal v\u00e6re mindst 6 tegn.', 'Password must be at least 6 characters.');
        errorEl.classList.add('is-visible');
        return;
      }
      if (!terms || !conduct) {
        errorEl.textContent = t('Du skal acceptere betingelserne.', 'You must accept the terms.');
        errorEl.classList.add('is-visible');
        return;
      }

      var btn = $t('hyc-auth-reg-btn');
      btn.disabled = true;
      btn.textContent = t('Opretter profil...', 'Creating profile...');

      doRegister(email, password, firstName, lastName, phone, function (err) {
        btn.disabled = false;
        btn.textContent = t('Opret profil', 'Create profile');
        if (err) {
          var code = err.code || '';
          if (code === 'auth/email-already-in-use') {
            errorEl.innerHTML = t(
              'Der findes allerede en konto med denne email. Vi har sendt dig en email til at oprette din adgangskode. Tjek din indbakke (og spam), eller <a href="#" onclick="return false" id="hyc-reg-reset-link" style="color:inherit;font-weight:700;text-decoration:underline">nulstil adgangskode \u2192</a>',
              'An account with this email already exists. We\'ve sent you an email to set your password. Check your inbox (and spam), or <a href="#" onclick="return false" id="hyc-reg-reset-link" style="color:inherit;font-weight:700;text-decoration:underline">reset password \u2192</a>'
            );
            errorEl.classList.add('is-visible');
            var rl = targetDoc.getElementById('hyc-reg-reset-link');
            if (rl) rl.addEventListener('click', function () { openModal('auth-forgot'); });
            var resetUrl = 'https://www.hotyogacph.dk/.netlify/functions';
            fetch(resetUrl + '/send-password-reset', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: email, lang: isDa ? 'da' : 'en' })
            }).catch(function() {});
          } else {
            errorEl.textContent = authErrorMsg(err);
            errorEl.classList.add('is-visible');
          }
          return;
        }
        // Auth state change will handle UI update and close modal
        closeModal();
      });
    });

    // Navigation
    $t('hyc-auth-back-login').addEventListener('click', function () {
      openModal('auth-login');
    });
    $t('hyc-auth-goto-login-from-reg').addEventListener('click', function (e) {
      e.preventDefault();
      openModal('auth-login');
    });

    setTimeout(function () { var el = $t('hyc-reg-firstname'); if (el) el.focus(); }, 320);
  }


  // ═══════════════════════════════════════════════════════════════════
  // AUTH MODAL: FORGOT PASSWORD
  // ═══════════════════════════════════════════════════════════════════

  function renderAuthForgot(contentEl) {
    var html = '';

    html += '<div class="hyc-auth__header">';
    html +=   '<h2 class="hyc-auth__title">' + t('Nulstil adgangskode', 'Reset password') + '</h2>';
    html +=   '<p class="hyc-auth__subtitle">' + t('Indtast din email, s\u00e5 sender vi dig et link', 'Enter your email and we\'ll send you a reset link') + '</p>';
    html += '</div>';

    html += '<form id="hyc-auth-forgot-form" class="hyc-auth__form" name="forgot-password" action="" novalidate>';
    html +=   '<div class="hyc-auth__field">';
    html +=     '<label for="hyc-forgot-email">Email</label>';
    html +=     '<input type="email" id="hyc-forgot-email" name="email" required autocomplete="email" placeholder="din@email.dk">';
    html +=   '</div>';
    html +=   '<div class="hyc-auth__error" id="hyc-auth-forgot-error"></div>';
    html +=   '<div class="hyc-auth__success" id="hyc-auth-forgot-success"></div>';
    html +=   '<button type="submit" class="hyc-auth__submit">' + t('Send nulstillingslink', 'Send reset link') + '</button>';
    html += '</form>';

    html += '<div class="hyc-auth__divider">';
    html +=   '<a id="hyc-auth-back-from-forgot">' + t('\u2190 Tilbage til log ind', '\u2190 Back to sign in') + '</a>';
    html += '</div>';

    contentEl.innerHTML = html;

    // Wire forgot form
    var form = $t('hyc-auth-forgot-form');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var errorEl = $t('hyc-auth-forgot-error');
      var successEl = $t('hyc-auth-forgot-success');
      errorEl.classList.remove('is-visible');
      successEl.classList.remove('is-visible');

      var email = $t('hyc-forgot-email').value.trim();
      if (!email) {
        errorEl.textContent = t('Indtast din email.', 'Please enter your email.');
        errorEl.classList.add('is-visible');
        return;
      }

      doForgotPassword(email, function (err) {
        if (err) {
          errorEl.textContent = authErrorMsg(err);
          errorEl.classList.add('is-visible');
          return;
        }
        successEl.textContent = t(
          'Vi har sendt dig et link til at nulstille din adgangskode.',
          'We\'ve sent you a link to reset your password.'
        );
        successEl.classList.add('is-visible');
      });
    });

    // Back to login
    $t('hyc-auth-back-from-forgot').addEventListener('click', function (e) {
      e.preventDefault();
      openModal('auth-login');
    });

    setTimeout(function () { var el = $t('hyc-forgot-email'); if (el) el.focus(); }, 320);
  }


  // ═══════════════════════════════════════════════════════════════════
  // PROFILE IFRAME MODAL (logged in)
  // ═══════════════════════════════════════════════════════════════════

  function renderProfileIframe(contentEl) {
    if (!currentUser) return;

    var html = '';
    html += '<div class="hyc-ua__iframe-wrap">';
    html += '<div class="hyc-ua__iframe-loader" id="hyc-ua-iframe-loader">';
    html += '<div class="hyc-ua__spinner"></div>';
    html += '<span id="hyc-ua-iframe-loader-text">' + t('Henter din profil\u2026', 'Loading your profile\u2026') + '</span>';
    html += '</div>';
    html += '<iframe class="hyc-ua__iframe" id="hyc-ua-iframe" src="' + PROFILE_URL + '/" allow="payment" title="' + t('Min profil', 'My profile') + '"></iframe>';
    html += '</div>';

    contentEl.innerHTML = html;

    var iframe = $t('hyc-ua-iframe');
    var loader = $t('hyc-ua-iframe-loader');
    var loaderText = $t('hyc-ua-iframe-loader-text');

    if (iframe) {
      var authConfirmed = false;

      // Listen for auth-ready confirmation from profile page
      var onProfileMsg = function (e) {
        if (e.data && e.data.type === 'hyc-profile-authenticated') {
          authConfirmed = true;
          if (loader) loader.classList.add('is-hidden');
          window.removeEventListener('message', onProfileMsg);
        }
      };
      window.addEventListener('message', onProfileMsg);

      // Send auth token multiple times (profile page JS may not be ready on first attempt)
      iframe.addEventListener('load', function () {
        sendAuthToIframe(iframe);
        setTimeout(function () { sendAuthToIframe(iframe); }, 800);
        setTimeout(function () { sendAuthToIframe(iframe); }, 2000);
      });

      // After 4s, hide loader regardless (profile page may not send confirmation)
      setTimeout(function () {
        if (loader) loader.classList.add('is-hidden');
      }, 4000);

      // After 7s, if still no auth confirmation, show a fallback link
      setTimeout(function () {
        if (!authConfirmed && loaderText) {
          loaderText.innerHTML =
            '<a href="' + PROFILE_URL + '/" target="_blank" rel="noopener" style="color:' + BRAND + ';text-decoration:underline">' +
            t('\u00c5bn profil i ny fane', 'Open profile in new tab') + '</a>';
        }
      }, 7000);
    }
  }

  function sendAuthToIframe(iframe) {
    if (!currentUser || !iframe || !iframe.contentWindow) return;

    currentUser.getIdToken().then(function (idToken) {
      iframe.contentWindow.postMessage(
        { type: 'hyc-auth-bridge', idToken: idToken },
        PROFILE_URL
      );
    }).catch(function (err) {
      console.warn('Could not send auth to profile iframe:', err);
    });
  }


  // ═══════════════════════════════════════════════════════════════════
  // CTA BUTTON RENDERS
  // ═══════════════════════════════════════════════════════════════════

  // Tell Framer's parent frame about our height so the embed iframe
  // is sized correctly (Framer HTML embeds start at height:0).
  // Framer's srcdoc includes a ResizeObserver that posts { embedHeight }
  // to the parent, but it can report 0 before our content renders.
  // We send our own measured height and keep a persistent interval
  // running for a few seconds to ensure Framer picks it up.
  var _heightInterval = null;

  function _sendHeight() {
    try {
      if (window.parent && window.parent !== window) {
        var h = document.body.scrollHeight || document.body.offsetHeight || 0;
        if (h > 0) window.parent.postMessage({ embedHeight: h }, '*');
      }
    } catch (e) { /* cross-origin — ignore */ }
  }

  function notifyFramerHeight() {
    _sendHeight();
    setTimeout(_sendHeight, 50);
    setTimeout(_sendHeight, 200);
  }

  // Also respond when Framer asks for height (its poll mechanism)
  window.addEventListener('message', function (e) {
    try {
      if (e.data === 'getEmbedHeight') _sendHeight();
    } catch (x) {}
  });

  function renderLoggedOut() {
    if (!container) return;
    container.innerHTML =
      '<button class="hyc-cta__btn hyc-cta__btn--login" type="button" id="hyc-cta-login">' +
        ICON.login + t('Log ind', 'Login') +
      '</button>';

    document.getElementById('hyc-cta-login').addEventListener('click', function () {
      openModal('auth-login');
    });
    notifyFramerHeight();
  }

  function renderLoggedIn(user) {
    if (!container) return;
    container.innerHTML =
      '<button class="hyc-cta__btn hyc-cta__btn--user" type="button" id="hyc-cta-user">' +
        ICON.profile + t('Min profil', 'My Profile') +
      '</button>';

    document.getElementById('hyc-cta-user').addEventListener('click', function () {
      openModal('user-area');
    });
    notifyFramerHeight();
  }


  // ═══════════════════════════════════════════════════════════════════
  // SESSION PERSISTENCE (parent sessionStorage)
  // ═══════════════════════════════════════════════════════════════════
  // Firebase runs with Persistence.NONE in this cross-origin embed to
  // avoid IndexedDB hangs.  To survive page reloads we store a Firebase
  // ID token in the *parent* window's sessionStorage (first-party,
  // never blocked) and exchange it for a custom token on init.

  var SESSION_KEY = 'hyc_auth_token';

  function _parentStorage() {
    // Try parent localStorage first (survives tab close + page nav)
    try { var s = window.top.localStorage; s.getItem('_'); return s; }
    catch (e) { /* cross-origin */ }
    // Try own localStorage
    try { var s2 = window.localStorage; s2.getItem('_'); return s2; }
    catch (e) { /* sandboxed */ }
    // Try parent sessionStorage
    try { var s3 = window.top.sessionStorage; s3.getItem('_'); return s3; }
    catch (e) { /* cross-origin */ }
    // Try own sessionStorage
    try { var s4 = window.sessionStorage; s4.getItem('_'); return s4; }
    catch (e) { /* sandboxed */ }
    return null;
  }

  function persistAuthToken(user) {
    if (!user) { clearAuthToken(); return; }
    user.getIdToken().then(function (t) {
      var s = _parentStorage();
      if (s) s.setItem(SESSION_KEY, t);
    }).catch(function () {});
  }

  function clearAuthToken() {
    var s = _parentStorage();
    if (s) s.removeItem(SESSION_KEY);
  }

  function restoreSession() {
    var s = _parentStorage();
    var token = s && s.getItem(SESSION_KEY);
    if (!token || firebase.auth().currentUser) {
      _restoring = false;
      renderLoggedOut();
      return;
    }

    // Safety timeout: if restore hangs, force-show the login button
    var restoreTimeout = setTimeout(function () {
      if (_restoring) {
        console.warn('[login-cta] Restore timed out — forcing logged-out state');
        _restoring = false;
        clearAuthToken();
        renderLoggedOut();
      }
    }, 5000);

    fetch(API_BASE + '/auth-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.customToken) {
          return firebase.auth().signInWithCustomToken(data.customToken);
        }
        // No custom token returned — endpoint rejected it
        throw new Error('No customToken in response');
      })
      .then(function () {
        // Success — onAuthStateChanged will handle rendering
        clearTimeout(restoreTimeout);
        _restoring = false;
      })
      .catch(function () {
        // Token expired / invalid / endpoint error — clean up
        clearTimeout(restoreTimeout);
        _restoring = false;
        clearAuthToken();
        renderLoggedOut();
      });
  }


  // ═══════════════════════════════════════════════════════════════════
  // CROSS-IFRAME AUTH SYNC (via shared auth-sync.html bridge)
  // ═══════════════════════════════════════════════════════════════════
  // login-cta and checkout-embed run in separate Framer srcdoc iframes
  // with null origin — localStorage is sandboxed per iframe.
  // We load a hidden iframe from profile.hotyogacph.dk/auth-sync.html
  // which has real localStorage and relays auth events between siblings.

  var _syncFrame = null;
  var _syncReady = false;
  var _syncQueue = [];

  function initAuthSyncBridge() {
    try {
      var f = document.createElement('iframe');
      f.src = 'https://profile.hotyogacph.dk/auth-sync.html';
      f.style.cssText = 'display:none;width:0;height:0;border:0';
      f.setAttribute('aria-hidden', 'true');
      document.body.appendChild(f);
      _syncFrame = f;
      f.addEventListener('load', function () {
        _syncReady = true;
        // Flush queued messages
        for (var i = 0; i < _syncQueue.length; i++) {
          try { f.contentWindow.postMessage(_syncQueue[i], '*'); } catch (x) {}
        }
        _syncQueue = [];
        // Ask bridge if anyone is already logged in
        try { f.contentWindow.postMessage({ type: 'hyc-auth-sync', action: 'query' }, '*'); } catch (x) {}
      });
    } catch (e) { /* iframe blocked */ }
  }

  function sendToSyncBridge(msg) {
    if (_syncReady && _syncFrame && _syncFrame.contentWindow) {
      try { _syncFrame.contentWindow.postMessage(msg, '*'); } catch (e) {}
    } else {
      _syncQueue.push(msg);
    }
  }

  function broadcastAuthChange(user) {
    if (!user) {
      sendToSyncBridge({ type: 'hyc-auth-sync', action: 'logout' });
      return;
    }
    user.getIdToken().then(function (token) {
      sendToSyncBridge({ type: 'hyc-auth-sync', action: 'login', idToken: token });
    }).catch(function () {});
  }

  function listenForAuthSync() {
    window.addEventListener('message', function (e) {
      try {
        if (!e.data || e.data.type !== 'hyc-auth-sync') return;
        if (!firebaseReady) return;

        if (e.data.action === 'login' && e.data.idToken && !currentUser && !_restoring) {
          _restoring = true;
          fetch(API_BASE + '/auth-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken: e.data.idToken })
          })
            .then(function (r) { return r.json(); })
            .then(function (data) {
              if (data.customToken) return firebase.auth().signInWithCustomToken(data.customToken);
              _restoring = false;
            })
            .catch(function () { _restoring = false; });
        } else if (e.data.action === 'logout' && currentUser) {
          firebase.auth().signOut();
        }
      } catch (x) {}
    });
  }

  function startAuthPolling() {
    setInterval(function () {
      if (!firebaseReady) return;
      var s = _parentStorage();
      var hasToken = s && s.getItem(SESSION_KEY);

      if (hasToken && !currentUser && !_restoring) {
        _restoring = true;
        restoreSession();
      } else if (!hasToken && currentUser) {
        firebase.auth().signOut();
      }
    }, 2000);
  }


  // ═══════════════════════════════════════════════════════════════════
  // AUTH STATE LISTENER
  // ═══════════════════════════════════════════════════════════════════

  var _restoring = false;

  function initAuth() {
    loadFirebaseSDK(function () {
      // Guard: if Firebase SDK failed to load (blocked by Safari ITP,
      // content blocker, or network error), just show the login button.
      if (typeof firebase === 'undefined' || !firebase.auth) {
        console.warn('[login-cta] Firebase SDK unavailable — showing login button');
        renderLoggedOut();
        return;
      }

      firebaseReady = true;

      // Read token BEFORE registering listener (prevents race condition)
      var savedToken = null;
      var s = _parentStorage();
      if (s) {
        try { savedToken = s.getItem(SESSION_KEY); } catch (e) { /* storage blocked */ }
      }
      try {
        if (savedToken && !firebase.auth().currentUser) _restoring = true;
      } catch (e) { /* auth() threw */ }

      try {
        // Set up cross-iframe auth sync via hidden bridge iframe
        initAuthSyncBridge();
        listenForAuthSync();

        firebase.auth().onAuthStateChanged(function (user) {
          currentUser = user;
          if (user) {
            _restoring = false;
            persistAuthToken(user);
            broadcastAuthChange(user);
            resolveMbClient(user);
            renderLoggedIn(user);
            // If auth modal is open, close it — user just logged in
            if (modalMode && modalMode.indexOf('auth-') === 0) {
              closeModal();
            }
          } else {
            mbClientId = null;
            // Don't wipe stored token while we're still restoring —
            // but always render the logged-out state so the button is never invisible
            if (!_restoring) {
              clearAuthToken();
              broadcastAuthChange(null);
            }
            renderLoggedOut();
            // Close user area modal if open
            if (modalMode === 'user-area') {
              closeModal();
            }
          }
        });

        // If no user yet, try to restore from stored token
        if (!firebase.auth().currentUser && savedToken) {
          restoreSession();
        }

        // Start polling for auth changes from other iframes (fallback)
        startAuthPolling();
      } catch (e) {
        console.warn('[login-cta] Firebase auth error:', e.message);
        renderLoggedOut();
      }
    });
  }


  // ═══════════════════════════════════════════════════════════════════
  // PUBLIC API (for checkout-embed.js and schedule-embed.js)
  // ═══════════════════════════════════════════════════════════════════

  // Expose openLoginModal so other embeds can trigger login
  window.openLoginModal = window.openLoginModal || function (callback) {
    // If already logged in, redirect
    if (currentUser) {
      if (typeof callback === 'function') callback();
      else window.location.href = PROFILE_URL + '/#schedule';
      return;
    }
    openModal('auth-login');
  };


  // ═══════════════════════════════════════════════════════════════════
  // BOOT
  // ═══════════════════════════════════════════════════════════════════

  function boot() {
    injectCSS();
    container = document.getElementById('hyc-login-cta');
    if (!container) return;
    container.className = 'hyc-cta';

    // If we have a stored session token, show loading spinner instead
    // of "Log ind" to avoid a logged-out → logged-in flash
    var s = _parentStorage();
    var hasStoredToken = s && s.getItem(SESSION_KEY);
    if (hasStoredToken) {
      container.innerHTML = '<span class="hyc-ua__loading" style="padding:6px 12px">' + ICON.spinner + '</span>';
      notifyFramerHeight();
    } else {
      renderLoggedOut();
    }

    initAuth();

    // Keep posting height to Framer every 500ms for 8 seconds.
    // Framer's ResizeObserver can report height:0 before our content
    // renders, and once Framer collapses the iframe to 0px it won't
    // recover unless it receives a new embedHeight message.
    if (_heightInterval) clearInterval(_heightInterval);
    _heightInterval = setInterval(_sendHeight, 500);
    setTimeout(function () { clearInterval(_heightInterval); }, 8000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
