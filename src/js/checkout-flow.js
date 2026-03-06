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
    '100121': { price: 3750, name_da: '4 Ugers Complete Program', name_en: '4-Week Complete Program', period_da: 'April 2026', period_en: 'April 2026', format_da: '200-timers komplet uddannelse · Multi-Style', format_en: '200-hour complete education · Multi-Style', desc_da: 'Start din forberedelsesfase for det intensive 4-ugers Complete Program. Hatha, Vinyasa, Yin, Hot Yoga og Meditation.', desc_en: 'Begin your Preparation Phase for the intensive 4-week Complete Program. Hatha, Vinyasa, Yin, Hot Yoga, and Meditation.', category: 'teacher' },
    '100211': { price: 3750, name_da: '4 Ugers Vinyasa Plus', name_en: '4-Week Vinyasa Plus', period_da: 'Juli 2026', period_en: 'July 2026', format_da: '200-timers uddannelse · 70% Vinyasa · 30% Yin + Hot Yoga', format_en: '200-hour training · 70% Vinyasa · 30% Yin + Hot Yoga', desc_da: 'Start din forberedelsesfase for sommerens Vinyasa Plus program. Kreativ sekvensering, klasseledelse og undervisning i opvarmet og ikke-opvarmet Vinyasa samt Yin Yoga.', desc_en: 'Begin your Preparation Phase for the summer Vinyasa Plus program. Creative sequencing, class management, and teaching heated and non-heated Vinyasa plus Yin Yoga.', category: 'teacher' },
    '100209': { price: 3750, name_da: '8 Ugers Semi-Intensiv', name_en: '8-Week Semi-Intensive', period_da: 'Maj–Juni 2026', period_en: 'May–June 2026', format_da: '200-timers komplet uddannelse', format_en: '200-hour complete education', desc_da: 'Start din forberedelsesfase for det 8-ugers semi-intensive program.', desc_en: 'Begin your Preparation Phase for the 8-week semi-intensive program.', category: 'teacher' },
    '100210': { price: 3750, name_da: '18 Ugers Fleksibelt Program', name_en: '18-Week Flexible Program', period_da: 'August–December 2026', period_en: 'August–December 2026', format_da: '200-timers komplet uddannelse', format_en: '200-hour complete education', desc_da: 'Start din forberedelsesfase for det 18-ugers fleksible program.', desc_en: 'Begin your Preparation Phase for the 18-week flexible program.', category: 'teacher' },
    // 300-Hour Advanced Teacher Training — Preparation Phase
    '100212': { price: 5750, name_da: '300-Timer Advanced Teacher Training', name_en: '300-Hour Advanced Teacher Training', period_da: 'Maj–December 2026', period_en: 'May–December 2026', format_da: '300-timers avanceret uddannelse · RYT-500', format_en: '300-hour advanced training · RYT-500', desc_da: 'Start din forberedelsesfase for den 300-timers avancerede yogalæreruddannelse. 24 uger, RYT-500 certificering.', desc_en: 'Begin your Preparation Phase for the 300-hour advanced yoga teacher training. 24 weeks, RYT-500 certification.', category: 'teacher' },
    // Courses
    '100145': { price: 2300, name_da: 'Inversions Kursus', name_en: 'Inversions Course', period_da: 'April 2026', period_en: 'April 2026', desc_da: 'Mestr armbalancer og inversioner med sikker teknik og gradvis progression.', desc_en: 'Master arm balances and inversions with safe technique and gradual progression.', category: 'courses' },
    '100150': { price: 2300, name_da: 'Splits Kursus', name_en: 'Splits Course', period_da: 'April 2026', period_en: 'April 2026', desc_da: 'Opnå fuld splits med systematisk fleksibilitetstræning og sikre stræk.', desc_en: 'Achieve full splits with systematic flexibility training and safe stretching.', category: 'courses' },
    '100140': { price: 2300, name_da: 'Backbends Kursus', name_en: 'Backbends Course', period_da: 'April 2026', period_en: 'April 2026', desc_da: 'Åbn brystkasse og rygsøjle med trygge, dybe bagoverbøjninger.', desc_en: 'Open chest and spine with safe, deep backbending practice.', category: 'courses' },
    // Course Bundles — April 2026
    '119': { price: 4140, name_da: 'Kursuspakke: Backbends + Inversions', name_en: 'Course Bundle: Backbends + Inversions', period_da: 'April 2026', period_en: 'April 2026', desc_da: '2-kursus pakke med 10% rabat. 16 workshops over 4 uger.', desc_en: '2-course bundle with 10% off. 16 workshops over 4 weeks.', category: 'bundle' },
    '120': { price: 4140, name_da: 'Kursuspakke: Inversions + Splits', name_en: 'Course Bundle: Inversions + Splits', period_da: 'April 2026', period_en: 'April 2026', desc_da: '2-kursus pakke med 10% rabat. 16 workshops over 4 uger.', desc_en: '2-course bundle with 10% off. 16 workshops over 4 weeks.', category: 'bundle' },
    '121': { price: 4140, name_da: 'Kursuspakke: Backbends + Splits', name_en: 'Course Bundle: Backbends + Splits', period_da: 'April 2026', period_en: 'April 2026', desc_da: '2-kursus pakke med 10% rabat. 16 workshops over 4 uger.', desc_en: '2-course bundle with 10% off. 16 workshops over 4 weeks.', category: 'bundle' },
    '127': { price: 5865, name_da: 'All-In Pakke: Inversions + Splits + Backbends', name_en: 'All-In Bundle: Inversions + Splits + Backbends', period_da: 'April 2026', period_en: 'April 2026', desc_da: 'Alle 3 kurser med 15% rabat + gratis 1-måneds pass. 24 workshops over 4 uger.', desc_en: 'All 3 courses with 15% off + free 1-month pass. 24 workshops over 4 weeks.', category: 'bundle' }
  };

  // Remaining payment note (for teacher training)
  var REMAINING_NOTE = {
    da: 'Restbeløbet afregnes inden uddannelsesstart — enten som engangsbeløb eller i rater. Din uddannelsesleder vil kontakte dig med alle detaljer og næste skridt.',
    en: 'The remaining balance is settled before training starts — either in full or in instalments. Your course director will be in touch with all the details and next steps.'
  };

  // Prep phase benefits (for teacher training)
  var PREP_BENEFITS = {
    da: [
      'Sikr din plads på programmet',
      'Start booking af klasser med det samme',
      'Klasser tæller med i dine træningstimer',
      'Forbered krop og sind — bliv en del af fællesskabet',
      'Inkluderet klasseadgang — spar på separat medlemskab'
    ],
    en: [
      'Secure your spot in the program',
      'Start booking classes immediately',
      'Classes count toward your training hours',
      'Prepare body and mind — join the community early',
      'Class access included — save on a separate membership'
    ]
  };

  // ── State ──
  var currentProdId = null;
  var currentStep = 1;
  var mbClientId = null;      // Mindbody client ID (resolved after auth)
  var storedCard = null;       // { lastFour, cardType, cardHolder, expMonth, expYear } or null
  var authOriginStep = null;   // 'login' or 'register' — where the user came from before checkout
  var cameFromLoggedIn = false; // true if user was already logged in when modal opened
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
    mbClientId = null;
    storedCard = null;
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
        var firstInput = target.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])');
        if (firstInput && !firstInput.closest('[hidden]')) firstInput.focus();
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
    var badgeCohort = $('ycf-badge-cohort');
    if (badgeName) badgeName.textContent = name;
    if (badgePrice) badgePrice.textContent = price;

    // Cohort / period chip
    if (badgeCohort) {
      var cohortParts = [];
      if (p.category === 'teacher') cohortParts.push(t('Forberedelsesfasen', 'Preparation Phase'));
      if (p.period_da) cohortParts.push(isDa ? p.period_da : p.period_en);
      if (p.format_da) cohortParts.push(isDa ? p.format_da : p.format_en);
      badgeCohort.textContent = cohortParts.join(' · ');
      badgeCohort.hidden = cohortParts.length === 0;
    }

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

    // Prep phase benefits (teacher training only)
    var prodBenefits = $('ycf-prod-benefits');
    if (prodBenefits && p.category === 'teacher') {
      var benefits = isDa ? PREP_BENEFITS.da : PREP_BENEFITS.en;
      prodBenefits.innerHTML = benefits.map(function (b) {
        return '<li><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg><span>' + b + '</span></li>';
      }).join('');
      prodBenefits.hidden = false;
    } else if (prodBenefits) {
      prodBenefits.hidden = true;
    }

    // Remaining payment note (teacher training only)
    if (prodNote && prodNoteText && p.category === 'teacher') {
      prodNoteText.textContent = isDa ? REMAINING_NOTE.da : REMAINING_NOTE.en;
      prodNote.hidden = false;
    } else if (prodNote) {
      prodNote.hidden = true;
    }
  }

  // =========================================================================
  // MINDBODY CLIENT — find/create + stored card
  // =========================================================================

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

  function fetchStoredCard(clientId) {
    return fetch(API_BASE + '/mb-client?action=storedCard&clientId=' + encodeURIComponent(clientId))
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.hasStoredCard && data.storedCard && data.storedCard.lastFour) {
          return data.storedCard;
        }
        return null;
      })
      .catch(function () { return null; });
  }

  // ── Render stored card UI in checkout step ──
  function renderStoredCardUI(card) {
    var section = $('ycf-stored-card-section');
    var newCardFields = $('ycf-new-card-fields');
    var cardInfo = $('ycf-stored-card-info');

    if (!section || !newCardFields) return;

    if (card && card.lastFour) {
      storedCard = card;
      // Show stored card option
      var cardLabel = (card.cardType || 'Card') + ' •••• ' + card.lastFour;
      if (card.expMonth && card.expYear) {
        cardLabel += ' (' + card.expMonth + '/' + String(card.expYear).slice(-2) + ')';
      }
      if (cardInfo) cardInfo.textContent = cardLabel;
      section.hidden = false;

      // Default to stored card — hide new card fields
      var storedRadio = section.querySelector('input[value="stored"]');
      if (storedRadio) storedRadio.checked = true;
      newCardFields.hidden = true;
      updatePaymentOptionStyles();
    } else {
      storedCard = null;
      section.hidden = true;
      newCardFields.hidden = false;
    }
  }

  function updatePaymentOptionStyles() {
    var section = $('ycf-stored-card-section');
    if (!section) return;
    section.querySelectorAll('.ycf-payment-option').forEach(function (opt) {
      var radio = opt.querySelector('input[type="radio"]');
      opt.classList.toggle('ycf-payment-option--active', radio && radio.checked);
    });
  }

  // =========================================================================
  // POST-AUTH: Resolve MB client + check stored card → advance to checkout
  // Called after both login and registration
  // =========================================================================
  function resolveClientAndAdvance(firstName, lastName, email, phone) {
    console.log('[Checkout Flow] Resolving MB client for:', email);

    findOrCreateClient(firstName, lastName, email, phone)
      .then(function (clientId) {
        mbClientId = clientId;
        console.log('[Checkout Flow] MB client resolved:', clientId);

        // Check for stored card (non-blocking — show checkout immediately, update UI when ready)
        fetchStoredCard(clientId).then(function (card) {
          renderStoredCardUI(card);
          console.log('[Checkout Flow] Stored card:', card ? ('•••• ' + card.lastFour) : 'none');
        });

        // Track checkout opened
        if (window.CheckoutFunnel) window.CheckoutFunnel.trackCheckoutOpened();

        // Advance to checkout step
        showStep('ycf-step-checkout');
      })
      .catch(function (err) {
        console.warn('[Checkout Flow] MB client error:', err.message);
        // Still advance — payment step will retry findOrCreateClient
        showStep('ycf-step-checkout');
      });
  }

  // =========================================================================
  // ENTRY POINT
  // =========================================================================
  function openCheckoutFlow(prodId) {
    if (!prodId) return;
    currentProdId = prodId;
    mbClientId = null;
    storedCard = null;

    modal = $('ycf-modal');
    if (!modal) return;

    // Reset all forms
    modal.querySelectorAll('input').forEach(function (input) {
      if (input.type === 'checkbox') input.checked = false;
      else if (input.type === 'radio') { /* handled by renderStoredCardUI */ }
      else if (input.type !== 'hidden') input.value = '';
    });
    modal.querySelectorAll('.yb-auth-error, .yb-auth-success').forEach(function (el) {
      el.textContent = '';
      el.hidden = true;
    });

    // Reset stored card UI
    renderStoredCardUI(null);

    // Populate product info
    populateProduct(prodId);

    // Check if user is already logged in → resolve client + skip to checkout
    var user = null;
    try { user = firebase.auth().currentUser; } catch (e) { /* not ready */ }

    // Hide/show back button on checkout step
    var backFromCheckout = $('ycf-back-from-checkout');

    if (user) {
      cameFromLoggedIn = true;
      authOriginStep = null;
      if (backFromCheckout) backFromCheckout.hidden = true;

      openModal();
      showStep('ycf-step-checkout');

      var displayName = user.displayName || '';
      var nameParts = displayName.split(' ');
      var firstName = nameParts[0] || 'User';
      var lastName = nameParts.slice(1).join(' ') || '';
      resolveClientAndAdvance(firstName, lastName, user.email || '', '');
    } else {
      cameFromLoggedIn = false;
      if (backFromCheckout) backFromCheckout.hidden = false;

      showStep('ycf-step-login');
      openModal();
    }
  }

  // =========================================================================
  // FIREBASE AUTH
  // =========================================================================

  function doLogin(email, password, callback) {
    firebase.auth().signInWithEmailAndPassword(email, password)
      .then(function () { callback(null); })
      .catch(function (err) {
        // Validate against Mindbody for legacy users who have no Firebase account yet
        if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential' || err.code === 'auth/too-many-requests') {
          fetch(API_BASE + '/mb-auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email, password: password })
          })
            .then(function (res) { return res.json(); })
            .then(function (data) {
              if (!data.success) { callback(err); return; }
              // Prefer custom token (avoids propagation delay + project mismatch)
              var signIn = data.customToken
                ? firebase.auth().signInWithCustomToken(data.customToken)
                : firebase.auth().signInWithEmailAndPassword(email, password);
              return signIn
                .then(function () { callback(null); })
                .catch(function (retryErr) { callback(retryErr); });
            })
            .catch(function () { callback(err); });
        } else {
          callback(err);
        }
      });
  }

  function doRegister(email, password, firstName, lastName, phone, callback) {
    firebase.auth().createUserWithEmailAndPassword(email, password)
      .then(function (cred) {
        var fullName = firstName + ' ' + lastName;
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
    // Ensure Firebase account exists for MB-only users before sending reset email
    fetch(API_BASE + '/migrate-mb-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email })
    })
      .catch(function () { return { found: false }; })
      .then(function () {
        return firebase.auth().sendPasswordResetEmail(email);
      })
      .then(function () { callback(null); })
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

  // =========================================================================
  // PROCESS PAYMENT
  // =========================================================================
  function processPayment() {
    var user = firebase.auth().currentUser;
    if (!user) return;

    var product = getProduct(currentProdId);
    if (!product) return;

    hideError('ycf-checkout-error');

    // Check which payment method is selected
    var storedRadio = modal.querySelector('input[name="ycf-payment-method"][value="stored"]');
    var useStored = storedRadio && storedRadio.checked && storedCard && storedCard.lastFour;

    var paymentInfo;

    if (useStored) {
      paymentInfo = {
        useStoredCard: true,
        lastFour: storedCard.lastFour
      };
    } else {
      var cardNumber = $('ycf-card').value.replace(/\s/g, '');
      var expiry = $('ycf-expiry').value.trim();
      var cvv = $('ycf-cvv').value.trim();

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

      paymentInfo = {
        cardNumber: cardNumber,
        expMonth: expMonth,
        expYear: expYear,
        cvv: cvv,
        cardHolder: user.displayName || '',
        saveCard: true
      };
    }

    // Disable button
    var payBtn = $('ycf-pay-btn');
    var payBtnEn = $('ycf-pay-btn-en');
    if (payBtn) { payBtn.disabled = true; payBtn.textContent = 'Behandler betaling...'; }
    if (payBtnEn) { payBtnEn.disabled = true; payBtnEn.textContent = 'Processing payment...'; }

    function resetPayBtn() {
      if (payBtn) { payBtn.disabled = false; payBtn.textContent = 'Betal'; }
      if (payBtnEn) { payBtnEn.disabled = false; payBtnEn.textContent = 'Pay'; }
    }

    // If we already have mbClientId, use it; otherwise resolve it now
    var clientPromise;
    if (mbClientId) {
      clientPromise = Promise.resolve(mbClientId);
    } else {
      var displayName = user.displayName || '';
      var nameParts = displayName.split(' ');
      var firstName = nameParts[0] || 'User';
      var lastName = nameParts.slice(1).join(' ') || '';
      var phone = (window._ybRegistration && window._ybRegistration.phone) || '';
      clientPromise = findOrCreateClient(firstName, lastName, user.email || '', phone);
    }

    clientPromise
      .then(function (clientId) {
        mbClientId = clientId;
        return fetch(API_BASE + '/mb-checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: clientId,
            items: [{ type: 'Service', id: parseInt(currentProdId), quantity: 1 }],
            amount: product.price,
            payment: paymentInfo,
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

        // Notify apply form (or any listener) that payment succeeded
        window.dispatchEvent(new CustomEvent('ybCheckoutSuccess', { detail: { prodId: currentProdId } }));

        // Show success
        showStep('ycf-step-success');
      })
      .catch(function (err) {
        showError('ycf-checkout-error', err.message || t('Betaling fejlede.', 'Payment failed.'));
        resetPayBtn();
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
      if (action === 'back-auth') {
        // Go back from checkout to whichever auth step the user came from
        if (authOriginStep === 'register') showStep('ycf-step-register');
        else showStep('ycf-step-login');
      }
    });

    // ── Payment method radio toggle ──
    document.addEventListener('change', function (e) {
      if (e.target.name !== 'ycf-payment-method') return;
      var newCardFields = $('ycf-new-card-fields');
      if (!newCardFields) return;
      newCardFields.hidden = (e.target.value === 'stored');
      updatePaymentOptionStyles();
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
          if (btn) { btn.disabled = false; btn.textContent = isDa ? 'Log ind' : 'Sign in'; }

          if (err) {
            showError('ycf-login-error', authErrorMsg(err));
            return;
          }

          // Track auth
          if (window.CheckoutFunnel) window.CheckoutFunnel.trackAuthComplete();
          authOriginStep = 'login';

          // Resolve MB client + check stored card → advance to checkout
          var user = firebase.auth().currentUser;
          var displayName = (user && user.displayName) || '';
          var nameParts = displayName.split(' ');
          resolveClientAndAdvance(
            nameParts[0] || 'User',
            nameParts.slice(1).join(' ') || '',
            (user && user.email) || email,
            ''
          );
        });
      });
    }

    // ── Google Sign-In (login step) ──
    var googleLoginBtn = $('ycf-google-signin');
    if (googleLoginBtn) {
      googleLoginBtn.addEventListener('click', function () {
        googleLoginBtn.disabled = true;
        hideError('ycf-login-error');

        var provider = new firebase.auth.GoogleAuthProvider();
        firebase.auth().signInWithPopup(provider)
          .then(function (result) {
            if (window.CheckoutFunnel) window.CheckoutFunnel.trackAuthComplete();
            authOriginStep = 'login';

            var user = result.user;
            var displayName = (user && user.displayName) || '';
            var nameParts = displayName.split(' ');
            resolveClientAndAdvance(
              nameParts[0] || 'User',
              nameParts.slice(1).join(' ') || '',
              (user && user.email) || '',
              ''
            );
          })
          .catch(function (error) {
            if (error.code !== 'auth/popup-closed-by-user' && error.code !== 'auth/cancelled-popup-request') {
              showError('ycf-login-error', authErrorMsg(error));
            }
          })
          .finally(function () {
            googleLoginBtn.disabled = false;
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
          if (btn) { btn.disabled = false; btn.textContent = isDa ? 'Opret profil & fortsæt' : 'Create profile & continue'; }

          if (err) {
            showError('ycf-register-error', authErrorMsg(err));
            return;
          }

          // Track auth + profile
          if (window.CheckoutFunnel) {
            window.CheckoutFunnel.trackAuthComplete();
            window.CheckoutFunnel.trackProfileComplete({ firstName: firstName, lastName: lastName, phone: phone });
          }

          // Create MB client immediately (triggers welcome email) → advance to checkout
          authOriginStep = 'register';
          resolveClientAndAdvance(firstName, lastName, email, phone);
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
