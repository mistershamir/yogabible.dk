// =====================================================================
// HOT YOGA COPENHAGEN — Checkout Embed (self-contained)
// Single <script> for embedding on hotyogacph.dk (Framer site).
// Bundles: Firebase SDK loader · CSS · Modal HTML · Auth · Payment logic
// Brand: #3f99a5 (HYC teal)
// API:   https://profile.hotyogacph.dk/.netlify/functions
// Phase 1 — service-type daily products only (no memberships/contracts)
// =====================================================================
(function () {
  'use strict';

  // Prevent double-init if script is loaded twice
  if (window.__hyc_checkout_embed_loaded) return;
  window.__hyc_checkout_embed_loaded = true;

  // ── Brand & Config ──────────────────────────────────────────────────
  var BRAND        = '#3f99a5';
  var BRAND_DARK   = '#357f8a';
  var BRAND_RGBA12 = 'rgba(63,153,165,.12)';
  var BRAND_RGBA04 = 'rgba(63,153,165,.04)';
  var API_BASE     = 'https://profile.hotyogacph.dk/.netlify/functions';
  var PROFILE_URL  = 'https://profile.hotyogacph.dk';
  var FIREBASE_VER = '10.14.1';
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

  // ── Language helpers ────────────────────────────────────────────────
  var isDa = window.location.pathname.indexOf('/en/') !== 0;
  function t(da, en) { return isDa ? da : en; }

  // ── Product Catalog ─────────────────────────────────────────────────
  // Phase 1: daily service-type items only (clips, time-based, trials,
  // tourist). NO memberships (contract type — Phase 2).
  //
  // For prodIds that appear at different prices (trial vs regular, or
  // over30 vs under30 on same prodId), variant keys use a suffix:
  //   100186        → timebased over30 price (799)
  //   100186_trial  → trial over30 price (649)
  //   100185        → KickStarter over30 (599)
  //   100185_u30    → KickStarter under30 (475)
  // The `realId` field holds the actual Mindbody service ID for payment.
  // ────────────────────────────────────────────────────────────────────

  var PRODUCTS = {

    // ── Clips · Over 30 ──────────────────────────────────────────────
    '100174': { price: 299,   name_da: '1 Klasse Klippekort',   name_en: '1 Class Clip Card',   label_da: 'Prøv En',          label_en: 'Try One',          validity: null,       classes: 1   },
    '100175': { price: 549,   name_da: '2 Klasse Klippekort',   name_en: '2 Class Clip Card',   label_da: 'God Start',         label_en: 'Great Start',      validity: '10 dage',  classes: 2   },
    '100176': { price: 749,   name_da: '3 Klasse Klippekort',   name_en: '3 Class Clip Card',   label_da: 'Mærk Resultater',   label_en: 'Feel Results',     validity: '20 dage',  classes: 3   },
    '100177': { price: 1199,  name_da: '5 Klasse Klippekort',   name_en: '5 Class Clip Card',   label_da: 'Populært Valg',     label_en: 'Popular Choice',   validity: '30 dage',  classes: 5   },
    '100178': { price: 1999,  name_da: '10 Klasse Klippekort',  name_en: '10 Class Clip Card',  label_da: 'Spar Mere',         label_en: 'Save More',        validity: '50 dage',  classes: 10  },
    '100179': { price: 3599,  name_da: '20 Klasse Klippekort',  name_en: '20 Class Clip Card',  label_da: 'Smart Tilbud',      label_en: 'Smart Deal',       validity: '90 dage',  classes: 20  },
    '100180': { price: 4799,  name_da: '30 Klasse Klippekort',  name_en: '30 Class Clip Card',  label_da: 'Dedikeret Yogi',    label_en: 'Dedicated Yogi',   validity: '4 måneder', classes: 30  },
    '100181': { price: 7799,  name_da: '60 Klasse Klippekort',  name_en: '60 Class Clip Card',  label_da: 'Yoga Partner',      label_en: 'Yoga Partner',     validity: '9 måneder', classes: 60  },
    '100182': { price: 9999,  name_da: '100 Klasse Klippekort', name_en: '100 Class Clip Card', label_da: 'Bedste Værdi',      label_en: 'Best Value',       validity: '12 måneder', classes: 100 },
    '100183': { price: 17999, name_da: '200 Klasse Klippekort', name_en: '200 Class Clip Card', label_da: 'Familieplan',       label_en: 'Family Plan',      validity: '18 måneder', classes: 200 },

    // ── Clips · Under 30 ────────────────────────────────────────────
    '100017': { price: 275,   name_da: '1 Klasse Klippekort',   name_en: '1 Class Clip Card',   label_da: 'Prøv En',          label_en: 'Try One',          validity: null,       classes: 1   },
    '100016': { price: 495,   name_da: '2 Klasse Klippekort',   name_en: '2 Class Clip Card',   label_da: 'God Start',         label_en: 'Great Start',      validity: '10 dage',  classes: 2   },
    '100018': { price: 645,   name_da: '3 Klasse Klippekort',   name_en: '3 Class Clip Card',   label_da: 'Mærk Resultater',   label_en: 'Feel Results',     validity: '20 dage',  classes: 3   },
    '100019': { price: 975,   name_da: '5 Klasse Klippekort',   name_en: '5 Class Clip Card',   label_da: 'Populært Valg',     label_en: 'Popular Choice',   validity: '30 dage',  classes: 5   },
    '100020': { price: 1750,  name_da: '10 Klasse Klippekort',  name_en: '10 Class Clip Card',  label_da: 'Spar Mere',         label_en: 'Save More',        validity: '50 dage',  classes: 10  },
    '100021': { price: 2900,  name_da: '20 Klasse Klippekort',  name_en: '20 Class Clip Card',  label_da: 'Smart Tilbud',      label_en: 'Smart Deal',       validity: '90 dage',  classes: 20  },
    '100022': { price: 3750,  name_da: '30 Klasse Klippekort',  name_en: '30 Class Clip Card',  label_da: 'Dedikeret Yogi',    label_en: 'Dedicated Yogi',   validity: '4 måneder', classes: 30  },
    '100023': { price: 5950,  name_da: '60 Klasse Klippekort',  name_en: '60 Class Clip Card',  label_da: 'Yoga Partner',      label_en: 'Yoga Partner',     validity: '9 måneder', classes: 60  },
    '100024': { price: 8900,  name_da: '100 Klasse Klippekort', name_en: '100 Class Clip Card', label_da: 'Bedste Værdi',      label_en: 'Best Value',       validity: '12 måneder', classes: 100 },
    '100068': { price: 15800, name_da: '200 Klasse Klippekort', name_en: '200 Class Clip Card', label_da: 'Familieplan',       label_en: 'Family Plan',      validity: '18 måneder', classes: 200 },

    // ── Time-Based · Over 30 ────────────────────────────────────────
    '100186': { price: 799,   name_da: '14 Dage Ubegrænset',          name_en: '14 Days Unlimited',          validity: '14 dage'    },
    '100187': { price: 899,   name_da: '21 Dage Ubegrænset',          name_en: '21 Days Unlimited',          validity: '21 dage'    },
    '100189': { price: 1499,  name_da: '1 Måned Ubegrænset',          name_en: '1 Month Unlimited',          validity: '1 måned'    },
    '100190': { price: 3749,  name_da: '3 Måneder Ubegrænset',        name_en: '3 Months Unlimited',         validity: '3 måneder'  },
    '100191': { price: 6899,  name_da: '6 Måneder Ubegrænset',        name_en: '6 Months Unlimited',         validity: '6 måneder'  },
    '100192': { price: 12599, name_da: '12+1 Måneder Ubegrænset',     name_en: '12+1 Months Unlimited',      validity: '13 måneder' },

    // ── Time-Based · Under 30 ───────────────────────────────────────
    '100043': { price: 649,   name_da: '14 Dage Ubegrænset',          name_en: '14 Days Unlimited',          validity: '14 dage'    },
    '100044': { price: 749,   name_da: '21 Dage Ubegrænset',          name_en: '21 Days Unlimited',          validity: '21 dage'    },
    '100037': { price: 1399,  name_da: '1 Måned Ubegrænset',          name_en: '1 Month Unlimited',          validity: '1 måned'    },
    '100038': { price: 2999,  name_da: '3 Måneder Ubegrænset',        name_en: '3 Months Unlimited',         validity: '3 måneder'  },
    '100039': { price: 5399,  name_da: '6 Måneder Ubegrænset',        name_en: '6 Months Unlimited',         validity: '6 måneder'  },
    '100040': { price: 9599,  name_da: '12+1 Måneder Ubegrænset',     name_en: '12+1 Months Unlimited',      validity: '13 måneder' },

    // ── Trials · Over 30 (variant pricing — same MB service, promo rate)
    // Single-class trial reuses clip prodId 100174 (already in catalog).
    '100186_trial': { price: 649,  realId: '100186', name_da: '14 Dage Ubegrænset (Prøv)',  name_en: '14 Days Unlimited (Trial)', validity: '14 dage'  },
    '100187_trial': { price: 749,  realId: '100187', name_da: '21 Dage Ubegrænset (Prøv)',  name_en: '21 Days Unlimited (Trial)', validity: '21 dage'  },
    '100185':       { price: 599,  name_da: 'KickStarter',  name_en: 'KickStarter',  validity: '3 uger', classes: 10, desc_da: 'Kun for Københavns-beboere. 10 klasser inden for 3 uger.', desc_en: 'Copenhagen residents only. 10 classes within 3 weeks.' },

    // ── Trials · Under 30 (variant pricing)
    // Under-30 14-day & 21-day trial prices match timebased — no variant needed.
    // KickStarter under30 shares prodId 100185 but at 475 kr:
    '100185_u30':   { price: 475,  realId: '100185', name_da: 'KickStarter',  name_en: 'KickStarter',  validity: '3 uger', classes: 10, desc_da: 'Kun for Københavns-beboere. 10 klasser inden for 3 uger.', desc_en: 'Copenhagen residents only. 10 classes within 3 weeks.' },

    // ── Tourist · Over 30 ───────────────────────────────────────────
    // Single-class tourist reuses clip prodId 100174 (already in catalog).
    '100199': { price: 895, name_da: '7 Dage Tourist Pas',  name_en: '7 Days Tourist Pass',  validity: '7 dage', desc_da: 'Ubegrænset adgang inkl. måtte + håndklæder.', desc_en: 'Unlimited access incl. mat + towels.' },

    // ── Tourist · Under 30 ──────────────────────────────────────────
    // Single-class & 2-class tourist reuse clip prodIds (100017, 100016).
    '100051': { price: 750, name_da: '7 Dage Tourist Pas',  name_en: '7 Days Tourist Pass',  validity: '7 dage', desc_da: 'Ubegrænset adgang inkl. måtte + håndklæder.', desc_en: 'Unlimited access incl. mat + towels.' },

    // ── Test Product (1 DKK — for end-to-end payment testing) ───────
    '100203': { price: 1, name_da: 'Test Klippekort', name_en: 'Test Clip Card', validity: null, desc_da: 'Testprodukt til betalingsflow — 1 kr.', desc_en: 'Test product for payment flow — 1 DKK.' }
  };

  // ── Product helper ──────────────────────────────────────────────────
  function getProduct(prodId) {
    return PRODUCTS[String(prodId)] || null;
  }

  // The real Mindbody service ID (strips variant suffixes like _trial, _u30)
  function getRealProdId(prodId) {
    var p = getProduct(prodId);
    return (p && p.realId) ? p.realId : String(prodId).replace(/_.*$/, '');
  }

  // ── Firebase SDK Dynamic Loader ─────────────────────────────────────
  // Loads compat SDK from Google CDN, then initializes the HYC project.
  // Calls `callback` when firebase.auth() and firebase.firestore() are ready.

  function loadScript(url, cb) {
    var s = document.createElement('script');
    s.src = url;
    s.onload = function () { cb(null); };
    s.onerror = function () { cb(new Error('Failed to load ' + url)); };
    document.head.appendChild(s);
  }

  function loadFirebaseSDK(callback) {
    // If Firebase is already available (e.g. on profile subdomain), skip loading
    if (typeof firebase !== 'undefined' && firebase.apps) {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      return callback();
    }

    var scripts = [
      FIREBASE_CDN + '/firebase-app-compat.js',
      FIREBASE_CDN + '/firebase-auth-compat.js',
      FIREBASE_CDN + '/firebase-firestore-compat.js'
    ];

    // Load sequentially (auth & firestore depend on app)
    var i = 0;
    function next(err) {
      if (err) { console.warn('[HYC Embed]', err.message); }
      if (i >= scripts.length) {
        // Initialize
        try {
          if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
          console.log('[HYC Embed] Firebase initialized');
        } catch (e) {
          console.warn('[HYC Embed] Firebase init error:', e.message);
        }
        return callback();
      }
      loadScript(scripts[i++], next);
    }
    next(null);
  }

  // ── Part 2 continues: CSS injection ─────────────────────────────────
  // ── Part 3 continues: Modal HTML injection ──────────────────────────
  // ── Part 4 continues: Checkout flow logic ───────────────────────────
  // ── Part 5 continues: Event handlers, funnel tracking, boot ─────────

  // (IIFE intentionally left open — closed in Part 5)
