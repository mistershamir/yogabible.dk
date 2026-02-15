// =========================================================================
// ytt-funnel.js — CTA-to-Checkout Funnel with Lead Tracking
// Works for ALL products: YTT Preparation Phase, courses, memberships, etc.
// Orchestrates: CTA Click → Auth → Profile Complete → Checkout → Purchase
// Tracks every stage to Firestore lead_funnel collection
// =========================================================================
(function () {
  'use strict';

  // ── Constants ──
  var STORAGE_KEY = 'checkout_funnel';
  var COLLECTION = 'lead_funnel';

  // ── Product catalog (maps prodId → human-readable name + category) ──
  // Teacher Training Preparation Phase
  var PRODUCT_MAP = {
    '100078': { da: '18 Ugers Fleksibelt Program — Marts–Juni 2026', en: '18-Week Flexible Program — March–June 2026', category: 'teacher' },
    '100121': { da: '4 Ugers Intensiv — April 2026', en: '4-Week Intensive — April 2026', category: 'teacher' },
    '100211': { da: '4 Ugers Intensiv — Juli 2026', en: '4-Week Intensive — July 2026', category: 'teacher' },
    '100209': { da: '8 Ugers Semi-Intensiv — Maj–Juni 2026', en: '8-Week Semi-Intensive — May–June 2026', category: 'teacher' },
    '100210': { da: '18 Ugers Fleksibelt Program — August–December 2026', en: '18-Week Flexible Program — August–December 2026', category: 'teacher' },
    // Courses
    '100145': { da: 'Inversions Kursus', en: 'Inversions Course', category: 'courses' },
    '100150': { da: 'Splits Kursus', en: 'Splits Course', category: 'courses' },
    '100140': { da: 'Backbends Kursus', en: 'Backbends Course', category: 'courses' },
    '119':    { da: 'Inversions + Backbends Bundle', en: 'Inversions + Backbends Bundle', category: 'courses' },
    '120':    { da: 'Inversions + Splits Bundle', en: 'Inversions + Splits Bundle', category: 'courses' },
    '121':    { da: 'Backbends + Splits Bundle', en: 'Backbends + Splits Bundle', category: 'courses' },
    '127':    { da: 'All-In Bundle (3 kurser)', en: 'All-In Bundle (3 courses)', category: 'courses' },
    // Test product (REMOVE before production)
    '100203': { da: 'Test Klippekort', en: 'Test Clip Card', category: 'test' }
  };

  // ── Helpers ──
  function isDa() { return window.location.pathname.indexOf('/en/') !== 0; }

  function genSessionId() {
    return 'cf_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function getProductName(prodId) {
    var entry = PRODUCT_MAP[prodId];
    if (!entry) return 'Product ' + prodId;
    return isDa() ? entry.da : entry.en;
  }

  function getProductCategory(prodId) {
    var entry = PRODUCT_MAP[prodId];
    return entry ? entry.category : 'unknown';
  }

  function getProfilePath() {
    return isDa() ? '/profile' : '/en/profile';
  }

  // ── Session Storage ──
  function saveFunnel(data) {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) { /* private browsing */ }
  }

  function loadFunnel() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function clearFunnel() {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) { /* noop */ }
  }

  // ── Firestore Lead Tracking ──
  // Writes/upserts to lead_funnel/{userId}_{prodId}
  function trackFunnelStage(stage, extraData) {
    var funnel = loadFunnel();
    if (!funnel) return;

    var db, user;
    try {
      db = firebase.firestore();
      user = firebase.auth().currentUser;
    } catch (e) { return; }

    if (!user) return;

    var docId = user.uid + '_' + funnel.prodId;
    var now = firebase.firestore.FieldValue.serverTimestamp();

    // Base document data — always set on creation, merged on update
    var docData = {
      userId: user.uid,
      email: user.email || '',
      programId: funnel.prodId,
      programName: getProductName(funnel.prodId),
      productCategory: getProductCategory(funnel.prodId),
      funnel_stage: stage,
      sessionId: funnel.sessionId,
      source_page: funnel.sourcePage || '',
      updatedAt: now
    };

    // Add user profile info if available
    if (extraData && extraData.firstName) docData.firstName = extraData.firstName;
    if (extraData && extraData.lastName) docData.lastName = extraData.lastName;
    if (extraData && extraData.phone) docData.phone = extraData.phone;

    // Set stage-specific timestamp
    var stageKey = stage.replace(/-/g, '_') + '_at';
    docData[stageKey] = now;

    // Append to history array
    var historyEntry = { stage: stage, timestamp: new Date().toISOString() };

    db.collection(COLLECTION).doc(docId).get().then(function (snap) {
      if (snap.exists) {
        // Update existing doc — upsert latest stage + append history
        var update = {
          funnel_stage: stage,
          updatedAt: now
        };
        update[stageKey] = now;
        if (extraData && extraData.firstName) update.firstName = extraData.firstName;
        if (extraData && extraData.lastName) update.lastName = extraData.lastName;
        if (extraData && extraData.phone) update.phone = extraData.phone;
        update.history = firebase.firestore.FieldValue.arrayUnion(historyEntry);
        return db.collection(COLLECTION).doc(docId).update(update);
      } else {
        // Create new doc
        docData.createdAt = now;
        docData.cta_timestamp = funnel.startedAt || new Date().toISOString();
        docData.history = [
          { stage: 'cta_click', timestamp: funnel.startedAt || new Date().toISOString() },
          historyEntry
        ];
        return db.collection(COLLECTION).doc(docId).set(docData);
      }
    }).then(function () {
      console.log('[Checkout Funnel] Tracked:', stage, 'for prodId', funnel.prodId);
    }).catch(function (err) {
      console.warn('[Checkout Funnel] Track error:', err.message);
    });
  }

  // ── Convenience trackers ──
  function trackAuthComplete() { trackFunnelStage('auth_complete'); }

  function trackProfileComplete(profileData) {
    trackFunnelStage('profile_complete', profileData);
  }

  function trackCheckoutOpened() { trackFunnelStage('checkout_opened'); }

  function trackPurchased() {
    trackFunnelStage('purchased');
    clearFunnel();
  }

  function trackCheckoutAbandoned() { trackFunnelStage('checkout_abandoned'); }

  // ── GA DataLayer push ──
  function pushDataLayer(eventName, data) {
    window.dataLayer = window.dataLayer || [];
    var payload = { event: eventName };
    if (data) {
      for (var k in data) {
        if (data.hasOwnProperty(k)) payload[k] = data[k];
      }
    }
    window.dataLayer.push(payload);
  }

  // =========================================================================
  // ENTRY POINT — Called by CTA buttons on any page
  // <button data-checkout-product="100078">Start Preparation Phase</button>
  // or: <button onclick="startCheckoutFunnel('100078')">...</button>
  // =========================================================================
  function startCheckoutFunnel(prodId) {
    if (!prodId) return;

    var sessionId = genSessionId();
    var funnelData = {
      prodId: prodId,
      sourcePage: window.location.pathname,
      sessionId: sessionId,
      startedAt: new Date().toISOString()
    };

    saveFunnel(funnelData);

    // GA tracking for CTA click
    pushDataLayer('checkout_funnel_cta_click', {
      funnel_stage: 'cta_click',
      product_id: prodId,
      product_name: getProductName(prodId),
      product_category: getProductCategory(prodId),
      source_page: window.location.pathname
    });

    console.log('[Checkout Funnel] Started for prodId:', prodId);

    // Check if user is already logged in
    var user = null;
    try { user = firebase.auth().currentUser; } catch (e) { /* Firebase not ready yet */ }

    // Track CTA click
    trackFunnelStage('cta_click');

    // Open unified checkout flow modal (handles auth + payment in one popup)
    if (typeof window.openCheckoutFlow === 'function') {
      window.openCheckoutFlow(prodId);
    } else if (user) {
      // Fallback: already logged in — redirect to store
      trackAuthComplete();
      navigateToProfileStore();
    } else {
      // Fallback: open auth modal
      if (typeof window.openYBAuthModal === 'function') {
        window.openYBAuthModal('register');
      } else {
        window.location.href = getProfilePath() + '#store';
      }
    }
  }

  // ── Navigate to profile page store tab ──
  function navigateToProfileStore() {
    var profilePath = getProfilePath();
    var currentPath = window.location.pathname.replace(/\/$/, '');
    var targetPath = profilePath.replace(/\/$/, '');

    if (currentPath === targetPath) {
      // Already on profile page — dispatch event for profile.js to handle
      window.dispatchEvent(new CustomEvent('checkout:funnel-resume'));
    } else {
      // Redirect to profile page with store hash
      window.location.href = profilePath + '#store';
    }
  }

  // =========================================================================
  // AUTH STATE LISTENER — Resumes funnel after login/register
  // Runs on EVERY page (loaded in base.njk)
  // =========================================================================
  function initAuthListener() {
    // Wait for Firebase to be available
    var checkInterval = setInterval(function () {
      if (typeof firebase !== 'undefined' && firebase.auth) {
        clearInterval(checkInterval);

        firebase.auth().onAuthStateChanged(function (user) {
          if (!user) return;

          var funnel = loadFunnel();
          if (!funnel) return;

          // Only redirect once — if funnel already redirected, just clear it
          if (funnel.redirected) {
            // Already redirected on a previous page load — don't redirect again.
            // Clear stale funnel so user can browse freely.
            clearFunnel();
            return;
          }

          // Mark as redirected so next page load won't redirect again
          funnel.redirected = true;
          saveFunnel(funnel);

          // User just logged in with a pending funnel
          console.log('[Checkout Funnel] Auth state changed, funnel pending for prodId:', funnel.prodId);

          // If the checkout flow modal is handling this, don't redirect
          var ycfModal = document.getElementById('ycf-modal');
          if (ycfModal && ycfModal.getAttribute('aria-hidden') === 'false') {
            console.log('[Checkout Funnel] Checkout flow modal is active — skipping redirect');
            return;
          }

          // Track auth_complete (idempotent — Firestore upsert)
          trackAuthComplete();

          // GA tracking
          pushDataLayer('checkout_funnel_auth_complete', {
            funnel_stage: 'auth_complete',
            product_id: funnel.prodId,
            product_name: getProductName(funnel.prodId),
            product_category: getProductCategory(funnel.prodId)
          });

          // Navigate to profile store if not already there
          navigateToProfileStore();
        });
      }
    }, 100);

    // Timeout — stop polling after 10s
    setTimeout(function () { clearInterval(checkInterval); }, 10000);
  }

  // =========================================================================
  // CLICK HANDLER — Attach to all [data-checkout-product] buttons
  // =========================================================================
  function attachClickHandlers() {
    document.querySelectorAll('[data-checkout-product]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var prodId = btn.getAttribute('data-checkout-product');
        startCheckoutFunnel(prodId);
      });
    });
  }

  // =========================================================================
  // INIT
  // =========================================================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      attachClickHandlers();
      initAuthListener();
    });
  } else {
    attachClickHandlers();
    initAuthListener();
  }

  // ── Public API ──
  // Primary entry point — can be called from onclick="" or JS
  window.startCheckoutFunnel = startCheckoutFunnel;
  // Backward-compat alias for YTT-specific CTAs
  window.startYTTFunnel = startCheckoutFunnel;

  // Expose internal helpers for profile.js / firebase-auth.js integration
  window.CheckoutFunnel = {
    load: loadFunnel,
    save: saveFunnel,
    clear: clearFunnel,
    trackAuthComplete: trackAuthComplete,
    trackProfileComplete: trackProfileComplete,
    trackCheckoutOpened: trackCheckoutOpened,
    trackPurchased: trackPurchased,
    trackCheckoutAbandoned: trackCheckoutAbandoned,
    navigateToProfileStore: navigateToProfileStore,
    getProductName: getProductName,
    getProductCategory: getProductCategory,
    PRODUCT_MAP: PRODUCT_MAP,
    pushDataLayer: pushDataLayer
  };

})();
