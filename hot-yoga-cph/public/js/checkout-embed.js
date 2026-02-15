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

  // ── Part 2: CSS Injection ────────────────────────────────────────────
  // All styles self-contained. Prefixed with `ycf-` (checkout flow) and
  // `yb-auth-` (auth modal). Brand orange replaced with HYC teal.
  // Injected once into <head> on first load.

  function injectCSS() {
    if (document.getElementById('hyc-checkout-css')) return;
    var style = document.createElement('style');
    style.id = 'hyc-checkout-css';
    style.textContent = [

      // ── Base: auth modal overlay + box ───────────────────────────
      '.yb-auth-modal{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px}',
      '.yb-auth-modal[aria-hidden="true"]{display:none}',
      '.yb-auth-modal__overlay{position:absolute;inset:0;background:rgba(0,0,0,.65);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}',
      '.yb-auth-modal__box{position:relative;background:#FFFCF9;border-radius:20px;width:100%;max-width:420px;max-height:90vh;overflow-y:auto;padding:48px 40px;box-shadow:0 24px 64px rgba(0,0,0,.12);border:1px solid #E8E4E0;transition:max-width .3s ease}',
      // Warm glow accent — teal instead of orange
      '.yb-auth-modal__box::before{content:"";position:absolute;top:-60px;right:-60px;width:180px;height:180px;background:radial-gradient(circle,' + BRAND_RGBA12 + ' 0%,transparent 70%);pointer-events:none}',

      // ── Close button ─────────────────────────────────────────────
      '.yb-auth-modal__close{position:absolute;top:16px;right:16px;background:none;border:none;font-size:1.2rem;color:#6F6A66;cursor:pointer;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:50%;z-index:2;transition:background .15s,color .15s}',
      '.yb-auth-modal__close:hover{background:#F5F3F0;color:#0F0F0F}',

      // ── Header ───────────────────────────────────────────────────
      '.yb-auth-modal__header{text-align:left;margin-bottom:28px}',
      '.yb-auth-modal__logo{margin-bottom:20px}',
      '.yb-auth-modal__logo img{height:36px;width:auto}',
      '.yb-auth-modal__title{font-size:1.5rem;font-weight:700;color:#0F0F0F;margin:0 0 6px}',
      '.yb-auth-modal__subtitle{font-size:.9rem;color:#6F6A66;margin:0}',

      // ── Form fields ──────────────────────────────────────────────
      '.yb-auth-form{display:flex;flex-direction:column;gap:16px}',
      '.yb-auth-field{display:flex;flex-direction:column;gap:6px}',
      '.yb-auth-field label{font-size:.82rem;font-weight:700;color:#0F0F0F;text-transform:uppercase;letter-spacing:.04em}',
      '.yb-auth-field input{font-family:inherit;font-size:.95rem;padding:12px 16px;border:1px solid ' + BRAND + ';border-radius:12px;background:#fff;color:#0F0F0F;transition:border-color .15s,box-shadow .15s;outline:none;width:100%;min-width:0;box-sizing:border-box}',
      '.yb-auth-field input::placeholder{color:#B5B0AB}',
      '.yb-auth-field input:focus{border-color:' + BRAND + ';box-shadow:0 0 0 3px ' + BRAND_RGBA12 + '}',
      '.yb-auth-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;overflow:hidden}',

      // ── Submit button — teal ─────────────────────────────────────
      '.yb-auth-submit{font-family:inherit;font-size:1rem;font-weight:700;padding:14px 24px;background:' + BRAND + ';color:#fff;border:none;border-radius:12px;cursor:pointer;transition:background .2s,transform .15s;margin-top:4px}',
      '.yb-auth-submit:hover{background:' + BRAND_DARK + '}',
      '.yb-auth-submit:active{transform:scale(.98)}',
      '.yb-auth-submit:disabled{opacity:.6;cursor:not-allowed}',

      // ── Error / success ──────────────────────────────────────────
      '.yb-auth-error{font-size:.85rem;color:#d32f2f;background:#fdecea;padding:10px 14px;border-radius:8px}',
      '.yb-auth-success{font-size:.85rem;color:#2e7d32;background:#edf7ed;padding:10px 14px;border-radius:8px}',

      // ── Links / dividers ─────────────────────────────────────────
      '.yb-auth-links{text-align:center;margin-top:12px}',
      '.yb-auth-links a{font-size:.85rem;color:' + BRAND + ';text-decoration:none}',
      '.yb-auth-links a:hover{text-decoration:underline}',
      '.yb-auth-divider{text-align:center;margin-top:20px;padding-top:20px;border-top:1px solid #E8E4E0;font-size:.85rem;color:#6F6A66}',
      '.yb-auth-divider a{color:' + BRAND + ';text-decoration:none;font-weight:700;margin-left:4px}',
      '.yb-auth-divider a:hover{text-decoration:underline}',

      // ── Consent checkboxes ───────────────────────────────────────
      '.yb-auth-consent{display:flex;flex-direction:column;gap:10px;margin-top:4px;margin-bottom:16px}',
      '.yb-auth-consent__item{display:flex;align-items:flex-start;gap:10px;font-size:.82rem;color:#0F0F0F;line-height:1.45;cursor:pointer}',
      '.yb-auth-consent__item input[type="checkbox"]{appearance:none;-webkit-appearance:none;width:18px;height:18px;min-width:18px;border:1.5px solid #E8E4E0;border-radius:4px;margin-top:1px;cursor:pointer;position:relative;transition:border-color .15s,background .15s}',
      '.yb-auth-consent__item input[type="checkbox"]:checked{background:' + BRAND + ';border-color:' + BRAND + '}',
      '.yb-auth-consent__item input[type="checkbox"]:checked::after{content:"";position:absolute;left:5px;top:1px;width:5px;height:10px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}',
      '.yb-auth-consent__item input[type="checkbox"]:focus-visible{box-shadow:0 0 0 3px ' + BRAND_RGBA12 + '}',
      '.yb-auth-consent__item a{color:' + BRAND + ';text-decoration:underline;font-weight:600}',
      '.yb-auth-consent__item a:hover{color:' + BRAND_DARK + '}',

      // ── Checkout service row / row grid / divider / secure ──────
      '.yb-checkout-service{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;background:#F5F3F0;border-radius:10px;margin-bottom:20px}',
      '.yb-checkout-service__name{font-weight:700;font-size:.92rem;color:#0F0F0F}',
      '.yb-checkout-service__price{font-weight:700;font-size:1rem;color:' + BRAND + '}',
      '.yb-checkout-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
      '.yb-checkout-divider{text-align:center;padding:8px 0;font-size:.82rem;font-weight:700;color:#6F6A66;text-transform:uppercase;letter-spacing:.04em;border-top:1px solid #E8E4E0;margin-top:4px;padding-top:16px}',
      '.yb-checkout-secure{display:flex;align-items:center;justify-content:center;gap:6px;font-size:.78rem;color:#6F6A66;margin-top:8px}',
      '.yb-checkout-success__inner{text-align:center;padding:20px 0}',
      '.yb-checkout-success__icon{width:64px;height:64px;border-radius:50%;background:#2e7d32;color:#fff;font-size:2rem;display:flex;align-items:center;justify-content:center;margin:0 auto 20px}',

      // ══════════════════════════════════════════════════════════════
      // CHECKOUT FLOW MODAL — ycf- prefix
      // ══════════════════════════════════════════════════════════════

      // Box override
      '.ycf-box{max-width:460px}',

      // Step indicator
      '.ycf-steps{display:flex;align-items:center;justify-content:center;gap:0;margin-bottom:28px}',
      '.ycf-steps__dot{width:10px;height:10px;border-radius:50%;background:#E8E4E0;transition:background .3s ease,transform .3s ease}',
      '.ycf-steps__dot--active{background:' + BRAND + ';transform:scale(1.15)}',
      '.ycf-steps__line{width:40px;height:2px;background:#E8E4E0}',

      // Step panels
      '.ycf-step{animation:ycfFadeIn .25s ease}',
      '@keyframes ycfFadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}',

      // Product badge (login step)
      '.ycf-product-badge{display:flex;flex-direction:column;padding:12px 16px;background:#F5F3F0;border-radius:10px;margin-bottom:20px;border:1px solid #E8E4E0}',
      '.ycf-product-badge__top{display:flex;justify-content:space-between;align-items:center}',
      '.ycf-product-badge__name{font-weight:700;font-size:.88rem;color:#0F0F0F}',
      '.ycf-product-badge__price{font-weight:700;font-size:.95rem;color:' + BRAND + '}',
      '.ycf-product-badge__cohort{display:block;font-size:.78rem;font-weight:600;color:#6F6A66;margin-top:4px}',
      '.ycf-product-badge__cohort[hidden]{display:none}',
      '.ycf-product-badge__desc{font-size:.78rem;color:#6F6A66;margin:6px 0 0;line-height:1.4}',

      // Back link
      '.ycf-back{display:inline-flex;align-items:center;gap:4px;font-size:.82rem;font-weight:600;color:#6F6A66;text-decoration:none;margin-bottom:12px;transition:color .15s}',
      '.ycf-back:hover{color:' + BRAND + '}',
      '.ycf-back[hidden]{display:none}',

      // Product breakdown card (checkout step)
      '.ycf-product{background:#F5F3F0;border-radius:12px;padding:20px;margin-bottom:20px;border:1px solid #E8E4E0}',
      '.ycf-product__header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px}',
      '.ycf-product__name{font-weight:700;font-size:1.05rem;color:#0F0F0F}',
      '.ycf-product__price{font-weight:700;font-size:1.1rem;color:' + BRAND + ';white-space:nowrap;margin-left:12px}',
      '.ycf-product__chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}',

      // Chips
      '.ycf-chip{display:inline-block;font-size:.72rem;font-weight:700;padding:4px 10px;border-radius:20px;background:#fff;color:#0F0F0F;border:1px solid #E8E4E0;text-transform:uppercase;letter-spacing:.03em}',
      '.ycf-chip--brand{background:' + BRAND + ';color:#fff;border-color:' + BRAND + '}',
      '.ycf-chip--muted{background:transparent;color:#6F6A66;border-color:transparent;font-weight:400;text-transform:none;padding-left:0}',

      // Product description & note
      '.ycf-product__desc{font-size:.88rem;color:#6F6A66;line-height:1.5;margin:0}',
      '.ycf-product__note{display:flex;align-items:flex-start;gap:8px;margin-top:14px;padding-top:14px;border-top:1px solid #E8E4E0;font-size:.82rem;color:#6F6A66;line-height:1.45}',
      '.ycf-product__note svg{flex-shrink:0;margin-top:1px;color:#6F6A66}',

      // Payment method selector (stored vs new card)
      '.ycf-payment-methods{display:flex;flex-direction:column;gap:8px;margin-bottom:16px}',
      '.ycf-payment-option{display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:10px;border:1.5px solid #E8E4E0;cursor:pointer;transition:border-color .2s,background .2s}',
      '.ycf-payment-option:hover{border-color:#B5B0AB}',
      '.ycf-payment-option--active{border-color:' + BRAND + ';background:' + BRAND_RGBA04 + '}',

      // Radio buttons — teal
      '.ycf-payment-option input[type="radio"]{appearance:none;-webkit-appearance:none;width:18px;height:18px;min-width:18px;border:2px solid #E8E4E0;border-radius:50%;position:relative;cursor:pointer;transition:border-color .15s}',
      '.ycf-payment-option input[type="radio"]:checked{border-color:' + BRAND + '}',
      '.ycf-payment-option input[type="radio"]:checked::after{content:"";position:absolute;top:3px;left:3px;width:8px;height:8px;background:' + BRAND + ';border-radius:50%}',

      // Payment option labels
      '.ycf-payment-option__info{display:flex;flex-direction:column;gap:2px}',
      '.ycf-payment-option__label{font-size:.88rem;font-weight:700;color:#0F0F0F}',
      '.ycf-payment-option__card{font-size:.82rem;color:#6F6A66;font-weight:400;letter-spacing:.02em}',

      // New card fields container
      '#ycf-new-card-fields{display:flex;flex-direction:column;gap:16px}',
      '#ycf-new-card-fields[hidden]{display:none}',

      // ── Responsive ───────────────────────────────────────────────
      '@media(max-width:480px){',
      '  .ycf-box{padding:36px 24px}',
      '  .ycf-product__header{flex-direction:column;gap:4px}',
      '  .ycf-product__price{margin-left:0}',
      '  .yb-auth-row{grid-template-columns:1fr}',
      '  .yb-checkout-row{grid-template-columns:1fr}',
      '}',

      // ── Bilingual toggle — hide inactive language ────────────────
      '[data-yj-da]{display:revert}',
      '[data-yj-en]{display:none}',

      ''
    ].join('\n');

    // If we're on an English page, flip the visibility
    if (!isDa) {
      style.textContent += '\n[data-yj-da]{display:none !important}\n[data-yj-en]{display:revert !important}\n';
    }

    document.head.appendChild(style);
  }

  // ── Part 3 continues: Modal HTML injection ──────────────────────────
  // ── Part 4 continues: Checkout flow logic ───────────────────────────
  // ── Part 5 continues: Event handlers, funnel tracking, boot ─────────

  // (IIFE intentionally left open — closed in Part 5)
