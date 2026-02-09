/**
 * YOGA BIBLE — PROFILE PAGE
 * Tabs: Profile, Schedule, Store, Visit History, Receipts
 */
(function() {
  'use strict';

  var currentUser = null;
  var currentDb = null;
  var clientId = null; // Mindbody client ID from Firestore
  var clientPassData = null; // Cached pass/service data

  var checkInterval = setInterval(function() {
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
      clearInterval(checkInterval);
      init();
    }
  }, 100);

  function init() {
    var auth = firebase.auth();
    var db = firebase.firestore();
    currentDb = db;

    var guestEl = document.getElementById('yb-profile-guest');
    var userEl = document.getElementById('yb-profile-user');
    if (!guestEl || !userEl) return;

    initTabs();
    initStoreForm();
    initScheduleNav();
    initAvatarUpload(db);
    initVisitFilters();

    auth.onAuthStateChanged(function(user) {
      if (user) {
        currentUser = user;
        guestEl.style.display = 'none';
        userEl.style.display = 'block';
        loadProfile(user, db);
        ensureBackendClient(user, db);

        // Deep-link to courses tab via hash
        var hash = window.location.hash;
        if (hash === '#mine-kurser' || hash === '#my-courses' || hash.indexOf('#course=') === 0) {
          var coursesTab = document.querySelector('[data-yb-tab="courses"]');
          if (coursesTab) coursesTab.click();
          // If deep-linking to a specific course, open it after courses load
          if (hash.indexOf('#course=') === 0) {
            var deepCourseId = hash.substring(8);
            setTimeout(function() {
              openCourseViewer(deepCourseId, null, null);
            }, 500);
          }
        }
      } else {
        currentUser = null;
        clientId = null;
        clientPassData = null;
        guestEl.style.display = '';
        userEl.style.display = 'none';
      }
    });

    // ── Save personal details (+ sync to backend) ──
    var profileForm = document.getElementById('yb-profile-form');
    if (profileForm) {
      profileForm.addEventListener('submit', function(e) {
        e.preventDefault();
        var user = auth.currentUser;
        if (!user) return;

        var firstName = document.getElementById('yb-profile-firstname').value.trim();
        var lastName = document.getElementById('yb-profile-lastname').value.trim();
        var phone = document.getElementById('yb-profile-phone').value.trim();
        var dobInput = document.getElementById('yb-profile-dob');
        var dob = dobInput ? dobInput.value : '';
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

        var updateData = {
          firstName: firstName, lastName: lastName, name: fullName, phone: phone,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        if (dob) updateData.dateOfBirth = dob;

        user.updateProfile({ displayName: fullName }).then(function() {
          return db.collection('users').doc(user.uid).update(updateData);
        }).then(function() {
          showMsg(errorEl, successEl, isDa() ? 'Dine oplysninger er opdateret.' : 'Your details have been updated.', false);
          var nameEl = document.getElementById('yb-profile-display-name');
          var avatarEl = document.getElementById('yb-profile-avatar');
          if (nameEl) nameEl.textContent = fullName;
          if (avatarEl && !avatarEl.classList.contains('has-photo')) avatarEl.textContent = getInitials(fullName);

          // Hide reminder if now complete
          if (phone && dob) {
            var reminderEl = document.getElementById('yb-profile-reminder');
            if (reminderEl) reminderEl.hidden = true;
          }

          // Sync to backend silently
          if (clientId) {
            var mbData = { clientId: clientId, firstName: firstName, lastName: lastName, phone: phone, email: user.email };
            if (dob) mbData.birthDate = dob;
            fetch('/.netlify/functions/mb-client', {
              method: 'PUT', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(mbData)
            }).catch(function() {});
          }
        }).catch(function(err) {
          showMsg(errorEl, successEl, err.message, true);
        }).finally(function() { btn.disabled = false; btn.textContent = btnText; });
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

        if (newPw.length < 6) { showMsg(errorEl, successEl, isDa() ? 'Adgangskoden skal være mindst 6 tegn.' : 'Password must be at least 6 characters.', true); return; }
        if (newPw !== confirmPw) { showMsg(errorEl, successEl, isDa() ? 'Adgangskoderne matcher ikke.' : 'Passwords do not match.', true); return; }

        btn.disabled = true;
        btn.textContent = isDa() ? 'Skifter...' : 'Changing...';
        user.updatePassword(newPw).then(function() {
          showMsg(errorEl, successEl, isDa() ? 'Din adgangskode er ændret.' : 'Your password has been changed.', false);
          pwForm.reset();
        }).catch(function(err) {
          var msg = err.code === 'auth/requires-recent-login'
            ? (isDa() ? 'Log venligst ud og ind igen før du skifter adgangskode.' : 'Please sign out and back in before changing your password.')
            : err.message;
          showMsg(errorEl, successEl, msg, true);
        }).finally(function() { btn.disabled = false; btn.textContent = btnText; });
      });
    }
  }

  // ══════════════════════════════════════
  // TABS
  // ══════════════════════════════════════
  var tabLoaded = {};

  function initTabs() {
    document.querySelectorAll('[data-yb-tab]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var tabName = btn.getAttribute('data-yb-tab');
        document.querySelectorAll('[data-yb-tab]').forEach(function(b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        document.querySelectorAll('[data-yb-panel]').forEach(function(p) { p.classList.remove('is-active'); });
        var panel = document.querySelector('[data-yb-panel="' + tabName + '"]');
        if (panel) panel.classList.add('is-active');

        // Lazy-load tab content
        if (!tabLoaded[tabName]) {
          tabLoaded[tabName] = true;
          if (tabName === 'store') loadStore();
          if (tabName === 'schedule') loadSchedule();
          if (tabName === 'visits') loadVisits();
          if (tabName === 'receipts') loadReceipts();
          if (tabName === 'courses') loadMyCourses();
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
      var dobEl = document.getElementById('yb-profile-dob');
      if (fnEl) fnEl.value = d.firstName || '';
      if (lnEl) lnEl.value = d.lastName || '';
      if (phEl) phEl.value = d.phone || '';
      if (dobEl) dobEl.value = d.dateOfBirth || '';

      if (d.mindbodyClientId) {
        clientId = d.mindbodyClientId;
        // Load membership details
        loadMembershipDetails();
      }

      // Load saved profile picture
      if (d.photoURL && avatarEl) {
        avatarEl.style.backgroundImage = 'url(' + d.photoURL + ')';
        avatarEl.textContent = '';
        avatarEl.classList.add('has-photo');
      }

      // Show soft reminder if phone or DOB missing
      var reminderEl = document.getElementById('yb-profile-reminder');
      if (reminderEl && (!d.phone || !d.dateOfBirth)) {
        reminderEl.hidden = false;
      }

      var sinceEl = document.getElementById('yb-profile-member-since');
      if (sinceEl && d.createdAt) {
        var date = d.createdAt.toDate ? d.createdAt.toDate() : new Date(d.createdAt);
        sinceEl.textContent = (isDa() ? 'Medlem siden ' : 'Member since ') + date.toLocaleDateString(isDa() ? 'da-DK' : 'en-GB', { year: 'numeric', month: 'long' });
      }

      var tierEl = document.getElementById('yb-profile-tier');
      if (tierEl) {
        var tier = d.membershipTier || 'free';
        tierEl.textContent = tier === 'free' ? (isDa() ? 'Gratis' : 'Free') : (isDa() ? 'Medlem' : 'Member');
        tierEl.className = 'yb-profile__info-value ' + (tier === 'free' ? 'yb-profile__info-value--muted' : 'yb-profile__info-value--success');
      }
    }).catch(function(err) { console.warn('Could not load profile:', err); });
  }

  // ══════════════════════════════════════
  // ENSURE BACKEND CLIENT (silent)
  // ══════════════════════════════════════
  function ensureBackendClient(user, db) {
    db.collection('users').doc(user.uid).get().then(function(doc) {
      if (!doc.exists) return;
      var d = doc.data();
      if (d.mindbodyClientId) { clientId = d.mindbodyClientId; return; }

      var firstName = d.firstName || (user.displayName || '').split(' ')[0] || '';
      var lastName = d.lastName || (user.displayName || '').split(' ').slice(1).join(' ') || '';

      fetch('/.netlify/functions/mb-client?email=' + encodeURIComponent(user.email))
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.found && data.client && data.client.id) {
            clientId = String(data.client.id);
            return db.collection('users').doc(user.uid).update({
              mindbodyClientId: clientId, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
          }
          return fetch('/.netlify/functions/mb-client', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firstName: firstName, lastName: lastName, email: user.email })
          }).then(function(r) { return r.json(); })
            .then(function(cd) {
              if (cd.client && cd.client.id) {
                clientId = String(cd.client.id);
                return db.collection('users').doc(user.uid).update({
                  mindbodyClientId: clientId, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
              }
            });
        }).catch(function() {});
    });
  }

  // ══════════════════════════════════════
  // PROFILE PICTURE
  // ══════════════════════════════════════
  function initAvatarUpload(db) {
    var avatarBtn = document.getElementById('yb-profile-avatar-btn');
    var avatarInput = document.getElementById('yb-profile-avatar-input');
    if (!avatarBtn || !avatarInput) return;

    avatarBtn.addEventListener('click', function() { avatarInput.click(); });

    avatarInput.addEventListener('change', function() {
      var file = this.files && this.files[0];
      if (!file || !currentUser) return;
      if (!file.type.startsWith('image/')) return;
      if (file.size > 10 * 1024 * 1024) { alert(isDa() ? 'Billedet er for stort (maks 10 MB).' : 'Image too large (max 10 MB).'); return; }

      resizeImage(file, 200, function(dataUrl) {
        // Show immediately
        var avatarEl = document.getElementById('yb-profile-avatar');
        if (avatarEl) {
          avatarEl.style.backgroundImage = 'url(' + dataUrl + ')';
          avatarEl.textContent = '';
          avatarEl.classList.add('has-photo');
        }
        // Save to Firestore
        db.collection('users').doc(currentUser.uid).update({
          photoURL: dataUrl,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(function(err) { console.warn('Could not save photo:', err); });
      });
      // Reset so same file can be re-selected
      this.value = '';
    });
  }

  function resizeImage(file, maxSize, callback) {
    var reader = new FileReader();
    reader.onload = function(e) {
      var img = new Image();
      img.onload = function() {
        var canvas = document.createElement('canvas');
        var w = img.width, h = img.height;
        // Crop to square from center
        var side = Math.min(w, h);
        var sx = (w - side) / 2, sy = (h - side) / 2;
        canvas.width = maxSize;
        canvas.height = maxSize;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, side, side, 0, 0, maxSize, maxSize);
        callback(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  // ══════════════════════════════════════
  // MEMBERSHIP DETAILS (passes + contracts)
  // ══════════════════════════════════════
  function loadMembershipDetails() {
    if (!clientId) return;

    var loadingEl = document.getElementById('yb-membership-loading');
    var contentEl = document.getElementById('yb-membership-content');
    if (!contentEl) return;
    if (loadingEl) loadingEl.hidden = false;

    fetch('/.netlify/functions/mb-client-services?clientId=' + clientId)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (loadingEl) loadingEl.hidden = true;
        clientPassData = data;
        renderMembershipDetails(contentEl, data);

        // Update tier if they have active passes
        if (data.hasActivePass) {
          var tierEl = document.getElementById('yb-profile-tier');
          if (tierEl) {
            tierEl.textContent = isDa() ? 'Medlem' : 'Member';
            tierEl.className = 'yb-profile__info-value yb-profile__info-value--success';
          }
        }
      })
      .catch(function() {
        if (loadingEl) loadingEl.hidden = true;
      });
  }

  function renderMembershipDetails(container, data) {
    var html = '';

    // Active passes
    var active = data.activeServices || [];
    html += '<div class="yb-membership__section">';
    html += '<h3 class="yb-membership__section-title">' + t('membership_active_passes') + '</h3>';
    if (active.length) {
      active.forEach(function(s) {
        html += '<div class="yb-membership__pass">';
        html += '<div class="yb-membership__pass-info">';
        html += '<span class="yb-membership__pass-name">' + esc(s.name) + '</span>';
        if (s.remaining != null) {
          html += '<span class="yb-membership__pass-remaining">' + s.remaining + ' ' + t('membership_remaining') + '</span>';
        } else {
          html += '<span class="yb-membership__pass-remaining">' + t('membership_unlimited') + '</span>';
        }
        html += '</div>';
        if (s.expirationDate) {
          var expDate = new Date(s.expirationDate);
          html += '<span class="yb-membership__pass-expiry">' + t('membership_expires') + ' ' + expDate.toLocaleDateString(isDa() ? 'da-DK' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + '</span>';
        }
        html += '<span class="yb-membership__badge yb-membership__badge--active">' + t('membership_status_active') + '</span>';
        html += '</div>';
      });
    } else {
      html += '<p class="yb-membership__empty">' + t('membership_no_active') + '</p>';
    }
    html += '</div>';

    // Active contracts (subscriptions)
    var contracts = data.activeContracts || [];
    if (contracts.length) {
      html += '<div class="yb-membership__section">';
      html += '<h3 class="yb-membership__section-title">' + t('membership_contracts') + '</h3>';
      contracts.forEach(function(c) {
        html += '<div class="yb-membership__pass">';
        html += '<div class="yb-membership__pass-info">';
        html += '<span class="yb-membership__pass-name">' + esc(c.name) + '</span>';
        if (c.isAutopay) {
          html += '<span class="yb-membership__pass-remaining">' + t('membership_autopay') + '</span>';
        }
        html += '</div>';
        if (c.endDate) {
          var endDate = new Date(c.endDate);
          html += '<span class="yb-membership__pass-expiry">' + t('membership_expires') + ' ' + endDate.toLocaleDateString(isDa() ? 'da-DK' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + '</span>';
        }
        html += '<span class="yb-membership__badge yb-membership__badge--active">' + t('membership_status_active') + '</span>';
        html += '</div>';
      });
      html += '</div>';
    }

    // Past passes (expired)
    var past = (data.services || []).filter(function(s) { return !s.current; });
    if (past.length) {
      html += '<div class="yb-membership__section">';
      html += '<h3 class="yb-membership__section-title">' + t('membership_past_passes') + '</h3>';
      past.forEach(function(s) {
        html += '<div class="yb-membership__pass yb-membership__pass--expired">';
        html += '<div class="yb-membership__pass-info">';
        html += '<span class="yb-membership__pass-name">' + esc(s.name) + '</span>';
        if (s.remaining != null) {
          html += '<span class="yb-membership__pass-remaining">' + s.remaining + ' ' + t('membership_remaining') + '</span>';
        }
        html += '</div>';
        if (s.expirationDate) {
          var expDate = new Date(s.expirationDate);
          html += '<span class="yb-membership__pass-expiry">' + t('membership_expires') + ' ' + expDate.toLocaleDateString(isDa() ? 'da-DK' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + '</span>';
        }
        html += '</div>';
      });
      html += '</div>';
    }

    container.innerHTML = html;
  }

  // ══════════════════════════════════════
  // STORE TAB
  // ══════════════════════════════════════
  var storeServices = [];

  function initStoreForm() {
    var checkoutForm = document.getElementById('yb-store-checkout-form');
    var cancelBtn = document.getElementById('yb-store-cancel-btn');
    var successCloseBtn = document.getElementById('yb-store-success-close');

    if (cancelBtn) cancelBtn.addEventListener('click', function() {
      var el = document.getElementById('yb-store-checkout');
      var list = document.getElementById('yb-store-list');
      if (el) el.hidden = true;
      if (list) list.style.display = '';
    });
    if (successCloseBtn) successCloseBtn.addEventListener('click', function() {
      var el = document.getElementById('yb-store-success');
      var list = document.getElementById('yb-store-list');
      if (el) el.hidden = true;
      if (list) list.style.display = '';
    });
    if (checkoutForm) checkoutForm.addEventListener('submit', function(e) { e.preventDefault(); processCheckout(); });

    var cardInput = document.getElementById('yb-store-cardnumber');
    if (cardInput) cardInput.addEventListener('input', function() {
      var v = this.value.replace(/\D/g, '').substring(0, 16);
      this.value = v.replace(/(.{4})/g, '$1 ').trim();
    });
    var expiryInput = document.getElementById('yb-store-expiry');
    if (expiryInput) expiryInput.addEventListener('input', function() {
      var v = this.value.replace(/\D/g, '').substring(0, 4);
      if (v.length >= 3) v = v.substring(0, 2) + '/' + v.substring(2);
      this.value = v;
    });
  }

  function loadStore() {
    var listEl = document.getElementById('yb-store-list');
    if (!listEl) return;
    var storePanel = document.querySelector('[data-yb-panel="store"]');
    var itemIds = storePanel ? storePanel.getAttribute('data-store-items') : '';
    if (!itemIds) { listEl.innerHTML = '<p class="yb-store__empty">' + t('store_empty') + '</p>'; return; }

    fetch('/.netlify/functions/mb-services?serviceIds=' + itemIds)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        storeServices = data.services || [];
        if (!storeServices.length) { listEl.innerHTML = '<p class="yb-store__empty">' + t('store_empty') + '</p>'; return; }
        renderStoreItems(listEl);
      })
      .catch(function() { listEl.innerHTML = '<p class="yb-store__error">' + t('store_error') + '</p>'; });
  }

  function renderStoreItems(container) {
    var html = '<div class="yb-store__grid">';
    storeServices.forEach(function(s) {
      var price = s.onlinePrice || s.price || 0;
      html += '<div class="yb-store__item">';
      html += '  <div class="yb-store__item-info">';
      html += '    <h3 class="yb-store__item-name">' + esc(s.name) + '</h3>';
      html += '    <span class="yb-store__item-price">' + formatDKK(price) + '</span>';
      html += '  </div>';
      html += '  <button class="yb-btn yb-btn--primary yb-store__item-btn" type="button" data-store-buy="' + s.id + '">' + t('store_buy') + '</button>';
      html += '</div>';
    });
    html += '</div>';
    container.innerHTML = html;
    container.querySelectorAll('[data-store-buy]').forEach(function(btn) {
      btn.addEventListener('click', function() { openCheckout(btn.getAttribute('data-store-buy')); });
    });
  }

  function openCheckout(serviceId) {
    var service = storeServices.find(function(s) { return String(s.id) === String(serviceId); });
    if (!service) return;
    var listEl = document.getElementById('yb-store-list');
    var checkoutEl = document.getElementById('yb-store-checkout');
    var itemEl = document.getElementById('yb-store-checkout-item');
    if (listEl) listEl.style.display = 'none';
    if (checkoutEl) checkoutEl.hidden = false;
    var price = service.onlinePrice || service.price || 0;
    if (itemEl) itemEl.innerHTML = '<span class="yb-store__checkout-item-name">' + esc(service.name) + '</span><span class="yb-store__checkout-item-price">' + formatDKK(price) + '</span>';
    checkoutEl.setAttribute('data-service-id', service.id);
    checkoutEl.setAttribute('data-service-price', price);
    var holderInput = document.getElementById('yb-store-cardholder');
    if (holderInput && currentUser && currentUser.displayName) holderInput.value = currentUser.displayName;
    var errEl = document.getElementById('yb-store-error');
    if (errEl) errEl.hidden = true;
    checkoutEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function processCheckout() {
    if (!currentUser) return;
    var checkoutEl = document.getElementById('yb-store-checkout');
    var serviceId = checkoutEl.getAttribute('data-service-id');
    var amount = parseFloat(checkoutEl.getAttribute('data-service-price'));
    var cardNumber = document.getElementById('yb-store-cardnumber').value.replace(/\s/g, '');
    var expiry = document.getElementById('yb-store-expiry').value;
    var cvv = document.getElementById('yb-store-cvv').value;
    var cardHolder = document.getElementById('yb-store-cardholder').value.trim();
    var address = document.getElementById('yb-store-address').value.trim();
    var city = document.getElementById('yb-store-city').value.trim();
    var zip = document.getElementById('yb-store-zip').value.trim();
    var saveCard = document.getElementById('yb-store-save-card');
    var errorEl = document.getElementById('yb-store-error');
    var payBtn = document.getElementById('yb-store-pay-btn');
    var payBtnText = payBtn.textContent;

    if (!cardNumber || cardNumber.length < 13) { showSimpleError(errorEl, isDa() ? 'Indtast et gyldigt kortnummer.' : 'Enter a valid card number.'); return; }
    if (!expiry || expiry.length < 4) { showSimpleError(errorEl, isDa() ? 'Indtast udløbsdato.' : 'Enter expiry date.'); return; }
    if (!cvv || cvv.length < 3) { showSimpleError(errorEl, isDa() ? 'Indtast CVV.' : 'Enter CVV.'); return; }

    var expParts = expiry.split('/');
    payBtn.disabled = true;
    payBtn.textContent = isDa() ? 'Behandler betaling...' : 'Processing payment...';

    if (!clientId) { showSimpleError(errorEl, isDa() ? 'Din konto er ikke klar endnu.' : 'Your account is not ready yet.'); payBtn.disabled = false; payBtn.textContent = payBtnText; return; }

    fetch('/.netlify/functions/mb-checkout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: clientId,
        items: [{ type: 'Service', id: Number(serviceId), quantity: 1 }],
        amount: amount,
        payment: {
          cardNumber: cardNumber, expMonth: expParts[0], expYear: expParts[1] ? '20' + expParts[1] : '',
          cvv: cvv, cardHolder: cardHolder, billingAddress: address, billingCity: city, billingPostalCode: zip,
          saveCard: saveCard ? saveCard.checked : false
        }
      })
    }).then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.success) {
          checkoutEl.hidden = true;
          var sEl = document.getElementById('yb-store-success');
          if (sEl) sEl.hidden = false;
          document.getElementById('yb-store-checkout-form').reset();
          // Refresh membership data after purchase
          clientPassData = null;
          loadMembershipDetails();
        } else if (data.requiresSCA) {
          showSimpleError(errorEl, isDa() ? 'Dit kort kræver yderligere godkendelse.' : 'Your card requires additional authentication.');
        } else {
          console.error('[Checkout] Error:', data.error, data.details, 'fn_v:', data._v);
          showSimpleError(errorEl, data.error || t('checkout_error'));
        }
      }).catch(function(err) {
        showSimpleError(errorEl, err.message || t('checkout_error'));
      }).finally(function() { payBtn.disabled = false; payBtn.textContent = payBtnText; });
  }

  // ══════════════════════════════════════
  // SCHEDULE TAB
  // ══════════════════════════════════════
  var scheduleWeekOffset = 0;

  function initScheduleNav() {
    var prevBtn = document.getElementById('yb-schedule-prev');
    var nextBtn = document.getElementById('yb-schedule-next');
    var buyPassBtn = document.getElementById('yb-schedule-buy-pass');

    if (prevBtn) prevBtn.addEventListener('click', function() { scheduleWeekOffset--; loadSchedule(); });
    if (nextBtn) nextBtn.addEventListener('click', function() { scheduleWeekOffset++; loadSchedule(); });
    if (buyPassBtn) buyPassBtn.addEventListener('click', function() {
      // Switch to store tab
      var storeBtn = document.querySelector('[data-yb-tab="store"]');
      if (storeBtn) storeBtn.click();
    });
  }

  function loadSchedule() {
    var listEl = document.getElementById('yb-schedule-list');
    if (!listEl) return;

    // Reset banners at start of each load
    var noPassEl = document.getElementById('yb-schedule-no-pass');
    if (noPassEl) noPassEl.hidden = true;

    listEl.innerHTML = '<div class="yb-store__loading"><div class="yb-mb-spinner"></div><span>' + t('schedule_loading') + '</span></div>';

    var today = new Date();
    today = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    var start, end;
    if (scheduleWeekOffset === 0) {
      // Current view: today through Sunday
      start = new Date(today);
      end = new Date(today);
      var daysUntilSunday = (7 - today.getDay()) % 7;
      // If today is Sunday, show just today
      end.setDate(end.getDate() + (daysUntilSunday || 0));
    } else {
      // Other weeks: full Mon–Sun
      var refDate = new Date(today);
      refDate.setDate(refDate.getDate() + (scheduleWeekOffset * 7));
      var dow = refDate.getDay();
      var mondayDiff = dow === 0 ? -6 : 1 - dow;
      start = new Date(refDate);
      start.setDate(start.getDate() + mondayDiff);
      end = new Date(start);
      end.setDate(end.getDate() + 6);
    }

    var labelEl = document.getElementById('yb-schedule-week-label');
    if (labelEl) {
      var opts = { day: 'numeric', month: 'short' };
      var locale = isDa() ? 'da-DK' : 'en-GB';
      if (scheduleWeekOffset === 0) {
        labelEl.textContent = (isDa() ? 'I dag' : 'Today') + ' – ' + end.toLocaleDateString(locale, opts);
      } else {
        labelEl.textContent = start.toLocaleDateString(locale, opts) + ' – ' + end.toLocaleDateString(locale, opts);
      }
    }

    var startStr = toDateStr(start);
    var endStr = toDateStr(end);
    var url = '/.netlify/functions/mb-classes?startDate=' + startStr + '&endDate=' + endStr;
    if (clientId) url += '&clientId=' + clientId;

    // Also load pass info for the schedule banner
    loadSchedulePassInfo();

    fetch(url)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var classes = data.classes || [];
        if (!classes.length) { listEl.innerHTML = '<p class="yb-store__empty">' + t('schedule_empty') + '</p>'; return; }
        renderSchedule(listEl, classes, start);
      })
      .catch(function() { listEl.innerHTML = '<p class="yb-store__error">' + t('schedule_error') + '</p>'; });
  }

  function loadSchedulePassInfo() {
    if (!clientId) return;
    var passInfoEl = document.getElementById('yb-schedule-pass-info');
    var noPassEl = document.getElementById('yb-schedule-no-pass');
    if (!passInfoEl) return;

    // Use cached data if available
    if (clientPassData) {
      renderSchedulePassInfo(passInfoEl, noPassEl, clientPassData);
      return;
    }

    fetch('/.netlify/functions/mb-client-services?clientId=' + clientId)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        clientPassData = data;
        renderSchedulePassInfo(passInfoEl, noPassEl, data);
      })
      .catch(function() {});
  }

  function renderSchedulePassInfo(passInfoEl, noPassEl, data) {
    if (data.hasActivePass) {
      // Show pass info, hide "buy pass"
      if (noPassEl) noPassEl.hidden = true;
      var active = data.activeServices || [];
      if (active.length) {
        var s = active[0]; // Show primary active pass
        var html = '<div class="yb-schedule__pass-detail">';
        html += '<div class="yb-schedule__pass-detail-info">';
        html += '<span class="yb-schedule__pass-detail-label">' + t('schedule_pass_info') + '</span>';
        html += '<span class="yb-schedule__pass-detail-name">' + esc(s.name) + '</span>';
        html += '</div>';
        html += '<div class="yb-schedule__pass-detail-stats">';
        if (s.remaining != null) {
          html += '<span class="yb-schedule__pass-stat"><strong>' + s.remaining + '</strong> ' + t('schedule_remaining') + '</span>';
        }
        if (s.expirationDate) {
          var expDate = new Date(s.expirationDate);
          html += '<span class="yb-schedule__pass-stat">' + t('schedule_expires') + ' ' + expDate.toLocaleDateString(isDa() ? 'da-DK' : 'en-GB', { day: 'numeric', month: 'short' }) + '</span>';
        }
        html += '</div>';
        html += '</div>';
        passInfoEl.innerHTML = html;
        passInfoEl.hidden = false;
      }
    }
    // Don't show no-pass by default — only show after a booking fails
  }

  function renderSchedule(container, classes, weekStart) {
    var days = {};
    var dayNames = isDa()
      ? ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag']
      : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    classes.forEach(function(cls) {
      var d = new Date(cls.startDateTime);
      var key = toDateStr(d);
      if (!days[key]) days[key] = { date: d, classes: [] };
      days[key].classes.push(cls);
    });

    var html = '';
    var sortedKeys = Object.keys(days).sort();
    sortedKeys.forEach(function(key) {
      var day = days[key];
      // Sort classes within each day by start time
      day.classes.sort(function(a, b) {
        return new Date(a.startDateTime) - new Date(b.startDateTime);
      });
      var dateObj = day.date;
      var dayName = dayNames[dateObj.getDay()];
      var dateLabel = dateObj.toLocaleDateString(isDa() ? 'da-DK' : 'en-GB', { day: 'numeric', month: 'long' });

      html += '<div class="yb-schedule__day">';
      html += '<h3 class="yb-schedule__day-label">' + dayName + ' <span>' + dateLabel + '</span></h3>';

      day.classes.forEach(function(cls) {
        var startTime = formatTime(cls.startDateTime);
        var endTime = formatTime(cls.endDateTime);
        var isPast = new Date(cls.startDateTime) < new Date();
        var descId = 'yb-desc-' + cls.id;

        html += '<div class="yb-schedule__class' + (cls.isCanceled ? ' is-cancelled' : '') + (isPast ? ' is-past' : '') + '">';
        html += '  <div class="yb-schedule__class-time">' + startTime + ' – ' + endTime + '</div>';
        html += '  <div class="yb-schedule__class-info">';
        html += '    <span class="yb-schedule__class-name">' + esc(cls.name) + '</span>';
        html += '    <span class="yb-schedule__class-instructor">' + esc(cls.instructor) + '</span>';
        if (cls.spotsLeft !== null && cls.spotsLeft > 0 && !cls.isCanceled && !isPast) {
          html += '    <span class="yb-schedule__class-spots">' + cls.spotsLeft + ' ' + t('schedule_spots_left') + '</span>';
        }
        // Class description toggle
        if (cls.description) {
          html += '    <button class="yb-schedule__desc-toggle" type="button" data-toggle-desc="' + descId + '">' + t('schedule_show_desc') + '</button>';
        }
        html += '  </div>';
        html += '  <div class="yb-schedule__class-action">';

        if (cls.isCanceled) {
          html += '<span class="yb-schedule__badge yb-schedule__badge--cancelled">' + t('schedule_cancelled') + '</span>';
        } else if (isPast) {
          // No action for past classes
        } else if (cls.isBooked) {
          html += '<button class="yb-btn yb-btn--outline yb-schedule__cancel-btn" type="button" data-schedule-cancel="' + cls.id + '">' + t('schedule_cancel') + '</button>';
        } else if (cls.spotsLeft === 0) {
          html += '<span class="yb-schedule__badge yb-schedule__badge--full">' + t('schedule_full') + '</span>';
        } else {
          // Always show Book for available future classes — let backend validate
          html += '<button class="yb-btn yb-btn--primary yb-schedule__book-btn" type="button" data-schedule-book="' + cls.id + '">' + t('schedule_book') + '</button>';
        }

        html += '  </div>';
        html += '</div>';

        // Expandable description (render HTML from Mindbody)
        if (cls.description) {
          html += '<div class="yb-schedule__desc" id="' + descId + '" hidden>';
          html += '<div class="yb-schedule__desc-content">' + cls.description + '</div>';
          html += '</div>';
        }
      });

      html += '</div>';
    });

    container.innerHTML = html;

    // Attach book/cancel handlers
    container.querySelectorAll('[data-schedule-book]').forEach(function(btn) {
      btn.addEventListener('click', function() { bookClass(btn); });
    });
    container.querySelectorAll('[data-schedule-cancel]').forEach(function(btn) {
      btn.addEventListener('click', function() { cancelClass(btn); });
    });
    // Attach description toggle handlers
    container.querySelectorAll('[data-toggle-desc]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var descEl = document.getElementById(btn.getAttribute('data-toggle-desc'));
        if (descEl) {
          var isHidden = descEl.hidden;
          descEl.hidden = !isHidden;
          btn.textContent = isHidden ? t('schedule_hide_desc') : t('schedule_show_desc');
        }
      });
    });
  }

  function bookClass(btn) {
    var classId = btn.getAttribute('data-schedule-book');
    if (!clientId) {
      var noPassEl = document.getElementById('yb-schedule-no-pass');
      if (noPassEl) noPassEl.hidden = false;
      return;
    }

    btn.disabled = true;
    btn.textContent = isDa() ? 'Booker...' : 'Booking...';

    fetch('/.netlify/functions/mb-book', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: clientId, classId: Number(classId) })
    }).then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.success || data.alreadyBooked) {
          showScheduleToast(data.alreadyBooked
            ? (isDa() ? 'Du er allerede booket!' : "You're already booked!")
            : (isDa() ? 'Du er booket!' : "You're booked!"), 'success');
          // Switch button to Cancel
          btn.textContent = isDa() ? 'Annuller' : 'Cancel';
          btn.className = 'yb-btn yb-btn--outline yb-schedule__cancel-btn';
          btn.removeAttribute('data-schedule-book');
          btn.setAttribute('data-schedule-cancel', classId);
          btn.disabled = false;
          // Re-attach as cancel handler
          btn.addEventListener('click', function() { cancelClass(btn); });
          // Refresh pass data (booking uses a clip)
          clientPassData = null;
          loadSchedulePassInfo();
        } else {
          // No active membership or pass
          if (data.error === 'no_pass') {
            var noPassEl = document.getElementById('yb-schedule-no-pass');
            if (noPassEl) noPassEl.hidden = false;
            // Hide pass info banner if it was shown
            var passInfoEl = document.getElementById('yb-schedule-pass-info');
            if (passInfoEl) passInfoEl.hidden = true;
            showScheduleToast(isDa() ? 'Du har brug for et klippekort eller medlemskab.' : 'You need a class pass or membership.', 'error');
          } else {
            showScheduleToast(data.error || (isDa() ? 'Booking fejlede.' : 'Booking failed.'), 'error');
          }
          btn.disabled = false;
          btn.textContent = isDa() ? 'Book' : 'Book';
        }
      }).catch(function(err) {
        showScheduleToast(err.message || (isDa() ? 'Booking fejlede.' : 'Booking failed.'), 'error');
        btn.disabled = false;
        btn.textContent = isDa() ? 'Book' : 'Book';
      });
  }

  function cancelClass(btn) {
    var classId = btn.getAttribute('data-schedule-cancel');
    if (!clientId) return;

    btn.disabled = true;
    btn.textContent = isDa() ? 'Annullerer...' : 'Cancelling...';

    fetch('/.netlify/functions/mb-book', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: clientId, classId: Number(classId) })
    }).then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.success) {
          showScheduleToast(isDa() ? 'Booking annulleret.' : 'Booking cancelled.', 'success');
          // Switch button back to Book
          btn.textContent = isDa() ? 'Book' : 'Book';
          btn.className = 'yb-btn yb-btn--primary yb-schedule__book-btn';
          btn.removeAttribute('data-schedule-cancel');
          btn.setAttribute('data-schedule-book', classId);
          btn.disabled = false;
          btn.addEventListener('click', function() { bookClass(btn); });
          // Refresh pass data (cancel returns a clip)
          clientPassData = null;
          loadSchedulePassInfo();
        } else {
          showScheduleToast(data.error || (isDa() ? 'Annullering fejlede.' : 'Cancellation failed.'), 'error');
          btn.disabled = false;
          btn.textContent = isDa() ? 'Annuller' : 'Cancel';
        }
      }).catch(function(err) {
        showScheduleToast(err.message || (isDa() ? 'Annullering fejlede.' : 'Cancellation failed.'), 'error');
        btn.disabled = false;
        btn.textContent = isDa() ? 'Annuller' : 'Cancel';
      });
  }

  function showScheduleToast(msg, type) {
    var el = document.getElementById('yb-schedule-toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'yb-schedule__toast yb-schedule__toast--' + type;
    el.hidden = false;
    setTimeout(function() { el.hidden = true; }, 3500);
  }

  // ══════════════════════════════════════
  // VISITS TAB
  // ══════════════════════════════════════
  var allVisits = []; // Cache for filtering
  var activeVisitFilter = 'all';

  function initVisitFilters() {
    document.querySelectorAll('[data-visit-filter]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        activeVisitFilter = btn.getAttribute('data-visit-filter');
        document.querySelectorAll('[data-visit-filter]').forEach(function(b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        if (allVisits.length) {
          var listEl = document.getElementById('yb-visits-list');
          if (listEl) renderVisits(listEl, filterVisits(allVisits));
        }
      });
    });
  }

  function filterVisits(visits) {
    if (activeVisitFilter === 'all') return visits;
    var now = new Date();
    return visits.filter(function(v) {
      if (activeVisitFilter === 'upcoming') return v.isFuture || new Date(v.startDateTime) > now;
      if (activeVisitFilter === 'attended') return v.signedIn;
      if (activeVisitFilter === 'noshow') return !v.signedIn && !v.lateCancelled && !v.isFuture && new Date(v.startDateTime) <= now;
      return true;
    });
  }

  function loadVisits() {
    var listEl = document.getElementById('yb-visits-list');
    if (!listEl || !clientId) {
      if (listEl) listEl.innerHTML = '<p class="yb-store__empty">' + t('visits_empty') + '</p>';
      return;
    }

    fetch('/.netlify/functions/mb-visits?clientId=' + clientId)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        allVisits = data.visits || [];
        if (!allVisits.length) { listEl.innerHTML = '<p class="yb-store__empty">' + t('visits_empty') + '</p>'; return; }
        renderVisits(listEl, filterVisits(allVisits));
      })
      .catch(function() { listEl.innerHTML = '<p class="yb-store__error">' + t('visits_error') + '</p>'; });
  }

  function renderVisits(container, visits) {
    // Sort newest first
    visits.sort(function(a, b) { return new Date(b.startDateTime) - new Date(a.startDateTime); });

    if (!visits.length) {
      container.innerHTML = '<p class="yb-store__empty">' + t('visits_empty') + '</p>';
      return;
    }

    var html = '<div class="yb-visits__table">';
    html += '<div class="yb-visits__row yb-visits__row--header">';
    html += '<span>' + (isDa() ? 'Dato' : 'Date') + '</span>';
    html += '<span>' + (isDa() ? 'Hold' : 'Class') + '</span>';
    html += '<span>' + (isDa() ? 'Instruktør' : 'Instructor') + '</span>';
    html += '<span>' + (isDa() ? 'Status' : 'Status') + '</span>';
    html += '</div>';

    var now = new Date();

    visits.forEach(function(v) {
      var d = new Date(v.startDateTime);
      var dateStr = d.toLocaleDateString(isDa() ? 'da-DK' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      var timeStr = formatTime(v.startDateTime);
      var isFuture = v.isFuture || d > now;

      var status = '';
      var statusClass = '';
      if (v.lateCancelled) {
        status = t('visits_late_cancel');
        statusClass = 'yb-visits__status--late';
      } else if (isFuture) {
        status = t('visits_booked');
        statusClass = 'yb-visits__status--booked';
      } else if (v.signedIn) {
        status = t('visits_signed_in');
        statusClass = 'yb-visits__status--attended';
      } else {
        status = t('visits_no_show');
        statusClass = 'yb-visits__status--noshow';
      }

      html += '<div class="yb-visits__row' + (isFuture ? ' yb-visits__row--future' : '') + '">';
      html += '<span class="yb-visits__date">' + dateStr + '<br><small>' + timeStr + '</small></span>';
      html += '<span class="yb-visits__name">' + esc(v.name) + '</span>';
      html += '<span class="yb-visits__instructor">' + esc(v.instructor) + '</span>';
      html += '<span class="yb-visits__status ' + statusClass + '">' + status + '</span>';
      html += '</div>';
    });

    html += '</div>';
    container.innerHTML = html;
  }

  // ══════════════════════════════════════
  // RECEIPTS TAB
  // ══════════════════════════════════════
  function loadReceipts() {
    var listEl = document.getElementById('yb-receipts-list');
    if (!listEl || !clientId) {
      if (listEl) listEl.innerHTML = '<p class="yb-store__empty">' + t('receipts_empty') + '</p>';
      return;
    }

    fetch('/.netlify/functions/mb-purchases?clientId=' + clientId)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var purchases = data.purchases || [];
        if (!purchases.length) { listEl.innerHTML = '<p class="yb-store__empty">' + t('receipts_empty') + '</p>'; return; }
        renderReceipts(listEl, purchases);
      })
      .catch(function() { listEl.innerHTML = '<p class="yb-store__error">' + t('receipts_error') + '</p>'; });
  }

  function renderReceipts(container, purchases) {
    // Sort newest first
    purchases.sort(function(a, b) { return new Date(b.saleDate) - new Date(a.saleDate); });

    var html = '<div class="yb-receipts__list-inner">';

    purchases.forEach(function(p) {
      var d = new Date(p.saleDate);
      var dateStr = d.toLocaleDateString(isDa() ? 'da-DK' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      var name = p.serviceName || p.description || '—';
      var paymentDisplay = p.paymentMethod || '—';
      if (p.paymentLast4) paymentDisplay += ' ****' + p.paymentLast4;

      html += '<div class="yb-receipts__card' + (p.returned ? ' yb-receipts__card--returned' : '') + '">';
      html += '<div class="yb-receipts__card-header">';
      html += '<span class="yb-receipts__card-date">' + dateStr + '</span>';
      if (p.returned) {
        html += '<span class="yb-receipts__card-badge yb-receipts__card-badge--returned">' + (isDa() ? 'Refunderet' : 'Refunded') + '</span>';
      }
      html += '</div>';
      html += '<div class="yb-receipts__card-body">';
      html += '<span class="yb-receipts__card-name">' + esc(name) + '</span>';
      if (p.quantity > 1) {
        html += '<span class="yb-receipts__card-qty">' + (isDa() ? 'Antal' : 'Qty') + ': ' + p.quantity + '</span>';
      }
      html += '</div>';
      html += '<div class="yb-receipts__card-footer">';
      html += '<span class="yb-receipts__card-amount">' + formatDKK(p.amountPaid || p.price) + '</span>';
      html += '<span class="yb-receipts__card-payment">' + esc(paymentDisplay) + '</span>';
      html += '</div>';
      if (p.discount > 0) {
        html += '<div class="yb-receipts__card-discount">' + (isDa() ? 'Rabat' : 'Discount') + ': -' + formatDKK(p.discount) + '</div>';
      }
      html += '</div>';
    });

    html += '</div>';
    container.innerHTML = html;
  }

  // ══════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════
  function isDa() { return window.location.pathname.indexOf('/en/') !== 0; }

  // Quick i18n helper — reads translation key or returns key
  function t(key) {
    var map = {
      store_empty: isDa() ? 'Ingen pakker tilgængelige lige nu.' : 'No packages available right now.',
      store_error: isDa() ? 'Kunne ikke hente pakker.' : 'Could not load packages.',
      store_buy: isDa() ? 'Køb' : 'Buy',
      checkout_error: isDa() ? 'Betalingen fejlede.' : 'Payment failed.',
      schedule_loading: isDa() ? 'Henter hold...' : 'Loading classes...',
      schedule_empty: isDa() ? 'Ingen hold tilgængelige denne uge.' : 'No classes available this week.',
      schedule_error: isDa() ? 'Kunne ikke hente skema.' : 'Could not load schedule.',
      schedule_book: isDa() ? 'Book' : 'Book',
      schedule_cancel: isDa() ? 'Annuller' : 'Cancel',
      schedule_booked: isDa() ? 'Booket' : 'Booked',
      schedule_full: isDa() ? 'Fuldt' : 'Full',
      schedule_cancelled: isDa() ? 'Aflyst' : 'Cancelled',
      schedule_spots_left: isDa() ? 'pladser tilbage' : 'spots left',
      schedule_pass_info: isDa() ? 'Dit aktive klippekort' : 'Your active pass',
      schedule_remaining: isDa() ? 'klip tilbage' : 'sessions left',
      schedule_expires: isDa() ? 'Udløber' : 'Expires',
      schedule_show_desc: isDa() ? 'Vis beskrivelse' : 'Show description',
      schedule_hide_desc: isDa() ? 'Skjul beskrivelse' : 'Hide description',
      visits_empty: isDa() ? 'Ingen besøg endnu.' : 'No visits yet.',
      visits_error: isDa() ? 'Kunne ikke hente besøgshistorik.' : 'Could not load visit history.',
      visits_signed_in: isDa() ? 'Deltaget' : 'Attended',
      visits_no_show: isDa() ? 'Udeblivelse' : 'No show',
      visits_late_cancel: isDa() ? 'Sen annullering' : 'Late cancellation',
      visits_booked: isDa() ? 'Booket' : 'Booked',
      receipts_empty: isDa() ? 'Ingen kvitteringer endnu.' : 'No receipts yet.',
      receipts_error: isDa() ? 'Kunne ikke hente kvitteringer.' : 'Could not load receipts.',
      receipts_date: isDa() ? 'Dato' : 'Date',
      receipts_item: isDa() ? 'Vare' : 'Item',
      receipts_amount: isDa() ? 'Beløb' : 'Amount',
      receipts_payment: isDa() ? 'Betaling' : 'Payment',
      membership_active_passes: isDa() ? 'Aktive Klippekort' : 'Active Passes',
      membership_no_active: isDa() ? 'Ingen aktive klippekort.' : 'No active passes.',
      membership_remaining: isDa() ? 'klip tilbage' : 'sessions left',
      membership_expires: isDa() ? 'Udløber' : 'Expires',
      membership_unlimited: isDa() ? 'Ubegrænset' : 'Unlimited',
      membership_contracts: isDa() ? 'Abonnementer' : 'Subscriptions',
      membership_no_contracts: isDa() ? 'Ingen aktive abonnementer.' : 'No active subscriptions.',
      membership_autopay: isDa() ? 'Automatisk betaling' : 'Auto-pay',
      membership_status_active: isDa() ? 'Aktiv' : 'Active',
      membership_past_passes: isDa() ? 'Tidligere Klippekort' : 'Past Passes',
      membership_no_past: isDa() ? 'Ingen tidligere klippekort.' : 'No past passes.'
    };
    return map[key] || key;
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
    if (!isError && successEl) setTimeout(function() { successEl.hidden = true; }, 4000);
  }

  function showSimpleError(el, msg) { if (el) { el.textContent = msg; el.hidden = false; } }

  function formatDKK(amount) { return amount.toLocaleString('da-DK', { style: 'currency', currency: 'DKK', minimumFractionDigits: 0 }); }

  function formatTime(isoStr) {
    var d = new Date(isoStr);
    return d.toLocaleTimeString(isDa() ? 'da-DK' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  function toDateStr(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function esc(str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // ══════════════════════════════════════
  // MY COURSES TAB
  // ══════════════════════════════════════
  function loadMyCourses() {
    if (!currentUser || !currentDb) return;
    var container = document.getElementById('yb-profile-courses');
    var emptyEl = document.getElementById('yb-profile-courses-empty');
    if (!container) return;

    var lang = isDa() ? 'da' : 'en';
    var t = {
      progress: isDa() ? 'fremgang' : 'progress',
      continue_btn: isDa() ? 'Fortsæt' : 'Continue',
      start_btn: 'Start',
      open_btn: isDa() ? 'Åbn kursus' : 'Open course',
      modules: isDa() ? 'moduler' : 'modules'
    };

    // 1. Find enrollments for this user (single where to avoid composite index)
    currentDb.collection('enrollments')
      .where('userId', '==', currentUser.uid)
      .get()
      .then(function(snap) {
        var courseIds = [];
        snap.forEach(function(doc) {
          var d = doc.data();
          if (d.status === 'active') courseIds.push(d.courseId);
        });
        if (!courseIds.length) {
          container.innerHTML = '';
          if (emptyEl) emptyEl.hidden = false;
          return;
        }
        if (emptyEl) emptyEl.hidden = true;

        // 2. Fetch each course — modules and progress are optional (may fail on rules)
        var promises = courseIds.map(function(courseId) {
          return currentDb.collection('courses').doc(courseId).get()
            .then(function(courseDoc) {
              if (!courseDoc.exists) return null;
              // Try loading modules count (may fail for non-admin)
              var modulesPromise = currentDb.collection('courses').doc(courseId)
                .collection('modules').orderBy('order').get()
                .then(function(snap) { return snap.size; })
                .catch(function() { return 0; }); // silently fallback
              // Try loading progress (may not exist yet)
              var progressPromise = currentDb.collection('courseProgress')
                .doc(currentUser.uid + '_' + courseId).get()
                .then(function(doc) { return doc.exists ? doc.data() : null; })
                .catch(function() { return null; }); // silently fallback
              return Promise.all([modulesPromise, progressPromise])
                .then(function(results) {
                  return {
                    id: courseId,
                    course: courseDoc.data(),
                    moduleCount: results[0],
                    progress: results[1]
                  };
                });
            }).catch(function(err) {
              console.warn('Could not load course ' + courseId + ':', err);
              return null;
            });
        });

        return Promise.all(promises);
      })
      .then(function(courses) {
        if (!courses) return;
        courses = courses.filter(function(c) { return c !== null; });
        if (!courses.length) {
          container.innerHTML = '<p style="color:#6F6A66;text-align:center;padding:2rem;">' +
            (isDa() ? 'Kurser fundet men kunne ikke indlæses. Tjek Firestore regler.' : 'Courses found but could not load. Check Firestore rules.') + '</p>';
          return;
        }
        renderCourseCards(container, courses, lang, t);
      })
      .catch(function(err) {
        console.error('Error loading courses:', err);
        var msg = err.message || '';
        var hint = '';
        if (msg.indexOf('ermission') > -1) hint = isDa() ? ' (Firestore regler mangler)' : ' (Firestore rules issue)';
        if (msg.indexOf('index') > -1) hint = isDa() ? ' (Firestore index mangler)' : ' (Firestore index needed)';
        container.innerHTML = '<p style="color:#6F6A66;text-align:center;padding:2rem;">' +
          (isDa() ? 'Kunne ikke hente kurser.' : 'Could not load courses.') + hint + '</p>';
      });
  }

  function renderCourseCards(container, courses, lang, t) {
    if (!courses.length) {
      container.innerHTML = '';
      var emptyEl = document.getElementById('yb-profile-courses-empty');
      if (emptyEl) emptyEl.hidden = false;
      return;
    }

    var html = courses.map(function(item) {
      var c = item.course;
      var title = c['title_' + lang] || c.title_da || 'Course';
      var desc = c['description_' + lang] || c.description_da || '';
      var icon = c.icon || '📖';

      // Calculate progress
      var viewed = item.progress && item.progress.viewed ? Object.keys(item.progress.viewed).length : 0;
      var hasProgress = viewed > 0;
      var btnLabel = hasProgress ? t.continue_btn : t.start_btn;

      // Build data attributes for inline course viewer
      var dataAttrs = 'data-course-open="' + item.id + '"';
      if (item.progress && item.progress.lastModule) {
        dataAttrs += ' data-module="' + item.progress.lastModule + '"';
      }
      if (item.progress && item.progress.lastChapter) {
        dataAttrs += ' data-chapter="' + item.progress.lastChapter + '"';
      }

      return '<div class="yb-profile__course-card">' +
        '<div class="yb-profile__course-icon">' + icon + '</div>' +
        '<div class="yb-profile__course-info">' +
          '<h3 class="yb-profile__course-name">' + esc(title) + '</h3>' +
          '<p class="yb-profile__course-desc">' + esc(desc) + '</p>' +
          '<span class="yb-profile__course-meta">' + item.moduleCount + ' ' + t.modules +
            (hasProgress ? ' · ' + viewed + ' ' + (isDa() ? 'kapitler læst' : 'chapters read') : '') +
          '</span>' +
        '</div>' +
        '<button type="button" ' + dataAttrs + ' class="yb-btn yb-btn--primary yb-profile__course-btn">' + btnLabel + '</button>' +
      '</div>';
    }).join('');

    container.innerHTML = html;

    // Bind inline course viewer buttons
    container.querySelectorAll('[data-course-open]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var courseId = btn.getAttribute('data-course-open');
        var moduleId = btn.getAttribute('data-module') || null;
        var chapterId = btn.getAttribute('data-chapter') || null;
        openCourseViewer(courseId, moduleId, chapterId);
      });
    });
  }

  // ══════════════════════════════════════
  // INLINE COURSE VIEWER
  // ══════════════════════════════════════
  function openCourseViewer(courseId, moduleId, chapterId) {
    var listEl = document.getElementById('yb-profile-courses-list');
    var viewerEl = document.getElementById('yb-profile-course-viewer');
    if (!listEl || !viewerEl) return;

    // Hide course list, show viewer
    listEl.hidden = true;
    viewerEl.hidden = false;

    // Scroll to top of viewer
    viewerEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Init the course viewer in embedded mode
    if (window.YBCourseViewer) {
      window.YBCourseViewer.init(courseId, {
        embedded: true,
        lang: isDa() ? 'da' : 'en',
        module: moduleId,
        chapter: chapterId,
        onBack: function() {
          closeCourseViewer();
        }
      });
    }
  }

  function closeCourseViewer() {
    var listEl = document.getElementById('yb-profile-courses-list');
    var viewerEl = document.getElementById('yb-profile-course-viewer');
    if (!listEl || !viewerEl) return;

    // Destroy the viewer and hide it
    if (window.YBCourseViewer) {
      window.YBCourseViewer.destroy();
    }
    viewerEl.hidden = true;
    listEl.hidden = false;

    // Re-load courses to refresh progress
    tabLoaded['courses'] = false;
    loadMyCourses();
  }

})();
