/**
 * HOT YOGA COPENHAGEN - PROFILE DASHBOARD
 * Adapted from Yoga Bible DK. 6-tab dashboard: Profile, Schedule, Store, Visits, Passes, Receipts.
 * Language: localStorage-based (hycph-lang key)
 */
(function() {
  'use strict';

  var currentUser = null;
  var currentDb = null;
  var clientId = null; // Mindbody client ID from Firestore
  var clientPassData = null; // Cached pass/service data
  var staffCache = {}; // Cache staff bios by ID
  var bgRefreshInterval = null; // Background refresh timer
  var userDateOfBirth = null; // YYYY-MM-DD from Firestore, used for age-based store filtering

  var waiverSigned = false; // Track if liability waiver is signed
  var waiverStatusLoaded = false; // True once we know the actual status

  // ── Simple canvas signature pad ──
  function SignaturePad(canvasId, clearBtnId) {
    var canvas = document.getElementById(canvasId);
    var clearBtn = document.getElementById(clearBtnId);
    if (!canvas) return null;
    var ctx = canvas.getContext('2d');
    var drawing = false;
    var hasStrokes = false;
    var ready = false;

    function resize() {
      var rect = canvas.parentElement.getBoundingClientRect();
      if (rect.width < 1) return; // parent hidden — skip, will resize on first interaction
      var ratio = window.devicePixelRatio || 1;
      canvas.width = rect.width * ratio;
      canvas.height = 160 * ratio;
      canvas.style.width = rect.width + 'px';
      canvas.style.height = '160px';
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#0F0F0F';
      ready = true;
    }
    resize();

    function ensureReady() {
      if (!ready) resize();
    }

    function getPos(e) {
      var rect = canvas.getBoundingClientRect();
      var touch = e.touches ? e.touches[0] : e;
      return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
    }

    function start(e) {
      e.preventDefault();
      ensureReady();
      drawing = true;
      var p = getPos(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }

    function move(e) {
      if (!drawing) return;
      e.preventDefault();
      var p = getPos(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      hasStrokes = true;
    }

    function end() { drawing = false; }

    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('mouseup', end);
    canvas.addEventListener('mouseleave', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);

    if (clearBtn) {
      clearBtn.addEventListener('click', function() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        hasStrokes = false;
      });
    }

    window.addEventListener('resize', function() {
      if (!hasStrokes) resize();
    });

    return {
      isEmpty: function() { return !hasStrokes; },
      toDataURL: function() { return canvas.toDataURL('image/png'); },
      resize: resize,
      clear: function() {
        resize();
        hasStrokes = false;
      }
    };
  }

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
    initGiftCards();
    initScheduleNav();
    initAvatarUpload(db);
    initVisitFilters();

    // Re-render dynamic content when language changes
    window.addEventListener('hycph-lang-change', function() {
      if (tabLoaded['store']) {
        storeServices = buildStoreFromCatalog();
        var listEl = document.getElementById('yb-store-list');
        if (listEl && storeServices.length) renderStoreItems(listEl);
      }
      if (tabLoaded['passes']) loadMembershipDetails();
      if (tabLoaded['giftcards']) {
        var gcList = document.getElementById('yb-giftcards-list');
        if (gcList && giftCardsData) renderGiftCards(gcList);
      }
    });

    auth.onAuthStateChanged(function(user) {
      if (user) {
        currentUser = user;
        guestEl.style.display = 'none';
        userEl.style.display = 'block';
        loadProfile(user, db);
        ensureBackendClient(user, db);
        startBackgroundRefresh();

        // [HYC] Courses tab not used — deep-link code commented out
        // var hash = window.location.hash;
        // if (hash === '#mine-kurser' || hash === '#my-courses' || hash.indexOf('#course=') === 0) {
        //   var coursesTab = document.querySelector('[data-yb-tab="courses"]');
        //   if (coursesTab) coursesTab.click();
        //   if (hash.indexOf('#course=') === 0) {
        //     var deepCourseId = hash.substring(8);
        //     setTimeout(function() {
        //       openCourseViewer(deepCourseId, null, null);
        //     }, 500);
        //   }
        // }
      } else {
        currentUser = null;
        clientId = null;
        clientPassData = null;
        stopBackgroundRefresh();
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
        var yogaLevelEl = document.getElementById('yb-profile-yoga-level');
        var practiceFreqEl = document.getElementById('yb-profile-practice-freq');
        var yogaLevel = yogaLevelEl ? yogaLevelEl.value : '';
        var practiceFrequency = practiceFreqEl ? practiceFreqEl.value : '';
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
          yogaLevel: yogaLevel, practiceFrequency: practiceFrequency,
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

          // Hide onboarding card + unlock tabs if now complete
          if (phone && dob) {
            var reminderEl = document.getElementById('yb-profile-reminder');
            if (reminderEl) reminderEl.hidden = true;
            var onboardingInline = document.getElementById('yb-onboarding-inline');
            if (onboardingInline && !onboardingInline.hidden) {
              onboardingInline.hidden = true;
              var successMsg = document.getElementById('yb-onboarding-success');
              if (successMsg) { successMsg.hidden = false; setTimeout(function() { successMsg.hidden = true; }, 5000); }
              setTabsLocked(false);
            }
          }

          // Sync to backend silently
          // Date format: dob is always YYYY-MM-DD (ISO) from <input type="date"> — no dd/mm vs mm/dd conflict
          if (clientId) {
            var mbData = { clientId: clientId, firstName: firstName, lastName: lastName, phone: phone, email: user.email };
            if (dob) mbData.birthDate = dob;
            console.log('[Profile] Syncing to MB:', JSON.stringify(mbData));
            fetch('/.netlify/functions/mb-client', {
              method: 'PUT', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(mbData)
            }).then(function(r) {
              return r.json().then(function(data) {
                console.log('[Profile] MB sync response:', data);
              });
            }).catch(function(err) { console.error('[Profile] MB sync error:', err); });
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

    // ── Mandatory onboarding form (phone + DOB) ──
    var onboardingForm = document.getElementById('yb-onboarding-form');
    if (onboardingForm) {
      onboardingForm.addEventListener('submit', function(e) {
        e.preventDefault();
        var user = auth.currentUser;
        if (!user) return;

        var phone = document.getElementById('yb-onboarding-phone').value.trim();
        var dob = document.getElementById('yb-onboarding-dob').value;
        var errorEl = document.getElementById('yb-onboarding-error');
        var btn = onboardingForm.querySelector('button[type="submit"]');
        var btnText = btn.textContent;

        // Validate
        if (!phone) {
          if (errorEl) { errorEl.textContent = isDa() ? 'Telefonnummer er påkrævet.' : 'Phone number is required.'; errorEl.hidden = false; }
          return;
        }
        if (!dob) {
          if (errorEl) { errorEl.textContent = isDa() ? 'Fødselsdato er påkrævet.' : 'Date of birth is required.'; errorEl.hidden = false; }
          return;
        }

        if (errorEl) errorEl.hidden = true;
        btn.disabled = true;
        btn.textContent = isDa() ? 'Gemmer...' : 'Saving...';

        // Update Firestore
        var updateData = {
          phone: phone,
          dateOfBirth: dob,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        db.collection('users').doc(user.uid).update(updateData).then(function() {
          // Also update the profile form fields so they're in sync
          var phEl = document.getElementById('yb-profile-phone');
          var dobEl = document.getElementById('yb-profile-dob');
          if (phEl) phEl.value = phone;
          if (dobEl) dobEl.value = dob;

          // Hide the soft reminder
          var reminderEl = document.getElementById('yb-profile-reminder');
          if (reminderEl) reminderEl.hidden = true;

          // Push to Mindbody in background
          // Note: dob is always YYYY-MM-DD from <input type="date"> — safe for MB API (ISO format)
          if (clientId) {
            fetch('/.netlify/functions/mb-client', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ clientId: clientId, phone: phone, birthDate: dob })
            }).catch(function() {});
          } else {
            // clientId may not be ready yet — wait for ensureBackendClient, then push
            var pushInterval = setInterval(function() {
              if (clientId) {
                clearInterval(pushInterval);
                fetch('/.netlify/functions/mb-client', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ clientId: clientId, phone: phone, birthDate: dob })
                }).catch(function() {});
              }
            }, 1000);
            // Stop checking after 15 seconds
            setTimeout(function() { clearInterval(pushInterval); }, 15000);
          }

          // Hide onboarding card, show success, unlock tabs
          var onboardingInline = document.getElementById('yb-onboarding-inline');
          if (onboardingInline) onboardingInline.hidden = true;
          var successEl2 = document.getElementById('yb-onboarding-success');
          if (successEl2) {
            successEl2.hidden = false;
            setTimeout(function() { successEl2.hidden = true; }, 5000);
          }
          setTabsLocked(false);
        }).catch(function(err) {
          if (errorEl) { errorEl.textContent = err.message; errorEl.hidden = false; }
        }).finally(function() {
          btn.disabled = false;
          btn.textContent = btnText;
        });
      });
    }
  }

  // ══════════════════════════════════════
  // TABS
  // ══════════════════════════════════════
  var tabLoaded = {};
  var tabsLocked = false;

  function setTabsLocked(locked) {
    tabsLocked = locked;
    document.querySelectorAll('[data-yb-tab]').forEach(function(btn) {
      var tabName = btn.getAttribute('data-yb-tab');
      if (tabName === 'profile') return; // Profile tab always accessible
      if (locked) {
        btn.classList.add('is-locked');
        btn.setAttribute('aria-disabled', 'true');
      } else {
        btn.classList.remove('is-locked');
        btn.removeAttribute('aria-disabled');
      }
    });
  }

  function initTabs() {
    document.querySelectorAll('[data-yb-tab]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var tabName = btn.getAttribute('data-yb-tab');

        // Block locked tabs (except profile)
        if (tabsLocked && tabName !== 'profile') {
          showTabLockedToast();
          return;
        }

        document.querySelectorAll('[data-yb-tab]').forEach(function(b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        document.querySelectorAll('[data-yb-panel]').forEach(function(p) { p.classList.remove('is-active'); });
        var panel = document.querySelector('[data-yb-panel="' + tabName + '"]');
        if (panel) panel.classList.add('is-active');

        // Load tab content — store loads once (local catalog), others always refresh from API
        if (!tabLoaded[tabName] && tabName === 'store') {
          tabLoaded[tabName] = true;
          loadStore();
        }
        tabLoaded[tabName] = true;
        if (tabName === 'schedule') loadSchedule();
        if (tabName === 'visits') loadVisits();
        if (tabName === 'passes') loadMembershipDetails();
        if (tabName === 'receipts') loadReceipts();
        if (tabName === 'giftcards') loadGiftCards();
      });
    });
  }

  function showTabLockedToast() {
    var msg = isDa()
      ? 'Udfyld venligst telefon og fødselsdato under Profil-fanen først.'
      : 'Please fill in your phone and date of birth in the Profile tab first.';
    // Use schedule toast mechanism or create temporary notification
    var existing = document.getElementById('yb-tab-locked-toast');
    if (existing) { existing.remove(); }
    var toast = document.createElement('div');
    toast.id = 'yb-tab-locked-toast';
    toast.className = 'yb-tab-locked-toast';
    toast.textContent = msg;
    var tabsEl = document.querySelector('.yb-profile__tabs');
    if (tabsEl) tabsEl.parentElement.insertBefore(toast, tabsEl.nextSibling);
    setTimeout(function() { toast.classList.add('is-visible'); }, 10);
    setTimeout(function() { toast.classList.remove('is-visible'); setTimeout(function() { toast.remove(); }, 300); }, 3500);
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
      userDateOfBirth = d.dateOfBirth || null;

      // Yoga level & practice frequency
      var levelEl = document.getElementById('yb-profile-yoga-level');
      var freqEl = document.getElementById('yb-profile-practice-freq');
      if (levelEl) levelEl.value = d.yogaLevel || '';
      if (freqEl) freqEl.value = d.practiceFrequency || '';

      if (d.mindbodyClientId) {
        clientId = d.mindbodyClientId;
        // Show Client ID in profile
        var cidWrap = document.getElementById('yb-profile-client-id-wrap');
        var cidEl = document.getElementById('yb-profile-client-id');
        if (cidWrap) cidWrap.hidden = false;
        if (cidEl) cidEl.textContent = clientId;
        // Load membership details
        loadMembershipDetails();
      }

      // Load saved profile picture
      if (d.photoURL && avatarEl) {
        avatarEl.style.backgroundImage = 'url(' + d.photoURL + ')';
        avatarEl.textContent = '';
        avatarEl.classList.add('has-photo');
      }

      // Inline onboarding — show card + disable non-profile tabs until phone+DOB filled
      var onboardingInline = document.getElementById('yb-onboarding-inline');
      var profileIncomplete = !d.phone || !d.dateOfBirth;
      if (onboardingInline) {
        if (profileIncomplete) {
          onboardingInline.hidden = false;
          setTabsLocked(true);
          // Pre-fill if we have partial data
          var obPhone = document.getElementById('yb-onboarding-phone');
          var obDob = document.getElementById('yb-onboarding-dob');
          if (obPhone && d.phone) obPhone.value = d.phone;
          if (obDob && d.dateOfBirth) obDob.value = d.dateOfBirth;
        } else {
          onboardingInline.hidden = true;
          setTabsLocked(false);
        }
      }

      // Silently fetch waiver status (no blocking — used for gates later)
      if (d.mindbodyClientId) {
        fetchWaiverStatus(d.mindbodyClientId);
      }

      var sinceEl = document.getElementById('yb-profile-member-since');
      if (sinceEl && d.createdAt) {
        var date = d.createdAt.toDate ? d.createdAt.toDate() : new Date(d.createdAt);
        sinceEl.textContent = (isDa() ? 'Medlem siden ' : 'Member since ') + date.toLocaleDateString(isDa() ? 'da-DK' : 'en-GB', { year: 'numeric', month: 'long' });
      }

      // Tier is set by loadMembershipDetails after fetching pass data
      var tierEl = document.getElementById('yb-profile-tier');
      if (tierEl) tierEl.textContent = '—';
      var tierDetailEl = document.getElementById('yb-profile-tier-detail');
      if (tierDetailEl) tierDetailEl.textContent = '—';
    }).catch(function(err) { console.warn('Could not load profile:', err); });
  }

  // ══════════════════════════════════════
  // ENSURE BACKEND CLIENT (silent)
  // ══════════════════════════════════════
  function ensureBackendClient(user, db) {
    db.collection('users').doc(user.uid).get().then(function(doc) {
      if (!doc.exists) return;
      var d = doc.data();
      if (d.mindbodyClientId) {
        clientId = d.mindbodyClientId;
        // Trigger waiver check if it wasn't done during loadProfile
        if (!waiverStatusLoaded) fetchWaiverStatus(clientId);
        return;
      }

      var firstName = d.firstName || (user.displayName || '').split(' ')[0] || '';
      var lastName = d.lastName || (user.displayName || '').split(' ').slice(1).join(' ') || '';

      fetch('/.netlify/functions/mb-client?email=' + encodeURIComponent(user.email))
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.found && data.client && data.client.id) {
            clientId = String(data.client.id);
            // Trigger waiver check now that we have a client ID
            if (!waiverStatusLoaded) fetchWaiverStatus(clientId);
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
                // Trigger waiver check for newly created client
                if (!waiverStatusLoaded) fetchWaiverStatus(clientId);
                return db.collection('users').doc(user.uid).update({
                  mindbodyClientId: clientId, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
              }
            });
        }).catch(function() {});
    });
  }

  // ══════════════════════════════════════
  // LIABILITY WAIVER
  // ══════════════════════════════════════
  var waiverSigPad = null;
  var waiverTextCache = null;
  var waiverAgreementDate = null;

  function getWaiverCacheKey() {
    return currentUser ? 'yb_waiver_signed_' + currentUser.uid : null;
  }

  // Check waiver status: localStorage (instant) → Firestore → MB API
  function fetchWaiverStatus(mbClientId) {
    // 1. Instant check: localStorage
    var cacheKey = getWaiverCacheKey();
    if (cacheKey) {
      try {
        var cached = localStorage.getItem(cacheKey);
        if (cached === 'true') {
          waiverSigned = true;
          waiverStatusLoaded = true;
          var cachedDate = localStorage.getItem(cacheKey + '_date');
          if (cachedDate) waiverAgreementDate = cachedDate;
          renderWaiverCard();
        }
      } catch (e) { /* localStorage may be unavailable */ }
    }

    // 2. Check Firestore consents collection (reliable audit trail)
    if (!waiverSigned && currentUser && currentDb) {
      currentDb.collection('consents')
        .where('userId', '==', currentUser.uid)
        .where('document', '==', 'liability_waiver')
        .where('accepted', '==', true)
        .limit(1)
        .get()
        .then(function(snapshot) {
          if (!snapshot.empty) {
            waiverSigned = true;
            waiverStatusLoaded = true;
            var doc = snapshot.docs[0].data();
            waiverAgreementDate = doc.timestamp || doc.createdAt || null;
            // Cache for next load
            if (cacheKey) {
              try {
                localStorage.setItem(cacheKey, 'true');
                if (waiverAgreementDate) localStorage.setItem(cacheKey + '_date', waiverAgreementDate);
              } catch (e) {}
            }
            renderWaiverCard();
          }
        })
        .catch(function(err) {
          console.warn('Could not check Firestore consents:', err);
        });
    }

    // 3. Also check MB API (may discover waiver signed externally)
    fetch('/.netlify/functions/mb-waiver?clientId=' + encodeURIComponent(mbClientId))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        waiverTextCache = data.waiverText || null;
        // Only upgrade to signed, never downgrade
        if (data.clientSigned && !waiverSigned) {
          waiverSigned = true;
          waiverAgreementDate = data.agreementDate || null;
          if (cacheKey) {
            try {
              localStorage.setItem(cacheKey, 'true');
              if (waiverAgreementDate) localStorage.setItem(cacheKey + '_date', waiverAgreementDate);
            } catch (e) {}
          }
        }
        // SYNC: If signed locally (localStorage/Firestore) but MB doesn't know yet,
        // push the marker note to MB so other browsers can detect it
        if (waiverSigned && !data.clientSigned) {
          console.log('[waiver] Syncing waiver marker to MB for cross-browser persistence');
          fetch('/.netlify/functions/mb-waiver', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId: mbClientId })
          }).then(function() {
            console.log('[waiver] Sync to MB succeeded');
          }).catch(function(syncErr) {
            console.warn('[waiver] Sync to MB failed (non-critical):', syncErr);
          });
        }
        waiverStatusLoaded = true;
        renderWaiverCard();
      })
      .catch(function(err) {
        console.warn('Could not check waiver status:', err);
        waiverStatusLoaded = true;
        renderWaiverCard();
      });
  }

  // Bind the "Read full waiver" toggle handler (shared between signed/unsigned views)
  function bindWaiverReadToggle(textEl) {
    var readToggle = document.getElementById('yb-waiver-read-toggle');
    if (!readToggle) return;
    readToggle.hidden = false;
    if (readToggle._bound) return;
    readToggle._bound = true;
    readToggle.addEventListener('click', function() {
      if (textEl.hidden) {
        textEl.hidden = false;
        loadWaiverText(textEl);
        readToggle.classList.add('is-expanded');
        var toggleText = readToggle.querySelector('span');
        if (toggleText) toggleText.textContent = isDa() ? 'Skjul erklæring' : 'Hide waiver';
      } else {
        textEl.hidden = true;
        readToggle.classList.remove('is-expanded');
        var toggleText2 = readToggle.querySelector('span');
        if (toggleText2) toggleText2.textContent = isDa() ? 'Læs fuld erklæring' : 'Read full waiver';
      }
    });
  }

  // Render the waiver status card in My Passes tab
  function renderWaiverCard() {
    var card = document.getElementById('yb-waiver-card');
    if (!card) return;
    // Don't show card until we know the actual status (prevents flash of unsigned form)
    if (!waiverStatusLoaded) return;
    card.hidden = false;

    var signedEl = document.getElementById('yb-waiver-card-signed');
    var bodyEl = document.getElementById('yb-waiver-card-body');
    var signSection = document.getElementById('yb-waiver-sign-section');
    var textEl = document.getElementById('yb-waiver-text');

    if (waiverSigned) {
      // Collapsed state — just show green checkmark + date
      if (signedEl) signedEl.hidden = false;
      if (bodyEl) bodyEl.hidden = true;
      var dateEl = document.getElementById('yb-waiver-signed-date');
      if (dateEl && waiverAgreementDate) {
        var d = new Date(waiverAgreementDate);
        dateEl.textContent = d.toLocaleDateString(isDa() ? 'da-DK' : 'en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
      }
      // Toggle button expands/collapses the waiver text (read-only view when signed)
      var toggleBtn = document.getElementById('yb-waiver-toggle-btn');
      if (toggleBtn && !toggleBtn._bound) {
        toggleBtn._bound = true;
        toggleBtn.addEventListener('click', function() {
          if (bodyEl.hidden) {
            bodyEl.hidden = false;
            if (signSection) signSection.hidden = true;
            if (textEl) textEl.hidden = true; // start collapsed, use toggle
            bindWaiverReadToggle(textEl);
            toggleBtn.textContent = isDa() ? 'Skjul' : 'Hide';
          } else {
            bodyEl.hidden = true;
            toggleBtn.textContent = isDa() ? 'Vis detaljer' : 'View details';
          }
        });
      }
    } else {
      // Unsigned — show compact card with collapsible waiver text
      if (signedEl) signedEl.hidden = true;
      if (bodyEl) bodyEl.hidden = false;
      if (signSection) signSection.hidden = false;
      // Waiver text starts collapsed — user toggles to read
      if (textEl) textEl.hidden = true;
      bindWaiverReadToggle(textEl);
      initWaiverSignForm();
    }
  }

  function loadWaiverText(textEl) {
    if (!textEl) return;
    if (waiverTextCache) {
      textEl.innerHTML = waiverTextCache;
    } else {
      textEl.innerHTML = '<p>' + t('waiver_fallback') + '</p>';
    }
  }

  function initWaiverSignForm() {
    if (!waiverSigPad) {
      waiverSigPad = SignaturePad('yb-waiver-canvas', 'yb-waiver-sig-clear');
    }
    var submitBtn = document.getElementById('yb-waiver-submit');
    if (submitBtn && !submitBtn._bound) {
      submitBtn._bound = true;
      submitBtn.addEventListener('click', function() {
        submitLiabilityWaiver(clientId, 'passes_card');
      });
    }
  }

  function submitLiabilityWaiver(mbClientId, source) {
    var agreeCheck = document.getElementById('yb-waiver-agree-check');
    var errorEl = document.getElementById('yb-waiver-error');
    var submitBtn = document.getElementById('yb-waiver-submit');
    var sigPad = waiverSigPad;

    // If called from checkout, use unified checkout elements
    if (source === 'checkout') {
      agreeCheck = document.getElementById('yb-checkout-agree-check');
      errorEl = document.getElementById('yb-store-error');
      sigPad = checkoutSigPad; // unified single signature pad
    }

    if (!agreeCheck || !agreeCheck.checked) {
      var msg = isDa() ? 'Du skal acceptere ansvarsfrihedserklæringen.' : 'You must accept the liability waiver.';
      if (errorEl) { errorEl.textContent = msg; errorEl.hidden = false; }
      return false;
    }
    if (sigPad && sigPad.isEmpty()) {
      var msg2 = isDa() ? 'Tegn venligst din underskrift.' : 'Please draw your signature.';
      if (errorEl) { errorEl.textContent = msg2; errorEl.hidden = false; }
      return false;
    }

    if (errorEl) errorEl.hidden = true;
    if (submitBtn && source !== 'checkout') {
      submitBtn.disabled = true;
      submitBtn.textContent = isDa() ? 'Gemmer...' : 'Saving...';
    }

    var postBody = { clientId: mbClientId };
    if (sigPad && !sigPad.isEmpty()) {
      postBody.signatureImage = sigPad.toDataURL();
    }

    return fetch('/.netlify/functions/mb-waiver', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(postBody)
    }).then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.success) {
          waiverSigned = true;
          waiverStatusLoaded = true;
          waiverAgreementDate = data.agreementDate || new Date().toISOString();
          // Cache in localStorage for instant load next time
          var cacheKey = getWaiverCacheKey();
          if (cacheKey) {
            try {
              localStorage.setItem(cacheKey, 'true');
              if (waiverAgreementDate) localStorage.setItem(cacheKey + '_date', waiverAgreementDate);
            } catch (e) {}
          }
          renderWaiverCard(); // Re-render as signed

          // Firestore audit trail
          if (currentUser && currentDb) {
            currentDb.collection('consents').add({
              userId: currentUser.uid,
              email: currentUser.email,
              document: 'liability_waiver',
              documentLabel: 'Liability Waiver / Ansvarsfrihedserklæring',
              accepted: true,
              timestamp: new Date().toISOString(),
              version: '2026-02-09',
              userAgent: navigator.userAgent,
              locale: navigator.language,
              source: source || 'passes_card',
              mindbodyClientId: mbClientId,
              createdAt: firebase.firestore.FieldValue.serverTimestamp()
            }).catch(function() {});
          }
          return true;
        } else {
          if (errorEl) { errorEl.textContent = data.error || (isDa() ? 'Fejl — prøv igen.' : 'Error — please try again.'); errorEl.hidden = false; }
          return false;
        }
      })
      .catch(function(err) {
        if (errorEl) { errorEl.textContent = err.message; errorEl.hidden = false; }
        return false;
      })
      .finally(function() {
        if (submitBtn && source !== 'checkout') {
          submitBtn.disabled = false;
          submitBtn.textContent = isDa() ? 'Accepter og fortsæt' : 'Accept and continue';
        }
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

    // Fetch MB data and Firestore pause data in parallel
    var mbPromise = fetch('/.netlify/functions/mb-client-services?clientId=' + clientId)
      .then(function(r) { return r.json(); });

    var fsPromise = new Promise(function(resolve) { loadPausesFromFirestore(resolve); });

    Promise.all([mbPromise, fsPromise]).then(function(results) {
      var data = results[0];
      var firestorePauses = results[1];
      return { data: data, pauses: firestorePauses };
    })
      .then(function(combined) {
        var data = combined.data;
        var firestorePauses = combined.pauses;
        try {
          // Merge Firestore pause data into MB contracts.
          // MB IsSuspended is ONLY true for currently active pauses, not future-dated.
          // MB notes are unreliable (persist after admin deletes suspension).
          // So: MB fields are authoritative when present. Firestore fills the gap
          // for the first 5 minutes after pausing (before MB confirms).
          var now = new Date().toISOString().split('T')[0];
          (data.activeContracts || []).forEach(function(c) {
            var key = 'pause_' + c.id;
            var fsPause = firestorePauses[key];
            if (c.isSuspended || c.pauseStartDate) {
              // MB confirms pause — authoritative. Use Firestore dates as fallback.
              if (fsPause) {
                if (!c.pauseStartDate) c.pauseStartDate = fsPause.startDate;
                if (!c.pauseEndDate) c.pauseEndDate = fsPause.endDate;
              }
            } else if (fsPause && fsPause.endDate >= now) {
              // MB says NOT paused, but Firestore has an unexpired pause.
              // Trust Firestore only if saved recently (within 90 seconds).
              // After 90s, MB should have caught up — if it hasn't,
              // admin likely deleted the suspension.
              var savedAt = fsPause.savedAt ? new Date(fsPause.savedAt).getTime() : 0;
              var ageMs = Date.now() - savedAt;
              if (ageMs < 90000) {
                c.isSuspended = true;
                c.pauseStartDate = fsPause.startDate;
                c.pauseEndDate = fsPause.endDate;
                console.log('[Pause] Using Firestore pause for contract', c.id, '(saved', Math.round(ageMs / 1000) + 's ago)');
              } else {
                console.log('[Pause] Removing Firestore pause for contract', c.id, '(MB does not confirm, saved', Math.round(ageMs / 1000) + 's ago)');
                removePauseFromFirestore(c.id);
              }
            }
            // Clean up expired pauses from Firestore
            if (fsPause && fsPause.endDate < now) {
              removePauseFromFirestore(c.id);
            }
          });
          clientPassData = data;
          renderMembershipDetails(contentEl, data);

          // Show pass type in tier fields (hero badge + membership card detail)
          var hasAutopayContract = data.activeContracts && data.activeContracts.length > 0;
          var hasActiveService = data.activeServices && data.activeServices.length > 0;
          var tierEl = document.getElementById('yb-profile-tier');
          var tierDetailEl = document.getElementById('yb-profile-tier-detail');
          var tierText, tierClass;
          if (hasAutopayContract) {
            tierText = isDa() ? 'Månedligt Medlemskab' : 'Monthly Membership';
            tierClass = 'yb-profile__info-value yb-profile__info-value--success';
          } else if (hasActiveService) {
            tierText = isDa() ? 'Klippekort' : 'Clip Card';
            tierClass = 'yb-profile__info-value yb-profile__info-value--success';
          } else {
            tierText = isDa() ? 'Intet aktivt pas' : 'No active pass';
            tierClass = 'yb-profile__info-value yb-profile__info-value--muted';
          }
          if (tierEl) tierEl.textContent = tierText;
          if (tierDetailEl) { tierDetailEl.textContent = tierText; tierDetailEl.className = tierClass; }
        } catch (renderErr) {
          console.error('[Membership] Render error:', renderErr);
        } finally {
          if (loadingEl) loadingEl.hidden = true;
        }
      })
      .catch(function(err) {
        console.error('[Membership] Load error:', err);
        if (loadingEl) loadingEl.hidden = true;
      });
  }

  /** Look up a membership from hardcoded catalog by Mindbody contract/prodId */
  function findCatalogMembership(contractId) {
    var all = (storeCatalog.memberships.over30 || []).concat(storeCatalog.memberships.under30 || []);
    for (var i = 0; i < all.length; i++) {
      if (String(all[i].prodId) === String(contractId)) return all[i];
    }
    return null;
  }

  function renderMembershipDetails(container, data) {
    var html = '';

    // ── Active contracts (memberships) — FIRST, most important ──
    var contracts = data.activeContracts || [];
    if (contracts.length) {
      contracts.forEach(function(c) {
        // Detect pause: backend resolves from both MB IsSuspended AND our pause notes
        var isPaused = c.isSuspended || !!(c.pauseStartDate && c.pauseEndDate);

        html += '<div class="yb-membership__pass yb-membership__contract-card" data-contract-id="' + c.id + '">';
        html += '<div class="yb-membership__pass-info">';
        var _catMatch = findCatalogMembership(c.id);
        var _displayName = _catMatch ? (isDa() ? _catMatch.name_da : _catMatch.name_en) : c.name;
        html += '<span class="yb-membership__pass-name">' + esc(_displayName) + '</span>';

        // Status badge
        if (isPaused) {
          html += '<span class="yb-membership__badge yb-membership__badge--paused">' + t('membership_paused_badge') + '</span>';
        } else if (c.terminationDate) {
          html += '<span class="yb-membership__badge yb-membership__badge--terminating">' + t('membership_terminated_badge') + '</span>';
        } else {
          html += '<span class="yb-membership__badge yb-membership__badge--active">' + t('membership_status_active') + '</span>';
        }

        // Autopay info
        if (c.isAutopay && c.autopayAmount) {
          html += '<span class="yb-membership__pass-remaining">' + t('membership_autopay') + ' &middot; ' + c.autopayAmount + ' kr ' + t('membership_autopay_amount') + '</span>';
        }

        // Billing info
        if (isPaused) {
          html += '<span class="yb-membership__pass-expiry">' + t('membership_billing_paused') + '</span>';
        } else if (c.terminationDate) {
          html += '<span class="yb-membership__pass-expiry">' + t('membership_active_until') + ' ' + formatDateDK(c.terminationDate) + '</span>';
        } else if (c.nextBillingDate) {
          html += '<span class="yb-membership__pass-expiry">' + t('membership_next_billing') + ' ' + formatDateDK(c.nextBillingDate) + '</span>';
        }
        html += '</div>';

        // ── PAUSED STATE: Show pause details + extend/reactivate buttons ──
        if (isPaused) {
          var pauseStart = c.pauseStartDate || null;
          var pauseEnd = c.pauseEndDate || null;
          var pauseDetail = '';
          if (pauseStart && pauseEnd) {
            pauseDetail = formatDateDK(pauseStart) + ' – ' + formatDateDK(pauseEnd);
          } else if (pauseStart) {
            pauseDetail = t('membership_pause_from') + ' ' + formatDateDK(pauseStart);
          }
          html += '<div class="yb-membership__pause-status">';
          html += '<div class="yb-membership__pause-status-icon">';
          html += '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#b91c1c" stroke-width="2"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
          html += '</div>';
          html += '<div class="yb-membership__pause-status-text">';
          html += '<strong>' + t('membership_pause_active_title') + '</strong>';
          if (pauseDetail) {
            html += '<span>' + pauseDetail + '</span>';
          }
          html += '<span>' + t('membership_pause_auto_resume') + '</span>';
          html += '</div>';
          html += '</div>';
          html += '<p class="yb-membership__pause-contact">' + t('membership_resume_contact') + '</p>';
        }

        // ── ACTIVE STATE: Manage info (contact-based) ──
        var showActiveInfo = !isPaused && !c.terminationDate && c.isAutopay;
        if (showActiveInfo) {
          html += '<div class="yb-membership__manage-info-box">';
          html += '<p class="yb-membership__manage-info-text">' + t('membership_manage_info') + '</p>';
          html += '</div>';
        }

        // ── TERMINATING STATE: Retention card ──
        if (c.terminationDate && !c.isSuspended) {
          html += '<span class="yb-membership__notice-period">' + t('membership_notice_period') + '</span>';
          var termDate = new Date(c.terminationDate);
          var now = new Date();
          if (termDate > now) {
            html += '<div class="yb-membership__retention-card">';
            html += '<div class="yb-membership__retention-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f75c03" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></div>';
            html += '<p class="yb-membership__retention-title">' + t('membership_retention_title') + '</p>';
            html += '<p class="yb-membership__retention-desc">' + t('membership_retention_desc').replace('{date}', formatDateDK(c.terminationDate)) + '</p>';
            html += '<ul class="yb-membership__retention-perks">';
            html += '<li>' + t('membership_retention_perk1') + '</li>';
            html += '<li>' + t('membership_retention_perk2') + '</li>';
            html += '</ul>';
            html += '<button type="button" class="yb-btn yb-btn--primary yb-membership__retention-btn" data-reactivate="' + (c.contractId || '') + '" data-contract-name="' + esc(c.name) + '" data-location-id="' + (c.locationId || '1') + '">' + t('membership_retention_cta') + '</button>';
            html += '<p class="yb-membership__cancel-term-hint">' + t('membership_cancel_termination_hint') + '</p>';
            html += '</div>';
          } else {
            html += '<div class="yb-membership__rejoin">';
            html += '<button type="button" class="yb-btn yb-btn--primary yb-membership__rejoin-btn" data-rejoin="1">' + t('membership_rejoin_cta') + '</button>';
            html += '</div>';
          }
        }
        html += '</div>';
      });
    }

    // ── Active passes (clip cards, one-shots) ──
    var active = data.activeServices || [];
    if (active.length) {
      html += '<div class="yb-membership__section">';
      html += '<h3 class="yb-membership__section-title">' + t('membership_active_passes') + '</h3>';
      html += '<div class="yb-membership__pass-grid">';
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
          html += '<span class="yb-membership__pass-expiry">' + t('membership_expires') + ' ' + formatDateDK(s.expirationDate) + '</span>';
        }
        html += '</div>';
      });
      html += '</div>';
      html += '</div>';
    }

    // ── Past passes (collapsed by default) ──
    var past = (data.services || []).filter(function(s) { return !s.current; });
    if (past.length) {
      html += '<div class="yb-membership__section yb-membership__section--collapsed">';
      html += '<button type="button" class="yb-membership__section-toggle" data-toggle-past>';
      html += '<h3 class="yb-membership__section-title" style="border:none;padding:0;margin:0">' + t('membership_past_passes') + ' (' + past.length + ')</h3>';
      html += '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="yb-membership__toggle-icon"><polyline points="6 9 12 15 18 9"/></svg>';
      html += '</button>';
      html += '<div class="yb-membership__past-list" hidden>';
      past.forEach(function(s) {
        html += '<div class="yb-membership__pass yb-membership__pass--expired">';
        html += '<div class="yb-membership__pass-info">';
        html += '<span class="yb-membership__pass-name">' + esc(s.name) + '</span>';
        if (s.remaining != null) {
          html += '<span class="yb-membership__pass-remaining">' + s.remaining + ' ' + t('membership_remaining') + '</span>';
        }
        html += '</div>';
        if (s.expirationDate) {
          html += '<span class="yb-membership__pass-expiry">' + t('membership_expires') + ' ' + formatDateDK(s.expirationDate) + '</span>';
        }
        html += '</div>';
      });
      html += '</div>';
      html += '</div>';
    }

    // No active passes or contracts at all
    if (!contracts.length && !active.length) {
      html += '<p class="yb-membership__empty">' + t('membership_no_active') + '</p>';
    }

    container.innerHTML = html;

    // Bind manage button event listeners
    bindMembershipManageEvents(container, data);
  }

  // ── Calculate earliest termination date: 1 month + running days ──
  // T&C: 1 month + running days notice.
  // Next billing = last payment taken. Use membership until end of that cycle.
  // Example: next billing Mar 8 → last payment Mar 8 → use until Apr 7 (day before next cycle)
  // Returns { lastPaymentDate, useUntilDate }
  function calcTerminationDates(nextBillingDate) {
    var now = new Date();
    var base = nextBillingDate ? new Date(nextBillingDate) : now;
    if (base < now) base = now;

    // Last payment = next billing date
    var lastPayment = new Date(base);

    // Use until = end of that billing cycle = 1 month later minus 1 day
    var useUntil = new Date(base);
    useUntil.setMonth(useUntil.getMonth() + 1);
    useUntil.setDate(useUntil.getDate() - 1);

    return { lastPaymentDate: lastPayment, useUntilDate: useUntil };
  }

  // ── Local date string helper (avoids UTC shift from toISOString) ──
  function toLocalDateStr(d) {
    var y = d.getFullYear();
    var m = ('0' + (d.getMonth() + 1)).slice(-2);
    var day = ('0' + d.getDate()).slice(-2);
    return y + '-' + m + '-' + day;
  }

  // ── Calculate earliest pause start date (after next billing cycle) ──
  function calcEarliestPauseStart(nextBillingDate) {
    var now = new Date();
    if (nextBillingDate) {
      var nbd = new Date(nextBillingDate);
      // Must start after next billing (not during current paid period)
      if (nbd > now) return nbd;
    }
    // Fallback: tomorrow
    var tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow;
  }

  // Helper: mark a contract as paused in local clientPassData
  function markContractPaused(contractId, startDate, endDate) {
    if (!clientPassData || !clientPassData.activeContracts) return;
    for (var ci = 0; ci < clientPassData.activeContracts.length; ci++) {
      if (String(clientPassData.activeContracts[ci].id) === String(contractId)) {
        clientPassData.activeContracts[ci].isSuspended = true;
        clientPassData.activeContracts[ci].pauseStartDate = startDate;
        clientPassData.activeContracts[ci].pauseEndDate = endDate;
        break;
      }
    }
    // Also persist to Firestore
    savePauseToFirestore(contractId, startDate, endDate);
  }

  // ── Firestore pause persistence ──
  // Saves/reads pause data from Firestore (reliable, cross-browser, cross-session)
  function savePauseToFirestore(contractId, startDate, endDate) {
    if (!currentUser || !currentDb) return;
    var key = 'pause_' + contractId;
    var update = {};
    update['pausedContracts.' + key] = {
      contractId: String(contractId),
      startDate: startDate,
      endDate: endDate,
      savedAt: new Date().toISOString()
    };
    currentDb.collection('users').doc(currentUser.uid).update(update).catch(function(err) {
      console.warn('[Pause] Firestore save failed:', err.message);
    });
  }

  function removePauseFromFirestore(contractId) {
    if (!currentUser || !currentDb) return;
    var key = 'pause_' + contractId;
    var update = {};
    update['pausedContracts.' + key] = firebase.firestore.FieldValue.delete();
    currentDb.collection('users').doc(currentUser.uid).update(update).catch(function(err) {
      console.warn('[Pause] Firestore delete failed:', err.message);
    });
  }

  function loadPausesFromFirestore(callback) {
    if (!currentUser || !currentDb) { callback({}); return; }
    currentDb.collection('users').doc(currentUser.uid).get().then(function(doc) {
      if (!doc.exists) { callback({}); return; }
      var data = doc.data();
      callback(data.pausedContracts || {});
    }).catch(function(err) {
      console.warn('[Pause] Firestore read failed:', err.message);
      callback({});
    });
  }

  function bindMembershipManageEvents(container, data) {
    var contracts = data.activeContracts || [];

    // NOTE: Pause and Cancel buttons have been removed from the UI.
    // These actions are now handled via email to info@hotyogacph.dk.
    // The pause/termination STATUS display and retention card remain.

    // NOTE: Pause and Cancel buttons removed from UI.
    // Pending Mindbody API clarification on SuspendDate semantics
    // and missing delete-suspension / cancel-termination endpoints.
    // Users are directed to email info@hotyogacph.dk instead.

    // ── Reactivate (retention) buttons ──
    // First month free is already set on all contracts in Mindbody,
    // so no promo code needed — just navigate to the store checkout.
    var reactivateBtns = container.querySelectorAll('[data-reactivate]');
    for (var r = 0; r < reactivateBtns.length; r++) {
      reactivateBtns[r].addEventListener('click', function() {
        var contractId = this.getAttribute('data-reactivate');
        var contractName = this.getAttribute('data-contract-name') || '';
        console.log('[Reactivate] Looking for contract template ID:', contractId, 'name:', contractName);
        // Switch to Store tab and auto-open checkout for the matching contract
        var storeBtn = document.querySelector('[data-yb-tab="store"]');
        if (storeBtn) {
          storeBtn.click();
          // First show memberships category, then find the contract
          setTimeout(function() {
            var memCat = document.querySelector('[data-store-cat="memberships"]');
            if (memCat) memCat.click();
            // Wait for re-render after category switch
            setTimeout(function() {
              var buyBtn = document.querySelector('[data-store-buy="' + contractId + '"]');
              if (buyBtn) {
                console.log('[Reactivate] Found contract by ID, opening checkout');
                buyBtn.click();
              } else if (contractName) {
                // Fallback: match by name in storeServices array
                var match = storeServices.find(function(s) {
                  return s._itemType === 'contract' && s.name === contractName;
                });
                if (match) {
                  console.log('[Reactivate] Found contract by name match, ID:', match.id);
                  var nameBtn = document.querySelector('[data-store-buy="' + match.id + '"]');
                  if (nameBtn) nameBtn.click();
                } else {
                  console.log('[Reactivate] No match found. Store contracts:', storeServices.filter(function(s) { return s._itemType === 'contract'; }).map(function(s) { return s.id + ':' + s.name; }));
                }
              }
            }, 300);
          }, 800);
        }
      });
    }

    // ── Rejoin buttons (after termination date has passed) ──
    var rejoinBtns = container.querySelectorAll('[data-rejoin]');
    for (var j = 0; j < rejoinBtns.length; j++) {
      rejoinBtns[j].addEventListener('click', function() {
        var storeBtn = document.querySelector('[data-yb-tab="store"]');
        if (storeBtn) {
          storeBtn.click();
          setTimeout(function() {
            var memCat = document.querySelector('[data-store-cat="memberships"]');
            if (memCat) memCat.click();
          }, 800);
        }
      });
    }



    // ── Past passes toggle ──
    var pastToggle = container.querySelector('[data-toggle-past]');
    if (pastToggle) {
      pastToggle.addEventListener('click', function() {
        var list = container.querySelector('.yb-membership__past-list');
        var icon = this.querySelector('.yb-membership__toggle-icon');
        if (list) {
          list.hidden = !list.hidden;
          if (icon) icon.style.transform = list.hidden ? '' : 'rotate(180deg)';
        }
      });
    }
  }

  function showMembershipToast(message, type, duration) {
    var existing = document.querySelector('.yb-membership__toast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.className = 'yb-membership__toast yb-membership__toast--' + (type || 'info');
    toast.textContent = message;
    var container = document.getElementById('yb-membership-content');
    if (container) container.insertBefore(toast, container.firstChild);
    setTimeout(function() { toast.remove(); }, duration || 5000);
  }

  // ══════════════════════════════════════
  // STORE TAB
  // ══════════════════════════════════════
  var storeServices = [];
  var storeView = 'categories'; // 'categories' (top-level cards) or 'items' (listing)
  var storeTopCategory = null;  // 'daily', 'teacher', 'courses', 'private'
  var storeSubCategory = 'all'; // subcategory within daily
  var storeSearchQuery = '';
  var storeFilterProgramId = null; // Set by booking redirect to highlight matching passes

  // Top-level store categories
  var storeTopCategories = [
    {
      id: 'daily',
      da: 'Daglige Klasser',
      en: 'Daily Classes',
      desc_da: 'Medlemskaber, klippekort, prøvekort og meget mere',
      desc_en: 'Memberships, clip cards, trial passes and more',
      icon: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
    },
    {
      id: 'teacher',
      da: 'Yogalæreruddannelse',
      en: 'Yoga Teacher Training',
      desc_da: 'Depositum og tilmelding til uddannelse',
      desc_en: 'Deposits and training enrollment',
      icon: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>'
    },
    {
      id: 'courses',
      da: 'Kurser',
      en: 'Courses',
      desc_da: 'Inversions, backbends, splits og mere',
      desc_en: 'Inversions, backbends, splits and more',
      icon: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>'
    },
    {
      id: 'private',
      da: 'Privattimer',
      en: 'Private Classes',
      desc_da: '1-til-1 yoga tilpasset dig',
      desc_en: '1-on-1 yoga tailored to you',
      icon: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
    }
  ];

  // Subcategories for Daily Classes
  var storeDailySubs = [
    { id: 'memberships', da: 'Medlemskab', en: 'Memberships', desc_da: 'Fast praksis', desc_en: 'Regular practice' },
    { id: 'timebased', da: 'Tidsbegrænsede pas', en: 'Time-based Passes', desc_da: 'Ubegrænset adgang', desc_en: 'Unlimited pass' },
    { id: 'clips', da: 'Klippekort', en: 'Clip Cards', desc_da: 'Lejlighedsvise besøg', desc_en: 'Occasional visits' },
    { id: 'trials', da: 'Prøvekort', en: 'Trial Passes', desc_da: 'Prøv os', desc_en: 'Try us' },
    { id: 'tourist', da: 'Turistpas', en: 'Tourist Pass', desc_da: 'Inkl. måtte & håndklæde', desc_en: 'Incl. mat & towel' }
  ];

  // ── Hardcoded Product Catalog ──
  // All prodIds extracted from Mindbody URLs. Buy buttons use openCheckout(prodId).
  // over30 = 30+ years old (25% VAT), under30 = under 30 (no VAT)
  var storeCatalog = {
    clips: {
      over30: [
        { classes: 1, price: 299, perClass: 299, vat: 60, validity: '10 days', label_da: 'Prøv En', label_en: 'Try One', sharing: null, prodId: '100174' },
        { classes: 2, price: 549, perClass: 274, vat: 110, validity: '20 days', label_da: 'God Start', label_en: 'Great Start', sharing: null, prodId: '100175' },
        { classes: 3, price: 749, perClass: 249, vat: 150, validity: '30 days', label_da: 'Mærk Resultater', label_en: 'Feel Results', sharing: null, prodId: '100176' },
        { classes: 5, price: 1199, perClass: 239, vat: 240, validity: '50 days', label_da: 'Populært Valg', label_en: 'Popular Choice', sharing: null, prodId: '100177' },
        { classes: 10, price: 1999, perClass: 199, vat: 400, validity: '90 days', label_da: 'Spar Mere', label_en: 'Save More', sharing: null, prodId: '100178' },
        { classes: 20, price: 3599, perClass: 179, vat: 720, validity: '4 months', label_da: 'Smart Tilbud', label_en: 'Smart Deal', sharing: null, prodId: '100179' },
        { classes: 30, price: 4799, perClass: 159, vat: 960, validity: '4 months', label_da: 'Dedikeret Yogi', label_en: 'Dedicated Yogi', sharing: null, prodId: '100180' },
        { classes: 60, price: 7799, perClass: 129, vat: 1560, validity: '9 months', label_da: 'Yoga Partner', label_en: 'Yoga Partner', sharing: { persons: 1, total: 2 }, prodId: '100181' },
        { classes: 100, price: 9999, perClass: 99, vat: 2000, validity: '12 months', label_da: 'Bedste Værdi', label_en: 'Best Value', sharing: { persons: 2, total: 3 }, prodId: '100182' },
        { classes: 200, price: 17999, perClass: 89, vat: 3600, validity: '18 months', label_da: 'Familieplan', label_en: 'Family Plan', sharing: { persons: 3, total: 4 }, prodId: '100183' }
      ],
      under30: [
        { classes: 1, price: 275, perClass: 275, vat: 0, validity: '10 days', label_da: 'Prøv En', label_en: 'Try One', sharing: null, prodId: '100017' },
        { classes: 2, price: 495, perClass: 248, vat: 0, validity: '20 days', label_da: 'God Start', label_en: 'Great Start', sharing: null, prodId: '100016' },
        { classes: 3, price: 645, perClass: 215, vat: 0, validity: '30 days', label_da: 'Mærk Resultater', label_en: 'Feel Results', sharing: null, prodId: '100018' },
        { classes: 5, price: 975, perClass: 195, vat: 0, validity: '50 days', label_da: 'Populært Valg', label_en: 'Popular Choice', sharing: null, prodId: '100019' },
        { classes: 10, price: 1750, perClass: 175, vat: 0, validity: '90 days', label_da: 'Spar Mere', label_en: 'Save More', sharing: null, prodId: '100020' },
        { classes: 20, price: 2900, perClass: 145, vat: 0, validity: '4 months', label_da: 'Smart Tilbud', label_en: 'Smart Deal', sharing: null, prodId: '100021' },
        { classes: 30, price: 3750, perClass: 125, vat: 0, validity: '4 months', label_da: 'Dedikeret Yogi', label_en: 'Dedicated Yogi', sharing: null, prodId: '100022' },
        { classes: 60, price: 5950, perClass: 99, vat: 0, validity: '9 months', label_da: 'Yoga Partner', label_en: 'Yoga Partner', sharing: { persons: 1, total: 2 }, prodId: '100023' },
        { classes: 100, price: 8900, perClass: 89, vat: 0, validity: '12 months', label_da: 'Bedste Værdi', label_en: 'Best Value', sharing: { persons: 2, total: 3 }, prodId: '100024' },
        { classes: 200, price: 15800, perClass: 79, vat: 0, validity: '18 months', label_da: 'Familieplan', label_en: 'Family Plan', sharing: { persons: 3, total: 4 }, prodId: '100068' }
      ]
    },
    memberships: {
      over30: [
        { id: 'mem-10-30', name_da: '10 Klasser / Måned', name_en: '10 Classes / Month', price: 999, perClass: 99, vat_pct: 25, regFee: 299, firstMonthFree: true, popular: true, prodId: '101', _itemType: 'contract',
          features_da: ['Ideel til moderat praksis', 'Perfekt hvis du træner ca. 1\u20133 gange om ugen og foretrækker et fast antal klasser', 'Adgang til alle klassetyper og tider i åbningstiden', 'Adgang til medlems-events og rabatter', 'Wellness-fordele inkl. \u2013 håndklæder, brusebad, urtete og snacks efter klassen', 'Book op til 21 dage frem'],
          features_en: ['Ideal for moderate practice', 'Perfect if you practise about 1\u20133 times per week and prefer a fixed number of classes', 'Access to all class types and times during opening hours', 'Access to member-only events & discounts', 'Wellness perks included \u2013 towels, showers, herbal tea & post-class treats', 'Book up to 21 days ahead']
        },
        { id: 'mem-unl-30', name_da: 'Ubegrænset / Måned', name_en: 'Unlimited / Month', price: 1249, perClass: 62, perClassNote_da: 'ca. 62 kr/klasse ved 20 klasser/md.', perClassNote_en: 'approx. 62 kr/class at 20 classes/mo.', vat_pct: 25, regFee: 299, firstMonthFree: true, prodId: '102', _itemType: 'contract',
          features_da: ['Ideel til regelmæssig praksis', 'Perfekt hvis du træner ofte eller vil have friheden til at komme så tit du vil', 'Ubegrænset adgang til alle klassetyper og tider', 'Adgang til medlems-events og rabatter', 'Wellness-fordele inkl. \u2013 håndklæder, brusebad, urtete og snacks efter klassen', 'Book op til 21 dage frem'],
          features_en: ['Ideal for regular practice', 'Perfect if you practise frequently or want the freedom to come as often as you like', 'Unlimited access to all class types and times', 'Access to member-only events & discounts', 'Wellness perks included \u2013 towels, showers, herbal tea & post-class treats', 'Book up to 21 days ahead']
        },
        { id: 'mem-prem-30', name_da: 'Premium Ubegrænset / Måned', name_en: 'Premium Unlimited / Month', price: 1649, perClass: 82, perClassNote_da: 'ca. 82 kr/klasse ved 20 klasser/md.', perClassNote_en: 'approx. 82 kr/class at 20 classes/mo.', vat_pct: 25, regFee: 299, firstMonthFree: true, prodId: '103', _itemType: 'contract',
          features_da: ['Vores top-tier medlemskab med fuld komfort og prioritet', 'Ubegrænset prioritetsadgang til alle klasser, tider, ventelister og medlems-events', 'Alt-inklusiv studio-komfort \u2013 måtteopbevaring, håndklæder, vaskeservice og personlig opbevaring', 'Fleksibelt \u2013 opsig når som helst med en måneds varsel, pausemuligheder inkl.', 'Book op til 31 dage frem'],
          features_en: ['Our top-tier membership with full comfort and priority', 'Unlimited priority access to all classes, times, waitlists and member events', 'All-inclusive studio comfort \u2013 mat storage, towels, laundry service & personal item storage', 'Flexible \u2013 cancel anytime with one-month notice, pause options included', 'Book up to 31 days ahead']
        }
      ],
      under30: [
        { id: 'mem-10-u30', name_da: '10 Klasser / Måned', name_en: '10 Classes / Month', price: 799, perClass: 79, vat_pct: 0, regFee: 275, firstMonthFree: true, popular: true, prodId: '109', _itemType: 'contract',
          features_da: ['Ideel til moderat praksis', 'Perfekt hvis du træner ca. 1\u20133 gange om ugen og foretrækker et fast antal klasser', 'Adgang til alle klassetyper og tider i åbningstiden', 'Adgang til medlems-events og rabatter', 'Wellness-fordele inkl. \u2013 håndklæder, brusebad, urtete og snacks efter klassen', 'Book op til 21 dage frem'],
          features_en: ['Ideal for moderate practice', 'Perfect if you practise about 1\u20133 times per week and prefer a fixed number of classes', 'Access to all class types and times during opening hours', 'Access to member-only events & discounts', 'Wellness perks included \u2013 towels, showers, herbal tea & post-class treats', 'Book up to 21 days ahead']
        },
        { id: 'mem-unl-u30', name_da: 'Ubegrænset / Måned', name_en: 'Unlimited / Month', price: 999, perClass: 49, perClassNote_da: 'ca. 49 kr/klasse ved 20 klasser/md.', perClassNote_en: 'approx. 49 kr/class at 20 classes/mo.', vat_pct: 0, regFee: 275, firstMonthFree: true, prodId: '111', _itemType: 'contract',
          features_da: ['Ideel til regelmæssig praksis', 'Perfekt hvis du træner ofte eller vil have friheden til at komme så tit du vil', 'Ubegrænset adgang til alle klassetyper og tider', 'Adgang til medlems-events og rabatter', 'Wellness-fordele inkl. \u2013 håndklæder, brusebad, urtete og snacks efter klassen', 'Book op til 21 dage frem'],
          features_en: ['Ideal for regular practice', 'Perfect if you practise frequently or want the freedom to come as often as you like', 'Unlimited access to all class types and times', 'Access to member-only events & discounts', 'Wellness perks included \u2013 towels, showers, herbal tea & post-class treats', 'Book up to 21 days ahead']
        },
        { id: 'mem-prem-u30', name_da: 'Premium Ubegrænset / Måned', name_en: 'Premium Unlimited / Month', price: 1499, perClass: 74, perClassNote_da: 'ca. 74 kr/klasse ved 20 klasser/md.', perClassNote_en: 'approx. 74 kr/class at 20 classes/mo.', vat_pct: 0, regFee: 275, firstMonthFree: true, prodId: '112', _itemType: 'contract',
          features_da: ['Vores top-tier medlemskab med fuld komfort og prioritet', 'Ubegrænset prioritetsadgang til alle klasser, tider, ventelister og medlems-events', 'Alt-inklusiv studio-komfort \u2013 måtteopbevaring, håndklæder, vaskeservice og personlig opbevaring', 'Fleksibelt \u2013 opsig når som helst med en måneds varsel, pausemuligheder inkl.', 'Book op til 31 dage frem'],
          features_en: ['Our top-tier membership with full comfort and priority', 'Unlimited priority access to all classes, times, waitlists and member events', 'All-inclusive studio comfort \u2013 mat storage, towels, laundry service & personal item storage', 'Flexible \u2013 cancel anytime with one-month notice, pause options included', 'Book up to 31 days ahead']
        }
      ]
    },
    timebased: {
      over30: [
        { id: 'tb-14d-30', name_da: '14 Dage Ubegrænset', name_en: '14 Days Unlimited', price: 799, vat_pct: 25, validity: '14 days', prodId: '100186',
          desc_da: 'Ubegrænset booking fra første bookingdato. Ingen binding, ingen registreringsgebyr. Kan ikke sættes på pause.',
          desc_en: 'Unlimited booking from first booking date. No binding, no registration fee. Cannot be paused.' },
        { id: 'tb-21d-30', name_da: '21 Dage Ubegrænset', name_en: '21 Days Unlimited', price: 899, vat_pct: 25, validity: '21 days', prodId: '100187',
          desc_da: 'Ubegrænset booking fra første bookingdato. Ingen binding, ingen registreringsgebyr. Kan ikke sættes på pause.',
          desc_en: 'Unlimited booking from first booking date. No binding, no registration fee. Cannot be paused.' },
        { id: 'tb-1m-30', name_da: '1 Måned Ubegrænset', name_en: '1 Month Unlimited', price: 1499, vat_pct: 25, validity: '1 month', prodId: '100189',
          desc_da: 'Ubegrænset booking fra første bookingdato. Ingen binding, ingen registreringsgebyr. Kan ikke sættes på pause.',
          desc_en: 'Unlimited booking from first booking date. No binding, no registration fee. Cannot be paused.' },
        { id: 'tb-3m-30', name_da: '3 Måneder Ubegrænset', name_en: '3 Months Unlimited', price: 3749, perMonth: 1249, vat_pct: 25, validity: '3 months', prodId: '100190',
          desc_da: 'Ubegrænset booking fra første bookingdato. Ingen binding, ingen registreringsgebyr. Kan ikke sættes på pause.',
          desc_en: 'Unlimited booking from first booking date. No binding, no registration fee. Cannot be paused.',
          saving: { save_da: 'Samme pris som Unlimited medlemskab \u2013 men uden registreringsgebyr (spar 299 kr)', save_en: 'Same price as Unlimited membership \u2013 but no registration fee (save 299 kr)' } },
        { id: 'tb-6m-30', name_da: '6 Måneder Ubegrænset', name_en: '6 Months Unlimited', price: 6899, perMonth: 1149, vat_pct: 25, validity: '6 months', popular: true, prodId: '100191',
          desc_da: 'Ubegrænset booking fra første bookingdato. Ingen binding, ingen registreringsgebyr. Kan ikke sættes på pause.',
          desc_en: 'Unlimited booking from first booking date. No binding, no registration fee. Cannot be paused.',
          saving: { save_da: '100 kr billigere pr. måned end Unlimited medlemskab + ingen registreringsgebyr (spar 299 kr)', save_en: '100 kr cheaper per month than Unlimited membership + no registration fee (save 299 kr)',
            breakdown_da: '6 \u00d7 1.149 kr/md. = 6.899 kr vs. 6 \u00d7 1.249 kr + 299 kr gebyr = 7.793 kr', breakdown_en: '6 \u00d7 1,149 kr/mo. = 6,899 kr vs. 6 \u00d7 1,249 kr + 299 kr fee = 7,793 kr' } },
        { id: 'tb-12m-30', name_da: '12+1 Måneder Ubegrænset', name_en: '12+1 Months Unlimited', price: 12599, perMonth: 969, vat_pct: 25, validity: '13 months', bestDeal: true, prodId: '100192',
          desc_da: '12 måneder + 1 måned gratis. Ubegrænset booking. Ingen binding, ingen registreringsgebyr. Kan ikke sættes på pause.',
          desc_en: '12 months + 1 month free. Unlimited booking. No binding, no registration fee. Cannot be paused.',
          saving: { save_da: '280 kr billigere pr. måned end Unlimited medlemskab + ingen registreringsgebyr. Spar 2.688 kr i alt!', save_en: '280 kr cheaper per month than Unlimited membership + no registration fee. Save 2,688 kr total!',
            breakdown_da: '12 \u00d7 1.249 kr + 299 kr gebyr = 15.287 kr vs. kun 12.599 kr (spar 2.688 kr)', breakdown_en: '12 \u00d7 1,249 kr + 299 kr fee = 15,287 kr vs. only 12,599 kr (save 2,688 kr)' } }
      ],
      under30: [
        { id: 'tb-14d-u30', name_da: '14 Dage Ubegrænset', name_en: '14 Days Unlimited', price: 649, vat_pct: 0, validity: '14 days', prodId: '100043',
          desc_da: 'Ubegrænset booking fra første bookingdato. Ingen binding, ingen registreringsgebyr. Kan ikke sættes på pause.',
          desc_en: 'Unlimited booking from first booking date. No binding, no registration fee. Cannot be paused.' },
        { id: 'tb-21d-u30', name_da: '21 Dage Ubegrænset', name_en: '21 Days Unlimited', price: 749, vat_pct: 0, validity: '21 days', prodId: '100044',
          desc_da: 'Ubegrænset booking fra første bookingdato. Ingen binding, ingen registreringsgebyr. Kan ikke sættes på pause.',
          desc_en: 'Unlimited booking from first booking date. No binding, no registration fee. Cannot be paused.' },
        { id: 'tb-1m-u30', name_da: '1 Måned Ubegrænset', name_en: '1 Month Unlimited', price: 1399, vat_pct: 0, validity: '1 month', prodId: '100037',
          desc_da: 'Ubegrænset booking fra første bookingdato. Ingen binding, ingen registreringsgebyr. Kan ikke sættes på pause.',
          desc_en: 'Unlimited booking from first booking date. No binding, no registration fee. Cannot be paused.' },
        { id: 'tb-3m-u30', name_da: '3 Måneder Ubegrænset', name_en: '3 Months Unlimited', price: 2999, perMonth: 999, vat_pct: 0, validity: '3 months', prodId: '100038',
          desc_da: 'Ubegrænset booking fra første bookingdato. Ingen binding, ingen registreringsgebyr. Kan ikke sættes på pause.',
          desc_en: 'Unlimited booking from first booking date. No binding, no registration fee. Cannot be paused.',
          saving: { save_da: 'Samme pris som Unlimited medlemskab \u2013 men uden registreringsgebyr (spar 275 kr)', save_en: 'Same price as Unlimited membership \u2013 but no registration fee (save 275 kr)' } },
        { id: 'tb-6m-u30', name_da: '6 Måneder Ubegrænset', name_en: '6 Months Unlimited', price: 5399, perMonth: 899, vat_pct: 0, validity: '6 months', popular: true, prodId: '100039',
          desc_da: 'Ubegrænset booking fra første bookingdato. Ingen binding, ingen registreringsgebyr. Kan ikke sættes på pause.',
          desc_en: 'Unlimited booking from first booking date. No binding, no registration fee. Cannot be paused.',
          saving: { save_da: '100 kr billigere pr. måned end Unlimited medlemskab + ingen registreringsgebyr (spar 275 kr)', save_en: '100 kr cheaper per month than Unlimited membership + no registration fee (save 275 kr)',
            breakdown_da: '6 \u00d7 899 kr/md. = 5.399 kr vs. 6 \u00d7 999 kr + 275 kr gebyr = 6.269 kr', breakdown_en: '6 \u00d7 899 kr/mo. = 5,399 kr vs. 6 \u00d7 999 kr + 275 kr fee = 6,269 kr' } },
        { id: 'tb-12m-u30', name_da: '12+1 Måneder Ubegrænset', name_en: '12+1 Months Unlimited', price: 9599, perMonth: 799, vat_pct: 0, validity: '13 months', bestDeal: true, prodId: '100040',
          desc_da: '12 måneder + 1 måned gratis. Ubegrænset booking. Ingen binding, ingen registreringsgebyr. Kan ikke sættes på pause.',
          desc_en: '12 months + 1 month free. Unlimited booking. No binding, no registration fee. Cannot be paused.',
          saving: { save_da: '200 kr billigere pr. måned end Unlimited medlemskab + ingen registreringsgebyr. Spar 2.664 kr i alt!', save_en: '200 kr cheaper per month than Unlimited membership + no registration fee. Save 2,664 kr total!',
            breakdown_da: '12 \u00d7 999 kr + 275 kr gebyr = 12.263 kr vs. kun 9.599 kr (spar 2.664 kr)', breakdown_en: '12 \u00d7 999 kr + 275 kr fee = 12,263 kr vs. only 9,599 kr (save 2,664 kr)' } }
      ]
    },
    trials: {
      over30: [
        { id: 'tr-1-30', _ref: 'clips:0' },
        { id: 'tr-14d-30', _ref: 'timebased:0' },
        { id: 'tr-21d-30', _ref: 'timebased:1' },
        { id: 'tr-kick-30', name_da: 'KickStarter', name_en: 'KickStarter', price: 599, vat_pct: 25, validity: '3 weeks', classes: 10, prodId: '100185', cphOnly: true,
          desc_da: 'Kun for Københavns-beboere. 10 klasser inden for 3 uger fra din første bookede klasse. Gyldighedsperioden starter fra din første bookede klasse.',
          desc_en: 'Only for Copenhagen residents. 10 classes to be used within 3 weeks from your first booked class. Validity period starts from your first booked class.'
        }
      ],
      under30: [
        { id: 'tr-1-u30', _ref: 'clips:0' },
        { id: 'tr-14d-u30', _ref: 'timebased:0' },
        { id: 'tr-21d-u30', _ref: 'timebased:1' },
        { id: 'tr-kick-u30', name_da: 'KickStarter', name_en: 'KickStarter', price: 475, vat_pct: 0, validity: '3 weeks', classes: 10, prodId: '100185', cphOnly: true,
          desc_da: 'Kun for Københavns-beboere. 10 klasser inden for 3 uger fra din første bookede klasse. Gyldighedsperioden starter fra din første bookede klasse.',
          desc_en: 'Only for Copenhagen residents. 10 classes to be used within 3 weeks from your first booked class. Validity period starts from your first booked class.'
        }
      ]
    },
    tourist: {
      over30: [
        { id: 'tour-7d-30', name_da: '7 Dage Ubegrænset', name_en: '7 Days Unlimited', price: 895, vat_pct: 25, validity: '7 days', prodId: '100199', inclMat: true,
          desc_da: '7 dages ubegrænset adgang inkl. måtte + 2 håndklæder (1 trænings- & 1 brusehåndklæde) \u2013 spar 110 kr pr. besøg på leje',
          desc_en: '7 days unlimited access incl. mat + 2 towels (1 practice & 1 shower towel) \u2013 save 110 kr per visit on rental'
        }
      ],
      under30: [
        { id: 'tour-1-u30', _ref: 'clips:0' },
        { id: 'tour-2-u30', _ref: 'clips:1' },
        { id: 'tour-7d-u30', name_da: '7 Dage Ubegrænset', name_en: '7 Days Unlimited', price: 750, vat_pct: 0, validity: '7 days', prodId: '100051', inclMat: true,
          desc_da: '7 dages ubegrænset adgang inkl. måtte + 2 håndklæder (1 trænings- & 1 brusehåndklæde) \u2013 spar 110 kr pr. besøg på leje',
          desc_en: '7 days unlimited access incl. mat + 2 towels (1 practice & 1 shower towel) \u2013 save 110 kr per visit on rental'
        }
      ],
      rental_note_da: 'Medbring eget udstyr eller: Måtteleje 40 kr \u00b7 Træningshåndklæde 40 kr \u00b7 Brusehåndklæde 40 kr (betal i studiet ved ankomst)',
      rental_note_en: 'Bring your own or: Mat rental 40 kr \u00b7 Practice towel 40 kr \u00b7 Shower towel 40 kr (pay at studio upon arrival)'
    }
  };

  // Sharing instructions (same for all sharing clips)
  var sharingHow = {
    da: ['Køb passet', 'Bed din(e) partner(e) om at oprette en profil på vores hjemmeside', 'Kontakt os på <a href="mailto:info@hotyogacph.dk">info@hotyogacph.dk</a> med jeres oplysninger \u2013 vi gør dine klip delbare'],
    en: ['Buy the pass', 'Ask your companion(s) to create a profile on our website', 'Contact us at <a href="mailto:info@hotyogacph.dk">info@hotyogacph.dk</a> with your details \u2013 we\u2019ll make your clips shareable'],
    note_da: 'I kan booke og træne enten sammen eller på forskellige tidspunkter og klasser efter jeres behov.',
    note_en: 'You can book and practise either together or at different times and classes at your convenience.'
  };

  function initStoreForm() {
    var checkoutForm = document.getElementById('yb-store-checkout-form');
    var cancelBtn = document.getElementById('yb-store-cancel-btn');
    var successCloseBtn = document.getElementById('yb-store-success-close');

    if (cancelBtn) cancelBtn.addEventListener('click', function() {
      var el = document.getElementById('yb-store-checkout');
      var list = document.getElementById('yb-store-list');
      if (el) el.hidden = true;
      if (list) list.style.display = '';
      // Reset checkout left column sections
      var waiverSect = document.getElementById('yb-checkout-waiver-section');
      if (waiverSect) waiverSect.hidden = true;
      var termsSection = document.getElementById('yb-checkout-terms-section');
      if (termsSection) termsSection.hidden = true;
      var agreeSection = document.getElementById('yb-checkout-agree-section');
      if (agreeSection) agreeSection.hidden = true;
      if (checkoutSigPad) checkoutSigPad.clear();
    });
    if (successCloseBtn) successCloseBtn.addEventListener('click', function() {
      var el = document.getElementById('yb-store-success');
      var list = document.getElementById('yb-store-list');
      if (el) el.hidden = true;
      if (list) list.style.display = '';
    });
    var successBookBtn = document.getElementById('yb-store-success-book');
    if (successBookBtn) successBookBtn.addEventListener('click', function() {
      var el = document.getElementById('yb-store-success');
      var list = document.getElementById('yb-store-list');
      if (el) el.hidden = true;
      if (list) list.style.display = '';
      // Switch to Schedule tab
      var scheduleBtn = document.querySelector('[data-yb-tab="schedule"]');
      if (scheduleBtn) scheduleBtn.click();
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

  /**
   * Calculate user's age from DOB string (YYYY-MM-DD).
   * Returns null if no DOB available.
   */
  var _ageOverride = null; // TEMP: for testing age-based filtering
  function getUserAge() {
    if (_ageOverride !== null) return _ageOverride;
    if (!userDateOfBirth) return null;
    var parts = userDateOfBirth.split('-');
    if (parts.length !== 3) return null;
    var birth = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    var today = new Date();
    var age = today.getFullYear() - birth.getFullYear();
    var monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    return age;
  }
  // TEMP: Expose age override for testing — call window.setAge(25) or window.setAge(35) in console, then refresh store
  window.setAge = function(age) {
    _ageOverride = (age === null || age === undefined) ? null : Number(age);
    console.log('[Store] Age override set to:', _ageOverride === null ? 'real DOB' : _ageOverride);
    // Rebuild store with new age bracket
    storeServices = [];
    loadStore();
  };

  /**
   * Determine the age bracket: 'over30' or 'under30'.
   * Defaults to 'over30' when no DOB is available (VAT-inclusive prices shown).
   */
  function getAgeBracket() {
    var age = getUserAge();
    return (age !== null && age < 30) ? 'under30' : 'over30';
  }

  /**
   * Resolve _ref items in catalog (e.g. trials/tourist referencing clips/timebased).
   * _ref format: 'clips:0' = clips array index 0, 'timebased:1' = timebased array index 1
   */
  function resolveCatalogRef(item, bracket) {
    if (!item._ref) return item;
    var parts = item._ref.split(':');
    var cat = parts[0];
    var idx = parseInt(parts[1], 10);
    var source = storeCatalog[cat] && storeCatalog[cat][bracket] ? storeCatalog[cat][bracket][idx] : null;
    if (!source) return null;
    var resolved = {};
    for (var k in source) { resolved[k] = source[k]; }
    resolved._refFrom = cat; // track where it came from
    return resolved;
  }

  /**
   * Build storeServices from hardcoded storeCatalog based on user's age bracket.
   * Each item gets a unique _uid for DOM lookup and prodId for the API.
   */
  function buildStoreFromCatalog() {
    var bracket = getAgeBracket();
    var items = [];
    var da = isDa();

    // ── Clip Cards ──
    var clips = storeCatalog.clips[bracket] || [];
    clips.forEach(function(c, i) {
      items.push({
        _uid: 'clips-' + c.prodId,
        prodId: c.prodId,
        name: c.classes + ' ' + (c.classes === 1 ? (da ? 'Klasse' : 'Class') : (da ? 'Klasser' : 'Classes')) + (c.label_da ? ' \u2014 ' + (da ? c.label_da : c.label_en) : ''),
        price: c.price,
        onlinePrice: c.price,
        _itemType: 'service',
        _topCategory: 'daily',
        _subCategory: 'clips',
        _catalog: c,
        _clipIndex: i
      });
    });

    // ── Memberships (contracts) ──
    var mems = storeCatalog.memberships[bracket] || [];
    mems.forEach(function(m) {
      items.push({
        _uid: 'mem-' + m.prodId,
        prodId: m.prodId,
        name: da ? m.name_da : m.name_en,
        price: m.price,
        onlinePrice: m.price,
        _itemType: 'contract',
        _topCategory: 'daily',
        _subCategory: 'memberships',
        _catalog: m,
        _recurringInfo: formatDKK(m.price) + ' ' + (da ? 'pr. måned' : 'per month'),
        firstMonthFree: m.firstMonthFree,
        _terms: [
          m.firstMonthFree ? (da ? 'Første måned gratis' : 'First month free') : null,
          (da ? 'Engangs-registreringsgebyr: ' : 'One-time registration fee: ') + formatDKK(m.regFee),
          da ? 'Løbende månedligt \u2013 opsig eller pause når som helst' : 'Month-to-month \u2013 cancel or pause anytime'
        ].filter(Boolean)
      });
    });

    // ── Time-based ──
    var tbs = storeCatalog.timebased[bracket] || [];
    tbs.forEach(function(tb) {
      items.push({
        _uid: 'tb-' + tb.prodId,
        prodId: tb.prodId,
        name: da ? tb.name_da : tb.name_en,
        price: tb.price,
        onlinePrice: tb.price,
        _itemType: 'service',
        _topCategory: 'daily',
        _subCategory: 'timebased',
        _catalog: tb
      });
    });

    // ── Trials (refs resolve to clips/timebased items) ──
    var trials = storeCatalog.trials[bracket] || [];
    trials.forEach(function(tr) {
      var resolved = resolveCatalogRef(tr, bracket);
      if (!resolved) return;
      var isRef = !!tr._ref;
      var isClipRef = isRef && tr._ref.indexOf('clips') === 0;
      items.push({
        _uid: 'trial-' + (resolved.prodId || tr.id),
        prodId: resolved.prodId,
        name: isClipRef
          ? (resolved.classes + ' ' + (resolved.classes === 1 ? (da ? 'Klasse' : 'Class') : (da ? 'Klasser' : 'Classes')) + (resolved.label_da ? ' \u2014 ' + (da ? resolved.label_da : resolved.label_en) : ''))
          : isRef
            ? (da ? resolved.name_da : resolved.name_en)
            : (da ? resolved.name_da : resolved.name_en),
        price: resolved.price,
        onlinePrice: resolved.price,
        _itemType: 'service',
        _topCategory: 'daily',
        _subCategory: 'trials',
        _catalog: resolved
      });
    });

    // ── Tourist ──
    var tourists = storeCatalog.tourist[bracket] || [];
    tourists.forEach(function(tp) {
      var resolved = resolveCatalogRef(tp, bracket);
      if (!resolved) return;
      var isRef = !!tp._ref;
      var isClipRef = isRef && tp._ref.indexOf('clips') === 0;
      items.push({
        _uid: 'tourist-' + (resolved.prodId || tp.id),
        prodId: resolved.prodId,
        name: isClipRef
          ? (resolved.classes + ' ' + (resolved.classes === 1 ? (da ? 'Klasse' : 'Class') : (da ? 'Klasser' : 'Classes')) + (resolved.label_da ? ' \u2014 ' + (da ? resolved.label_da : resolved.label_en) : ''))
          : (da ? resolved.name_da : resolved.name_en),
        price: resolved.price,
        onlinePrice: resolved.price,
        _itemType: 'service',
        _topCategory: 'daily',
        _subCategory: 'tourist',
        _catalog: resolved
      });
    });

    console.log('[Store] Built', items.length, 'items from catalog (bracket:', bracket, ')');
    return items;
  }

  function loadStore() {
    var listEl = document.getElementById('yb-store-list');
    if (!listEl) return;
    storeServices = buildStoreFromCatalog();
    if (!storeServices.length) {
      listEl.innerHTML = '<p class="yb-store__empty">' + t('store_empty') + '</p>';
      return;
    }
    renderStoreItems(listEl);
  }

  function renderStoreItems(container) {
    var visibleServices = storeServices;
    var html = '';

    // ── Top-level category cards view ──
    if (storeView === 'categories') {
      html += '<div class="yb-store__top-cats">';
      storeTopCategories.forEach(function(cat) {
        var count = visibleServices.filter(function(s) { return s._topCategory === cat.id; }).length;
        var hasItems = count > 0;
        var comingSoon = !hasItems && (cat.id === 'teacher' || cat.id === 'courses' || cat.id === 'private');
        html += '<button class="yb-store__top-cat' + (comingSoon ? ' yb-store__top-cat--soon' : '') + '" type="button" data-store-top="' + cat.id + '"' + (comingSoon ? ' data-store-soon' : '') + '>';
        html += '<div class="yb-store__top-cat-icon">' + cat.icon + '</div>';
        html += '<div class="yb-store__top-cat-text">';
        html += '<span class="yb-store__top-cat-name">' + (isDa() ? cat.da : cat.en) + '</span>';
        html += '<span class="yb-store__top-cat-desc">' + (isDa() ? cat.desc_da : cat.desc_en) + '</span>';
        if (comingSoon) html += '<span class="yb-store__top-cat-soon">' + (isDa() ? 'Kommer snart' : 'Coming soon') + '</span>';
        html += '</div>';
        if (hasItems) html += '<span class="yb-store__top-cat-count">' + count + '</span>';
        html += '<svg class="yb-store__top-cat-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>';
        html += '</button>';
      });
      html += '</div>';
      container.innerHTML = html;
      container.querySelectorAll('[data-store-top]').forEach(function(btn) {
        btn.addEventListener('click', function() {
          // "Coming soon" categories show contact info instead of items
          if (btn.hasAttribute('data-store-soon')) {
            var catId = btn.getAttribute('data-store-top');
            var da = isDa();
            var msgs = {
              teacher: { da: 'Yogalæreruddannelse — kontakt os for info og tilmelding.', en: 'Yoga Teacher Training — contact us for info and enrollment.' },
              courses: { da: 'Kurser — nye kurser annonceres snart. Hold øje!', en: 'Courses — new courses will be announced soon. Stay tuned!' },
              private: { da: 'Privattimer — kontakt os for at booke.', en: 'Private Classes — contact us to book.' }
            };
            var msg = msgs[catId] ? (da ? msgs[catId].da : msgs[catId].en) : '';
            showScheduleToast(msg, 'info');
            return;
          }
          storeTopCategory = btn.getAttribute('data-store-top');
          storeSubCategory = (storeTopCategory === 'daily') ? 'memberships' : 'all';
          storeView = 'items';
          storeSearchQuery = '';
          renderStoreItems(container);
        });
      });
      return;
    }

    // ── Items view (inside a category) ──
    var topCat = storeTopCategories.find(function(c) { return c.id === storeTopCategory; });

    html += '<button class="yb-store__back-btn" type="button" data-store-back>';
    html += '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>';
    html += (isDa() ? 'Alle kategorier' : 'All categories');
    html += '</button>';

    if (topCat) {
      html += '<div class="yb-store__cat-heading">';
      html += '<h3 class="yb-store__cat-title">' + (isDa() ? topCat.da : topCat.en) + '</h3>';
      html += '</div>';
    }

    // Subcategory pills (Daily Classes only)
    if (storeTopCategory === 'daily') {
      html += '<div class="yb-store__subcats">';
      storeDailySubs.forEach(function(sub) {
        var count = visibleServices.filter(function(s) { return s._topCategory === 'daily' && s._subCategory === sub.id; }).length;
        if (count === 0) return;
        var isActive = storeSubCategory === sub.id;
        html += '<button class="yb-store__sub-btn' + (isActive ? ' is-active' : '') + '" type="button" data-store-sub="' + sub.id + '">';
        html += '<span class="yb-store__sub-name">' + (isDa() ? sub.da : sub.en) + '</span>';
        if (sub.desc_da) html += '<span class="yb-store__sub-desc">' + (isDa() ? sub.desc_da : sub.desc_en) + '</span>';
        html += '</button>';
      });
      html += '</div>';
    }

    var filtered = visibleServices.filter(function(s) { return s._topCategory === storeTopCategory; });
    if (storeTopCategory === 'daily' && storeSubCategory !== 'all') {
      filtered = filtered.filter(function(s) { return s._subCategory === storeSubCategory; });
    }

    // Search
    html += '<div class="yb-store__search-wrap">';
    html += '<svg class="yb-store__search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6F6A66" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    html += '<input type="text" class="yb-store__search" placeholder="' + (isDa() ? 'Søg...' : 'Search...') + '" value="' + esc(storeSearchQuery) + '">';
    if (storeSearchQuery) html += '<button type="button" class="yb-store__search-clear" aria-label="Clear">&times;</button>';
    html += '</div>';

    if (storeSearchQuery) {
      var q = storeSearchQuery.toLowerCase();
      filtered = filtered.filter(function(s) { return (s.name || '').toLowerCase().indexOf(q) !== -1; });
    }

    // Time-based pass consolidated description (same for all cards)
    if (storeTopCategory === 'daily' && storeSubCategory === 'timebased') {
      html += '<div class="yb-store__note yb-store__note--timebased">';
      html += '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
      html += '<span>' + (isDa()
        ? 'Ubegrænset booking fra første bookingdato. Ingen binding, ingen registreringsgebyr. Kan ikke sættes på pause.'
        : 'Unlimited booking from first booking date. No commitment, no registration fee. Cannot be paused.') + '</span>';
      html += '</div>';
    }

    // Tourist rental note
    if (storeTopCategory === 'daily' && storeSubCategory === 'tourist') {
      html += '<div class="yb-store__note">';
      html += '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
      html += '<span>' + (isDa() ? storeCatalog.tourist.rental_note_da : storeCatalog.tourist.rental_note_en) + '</span>';
      html += '</div>';
    }

    html += renderStoreCardGrid(filtered);
    container.innerHTML = html;
    attachStoreHandlers(container);
  }

  /** Render the card grid HTML for catalog-backed services */
  function renderStoreCardGrid(filtered) {
    var html = '';
    var da = isDa();
    html += '<div class="yb-store__grid">';
    filtered.forEach(function(s) {
      var price = s.price || 0;
      var cat = s._catalog || {};
      var isContract = s._itemType === 'contract';
      var sub = s._subCategory;
      var isClipLike = !!(cat.classes && cat.perClass);

      html += '<div class="yb-store__item' + (isContract ? ' yb-store__item--contract' : '') + (cat.popular ? ' yb-store__item--popular' : '') + (cat.bestDeal ? ' yb-store__item--best' : '') + '">';

      // Badges
      var badges = [];
      if (isContract && cat.firstMonthFree) badges.push('<span class="yb-store__badge yb-store__badge--free">' + (da ? 'Første måned gratis' : 'First month free') + '</span>');
      if (isContract) badges.push('<span class="yb-store__badge yb-store__badge--membership">' + (da ? 'Medlemskab' : 'Membership') + '</span>');
      if (cat.popular) badges.push('<span class="yb-store__badge yb-store__badge--popular">' + (da ? 'Populær' : 'Popular') + '</span>');
      if (cat.bestDeal) badges.push('<span class="yb-store__badge yb-store__badge--best">' + (da ? 'Bedste tilbud' : 'Best deal') + '</span>');
      if (cat.inclMat) badges.push('<span class="yb-store__badge yb-store__badge--tourist">' + (da ? 'Inkl. måtte & håndklæde' : 'Incl. mat & towel') + '</span>');
      if (cat.cphOnly) badges.push('<span class="yb-store__badge yb-store__badge--cph">' + (da ? 'Kun København' : 'CPH only') + '</span>');
      if (badges.length) html += '<div class="yb-store__item-badges">' + badges.join('') + '</div>';

      html += '<div class="yb-store__item-info">';
      html += '<h3 class="yb-store__item-name">' + esc(s.name) + '</h3>';

      // ── Clip-like items (clips, clip-refs in trials/tourist) ──
      if (isClipLike) {
        if (cat.classes > 1 && cat.perClass) {
          html += '<p class="yb-store__item-per-class">' + (da ? 'Kun ' : 'Only ') + formatDKK(cat.perClass) + ' ' + (da ? 'pr. klasse' : 'per class') + '</p>';
        }
        if (cat.validity) {
          html += '<p class="yb-store__item-validity">';
          html += '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ';
          html += (da ? 'Gyldighed: ' : 'Valid for: ') + cat.validity + ' ' + (da ? 'fra første booking' : 'from first booking');
          html += '</p>';
        }
        // Sharing
        if (cat.sharing) {
          html += '<p class="yb-store__item-sharing">';
          html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> ';
          html += (da
            ? 'Del med ' + cat.sharing.persons + ' person' + (cat.sharing.persons > 1 ? 'er' : '') + ' (' + cat.sharing.total + ' i alt)'
            : 'Share with ' + cat.sharing.persons + ' person' + (cat.sharing.persons > 1 ? 's' : '') + ' (' + cat.sharing.total + ' total)');
          html += '</p>';
          // Collapsible sharing instructions
          html += '<div class="yb-store__sharing-how">';
          html += '<button type="button" class="yb-store__sharing-toggle">' + (da ? 'Sådan fungerer deling' : 'How sharing works') + ' <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></button>';
          html += '<div class="yb-store__sharing-details" hidden>';
          html += '<ol>';
          (da ? sharingHow.da : sharingHow.en).forEach(function(step) { html += '<li>' + step + '</li>'; });
          html += '</ol>';
          html += '<p class="yb-store__sharing-note">' + (da ? sharingHow.note_da : sharingHow.note_en) + '</p>';
          html += '</div></div>';
        }
        // VAT moved to footer (under price)
      }

      // ── Membership details ──
      if (isContract) {
        if (cat.perClassNote_da) {
          html += '<p class="yb-store__item-per-class">' + (da ? cat.perClassNote_da : cat.perClassNote_en) + '</p>';
        } else if (cat.perClass) {
          html += '<p class="yb-store__item-per-class">' + formatDKK(cat.perClass) + ' ' + (da ? 'pr. klasse' : 'per class') + '</p>';
        }
        var features = da ? cat.features_da : cat.features_en;
        if (features && features.length) {
          html += '<ul class="yb-store__item-features">';
          features.forEach(function(f) { html += '<li>' + esc(f) + '</li>'; });
          html += '</ul>';
        }
        if (s._terms && s._terms.length) {
          html += '<ul class="yb-store__item-terms">';
          s._terms.forEach(function(term) { html += '<li>' + esc(term) + '</li>'; });
          html += '<li><a href="' + (da ? '/terms-conditions/' : '/en/terms-conditions/') + '" target="_blank" rel="noopener">' + (da ? 'Se handelsbetingelser' : 'View terms & conditions') + '</a></li>';
          html += '</ul>';
        }
      }

      // ── Time-based details ──
      if (sub === 'timebased' && !isClipLike) {
        // Description shown once as consolidated banner above the grid
        if (cat.validity) {
          html += '<p class="yb-store__item-validity">';
          html += '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ';
          html += (da ? 'Ubegrænset adgang i ' : 'Unlimited access for ') + cat.validity + ' ' + (da ? 'fra første booking' : 'from first booking');
          html += '</p>';
        }
        if (cat.perMonth) {
          html += '<p class="yb-store__item-per-class">' + formatDKK(cat.perMonth) + ' ' + (da ? 'pr. måned' : 'per month') + '</p>';
        }
        if (cat.saving) {
          html += '<div class="yb-store__item-saving">';
          html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>';
          html += '<div>';
          html += '<p class="yb-store__saving-text">' + (da ? cat.saving.save_da : cat.saving.save_en) + '</p>';
          if (cat.saving.breakdown_da) {
            html += '<p class="yb-store__saving-breakdown">' + (da ? cat.saving.breakdown_da : cat.saving.breakdown_en) + '</p>';
          }
          html += '</div></div>';
        }
        // VAT moved to footer (under price)
      }

      // ── Trial / Tourist custom descriptions ──
      if ((sub === 'trials' || sub === 'tourist') && !isClipLike) {
        if (cat.desc_da) html += '<p class="yb-store__item-desc">' + (da ? cat.desc_da : cat.desc_en) + '</p>';
        if (cat.validity) {
          html += '<p class="yb-store__item-validity">';
          html += '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ';
          html += (da ? 'Gyldighed: ' : 'Valid for: ') + cat.validity + ' ' + (da ? 'fra første booking' : 'from first booking');
          html += '</p>';
        }
        // VAT moved to footer (under price)
      }

      html += '</div>'; // .yb-store__item-info

      // ── Pricing + Buy ──
      html += '<div class="yb-store__item-footer">';
      html += '<div class="yb-store__item-pricing">';
      html += '<span class="yb-store__item-price">' + formatDKK(price) + '</span>';
      if (isContract) html += '<span class="yb-store__item-recurring">' + (da ? 'pr. måned' : 'per month') + '</span>';
      // Unified VAT note right under price (all categories)
      var _vatAmt = 0;
      var _vatZero = false;
      if (isClipLike && cat.vat !== undefined) {
        if (cat.vat > 0) _vatAmt = cat.vat;
        else _vatZero = true;
      } else if (cat.vat_pct !== undefined) {
        if (cat.vat_pct > 0) _vatAmt = Math.round(price * cat.vat_pct / (100 + cat.vat_pct));
        else _vatZero = true;
      }
      if (_vatAmt > 0) {
        html += '<span class="yb-store__item-vat">' + (da ? 'Inkl. ' + formatDKK(_vatAmt) + ' moms (25%)' : 'Incl. ' + formatDKK(_vatAmt) + ' VAT (25%)') + '</span>';
      } else if (_vatZero) {
        html += '<span class="yb-store__item-vat yb-store__item-vat--zero">' + (da ? 'Momsfrit (under 30)' : 'VAT exempt (under 30)') + '</span>';
      }
      html += '</div>';
      html += '<button class="yb-btn yb-btn--primary yb-store__item-btn" type="button" data-store-buy="' + s._uid + '" data-item-type="' + (s._itemType || 'service') + '">' + t('store_buy') + '</button>';
      html += '</div>';

      html += '</div>'; // .yb-store__item
    });
    if (!filtered.length) {
      html += '<p class="yb-store__empty">' + (storeSearchQuery
        ? (da ? 'Ingen resultater for "' + esc(storeSearchQuery) + '"' : 'No results for "' + esc(storeSearchQuery) + '"')
        : t('store_empty')) + '</p>';
    }
    html += '</div>';
    return html;
  }

  /** Attach all store event handlers after rendering */
  function attachStoreHandlers(container) {
    var searchInput = container.querySelector('.yb-store__search');
    if (searchInput) {
      searchInput.addEventListener('input', function() {
        storeSearchQuery = this.value;
        renderStoreItems(container);
      });
      if (storeSearchQuery) { searchInput.focus(); searchInput.setSelectionRange(storeSearchQuery.length, storeSearchQuery.length); }
    }
    var clearBtn = container.querySelector('.yb-store__search-clear');
    if (clearBtn) clearBtn.addEventListener('click', function() { storeSearchQuery = ''; renderStoreItems(container); });

    container.querySelector('[data-store-back]') && container.querySelector('[data-store-back]').addEventListener('click', function() {
      storeView = 'categories'; storeTopCategory = null; storeSubCategory = 'all'; storeSearchQuery = ''; renderStoreItems(container);
    });

    container.querySelectorAll('[data-store-sub]').forEach(function(btn) {
      btn.addEventListener('click', function() { storeSubCategory = btn.getAttribute('data-store-sub'); storeSearchQuery = ''; renderStoreItems(container); });
    });

    // Buy buttons → openCheckout via _uid
    container.querySelectorAll('[data-store-buy]').forEach(function(btn) {
      btn.addEventListener('click', function() { openCheckout(btn.getAttribute('data-store-buy'), btn.getAttribute('data-item-type') || 'service'); });
    });

    // Sharing dropdown toggles
    container.querySelectorAll('.yb-store__sharing-toggle').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var details = btn.nextElementSibling;
        if (details) { details.hidden = !details.hidden; btn.classList.toggle('is-open', !details.hidden); }
      });
    });
  }

  /**
   * Filter the Store to show only passes that match the given programId.
   * Called when a booking fails with no_pass.
   */
  function filterStoreByProgram(programId, programName) {
    if (!storeServices.length) return;
    storeView = 'items'; storeTopCategory = 'daily'; storeSubCategory = 'all'; storeSearchQuery = '';
    var storeContainer = document.getElementById('yb-store-list');
    if (storeContainer) renderStoreItems(storeContainer);
    showScheduleToast(isDa()
      ? 'Vælg et pas til ' + (programName || 'denne klassetype')
      : 'Choose a pass for ' + (programName || 'this class type'), 'info');
  }

  // ══════════════════════════════════════
  // GIFT CARDS TAB
  // ══════════════════════════════════════
  var giftCardsData = null;
  var selectedGiftCard = null;

  function loadGiftCards() {
    var listEl = document.getElementById('yb-giftcards-list');
    if (!listEl) return;
    if (giftCardsData) { renderGiftCards(listEl); return; }

    listEl.innerHTML = '<div class="yb-store__loading"><div class="yb-mb-spinner"></div><span>' + t('giftcards_loading') + '</span></div>';

    fetch('/.netlify/functions/mb-giftcards')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.error) {
          console.error('[GiftCards] API error:', data.error);
          giftCardsData = [];
        } else {
          giftCardsData = data.giftCards || [];
        }
        console.log('[GiftCards] Loaded:', giftCardsData.length);
        renderGiftCards(listEl);
      })
      .catch(function(err) {
        console.error('[GiftCards] Load error:', err);
        giftCardsData = [];
        renderGiftCards(listEl);
      });
  }

  function renderGiftCards(container) {
    var da = isDa();

    // No gift cards available (API error or none configured) — show contact fallback
    if (!giftCardsData || !giftCardsData.length) {
      var html = '<div class="yb-giftcards__empty">';
      html += '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#E8E4E0" stroke-width="1"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a4 4 0 0 0-8 0v2"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>';
      html += '<p class="yb-giftcards__empty-title">' + (da ? 'Gavekort' : 'Gift Cards') + '</p>';
      html += '<p class="yb-giftcards__empty-text">' + (da
        ? 'Kontakt os for at købe et gavekort til en du holder af.'
        : 'Contact us to purchase a gift card for someone you love.') + '</p>';
      html += '<a href="mailto:info@hotyogacph.dk" class="yb-btn yb-btn--primary">' + (da ? 'Kontakt os' : 'Contact us') + '</a>';
      html += '</div>';
      container.innerHTML = html;
      return;
    }

    // Render gift card options as clean minimal list
    var html = '';
    giftCardsData.forEach(function(gc) {
      var isSelected = selectedGiftCard && String(selectedGiftCard.id) === String(gc.id);
      html += '<div class="yb-giftcards__option' + (isSelected ? ' is-selected' : '') + '" data-gc-id="' + gc.id + '">';
      html += '<div class="yb-giftcards__option-left">';
      html += '<span class="yb-giftcards__option-name">' + esc(gc.description || (da ? 'Gavekort' : 'Gift Card')) + '</span>';
      if (gc.terms) html += '<span class="yb-giftcards__option-terms">' + esc(gc.terms) + '</span>';
      html += '</div>';
      html += '<span class="yb-giftcards__option-price">' + formatDKK(gc.salePrice || gc.value) + '</span>';
      html += '</div>';
    });
    container.innerHTML = html;

    // Click to select
    container.querySelectorAll('[data-gc-id]').forEach(function(card) {
      card.addEventListener('click', function() {
        var gcId = card.getAttribute('data-gc-id');
        selectedGiftCard = giftCardsData.find(function(g) { return String(g.id) === gcId; });
        // Update selection UI
        container.querySelectorAll('.yb-giftcards__option').forEach(function(c) { c.classList.remove('is-selected'); });
        card.classList.add('is-selected');
        // Show form
        var formEl = document.getElementById('yb-giftcard-form');
        if (formEl) {
          formEl.hidden = false;
          // Update selected price in form
          var priceEl = formEl.querySelector('.yb-giftcards__form-price');
          if (priceEl) priceEl.textContent = formatDKK(selectedGiftCard.salePrice || selectedGiftCard.value);
          // Show/hide custom amount field
          var customAmountField = document.getElementById('yb-gc-custom-amount-field');
          if (customAmountField) {
            customAmountField.hidden = !selectedGiftCard.editableByConsumer;
            if (selectedGiftCard.editableByConsumer) {
              var amtInput = document.getElementById('yb-gc-custom-amount');
              if (amtInput && !amtInput.value) amtInput.value = selectedGiftCard.salePrice || selectedGiftCard.value || '';
            }
          }
          // Pre-fill cardholder
          var gcHolder = document.getElementById('yb-gc-cardholder');
          if (gcHolder && currentUser && currentUser.displayName && !gcHolder.value) gcHolder.value = currentUser.displayName;
          formEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  }

  function initGiftCards() {
    var cancelBtn = document.getElementById('yb-gc-cancel-btn');
    if (cancelBtn) cancelBtn.addEventListener('click', function() {
      var formEl = document.getElementById('yb-giftcard-form');
      if (formEl) formEl.hidden = true;
      selectedGiftCard = null;
    });

    var buyBtn = document.getElementById('yb-gc-buy-btn');
    if (buyBtn) buyBtn.addEventListener('click', function() {
      if (!selectedGiftCard || !clientId) return;
      var recipientName = (document.getElementById('yb-gc-recipient-name') || {}).value || '';
      var recipientEmail = (document.getElementById('yb-gc-recipient-email') || {}).value || '';
      var title = (document.getElementById('yb-gc-title') || {}).value || '';
      var message = (document.getElementById('yb-gc-message') || {}).value || '';
      var deliveryDate = (document.getElementById('yb-gc-delivery-date') || {}).value || '';
      var gcCardNumber = (document.getElementById('yb-gc-cardnumber') || {}).value || '';
      var gcExpiry = (document.getElementById('yb-gc-expiry') || {}).value || '';
      var gcCvv = (document.getElementById('yb-gc-cvv') || {}).value || '';
      var gcCardHolder = (document.getElementById('yb-gc-cardholder') || {}).value || '';
      var errEl = document.getElementById('yb-gc-error');

      if (!recipientName.trim() || !recipientEmail.trim()) {
        if (errEl) { errEl.textContent = isDa() ? 'Udfyld modtagers navn og email.' : 'Please enter recipient name and email.'; errEl.hidden = false; }
        return;
      }

      gcCardNumber = gcCardNumber.replace(/\s/g, '');
      if (!gcCardNumber || gcCardNumber.length < 13) {
        if (errEl) { errEl.textContent = isDa() ? 'Indtast et gyldigt kortnummer.' : 'Enter a valid card number.'; errEl.hidden = false; }
        return;
      }
      if (!gcExpiry || gcExpiry.length < 4) {
        if (errEl) { errEl.textContent = isDa() ? 'Indtast udløbsdato.' : 'Enter expiry date.'; errEl.hidden = false; }
        return;
      }
      if (!gcCvv || gcCvv.length < 3) {
        if (errEl) { errEl.textContent = isDa() ? 'Indtast CVV.' : 'Enter CVV.'; errEl.hidden = false; }
        return;
      }

      var gcExpParts = gcExpiry.split('/');
      var gcCustomAmount = selectedGiftCard.editableByConsumer ? ((document.getElementById('yb-gc-custom-amount') || {}).value || '') : '';

      buyBtn.disabled = true;
      buyBtn.textContent = isDa() ? 'Behandler...' : 'Processing...';
      if (errEl) errEl.hidden = true;

      var gcPostBody = {
        giftCardId: selectedGiftCard.id,
        clientId: clientId,
        recipientEmail: recipientEmail.trim(),
        recipientName: recipientName.trim(),
        title: title.trim() || (isDa() ? 'Gavekort' : 'Gift Card'),
        message: message.trim(),
        deliveryDate: deliveryDate || undefined,
        layoutId: selectedGiftCard.layouts && selectedGiftCard.layouts.length ? selectedGiftCard.layouts[0].id : 0,
        payment: {
          cardNumber: gcCardNumber,
          expMonth: gcExpParts[0],
          expYear: gcExpParts[1] ? '20' + gcExpParts[1] : '',
          cvv: gcCvv,
          cardHolder: gcCardHolder.trim()
        }
      };
      if (gcCustomAmount) gcPostBody.customAmount = Number(gcCustomAmount);

      fetch('/.netlify/functions/mb-giftcards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(gcPostBody)
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        buyBtn.disabled = false;
        buyBtn.textContent = t('giftcard_buy');
        if (data.error) {
          var errEl = document.getElementById('yb-gc-error');
          if (errEl) { errEl.textContent = data.error; errEl.hidden = false; }
          return;
        }
        var formEl = document.getElementById('yb-giftcard-form');
        if (formEl) formEl.hidden = true;
        selectedGiftCard = null;
        showScheduleToast(isDa()
          ? 'Gavekort sendt til ' + recipientEmail.trim() + '!'
          : 'Gift card sent to ' + recipientEmail.trim() + '!', 'success');
      })
      .catch(function(err) {
        buyBtn.disabled = false;
        buyBtn.textContent = t('giftcard_buy');
        var errEl = document.getElementById('yb-gc-error');
        if (errEl) { errEl.textContent = isDa() ? 'Noget gik galt. Prøv igen.' : 'Something went wrong. Please try again.'; errEl.hidden = false; }
      });
    });
  }

  function openCheckout(serviceUid, itemType) {
    // Find by _uid (unique key), use prodId for the API
    var service = storeServices.find(function(s) { return s._uid === serviceUid; });
    if (!service) return;
    var listEl = document.getElementById('yb-store-list');
    var checkoutEl = document.getElementById('yb-store-checkout');
    var itemEl = document.getElementById('yb-store-checkout-item');
    if (listEl) listEl.style.display = 'none';
    if (checkoutEl) checkoutEl.hidden = false;
    var price = service.onlinePrice || service.price || 0;
    var isContract = service._itemType === 'contract';
    var cat = service._catalog || {};
    var da = isDa();

    var itemHtml = '<div class="yb-store__checkout-item-details">';
    itemHtml += '<span class="yb-store__checkout-item-name">' + esc(service.name) + '</span>';
    if (isContract && service._recurringInfo) {
      itemHtml += '<span class="yb-store__checkout-item-recurring">' + esc(service._recurringInfo) + '</span>';
    }
    // First month free: show crossed-out price
    if (isContract && cat.firstMonthFree) {
      itemHtml += '<div class="yb-store__checkout-saving">';
      itemHtml += '<span class="yb-store__checkout-price-old"><s>' + formatDKK(price) + '</s></span> ';
      itemHtml += '<span class="yb-store__checkout-price-free">' + (da ? '0 kr første måned' : '0 kr first month') + '</span>';
      itemHtml += '</div>';
      if (cat.regFee) {
        itemHtml += '<div class="yb-store__checkout-due">';
        itemHtml += '<span class="yb-store__checkout-due-label">' + (da ? 'Beløb at betale nu:' : 'Amount due now:') + '</span> ';
        itemHtml += '<strong class="yb-store__checkout-due-amount">' + formatDKK(cat.regFee) + '</strong>';
        itemHtml += '<span class="yb-store__checkout-due-note">' + (da ? ' (registreringsgebyr)' : ' (registration fee)') + '</span>';
        itemHtml += '</div>';
      }
    }
    if (isContract && service._terms && service._terms.length) {
      itemHtml += '<ul class="yb-store__checkout-terms">';
      service._terms.forEach(function(term) { itemHtml += '<li>' + esc(term) + '</li>'; });
      itemHtml += '</ul>';
    }
    // Time-based savings breakdown in checkout
    if (cat.saving && cat.saving.breakdown_da) {
      itemHtml += '<div class="yb-store__checkout-saving">';
      itemHtml += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#27ae60" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg> ';
      itemHtml += '<span>' + (da ? cat.saving.breakdown_da : cat.saving.breakdown_en) + '</span>';
      itemHtml += '</div>';
    }
    itemHtml += '</div>';
    itemHtml += '<span class="yb-store__checkout-item-price">' + formatDKK(price) + '</span>';
    if (itemEl) itemEl.innerHTML = itemHtml;
    // Store the actual prodId for the API (not _uid)
    checkoutEl.setAttribute('data-service-id', service.prodId);
    checkoutEl.setAttribute('data-service-price', price);
    checkoutEl.setAttribute('data-item-type', itemType || service._itemType || 'service');
    if (service.locationId) checkoutEl.setAttribute('data-location-id', service.locationId);
    var holderInput = document.getElementById('yb-store-cardholder');
    if (holderInput && currentUser && currentUser.displayName) holderInput.value = currentUser.displayName;
    var errEl = document.getElementById('yb-store-error');
    if (errEl) errEl.hidden = true;

    // 1. Determine what documents to show
    var waiverSection = document.getElementById('yb-checkout-waiver-section');
    var termsSection = document.getElementById('yb-checkout-terms-section');
    var agreeSection = document.getElementById('yb-checkout-agree-section');
    var showWaiver = !waiverSigned;
    // Always show terms + signature for contracts (required by Mindbody)
    var showTerms = !!isContract;
    var hasLeftContent = showWaiver || showTerms;

    // 2. Populate collapsible document sections
    if (waiverSection) {
      waiverSection.hidden = !showWaiver;
      if (showWaiver) {
        var waiverTextEl = document.getElementById('yb-checkout-waiver-text');
        if (waiverTextEl) {
          waiverTextEl.innerHTML = waiverTextCache || ('<p>' + t('waiver_fallback') + '</p>');
          waiverTextEl.hidden = true; // collapsed by default
        }
      }
    }
    if (termsSection) {
      termsSection.hidden = !showTerms;
      if (showTerms) {
        var termsTextEl = document.getElementById('yb-checkout-terms-text');
        if (termsTextEl) {
          // Use Mindbody agreement terms if available, otherwise show default membership terms
          termsTextEl.innerHTML = service.agreementTerms || t('contract_default_terms');
          termsTextEl.hidden = true; // collapsed by default
        }
      }
    }

    // 3. Show unified agree checkbox + single signature pad
    if (agreeSection) {
      agreeSection.hidden = !hasLeftContent;
      if (hasLeftContent) {
        var agreeCheck = document.getElementById('yb-checkout-agree-check');
        if (agreeCheck) agreeCheck.checked = false;
        // Dynamic label: waiver-only vs waiver+terms
        var agreeLabel = document.getElementById('yb-checkout-agree-label');
        if (agreeLabel) {
          agreeLabel.textContent = (showWaiver && showTerms)
            ? t('checkout_agree_waiver_and_terms')
            : showTerms ? t('contract_terms_agree') : t('checkout_agree_waiver');
        }
      }
    }

    // 4. Wire up collapsible toggles
    var waiverToggle = document.getElementById('yb-checkout-waiver-toggle');
    if (waiverToggle && !waiverToggle._bound) {
      waiverToggle._bound = true;
      waiverToggle.addEventListener('click', function() {
        var content = document.getElementById('yb-checkout-waiver-text');
        if (content) {
          content.hidden = !content.hidden;
          waiverToggle.classList.toggle('is-open', !content.hidden);
        }
      });
    }
    var termsToggle = document.getElementById('yb-checkout-terms-toggle');
    if (termsToggle && !termsToggle._bound) {
      termsToggle._bound = true;
      termsToggle.addEventListener('click', function() {
        var content = document.getElementById('yb-checkout-terms-text');
        if (content) {
          content.hidden = !content.hidden;
          termsToggle.classList.toggle('is-open', !content.hidden);
        }
      });
    }

    // 5. Toggle two-column grid and init single signature pad
    var checkoutGrid = document.getElementById('yb-checkout-grid');
    if (checkoutGrid) {
      checkoutGrid.classList.toggle('yb-checkout__grid--split', hasLeftContent);
    }
    if (hasLeftContent && checkoutGrid) checkoutGrid.offsetHeight; // force reflow
    if (hasLeftContent) {
      if (!checkoutSigPad) {
        checkoutSigPad = SignaturePad('yb-checkout-canvas', 'yb-checkout-sig-clear');
      } else {
        checkoutSigPad.clear();
      }
    }

    checkoutEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  var checkoutSigPad = null;

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

    // Validate unified agree checkbox + signature (if waiver/terms are shown)
    var agreeSection = document.getElementById('yb-checkout-agree-section');
    if (agreeSection && !agreeSection.hidden) {
      var agreeCheck = document.getElementById('yb-checkout-agree-check');
      if (!agreeCheck || !agreeCheck.checked) {
        showSimpleError(errorEl, isDa() ? 'Du skal acceptere vilkårene for at fortsætte.' : 'You must accept the terms to continue.');
        return;
      }
      if (checkoutSigPad && checkoutSigPad.isEmpty()) {
        showSimpleError(errorEl, isDa() ? 'Tegn venligst din underskrift.' : 'Please draw your signature.');
        return;
      }
    }

    if (!cardNumber || cardNumber.length < 13) { showSimpleError(errorEl, isDa() ? 'Indtast et gyldigt kortnummer.' : 'Enter a valid card number.'); return; }
    if (!expiry || expiry.length < 4) { showSimpleError(errorEl, isDa() ? 'Indtast udløbsdato.' : 'Enter expiry date.'); return; }
    if (!cvv || cvv.length < 3) { showSimpleError(errorEl, isDa() ? 'Indtast CVV.' : 'Enter CVV.'); return; }

    var expParts = expiry.split('/');
    payBtn.disabled = true;
    payBtn.textContent = isDa() ? 'Behandler betaling...' : 'Processing payment...';

    if (!clientId) {
      // Try to sync account first, then retry
      showSimpleError(errorEl, isDa() ? 'Vent venligst — vi opretter din konto...' : 'Please wait — setting up your account...');
      var syncUser = firebase.auth().currentUser;
      if (syncUser && currentDb) {
        var fn = (syncUser.displayName || '').split(' ')[0] || '';
        var ln = (syncUser.displayName || '').split(' ').slice(1).join(' ') || '';
        fetch('/.netlify/functions/mb-sync', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: syncUser.email, firstName: fn, lastName: ln })
        }).then(function(r) { return r.json(); }).then(function(syncData) {
          if (syncData.clientId) {
            clientId = String(syncData.clientId);
            currentDb.collection('users').doc(syncUser.uid).update({ mindbodyClientId: clientId });
            showSimpleError(errorEl, isDa() ? 'Konto oprettet! Prøv igen.' : 'Account ready! Please try again.');
          } else {
            showSimpleError(errorEl, isDa() ? 'Kunne ikke oprette konto. Kontakt os.' : 'Could not set up account. Contact us.');
          }
        }).catch(function() {
          showSimpleError(errorEl, isDa() ? 'Kunne ikke oprette konto. Kontakt os.' : 'Could not set up account. Contact us.');
        });
      }
      payBtn.disabled = false; payBtn.textContent = payBtnText; return;
    }

    // Submit waiver silently first if waiver is shown in checkout
    var waiverPromise = Promise.resolve(true);
    var waiverSection = document.getElementById('yb-checkout-waiver-section');
    if (waiverSection && !waiverSection.hidden && !waiverSigned && clientId) {
      waiverPromise = submitLiabilityWaiver(clientId, 'checkout');
    }

    var itemType = checkoutEl.getAttribute('data-item-type') || 'service';
    var paymentInfo = {
      cardNumber: cardNumber, expMonth: expParts[0], expYear: expParts[1] ? '20' + expParts[1] : '',
      cvv: cvv, cardHolder: cardHolder, billingAddress: address, billingCity: city, billingPostalCode: zip,
      saveCard: saveCard ? saveCard.checked : false
    };

    var fetchUrl, fetchBody;
    if (itemType === 'contract') {
      // Contract purchase uses /sale/purchasecontract via mb-contracts POST
      var locationId = checkoutEl.getAttribute('data-location-id');
      var promoCode = checkoutEl.getAttribute('data-promo-code') || '';
      fetchUrl = '/.netlify/functions/mb-contracts';
      fetchBody = {
        clientId: clientId,
        contractId: Number(serviceId),
        locationId: locationId ? Number(locationId) : 1,
        startDate: toLocalDateStr(new Date()),
        payment: paymentInfo
      };
      if (promoCode) {
        fetchBody.promoCode = promoCode;
        console.log('[Checkout] Applying promo code:', promoCode);
      }
      // Include electronic signature if contract terms were shown
      if (checkoutSigPad && !checkoutSigPad.isEmpty()) {
        fetchBody.clientSignature = checkoutSigPad.toDataURL();
      }
    } else {
      // Service purchase uses /sale/cartcheckout via mb-checkout POST
      fetchUrl = '/.netlify/functions/mb-checkout';
      fetchBody = {
        clientId: clientId,
        items: [{ type: 'Service', id: Number(serviceId), quantity: 1 }],
        amount: amount,
        payment: paymentInfo
      };
    }

    // Wait for waiver submission (if applicable) before purchase
    waiverPromise.then(function(waiverOk) {
      if (waiverOk === false) { payBtn.disabled = false; payBtn.textContent = payBtnText; return; }

      fetch(fetchUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fetchBody)
      }).then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.success) {
            checkoutEl.hidden = true;
            // Reset left column sections after successful purchase
            var wvs = document.getElementById('yb-checkout-waiver-section');
            if (wvs) wvs.hidden = true;
            var tss = document.getElementById('yb-checkout-terms-section');
            if (tss) tss.hidden = true;
            var ags = document.getElementById('yb-checkout-agree-section');
            if (ags) ags.hidden = true;
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
    });
  }

  // ══════════════════════════════════════
  // SCHEDULE TAB
  // ══════════════════════════════════════
  var scheduleWeekOffset = 0;
  var scheduleClassFilter = 'all'; // Active class type filter (session type name or 'all')

  function matchesClassFilter(cls) {
    if (scheduleClassFilter === 'all') return true;
    return (cls.sessionTypeName || '') === scheduleClassFilter;
  }

  /**
   * Build filter list dynamically from the session types present in this week's classes.
   * Returns [{id: 'all', label: 'All'}, {id: 'Yin Yoga (Passive/Static)', label: 'Yin Yoga (Passive/Static)'}, ...]
   */
  function buildScheduleFilters(classes) {
    var seen = {};
    var filters = [{ id: 'all', label: isDa() ? 'Alle' : 'All' }];
    classes.forEach(function(cls) {
      var st = cls.sessionTypeName;
      if (st && !seen[st]) {
        seen[st] = true;
        filters.push({ id: st, label: st });
      }
    });
    // Sort filters alphabetically (after "All")
    filters.sort(function(a, b) {
      if (a.id === 'all') return -1;
      if (b.id === 'all') return 1;
      return a.label.localeCompare(b.label);
    });
    return filters;
  }

  function initScheduleNav() {
    var prevBtn = document.getElementById('yb-schedule-prev');
    var nextBtn = document.getElementById('yb-schedule-next');
    var buyPassBtn = document.getElementById('yb-schedule-buy-pass');

    if (prevBtn) prevBtn.addEventListener('click', function() { scheduleWeekOffset--; scheduleShowAllDays = false; loadSchedule(); });
    if (nextBtn) nextBtn.addEventListener('click', function() { scheduleWeekOffset++; scheduleShowAllDays = false; loadSchedule(); });
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

    // Fetch classes and visits in parallel to detect already-booked classes
    var classesPromise = fetch(url).then(function(r) { return r.json(); });
    var visitsPromise = clientId
      ? fetch('/.netlify/functions/mb-visits?clientId=' + clientId + '&startDate=' + startStr + '&endDate=' + endStr)
          .then(function(r) { return r.json(); })
          .catch(function() { return { visits: [] }; })
      : Promise.resolve({ visits: [] });

    Promise.all([classesPromise, visitsPromise])
      .then(function(results) {
        var classes = results[0].classes || [];
        var visits = results[1].visits || [];

        if (!classes.length) { listEl.innerHTML = '<p class="yb-store__empty">' + t('schedule_empty') + '</p>'; return; }

        // Build set of booked class IDs from future visits
        var bookedClassIds = {};
        visits.forEach(function(v) {
          if (v.classId && v.isFuture && !v.lateCancelled) {
            bookedClassIds[v.classId] = true;
          }
        });

        // Mark classes as booked if found in visits
        classes.forEach(function(cls) {
          if (bookedClassIds[cls.id]) {
            cls.isBooked = true;
          }
        });

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
    var activeServices = data.activeServices || [];
    var activeContracts = data.activeContracts || [];

    var hasAnyActivePass = (data.activeServices && data.activeServices.length > 0) || (data.activeContracts && data.activeContracts.length > 0);

    if (hasAnyActivePass) {
      // Always hide buy-pass banner for active pass holders
      if (noPassEl) noPassEl.hidden = true;

      var totalPasses = activeServices.length + activeContracts.length;

      // Build summary for the dropdown header
      var summaryParts = [];
      if (activeContracts.length > 0) {
        summaryParts.push(activeContracts.length + ' ' + (isDa() ? (activeContracts.length === 1 ? 'medlemskab' : 'medlemskaber') : (activeContracts.length === 1 ? 'membership' : 'memberships')));
      }
      if (activeServices.length > 0) {
        summaryParts.push(activeServices.length + ' ' + (isDa() ? (activeServices.length === 1 ? 'klippekort' : 'klippekort') : (activeServices.length === 1 ? 'pass' : 'passes')));
      }
      var summaryText = summaryParts.join(' + ');

      var html = '<div class="yb-schedule__pass-dropdown">';
      html += '<button class="yb-schedule__pass-dropdown-toggle" type="button">';
      html += '<div class="yb-schedule__pass-dropdown-summary">';
      html += '<span class="yb-schedule__pass-dropdown-label">' + (isDa() ? 'Dine aktive pas' : 'Your active passes') + '</span>';
      html += '<span class="yb-schedule__pass-dropdown-count">' + summaryText + '</span>';
      html += '</div>';
      html += '<svg class="yb-schedule__pass-dropdown-chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
      html += '</button>';
      html += '<div class="yb-schedule__pass-dropdown-body" hidden>';

      // Show each active pass/clip card
      activeServices.forEach(function(s) {
        html += '<div class="yb-schedule__pass-detail">';
        html += '<div class="yb-schedule__pass-detail-info">';
        html += '<span class="yb-schedule__pass-detail-label">' + t('schedule_pass_info') + '</span>';
        html += '<span class="yb-schedule__pass-detail-name">' + esc(s.name) + '</span>';
        html += '</div>';
        html += '<div class="yb-schedule__pass-detail-stats">';
        if (s.remaining != null) {
          html += '<span class="yb-schedule__pass-stat"><strong>' + s.remaining + '</strong> ' + t('schedule_remaining') + '</span>';
          if (s.remaining > 0 && s.remaining < 3) {
            html += '<span class="yb-schedule__pass-stat yb-schedule__pass-stat--low">' +
              (isDa() ? 'Snart opbrugt — overvej at fylde op' : 'Running low — consider topping up') + '</span>';
          }
        }
        if (s.expirationDate) {
          var expDate = new Date(s.expirationDate);
          html += '<span class="yb-schedule__pass-stat">' + t('schedule_expires') + ' ' + expDate.toLocaleDateString(isDa() ? 'da-DK' : 'en-GB', { day: 'numeric', month: 'short' }) + '</span>';
        }
        html += '</div>';
        html += '</div>';
      });

      // Show membership info
      activeContracts.forEach(function(c) {
        html += '<div class="yb-schedule__pass-detail yb-schedule__pass-detail--membership">';
        html += '<div class="yb-schedule__pass-detail-info">';
        html += '<span class="yb-schedule__pass-detail-label">' + (isDa() ? 'Medlemskab' : 'Membership') + '</span>';
        html += '<span class="yb-schedule__pass-detail-name">' + esc(c.name) + '</span>';
        html += '</div>';
        if (c.endDate) {
          html += '<div class="yb-schedule__pass-detail-stats">';
          var endDate = new Date(c.endDate);
          html += '<span class="yb-schedule__pass-stat">' + (isDa() ? 'Fornyes' : 'Renews') + ' ' + endDate.toLocaleDateString(isDa() ? 'da-DK' : 'en-GB', { day: 'numeric', month: 'short' }) + '</span>';
          html += '</div>';
        }
        html += '</div>';
      });

      html += '</div></div>';

      passInfoEl.innerHTML = html;
      passInfoEl.hidden = false;

      // Toggle dropdown
      var toggleBtn = passInfoEl.querySelector('.yb-schedule__pass-dropdown-toggle');
      var body = passInfoEl.querySelector('.yb-schedule__pass-dropdown-body');
      if (toggleBtn && body) {
        toggleBtn.addEventListener('click', function() {
          var isOpen = !body.hidden;
          body.hidden = isOpen;
          toggleBtn.classList.toggle('is-open', !isOpen);
        });
      }
    } else {
      // No active pass — show the buy-pass banner
      if (passInfoEl) passInfoEl.hidden = true;
      if (noPassEl) noPassEl.hidden = false;
    }
  }

  var scheduleShowAllDays = false; // Track whether user clicked "Show more"
  var scheduleAllClasses = []; // Cache all classes for filter re-renders
  var scheduleWeekStart = null;

  function renderSchedule(container, classes, weekStart) {
    // Cache for filter re-renders
    scheduleAllClasses = classes;
    scheduleWeekStart = weekStart;

    // Apply class type filter
    var filteredClasses = classes.filter(function(cls) {
      return matchesClassFilter(cls);
    });

    var days = {};
    var dayNames = isDa()
      ? ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag']
      : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    filteredClasses.forEach(function(cls) {
      var d = new Date(cls.startDateTime);
      var key = toDateStr(d);
      if (!days[key]) days[key] = { date: d, classes: [] };
      days[key].classes.push(cls);
    });

    // ── Class type filter buttons (built dynamically from session types) ──
    var dynamicFilters = buildScheduleFilters(classes);
    var html = '<div class="yb-schedule__filters">';
    dynamicFilters.forEach(function(f) {
      var isActive = scheduleClassFilter === f.id;
      html += '<button class="yb-schedule__filter-btn' + (isActive ? ' is-active' : '') + '" type="button" data-schedule-filter="' + esc(f.id) + '">';
      html += esc(f.label);
      html += '</button>';
    });
    html += '</div>';

    var sortedKeys = Object.keys(days).sort();
    var initialDaysToShow = 3;
    var hasMoreDays = sortedKeys.length > initialDaysToShow && !scheduleShowAllDays;

    // Check if last day in range is Sunday (day 0)
    var lastDayIsSunday = false;
    if (sortedKeys.length > 0) {
      var lastDateObj = days[sortedKeys[sortedKeys.length - 1]].date;
      lastDayIsSunday = lastDateObj.getDay() === 0;
    }

    var dayIndex = 0;
    sortedKeys.forEach(function(key) {
      var day = days[key];
      // Sort classes within each day by start time
      day.classes.sort(function(a, b) {
        return new Date(a.startDateTime) - new Date(b.startDateTime);
      });
      var dateObj = day.date;
      var dayName = dayNames[dateObj.getDay()];
      var dateLabel = dateObj.toLocaleDateString(isDa() ? 'da-DK' : 'en-GB', { day: 'numeric', month: 'long' });

      // Hide days beyond initial 3 unless expanded
      var isHidden = hasMoreDays && dayIndex >= initialDaysToShow;

      html += '<div class="yb-schedule__day' + (isHidden ? ' yb-schedule__day--hidden' : '') + '">';
      html += '<h3 class="yb-schedule__day-label">' + dayName + ' <span>' + dateLabel + '</span></h3>';

      day.classes.forEach(function(cls) {
        var startTime = formatTime(cls.startDateTime);
        var endTime = formatTime(cls.endDateTime);
        var isPast = new Date(cls.startDateTime) < new Date();
        var descId = 'yb-desc-' + cls.id;

        html += '<div class="yb-schedule__class' + (cls.isCanceled ? ' is-cancelled' : '') + (isPast ? ' is-past' : '') + '"' + (cls.programId ? ' data-program-id="' + cls.programId + '"' : '') + '>';
        html += '  <div class="yb-schedule__class-time">' + startTime + ' – ' + endTime + '</div>';
        html += '  <div class="yb-schedule__class-info">';
        html += '    <span class="yb-schedule__class-name">' + esc(cls.name) + '</span>';
        var bioId = 'yb-bio-' + cls.id;
        if (cls.instructorId && cls.instructor !== 'TBA') {
          html += '    <span class="yb-schedule__class-instructor yb-schedule__class-instructor--clickable" data-toggle-bio="' + bioId + '" data-staff-id="' + cls.instructorId + '">' + esc(cls.instructor) + '</span>';
        } else {
          html += '    <span class="yb-schedule__class-instructor">' + esc(cls.instructor) + '</span>';
        }
        if (cls.spotsLeft !== null && cls.spotsLeft > 0 && cls.spotsLeft <= 7 && !cls.isCanceled && !isPast) {
          html += '    <span class="yb-schedule__class-spots">' + (isDa() ? 'Få pladser tilbage' : 'Few spots left') + '</span>';
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
          html += '<button class="yb-btn yb-btn--outline yb-schedule__waitlist-btn" type="button" data-schedule-waitlist="' + cls.id + '">' + (isDa() ? 'Skriv op' : 'Join Waitlist') + '</button>';
        } else {
          // Always show Book for available future classes — let backend validate
          html += '<button class="yb-btn yb-btn--primary yb-schedule__book-btn" type="button" data-schedule-book="' + cls.id + '">' + t('schedule_book') + '</button>';
        }

        html += '  </div>';
        html += '</div>';

        // Teacher bio (loaded on demand)
        if (cls.instructorId && cls.instructor !== 'TBA') {
          html += '<div class="yb-schedule__teacher-bio" id="' + bioId + '" hidden></div>';
        }

        // Expandable description (render HTML from Mindbody)
        if (cls.description) {
          html += '<div class="yb-schedule__desc" id="' + descId + '" hidden>';
          html += '<div class="yb-schedule__desc-content">' + cls.description + '</div>';
          html += '</div>';
        }
      });

      html += '</div>';
      dayIndex++;
    });

    // No results for this filter
    if (sortedKeys.length === 0 && scheduleClassFilter !== 'all') {
      html += '<p class="yb-schedule__filter-empty">' + (isDa() ? 'Ingen klasser af denne type denne uge.' : 'No classes of this type this week.') + '</p>';
    }

    // Button logic:
    // - If collapsed (more days hidden): "Show More"
    // - If expanded or all days visible and Sunday reached: "Show Next Week"
    var showNextWeek = scheduleShowAllDays || sortedKeys.length <= initialDaysToShow;
    if (hasMoreDays) {
      // Still collapsed — show "Show More"
      html += '<div class="yb-schedule__show-more-wrap">';
      html += '<button class="yb-btn yb-btn--outline yb-schedule__show-more-btn" type="button" id="yb-schedule-show-more">' + (isDa() ? 'Vis mere' : 'Show more') + '</button>';
      html += '</div>';
    } else if (showNextWeek && sortedKeys.length > 0) {
      // All days visible — show "Show Next Week"
      html += '<div class="yb-schedule__show-more-wrap">';
      html += '<button class="yb-btn yb-btn--outline yb-schedule__show-more-btn" type="button" id="yb-schedule-next-week">' + (isDa() ? 'Vis næste uge' : 'Show next week') + '</button>';
      html += '</div>';
    }

    container.innerHTML = html;

    // "Show More" — reveal hidden days, then swap to "Show Next Week"
    var showMoreBtn = document.getElementById('yb-schedule-show-more');
    if (showMoreBtn) {
      showMoreBtn.addEventListener('click', function() {
        scheduleShowAllDays = true;
        container.querySelectorAll('.yb-schedule__day--hidden').forEach(function(el) {
          el.classList.remove('yb-schedule__day--hidden');
        });
        // Replace this button with "Show Next Week"
        var wrap = showMoreBtn.parentElement;
        wrap.innerHTML = '<button class="yb-btn yb-btn--outline yb-schedule__show-more-btn" type="button" id="yb-schedule-next-week">' + (isDa() ? 'Vis næste uge' : 'Show next week') + '</button>';
        document.getElementById('yb-schedule-next-week').addEventListener('click', function() {
          scheduleWeekOffset++;
          scheduleShowAllDays = false;
          loadSchedule();
        });
      });
    }

    // "Show Next Week" (when directly visible)
    var nextWeekBtn = document.getElementById('yb-schedule-next-week');
    if (nextWeekBtn && !showMoreBtn) {
      nextWeekBtn.addEventListener('click', function() {
        scheduleWeekOffset++;
        scheduleShowAllDays = false;
        loadSchedule();
      });
    }

    // Attach class type filter handlers
    container.querySelectorAll('[data-schedule-filter]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        scheduleClassFilter = btn.getAttribute('data-schedule-filter');
        scheduleShowAllDays = false;
        renderSchedule(container, scheduleAllClasses, scheduleWeekStart);
      });
    });

    // Attach book/cancel handlers (use onclick= so toggles can replace cleanly)
    container.querySelectorAll('[data-schedule-book]').forEach(function(btn) {
      btn.onclick = function() { bookClass(btn); };
    });
    container.querySelectorAll('[data-schedule-cancel]').forEach(function(btn) {
      btn.onclick = function() { cancelClass(btn); };
    });
    // Attach waitlist handlers
    container.querySelectorAll('[data-schedule-waitlist]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        if (!clientId) {
          showScheduleToast(isDa() ? 'Køb et pas først i Butik-fanen.' : 'Buy a pass first in the Store tab.', 'error');
          return;
        }
        var classId = btn.getAttribute('data-schedule-waitlist');
        btn.disabled = true;
        btn.textContent = isDa() ? 'Tilmelder...' : 'Joining...';
        fetch('/.netlify/functions/mb-waitlist', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId: clientId, classId: Number(classId) })
        }).then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.success || data.WaitlistEntry) {
              showScheduleToast(isDa() ? 'Du er på ventelisten!' : "You're on the waiting list!", 'success');
              btn.textContent = isDa() ? 'På venteliste' : 'On waitlist';
              btn.disabled = true;
            } else {
              showScheduleToast(data.error || (isDa() ? 'Kunne ikke tilmelde venteliste.' : 'Could not join waitlist.'), 'error');
              btn.textContent = isDa() ? 'Skriv op' : 'Join Waitlist';
              btn.disabled = false;
            }
          })
          .catch(function() {
            showScheduleToast(isDa() ? 'Fejl. Prøv igen.' : 'Error. Try again.', 'error');
            btn.textContent = isDa() ? 'Skriv op' : 'Join Waitlist';
            btn.disabled = false;
          });
      });
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

    // Attach teacher bio toggle handlers
    container.querySelectorAll('[data-toggle-bio]').forEach(function(el) {
      el.addEventListener('click', function() {
        var bioEl = document.getElementById(el.getAttribute('data-toggle-bio'));
        if (!bioEl) return;

        if (!bioEl.hidden) {
          bioEl.hidden = true;
          return;
        }

        var staffId = el.getAttribute('data-staff-id');

        // Check cache first
        if (staffCache[staffId]) {
          renderTeacherBio(bioEl, staffCache[staffId]);
          bioEl.hidden = false;
          return;
        }

        // Fetch staff details
        bioEl.innerHTML = '<p class="yb-schedule__teacher-bio-text">' + (isDa() ? 'Henter...' : 'Loading...') + '</p>';
        bioEl.hidden = false;

        fetch('/.netlify/functions/mb-staff?staffId=' + staffId)
          .then(function(r) { return r.json(); })
          .then(function(data) {
            var staff = (data.staff || [])[0];
            if (staff) {
              staffCache[staffId] = staff;
              renderTeacherBio(bioEl, staff);
            } else {
              bioEl.innerHTML = '<p class="yb-schedule__teacher-bio-text">' + (isDa() ? 'Ingen info tilgængelig.' : 'No info available.') + '</p>';
            }
          })
          .catch(function() {
            bioEl.innerHTML = '<p class="yb-schedule__teacher-bio-text">' + (isDa() ? 'Kunne ikke hente info.' : 'Could not load info.') + '</p>';
          });
      });
    });
  }

  function renderTeacherBio(container, staff) {
    var html = '';
    if (staff.imageUrl) {
      html += '<img class="yb-schedule__teacher-photo" src="' + esc(staff.imageUrl) + '" alt="' + esc(staff.name) + '">';
    }
    html += '<div class="yb-schedule__teacher-info">';
    html += '<p class="yb-schedule__teacher-name">' + esc(staff.name) + '</p>';
    if (staff.bio) {
      html += '<p class="yb-schedule__teacher-bio-text">' + staff.bio + '</p>';
    } else {
      html += '<p class="yb-schedule__teacher-bio-text">' + (isDa() ? 'Ingen biografi tilgængelig.' : 'No biography available.') + '</p>';
    }
    html += '</div>';
    container.innerHTML = html;
  }

  /**
   * Check if the client's active passes could cover this class.
   * This is a quick client-side pre-check only — the backend (mb-book) does
   * the authoritative validation including cross-category relationships.
   * Client-side just checks if the user has ANY active pass at all.
   */
  function clientCanBook(programId) {
    if (!clientPassData) return false; // If pass data not loaded, block until loaded
    // Let the backend handle program matching (it checks cross-category relationships)
    return true;
  }

  // Global lock to prevent overlapping book/cancel requests
  var scheduleActionLock = false;

  function bookClass(btn) {
    if (scheduleActionLock) return;
    var classId = btn.getAttribute('data-schedule-book');
    if (!classId) return;
    if (!clientId) {
      showScheduleToast(isDa() ? 'Køb et pas først i Butik-fanen.' : 'Buy a pass first in the Store tab.', 'error');
      var noPassEl = document.getElementById('yb-schedule-no-pass');
      if (noPassEl) noPassEl.hidden = false;
      return;
    }

    // Check waiver before booking
    if (!waiverSigned) {
      showScheduleToast(isDa() ? 'Du skal acceptere ansvarsfrihedserklæringen først. Gå til Mine Pas-fanen.' : 'You must accept the liability waiver first. Go to the My Passes tab.', 'error');
      // Navigate to My Passes tab
      var passesBtn = document.querySelector('[data-yb-tab="passes"]');
      if (passesBtn) setTimeout(function() { passesBtn.click(); }, 2000);
      return;
    }

    // Check if client has ANY active pass
    var hasAnyPass = clientPassData && ((clientPassData.activeServices && clientPassData.activeServices.length > 0) || (clientPassData.activeContracts && clientPassData.activeContracts.length > 0));
    if (!hasAnyPass) {
      showScheduleToast(isDa() ? 'Køb et pas først i Butik-fanen.' : 'Buy a pass first in the Store tab.', 'error');
      var noPassEl = document.getElementById('yb-schedule-no-pass');
      if (noPassEl) noPassEl.hidden = false;
      return;
    }

    // Backend handles cross-category program validation — no client-side program check needed
    scheduleActionLock = true;
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
          switchBtnToCancel(btn, classId);
          // Refresh pass data after a short delay (give MB time to update)
          scheduleDelayedPassRefresh();
        } else {
          // No active membership or pass
          if (data.error === 'no_pass') {
            var noPassEl = document.getElementById('yb-schedule-no-pass');
            if (noPassEl) noPassEl.hidden = false;
            var passInfoEl = document.getElementById('yb-schedule-pass-info');
            if (passInfoEl) passInfoEl.hidden = true;

            // Build a helpful message with link to the correct passes
            var progName = data.programName || '';
            var toastMsg = isDa()
              ? 'Dit pas dækker ikke denne klasse' + (progName ? ' (' + progName + ')' : '') + '. Se de rette pas i butikken.'
              : "Your pass doesn't cover this class" + (progName ? ' (' + progName + ')' : '') + '. See matching passes in the Store.';
            showScheduleToast(toastMsg, 'error');

            // After a short delay, switch to Store tab filtered to matching passes
            var bookingProgramId = data.programId || null;
            setTimeout(function() {
              var storeBtn = document.querySelector('[data-yb-tab="store"]');
              if (storeBtn) {
                storeBtn.click();
                // Once store loads, filter to passes matching this program
                if (bookingProgramId) {
                  setTimeout(function() {
                    filterStoreByProgram(bookingProgramId, progName);
                  }, 600);
                }
              }
            }, 1500);
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
      }).finally(function() {
        scheduleActionLock = false;
      });
  }

  function cancelClass(btn) {
    if (scheduleActionLock) return; // Prevent double-clicks
    var classId = btn.getAttribute('data-schedule-cancel');
    if (!classId) return; // Button was already toggled to book
    if (!clientId) return;

    scheduleActionLock = true;
    btn.disabled = true;
    btn.textContent = isDa() ? 'Annullerer...' : 'Cancelling...';

    fetch('/.netlify/functions/mb-book', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: clientId, classId: Number(classId) })
    }).then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.success) {
          if (data.lateCancel) {
            showScheduleToast(isDa()
              ? 'Sen annullering — kan medføre gebyr.'
              : 'Late cancellation — may incur fees.', 'warning');
          } else {
            showScheduleToast(isDa() ? 'Booking annulleret.' : 'Booking cancelled.', 'success');
          }
          // Switch button back to Book
          switchBtnToBook(btn, classId);
          // Refresh pass data after a short delay (give MB time to update)
          scheduleDelayedPassRefresh();
        } else {
          showScheduleToast(data.error || (isDa() ? 'Annullering fejlede.' : 'Cancellation failed.'), 'error');
          btn.disabled = false;
          btn.textContent = isDa() ? 'Annuller' : 'Cancel';
        }
      }).catch(function(err) {
        showScheduleToast(err.message || (isDa() ? 'Annullering fejlede.' : 'Cancellation failed.'), 'error');
        btn.disabled = false;
        btn.textContent = isDa() ? 'Annuller' : 'Cancel';
      }).finally(function() {
        scheduleActionLock = false;
      });
  }

  /** Switch a button to Cancel state */
  function switchBtnToCancel(btn, classId) {
    btn.textContent = isDa() ? 'Annuller' : 'Cancel';
    btn.className = 'yb-btn yb-btn--outline yb-schedule__cancel-btn';
    btn.removeAttribute('data-schedule-book');
    btn.setAttribute('data-schedule-cancel', classId);
    btn.disabled = false;
    btn.onclick = function() { cancelClass(btn); };
  }

  /** Switch a button to Book state */
  function switchBtnToBook(btn, classId) {
    btn.textContent = isDa() ? 'Book' : 'Book';
    btn.className = 'yb-btn yb-btn--primary yb-schedule__book-btn';
    btn.removeAttribute('data-schedule-cancel');
    btn.setAttribute('data-schedule-book', classId);
    btn.disabled = false;
    btn.onclick = function() { bookClass(btn); };
  }

  /** Refresh pass data with a delay to let Mindbody update, then refresh again */
  var passRefreshTimer = null;
  /**
   * Background refresh: silently re-fetch pass info, schedule, visits, and receipts
   * every 60 seconds so the UI feels live and data stays fresh.
   */
  function startBackgroundRefresh() {
    stopBackgroundRefresh();
    bgRefreshInterval = setInterval(function() {
      if (!clientId) return;
      // Refresh pass info (shown on schedule tab)
      clientPassData = null;
      loadSchedulePassInfo();
      // Refresh schedule if already loaded
      if (tabLoaded['schedule']) loadSchedule();
      // Refresh visits/receipts only if those tabs have been opened
      if (tabLoaded['visits']) loadVisits();
      if (tabLoaded['receipts']) loadReceipts();
      if (tabLoaded['passes']) loadMembershipDetails();
    }, 60000); // 60 seconds
  }

  function stopBackgroundRefresh() {
    if (bgRefreshInterval) {
      clearInterval(bgRefreshInterval);
      bgRefreshInterval = null;
    }
  }

  function scheduleDelayedPassRefresh() {
    // Clear any pending refresh
    if (passRefreshTimer) clearTimeout(passRefreshTimer);
    // Quick refresh after 1s
    passRefreshTimer = setTimeout(function() {
      clientPassData = null;
      loadSchedulePassInfo();
      // Second refresh after 5s for Mindbody to fully process
      passRefreshTimer = setTimeout(function() {
        clientPassData = null;
        loadSchedulePassInfo();
      }, 4000);
    }, 1000);
  }

  function showScheduleToast(msg, type) {
    var el = document.getElementById('yb-schedule-toast');
    if (!el) return;
    el.className = 'yb-schedule__toast yb-schedule__toast--' + type;

    // For late cancel, show rich HTML with wellness note
    if (type === 'warning' && msg.indexOf('late') !== -1 || msg.indexOf('Sen') !== -1) {
      el.innerHTML = '<div class="yb-schedule__toast-main">' + esc(msg) + '</div>' +
        '<div class="yb-schedule__toast-note">' +
        (isDa()
          ? 'Gebyrer for sen afmelding og udeblivelse går til ekstra wellness: ingefærshots, urtete, frosne ansigtshåndklæder og rene håndklæder til alle besøg.'
          : 'Late cancellation and no-show fees go towards extra wellness: ginger shots, herbal tea, frozen face towels, and clean hand towels on every visit.') +
        '</div>';
    } else {
      el.textContent = msg;
    }

    el.hidden = false;
    setTimeout(function() { el.hidden = true; }, type === 'warning' ? 6000 : 3500);
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

    // Time period selector for visits
    var visitsPeriodEl = document.getElementById('yb-visits-period');
    if (visitsPeriodEl) {
      visitsPeriodEl.addEventListener('change', function() {
        loadVisits(this.value);
      });
    }

    // Time period selector for receipts
    var receiptsPeriodEl = document.getElementById('yb-receipts-period');
    if (receiptsPeriodEl) {
      receiptsPeriodEl.addEventListener('change', function() {
        loadReceipts(this.value);
      });
    }
  }

  function filterVisits(visits) {
    if (activeVisitFilter === 'all') return visits;
    var now = new Date();
    return visits.filter(function(v) {
      var classTime = new Date(v.startDateTime);
      var isUpcoming = classTime > now; // Compare datetime, not just date
      if (activeVisitFilter === 'upcoming') return isUpcoming && !v.lateCancelled;
      if (activeVisitFilter === 'attended') return v.signedIn;
      if (activeVisitFilter === 'lateCancelled') return v.lateCancelled;
      if (activeVisitFilter === 'noshow') return !v.signedIn && !v.lateCancelled && !isUpcoming;
      return true;
    });
  }

  var visitsPeriod = '90'; // default 90 days

  function loadVisits(period) {
    var listEl = document.getElementById('yb-visits-list');
    if (!listEl || !clientId) {
      if (listEl) listEl.innerHTML = '<p class="yb-store__empty">' + t('visits_empty') + '</p>';
      return;
    }

    if (period) visitsPeriod = period;

    listEl.innerHTML = '<div class="yb-store__loading"><div class="yb-mb-spinner"></div><span>' + (isDa() ? 'Henter besøg...' : 'Loading visits...') + '</span></div>';

    var now = new Date();
    var startDate = new Date(now.getTime() - Number(visitsPeriod) * 86400000).toISOString().split('T')[0];
    var endDate = new Date(now.getTime() + 30 * 86400000).toISOString().split('T')[0];

    fetch('/.netlify/functions/mb-visits?clientId=' + clientId + '&startDate=' + startDate + '&endDate=' + endDate)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        allVisits = data.visits || [];
        if (!allVisits.length) { listEl.innerHTML = '<p class="yb-store__empty">' + t('visits_empty') + '</p>'; return; }
        renderVisits(listEl, filterVisits(allVisits));
      })
      .catch(function() { listEl.innerHTML = '<p class="yb-store__error">' + t('visits_error') + '</p>'; });
  }

  function renderVisits(container, visits) {
    // Sort: upcoming first (by date asc), then past (by date desc)
    var now = new Date();
    visits.sort(function(a, b) {
      var aTime = new Date(a.startDateTime);
      var bTime = new Date(b.startDateTime);
      var aUp = aTime > now;
      var bUp = bTime > now;
      if (aUp && bUp) return aTime - bTime;
      if (!aUp && !bUp) return bTime - aTime;
      return aUp ? -1 : 1;
    });

    if (!visits.length) {
      container.innerHTML = '<p class="yb-store__empty">' + t('visits_empty') + '</p>';
      return;
    }

    // Count statuses from ALL visits (not just filtered)
    var counts = { upcoming: 0, attended: 0, lateCancelled: 0, noshow: 0, total: allVisits.length };
    allVisits.forEach(function(v) {
      var classTime = new Date(v.startDateTime);
      if (v.lateCancelled) counts.lateCancelled++;
      else if (classTime > now) counts.upcoming++;
      else if (v.signedIn) counts.attended++;
      else counts.noshow++;
    });

    var html = '';

    // Status summary bar
    html += '<div class="yb-visits__summary">';
    html += '<div class="yb-visits__summary-item"><strong>' + counts.upcoming + '</strong><span>' + (isDa() ? 'Kommende' : 'Upcoming') + '</span></div>';
    html += '<div class="yb-visits__summary-item"><strong>' + counts.attended + '</strong><span>' + (isDa() ? 'Deltaget' : 'Attended') + '</span></div>';
    html += '<div class="yb-visits__summary-item yb-visits__summary-item--warn"><strong>' + counts.lateCancelled + '</strong><span>' + (isDa() ? 'Sen afmelding' : 'Late Cancel') + '</span></div>';
    html += '<div class="yb-visits__summary-item yb-visits__summary-item--danger"><strong>' + counts.noshow + '</strong><span>' + (isDa() ? 'Udeblivelse' : 'No-show') + '</span></div>';
    html += '</div>';

    // Table
    html += '<div class="yb-visits__table">';
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
      var isUpcoming = d > now; // Use full datetime comparison

      var status = '';
      var statusClass = '';
      if (v.lateCancelled) {
        status = t('visits_late_cancel');
        statusClass = 'yb-visits__status--late';
      } else if (isUpcoming) {
        status = t('visits_booked');
        statusClass = 'yb-visits__status--booked';
      } else if (v.signedIn) {
        status = t('visits_signed_in');
        statusClass = 'yb-visits__status--attended';
      } else {
        status = t('visits_no_show');
        statusClass = 'yb-visits__status--noshow';
      }

      html += '<div class="yb-visits__row' + (isUpcoming ? ' yb-visits__row--future' : '') + '">';
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
  var receiptsPeriod = '730'; // default 2 years — show past purchases for existing clients

  function loadReceipts(period) {
    var listEl = document.getElementById('yb-receipts-list');
    if (!listEl || !clientId) {
      if (listEl) listEl.innerHTML = '<p class="yb-store__empty">' + t('receipts_empty') + '</p>';
      return;
    }

    if (period) receiptsPeriod = period;

    listEl.innerHTML = '<div class="yb-store__loading"><div class="yb-mb-spinner"></div><span>' + (isDa() ? 'Henter kvitteringer...' : 'Loading receipts...') + '</span></div>';

    var now = new Date();
    var startDate = new Date(now.getTime() - Number(receiptsPeriod) * 86400000).toISOString().split('T')[0];
    var endDate = now.toISOString().split('T')[0];

    console.log('Receipts: fetching for clientId=' + clientId + ' range=' + startDate + ' to ' + endDate);
    fetch('/.netlify/functions/mb-purchases?clientId=' + clientId + '&startDate=' + startDate + '&endDate=' + endDate)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var purchases = data.purchases || [];
        if (!purchases.length) { listEl.innerHTML = '<p class="yb-store__empty">' + t('receipts_empty') + '</p>'; return; }
        renderReceipts(listEl, purchases);
      })
      .catch(function(err) {
        console.error('Receipts error:', err);
        listEl.innerHTML = '<p class="yb-store__error">' + t('receipts_error') + '</p>';
      });
  }

  function renderReceipts(container, purchases) {
    // Sort newest first
    purchases.sort(function(a, b) { return new Date(b.saleDate) - new Date(a.saleDate); });

    var html = '<div class="yb-receipts__list-inner">';

    purchases.forEach(function(p, idx) {
      var d = new Date(p.saleDate);
      var dateStr = d.toLocaleDateString(isDa() ? 'da-DK' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      var name = p.description || '—';
      var totalPaid = Number(p.totalPaid) || Number(p.subtotal) || 0;

      // Determine type from items
      var hasItems = p.items && p.items.length > 0;
      var isReturned = p.returned;

      html += '<div class="yb-receipts__card' + (isReturned ? ' yb-receipts__card--returned' : '') + '" data-receipt-idx="' + idx + '">';

      // Header: date + sale ID
      html += '<div class="yb-receipts__card-header">';
      html += '<span class="yb-receipts__card-date">' + dateStr + '</span>';
      html += '<div class="yb-receipts__card-badges">';
      if (isReturned) {
        html += '<span class="yb-receipts__badge yb-receipts__badge--returned">' + (isDa() ? 'Refunderet' : 'Refunded') + '</span>';
      }
      html += '<span class="yb-receipts__card-ref">#' + (p.saleId || '') + '</span>';
      html += '</div>';
      html += '</div>';

      // Body: item descriptions
      html += '<div class="yb-receipts__card-body">';
      if (hasItems && p.items.length > 1) {
        p.items.forEach(function(item) {
          html += '<div class="yb-receipts__card-item">';
          html += '<span class="yb-receipts__card-name">' + esc(item.description) + '</span>';
          html += '<span class="yb-receipts__card-item-price">' + formatDKK(item.amountPaid || item.unitPrice || 0) + '</span>';
          html += '</div>';
        });
      } else {
        html += '<span class="yb-receipts__card-name">' + esc(name) + '</span>';
      }
      html += '</div>';

      // Details grid
      html += '<div class="yb-receipts__card-details">';

      // Total amount
      html += '<div class="yb-receipts__detail">';
      html += '<span class="yb-receipts__detail-label">' + (isDa() ? 'Total' : 'Total') + '</span>';
      html += '<span class="yb-receipts__detail-value yb-receipts__detail-value--total">' + (totalPaid > 0 ? formatDKK(totalPaid) : (isDa() ? 'Gratis' : 'Free')) + '</span>';
      html += '</div>';

      // Payment method + card
      if (p.paymentMethod) {
        var paymentDisplay = p.paymentMethod;
        if (p.paymentLast4) paymentDisplay += ' ***' + p.paymentLast4;
        html += '<div class="yb-receipts__detail">';
        html += '<span class="yb-receipts__detail-label">' + (isDa() ? 'Betaling' : 'Payment') + '</span>';
        html += '<span class="yb-receipts__detail-value">' + esc(paymentDisplay) + '</span>';
        html += '</div>';
      }

      // Tax
      if (p.tax > 0) {
        html += '<div class="yb-receipts__detail">';
        html += '<span class="yb-receipts__detail-label">' + (isDa() ? 'Heraf moms' : 'Incl. VAT') + '</span>';
        html += '<span class="yb-receipts__detail-value">' + formatDKK(p.tax) + '</span>';
        html += '</div>';
      }

      // Discount
      if (p.discount > 0) {
        html += '<div class="yb-receipts__detail">';
        html += '<span class="yb-receipts__detail-label">' + (isDa() ? 'Rabat' : 'Discount') + '</span>';
        html += '<span class="yb-receipts__detail-value yb-receipts__detail-value--discount">-' + formatDKK(p.discount) + '</span>';
        html += '</div>';
      }

      // Location
      if (p.locationName) {
        html += '<div class="yb-receipts__detail">';
        html += '<span class="yb-receipts__detail-label">' + (isDa() ? 'Lokation' : 'Location') + '</span>';
        html += '<span class="yb-receipts__detail-value">' + esc(p.locationName) + '</span>';
        html += '</div>';
      }

      html += '</div>'; // end details grid

      // Download invoice button
      html += '<div class="yb-receipts__card-actions">';
      html += '<button class="yb-receipts__download-btn" type="button" data-receipt-download="' + idx + '">';
      html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
      html += (isDa() ? 'Download faktura' : 'Download invoice');
      html += '</button>';
      html += '</div>';

      html += '</div>'; // end card
    });

    html += '</div>';
    container.innerHTML = html;

    // Attach download handlers — generates HTML invoice
    container.querySelectorAll('[data-receipt-download]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var idx = parseInt(btn.getAttribute('data-receipt-download'), 10);
        var p = purchases[idx];
        if (!p) return;
        generateInvoiceHTML(p);
      });
    });
  }

  /**
   * Generate a proper HTML invoice and trigger download.
   * Matches the Mindbody invoice style: business header, bill to,
   * line items table with VAT, payment details, totals.
   */
  function generateInvoiceHTML(p) {
    var d = new Date(p.saleDate);
    var dateStr = d.toLocaleDateString('da-DK', { day: '2-digit', month: '2-digit', year: 'numeric' });
    var customerName = (currentUser && currentUser.displayName) || '';
    var items = p.items || [{ description: p.description || '—', quantity: 1, unitPrice: p.totalPaid || 0, amountPaid: p.totalPaid || 0, discount: 0, tax: 0 }];
    var saleId = p.saleId || '';

    // Calculate totals
    var subtotal = 0;
    var totalTax = 0;
    var totalDiscount = 0;
    items.forEach(function(item) {
      subtotal += (item.unitPrice || 0) * (item.quantity || 1);
      totalTax += item.tax || 0;
      totalDiscount += item.discount || 0;
    });
    var invoiceTotal = (p.totalPaid || subtotal - totalDiscount);

    // Build payment adjustment info
    var paymentInfo = '';
    if (p.payments && p.payments.length > 0) {
      p.payments.forEach(function(pay) {
        paymentInfo += '<div class="inv-adj">';
        paymentInfo += '<strong>' + (isDa() ? 'Betaling' : 'Payment') + '</strong><br>';
        paymentInfo += dateStr + '<br>';
        if (pay.method) paymentInfo += (isDa() ? 'Betalt med ' : 'Payment made with ') + pay.method;
        if (pay.last4) paymentInfo += ' ***' + pay.last4;
        paymentInfo += '<br>';
        if (pay.notes) paymentInfo += pay.notes + '<br>';
        paymentInfo += '<strong>(' + formatDKK(pay.amount || invoiceTotal) + ')</strong>';
        paymentInfo += '</div>';
      });
    } else if (p.paymentMethod) {
      paymentInfo += '<div class="inv-adj">';
      paymentInfo += '<strong>' + (isDa() ? 'Betaling' : 'Payment') + '</strong><br>';
      paymentInfo += dateStr + '<br>';
      paymentInfo += p.paymentMethod;
      if (p.paymentLast4) paymentInfo += ' ***' + p.paymentLast4;
      paymentInfo += '<br><strong>(' + formatDKK(invoiceTotal) + ')</strong>';
      paymentInfo += '</div>';
    }

    // Build line items rows
    var itemsHTML = '';
    items.forEach(function(item, i) {
      var qty = item.quantity || 1;
      var unitPrice = item.unitPrice || item.amountPaid || 0;
      var itemTax = item.tax || 0;
      var vatPct = (unitPrice > 0 && itemTax > 0) ? Math.round((itemTax / unitPrice) * 100) : 0;
      var lineTotal = item.amountPaid || (unitPrice * qty);

      itemsHTML += '<tr>';
      itemsHTML += '<td class="inv-row-num">' + (i + 1) + '</td>';
      itemsHTML += '<td class="inv-desc"><strong>' + esc(item.description || '—') + '</strong></td>';
      itemsHTML += '<td class="inv-qty">' + qty + '</td>';
      itemsHTML += '<td class="inv-price">' + formatDKK(unitPrice) + '</td>';
      itemsHTML += '<td class="inv-vat-pct">' + vatPct + '%</td>';
      itemsHTML += '<td class="inv-vat">' + formatDKK(itemTax) + '</td>';
      itemsHTML += '<td class="inv-amount">' + formatDKK(lineTotal) + '</td>';
      itemsHTML += '</tr>';
    });

    var amountDue = Math.max(0, invoiceTotal - (p.totalPaid || invoiceTotal));
    var isPaid = amountDue <= 0;

    var invoiceHTML = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' +
      (isDa() ? 'Faktura' : 'Invoice') + ' #' + saleId + '</title>' +
      '<style>' +
      '* { margin: 0; padding: 0; box-sizing: border-box; }' +
      'body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 13px; color: #333; padding: 40px; max-width: 800px; margin: 0 auto; }' +
      '.inv-header { display: flex; justify-content: space-between; margin-bottom: 30px; }' +
      '.inv-company { font-size: 13px; line-height: 1.6; }' +
      '.inv-company-name { font-size: 18px; font-weight: 700; margin-bottom: 4px; }' +
      '.inv-contact { text-align: right; font-size: 12px; color: #666; }' +
      '.inv-billto { margin-bottom: 20px; }' +
      '.inv-billto-label { font-weight: 700; font-size: 12px; text-transform: uppercase; color: #666; margin-bottom: 4px; }' +
      '.inv-meta { display: flex; gap: 20px; align-items: center; margin-bottom: 20px; border: 1px solid #ddd; border-radius: 4px; padding: 10px 14px; }' +
      '.inv-meta-block { font-size: 12px; }' +
      '.inv-meta-block strong { display: block; font-size: 11px; color: #666; text-transform: uppercase; margin-bottom: 2px; }' +
      '.inv-amount-due-box { background: #222; color: #fff; padding: 8px 16px; border-radius: 4px; text-align: center; }' +
      '.inv-amount-due-box strong { display: block; font-size: 11px; text-transform: uppercase; margin-bottom: 2px; }' +
      '.inv-amount-due-box .inv-due-val { font-size: 18px; font-weight: 700; }' +
      '.inv-paid-label { display: inline-block; margin-left: 12px; font-weight: 700; font-size: 13px; }' +
      'table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }' +
      'thead th { background: #f5f5f5; font-size: 11px; font-weight: 700; text-transform: uppercase; color: #666; padding: 8px 10px; text-align: left; border-bottom: 2px solid #ddd; }' +
      'thead th:first-child { width: 30px; }' +
      'tbody td { padding: 10px; border-bottom: 1px solid #eee; vertical-align: top; }' +
      '.inv-row-num { color: #999; text-align: center; }' +
      '.inv-desc strong { font-weight: 600; }' +
      '.inv-qty, .inv-price, .inv-vat-pct, .inv-vat, .inv-amount { text-align: right; white-space: nowrap; }' +
      '.inv-totals { display: flex; justify-content: flex-end; }' +
      '.inv-totals-table { width: 300px; }' +
      '.inv-totals-table td { padding: 6px 10px; }' +
      '.inv-totals-table td:first-child { text-align: left; font-weight: 600; }' +
      '.inv-totals-table td:last-child { text-align: right; }' +
      '.inv-totals-table .inv-total-row { border-top: 2px solid #333; font-weight: 700; font-size: 14px; }' +
      '.inv-totals-table .inv-due-row { background: #222; color: #fff; font-weight: 700; font-size: 15px; }' +
      '.inv-totals-table .inv-due-row td { padding: 10px; }' +
      '.inv-adj { font-size: 12px; line-height: 1.5; margin-bottom: 8px; color: #555; }' +
      '.inv-paid-stamp { font-weight: 700; font-size: 14px; margin: 10px 0; text-decoration: underline; }' +
      '.inv-footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 11px; color: #888; line-height: 1.6; }' +
      '.inv-footer-note { font-style: italic; margin-bottom: 12px; }' +
      '@media print { body { padding: 20px; } .inv-no-print { display: none; } }' +
      '</style></head><body>';

    // Print button
    invoiceHTML += '<div class="inv-no-print" style="margin-bottom:20px;text-align:right;">' +
      '<button onclick="window.print()" style="padding:8px 20px;background:#f75c03;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">' +
      (isDa() ? 'Print / Gem som PDF' : 'Print / Save as PDF') + '</button></div>';

    // Header: company info
    invoiceHTML += '<div class="inv-header">' +
      '<div class="inv-company">' +
      '<div class="inv-company-name">Hot Yoga Copenhagen</div>' +
      'Adresse, K\u00f8benhavn<br>DENMARK<br>' +
      'VAT ID Cvr. 41295252 Hot Yoga Copenhagen Aps' +
      '</div>' +
      '<div class="inv-contact">4553881209<br>info@hotyogacph.dk</div>' +
      '</div>';

    // Bill to
    invoiceHTML += '<div class="inv-billto">' +
      '<div class="inv-billto-label">BILL TO</div>' +
      '<strong>' + esc(customerName) + '</strong><br>' +
      (clientId ? clientId : '') +
      '</div>';

    // Meta row: invoice number, dates, amount due
    invoiceHTML += '<div class="inv-meta">' +
      '<div class="inv-meta-block"><strong>' + (isDa() ? 'Faktura' : 'Invoice') + '</strong>Aps-' + String(saleId).padStart(8, '0') + '<br>Sale ID ' + saleId + '</div>' +
      '<div class="inv-meta-block"><strong>' + (isDa() ? 'Fakturadato' : 'Invoice date') + '</strong>' + dateStr + '<br>' + (isDa() ? 'Salgsdato ' : 'Sale date ') + dateStr + '</div>' +
      '<div class="inv-amount-due-box"><strong>' + (isDa() ? 'Skyldig bel\u00f8b' : 'Amount due') + '</strong><div class="inv-due-val">' + formatDKK(amountDue) + '</div></div>' +
      (isPaid ? '<span class="inv-paid-label">' + (isDa() ? 'Betalt' : 'Paid') + '</span>' : '') +
      '</div>';

    // Items table
    invoiceHTML += '<table><thead><tr>' +
      '<th></th>' +
      '<th>' + (isDa() ? 'BESKRIVELSE' : 'DESCRIPTION') + '</th>' +
      '<th style="text-align:right">' + (isDa() ? 'ANTAL' : 'QTY') + '</th>' +
      '<th style="text-align:right">' + (isDa() ? 'ENHEDSPRIS' : 'UNIT PRICE') + '</th>' +
      '<th style="text-align:right">' + (isDa() ? 'MOMS%' : 'VAT%') + '</th>' +
      '<th style="text-align:right">' + (isDa() ? 'MOMS' : 'VAT') + '</th>' +
      '<th style="text-align:right">' + (isDa() ? 'BEL\u00d8B' : 'AMOUNT') + '</th>' +
      '</tr></thead><tbody>' + itemsHTML + '</tbody></table>';

    // Totals
    invoiceHTML += '<div class="inv-totals"><table class="inv-totals-table">' +
      '<tr><td>' + (isDa() ? 'Subtotal' : 'Subtotal') + '</td><td>' + formatDKK(subtotal) + '</td></tr>';
    if (totalDiscount > 0) {
      invoiceHTML += '<tr><td>' + (isDa() ? 'Rabat' : 'Discount') + '</td><td>-' + formatDKK(totalDiscount) + '</td></tr>';
    }
    invoiceHTML += '<tr><td>' + (isDa() ? 'Moms' : 'VAT') + '</td><td>' + formatDKK(totalTax) + '</td></tr>' +
      '<tr class="inv-total-row"><td>' + (isDa() ? 'Faktura total' : 'Invoice total') + '</td><td>' + formatDKK(invoiceTotal) + '</td></tr>';

    // Payment adjustment
    if (paymentInfo) {
      invoiceHTML += '<tr><td colspan="2" style="padding-top:12px;">' + paymentInfo + '</td></tr>';
    }

    invoiceHTML += '<tr class="inv-due-row"><td>' + (isDa() ? 'Skyldig bel\u00f8b' : 'Amount due') + '</td><td>' + formatDKK(amountDue) + '</td></tr>' +
      '</table></div>';

    // Paid stamp
    if (isPaid) {
      invoiceHTML += '<div class="inv-paid-stamp">' + (isDa() ? 'Betalt' : 'Paid') + '</div>';
    }

    // Footer
    invoiceHTML += '<div class="inv-footer">' +
      '<div class="inv-footer-note">' + (isDa() ? 'Betal venligst bel\u00f8bet, hvis det allerede er ubetalt, til nedenst\u00e5ende kontooplysninger:' : 'Please pay amount, if already unpaid to account information below:') + '</div>' +
      'Hot Yoga Copenhagen<br>' +
      'Reg. 3409<br>' +
      'Acc. 13011206<br>' +
      'Danske Bank<br><br>' +
      'BIC: DABADKKK<br>' +
      'IBAN: DK7430000013011206' +
      '</div>';

    invoiceHTML += '</body></html>';

    // Open invoice in new window — user can Print > Save as PDF
    var w = window.open('', '_blank');
    if (w) {
      w.document.write(invoiceHTML);
      w.document.close();
    } else {
      // Popup blocked — download as HTML file
      var blob = new Blob([invoiceHTML], { type: 'text/html' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'faktura-' + (p.saleId || 'unknown') + '.html';
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  // ══════════════════════════════════════
  // DATE FORMATTING
  // ══════════════════════════════════════
  function formatDateDK(date) {
    if (!date) return '';
    var d = new Date(date);
    return d.toLocaleDateString(isDa() ? 'da-DK' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  // ══════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════
  function isDa() { return localStorage.getItem('hycph-lang') !== 'en'; }

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
      membership_no_past: isDa() ? 'Ingen tidligere klippekort.' : 'No past passes.',
      membership_manage_title: isDa() ? 'Administrer Abonnement' : 'Manage Subscription',
      membership_pause_btn: isDa() ? 'Sæt på pause' : 'Pause',
      membership_cancel_btn: isDa() ? 'Opsig abonnement' : 'Cancel membership',
      membership_paused_badge: isDa() ? 'På pause' : 'Paused',
      membership_terminating_badge: isDa() ? 'Opsagt' : 'Cancelled',
      membership_terminated_badge: isDa() ? 'Medlemskab Opsagt' : 'Membership Terminated',
      membership_last_billing: isDa() ? 'Sidste fakturering' : 'Last billing',
      membership_notice_period: isDa()
        ? '1 hel måneds opsigelsesvarsel jf. <a href="/terms-conditions/" target="_blank" rel="noopener">Handelsbetingelser</a>'
        : '1 full month notification period per <a href="/en/terms-conditions/" target="_blank" rel="noopener">Terms &amp; Conditions</a>',
      membership_active_until: isDa() ? 'Aktiv til' : 'Active until',
      membership_revoke_btn: isDa() ? 'Fortryd opsigelse' : 'Revoke cancellation',
      membership_revoke_confirming: isDa() ? 'Behandler...' : 'Processing...',
      membership_revoke_success: isDa() ? 'Din opsigelse er fortrudt! Dit abonnement er aktivt igen.' : 'Your cancellation has been revoked! Your membership is active again.',
      membership_revoke_error: isDa() ? 'Kunne ikke fortryde opsigelse. Kontakt os venligst.' : 'Could not revoke cancellation. Please contact us.',
      membership_cancel_farewell: isDa() ? 'Vi er kede af at se dig gå. Dit abonnement er nu opsagt — du kan stadig bruge det indtil udgangen af den betalte periode.' : 'Sorry to see you go. Your membership has been cancelled — you can still use it until the end of the paid period.',
      membership_retention_title: isDa() ? 'Vi savner dig allerede!' : 'We already miss you!',
      membership_retention_desc: isDa() ? 'Genaktiver dit abonnement inden {date} og spar tilmeldingsgebyret.' : 'Reactivate your membership before {date} and save the registration fee.',
      membership_retention_perk1: isDa() ? 'Ingen nyt tilmeldingsgebyr' : 'No new registration fee',
      membership_retention_perk2: isDa() ? 'Første måned gratis' : 'First month free',
      membership_retention_cta: isDa() ? 'Genaktiver — første måned gratis' : 'Reactivate — first month free',
      membership_rejoin_cta: isDa() ? 'Bliv medlem igen' : 'Become a member again',
      membership_pause_title: isDa() ? 'Sæt abonnement på pause' : 'Pause membership',
      membership_pause_desc: isDa() ? 'Du kan sætte dit abonnement på pause i 14 dage til 3 måneder. Pausen starter efter din næste faktureringscyklus.' : 'You can pause your membership for 14 days to 3 months. The pause starts after your next billing cycle.',
      membership_pause_start: isDa() ? 'Pause starter' : 'Pause starts',
      membership_pause_end: isDa() ? 'Pause slutter' : 'Pause ends',
      membership_pause_min: isDa() ? 'Minimum 14 dage' : 'Minimum 14 days',
      membership_pause_max: isDa() ? 'Maksimum 3 måneder' : 'Maximum 3 months',
      membership_pause_resume: isDa() ? 'Dit abonnement genoptages automatisk den' : 'Your membership will resume automatically on',
      membership_pause_next_billing: isDa() ? 'Tidligste startdato (efter næste fakturering)' : 'Earliest start date (after next billing)',
      membership_pause_confirm: isDa() ? 'Bekræft pause' : 'Confirm pause',
      membership_pause_confirming: isDa() ? 'Behandler...' : 'Processing...',
      membership_pause_success: isDa() ? 'Dit abonnement er nu sat på pause. Du vil se status opdateret herunder.' : 'Your membership is now paused. You will see the updated status below.',
      membership_pause_error: isDa() ? 'Kunne ikke sætte abonnement på pause. Prøv igen.' : 'Could not pause membership. Please try again.',
      membership_already_paused: isDa() ? 'Dit abonnement er allerede på pause. Du kan ikke tilføje endnu en pause.' : 'Your membership is already paused. You cannot add another pause.',
      membership_pause_special: isDa() ? 'Særlige omstændigheder (skade, graviditet, rejse mv.)? Kontakt os.' : 'Special circumstances (injury, pregnancy, travel etc.)? Contact us.',
      membership_billing_paused: isDa() ? 'Fakturering sat på pause' : 'Billing paused',
      membership_pause_active_title: isDa() ? 'Medlemskab er på pause' : 'Membership is paused',
      membership_pause_from: isDa() ? 'Fra' : 'From',
      membership_pause_auto_resume: isDa() ? 'Genoptages automatisk ved pausens udløb.' : 'Will resume automatically when the pause period ends.',
      membership_resume_contact: isDa() ? 'Vil du annullere pausen? Kontakt os på info@hotyogacph.dk, så fjerner vi den og du kan sætte en ny pause.' : 'Want to cancel the pause? Contact us at info@hotyogacph.dk and we will remove it so you can set a new pause.',
      membership_cancel_title: isDa() ? 'Opsig abonnement' : 'Cancel membership',
      membership_cancel_desc: isDa() ? 'Opsigelse følger vores vilkår: 1 måned + løbende dage. Du kan bruge dit abonnement indtil udgangen af den betalte periode.' : 'Cancellation follows our terms: 1 month + running days notice. You can use your membership until the end of the paid period.',
      membership_cancel_earliest: isDa() ? 'Sidste betaling (næste fakturering)' : 'Last payment (next billing)',
      membership_cancel_use_until: isDa() ? 'Brug dit abonnement til og med' : 'Use your membership until',
      membership_cancel_confirm: isDa() ? 'Bekræft opsigelse' : 'Confirm cancellation',
      membership_cancel_confirming: isDa() ? 'Behandler...' : 'Processing...',
      membership_cancel_success: isDa() ? 'Dit abonnement er opsagt.' : 'Your membership has been cancelled.',
      membership_cancel_error: isDa() ? 'Kunne ikke opsige abonnement. Prøv igen.' : 'Could not cancel membership. Please try again.',
      membership_cancel_warning: isDa() ? 'Dit abonnement opsiges ved udgangen af den betalte periode. Du kan fortryde opsigelsen indtil da.' : 'Your membership will end at the end of the paid period. You can revoke the cancellation until then.',
      membership_next_billing: isDa() ? 'Næste fakturering' : 'Next billing',
      membership_autopay_amount: isDa() ? 'pr. periode' : 'per period',
      membership_back: isDa() ? 'Tilbage' : 'Back',
      membership_manage_info: isDa()
        ? 'Vil du <strong>sætte dit abonnement på pause</strong> (14 dage – 3 måneder, særlige omstændigheder) eller <strong>opsige dit medlemskab</strong> (1 måneds opsigelsesvarsel jf. handelsbetingelser)? Skriv til os på <a href="mailto:info@hotyogacph.dk">info@hotyogacph.dk</a>'
        : 'Want to <strong>pause your membership</strong> (14 days – 3 months, special circumstances) or <strong>cancel your membership</strong> (1 month notice per terms &amp; conditions)? Email us at <a href="mailto:info@hotyogacph.dk">info@hotyogacph.dk</a>',
      membership_cancel_termination_hint: isDa()
        ? 'Vil du annullere opsigelsen? Kontakt os på <a href="mailto:info@hotyogacph.dk">info@hotyogacph.dk</a>'
        : 'Want to cancel the termination? Contact us at <a href="mailto:info@hotyogacph.dk">info@hotyogacph.dk</a>',
      waiver_fallback: isDa()
        ? 'Ved at acceptere denne erklæring bekræfter jeg, at jeg deltager i yogahold hos Hot Yoga Copenhagen på eget ansvar. Jeg er opmærksom på, at yoga indebærer fysisk aktivitet, der kan medføre skader. Jeg bekræfter, at jeg er rask nok til at deltage, og at jeg vil informere underviseren om eventuelle helbredsproblemer eller begrænsninger inden holdet. Hot Yoga Copenhagen er ikke ansvarlig for skader der måtte opstå under eller som følge af undervisningen.'
        : 'By accepting this waiver, I confirm that I participate in yoga classes at Hot Yoga Copenhagen at my own risk. I am aware that yoga involves physical activity that may result in injury. I confirm that I am healthy enough to participate and that I will inform the instructor of any health issues or limitations before class. Hot Yoga Copenhagen is not liable for injuries that may occur during or as a result of instruction.',
      giftcards_loading: isDa() ? 'Henter gavekort...' : 'Loading gift cards...',
      giftcard_empty: isDa() ? 'Ingen gavekort tilgængelige.' : 'No gift cards available.',
      giftcard_select: isDa() ? 'Vælg' : 'Select',
      giftcard_buy: isDa() ? 'Køb gavekort' : 'Buy gift card',
      contract_default_terms: isDa()
        ? '<p><strong>Medlemskabsvilkår</strong></p><p>Dette er et løbende månedligt medlemskab. Betaling opkræves automatisk hver måned. Du kan opsige med 1 måneds varsel jf. vores <a href="/terms-conditions/" target="_blank" rel="noopener">handelsbetingelser</a>. Medlemskabet kan sættes på pause i 14 dage til 3 måneder ved særlige omstændigheder. Ved at underskrive nedenfor bekræfter du, at du accepterer disse vilkår.</p>'
        : '<p><strong>Membership Terms</strong></p><p>This is a recurring monthly membership. Payment is charged automatically each month. You can cancel with 1 month notice per our <a href="/en/terms-conditions/" target="_blank" rel="noopener">terms &amp; conditions</a>. The membership can be paused for 14 days to 3 months under special circumstances. By signing below you confirm that you accept these terms.</p>',
      contract_terms_agree: isDa() ? 'Jeg har læst og accepterer kontraktvilkårene' : 'I have read and accept the contract terms',
      checkout_agree_waiver: isDa() ? 'Jeg har læst og accepterer ansvarsfrihedserklæringen' : 'I have read and accept the liability waiver',
      checkout_agree_waiver_and_terms: isDa() ? 'Jeg har læst og accepterer ansvarsfrihedserklæringen og kontraktvilkårene' : 'I have read and accept the liability waiver and contract terms'
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

  function stripHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.innerHTML = str;
    return (div.textContent || div.innerText || '').trim();
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
