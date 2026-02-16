// =====================================================================
// HOT YOGA COPENHAGEN — Login CTA + User Area Modal (self-contained)
// Drop into a Framer HTML Embed. Renders a login/profile button.
// Logged out: "Log ind" → opens checkout-embed.js auth modal.
// Logged in: user's name → opens a user-area popup with passes,
//            quick actions, and logout — all inside the Framer page.
// Brand: #3f99a5 (HYC teal)
// API:   https://profile.hotyogacph.dk/.netlify/functions
// =====================================================================
(function () {
  'use strict';

  if (window.__hyc_login_cta_loaded) return;
  window.__hyc_login_cta_loaded = true;

  // ── Config ──────────────────────────────────────────────────────────
  var BRAND       = '#3f99a5';
  var BRAND_DARK  = '#357f89';
  var BRAND_LIGHT = '#e8f4f6';
  var API_BASE    = 'https://profile.hotyogacph.dk/.netlify/functions';
  var PROFILE_URL = 'https://profile.hotyogacph.dk';

  // ── Language ────────────────────────────────────────────────────────
  var isDa = window.location.pathname.indexOf('/en/') !== 0;
  function t(da, en) { return isDa ? da : en; }

  // ── State ───────────────────────────────────────────────────────────
  var container = null;
  var currentUser = null;
  var mbClientId = null;
  var passData = null;

  // ── Helpers ─────────────────────────────────────────────────────────
  function esc(str) {
    var d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  // ── SVG Icons ───────────────────────────────────────────────────────
  var ICON = {
    login:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>',
    profile:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    logout:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
    close:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    cart:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>',
    pass:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>',
    check:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
    spinner:  '<div class="hyc-ua__spinner"></div>'
  };

  // ── CSS Injection ───────────────────────────────────────────────────
  function injectCSS() {
    if (document.getElementById('hyc-login-cta-css')) return;
    var s = document.createElement('style');
    s.id = 'hyc-login-cta-css';
    s.textContent = [

      // ── CTA button ──────────────────────────────────────────────
      '.hyc-cta{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;display:inline-flex;align-items:center;gap:0.5rem;-webkit-font-smoothing:antialiased}',
      '.hyc-cta__btn{display:inline-flex;align-items:center;gap:0.4rem;padding:0.55rem 1.25rem;border-radius:999px;font-family:inherit;font-size:0.88rem;font-weight:700;text-decoration:none;border:1.5px solid transparent;cursor:pointer;transition:all .2s;white-space:nowrap;line-height:1.2}',
      '.hyc-cta__btn svg{width:16px;height:16px;flex-shrink:0}',
      '.hyc-cta__btn--login{background:' + BRAND + ';color:#fff;border-color:' + BRAND + '}',
      '.hyc-cta__btn--login:hover{background:' + BRAND_DARK + ';border-color:' + BRAND_DARK + ';transform:translateY(-1px);box-shadow:0 4px 12px rgba(63,153,165,.3)}',
      '.hyc-cta__btn--user{background:#fff;color:' + BRAND + ';border-color:' + BRAND + '}',
      '.hyc-cta__btn--user:hover{background:' + BRAND_LIGHT + ';transform:translateY(-1px)}',

      // ── Modal overlay ───────────────────────────────────────────
      '.hyc-ua{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px}',
      '.hyc-ua[aria-hidden="true"]{display:none}',
      '.hyc-ua__overlay{position:absolute;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}',

      // ── Modal box ───────────────────────────────────────────────
      '.hyc-ua__box{position:relative;background:#FFFCF9;border-radius:20px;width:100%;max-width:420px;max-height:90vh;overflow-y:auto;padding:32px 28px 28px;box-shadow:0 24px 64px rgba(0,0,0,.15);border:1px solid #E8E4E0;animation:hyc-ua-in .25s ease}',
      '@keyframes hyc-ua-in{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}',

      // ── Close button ────────────────────────────────────────────
      '.hyc-ua__close{position:absolute;top:12px;right:12px;background:none;border:none;color:#6F6A66;cursor:pointer;width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:50%;z-index:2;transition:background .15s,color .15s}',
      '.hyc-ua__close:hover{background:#F5F3F0;color:#0F0F0F}',
      '.hyc-ua__close svg{width:20px;height:20px}',

      // ── User header ─────────────────────────────────────────────
      '.hyc-ua__header{display:flex;align-items:center;gap:14px;margin-bottom:24px}',
      '.hyc-ua__avatar{width:48px;height:48px;border-radius:50%;background:' + BRAND + ';color:#fff;display:flex;align-items:center;justify-content:center;font-size:1.2rem;font-weight:700;flex-shrink:0}',
      '.hyc-ua__greeting{font-size:0.82rem;color:#6F6A66;margin:0}',
      '.hyc-ua__name{font-size:1.15rem;font-weight:700;color:#0F0F0F;margin:2px 0 0}',

      // ── Pass cards ──────────────────────────────────────────────
      '.hyc-ua__section{margin-bottom:20px}',
      '.hyc-ua__section-label{font-size:0.7rem;font-weight:700;color:#6F6A66;text-transform:uppercase;letter-spacing:.06em;margin:0 0 8px}',
      '.hyc-ua__pass{background:linear-gradient(135deg,' + BRAND_LIGHT + ',#FFFCF9);border:1.5px solid ' + BRAND + ';border-radius:12px;padding:14px 16px;margin-bottom:8px}',
      '.hyc-ua__pass-name{font-weight:700;color:#0F0F0F;font-size:0.9rem;margin:0 0 6px}',
      '.hyc-ua__pass-stats{display:flex;flex-wrap:wrap;gap:12px;font-size:0.82rem;color:#6F6A66}',
      '.hyc-ua__pass-stat strong{color:' + BRAND + ';font-weight:700}',
      '.hyc-ua__pass-stat--low{color:#c0392b}',
      '.hyc-ua__no-pass{background:#F5F3F0;border:1.5px dashed #E8E4E0;border-radius:12px;padding:20px;text-align:center;color:#6F6A66;font-size:0.88rem;line-height:1.5}',

      // ── Quick actions ───────────────────────────────────────────
      '.hyc-ua__actions{display:flex;flex-direction:column;gap:8px;margin-bottom:20px}',
      '.hyc-ua__action{display:flex;align-items:center;gap:12px;padding:12px 16px;background:#fff;border:1.5px solid #E8E4E0;border-radius:12px;text-decoration:none;color:#0F0F0F;cursor:pointer;transition:all .15s;font-family:inherit;font-size:0.88rem;font-weight:600;width:100%;text-align:left}',
      '.hyc-ua__action:hover{border-color:' + BRAND + ';background:' + BRAND_LIGHT + ';color:' + BRAND + '}',
      '.hyc-ua__action svg{width:18px;height:18px;color:' + BRAND + ';flex-shrink:0}',
      '.hyc-ua__action-text{flex:1}',
      '.hyc-ua__action-arrow{color:#E8E4E0;font-size:1.1rem;transition:color .15s}',
      '.hyc-ua__action:hover .hyc-ua__action-arrow{color:' + BRAND + '}',

      // ── Divider ─────────────────────────────────────────────────
      '.hyc-ua__divider{border:none;border-top:1px solid #E8E4E0;margin:0 0 20px}',

      // ── Logout button ───────────────────────────────────────────
      '.hyc-ua__logout{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;padding:10px;background:none;border:1.5px solid #E8E4E0;border-radius:12px;color:#6F6A66;font-family:inherit;font-size:0.82rem;font-weight:600;cursor:pointer;transition:all .15s}',
      '.hyc-ua__logout:hover{color:#c0392b;border-color:#c0392b;background:#fef5f5}',
      '.hyc-ua__logout svg{width:16px;height:16px}',

      // ── Loading spinner ─────────────────────────────────────────
      '.hyc-ua__spinner{width:16px;height:16px;border:2px solid #E8E4E0;border-top-color:' + BRAND + ';border-radius:50%;animation:hyc-ua-spin .7s linear infinite;display:inline-block}',
      '@keyframes hyc-ua-spin{to{transform:rotate(360deg)}}',
      '.hyc-ua__loading{display:flex;align-items:center;justify-content:center;gap:8px;padding:24px 0;color:#6F6A66;font-size:0.85rem}',

      // ── Profile link ────────────────────────────────────────────
      '.hyc-ua__profile-link{display:block;text-align:center;margin-top:12px;font-size:0.78rem;color:#6F6A66}',
      '.hyc-ua__profile-link a{color:' + BRAND + ';text-decoration:none;font-weight:600}',
      '.hyc-ua__profile-link a:hover{text-decoration:underline}',

      // ── Responsive ──────────────────────────────────────────────
      '@media (max-width:480px){',
        '.hyc-cta__btn{font-size:0.82rem;padding:0.5rem 1rem}',
        '.hyc-ua__box{padding:24px 20px 20px;border-radius:16px;max-height:95vh}',
        '.hyc-ua{padding:8px}',
        '.hyc-ua__header{gap:10px}',
        '.hyc-ua__avatar{width:40px;height:40px;font-size:1rem}',
        '.hyc-ua__name{font-size:1.05rem}',
        '.hyc-ua__action{padding:10px 14px;font-size:0.82rem}',
      '}',
      '@media (max-width:360px){',
        '.hyc-ua__box{padding:20px 16px 16px}',
        '.hyc-ua__pass{padding:12px 14px}',
        '.hyc-ua__pass-stats{gap:8px;font-size:0.78rem}',
      '}'

    ].join('\n');
    document.head.appendChild(s);
  }

  // ── Modal management ────────────────────────────────────────────────
  var modalEl = null;

  function createModal() {
    if (modalEl) return;
    modalEl = document.createElement('div');
    modalEl.className = 'hyc-ua';
    modalEl.id = 'hyc-ua-modal';
    modalEl.setAttribute('aria-hidden', 'true');
    modalEl.setAttribute('role', 'dialog');
    modalEl.setAttribute('aria-label', t('Brugerområde', 'User Area'));
    modalEl.innerHTML =
      '<div class="hyc-ua__overlay"></div>' +
      '<div class="hyc-ua__box">' +
        '<button class="hyc-ua__close" type="button" aria-label="' + t('Luk', 'Close') + '">' + ICON.close + '</button>' +
        '<div id="hyc-ua-content"></div>' +
      '</div>';
    document.body.appendChild(modalEl);

    // Close on overlay click
    modalEl.querySelector('.hyc-ua__overlay').addEventListener('click', closeModal);
    // Close on X click
    modalEl.querySelector('.hyc-ua__close').addEventListener('click', closeModal);
    // Close on Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modalEl && modalEl.getAttribute('aria-hidden') === 'false') {
        closeModal();
      }
    });
  }

  function openModal() {
    if (!modalEl) createModal();
    modalEl.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    renderUserArea();
  }

  function closeModal() {
    if (!modalEl) return;
    modalEl.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  // ── Render user area inside modal ───────────────────────────────────
  function renderUserArea() {
    var contentEl = document.getElementById('hyc-ua-content');
    if (!contentEl || !currentUser) return;

    var firstName = '';
    var fullName = '';
    if (currentUser.displayName) {
      var parts = currentUser.displayName.split(' ');
      firstName = parts[0];
      fullName = currentUser.displayName;
    }
    var initial = (firstName || currentUser.email || '?')[0].toUpperCase();

    var html = '';

    // ── Header with avatar + greeting
    html += '<div class="hyc-ua__header">';
    html += '<div class="hyc-ua__avatar">' + esc(initial) + '</div>';
    html += '<div>';
    html += '<p class="hyc-ua__greeting">' + t('Velkommen tilbage', 'Welcome back') + '</p>';
    html += '<p class="hyc-ua__name">' + esc(firstName || currentUser.email) + '</p>';
    html += '</div>';
    html += '</div>';

    // ── Pass section (loading state initially)
    html += '<div class="hyc-ua__section" id="hyc-ua-passes">';
    html += '<p class="hyc-ua__section-label">' + t('Dine aktive pas', 'Your active passes') + '</p>';
    html += '<div class="hyc-ua__loading">' + ICON.spinner + ' ' + t('Henter pas...', 'Loading passes...') + '</div>';
    html += '</div>';

    // ── Quick actions
    html += '<div class="hyc-ua__actions">';

    // Book classes — scroll to schedule on page
    html += '<button class="hyc-ua__action" type="button" id="hyc-ua-book">';
    html += ICON.calendar;
    html += '<span class="hyc-ua__action-text">' + t('Book klasser', 'Book classes') + '</span>';
    html += '<span class="hyc-ua__action-arrow">&rsaquo;</span>';
    html += '</button>';

    // Buy pass — opens checkout
    html += '<button class="hyc-ua__action" type="button" id="hyc-ua-buy">';
    html += ICON.cart;
    html += '<span class="hyc-ua__action-text">' + t('Køb pas', 'Buy a pass') + '</span>';
    html += '<span class="hyc-ua__action-arrow">&rsaquo;</span>';
    html += '</button>';

    // Full profile — link to profile site
    html += '<a class="hyc-ua__action" href="' + PROFILE_URL + '/#passes" target="_blank">';
    html += ICON.external;
    html += '<span class="hyc-ua__action-text">' + t('Fuld profil & indstillinger', 'Full profile & settings') + '</span>';
    html += '<span class="hyc-ua__action-arrow">&rsaquo;</span>';
    html += '</a>';

    html += '</div>';

    // ── Divider + Logout
    html += '<hr class="hyc-ua__divider">';
    html += '<button class="hyc-ua__logout" type="button" id="hyc-ua-logout">';
    html += ICON.logout + ' ' + t('Log ud', 'Log out');
    html += '</button>';

    contentEl.innerHTML = html;

    // ── Wire actions
    var bookBtn = document.getElementById('hyc-ua-book');
    if (bookBtn) {
      bookBtn.addEventListener('click', function () {
        closeModal();
        // Scroll to schedule embed on page
        var scheduleEl = document.getElementById('hyc-schedule');
        if (scheduleEl) {
          scheduleEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    }

    var buyBtn = document.getElementById('hyc-ua-buy');
    if (buyBtn) {
      buyBtn.addEventListener('click', function () {
        closeModal();
        if (typeof window.openCheckoutFlow === 'function') {
          window.openCheckoutFlow('100017'); // default 1-class clip
        } else {
          window.open(PROFILE_URL + '/#store', '_blank');
        }
      });
    }

    var logoutBtn = document.getElementById('hyc-ua-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function () {
        try { firebase.auth().signOut(); } catch (e) { /* ignore */ }
        closeModal();
      });
    }

    // ── Load passes async
    loadPasses();
  }

  // ── Load passes from API ────────────────────────────────────────────
  function loadPasses() {
    var passesEl = document.getElementById('hyc-ua-passes');
    if (!passesEl || !mbClientId) {
      if (passesEl) renderPasses(passesEl, null);
      return;
    }

    if (passData) {
      renderPasses(passesEl, passData);
      return;
    }

    fetch(API_BASE + '/mb-client-services?clientId=' + mbClientId)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        passData = data;
        renderPasses(passesEl, data);
      })
      .catch(function () {
        renderPasses(passesEl, null);
      });
  }

  function renderPasses(el, data) {
    var services = (data && data.activeServices) || [];
    var contracts = (data && data.activeContracts) || [];
    var hasActive = services.length > 0 || contracts.length > 0;

    var html = '<p class="hyc-ua__section-label">' + t('Dine aktive pas', 'Your active passes') + '</p>';

    if (!hasActive) {
      html += '<div class="hyc-ua__no-pass">';
      html += '<p style="margin:0 0 4px;font-weight:700;color:#0F0F0F">' + t('Ingen aktive pas', 'No active passes') + '</p>';
      html += '<p style="margin:0;font-size:0.82rem">' + t('Køb et pas for at booke klasser.', 'Buy a pass to book classes.') + '</p>';
      html += '</div>';
      el.innerHTML = html;
      return;
    }

    services.forEach(function (s) {
      html += '<div class="hyc-ua__pass">';
      html += '<p class="hyc-ua__pass-name">' + esc(s.name) + '</p>';
      html += '<div class="hyc-ua__pass-stats">';
      if (s.remaining != null) {
        var lowClass = (s.remaining > 0 && s.remaining < 3) ? ' hyc-ua__pass-stat--low' : '';
        html += '<span class="hyc-ua__pass-stat' + lowClass + '"><strong>' + s.remaining + '</strong> ' + t('klip tilbage', 'sessions left') + '</span>';
      }
      if (s.expirationDate) {
        var exp = new Date(s.expirationDate);
        html += '<span class="hyc-ua__pass-stat">' + t('Udløber', 'Expires') + ' ' + exp.toLocaleDateString(isDa ? 'da-DK' : 'en-GB', { day: 'numeric', month: 'short' }) + '</span>';
      }
      html += '</div></div>';
    });

    contracts.forEach(function (c) {
      html += '<div class="hyc-ua__pass">';
      html += '<p class="hyc-ua__pass-name">' + esc(c.name) + '</p>';
      html += '<div class="hyc-ua__pass-stats">';
      html += '<span class="hyc-ua__pass-stat">' + ICON.check + ' ' + t('Aktivt medlemskab', 'Active membership') + '</span>';
      if (c.endDate) {
        html += '<span class="hyc-ua__pass-stat">' + t('Fornyes', 'Renews') + ' ' + new Date(c.endDate).toLocaleDateString(isDa ? 'da-DK' : 'en-GB', { day: 'numeric', month: 'short' }) + '</span>';
      }
      html += '</div></div>';
    });

    el.innerHTML = html;
  }

  // ── CTA button renders ──────────────────────────────────────────────
  function renderLoggedOut() {
    if (!container) return;
    container.innerHTML =
      '<button class="hyc-cta__btn hyc-cta__btn--login" type="button" id="hyc-cta-login">' +
        ICON.login + t('Log ind', 'Login') +
      '</button>';

    document.getElementById('hyc-cta-login').addEventListener('click', function () {
      if (typeof window.openLoginModal === 'function') {
        window.openLoginModal(function () {
          // callback after successful login — modal handles it
        });
      } else {
        window.location.href = PROFILE_URL;
      }
    });
  }

  function renderLoggedIn(user) {
    if (!container) return;

    container.innerHTML =
      '<button class="hyc-cta__btn hyc-cta__btn--user" type="button" id="hyc-cta-user">' +
        ICON.profile + t('Min profil', 'My Profile') +
      '</button>';

    document.getElementById('hyc-cta-user').addEventListener('click', function () {
      openModal();
    });
  }

  // ── Auth listener ───────────────────────────────────────────────────
  function initAuth() {
    var poll = setInterval(function () {
      if (typeof firebase !== 'undefined' && firebase.auth) {
        clearInterval(poll);
        firebase.auth().onAuthStateChanged(function (user) {
          currentUser = user;
          if (user) {
            // Resolve Mindbody client ID from Firestore
            resolveMbClient(user);
            renderLoggedIn(user);
          } else {
            mbClientId = null;
            passData = null;
            renderLoggedOut();
            // Close user area modal if open
            if (modalEl && modalEl.getAttribute('aria-hidden') === 'false') {
              closeModal();
            }
          }
        });
      }
    }, 200);

    // Timeout: if Firebase never loads, just show login
    setTimeout(function () {
      clearInterval(poll);
      if (container && !container.querySelector('.hyc-cta__btn')) {
        renderLoggedOut();
      }
    }, 5000);
  }

  function resolveMbClient(user) {
    if (typeof firebase === 'undefined' || !firebase.firestore) return;
    firebase.firestore().collection('users').doc(user.uid).get()
      .then(function (doc) {
        if (doc.exists && doc.data().mindbodyClientId) {
          mbClientId = doc.data().mindbodyClientId;
        }
      })
      .catch(function () {});
  }

  // ── Boot ────────────────────────────────────────────────────────────
  function boot() {
    injectCSS();
    container = document.getElementById('hyc-login-cta');
    if (!container) return;
    container.className = 'hyc-cta';
    renderLoggedOut();
    initAuth();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
