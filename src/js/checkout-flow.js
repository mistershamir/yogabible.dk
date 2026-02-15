// =========================================================================
// checkout-flow.js — Unified multi-step checkout modal
// Flow: CTA → Login/Register → Product + Payment → Success → Profile
// =========================================================================
(function () {
  'use strict';

  var API_BASE = '/.netlify/functions';
  var isDa = window.location.pathname.indexOf('/en/') !== 0;

  // ── Product catalog (mirrors profile.js storeCatalog for CTA-purchasable items) ──
  var PRODUCTS = {
    // Teacher Training — Preparation Phase
    '100078': { price: 3750, name_da: '18 Ugers Fleksibelt Program', name_en: '18-Week Flexible Program', period_da: 'Marts–Juni 2026', period_en: 'March–June 2026', format_da: '200-timers komplet uddannelse', format_en: '200-hour complete education', desc_da: 'Start din forberedelsesfase for det 18-ugers fleksible yogalæreruddannelsesprogram.', desc_en: 'Begin your Preparation Phase for the 18-week flexible yoga teacher training program.', category: 'teacher' },
    '100121': { price: 3750, name_da: '4 Ugers Intensiv', name_en: '4-Week Intensive', period_da: 'April 2026', period_en: 'April 2026', format_da: '200-timers komplet uddannelse', format_en: '200-hour complete education', desc_da: 'Start din forberedelsesfase for det intensive 4-ugers program. Fuld fordybelse og hurtig transformation.', desc_en: 'Begin your Preparation Phase for the intensive 4-week program. Full immersion and rapid transformation.', category: 'teacher' },
    '100211': { price: 3750, name_da: '4 Ugers Intensiv', name_en: '4-Week Intensive', period_da: 'Juli 2026', period_en: 'July 2026', format_da: '200-timers komplet uddannelse', format_en: '200-hour complete education', desc_da: 'Start din forberedelsesfase for sommerens 4-ugers intensive program.', desc_en: 'Begin your Preparation Phase for the summer 4-week intensive program.', category: 'teacher' },
    '100209': { price: 3750, name_da: '8 Ugers Semi-Intensiv', name_en: '8-Week Semi-Intensive', period_da: 'Maj–Juni 2026', period_en: 'May–June 2026', format_da: '200-timers komplet uddannelse', format_en: '200-hour complete education', desc_da: 'Start din forberedelsesfase for det 8-ugers semi-intensive program.', desc_en: 'Begin your Preparation Phase for the 8-week semi-intensive program.', category: 'teacher' },
    '100210': { price: 3750, name_da: '18 Ugers Fleksibelt Program', name_en: '18-Week Flexible Program', period_da: 'August–December 2026', period_en: 'August–December 2026', format_da: '200-timers komplet uddannelse', format_en: '200-hour complete education', desc_da: 'Start din forberedelsesfase for det 18-ugers fleksible program.', desc_en: 'Begin your Preparation Phase for the 18-week flexible program.', category: 'teacher' },
    // Courses
    '100145': { price: 2300, name_da: 'Inversions Kursus', name_en: 'Inversions Course', period_da: 'April 2026', period_en: 'April 2026', desc_da: 'Mester armbalancer og omvendinger med sikker teknik og gradvis progression.', desc_en: 'Master arm balances and inversions with safe technique and gradual progression.', category: 'courses' },
    '100150': { price: 2300, name_da: 'Splits Kursus', name_en: 'Splits Course', period_da: 'April 2026', period_en: 'April 2026', desc_da: 'Opnå fuld splits med systematisk fleksibilitetstræning og sikre stræk.', desc_en: 'Achieve full splits with systematic flexibility training and safe stretching.', category: 'courses' },
    '100140': { price: 2300, name_da: 'Backbends Kursus', name_en: 'Backbends Course', period_da: 'April 2026', period_en: 'April 2026', desc_da: 'Åbn brystkasse og rygsøjle med trygge, dybe bagoverbøjninger.', desc_en: 'Open chest and spine with safe, deep backbending practice.', category: 'courses' }
  };

  // Remaining payment note (for teacher training)
  var REMAINING_NOTE = {
    da: 'Restbeløbet afregnes inden uddannelsesstart — enten som engangsbeløb eller i rater. Din uddannelsesleder vil kontakte dig med alle detaljer og næste skridt.',
    en: 'The remaining balance is settled before training starts — either in full or in instalments. Your course director will be in touch with all the details and next steps.'
  };

  // ── State ──
  var currentProdId = null;
  var currentStep = 1;
  var modal = null;
  var scrollY = 0;

  // ── Helpers ──
  function t(da, en) { return isDa ? da : en; }

  function getProduct(prodId) { return PRODUCTS[prodId] || null; }

  function $(id) { return document.getElementById(id); }

  function showError(elId, msg) {
    var el = $(elId);
    if (el) { el.textContent = msg; el.hidden = false; }
  }

  function hideError(elId) {
    var el = $(elId);
    if (el) { el.textContent = ''; el.hidden = true; }
  }

  // ── Modal open/close ──
  function openModal() {
    modal = $('ycf-modal');
    if (!modal) return;

    scrollY = window.scrollY;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
      document.body.style.top = '-' + scrollY + 'px';
    }
    modal.setAttribute('aria-hidden', 'false');
  }

  function closeModal() {
    if (!modal) return;
    modal.setAttribute('aria-hidden', 'true');
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.width = '';
    document.body.style.top = '';
    window.scrollTo(0, scrollY);
    currentProdId = null;
  }

  // ── Step navigation ──
  function showStep(stepId) {
    if (!modal) return;
    modal.querySelectorAll('.ycf-step').forEach(function (s) { s.hidden = true; });
    var target = $(stepId);
    if (target) {
      target.hidden = false;
      // Update step dots
      var stepNum = parseInt(target.getAttribute('data-ycf-step')) || 1;
      currentStep = stepNum;
      modal.querySelectorAll('.ycf-steps__dot').forEach(function (dot) {
        var dotStep = parseInt(dot.getAttribute('data-ycf-step-dot')) || 0;
        dot.classList.toggle('ycf-steps__dot--active', dotStep <= stepNum);
      });
      // Focus first input
      setTimeout(function () {
        var firstInput = target.querySelector('input:not([type="hidden"]):not([type="checkbox"])');
        if (firstInput) firstInput.focus();
      }, 80);
    }
  }

  // ── Populate product info on checkout step ──
  function populateProduct(prodId) {
    var p = getProduct(prodId);
    if (!p) return;

    var name = isDa ? p.name_da : p.name_en;
    var price = p.price.toLocaleString('da-DK') + ' DKK';

    // Badge (shown on login step)
    var badgeName = $('ycf-badge-name');
    var badgePrice = $('ycf-badge-price');
    if (badgeName) badgeName.textContent = name;
    if (badgePrice) badgePrice.textContent = price;

    // Checkout step product card
    var prodName = $('ycf-prod-name');
    var prodPrice = $('ycf-prod-price');
    var prodDesc = $('ycf-prod-desc');
    var prodChips = $('ycf-prod-chips');
    var prodNote = $('ycf-prod-note');
    var prodNoteText = $('ycf-prod-note-text');

    if (prodName) prodName.textContent = name;
    if (prodPrice) prodPrice.textContent = price;
    if (prodDesc) prodDesc.textContent = isDa ? p.desc_da : p.desc_en;

    // Chips
    if (prodChips) {
      var chips = '';
      if (p.category === 'teacher') {
        chips += '<span class="ycf-chip ycf-chip--brand">' + t('Forberedelsesfasen', 'Preparation Phase') + '</span>';
      }
      if (p.period_da) {
        chips += '<span class="ycf-chip">' + (isDa ? p.period_da : p.period_en) + '</span>';
      }
      if (p.format_da) {
        chips += '<span class="ycf-chip ycf-chip--muted">' + (isDa ? p.format_da : p.format_en) + '</span>';
      }
      prodChips.innerHTML = chips;
    }

    // Remaining payment note (teacher training only)
    if (prodNote && prodNoteText && p.category === 'teacher') {
      prodNoteText.textContent = isDa ? REMAINING_NOTE.da : REMAINING_NOTE.en;
      prodNote.hidden = false;
    } else if (prodNote) {
      prodNote.hidden = true;
    }
  }

  // ── Entry point: open the checkout flow ──
  function openCheckoutFlow(prodId) {
    if (!prodId) return;
    currentProdId = prodId;

    modal = $('ycf-modal');
    if (!modal) return;

    // Reset all forms
    modal.querySelectorAll('input').forEach(function (input) {
      if (input.type === 'checkbox') input.checked = false;
      else if (input.type !== 'hidden') input.value = '';
    });
    modal.querySelectorAll('.yb-auth-error, .yb-auth-success').forEach(function (el) {
      el.textContent = '';
      el.hidden = true;
    });

    // Populate product info
    populateProduct(prodId);

    // Check if user is already logged in → skip to checkout
    var user = null;
    try { user = firebase.auth().currentUser; } catch (e) { /* not ready */ }

    if (user) {
      showStep('ycf-step-checkout');
    } else {
      showStep('ycf-step-login');
    }

    openModal();
  }

  // ── Firebase auth helpers ──
  function doLogin(email, password, callback) {
    firebase.auth().signInWithEmailAndPassword(email, password)
      .then(function () { callback(null); })
      .catch(function (err) { callback(err); });
  }

  function doRegister(email, password, firstName, lastName, phone, callback) {
    firebase.auth().createUserWithEmailAndPassword(email, password)
      .then(function (cred) {
        var fullName = firstName + ' ' + lastName;
        // Store registration data for profile creation (firebase-auth.js picks this up)
        window._ybRegistration = {
          firstName: firstName,
          lastName: lastName,
          phone: phone,
          consents: {
            terms: true,
            conduct: true,
            timestamp: new Date().toISOString()
          }
        };
        return cred.user.updateProfile({ displayName: fullName });
      })
      .then(function () { callback(null); })
      .catch(function (err) { callback(err); });
  }

  function doForgotPassword(email, callback) {
    firebase.auth().sendPasswordResetEmail(email)
      .then(function () { callback(null); })
      .catch(function (err) { callback(err); });
  }

  // ── Map Firebase error codes to friendly messages ──
  function authErrorMsg(err) {
    var code = err.code || '';
    if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
      return t('Forkert email eller adgangskode.', 'Incorrect email or password.');
    }
    if (code === 'auth/email-already-in-use') {
      return t('Denne email er allerede i brug.', 'This email is already in use.');
    }
    if (code === 'auth/weak-password') {
      return t('Adgangskoden skal være mindst 6 tegn.', 'Password must be at least 6 characters.');
    }
    if (code === 'auth/invalid-email') {
      return t('Ugyldig email-adresse.', 'Invalid email address.');
    }
    if (code === 'auth/too-many-requests') {
      return t('For mange forsøg. Prøv igen senere.', 'Too many attempts. Please try again later.');
    }
    return err.message || t('Der opstod en fejl.', 'An error occurred.');
  }

  // ── Mindbody client lookup/create ──
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
          throw new Error(t('Kunne ikke oprette kundekonto.', 'Could not create client account.'));
        });
      });
  }

  // ── Process payment ──
  function processPayment() {
    var user = firebase.auth().currentUser;
    if (!user) return;

    var product = getProduct(currentProdId);
    if (!product) return;

    var cardNumber = $('ycf-card').value.replace(/\s/g, '');
    var expiry = $('ycf-expiry').value.trim();
    var cvv = $('ycf-cvv').value.trim();

    hideError('ycf-checkout-error');

    // Validate
    if (!cardNumber || !expiry || !cvv) {
      showError('ycf-checkout-error', t('Udfyld alle obligatoriske felter.', 'Please fill in all required fields.'));
      return;
    }

    var expiryParts = expiry.split('/');
    if (expiryParts.length !== 2) {
      showError('ycf-checkout-error', t('Ugyldig udløbsdato (MM/ÅÅ).', 'Invalid expiry date (MM/YY).'));
      return;
    }
    var expMonth = expiryParts[0].trim();
    var expYear = expiryParts[1].trim();
    if (expYear.length === 2) expYear = '20' + expYear;

    // Disable button
    var payBtn = $('ycf-pay-btn');
    var payBtnEn = $('ycf-pay-btn-en');
    if (payBtn) { payBtn.disabled = true; payBtn.textContent = 'Behandler betaling...'; }
    if (payBtnEn) { payBtnEn.disabled = true; payBtnEn.textContent = 'Processing payment...'; }

    var displayName = user.displayName || '';
    var nameParts = displayName.split(' ');
    var firstName = nameParts[0] || 'User';
    var lastName = nameParts.slice(1).join(' ') || '';
    var email = user.email || '';
    var phone = (window._ybRegistration && window._ybRegistration.phone) || '';

    findOrCreateClient(firstName, lastName, email, phone)
      .then(function (clientId) {
        // Track checkout opened
        if (window.CheckoutFunnel) window.CheckoutFunnel.trackCheckoutOpened();

        return fetch(API_BASE + '/mb-checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: clientId,
            items: [{ type: 'Service', id: parseInt(currentProdId), quantity: 1 }],
            amount: product.price,
            payment: {
              cardNumber: cardNumber,
              expMonth: expMonth,
              expYear: expYear,
              cvv: cvv,
              cardHolder: displayName
            },
            test: false
          })
        });
      })
      .then(function (res) { return res.json(); })
      .then(function (result) {
        if (result.error) throw new Error(result.error);

        if (result.requiresSCA) {
          window.location.href = result.authenticationUrl;
          return;
        }

        // Track purchase
        if (window.CheckoutFunnel) window.CheckoutFunnel.trackPurchased();

        // Show success
        showStep('ycf-step-success');
      })
      .catch(function (err) {
        showError('ycf-checkout-error', err.message || t('Betaling fejlede.', 'Payment failed.'));
        if (payBtn) { payBtn.disabled = false; payBtn.textContent = 'Betal'; }
        if (payBtnEn) { payBtnEn.disabled = false; payBtnEn.textContent = 'Pay'; }
      });
  }

  // ── Get profile path ──
  function getProfilePath() {
    return isDa ? '/profile' : '/en/profile';
  }

  // =========================================================================
  // EVENT HANDLERS
  // =========================================================================

  function init() {
    modal = $('ycf-modal');
    if (!modal) return;

    // Close handlers
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-ycf-close]')) {
        e.preventDefault();
        closeModal();
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal && modal.getAttribute('aria-hidden') === 'false') {
        closeModal();
      }
    });

    // Action links (register, forgot, back-login)
    document.addEventListener('click', function (e) {
      var actionEl = e.target.closest('[data-ycf-action]');
      if (!actionEl) return;
      e.preventDefault();
      var action = actionEl.getAttribute('data-ycf-action');
      if (action === 'register') showStep('ycf-step-register');
      if (action === 'forgot') showStep('ycf-step-forgot');
      if (action === 'back-login') showStep('ycf-step-login');
    });

    // ── Login form ──
    var loginForm = $('ycf-login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', function (e) {
        e.preventDefault();
        hideError('ycf-login-error');

        var email = $('ycf-login-email').value.trim();
        var password = $('ycf-login-password').value;

        if (!email || !password) {
          showError('ycf-login-error', t('Udfyld alle felter.', 'Please fill in all fields.'));
          return;
        }

        var btn = loginForm.querySelector('.yb-auth-submit');
        if (btn) { btn.disabled = true; btn.textContent = isDa ? 'Logger ind...' : 'Signing in...'; }

        doLogin(email, password, function (err) {
          if (err) {
            showError('ycf-login-error', authErrorMsg(err));
            if (btn) { btn.disabled = false; btn.textContent = isDa ? 'Log ind' : 'Sign in'; }
            return;
          }
          // Track auth
          if (window.CheckoutFunnel) window.CheckoutFunnel.trackAuthComplete();
          // Advance to checkout
          showStep('ycf-step-checkout');
          if (btn) { btn.disabled = false; btn.textContent = isDa ? 'Log ind' : 'Sign in'; }
        });
      });
    }

    // ── Forgot password form ──
    var forgotForm = $('ycf-forgot-form');
    if (forgotForm) {
      forgotForm.addEventListener('submit', function (e) {
        e.preventDefault();
        hideError('ycf-forgot-error');
        var successEl = $('ycf-forgot-success');
        if (successEl) successEl.hidden = true;

        var email = $('ycf-forgot-email').value.trim();
        if (!email) {
          showError('ycf-forgot-error', t('Indtast din email.', 'Please enter your email.'));
          return;
        }

        doForgotPassword(email, function (err) {
          if (err) {
            showError('ycf-forgot-error', authErrorMsg(err));
            return;
          }
          if (successEl) {
            successEl.textContent = t(
              'Vi har sendt dig et link til at nulstille din adgangskode.',
              'We\'ve sent you a link to reset your password.'
            );
            successEl.hidden = false;
          }
        });
      });
    }

    // ── Register form ──
    var registerForm = $('ycf-register-form');
    if (registerForm) {
      registerForm.addEventListener('submit', function (e) {
        e.preventDefault();
        hideError('ycf-register-error');

        var firstName = $('ycf-reg-firstname').value.trim();
        var lastName = $('ycf-reg-lastname').value.trim();
        var email = $('ycf-reg-email').value.trim();
        var phone = $('ycf-reg-phone').value.trim();
        var password = $('ycf-reg-password').value;
        var terms = $('ycf-reg-terms').checked;
        var conduct = $('ycf-reg-conduct').checked;

        if (!firstName || !lastName || !email || !password) {
          showError('ycf-register-error', t('Udfyld alle obligatoriske felter.', 'Please fill in all required fields.'));
          return;
        }
        if (password.length < 6) {
          showError('ycf-register-error', t('Adgangskoden skal være mindst 6 tegn.', 'Password must be at least 6 characters.'));
          return;
        }
        if (!terms || !conduct) {
          showError('ycf-register-error', t('Du skal acceptere betingelserne.', 'You must accept the terms.'));
          return;
        }

        var btn = registerForm.querySelector('.yb-auth-submit');
        if (btn) { btn.disabled = true; btn.textContent = isDa ? 'Opretter profil...' : 'Creating profile...'; }

        doRegister(email, password, firstName, lastName, phone, function (err) {
          if (err) {
            showError('ycf-register-error', authErrorMsg(err));
            if (btn) { btn.disabled = false; btn.textContent = isDa ? 'Opret profil & fortsæt' : 'Create profile & continue'; }
            return;
          }

          // Track auth + profile
          if (window.CheckoutFunnel) {
            window.CheckoutFunnel.trackAuthComplete();
            window.CheckoutFunnel.trackProfileComplete({ firstName: firstName, lastName: lastName, phone: phone });
          }

          // Advance to checkout
          showStep('ycf-step-checkout');
          if (btn) { btn.disabled = false; btn.textContent = isDa ? 'Opret profil & fortsæt' : 'Create profile & continue'; }
        });
      });
    }

    // ── Checkout form ──
    var checkoutForm = $('ycf-checkout-form');
    if (checkoutForm) {
      checkoutForm.addEventListener('submit', function (e) {
        e.preventDefault();
        processPayment();
      });
    }

    // ── Go to profile button ──
    document.addEventListener('click', function (e) {
      if (e.target.id === 'ycf-go-profile' || e.target.id === 'ycf-go-profile-en') {
        e.preventDefault();
        closeModal();
        window.location.href = getProfilePath() + '#passes';
      }
    });

    // ── Card number formatting (add spaces every 4 digits) ──
    var cardInput = $('ycf-card');
    if (cardInput) {
      cardInput.addEventListener('input', function () {
        var v = cardInput.value.replace(/\s/g, '').replace(/\D/g, '');
        cardInput.value = v.replace(/(.{4})/g, '$1 ').trim();
      });
    }

    // ── Expiry formatting (auto-add slash) ──
    var expiryInput = $('ycf-expiry');
    if (expiryInput) {
      expiryInput.addEventListener('input', function () {
        var v = expiryInput.value.replace(/\D/g, '');
        if (v.length >= 2) v = v.slice(0, 2) + '/' + v.slice(2);
        expiryInput.value = v.slice(0, 5);
      });
    }
  }

  // =========================================================================
  // INIT
  // =========================================================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ── Public API ──
  window.openCheckoutFlow = openCheckoutFlow;
  window.closeCheckoutFlow = closeModal;

})();
