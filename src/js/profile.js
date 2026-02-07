/**
 * YOGA BIBLE — PROFILE PAGE
 * Tabs, user data, online store, checkout
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
    var db = firebase.firestore();

    var guestEl = document.getElementById('yb-profile-guest');
    var userEl = document.getElementById('yb-profile-user');
    if (!guestEl || !userEl) return;

    // ── Tabs ──
    initTabs();

    auth.onAuthStateChanged(function(user) {
      if (user) {
        guestEl.style.display = 'none';
        userEl.style.display = 'block';
        loadProfile(user, db);
        // Ensure user has a backend client (silent, in background)
        ensureBackendClient(user, db);
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

    // ── Store: checkout form ──
    var checkoutForm = document.getElementById('yb-store-checkout-form');
    var cancelBtn = document.getElementById('yb-store-cancel-btn');
    var successCloseBtn = document.getElementById('yb-store-success-close');

    if (cancelBtn) {
      cancelBtn.addEventListener('click', function() {
        var checkoutEl = document.getElementById('yb-store-checkout');
        var listEl = document.getElementById('yb-store-list');
        if (checkoutEl) checkoutEl.hidden = true;
        if (listEl) listEl.style.display = '';
      });
    }

    if (successCloseBtn) {
      successCloseBtn.addEventListener('click', function() {
        var successEl = document.getElementById('yb-store-success');
        var listEl = document.getElementById('yb-store-list');
        if (successEl) successEl.hidden = true;
        if (listEl) listEl.style.display = '';
      });
    }

    if (checkoutForm) {
      checkoutForm.addEventListener('submit', function(e) {
        e.preventDefault();
        processCheckout(auth, db);
      });
    }

    // Format card number with spaces
    var cardInput = document.getElementById('yb-store-cardnumber');
    if (cardInput) {
      cardInput.addEventListener('input', function() {
        var v = this.value.replace(/\D/g, '').substring(0, 16);
        this.value = v.replace(/(.{4})/g, '$1 ').trim();
      });
    }

    // Format expiry as MM/YY
    var expiryInput = document.getElementById('yb-store-expiry');
    if (expiryInput) {
      expiryInput.addEventListener('input', function() {
        var v = this.value.replace(/\D/g, '').substring(0, 4);
        if (v.length >= 3) v = v.substring(0, 2) + '/' + v.substring(2);
        this.value = v;
      });
    }
  }

  // ══════════════════════════════════════
  // TABS
  // ══════════════════════════════════════

  var storeLoaded = false;

  function initTabs() {
    document.querySelectorAll('[data-yb-tab]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var tabName = btn.getAttribute('data-yb-tab');

        // Update active tab button
        document.querySelectorAll('[data-yb-tab]').forEach(function(b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');

        // Update active panel
        document.querySelectorAll('[data-yb-panel]').forEach(function(p) { p.classList.remove('is-active'); });
        var panel = document.querySelector('[data-yb-panel="' + tabName + '"]');
        if (panel) panel.classList.add('is-active');

        // Load store on first visit
        if (tabName === 'store' && !storeLoaded) {
          storeLoaded = true;
          loadStore();
        }
      });
    });
  }

  // ══════════════════════════════════════
  // LOAD PROFILE
  // ══════════════════════════════════════

  function loadProfile(user, db) {
    var nameEl = document.getElementById('yb-profile-display-name');
    var emailEl = document.getElementById('yb-profile-display-email');
    var avatarEl = document.getElementById('yb-profile-avatar');

    if (nameEl) nameEl.textContent = user.displayName || user.email.split('@')[0];
    if (emailEl) emailEl.textContent = user.email;
    if (avatarEl) avatarEl.textContent = getInitials(user.displayName || user.email);

    var emailInput = document.getElementById('yb-profile-email');
    if (emailInput) emailInput.value = user.email;

    db.collection('users').doc(user.uid).get().then(function(doc) {
      if (!doc.exists) return;
      var d = doc.data();

      var fnEl = document.getElementById('yb-profile-firstname');
      var lnEl = document.getElementById('yb-profile-lastname');
      var phEl = document.getElementById('yb-profile-phone');
      if (fnEl) fnEl.value = d.firstName || '';
      if (lnEl) lnEl.value = d.lastName || '';
      if (phEl) phEl.value = d.phone || '';

      var sinceEl = document.getElementById('yb-profile-member-since');
      if (sinceEl && d.createdAt) {
        var date = d.createdAt.toDate ? d.createdAt.toDate() : new Date(d.createdAt);
        var label = isDa() ? 'Medlem siden' : 'Member since';
        sinceEl.textContent = label + ' ' + date.toLocaleDateString(isDa() ? 'da-DK' : 'en-GB', { year: 'numeric', month: 'long' });
      }

      var tierEl = document.getElementById('yb-profile-tier');
      if (tierEl) {
        var tier = d.membershipTier || 'free';
        tierEl.textContent = tier === 'free' ? (isDa() ? 'Gratis' : 'Free') : (isDa() ? 'Medlem' : 'Member');
        tierEl.className = 'yb-profile__info-value ' + (tier === 'free' ? 'yb-profile__info-value--muted' : 'yb-profile__info-value--success');
      }
    }).catch(function(err) {
      console.warn('Could not load profile:', err);
    });
  }

  // ══════════════════════════════════════
  // ENSURE BACKEND CLIENT (silent)
  // ══════════════════════════════════════

  function ensureBackendClient(user, db) {
    db.collection('users').doc(user.uid).get().then(function(doc) {
      if (!doc.exists) return;
      var d = doc.data();
      if (d.mindbodyClientId) return; // Already connected

      var firstName = d.firstName || (user.displayName || '').split(' ')[0] || '';
      var lastName = d.lastName || (user.displayName || '').split(' ').slice(1).join(' ') || '';

      fetch('/.netlify/functions/mb-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName: firstName, lastName: lastName, email: user.email })
      }).then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.client && data.client.Id) {
            db.collection('users').doc(user.uid).update({
              mindbodyClientId: String(data.client.Id),
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
          }
        }).catch(function() {});
    });
  }

  // ══════════════════════════════════════
  // ONLINE STORE
  // ══════════════════════════════════════

  var storeServices = [];

  function loadStore() {
    var listEl = document.getElementById('yb-store-list');
    if (!listEl) return;

    fetch('/.netlify/functions/mb-services')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        // Filter to "Teacher Training - Deposits" service category
        storeServices = (data.services || []).filter(function(s) {
          return s.programName && s.programName.toLowerCase().indexOf('teacher training') !== -1 &&
                 s.programName.toLowerCase().indexOf('deposit') !== -1;
        });

        if (!storeServices.length) {
          listEl.innerHTML = '<p class="yb-store__empty">' + (isDa() ? 'Ingen pakker tilgængelige lige nu.' : 'No packages available right now.') + '</p>';
          return;
        }

        renderStoreItems(listEl);
      })
      .catch(function() {
        listEl.innerHTML = '<p class="yb-store__error">' + (isDa() ? 'Kunne ikke hente pakker. Prøv igen senere.' : 'Could not load packages. Please try again later.') + '</p>';
      });
  }

  function renderStoreItems(container) {
    var html = '<div class="yb-store__grid">';

    storeServices.forEach(function(s) {
      var price = s.onlinePrice || s.price || 0;
      var priceStr = formatDKK(price);

      html += '<div class="yb-store__item">';
      html += '  <div class="yb-store__item-info">';
      html += '    <h3 class="yb-store__item-name">' + escapeHtml(s.name) + '</h3>';
      html += '    <span class="yb-store__item-price">' + priceStr + '</span>';
      html += '  </div>';
      html += '  <button class="yb-btn yb-btn--primary yb-store__item-btn" type="button" data-store-buy="' + s.id + '">';
      html += (isDa() ? 'Betal nu' : 'Pay now');
      html += '  </button>';
      html += '</div>';
    });

    html += '</div>';
    container.innerHTML = html;

    // Attach buy handlers
    container.querySelectorAll('[data-store-buy]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var serviceId = parseInt(btn.getAttribute('data-store-buy'), 10);
        openCheckout(serviceId);
      });
    });
  }

  function openCheckout(serviceId) {
    var service = storeServices.find(function(s) { return s.id === serviceId; });
    if (!service) return;

    var listEl = document.getElementById('yb-store-list');
    var checkoutEl = document.getElementById('yb-store-checkout');
    var itemEl = document.getElementById('yb-store-checkout-item');

    if (listEl) listEl.style.display = 'none';
    if (checkoutEl) checkoutEl.hidden = false;

    // Show selected item
    var price = service.onlinePrice || service.price || 0;
    if (itemEl) {
      itemEl.innerHTML = '<span class="yb-store__checkout-item-name">' + escapeHtml(service.name) + '</span>' +
                         '<span class="yb-store__checkout-item-price">' + formatDKK(price) + '</span>';
    }

    // Store active service for checkout
    checkoutEl.setAttribute('data-service-id', serviceId);
    checkoutEl.setAttribute('data-service-price', price);

    // Pre-fill cardholder from profile
    var user = firebase.auth().currentUser;
    var holderInput = document.getElementById('yb-store-cardholder');
    if (holderInput && user && user.displayName) {
      holderInput.value = user.displayName;
    }

    // Clear errors
    var errEl = document.getElementById('yb-store-error');
    if (errEl) errEl.hidden = true;
  }

  function processCheckout(auth, db) {
    var user = auth.currentUser;
    if (!user) return;

    var checkoutEl = document.getElementById('yb-store-checkout');
    var serviceId = parseInt(checkoutEl.getAttribute('data-service-id'), 10);
    var amount = parseFloat(checkoutEl.getAttribute('data-service-price'));

    var cardNumber = document.getElementById('yb-store-cardnumber').value.replace(/\s/g, '');
    var expiry = document.getElementById('yb-store-expiry').value;
    var cvv = document.getElementById('yb-store-cvv').value;
    var cardHolder = document.getElementById('yb-store-cardholder').value.trim();
    var address = document.getElementById('yb-store-address').value.trim();
    var city = document.getElementById('yb-store-city').value.trim();
    var zip = document.getElementById('yb-store-zip').value.trim();
    var errorEl = document.getElementById('yb-store-error');
    var payBtn = document.getElementById('yb-store-pay-btn');
    var payBtnText = payBtn.textContent;

    // Basic validation
    if (!cardNumber || cardNumber.length < 13) {
      showSimpleError(errorEl, isDa() ? 'Indtast et gyldigt kortnummer.' : 'Enter a valid card number.');
      return;
    }
    if (!expiry || expiry.length < 4) {
      showSimpleError(errorEl, isDa() ? 'Indtast udløbsdato.' : 'Enter expiry date.');
      return;
    }
    if (!cvv || cvv.length < 3) {
      showSimpleError(errorEl, isDa() ? 'Indtast CVV.' : 'Enter CVV.');
      return;
    }

    var expParts = expiry.split('/');
    var expMonth = expParts[0];
    var expYear = expParts[1] ? '20' + expParts[1] : '';

    payBtn.disabled = true;
    payBtn.textContent = isDa() ? 'Behandler betaling...' : 'Processing payment...';

    // Get clientId from Firestore
    db.collection('users').doc(user.uid).get().then(function(doc) {
      var d = doc.data() || {};
      if (!d.mindbodyClientId) {
        throw new Error(isDa() ? 'Din konto er ikke forbundet endnu. Prøv igen om et øjeblik.' : 'Your account is not connected yet. Please try again in a moment.');
      }

      return fetch('/.netlify/functions/mb-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: d.mindbodyClientId,
          items: [{ type: 'Service', id: serviceId, quantity: 1 }],
          amount: amount,
          payment: {
            cardNumber: cardNumber,
            expMonth: expMonth,
            expYear: expYear,
            cvv: cvv,
            cardHolder: cardHolder,
            billingAddress: address,
            billingCity: city,
            billingPostalCode: zip
          }
        })
      });
    }).then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.success) {
          // Show success
          checkoutEl.hidden = true;
          var successEl = document.getElementById('yb-store-success');
          if (successEl) successEl.hidden = false;

          // Reset form
          document.getElementById('yb-store-checkout-form').reset();
        } else if (data.requiresSCA) {
          showSimpleError(errorEl, isDa() ? 'Dit kort kræver yderligere godkendelse. Prøv et andet kort.' : 'Your card requires additional authentication. Please try another card.');
        } else {
          showSimpleError(errorEl, data.error || (isDa() ? 'Betalingen fejlede.' : 'Payment failed.'));
        }
      }).catch(function(err) {
        showSimpleError(errorEl, err.message || (isDa() ? 'Betalingen fejlede. Prøv igen.' : 'Payment failed. Please try again.'));
      }).finally(function() {
        payBtn.disabled = false;
        payBtn.textContent = payBtnText;
      });
  }

  // ══════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════

  function isDa() { return window.location.pathname.indexOf('/en/') !== 0; }

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
    if (!isError && successEl) {
      setTimeout(function() { successEl.hidden = true; }, 4000);
    }
  }

  function showSimpleError(el, msg) {
    if (el) { el.textContent = msg; el.hidden = false; }
  }

  function formatDKK(amount) {
    return amount.toLocaleString('da-DK', { style: 'currency', currency: 'DKK', minimumFractionDigits: 0 });
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
