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

  // ── Part 3: Modal HTML + Auth Logic + Step Navigation ────────────────

  // ── 3A: State ───────────────────────────────────────────────────────
  var currentProdId = null;
  var currentStep = 1;
  var mbClientId = null;
  var storedCard = null;
  var authOriginStep = null;   // 'login' | 'register'
  var cameFromLoggedIn = false;
  var modal = null;
  var scrollY = 0;

  // ── 3B: DOM helpers ─────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  function showError(elId, msg) {
    var el = $(elId);
    if (el) { el.textContent = msg; el.hidden = false; }
  }

  function hideError(elId) {
    var el = $(elId);
    if (el) { el.textContent = ''; el.hidden = true; }
  }

  // ── 3C: Modal HTML injection ────────────────────────────────────────
  // Builds the 4-step checkout modal and appends it to <body>.
  // Mirrors modal-checkout-flow.njk but self-contained (no image deps).

  function injectModalHTML() {
    if ($('ycf-modal')) return;

    var TERMS_BASE = PROFILE_URL;
    var h = '';

    // ── Modal shell ───────────────────────────────────────────────
    h += '<div id="ycf-modal" class="yb-auth-modal" aria-hidden="true" role="dialog" aria-modal="true" aria-label="Checkout">';
    h +=   '<div class="yb-auth-modal__overlay" data-ycf-close></div>';
    h +=   '<div class="yb-auth-modal__box ycf-box">';
    h +=     '<button class="yb-auth-modal__close" type="button" data-ycf-close aria-label="Close">&#10005;</button>';

    // ── Step indicator (3 dots) ───────────────────────────────────
    h +=     '<div class="ycf-steps">';
    h +=       '<div class="ycf-steps__dot ycf-steps__dot--active" data-ycf-step-dot="1"></div>';
    h +=       '<div class="ycf-steps__line"></div>';
    h +=       '<div class="ycf-steps__dot" data-ycf-step-dot="2"></div>';
    h +=       '<div class="ycf-steps__line"></div>';
    h +=       '<div class="ycf-steps__dot" data-ycf-step-dot="3"></div>';
    h +=     '</div>';

    // ═══════════════════════════════════════════════════════════════
    // STEP 1 — LOGIN
    // ═══════════════════════════════════════════════════════════════
    h += '<div class="ycf-step" id="ycf-step-login" data-ycf-step="1">';
    h +=   '<div class="yb-auth-modal__header">';
    h +=     '<h2 class="yb-auth-modal__title" data-yj-da>Velkommen tilbage</h2>';
    h +=     '<h2 class="yb-auth-modal__title" data-yj-en hidden>Welcome back</h2>';
    h +=     '<p class="yb-auth-modal__subtitle" data-yj-da>Log ind for at forts\u00e6tte til betaling</p>';
    h +=     '<p class="yb-auth-modal__subtitle" data-yj-en hidden>Sign in to continue to payment</p>';
    h +=   '</div>';

    // Product preview badge
    h +=   '<div class="ycf-product-badge" id="ycf-product-badge">';
    h +=     '<div class="ycf-product-badge__top">';
    h +=       '<span class="ycf-product-badge__name" id="ycf-badge-name"></span>';
    h +=       '<span class="ycf-product-badge__price" id="ycf-badge-price"></span>';
    h +=     '</div>';
    h +=     '<span class="ycf-product-badge__cohort" id="ycf-badge-cohort" hidden></span>';
    h +=     '<p class="ycf-product-badge__desc" data-yj-da>Du f\u00e5r adgang til at booke klasser efter betaling</p>';
    h +=     '<p class="ycf-product-badge__desc" data-yj-en hidden>You\'ll be able to start booking classes after payment</p>';
    h +=   '</div>';

    // Login form
    h +=   '<form id="ycf-login-form" class="yb-auth-form" novalidate>';
    h +=     '<div class="yb-auth-field">';
    h +=       '<label for="ycf-login-email" data-yj-da>Email</label>';
    h +=       '<label for="ycf-login-email" data-yj-en hidden>Email</label>';
    h +=       '<input type="email" id="ycf-login-email" required autocomplete="email" placeholder="din@email.dk">';
    h +=     '</div>';
    h +=     '<div class="yb-auth-field">';
    h +=       '<label for="ycf-login-password" data-yj-da>Adgangskode</label>';
    h +=       '<label for="ycf-login-password" data-yj-en hidden>Password</label>';
    h +=       '<input type="password" id="ycf-login-password" required autocomplete="current-password" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022">';
    h +=     '</div>';
    h +=     '<div class="yb-auth-error" id="ycf-login-error" hidden role="alert"></div>';
    h +=     '<button type="submit" class="yb-auth-submit" id="ycf-login-btn" data-yj-da>Log ind</button>';
    h +=     '<button type="submit" class="yb-auth-submit" id="ycf-login-btn-en" data-yj-en hidden>Sign in</button>';
    h +=   '</form>';

    h +=   '<div class="yb-auth-links">';
    h +=     '<a href="#" data-ycf-action="forgot" data-yj-da>Glemt adgangskode?</a>';
    h +=     '<a href="#" data-ycf-action="forgot" data-yj-en hidden>Forgot password?</a>';
    h +=   '</div>';
    h +=   '<div class="yb-auth-divider">';
    h +=     '<span data-yj-da>Har du ikke en konto?</span>';
    h +=     '<span data-yj-en hidden>Don\'t have an account?</span>';
    h +=     '<a href="#" data-ycf-action="register" data-yj-da>Opret profil</a>';
    h +=     '<a href="#" data-ycf-action="register" data-yj-en hidden>Create profile</a>';
    h +=   '</div>';
    h += '</div>'; // end step-login

    // ═══════════════════════════════════════════════════════════════
    // STEP 1b — FORGOT PASSWORD
    // ═══════════════════════════════════════════════════════════════
    h += '<div class="ycf-step" id="ycf-step-forgot" data-ycf-step="1" hidden>';
    h +=   '<div class="yb-auth-modal__header">';
    h +=     '<h2 class="yb-auth-modal__title" data-yj-da>Nulstil adgangskode</h2>';
    h +=     '<h2 class="yb-auth-modal__title" data-yj-en hidden>Reset password</h2>';
    h +=     '<p class="yb-auth-modal__subtitle" data-yj-da>Indtast din email, s\u00e5 sender vi dig et link</p>';
    h +=     '<p class="yb-auth-modal__subtitle" data-yj-en hidden>Enter your email and we\'ll send you a reset link</p>';
    h +=   '</div>';
    h +=   '<form id="ycf-forgot-form" class="yb-auth-form" novalidate>';
    h +=     '<div class="yb-auth-field">';
    h +=       '<label for="ycf-forgot-email" data-yj-da>Email</label>';
    h +=       '<label for="ycf-forgot-email" data-yj-en hidden>Email</label>';
    h +=       '<input type="email" id="ycf-forgot-email" required autocomplete="email" placeholder="din@email.dk">';
    h +=     '</div>';
    h +=     '<div class="yb-auth-error" id="ycf-forgot-error" hidden role="alert"></div>';
    h +=     '<div class="yb-auth-success" id="ycf-forgot-success" hidden role="status"></div>';
    h +=     '<button type="submit" class="yb-auth-submit" data-yj-da>Send nulstillingslink</button>';
    h +=     '<button type="submit" class="yb-auth-submit" data-yj-en hidden>Send reset link</button>';
    h +=   '</form>';
    h +=   '<div class="yb-auth-divider">';
    h +=     '<a href="#" data-ycf-action="back-login" data-yj-da>&larr; Tilbage til log ind</a>';
    h +=     '<a href="#" data-ycf-action="back-login" data-yj-en hidden>&larr; Back to sign in</a>';
    h +=   '</div>';
    h += '</div>'; // end step-forgot

    // ═══════════════════════════════════════════════════════════════
    // STEP 2 — REGISTER
    // ═══════════════════════════════════════════════════════════════
    h += '<div class="ycf-step" id="ycf-step-register" data-ycf-step="2" hidden>';
    h +=   '<a href="#" class="ycf-back" data-ycf-action="back-login">';
    h +=     '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>';
    h +=     '<span data-yj-da>Tilbage</span>';
    h +=     '<span data-yj-en hidden>Back</span>';
    h +=   '</a>';
    h +=   '<div class="yb-auth-modal__header">';
    h +=     '<h2 class="yb-auth-modal__title" data-yj-da>Opret din profil</h2>';
    h +=     '<h2 class="yb-auth-modal__title" data-yj-en hidden>Create your profile</h2>';
    h +=     '<p class="yb-auth-modal__subtitle" data-yj-da>Det tager kun et minut</p>';
    h +=     '<p class="yb-auth-modal__subtitle" data-yj-en hidden>It only takes a minute</p>';
    h +=   '</div>';

    h +=   '<form id="ycf-register-form" class="yb-auth-form" novalidate>';
    h +=     '<div class="yb-auth-row">';
    h +=       '<div class="yb-auth-field">';
    h +=         '<label for="ycf-reg-firstname" data-yj-da>Fornavn</label>';
    h +=         '<label for="ycf-reg-firstname" data-yj-en hidden>First name</label>';
    h +=         '<input type="text" id="ycf-reg-firstname" required autocomplete="given-name" placeholder="Fornavn">';
    h +=       '</div>';
    h +=       '<div class="yb-auth-field">';
    h +=         '<label for="ycf-reg-lastname" data-yj-da>Efternavn</label>';
    h +=         '<label for="ycf-reg-lastname" data-yj-en hidden>Last name</label>';
    h +=         '<input type="text" id="ycf-reg-lastname" required autocomplete="family-name" placeholder="Efternavn">';
    h +=       '</div>';
    h +=     '</div>';
    h +=     '<div class="yb-auth-field">';
    h +=       '<label for="ycf-reg-email" data-yj-da>Email</label>';
    h +=       '<label for="ycf-reg-email" data-yj-en hidden>Email</label>';
    h +=       '<input type="email" id="ycf-reg-email" required autocomplete="email" placeholder="din@email.dk">';
    h +=     '</div>';
    h +=     '<div class="yb-auth-field">';
    h +=       '<label for="ycf-reg-phone" data-yj-da>Telefon</label>';
    h +=       '<label for="ycf-reg-phone" data-yj-en hidden>Phone</label>';
    h +=       '<input type="tel" id="ycf-reg-phone" autocomplete="tel" placeholder="+45 12 34 56 78">';
    h +=     '</div>';
    h +=     '<div class="yb-auth-field">';
    h +=       '<label for="ycf-reg-password" data-yj-da>Adgangskode</label>';
    h +=       '<label for="ycf-reg-password" data-yj-en hidden>Password</label>';
    h +=       '<input type="password" id="ycf-reg-password" required autocomplete="new-password" placeholder="Mindst 6 tegn">';
    h +=     '</div>';

    // Consent checkboxes — links point to profile subdomain
    h +=     '<div class="yb-auth-consent">';
    h +=       '<label class="yb-auth-consent__item">';
    h +=         '<input type="checkbox" id="ycf-reg-terms" required>';
    h +=         '<span data-yj-da>Jeg accepterer <a href="' + TERMS_BASE + '/terms-conditions/" target="_blank" rel="noopener">Handelsbetingelser</a> og <a href="' + TERMS_BASE + '/privacy-policy/" target="_blank" rel="noopener">Privatlivspolitik</a></span>';
    h +=         '<span data-yj-en hidden>I agree to the <a href="' + TERMS_BASE + '/en/terms-conditions/" target="_blank" rel="noopener">Terms &amp; Conditions</a> and <a href="' + TERMS_BASE + '/en/privacy-policy/" target="_blank" rel="noopener">Privacy Policy</a></span>';
    h +=       '</label>';
    h +=       '<label class="yb-auth-consent__item">';
    h +=         '<input type="checkbox" id="ycf-reg-conduct" required>';
    h +=         '<span data-yj-da>Jeg accepterer <a href="' + TERMS_BASE + '/code-of-conduct/" target="_blank" rel="noopener">Code of Conduct</a></span>';
    h +=         '<span data-yj-en hidden>I agree to the <a href="' + TERMS_BASE + '/en/code-of-conduct/" target="_blank" rel="noopener">Code of Conduct</a></span>';
    h +=       '</label>';
    h +=     '</div>';

    h +=     '<div class="yb-auth-error" id="ycf-register-error" hidden role="alert"></div>';
    h +=     '<button type="submit" class="yb-auth-submit" data-yj-da>Opret profil &amp; forts\u00e6t</button>';
    h +=     '<button type="submit" class="yb-auth-submit" data-yj-en hidden>Create profile &amp; continue</button>';
    h +=   '</form>';

    h +=   '<div class="yb-auth-divider">';
    h +=     '<span data-yj-da>Har du allerede en konto?</span>';
    h +=     '<span data-yj-en hidden>Already have an account?</span>';
    h +=     '<a href="#" data-ycf-action="back-login" data-yj-da>Log ind</a>';
    h +=     '<a href="#" data-ycf-action="back-login" data-yj-en hidden>Sign in</a>';
    h +=   '</div>';
    h += '</div>'; // end step-register

    // ═══════════════════════════════════════════════════════════════
    // STEP 3 — CHECKOUT (payment form)
    // ═══════════════════════════════════════════════════════════════
    h += '<div class="ycf-step" id="ycf-step-checkout" data-ycf-step="3" hidden>';
    h +=   '<a href="#" class="ycf-back" data-ycf-action="back-auth" id="ycf-back-from-checkout">';
    h +=     '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>';
    h +=     '<span data-yj-da>Tilbage</span>';
    h +=     '<span data-yj-en hidden>Back</span>';
    h +=   '</a>';
    h +=   '<div class="yb-auth-modal__header">';
    h +=     '<h2 class="yb-auth-modal__title" data-yj-da>Gennemf\u00f8r k\u00f8b</h2>';
    h +=     '<h2 class="yb-auth-modal__title" data-yj-en hidden>Complete purchase</h2>';
    h +=   '</div>';

    // Product breakdown card
    h +=   '<div class="ycf-product" id="ycf-product-info">';
    h +=     '<div class="ycf-product__header">';
    h +=       '<span class="ycf-product__name" id="ycf-prod-name"></span>';
    h +=       '<span class="ycf-product__price" id="ycf-prod-price"></span>';
    h +=     '</div>';
    h +=     '<div class="ycf-product__chips" id="ycf-prod-chips"></div>';
    h +=     '<p class="ycf-product__desc" id="ycf-prod-desc"></p>';
    h +=     '<div class="ycf-product__note" id="ycf-prod-note" hidden>';
    h +=       '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>';
    h +=       '<span id="ycf-prod-note-text"></span>';
    h +=     '</div>';
    h +=   '</div>';

    // Payment form
    h +=   '<form id="ycf-checkout-form" class="yb-auth-form" novalidate>';
    h +=     '<div class="yb-checkout-divider">';
    h +=       '<span data-yj-da>Betalingsoplysninger</span>';
    h +=       '<span data-yj-en hidden>Payment details</span>';
    h +=     '</div>';

    // Stored card section (hidden by default)
    h +=     '<div id="ycf-stored-card-section" class="ycf-payment-methods" hidden>';
    h +=       '<label class="ycf-payment-option ycf-payment-option--active" id="ycf-opt-stored">';
    h +=         '<input type="radio" name="ycf-payment-method" value="stored" checked>';
    h +=         '<div class="ycf-payment-option__info">';
    h +=           '<span class="ycf-payment-option__label" data-yj-da>Brug gemt kort</span>';
    h +=           '<span class="ycf-payment-option__label" data-yj-en hidden>Use saved card</span>';
    h +=           '<span class="ycf-payment-option__card" id="ycf-stored-card-info"></span>';
    h +=         '</div>';
    h +=       '</label>';
    h +=       '<label class="ycf-payment-option" id="ycf-opt-new">';
    h +=         '<input type="radio" name="ycf-payment-method" value="new">';
    h +=         '<span class="ycf-payment-option__label" data-yj-da>Brug nyt kort</span>';
    h +=         '<span class="ycf-payment-option__label" data-yj-en hidden>Use new card</span>';
    h +=       '</label>';
    h +=     '</div>';

    // New card fields
    h +=     '<div id="ycf-new-card-fields">';
    h +=       '<div class="yb-auth-field">';
    h +=         '<label for="ycf-card" data-yj-da>Kortnummer *</label>';
    h +=         '<label for="ycf-card" data-yj-en hidden>Card number *</label>';
    h +=         '<input type="text" id="ycf-card" autocomplete="cc-number" inputmode="numeric" placeholder="1234 5678 9012 3456" maxlength="19">';
    h +=       '</div>';
    h +=       '<div class="yb-checkout-row">';
    h +=         '<div class="yb-auth-field">';
    h +=           '<label for="ycf-expiry" data-yj-da>Udl\u00f8b *</label>';
    h +=           '<label for="ycf-expiry" data-yj-en hidden>Expiry *</label>';
    h +=           '<input type="text" id="ycf-expiry" autocomplete="cc-exp" inputmode="numeric" placeholder="MM/\u00c5\u00c5" maxlength="5">';
    h +=         '</div>';
    h +=         '<div class="yb-auth-field">';
    h +=           '<label for="ycf-cvv">CVV *</label>';
    h +=           '<input type="text" id="ycf-cvv" autocomplete="cc-csc" inputmode="numeric" placeholder="123" maxlength="4">';
    h +=         '</div>';
    h +=       '</div>';
    h +=     '</div>';

    h +=     '<div class="yb-auth-error" id="ycf-checkout-error" hidden role="alert"></div>';
    h +=     '<button type="submit" class="yb-auth-submit" id="ycf-pay-btn" data-yj-da>Betal</button>';
    h +=     '<button type="submit" class="yb-auth-submit" id="ycf-pay-btn-en" data-yj-en hidden>Pay</button>';
    h +=     '<p class="yb-checkout-secure">';
    h +=       '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
    h +=       '<span data-yj-da>Sikker betaling via Mindbody</span>';
    h +=       '<span data-yj-en hidden>Secure payment via Mindbody</span>';
    h +=     '</p>';
    h +=   '</form>';
    h += '</div>'; // end step-checkout

    // ═══════════════════════════════════════════════════════════════
    // STEP 4 — SUCCESS
    // ═══════════════════════════════════════════════════════════════
    h += '<div class="ycf-step" id="ycf-step-success" data-ycf-step="3" hidden>';
    h +=   '<div class="yb-checkout-success__inner">';
    h +=     '<div class="yb-checkout-success__icon">&#10003;</div>';
    h +=     '<h2 class="yb-auth-modal__title" data-yj-da>Betaling gennemf\u00f8rt!</h2>';
    h +=     '<h2 class="yb-auth-modal__title" data-yj-en hidden>Payment successful!</h2>';
    h +=     '<p class="yb-auth-modal__subtitle" data-yj-da>Du modtager en bekr\u00e6ftelse p\u00e5 email. N\u00e6ste skridt: underskriv din ansvarsfraskrivelse.</p>';
    h +=     '<p class="yb-auth-modal__subtitle" data-yj-en hidden>You\'ll receive a confirmation email. Next step: sign your liability waiver.</p>';
    h +=     '<button class="yb-auth-submit" type="button" id="ycf-go-profile" data-yj-da>G\u00e5 til din profil</button>';
    h +=     '<button class="yb-auth-submit" type="button" id="ycf-go-profile-en" data-yj-en hidden>Go to your profile</button>';
    h +=   '</div>';
    h += '</div>'; // end step-success

    // Close modal shell
    h +=   '</div>'; // .yb-auth-modal__box
    h += '</div>';   // #ycf-modal

    var container = document.createElement('div');
    container.innerHTML = h;
    document.body.appendChild(container.firstChild);
  }

  // ── 3D: Modal open / close ──────────────────────────────────────────

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

  // ── 3E: Step navigation ─────────────────────────────────────────────

  function showStep(stepId) {
    if (!modal) return;
    var steps = modal.querySelectorAll('.ycf-step');
    for (var i = 0; i < steps.length; i++) steps[i].hidden = true;

    var target = $(stepId);
    if (!target) return;
    target.hidden = false;

    // Update step dots
    var stepNum = parseInt(target.getAttribute('data-ycf-step')) || 1;
    currentStep = stepNum;
    var dots = modal.querySelectorAll('.ycf-steps__dot');
    for (var d = 0; d < dots.length; d++) {
      var dotStep = parseInt(dots[d].getAttribute('data-ycf-step-dot')) || 0;
      if (dotStep <= stepNum) dots[d].classList.add('ycf-steps__dot--active');
      else dots[d].classList.remove('ycf-steps__dot--active');
    }

    // Focus first input after transition
    setTimeout(function () {
      var firstInput = target.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])');
      if (firstInput && !firstInput.closest('[hidden]')) firstInput.focus();
    }, 80);
  }

  // ── 3F: Populate product info on badge + checkout card ──────────────

  function populateProduct(prodId) {
    var p = getProduct(prodId);
    if (!p) return;

    var name = isDa ? p.name_da : p.name_en;
    var price = p.price.toLocaleString('da-DK') + ' DKK';

    // Badge (login step)
    var badgeName = $('ycf-badge-name');
    var badgePrice = $('ycf-badge-price');
    var badgeCohort = $('ycf-badge-cohort');
    if (badgeName) badgeName.textContent = name;
    if (badgePrice) badgePrice.textContent = price;

    // Cohort line: label + validity + classes
    if (badgeCohort) {
      var parts = [];
      var label = isDa ? p.label_da : p.label_en;
      if (label) parts.push(label);
      if (p.validity) parts.push(p.validity);
      if (p.classes) parts.push(p.classes + t(' klasser', ' classes'));
      badgeCohort.textContent = parts.join(' \u00b7 ');
      badgeCohort.hidden = parts.length === 0;
    }

    // Checkout step product card
    var prodName  = $('ycf-prod-name');
    var prodPrice = $('ycf-prod-price');
    var prodDesc  = $('ycf-prod-desc');
    var prodChips = $('ycf-prod-chips');
    var prodNote  = $('ycf-prod-note');

    if (prodName) prodName.textContent = name;
    if (prodPrice) prodPrice.textContent = price;
    if (prodDesc) prodDesc.textContent = (isDa ? p.desc_da : p.desc_en) || '';

    // Chips: validity + classes
    if (prodChips) {
      var chips = '';
      if (p.validity) {
        chips += '<span class="ycf-chip">' + p.validity + '</span>';
      }
      if (p.classes) {
        chips += '<span class="ycf-chip">' + p.classes + t(' klasser', ' classes') + '</span>';
      }
      prodChips.innerHTML = chips;
    }

    // No remaining-payment note for service-type products (Phase 1)
    if (prodNote) prodNote.hidden = true;
  }

  // ── 3G: Firebase Auth Functions ─────────────────────────────────────

  function doLogin(email, password, callback) {
    firebase.auth().signInWithEmailAndPassword(email, password)
      .then(function () { callback(null); })
      .catch(function (err) { callback(err); });
  }

  function doRegister(email, password, firstName, lastName, phone, callback) {
    firebase.auth().createUserWithEmailAndPassword(email, password)
      .then(function (cred) {
        var fullName = firstName + ' ' + lastName;
        // Store registration data for Firestore profile creation
        window._ybRegistration = {
          firstName: firstName,
          lastName: lastName,
          phone: phone,
          consents: {
            termsAndConditions: { accepted: true, timestamp: new Date().toISOString(), version: '2026-02-09' },
            privacyPolicy:     { accepted: true, timestamp: new Date().toISOString(), version: '2026-02-09' },
            codeOfConduct:     { accepted: true, timestamp: new Date().toISOString(), version: '2026-02-09' }
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

  function authErrorMsg(err) {
    var code = err.code || '';
    if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
      return t('Forkert email eller adgangskode.', 'Incorrect email or password.');
    }
    if (code === 'auth/email-already-in-use') {
      return t('Denne email er allerede i brug.', 'This email is already in use.');
    }
    if (code === 'auth/weak-password') {
      return t('Adgangskoden skal v\u00e6re mindst 6 tegn.', 'Password must be at least 6 characters.');
    }
    if (code === 'auth/invalid-email') {
      return t('Ugyldig email-adresse.', 'Invalid email address.');
    }
    if (code === 'auth/too-many-requests') {
      return t('For mange fors\u00f8g. Pr\u00f8v igen senere.', 'Too many attempts. Please try again later.');
    }
    return err.message || t('Der opstod en fejl.', 'An error occurred.');
  }

  // ── 3H: Mindbody Client — find/create + stored card ─────────────────

  function findOrCreateClient(firstName, lastName, email, phone) {
    return fetch(API_BASE + '/mb-client?email=' + encodeURIComponent(email))
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.found && data.client) return data.client.id;
        // No existing client — create one (triggers MB welcome email)
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

  function renderStoredCardUI(card) {
    var section = $('ycf-stored-card-section');
    var newCardFields = $('ycf-new-card-fields');
    var cardInfo = $('ycf-stored-card-info');
    if (!section || !newCardFields) return;

    if (card && card.lastFour) {
      storedCard = card;
      var cardLabel = (card.cardType || 'Card') + ' \u2022\u2022\u2022\u2022 ' + card.lastFour;
      if (card.expMonth && card.expYear) {
        cardLabel += ' (' + card.expMonth + '/' + String(card.expYear).slice(-2) + ')';
      }
      if (cardInfo) cardInfo.textContent = cardLabel;
      section.hidden = false;
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
    var opts = section.querySelectorAll('.ycf-payment-option');
    for (var i = 0; i < opts.length; i++) {
      var radio = opts[i].querySelector('input[type="radio"]');
      if (radio && radio.checked) opts[i].classList.add('ycf-payment-option--active');
      else opts[i].classList.remove('ycf-payment-option--active');
    }
  }

  // ── 3I: Post-auth — resolve MB client → advance to checkout ─────────

  function resolveClientAndAdvance(firstName, lastName, email, phone) {
    console.log('[HYC Embed] Resolving MB client for:', email);

    findOrCreateClient(firstName, lastName, email, phone)
      .then(function (clientId) {
        mbClientId = clientId;
        console.log('[HYC Embed] MB client resolved:', clientId);

        // Non-blocking: check for stored card, update UI when ready
        fetchStoredCard(clientId).then(function (card) {
          renderStoredCardUI(card);
          console.log('[HYC Embed] Stored card:', card ? ('\u2022\u2022\u2022\u2022 ' + card.lastFour) : 'none');
        });

        showStep('ycf-step-checkout');
      })
      .catch(function (err) {
        console.warn('[HYC Embed] MB client error:', err.message);
        // Still advance — payment step will retry
        showStep('ycf-step-checkout');
      });
  }

  // ── 3J: Entry point — open the checkout flow ────────────────────────

  function openCheckoutFlow(prodId) {
    if (!prodId) return;
    currentProdId = String(prodId);
    mbClientId = null;
    storedCard = null;

    modal = $('ycf-modal');
    if (!modal) return;

    // Reset all forms
    var inputs = modal.querySelectorAll('input');
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i].type === 'checkbox') inputs[i].checked = false;
      else if (inputs[i].type === 'radio') { /* handled by renderStoredCardUI */ }
      else if (inputs[i].type !== 'hidden') inputs[i].value = '';
    }
    var errorEls = modal.querySelectorAll('.yb-auth-error, .yb-auth-success');
    for (var e = 0; e < errorEls.length; e++) { errorEls[e].textContent = ''; errorEls[e].hidden = true; }

    // Reset stored card UI
    renderStoredCardUI(null);

    // Populate product info
    populateProduct(currentProdId);

    // Check if already logged in
    var user = null;
    try { user = firebase.auth().currentUser; } catch (ex) { /* not ready */ }

    var backFromCheckout = $('ycf-back-from-checkout');

    if (user) {
      cameFromLoggedIn = true;
      authOriginStep = null;
      if (backFromCheckout) backFromCheckout.hidden = true;

      openModal();
      showStep('ycf-step-checkout');

      var displayName = user.displayName || '';
      var nameParts = displayName.split(' ');
      resolveClientAndAdvance(
        nameParts[0] || 'User',
        nameParts.slice(1).join(' ') || '',
        user.email || '',
        ''
      );
    } else {
      cameFromLoggedIn = false;
      if (backFromCheckout) backFromCheckout.hidden = false;
      showStep('ycf-step-login');
      openModal();
    }
  }

  // ── 3K: Wire up event handlers (auth forms, navigation) ────────────

  function wireAuthEvents() {
    // ── Close handlers ─────────────────────────────────────────────
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

    // ── Action links (register, forgot, back-login, back-auth) ────
    document.addEventListener('click', function (e) {
      var el = e.target.closest('[data-ycf-action]');
      if (!el) return;
      e.preventDefault();
      var action = el.getAttribute('data-ycf-action');
      if (action === 'register') showStep('ycf-step-register');
      if (action === 'forgot')   showStep('ycf-step-forgot');
      if (action === 'back-login') showStep('ycf-step-login');
      if (action === 'back-auth') {
        if (authOriginStep === 'register') showStep('ycf-step-register');
        else showStep('ycf-step-login');
      }
    });

    // ── Payment method radio toggle ───────────────────────────────
    document.addEventListener('change', function (e) {
      if (e.target.name !== 'ycf-payment-method') return;
      var newCardFields = $('ycf-new-card-fields');
      if (newCardFields) newCardFields.hidden = (e.target.value === 'stored');
      updatePaymentOptionStyles();
    });

    // ── Login form ────────────────────────────────────────────────
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
        if (btn) { btn.disabled = true; btn.textContent = t('Logger ind...', 'Signing in...'); }

        doLogin(email, password, function (err) {
          if (btn) { btn.disabled = false; btn.textContent = t('Log ind', 'Sign in'); }

          if (err) {
            showError('ycf-login-error', authErrorMsg(err));
            return;
          }

          authOriginStep = 'login';
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

    // ── Forgot password form ──────────────────────────────────────
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

    // ── Register form ─────────────────────────────────────────────
    var registerForm = $('ycf-register-form');
    if (registerForm) {
      registerForm.addEventListener('submit', function (e) {
        e.preventDefault();
        hideError('ycf-register-error');

        var firstName = $('ycf-reg-firstname').value.trim();
        var lastName  = $('ycf-reg-lastname').value.trim();
        var email     = $('ycf-reg-email').value.trim();
        var phone     = $('ycf-reg-phone').value.trim();
        var password  = $('ycf-reg-password').value;
        var terms     = $('ycf-reg-terms').checked;
        var conduct   = $('ycf-reg-conduct').checked;

        if (!firstName || !lastName || !email || !password) {
          showError('ycf-register-error', t('Udfyld alle obligatoriske felter.', 'Please fill in all required fields.'));
          return;
        }
        if (password.length < 6) {
          showError('ycf-register-error', t('Adgangskoden skal v\u00e6re mindst 6 tegn.', 'Password must be at least 6 characters.'));
          return;
        }
        if (!terms || !conduct) {
          showError('ycf-register-error', t('Du skal acceptere betingelserne.', 'You must accept the terms.'));
          return;
        }

        var btn = registerForm.querySelector('.yb-auth-submit');
        if (btn) { btn.disabled = true; btn.textContent = t('Opretter profil...', 'Creating profile...'); }

        doRegister(email, password, firstName, lastName, phone, function (err) {
          if (btn) { btn.disabled = false; btn.textContent = t('Opret profil & forts\u00e6t', 'Create profile & continue'); }

          if (err) {
            showError('ycf-register-error', authErrorMsg(err));
            return;
          }

          // Create MB client immediately (triggers welcome email) → checkout
          authOriginStep = 'register';
          resolveClientAndAdvance(firstName, lastName, email, phone);
        });
      });
    }
  }

  // ── Part 4: Payment Processing + Card Formatting + Public API ───────

  // ── 4A: Process payment ─────────────────────────────────────────────
  // Collects card details (or stored-card flag), calls mb-checkout,
  // handles SCA redirect, shows success or error.

  function processPayment() {
    var user;
    try { user = firebase.auth().currentUser; } catch (ex) { /* noop */ }
    if (!user) {
      showError('ycf-checkout-error', t('Du skal v\u00e6re logget ind.', 'You must be signed in.'));
      return;
    }

    var product = getProduct(currentProdId);
    if (!product) {
      showError('ycf-checkout-error', t('Ukendt produkt.', 'Unknown product.'));
      return;
    }

    hideError('ycf-checkout-error');

    // ── Determine payment method ──────────────────────────────────
    var storedRadio = modal ? modal.querySelector('input[name="ycf-payment-method"][value="stored"]') : null;
    var useStored = storedRadio && storedRadio.checked && storedCard && storedCard.lastFour;

    var paymentInfo;

    if (useStored) {
      paymentInfo = {
        useStoredCard: true,
        lastFour: storedCard.lastFour
      };
    } else {
      var cardEl    = $('ycf-card');
      var expiryEl  = $('ycf-expiry');
      var cvvEl     = $('ycf-cvv');
      var cardNumber = cardEl ? cardEl.value.replace(/\s/g, '') : '';
      var expiry     = expiryEl ? expiryEl.value.trim() : '';
      var cvv        = cvvEl ? cvvEl.value.trim() : '';

      if (!cardNumber || !expiry || !cvv) {
        showError('ycf-checkout-error', t('Udfyld alle obligatoriske felter.', 'Please fill in all required fields.'));
        return;
      }

      var expiryParts = expiry.split('/');
      if (expiryParts.length !== 2) {
        showError('ycf-checkout-error', t('Ugyldig udl\u00f8bsdato (MM/\u00c5\u00c5).', 'Invalid expiry date (MM/YY).'));
        return;
      }
      var expMonth = expiryParts[0].trim();
      var expYear  = expiryParts[1].trim();
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

    // ── Disable pay buttons ───────────────────────────────────────
    var payBtn   = $('ycf-pay-btn');
    var payBtnEn = $('ycf-pay-btn-en');
    if (payBtn)   { payBtn.disabled = true;   payBtn.textContent = 'Behandler betaling...'; }
    if (payBtnEn) { payBtnEn.disabled = true; payBtnEn.textContent = 'Processing payment...'; }

    function resetPayBtn() {
      if (payBtn)   { payBtn.disabled = false;   payBtn.textContent = 'Betal'; }
      if (payBtnEn) { payBtnEn.disabled = false; payBtnEn.textContent = 'Pay'; }
    }

    // ── Resolve MB client if needed ───────────────────────────────
    var clientPromise;
    if (mbClientId) {
      clientPromise = Promise.resolve(mbClientId);
    } else {
      var displayName = user.displayName || '';
      var nameParts = displayName.split(' ');
      var firstName = nameParts[0] || 'User';
      var lastName  = nameParts.slice(1).join(' ') || '';
      var phone     = (window._ybRegistration && window._ybRegistration.phone) || '';
      clientPromise = findOrCreateClient(firstName, lastName, user.email || '', phone);
    }

    // ── Send payment to mb-checkout ───────────────────────────────
    var realProdId = getRealProdId(currentProdId);

    clientPromise
      .then(function (clientId) {
        mbClientId = clientId;
        return fetch(API_BASE + '/mb-checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: clientId,
            items: [{ type: 'Service', id: parseInt(realProdId), quantity: 1 }],
            amount: product.price,
            payment: paymentInfo,
            test: false
          })
        });
      })
      .then(function (res) { return res.json(); })
      .then(function (result) {
        if (result.error) throw new Error(result.error);

        // ── SCA / 3D Secure redirect ──────────────────────────────
        if (result.requiresSCA) {
          window.location.href = result.authenticationUrl;
          return;
        }

        // ── Success ───────────────────────────────────────────────
        console.log('[HYC Embed] Payment successful for prodId:', currentProdId);
        showStep('ycf-step-success');
      })
      .catch(function (err) {
        console.warn('[HYC Embed] Payment error:', err.message);
        showError('ycf-checkout-error', err.message || t('Betaling fejlede. Pr\u00f8v igen.', 'Payment failed. Please try again.'));
        resetPayBtn();
      });
  }

  // ── 4B: Card input formatting ───────────────────────────────────────
  // Auto-space card numbers (4-4-4-4) and auto-slash expiry (MM/YY).

  function wireCardFormatting() {
    var cardInput = $('ycf-card');
    if (cardInput) {
      cardInput.addEventListener('input', function () {
        var v = cardInput.value.replace(/\s/g, '').replace(/\D/g, '');
        cardInput.value = v.replace(/(.{4})/g, '$1 ').trim();
      });
    }

    var expiryInput = $('ycf-expiry');
    if (expiryInput) {
      expiryInput.addEventListener('input', function () {
        var v = expiryInput.value.replace(/\D/g, '');
        if (v.length >= 2) v = v.slice(0, 2) + '/' + v.slice(2);
        expiryInput.value = v.slice(0, 5);
      });
    }
  }

  // ── 4C: Wire checkout form + success redirect ───────────────────────

  function wireCheckoutEvents() {
    // ── Checkout form submission ───────────────────────────────────
    var checkoutForm = $('ycf-checkout-form');
    if (checkoutForm) {
      checkoutForm.addEventListener('submit', function (e) {
        e.preventDefault();
        processPayment();
      });
    }

    // ── "Go to profile" buttons on success step ───────────────────
    document.addEventListener('click', function (e) {
      if (e.target.id === 'ycf-go-profile' || e.target.id === 'ycf-go-profile-en') {
        e.preventDefault();
        closeModal();
        window.location.href = PROFILE_URL + '/profile#passes';
      }
    });
  }

  // ── 4D: Public entry point for external pages ───────────────────────
  // Framer CTA buttons call: startCheckoutEmbed('100174')
  // or use: <button data-checkout-product="100174">Buy</button>
  //
  // This is the HYC equivalent of startCheckoutFunnel() from ytt-funnel.js.
  // It saves funnel data to sessionStorage, then opens the checkout flow.

  var FUNNEL_KEY = 'hyc_checkout_funnel';

  function saveFunnel(data) {
    try { sessionStorage.setItem(FUNNEL_KEY, JSON.stringify(data)); } catch (e) { /* private browsing */ }
  }

  function loadFunnel() {
    try {
      var raw = sessionStorage.getItem(FUNNEL_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function clearFunnel() {
    try { sessionStorage.removeItem(FUNNEL_KEY); } catch (e) { /* noop */ }
  }

  function startCheckoutEmbed(prodId) {
    if (!prodId) return;
    prodId = String(prodId);

    // Save funnel data for analytics / resumption
    var funnelData = {
      prodId: prodId,
      sourcePage: window.location.pathname,
      sessionId: 'hyc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
      startedAt: new Date().toISOString()
    };
    saveFunnel(funnelData);

    console.log('[HYC Embed] Checkout started for prodId:', prodId);

    // Open the checkout flow modal
    openCheckoutFlow(prodId);
  }

  // ── Part 5 continues: CTA binding, boot sequence, IIFE close ───────

  // (IIFE intentionally left open — closed in Part 5)
