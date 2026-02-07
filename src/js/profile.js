/**
 * YOGA BIBLE — PROFILE PAGE
 * Tabs: Profile, Schedule, Store, Visit History, Receipts
 */
(function() {
  'use strict';

  var currentUser = null;
  var currentDb = null;
  var clientId = null; // Mindbody client ID from Firestore

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

    auth.onAuthStateChanged(function(user) {
      if (user) {
        currentUser = user;
        guestEl.style.display = 'none';
        userEl.style.display = 'block';
        loadProfile(user, db);
        ensureBackendClient(user, db);

        // Deep-link to courses tab via hash
        var hash = window.location.hash;
        if (hash === '#mine-kurser' || hash === '#my-courses') {
          var coursesTab = document.querySelector('[data-yb-tab="courses"]');
          if (coursesTab) coursesTab.click();
        }
      } else {
        currentUser = null;
        clientId = null;
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
            firstName: firstName, lastName: lastName, name: fullName, phone: phone,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        }).then(function() {
          showMsg(errorEl, successEl, isDa() ? 'Dine oplysninger er opdateret.' : 'Your details have been updated.', false);
          var nameEl = document.getElementById('yb-profile-display-name');
          var avatarEl = document.getElementById('yb-profile-avatar');
          if (nameEl) nameEl.textContent = fullName;
          if (avatarEl) avatarEl.textContent = getInitials(fullName);

          // Sync to backend silently
          if (clientId) {
            fetch('/.netlify/functions/mb-client', {
              method: 'PUT', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ clientId: clientId, firstName: firstName, lastName: lastName, phone: phone, email: user.email })
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
      if (fnEl) fnEl.value = d.firstName || '';
      if (lnEl) lnEl.value = d.lastName || '';
      if (phEl) phEl.value = d.phone || '';

      if (d.mindbodyClientId) clientId = d.mindbodyClientId;

      // Load saved profile picture
      if (d.photoURL && avatarEl) {
        avatarEl.style.backgroundImage = 'url(' + d.photoURL + ')';
        avatarEl.textContent = '';
        avatarEl.classList.add('has-photo');
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
        } else if (data.requiresSCA) {
          showSimpleError(errorEl, isDa() ? 'Dit kort kræver yderligere godkendelse.' : 'Your card requires additional authentication.');
        } else {
          console.error('[Checkout] Error:', data.error, data.details);
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

    console.log('[Schedule] Fetching:', url, 'week offset:', scheduleWeekOffset);

    fetch(url)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var classes = data.classes || [];
        if (!classes.length) { listEl.innerHTML = '<p class="yb-store__empty">' + t('schedule_empty') + '</p>'; return; }
        renderSchedule(listEl, classes, start);
      })
      .catch(function() { listEl.innerHTML = '<p class="yb-store__error">' + t('schedule_error') + '</p>'; });
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

        html += '<div class="yb-schedule__class' + (cls.isCanceled ? ' is-cancelled' : '') + (isPast ? ' is-past' : '') + '">';
        html += '  <div class="yb-schedule__class-time">' + startTime + ' – ' + endTime + '</div>';
        html += '  <div class="yb-schedule__class-info">';
        html += '    <span class="yb-schedule__class-name">' + esc(cls.name) + '</span>';
        html += '    <span class="yb-schedule__class-instructor">' + esc(cls.instructor) + '</span>';
        if (cls.spotsLeft !== null && cls.spotsLeft > 0 && !cls.isCanceled && !isPast) {
          html += '    <span class="yb-schedule__class-spots">' + cls.spotsLeft + ' ' + t('schedule_spots_left') + '</span>';
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
        } else if (cls.isAvailable) {
          html += '<button class="yb-btn yb-btn--primary yb-schedule__book-btn" type="button" data-schedule-book="' + cls.id + '">' + t('schedule_book') + '</button>';
        }

        html += '  </div>';
        html += '</div>';
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
        if (data.success) {
          showScheduleToast(isDa() ? 'Du er booket!' : "You're booked!", 'success');
          // Switch button to Cancel
          btn.textContent = isDa() ? 'Annuller' : 'Cancel';
          btn.className = 'yb-btn yb-btn--outline yb-schedule__cancel-btn';
          btn.removeAttribute('data-schedule-book');
          btn.setAttribute('data-schedule-cancel', classId);
          btn.disabled = false;
          // Re-attach as cancel handler
          btn.addEventListener('click', function() { cancelClass(btn); });
        } else {
          // No active membership or pass
          if (data.error === 'no_pass') {
            var noPassEl = document.getElementById('yb-schedule-no-pass');
            if (noPassEl) noPassEl.hidden = false;
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
  function loadVisits() {
    var listEl = document.getElementById('yb-visits-list');
    if (!listEl || !clientId) {
      if (listEl) listEl.innerHTML = '<p class="yb-store__empty">' + t('visits_empty') + '</p>';
      return;
    }

    fetch('/.netlify/functions/mb-visits?clientId=' + clientId)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var visits = data.visits || [];
        if (!visits.length) { listEl.innerHTML = '<p class="yb-store__empty">' + t('visits_empty') + '</p>'; return; }
        renderVisits(listEl, visits);
      })
      .catch(function() { listEl.innerHTML = '<p class="yb-store__error">' + t('visits_error') + '</p>'; });
  }

  function renderVisits(container, visits) {
    // Sort newest first
    visits.sort(function(a, b) { return new Date(b.startDateTime) - new Date(a.startDateTime); });

    var html = '<div class="yb-visits__table">';
    html += '<div class="yb-visits__row yb-visits__row--header">';
    html += '<span>' + (isDa() ? 'Dato' : 'Date') + '</span>';
    html += '<span>' + (isDa() ? 'Hold' : 'Class') + '</span>';
    html += '<span>' + (isDa() ? 'Instruktør' : 'Instructor') + '</span>';
    html += '<span>' + (isDa() ? 'Status' : 'Status') + '</span>';
    html += '</div>';

    visits.forEach(function(v) {
      var d = new Date(v.startDateTime);
      var dateStr = d.toLocaleDateString(isDa() ? 'da-DK' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      var timeStr = formatTime(v.startDateTime);

      var status = '';
      var statusClass = '';
      if (v.lateCancelled) { status = t('visits_late_cancel'); statusClass = 'yb-visits__status--late'; }
      else if (v.signedIn) { status = t('visits_signed_in'); statusClass = 'yb-visits__status--attended'; }
      else { status = t('visits_no_show'); statusClass = 'yb-visits__status--noshow'; }

      html += '<div class="yb-visits__row">';
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

    var html = '<div class="yb-receipts__table">';
    html += '<div class="yb-receipts__row yb-receipts__row--header">';
    html += '<span>' + t('receipts_date') + '</span>';
    html += '<span>' + t('receipts_item') + '</span>';
    html += '<span>' + t('receipts_amount') + '</span>';
    html += '<span>' + t('receipts_payment') + '</span>';
    html += '</div>';

    purchases.forEach(function(p) {
      var d = new Date(p.saleDate);
      var dateStr = d.toLocaleDateString(isDa() ? 'da-DK' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      var name = p.serviceName || p.description || '—';

      html += '<div class="yb-receipts__row' + (p.returned ? ' yb-receipts__row--returned' : '') + '">';
      html += '<span class="yb-receipts__date">' + dateStr + '</span>';
      html += '<span class="yb-receipts__name">' + esc(name) + '</span>';
      html += '<span class="yb-receipts__amount">' + formatDKK(p.amountPaid || p.price) + '</span>';
      html += '<span class="yb-receipts__payment">' + esc(p.paymentMethod || '—') + '</span>';
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
      visits_empty: isDa() ? 'Ingen besøg endnu.' : 'No visits yet.',
      visits_error: isDa() ? 'Kunne ikke hente besøgshistorik.' : 'Could not load visit history.',
      visits_signed_in: isDa() ? 'Deltaget' : 'Attended',
      visits_no_show: isDa() ? 'Udeblivelse' : 'No show',
      visits_late_cancel: isDa() ? 'Sen annullering' : 'Late cancellation',
      receipts_empty: isDa() ? 'Ingen kvitteringer endnu.' : 'No receipts yet.',
      receipts_error: isDa() ? 'Kunne ikke hente kvitteringer.' : 'Could not load receipts.',
      receipts_date: isDa() ? 'Dato' : 'Date',
      receipts_item: isDa() ? 'Vare' : 'Item',
      receipts_amount: isDa() ? 'Beløb' : 'Amount',
      receipts_payment: isDa() ? 'Betaling' : 'Payment'
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

    // 1. Find enrollments for this user
    currentDb.collection('enrollments')
      .where('userId', '==', currentUser.uid)
      .where('status', '==', 'active')
      .get()
      .then(function(snap) {
        if (snap.empty) {
          container.innerHTML = '';
          if (emptyEl) emptyEl.hidden = false;
          return;
        }
        if (emptyEl) emptyEl.hidden = true;

        var courseIds = [];
        snap.forEach(function(doc) { courseIds.push(doc.data().courseId); });

        // 2. Fetch each course and its progress
        var promises = courseIds.map(function(courseId) {
          return Promise.all([
            currentDb.collection('courses').doc(courseId).get(),
            currentDb.collection('courses').doc(courseId).collection('modules').orderBy('order').get(),
            currentDb.collection('courseProgress').doc(currentUser.uid + '_' + courseId).get()
          ]).then(function(results) {
            var courseDoc = results[0];
            var modulesSnap = results[1];
            var progressDoc = results[2];
            if (!courseDoc.exists) return null;
            return {
              id: courseId,
              course: courseDoc.data(),
              moduleCount: modulesSnap.size,
              progress: progressDoc.exists ? progressDoc.data() : null
            };
          });
        });

        return Promise.all(promises);
      })
      .then(function(courses) {
        if (!courses) return;
        courses = courses.filter(function(c) { return c !== null; });
        renderCourseCards(container, courses, lang, t);
      })
      .catch(function(err) {
        console.error('Error loading courses:', err);
        container.innerHTML = '<p style="color:#6F6A66;text-align:center;padding:2rem;">' +
          (isDa() ? 'Kunne ikke hente kurser.' : 'Could not load courses.') + '</p>';
      });
  }

  function renderCourseCards(container, courses, lang, t) {
    if (!courses.length) {
      container.innerHTML = '';
      var emptyEl = document.getElementById('yb-profile-courses-empty');
      if (emptyEl) emptyEl.hidden = false;
      return;
    }

    var lp = lang === 'en' ? '/en' : '';
    var viewerPath = lang === 'en' ? '/en/course-material/' : '/kursus-materiale/';

    var html = courses.map(function(item) {
      var c = item.course;
      var title = c['title_' + lang] || c.title_da || 'Course';
      var desc = c['description_' + lang] || c.description_da || '';
      var icon = c.icon || '📖';

      // Calculate progress
      var viewed = item.progress && item.progress.viewed ? Object.keys(item.progress.viewed).length : 0;
      var pct = 0;
      // We don't know total chapters without fetching all, so show viewed count
      var hasProgress = viewed > 0;
      var btnLabel = hasProgress ? t.continue_btn : t.start_btn;
      var btnUrl = viewerPath + '?course=' + item.id;

      // If user has progress, deep-link to last chapter
      if (item.progress && item.progress.lastModule && item.progress.lastChapter) {
        btnUrl += '&module=' + item.progress.lastModule + '&chapter=' + item.progress.lastChapter;
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
        '<a href="' + btnUrl + '" class="yb-btn yb-btn--primary yb-profile__course-btn">' + btnLabel + '</a>' +
      '</div>';
    }).join('');

    container.innerHTML = html;
  }

})();
