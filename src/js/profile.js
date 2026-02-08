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
  var staffCache = {}; // Cache staff bios by ID

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
        if (hash === '#mine-kurser' || hash === '#my-courses') {
          var coursesTab = document.querySelector('[data-yb-tab="courses"]');
          if (coursesTab) coursesTab.click();
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

      // Tier is set by loadMembershipDetails after fetching pass data
      var tierEl = document.getElementById('yb-profile-tier');
      if (tierEl) tierEl.textContent = '—';
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

        // Show pass type in tier field
        var hasAutopayContract = data.activeContracts && data.activeContracts.length > 0;
        var hasActiveService = data.activeServices && data.activeServices.length > 0;
        var tierEl = document.getElementById('yb-profile-tier');
        if (tierEl) {
          if (hasAutopayContract) {
            tierEl.textContent = isDa() ? 'Månedligt Medlemskab' : 'Monthly Membership';
            tierEl.className = 'yb-profile__info-value yb-profile__info-value--success';
          } else if (hasActiveService) {
            tierEl.textContent = isDa() ? 'Klippekort' : 'Clip Card';
            tierEl.className = 'yb-profile__info-value yb-profile__info-value--success';
          } else {
            tierEl.textContent = isDa() ? 'Intet aktivt pas' : 'No active pass';
            tierEl.className = 'yb-profile__info-value yb-profile__info-value--muted';
          }
        }
      })
      .catch(function() {
        if (loadingEl) loadingEl.hidden = true;
      });
  }

  function renderMembershipDetails(container, data) {
    var html = '';
    var locale = isDa() ? 'da-DK' : 'en-GB';
    var dateOpts = { day: 'numeric', month: 'short', year: 'numeric' };

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
          html += '<span class="yb-membership__pass-expiry">' + t('membership_expires') + ' ' + new Date(s.expirationDate).toLocaleDateString(locale, dateOpts) + '</span>';
        }
        html += '<span class="yb-membership__badge yb-membership__badge--active">' + t('membership_status_active') + '</span>';
        html += '</div>';
      });
    } else {
      html += '<p class="yb-membership__empty">' + t('membership_no_active') + '</p>';
    }
    html += '</div>';

    // Active contracts (subscriptions) with manage buttons
    var contracts = data.activeContracts || [];
    if (contracts.length) {
      html += '<div class="yb-membership__section">';
      html += '<h3 class="yb-membership__section-title">' + t('membership_contracts') + '</h3>';
      contracts.forEach(function(c) {
        html += '<div class="yb-membership__pass yb-membership__contract-card" data-contract-id="' + c.id + '">';
        html += '<div class="yb-membership__pass-info">';
        html += '<span class="yb-membership__pass-name">' + esc(c.name) + '</span>';
        if (c.isAutopay && c.autopayAmount) {
          html += '<span class="yb-membership__pass-remaining">' + t('membership_autopay') + ' &middot; ' + c.autopayAmount + ' kr ' + t('membership_autopay_amount') + '</span>';
        } else if (c.isAutopay) {
          html += '<span class="yb-membership__pass-remaining">' + t('membership_autopay') + '</span>';
        }
        html += '</div>';
        // Show next billing date or end date
        if (c.nextBillingDate) {
          html += '<span class="yb-membership__pass-expiry">' + t('membership_next_billing') + ' ' + new Date(c.nextBillingDate).toLocaleDateString(locale, dateOpts) + '</span>';
        } else if (c.endDate) {
          html += '<span class="yb-membership__pass-expiry">' + t('membership_expires') + ' ' + new Date(c.endDate).toLocaleDateString(locale, dateOpts) + '</span>';
        }
        // Status badge
        if (c.isSuspended) {
          html += '<span class="yb-membership__badge yb-membership__badge--paused">' + t('membership_paused_badge') + '</span>';
        } else if (c.terminationDate) {
          html += '<span class="yb-membership__badge yb-membership__badge--terminating">' + t('membership_terminating_badge') + '</span>';
        } else {
          html += '<span class="yb-membership__badge yb-membership__badge--active">' + t('membership_status_active') + '</span>';
        }
        // Manage buttons (only for active, non-suspended, non-terminating contracts)
        if (!c.isSuspended && !c.terminationDate && c.isAutopay) {
          html += '<div class="yb-membership__manage-btns">';
          html += '<button type="button" class="yb-membership__manage-btn yb-membership__manage-btn--pause" data-manage-pause="' + c.id + '">' + t('membership_pause_btn') + '</button>';
          html += '<button type="button" class="yb-membership__manage-btn yb-membership__manage-btn--cancel" data-manage-cancel="' + c.id + '">' + t('membership_cancel_btn') + '</button>';
          html += '</div>';
        }
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
          html += '<span class="yb-membership__pass-expiry">' + t('membership_expires') + ' ' + new Date(s.expirationDate).toLocaleDateString(locale, dateOpts) + '</span>';
        }
        html += '</div>';
      });
      html += '</div>';
    }

    // Pause panel (hidden by default, shown when user clicks Pause)
    html += '<div id="yb-membership-pause-panel" class="yb-membership__manage-panel" hidden>';
    html += '<div class="yb-membership__manage-header">';
    html += '<button type="button" class="yb-membership__back-btn" data-manage-back>&larr; ' + t('membership_back') + '</button>';
    html += '<h3 class="yb-membership__manage-title">' + t('membership_pause_title') + '</h3>';
    html += '</div>';
    html += '<p class="yb-membership__manage-desc">' + t('membership_pause_desc') + '</p>';
    html += '<div class="yb-membership__manage-form">';
    html += '<div class="yb-membership__manage-field">';
    html += '<label>' + t('membership_pause_start') + '</label>';
    html += '<input type="date" id="yb-pause-start" class="yb-membership__date-input" />';
    html += '<span class="yb-membership__field-hint" id="yb-pause-start-hint"></span>';
    html += '</div>';
    html += '<div class="yb-membership__manage-field">';
    html += '<label>' + t('membership_pause_end') + '</label>';
    html += '<input type="date" id="yb-pause-end" class="yb-membership__date-input" />';
    html += '<span class="yb-membership__field-hint">' + t('membership_pause_min') + ' · ' + t('membership_pause_max') + '</span>';
    html += '</div>';
    html += '<p class="yb-membership__resume-info" id="yb-pause-resume-info" hidden></p>';
    html += '</div>';
    html += '<div class="yb-auth-error" id="yb-pause-error" hidden role="alert"></div>';
    html += '<button type="button" class="yb-membership__confirm-btn yb-membership__confirm-btn--pause" id="yb-pause-confirm">' + t('membership_pause_confirm') + '</button>';
    html += '</div>';

    // Cancel panel (hidden by default, shown when user clicks Cancel)
    html += '<div id="yb-membership-cancel-panel" class="yb-membership__manage-panel" hidden>';
    html += '<div class="yb-membership__manage-header">';
    html += '<button type="button" class="yb-membership__back-btn" data-manage-back>&larr; ' + t('membership_back') + '</button>';
    html += '<h3 class="yb-membership__manage-title">' + t('membership_cancel_title') + '</h3>';
    html += '</div>';
    html += '<p class="yb-membership__manage-desc">' + t('membership_cancel_desc') + '</p>';
    html += '<div class="yb-membership__manage-info">';
    html += '<div class="yb-membership__info-row"><span class="yb-membership__info-label">' + t('membership_cancel_earliest') + ':</span> <strong id="yb-cancel-earliest-date"></strong></div>';
    html += '<div class="yb-membership__info-row"><span class="yb-membership__info-label">' + t('membership_cancel_use_until') + ':</span> <strong id="yb-cancel-use-until"></strong></div>';
    html += '</div>';
    html += '<div class="yb-membership__cancel-warning">' + t('membership_cancel_warning') + '</div>';
    html += '<div class="yb-auth-error" id="yb-cancel-error" hidden role="alert"></div>';
    html += '<button type="button" class="yb-membership__confirm-btn yb-membership__confirm-btn--cancel" id="yb-cancel-confirm">' + t('membership_cancel_confirm') + '</button>';
    html += '</div>';

    container.innerHTML = html;

    // Bind manage button event listeners
    bindMembershipManageEvents(container, data);
  }

  // ── Calculate earliest termination date: 1 month + running days ──
  function calcEarliestTerminationDate(nextBillingDate) {
    var now = new Date();
    var base = nextBillingDate ? new Date(nextBillingDate) : now;
    // If next billing is in the past, use today
    if (base < now) base = now;
    // Add 1 month
    var earliest = new Date(base);
    earliest.setMonth(earliest.getMonth() + 1);
    // "Running days" means it aligns to end of billing cycle after the notice period
    // The termination takes effect at the end of the billing period that follows the 1-month notice
    return earliest;
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

  function bindMembershipManageEvents(container, data) {
    var contracts = data.activeContracts || [];
    var locale = isDa() ? 'da-DK' : 'en-GB';
    var dateOpts = { day: 'numeric', month: 'long', year: 'numeric' };
    var activeContractId = null;
    var activeContract = null;

    // Sections to show/hide
    var allSections = container.querySelectorAll('.yb-membership__section');
    var pausePanel = document.getElementById('yb-membership-pause-panel');
    var cancelPanel = document.getElementById('yb-membership-cancel-panel');

    function showSections() {
      for (var i = 0; i < allSections.length; i++) allSections[i].hidden = false;
      if (pausePanel) pausePanel.hidden = true;
      if (cancelPanel) cancelPanel.hidden = true;
    }

    function hideSections() {
      for (var i = 0; i < allSections.length; i++) allSections[i].hidden = true;
    }

    // Back buttons
    var backBtns = container.querySelectorAll('[data-manage-back]');
    for (var b = 0; b < backBtns.length; b++) {
      backBtns[b].addEventListener('click', showSections);
    }

    // ── Pause buttons ──
    var pauseBtns = container.querySelectorAll('[data-manage-pause]');
    for (var p = 0; p < pauseBtns.length; p++) {
      pauseBtns[p].addEventListener('click', function() {
        activeContractId = this.getAttribute('data-manage-pause');
        activeContract = contracts.find(function(c) { return String(c.id) === String(activeContractId); });
        if (!activeContract || !pausePanel) return;

        hideSections();
        pausePanel.hidden = false;

        // Set min date for pause start (after next billing cycle)
        var earliestStart = calcEarliestPauseStart(activeContract.nextBillingDate);
        var startInput = document.getElementById('yb-pause-start');
        var endInput = document.getElementById('yb-pause-end');
        var hintEl = document.getElementById('yb-pause-start-hint');
        var resumeInfoEl = document.getElementById('yb-pause-resume-info');
        var errorEl = document.getElementById('yb-pause-error');

        if (startInput) {
          startInput.min = earliestStart.toISOString().split('T')[0];
          startInput.value = earliestStart.toISOString().split('T')[0];
        }
        if (hintEl) {
          hintEl.textContent = t('membership_pause_next_billing') + ': ' + earliestStart.toLocaleDateString(locale, dateOpts);
        }

        // Set default end date (14 days after start)
        if (endInput && startInput) {
          var defaultEnd = new Date(earliestStart);
          defaultEnd.setDate(defaultEnd.getDate() + 14);
          endInput.min = defaultEnd.toISOString().split('T')[0];
          var maxEnd = new Date(earliestStart);
          maxEnd.setMonth(maxEnd.getMonth() + 3);
          endInput.max = maxEnd.toISOString().split('T')[0];
          endInput.value = defaultEnd.toISOString().split('T')[0];
        }

        // Update resume info when dates change
        function updateResumeInfo() {
          if (!resumeInfoEl || !endInput) return;
          if (endInput.value) {
            var resumeDate = new Date(endInput.value);
            resumeInfoEl.textContent = t('membership_pause_resume') + ' ' + resumeDate.toLocaleDateString(locale, dateOpts);
            resumeInfoEl.hidden = false;
          } else {
            resumeInfoEl.hidden = true;
          }
        }

        // Update end date constraints when start changes
        function onStartChange() {
          if (!endInput || !startInput || !startInput.value) return;
          var sd = new Date(startInput.value);
          var minEnd = new Date(sd);
          minEnd.setDate(minEnd.getDate() + 14);
          var maxEnd = new Date(sd);
          maxEnd.setMonth(maxEnd.getMonth() + 3);
          endInput.min = minEnd.toISOString().split('T')[0];
          endInput.max = maxEnd.toISOString().split('T')[0];
          // Reset end if out of range
          if (endInput.value < endInput.min) endInput.value = endInput.min;
          if (endInput.value > endInput.max) endInput.value = endInput.max;
          updateResumeInfo();
        }

        if (startInput) startInput.addEventListener('change', onStartChange);
        if (endInput) endInput.addEventListener('change', updateResumeInfo);
        updateResumeInfo();

        if (errorEl) errorEl.hidden = true;
      });
    }

    // ── Pause confirm button ──
    var pauseConfirmBtn = document.getElementById('yb-pause-confirm');
    if (pauseConfirmBtn) {
      pauseConfirmBtn.addEventListener('click', function() {
        if (!activeContractId || !clientId) return;
        var startInput = document.getElementById('yb-pause-start');
        var endInput = document.getElementById('yb-pause-end');
        var errorEl = document.getElementById('yb-pause-error');

        if (!startInput || !startInput.value || !endInput || !endInput.value) return;

        pauseConfirmBtn.disabled = true;
        pauseConfirmBtn.textContent = t('membership_pause_confirming');
        if (errorEl) errorEl.hidden = true;

        fetch('/.netlify/functions/mb-contract-manage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'suspend',
            clientId: clientId,
            clientContractId: Number(activeContractId),
            startDate: startInput.value,
            endDate: endInput.value
          })
        })
        .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
        .then(function(res) {
          if (res.ok && res.data.success) {
            showSections();
            // Reload membership data
            loadMembershipDetails();
            showMembershipToast(t('membership_pause_success'), 'success');
          } else {
            if (errorEl) {
              errorEl.textContent = res.data.error || t('membership_pause_error');
              errorEl.hidden = false;
            }
          }
          pauseConfirmBtn.disabled = false;
          pauseConfirmBtn.textContent = t('membership_pause_confirm');
        })
        .catch(function() {
          if (errorEl) {
            errorEl.textContent = t('membership_pause_error');
            errorEl.hidden = false;
          }
          pauseConfirmBtn.disabled = false;
          pauseConfirmBtn.textContent = t('membership_pause_confirm');
        });
      });
    }

    // ── Cancel buttons ──
    var cancelBtns = container.querySelectorAll('[data-manage-cancel]');
    for (var c = 0; c < cancelBtns.length; c++) {
      cancelBtns[c].addEventListener('click', function() {
        activeContractId = this.getAttribute('data-manage-cancel');
        activeContract = contracts.find(function(ct) { return String(ct.id) === String(activeContractId); });
        if (!activeContract || !cancelPanel) return;

        hideSections();
        cancelPanel.hidden = false;

        var errorEl = document.getElementById('yb-cancel-error');
        if (errorEl) errorEl.hidden = true;

        // Calculate earliest termination date (1 month + running days)
        var earliest = calcEarliestTerminationDate(activeContract.nextBillingDate);
        var earliestEl = document.getElementById('yb-cancel-earliest-date');
        if (earliestEl) earliestEl.textContent = earliest.toLocaleDateString(locale, dateOpts);

        // "Use until" = the termination date (end of paid period)
        // The paid period ends at earliest termination date since that's after 1 month notice
        var useUntilEl = document.getElementById('yb-cancel-use-until');
        if (useUntilEl) useUntilEl.textContent = earliest.toLocaleDateString(locale, dateOpts);
      });
    }

    // ── Cancel confirm button ──
    var cancelConfirmBtn = document.getElementById('yb-cancel-confirm');
    if (cancelConfirmBtn) {
      cancelConfirmBtn.addEventListener('click', function() {
        if (!activeContractId || !clientId) return;
        var errorEl = document.getElementById('yb-cancel-error');

        var earliest = calcEarliestTerminationDate(activeContract ? activeContract.nextBillingDate : null);
        var terminationDate = earliest.toISOString().split('T')[0];

        cancelConfirmBtn.disabled = true;
        cancelConfirmBtn.textContent = t('membership_cancel_confirming');
        if (errorEl) errorEl.hidden = true;

        fetch('/.netlify/functions/mb-contract-manage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'terminate',
            clientId: clientId,
            clientContractId: Number(activeContractId),
            terminationDate: terminationDate
          })
        })
        .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
        .then(function(res) {
          if (res.ok && res.data.success) {
            showSections();
            loadMembershipDetails();
            showMembershipToast(t('membership_cancel_success'), 'success');
          } else {
            if (errorEl) {
              errorEl.textContent = res.data.error || t('membership_cancel_error');
              errorEl.hidden = false;
            }
          }
          cancelConfirmBtn.disabled = false;
          cancelConfirmBtn.textContent = t('membership_cancel_confirm');
        })
        .catch(function() {
          if (errorEl) {
            errorEl.textContent = t('membership_cancel_error');
            errorEl.hidden = false;
          }
          cancelConfirmBtn.disabled = false;
          cancelConfirmBtn.textContent = t('membership_cancel_confirm');
        });
      });
    }
  }

  function showMembershipToast(message, type) {
    var existing = document.querySelector('.yb-membership__toast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.className = 'yb-membership__toast yb-membership__toast--' + (type || 'info');
    toast.textContent = message;
    var container = document.getElementById('yb-membership-content');
    if (container) container.insertBefore(toast, container.firstChild);
    setTimeout(function() { toast.remove(); }, 5000);
  }

  // ══════════════════════════════════════
  // STORE TAB
  // ══════════════════════════════════════
  var storeServices = [];
  var storeActiveCategory = 'all';

  // Store category config — maps to Mindbody programs/categories
  var storeCategories = [
    { id: 'all', da: 'Alle', en: 'All' },
    { id: 'trials', da: 'Prøvekort', en: 'Trials' },
    { id: 'tourist', da: 'Turistpas', en: 'Tourist Pass' },
    { id: 'memberships', da: 'Medlemskaber', en: 'Memberships' },
    { id: 'clips', da: 'Klippekort', en: 'Clip Cards' },
    { id: 'timebased', da: 'Tidsbegrænsede Pas', en: 'Time-based Passes' },
    { id: 'teacher', da: 'Yogalæreruddannelser', en: 'Teacher Trainings' },
    { id: 'courses', da: 'Kurser', en: 'Courses' },
    { id: 'private', da: 'Privattimer', en: 'Private Sessions' }
  ];

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

    listEl.innerHTML = '<div class="yb-store__loading"><div class="yb-mb-spinner"></div><span>' + (isDa() ? 'Henter pakker...' : 'Loading packages...') + '</span></div>';

    // Check if specific items are configured, otherwise load all sellable online
    var storePanel = document.querySelector('[data-yb-panel="store"]');
    var itemIds = storePanel ? storePanel.getAttribute('data-store-items') : '';
    var url = itemIds
      ? '/.netlify/functions/mb-services?serviceIds=' + itemIds
      : '/.netlify/functions/mb-services?sellOnline=true';

    fetch(url)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        storeServices = data.services || [];
        if (!storeServices.length) { listEl.innerHTML = '<p class="yb-store__empty">' + t('store_empty') + '</p>'; return; }
        renderStoreItems(listEl);
      })
      .catch(function() { listEl.innerHTML = '<p class="yb-store__error">' + t('store_error') + '</p>'; });
  }

  /**
   * Categorize a service by name heuristics.
   * Once you assign Mindbody barcodes, this can be refined by programId.
   */
  function categorizeService(s) {
    var name = (s.name || '').toLowerCase();
    if (name.indexOf('trial') !== -1 || name.indexOf('prøv') !== -1 || name.indexOf('intro') !== -1) return 'trials';
    if (name.indexOf('tourist') !== -1 || name.indexOf('turist') !== -1 || name.indexOf('drop-in') !== -1 || name.indexOf('drop in') !== -1) return 'tourist';
    if (name.indexOf('membership') !== -1 || name.indexOf('medlems') !== -1 || name.indexOf('unlimited') !== -1 || name.indexOf('autopay') !== -1) return 'memberships';
    if (name.indexOf('clip') !== -1 || name.indexOf('klip') !== -1 || name.indexOf('punch') !== -1 || name.indexOf('pack') !== -1 || name.indexOf('class') !== -1) return 'clips';
    if (name.indexOf('month') !== -1 || name.indexOf('week') !== -1 || name.indexOf('uge') !== -1 || name.indexOf('måned') !== -1 || name.indexOf('day') !== -1 || name.indexOf('dag') !== -1) return 'timebased';
    if (name.indexOf('teacher') !== -1 || name.indexOf('lærer') !== -1 || name.indexOf('training') !== -1 || name.indexOf('uddannelse') !== -1 || name.indexOf('200') !== -1 || name.indexOf('300') !== -1) return 'teacher';
    if (name.indexOf('course') !== -1 || name.indexOf('kursus') !== -1 || name.indexOf('workshop') !== -1) return 'courses';
    if (name.indexOf('private') !== -1 || name.indexOf('privat') !== -1 || name.indexOf('1-on-1') !== -1 || name.indexOf('personal') !== -1) return 'private';
    return 'all';
  }

  function renderStoreItems(container) {
    // Categorize services
    storeServices.forEach(function(s) {
      s._category = categorizeService(s);
    });

    // Build category tabs
    var html = '<div class="yb-store__categories">';
    storeCategories.forEach(function(cat) {
      // Count items in category
      var count = cat.id === 'all'
        ? storeServices.length
        : storeServices.filter(function(s) { return s._category === cat.id; }).length;
      if (count === 0 && cat.id !== 'all') return;
      var isActive = storeActiveCategory === cat.id;
      html += '<button class="yb-store__cat-btn' + (isActive ? ' is-active' : '') + '" type="button" data-store-cat="' + cat.id + '">';
      html += (isDa() ? cat.da : cat.en);
      if (cat.id !== 'all') html += ' <span class="yb-store__cat-count">' + count + '</span>';
      html += '</button>';
    });
    html += '</div>';

    // Filter services
    var filtered = storeActiveCategory === 'all'
      ? storeServices
      : storeServices.filter(function(s) { return s._category === storeActiveCategory; });

    // Grid
    html += '<div class="yb-store__grid">';
    filtered.forEach(function(s) {
      var price = s.onlinePrice || s.price || 0;
      html += '<div class="yb-store__item">';
      html += '  <div class="yb-store__item-info">';
      html += '    <h3 class="yb-store__item-name">' + esc(s.name) + '</h3>';
      if (s.count) html += '    <span class="yb-store__item-count">' + s.count + ' ' + (isDa() ? 'klip' : 'sessions') + '</span>';
      html += '    <span class="yb-store__item-price">' + formatDKK(price) + '</span>';
      html += '  </div>';
      html += '  <button class="yb-btn yb-btn--primary yb-store__item-btn" type="button" data-store-buy="' + s.id + '">' + t('store_buy') + '</button>';
      html += '</div>';
    });
    if (!filtered.length) {
      html += '<p class="yb-store__empty">' + t('store_empty') + '</p>';
    }
    html += '</div>';

    container.innerHTML = html;

    // Attach category tab handlers
    container.querySelectorAll('[data-store-cat]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        storeActiveCategory = btn.getAttribute('data-store-cat');
        renderStoreItems(container);
      });
    });

    // Attach buy handlers
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
    var hasMembership = activeContracts.length > 0;

    var hasAnyActivePass = (data.activeServices && data.activeServices.length > 0) || (data.activeContracts && data.activeContracts.length > 0);

    if (hasAnyActivePass) {
      // Always hide buy-pass banner for active pass holders
      if (noPassEl) noPassEl.hidden = true;

      var html = '';

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
          // Show low-clip warning when below 3
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

      // Show membership info (no buy-pass prompt for members)
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

      if (html) {
        passInfoEl.innerHTML = html;
        passInfoEl.hidden = false;
      }
    } else {
      // No active pass — show the buy-pass banner
      if (passInfoEl) passInfoEl.hidden = true;
      if (noPassEl) noPassEl.hidden = false;
    }
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
    });

    container.innerHTML = html;

    // Attach book/cancel handlers
    container.querySelectorAll('[data-schedule-book]').forEach(function(btn) {
      btn.addEventListener('click', function() { bookClass(btn); });
    });
    container.querySelectorAll('[data-schedule-cancel]').forEach(function(btn) {
      btn.addEventListener('click', function() { cancelClass(btn); });
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
          body: JSON.stringify({ clientId: clientId, classScheduleId: Number(classId) })
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
   * Check if the client's active passes cover this class's program.
   * Returns true if they have a matching service or an active contract (membership).
   */
  function clientCanBook(programId) {
    if (!clientPassData) return true; // If pass data not loaded, let backend decide
    if (!programId) return true; // If class has no program info, let backend decide

    // Active contracts (memberships) typically cover all classes
    if (clientPassData.activeContracts && clientPassData.activeContracts.length > 0) {
      return true;
    }

    // Check if any active service covers this program
    var activeServices = clientPassData.activeServices || [];
    for (var i = 0; i < activeServices.length; i++) {
      if (activeServices[i].programId === programId) {
        return true;
      }
    }
    return false;
  }

  function bookClass(btn) {
    var classId = btn.getAttribute('data-schedule-book');
    if (!clientId) {
      showScheduleToast(isDa() ? 'Køb et pas først i Butik-fanen.' : 'Buy a pass first in the Store tab.', 'error');
      var noPassEl = document.getElementById('yb-schedule-no-pass');
      if (noPassEl) noPassEl.hidden = false;
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

    // Check if client's pass covers this class's program BEFORE sending request
    var classRow = btn.closest('.yb-schedule__class');
    var programId = classRow ? Number(classRow.getAttribute('data-program-id')) : null;

    if (!clientCanBook(programId)) {
      showScheduleToast(isDa() ? 'Dit pas dækker ikke denne type klasse.' : "Your pass doesn't cover this class type.", 'error');
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
          if (data.lateCancel) {
            showScheduleToast(isDa()
              ? 'Sen annullering — kan medføre gebyr.'
              : 'Late cancellation — may incur fees.', 'warning');
          } else {
            showScheduleToast(isDa() ? 'Booking annulleret.' : 'Booking cancelled.', 'success');
          }
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
  var receiptsPeriod = '365'; // default 1 year

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
        console.log('Receipts response:', data);
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
      var name = p.serviceName || p.description || '—';
      var amount = p.amountPaid || p.price || 0;

      // Build type badge
      var typeBadge = '';
      if (p.type === 'contract') {
        typeBadge = '<span class="yb-receipts__badge yb-receipts__badge--contract">' + (isDa() ? 'Medlemskab' : 'Membership') + '</span>';
      } else if (p.type === 'service') {
        typeBadge = '<span class="yb-receipts__badge yb-receipts__badge--service">' + (isDa() ? 'Klippekort' : 'Pass') + '</span>';
      } else if (p.type === 'sale') {
        typeBadge = '<span class="yb-receipts__badge yb-receipts__badge--sale">' + (isDa() ? 'Køb' : 'Purchase') + '</span>';
      }

      html += '<div class="yb-receipts__card' + (p.returned ? ' yb-receipts__card--returned' : '') + '" data-receipt-idx="' + idx + '">';

      // Header: date + badges
      html += '<div class="yb-receipts__card-header">';
      html += '<span class="yb-receipts__card-date">' + dateStr + '</span>';
      html += '<div class="yb-receipts__card-badges">';
      html += typeBadge;
      if (p.returned) {
        html += '<span class="yb-receipts__badge yb-receipts__badge--returned">' + (isDa() ? 'Refunderet' : 'Refunded') + '</span>';
      }
      if (p.current) {
        html += '<span class="yb-receipts__badge yb-receipts__badge--active">' + (isDa() ? 'Aktiv' : 'Active') + '</span>';
      }
      html += '</div>';
      html += '</div>';

      // Body: name
      html += '<div class="yb-receipts__card-body">';
      html += '<span class="yb-receipts__card-name">' + esc(name) + '</span>';
      if (p.programName) {
        html += '<span class="yb-receipts__card-program">' + esc(p.programName) + '</span>';
      }
      html += '</div>';

      // Details grid
      html += '<div class="yb-receipts__card-details">';

      // Amount
      html += '<div class="yb-receipts__detail">';
      html += '<span class="yb-receipts__detail-label">' + (isDa() ? 'Beløb' : 'Amount') + '</span>';
      html += '<span class="yb-receipts__detail-value">' + (amount > 0 ? formatDKK(amount) : (isDa() ? 'Inkluderet' : 'Included')) + '</span>';
      html += '</div>';

      // Payment method
      if (p.paymentMethod) {
        var paymentDisplay = p.paymentMethod;
        if (p.paymentLast4) paymentDisplay += ' ****' + p.paymentLast4;
        html += '<div class="yb-receipts__detail">';
        html += '<span class="yb-receipts__detail-label">' + (isDa() ? 'Betaling' : 'Payment') + '</span>';
        html += '<span class="yb-receipts__detail-value">' + esc(paymentDisplay) + '</span>';
        html += '</div>';
      }

      // Quantity
      if (p.quantity > 1) {
        html += '<div class="yb-receipts__detail">';
        html += '<span class="yb-receipts__detail-label">' + (isDa() ? 'Antal' : 'Qty') + '</span>';
        html += '<span class="yb-receipts__detail-value">' + p.quantity + '</span>';
        html += '</div>';
      }

      // Remaining (for services)
      if (typeof p.remaining === 'number' && p.count) {
        html += '<div class="yb-receipts__detail">';
        html += '<span class="yb-receipts__detail-label">' + (isDa() ? 'Klip brugt' : 'Sessions used') + '</span>';
        html += '<span class="yb-receipts__detail-value">' + (p.count - p.remaining) + ' / ' + p.count + '</span>';
        html += '</div>';
      }

      // Expiration
      if (p.expirationDate) {
        var expDate = new Date(p.expirationDate);
        var expStr = expDate.toLocaleDateString(isDa() ? 'da-DK' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        html += '<div class="yb-receipts__detail">';
        html += '<span class="yb-receipts__detail-label">' + (isDa() ? 'Udløber' : 'Expires') + '</span>';
        html += '<span class="yb-receipts__detail-value">' + expStr + '</span>';
        html += '</div>';
      }

      // Contract end date
      if (p.contractEndDate) {
        var endDate = new Date(p.contractEndDate);
        var endStr = endDate.toLocaleDateString(isDa() ? 'da-DK' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        html += '<div class="yb-receipts__detail">';
        html += '<span class="yb-receipts__detail-label">' + (isDa() ? 'Slutdato' : 'End date') + '</span>';
        html += '<span class="yb-receipts__detail-value">' + endStr + '</span>';
        html += '</div>';
      }

      // Autopay info
      if (p.autopayAmount > 0) {
        html += '<div class="yb-receipts__detail">';
        html += '<span class="yb-receipts__detail-label">' + (isDa() ? 'Autopay' : 'Auto-pay') + '</span>';
        html += '<span class="yb-receipts__detail-value">' + formatDKK(p.autopayAmount) + (isDa() ? '/md' : '/mo') + '</span>';
        html += '</div>';
      }

      // Discount
      if (p.discount > 0) {
        html += '<div class="yb-receipts__detail">';
        html += '<span class="yb-receipts__detail-label">' + (isDa() ? 'Rabat' : 'Discount') + '</span>';
        html += '<span class="yb-receipts__detail-value yb-receipts__detail-value--discount">-' + formatDKK(p.discount) + '</span>';
        html += '</div>';
      }

      // Tax
      if (p.tax > 0) {
        html += '<div class="yb-receipts__detail">';
        html += '<span class="yb-receipts__detail-label">' + (isDa() ? 'Moms' : 'Tax') + '</span>';
        html += '<span class="yb-receipts__detail-value">' + formatDKK(p.tax) + '</span>';
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

      // Reference + download
      html += '<div class="yb-receipts__card-actions">';
      html += '<span class="yb-receipts__card-ref">#' + (p.saleId || p.id) + '</span>';
      html += '<button class="yb-receipts__download-btn" type="button" data-receipt-download="' + idx + '">';
      html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
      html += (isDa() ? 'Download kvittering' : 'Download receipt');
      html += '</button>';
      html += '</div>';

      html += '</div>'; // end card
    });

    html += '</div>';
    container.innerHTML = html;

    // Attach download handlers
    container.querySelectorAll('[data-receipt-download]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var idx = parseInt(btn.getAttribute('data-receipt-download'), 10);
        var p = purchases[idx];
        if (!p) return;

        var d = new Date(p.saleDate);
        var dateStr = d.toLocaleDateString(isDa() ? 'da-DK' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        var name = p.serviceName || p.description || '—';
        var amount = p.amountPaid || p.price || 0;

        var txt = '═══════════════════════════════════\n';
        txt += '       YOGA BIBLE — KVITTERING\n';
        txt += '═══════════════════════════════════\n\n';
        txt += (isDa() ? 'Dato: ' : 'Date: ') + dateStr + '\n';
        txt += (isDa() ? 'Vare: ' : 'Item: ') + name + '\n';
        if (p.programName) txt += (isDa() ? 'Program: ' : 'Program: ') + p.programName + '\n';
        txt += (isDa() ? 'Beløb: ' : 'Amount: ') + (amount > 0 ? formatDKK(amount) : (isDa() ? 'Inkluderet' : 'Included')) + '\n';
        if (p.paymentMethod) txt += (isDa() ? 'Betaling: ' : 'Payment: ') + p.paymentMethod + (p.paymentLast4 ? ' ****' + p.paymentLast4 : '') + '\n';
        if (p.quantity > 1) txt += (isDa() ? 'Antal: ' : 'Qty: ') + p.quantity + '\n';
        if (typeof p.remaining === 'number' && p.count) txt += (isDa() ? 'Klip brugt: ' : 'Sessions used: ') + (p.count - p.remaining) + ' / ' + p.count + '\n';
        if (p.expirationDate) txt += (isDa() ? 'Udløber: ' : 'Expires: ') + new Date(p.expirationDate).toLocaleDateString(isDa() ? 'da-DK' : 'en-GB') + '\n';
        if (p.discount > 0) txt += (isDa() ? 'Rabat: -' : 'Discount: -') + formatDKK(p.discount) + '\n';
        if (p.tax > 0) txt += (isDa() ? 'Moms: ' : 'Tax: ') + formatDKK(p.tax) + '\n';
        if (p.locationName) txt += (isDa() ? 'Lokation: ' : 'Location: ') + p.locationName + '\n';
        txt += (isDa() ? 'Reference: #' : 'Reference: #') + (p.saleId || p.id) + '\n\n';
        txt += '═══════════════════════════════════\n';
        txt += 'Yoga Bible DK | yogabible.dk\n';
        txt += 'Torvegade 66, 1400, København K\n';

        var blob = new Blob([txt], { type: 'text/plain' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'kvittering-' + (p.saleId || p.id) + '.txt';
        a.click();
        URL.revokeObjectURL(url);
      });
    });
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
