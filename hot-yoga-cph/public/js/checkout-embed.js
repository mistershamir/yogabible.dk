// =====================================================================
// HOT YOGA COPENHAGEN — Checkout Embed (self-contained)
// Single <script> for embedding on hotyogacph.dk (Framer site).
// Bundles: Firebase SDK loader · CSS · Modal HTML · Auth · Payment logic
// Brand: #3f99a5 (HYC teal)
// API:   https://profile.hotyogacph.dk/.netlify/functions
// All daily products: services (clips, time-based, trials, tourist)
// + memberships (contracts). Includes lead funnel tracking (Firestore + GA).
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
  var FIREBASE_VER = '12.10.0';
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
  // Auto-detect: check Framer's html[lang], URL path /en/, or default to Danish
  var isDa = (function () {
    var htmlLang = (document.documentElement.lang || '').toLowerCase();
    if (htmlLang === 'en' || htmlLang.indexOf('en-') === 0) return false;
    if (window.location.pathname.indexOf('/en/') === 0 || window.location.pathname.indexOf('/en') === 0) return false;
    return true;
  })();
  function t(da, en) { return isDa ? da : en; }

  // Switch language at runtime — toggles all data-yj-da/en elements + re-renders product
  function switchLanguage(toLang) {
    isDa = toLang === 'da';
    // Update CSS rules for bilingual attributes
    var langStyle = document.getElementById('hyc-lang-override');
    if (!langStyle) {
      langStyle = document.createElement('style');
      langStyle.id = 'hyc-lang-override';
      document.head.appendChild(langStyle);
    }
    if (isDa) {
      langStyle.textContent = '[data-yj-da]{display:revert !important}[data-yj-en]{display:none !important}';
    } else {
      langStyle.textContent = '[data-yj-da]{display:none !important}[data-yj-en]{display:revert !important}';
    }
    // Update toggle button active state
    var btnDa = document.getElementById('ycf-lang-da');
    var btnEn = document.getElementById('ycf-lang-en');
    if (btnDa) btnDa.classList.toggle('ycf-lang__btn--active', isDa);
    if (btnEn) btnEn.classList.toggle('ycf-lang__btn--active', !isDa);
    // Re-render dynamic product content if a product is loaded
    if (currentProdId) populateProduct(currentProdId);
  }

  // ── Product Catalog ─────────────────────────────────────────────────
  // All daily products: clips, time-based, trials, tourist (service type)
  // + memberships (contract type — uses mb-contracts API).
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
    '100174': { price: 299,   name_da: '1 Klasse Klippekort',   name_en: '1 Class Clip Card',   label_da: 'Prøv En',          label_en: 'Try One',          validity: '10 dage',  classes: 1,  desc_da: 'Prøv en enkelt klasse — gyldig i 10 dage fra køb. Ingen binding.', desc_en: 'Try a single class — valid for 10 days from purchase. No commitment.' },
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
    '100017': { price: 275,   name_da: '1 Klasse Klippekort',   name_en: '1 Class Clip Card',   label_da: 'Prøv En',          label_en: 'Try One',          validity: '10 dage',  classes: 1,  desc_da: 'Prøv en enkelt klasse — gyldig i 10 dage fra køb. Ingen binding.', desc_en: 'Try a single class — valid for 10 days from purchase. No commitment.' },
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
    // KickStarter under30 has its own prodId 100153:
    '100153':       { price: 475,  name_da: 'KickStarter',  name_en: 'KickStarter',  validity: '3 uger', classes: 10, desc_da: 'Kun for Københavns-beboere. 10 klasser inden for 3 uger.', desc_en: 'Copenhagen residents only. 10 classes within 3 weeks.' },

    // ── Tourist · Over 30 ───────────────────────────────────────────
    // Single-class tourist reuses clip prodId 100174 (already in catalog).
    '100199': { price: 895, name_da: '7 Dage Tourist Pas',  name_en: '7 Days Tourist Pass',  validity: '7 dage', desc_da: 'Ubegrænset adgang inkl. måtte + håndklæder.', desc_en: 'Unlimited access incl. mat + towels.' },

    // ── Tourist · Under 30 ──────────────────────────────────────────
    // Single-class & 2-class tourist reuse clip prodIds (100017, 100016).
    '100051': { price: 750, name_da: '7 Dage Tourist Pas',  name_en: '7 Days Tourist Pass',  validity: '7 dage', desc_da: 'Ubegrænset adgang inkl. måtte + håndklæder.', desc_en: 'Unlimited access incl. mat + towels.' },

    // ── Memberships · Over 30 (contract type) ────────────────────────
    // Monthly autopay memberships — purchased via mb-contracts API.
    // firstMonthFree: only regFee is charged initially.
    '101':  { price: 999,  _itemType: 'contract', regFee: 299, firstMonthFree: true, name_da: '10 Klasser / Måned', name_en: '10 Classes / Month', desc_da: 'Ideel til moderat praksis – ca. 1-3 gange om ugen.', desc_en: 'Ideal for moderate practice – about 1-3 times per week.', features_da: ['Adgang til alle klassetyper og tider', 'Wellness-fordele inkl.', 'Book op til 21 dage frem'], features_en: ['Access to all class types and times', 'Wellness perks included', 'Book up to 21 days ahead'], terms_da: ['Første måned gratis', 'Engangs-registreringsgebyr: 299 kr', 'Løbende månedligt – opsig eller pause når som helst'], terms_en: ['First month free', 'One-time registration fee: 299 DKK', 'Month-to-month – cancel or pause anytime'] },
    '102':  { price: 1249, _itemType: 'contract', regFee: 299, firstMonthFree: true, name_da: 'Ubegrænset / Måned', name_en: 'Unlimited / Month', desc_da: 'Ideel til regelmæssig praksis – kom så tit du vil.', desc_en: 'Ideal for regular practice – come as often as you like.', features_da: ['Ubegrænset adgang til alle klasser', 'Wellness-fordele inkl.', 'Book op til 21 dage frem'], features_en: ['Unlimited access to all classes', 'Wellness perks included', 'Book up to 21 days ahead'], terms_da: ['Første måned gratis', 'Engangs-registreringsgebyr: 299 kr', 'Løbende månedligt – opsig eller pause når som helst'], terms_en: ['First month free', 'One-time registration fee: 299 DKK', 'Month-to-month – cancel or pause anytime'] },
    '103':  { price: 1649, _itemType: 'contract', regFee: 299, firstMonthFree: true, name_da: 'Premium Ubegrænset / Måned', name_en: 'Premium Unlimited / Month', desc_da: 'Top-tier medlemskab med fuld komfort og prioritet.', desc_en: 'Top-tier membership with full comfort and priority.', features_da: ['Ubegrænset prioritetsadgang', 'Måtteopbevaring, håndklæder, vaskeservice', 'Book op til 31 dage frem'], features_en: ['Unlimited priority access', 'Mat storage, towels, laundry service', 'Book up to 31 days ahead'], terms_da: ['Første måned gratis', 'Engangs-registreringsgebyr: 299 kr', 'Løbende månedligt – opsig eller pause når som helst'], terms_en: ['First month free', 'One-time registration fee: 299 DKK', 'Month-to-month – cancel or pause anytime'] },

    // ── Memberships · Under 30 (contract type) ─────────────────────
    '109':  { price: 799,  _itemType: 'contract', regFee: 275, firstMonthFree: true, name_da: '10 Klasser / Måned', name_en: '10 Classes / Month', desc_da: 'Ideel til moderat praksis – ca. 1-3 gange om ugen.', desc_en: 'Ideal for moderate practice – about 1-3 times per week.', features_da: ['Adgang til alle klassetyper og tider', 'Wellness-fordele inkl.', 'Book op til 21 dage frem'], features_en: ['Access to all class types and times', 'Wellness perks included', 'Book up to 21 days ahead'], terms_da: ['Første måned gratis', 'Engangs-registreringsgebyr: 275 kr', 'Løbende månedligt – opsig eller pause når som helst'], terms_en: ['First month free', 'One-time registration fee: 275 DKK', 'Month-to-month – cancel or pause anytime'] },
    '111':  { price: 999,  _itemType: 'contract', regFee: 275, firstMonthFree: true, name_da: 'Ubegrænset / Måned', name_en: 'Unlimited / Month', desc_da: 'Ideel til regelmæssig praksis – kom så tit du vil.', desc_en: 'Ideal for regular practice – come as often as you like.', features_da: ['Ubegrænset adgang til alle klasser', 'Wellness-fordele inkl.', 'Book op til 21 dage frem'], features_en: ['Unlimited access to all classes', 'Wellness perks included', 'Book up to 21 days ahead'], terms_da: ['Første måned gratis', 'Engangs-registreringsgebyr: 275 kr', 'Løbende månedligt – opsig eller pause når som helst'], terms_en: ['First month free', 'One-time registration fee: 275 DKK', 'Month-to-month – cancel or pause anytime'] },
    '112':  { price: 1499, _itemType: 'contract', regFee: 275, firstMonthFree: true, name_da: 'Premium Ubegrænset / Måned', name_en: 'Premium Unlimited / Month', desc_da: 'Top-tier medlemskab med fuld komfort og prioritet.', desc_en: 'Top-tier membership with full comfort and priority.', features_da: ['Ubegrænset prioritetsadgang', 'Måtteopbevaring, håndklæder, vaskeservice', 'Book op til 31 dage frem'], features_en: ['Unlimited priority access', 'Mat storage, towels, laundry service', 'Book up to 31 days ahead'], terms_da: ['Første måned gratis', 'Engangs-registreringsgebyr: 275 kr', 'Løbende månedligt – opsig eller pause når som helst'], terms_en: ['First month free', 'One-time registration fee: 275 DKK', 'Month-to-month – cancel or pause anytime'] },

    // ── Test Product (1 DKK — for end-to-end payment testing) ───────
    '100203': { price: 1, name_da: 'Test Klippekort', name_en: 'Test Clip Card', validity: null, desc_da: 'Testprodukt til betalingsflow — 1 kr.', desc_en: 'Test product for payment flow — 1 DKK.' }
  };

  // ── Age bracket pairs: over30 ↔ under30 ─────────────────────────
  // Maps each prodId to its counterpart in the other age bracket.
  // Format: { prodId: { pair: otherProdId, age: 'over30'|'under30' } }
  var AGE_MAP = {
    // Clips
    '100174': { pair: '100017', age: 'over30' },  '100017': { pair: '100174', age: 'under30' },
    '100175': { pair: '100016', age: 'over30' },  '100016': { pair: '100175', age: 'under30' },
    '100176': { pair: '100018', age: 'over30' },  '100018': { pair: '100176', age: 'under30' },
    '100177': { pair: '100019', age: 'over30' },  '100019': { pair: '100177', age: 'under30' },
    '100178': { pair: '100020', age: 'over30' },  '100020': { pair: '100178', age: 'under30' },
    '100179': { pair: '100021', age: 'over30' },  '100021': { pair: '100179', age: 'under30' },
    '100180': { pair: '100022', age: 'over30' },  '100022': { pair: '100180', age: 'under30' },
    '100181': { pair: '100023', age: 'over30' },  '100023': { pair: '100181', age: 'under30' },
    '100182': { pair: '100024', age: 'over30' },  '100024': { pair: '100182', age: 'under30' },
    '100183': { pair: '100068', age: 'over30' },  '100068': { pair: '100183', age: 'under30' },
    // Time-based
    '100186': { pair: '100043', age: 'over30' },  '100043': { pair: '100186', age: 'under30' },
    '100187': { pair: '100044', age: 'over30' },  '100044': { pair: '100187', age: 'under30' },
    '100189': { pair: '100037', age: 'over30' },  '100037': { pair: '100189', age: 'under30' },
    '100190': { pair: '100038', age: 'over30' },  '100038': { pair: '100190', age: 'under30' },
    '100191': { pair: '100039', age: 'over30' },  '100039': { pair: '100191', age: 'under30' },
    '100192': { pair: '100040', age: 'over30' },  '100040': { pair: '100192', age: 'under30' },
    // Trials
    '100185': { pair: '100153', age: 'over30' },  '100153': { pair: '100185', age: 'under30' },
    // Tourist
    '100199': { pair: '100051', age: 'over30' },  '100051': { pair: '100199', age: 'under30' },
    // Memberships
    '101':  { pair: '109', age: 'over30' },   '109':  { pair: '101', age: 'under30' },
    '102':  { pair: '111', age: 'over30' },   '111':  { pair: '102', age: 'under30' },
    '103':  { pair: '112', age: 'over30' },   '112':  { pair: '103', age: 'under30' }
  };

  // Current age selection — default under30
  var selectedAge = 'under30';

  function getAgePair(prodId) {
    return AGE_MAP[String(prodId)] || null;
  }

  // Given a prodId, return the equivalent in the target age bracket
  function getProdForAge(prodId, targetAge) {
    var info = getAgePair(prodId);
    if (!info) return prodId; // no pair (e.g. teacher, courses) — keep as is
    if (info.age === targetAge) return String(prodId); // already correct
    return info.pair; // return the paired product
  }

  // Check if a product has age-based pricing
  function hasAgePricing(prodId) {
    return !!AGE_MAP[String(prodId)];
  }

  // ── Product helper ──────────────────────────────────────────────────
  function getProduct(prodId) {
    return PRODUCTS[String(prodId)] || null;
  }

  // The real Mindbody service ID (strips variant suffixes like _trial, _u30)
  function getRealProdId(prodId) {
    var p = getProduct(prodId);
    return (p && p.realId) ? p.realId : String(prodId).replace(/_.*$/, '');
  }

  // ── Product category helper ────────────────────────────────────────
  function getProductCategory(prodId) {
    var id = String(prodId);
    if (id.indexOf('_trial') !== -1) return 'trials';
    if (id.indexOf('_u30') !== -1) return 'trials';
    var p = PRODUCTS[id];
    if (!p) return 'unknown';
    if (p._itemType === 'contract') return 'memberships';
    if (id === '100199' || id === '100051') return 'tourist';
    if (id === '100185') return 'trials';
    var timebased = ['100186','100187','100189','100190','100191','100192','100043','100044','100037','100038','100039','100040'];
    if (timebased.indexOf(id) !== -1) return 'timebased';
    if (id === '100203') return 'test';
    return 'clips';
  }

  function getProductName(prodId) {
    var p = getProduct(prodId);
    if (!p) return 'Product ' + prodId;
    return isDa ? p.name_da : p.name_en;
  }

  function isContract(prodId) {
    var p = getProduct(prodId);
    return p && p._itemType === 'contract';
  }

  // ── Date helper for contract start date ────────────────────────────
  function toLocalDateStr(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function formatDKK(amount) {
    return amount.toLocaleString('da-DK') + ' kr';
  }

  // ── Lead Funnel Tracking (Firestore + GA DataLayer) ────────────────
  // Mirrors ytt-funnel.js — tracks 6 stages to lead_funnel collection.
  var LEAD_COLLECTION = 'lead_funnel';

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

    var docData = {
      userId: user.uid,
      email: user.email || '',
      programId: funnel.prodId,
      programName: getProductName(funnel.prodId),
      productCategory: getProductCategory(funnel.prodId),
      funnel_stage: stage,
      sessionId: funnel.sessionId,
      source_page: funnel.sourcePage || '',
      source_site: 'hotyogacph.dk',
      updatedAt: now
    };

    if (extraData && extraData.firstName) docData.firstName = extraData.firstName;
    if (extraData && extraData.lastName) docData.lastName = extraData.lastName;
    if (extraData && extraData.phone) docData.phone = extraData.phone;

    var stageKey = stage.replace(/-/g, '_') + '_at';
    docData[stageKey] = now;

    var historyEntry = { stage: stage, timestamp: new Date().toISOString() };

    db.collection(LEAD_COLLECTION).doc(docId).get().then(function (snap) {
      if (snap.exists) {
        var update = {
          funnel_stage: stage,
          updatedAt: now
        };
        update[stageKey] = now;
        if (extraData && extraData.firstName) update.firstName = extraData.firstName;
        if (extraData && extraData.lastName) update.lastName = extraData.lastName;
        if (extraData && extraData.phone) update.phone = extraData.phone;
        update.history = firebase.firestore.FieldValue.arrayUnion(historyEntry);
        return db.collection(LEAD_COLLECTION).doc(docId).update(update);
      } else {
        docData.createdAt = now;
        docData.cta_timestamp = funnel.startedAt || new Date().toISOString();
        docData.history = [
          { stage: 'cta_click', timestamp: funnel.startedAt || new Date().toISOString() },
          historyEntry
        ];
        return db.collection(LEAD_COLLECTION).doc(docId).set(docData);
      }
    }).then(function () {
      console.log('[HYC Embed] Tracked:', stage, 'for prodId', funnel.prodId);
    }).catch(function (err) {
      console.warn('[HYC Embed] Track error:', err.message);
    });
  }

  // Convenience trackers
  function trackAuthComplete(extraData) { trackFunnelStage('auth_complete', extraData); }
  function trackCheckoutOpened() { trackFunnelStage('checkout_opened'); }
  function trackPurchased() { trackFunnelStage('purchased'); clearFunnel(); }
  function trackCheckoutAbandoned() { trackFunnelStage('checkout_abandoned'); }

  // GA DataLayer push
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

  // ── Firestore Profile Creation ─────────────────────────────────────
  // Creates a user document in Firestore after registration.
  function createFirestoreProfile(user, firstName, lastName, phone, consents) {
    try {
      var db = firebase.firestore();
      db.collection('users').doc(user.uid).set({
        uid: user.uid,
        email: user.email || '',
        firstName: firstName,
        lastName: lastName,
        phone: phone || '',
        displayName: (firstName + ' ' + lastName).trim(),
        consents: consents || {},
        source: 'checkout-embed',
        sourceSite: 'hotyogacph.dk',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true }).then(function () {
        console.log('[HYC Embed] Firestore profile created for', user.uid);
      }).catch(function (err) {
        console.warn('[HYC Embed] Firestore profile error:', err.message);
      });
    } catch (e) {
      console.warn('[HYC Embed] Firestore not ready for profile creation');
    }
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
    // After Firebase is ready, set auth persistence to NONE (in-memory).
    // This embed runs cross-origin on Framer — IndexedDB (the default LOCAL
    // persistence) is silently blocked by browser storage partitioning
    // (Chrome 115+, Safari 16.1+, Firefox 109+), which causes
    // signInWithEmailAndPassword to hang forever (promise never settles).
    function onFirebaseReady() {
      if (typeof firebase !== 'undefined' && firebase.auth) {
        // Try SESSION persistence (sessionStorage — not IndexedDB, so no hang).
        // Falls back to NONE if SESSION is blocked (cross-origin sandbox).
        firebase.auth().setPersistence(firebase.auth.Auth.Persistence.SESSION)
          .then(function () { callback(); })
          .catch(function () {
            firebase.auth().setPersistence(firebase.auth.Auth.Persistence.NONE)
              .then(function () { callback(); })
              .catch(function () { callback(); });
          });
      } else {
        callback();
      }
    }

    // If Firebase is already available (e.g. loaded by another script on page)
    if (typeof firebase !== 'undefined' && firebase.apps) {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      return onFirebaseReady();
    }

    var scripts = [
      FIREBASE_CDN + '/firebase-app-compat.js',
      FIREBASE_CDN + '/firebase-auth-compat.js',
      FIREBASE_CDN + '/firebase-firestore-compat.js'
    ];

    // Load sequentially (auth & firestore depend on app)
    var i = 0;
    function next(err) {
      if (err) { console.warn('[HYC Embed] Script load error:', err.message); }
      if (i >= scripts.length) {
        try {
          if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
        } catch (e) {
          console.warn('[HYC Embed] Firebase init error:', e.message);
        }
        return onFirebaseReady();
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

      // ── Language toggle ─────────────────────────────────────────
      '.ycf-lang{position:absolute;top:16px;left:16px;display:flex;gap:0;border-radius:8px;overflow:hidden;border:1px solid #E8E4E0;z-index:2}',
      '.ycf-lang__btn{font-family:inherit;font-size:.7rem;font-weight:700;padding:5px 10px;border:none;cursor:pointer;transition:background .15s,color .15s;background:#F5F3F0;color:#6F6A66;letter-spacing:.03em;text-transform:uppercase}',
      '.ycf-lang__btn--active{background:' + BRAND + ';color:#fff}',
      '.ycf-lang__btn:hover:not(.ycf-lang__btn--active){background:#E8E4E0;color:#0F0F0F}',

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
      '.yb-auth-hint{font-size:.78rem;color:#6F6A66;margin-top:-2px}',
      '.yb-auth-notice{background:#F5F3F0;border-radius:10px;padding:12px 14px;margin-top:4px}',
      '.yb-auth-notice p{font-size:.82rem;color:#6F6A66;line-height:1.45;margin:0}',
      '.yb-auth-notice strong{color:#0F0F0F}',
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
      '.ycf-product-badge__saving{display:flex;align-items:center;gap:6px;margin-top:6px;font-size:.78rem}',
      '.ycf-product-badge__saving[hidden]{display:none}',
      '.ycf-product-badge__saving s{color:#B5B0AB}',
      '.ycf-product-badge__saving .ycf-free{color:#2e7d32;font-weight:700}',
      '.ycf-product-badge__due{margin-top:4px;font-size:.78rem;color:#0F0F0F}',
      '.ycf-product-badge__due[hidden]{display:none}',
      '.ycf-product-badge__due strong{color:' + BRAND + '}',
      '.ycf-product-badge__due .ycf-due-note{color:#6F6A66}',
      '.ycf-product-badge__vat{display:inline-block;margin-top:4px;font-size:.72rem;color:#6F6A66;background:#E8E4E0;border-radius:4px;padding:1px 6px}',
      '.ycf-product-badge__vat[hidden]{display:none}',

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

      // Age bracket toggle
      '.ycf-age{display:flex;align-items:center;gap:10px;margin-bottom:16px}',
      '.ycf-age[hidden]{display:none}',
      '.ycf-age__label{font-size:.82rem;font-weight:700;color:#0F0F0F}',
      '.ycf-age__toggle{display:flex;border:1.5px solid #E8E4E0;border-radius:8px;overflow:hidden;height:32px}',
      '.ycf-age__btn{padding:0 14px;font-size:.78rem;font-weight:700;font-family:inherit;border:none;cursor:pointer;transition:all .15s;background:#fff;color:#6F6A66;letter-spacing:.02em;white-space:nowrap}',
      '.ycf-age__btn.is-active{background:' + BRAND + ';color:#fff}',
      '.ycf-age__btn:not(.is-active):hover{background:#F5F3F0;color:' + BRAND + '}',
      '.ycf-age__vat{display:inline-block;font-size:.72rem;font-weight:600;color:#6F6A66;padding:4px 8px;background:#F5F3F0;border-radius:6px;margin-left:auto}',
      '.ycf-age__vat[hidden]{display:none}',

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

      // Contract-specific: features, terms, savings, start date
      '.ycf-product__features{list-style:none;padding:0;margin:10px 0 0;display:flex;flex-direction:column;gap:6px}',
      '.ycf-product__features li{font-size:.82rem;color:#0F0F0F;padding-left:22px;position:relative;line-height:1.4}',
      '.ycf-product__features li::before{content:"\\2713";position:absolute;left:0;color:#2e7d32;font-weight:700}',
      '.ycf-product__terms{list-style:none;padding:0;margin:10px 0 0;display:flex;flex-direction:column;gap:4px}',
      '.ycf-product__terms li{font-size:.78rem;color:#6F6A66;padding-left:16px;position:relative;line-height:1.4}',
      '.ycf-product__terms li::before{content:"\\2022";position:absolute;left:4px;color:#B5B0AB}',
      '.ycf-product__saving{display:inline-flex;align-items:center;gap:6px;margin-top:10px;font-size:.85rem}',
      '.ycf-product__saving s{color:#6F6A66}',
      '.ycf-product__saving .ycf-free{color:#2e7d32;font-weight:700}',
      '.ycf-product__due{margin-top:8px;font-size:.85rem;color:#0F0F0F}',
      '.ycf-product__due strong{color:' + BRAND + '}',
      '.ycf-product__due .ycf-due-note{font-size:.78rem;color:#6F6A66}',
      '#ycf-startdate-section{margin-bottom:16px}',
      '#ycf-startdate-section[hidden]{display:none}',
      '#ycf-startdate-section label{font-size:.82rem;font-weight:700;color:#0F0F0F;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:6px}',
      '#ycf-start-date{font-family:inherit;font-size:.95rem;padding:12px 16px;border:1px solid ' + BRAND + ';border-radius:12px;background:#fff;color:#0F0F0F;outline:none;width:100%;box-sizing:border-box}',

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
  var loginOnlyMode = false;   // true when opened via openLoginModal()
  var loginOnlyCallback = null; // optional callback instead of redirect after login
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

    // ── Language toggle (DA / EN) ────────────────────────────────
    h +=     '<div class="ycf-lang">';
    h +=       '<button class="ycf-lang__btn' + (isDa ? ' ycf-lang__btn--active' : '') + '" type="button" id="ycf-lang-da" data-ycf-lang="da">DA</button>';
    h +=       '<button class="ycf-lang__btn' + (!isDa ? ' ycf-lang__btn--active' : '') + '" type="button" id="ycf-lang-en" data-ycf-lang="en">EN</button>';
    h +=     '</div>';

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

    // Age bracket toggle (early — login step)
    h +=   '<div class="ycf-age" id="ycf-age-toggle-early" hidden>';
    h +=     '<span class="ycf-age__label" data-yj-da>Alder:</span>';
    h +=     '<span class="ycf-age__label" data-yj-en hidden>Age:</span>';
    h +=     '<div class="ycf-age__toggle">';
    h +=       '<button class="ycf-age__btn is-active" type="button" data-ycf-age="under30" data-yj-da>Under 30</button>';
    h +=       '<button class="ycf-age__btn is-active" type="button" data-ycf-age="under30" data-yj-en hidden>Under 30</button>';
    h +=       '<button class="ycf-age__btn" type="button" data-ycf-age="over30" data-yj-da>30+</button>';
    h +=       '<button class="ycf-age__btn" type="button" data-ycf-age="over30" data-yj-en hidden>30+</button>';
    h +=     '</div>';
    h +=     '<span class="ycf-age__vat" id="ycf-age-vat-early" hidden></span>';
    h +=   '</div>';

    // Product preview badge
    h +=   '<div class="ycf-product-badge" id="ycf-product-badge">';
    h +=     '<div class="ycf-product-badge__top">';
    h +=       '<span class="ycf-product-badge__name" id="ycf-badge-name"></span>';
    h +=       '<span class="ycf-product-badge__price" id="ycf-badge-price"></span>';
    h +=     '</div>';
    h +=     '<span class="ycf-product-badge__cohort" id="ycf-badge-cohort" hidden></span>';
    h +=     '<div class="ycf-product-badge__saving" id="ycf-badge-saving" hidden></div>';
    h +=     '<div class="ycf-product-badge__due" id="ycf-badge-due" hidden></div>';
    h +=     '<span class="ycf-product-badge__vat" id="ycf-badge-vat" hidden></span>';
    h +=     '<p class="ycf-product-badge__desc" id="ycf-badge-desc-da" data-yj-da>Du f\u00e5r adgang til at booke klasser efter betaling</p>';
    h +=     '<p class="ycf-product-badge__desc" id="ycf-badge-desc-en" data-yj-en hidden>You\'ll be able to start booking classes after payment</p>';
    h +=   '</div>';

    // Login form
    h +=   '<form id="ycf-login-form" class="yb-auth-form" novalidate>';
    h +=     '<div class="yb-auth-field">';
    h +=       '<label for="ycf-login-email" data-yj-da>Email</label>';
    h +=       '<label for="ycf-login-email" data-yj-en hidden>Email</label>';
    h +=       '<input type="email" id="ycf-login-email" name="email" required autocomplete="email" placeholder="din@email.dk">';
    h +=     '</div>';
    h +=     '<div class="yb-auth-field">';
    h +=       '<label for="ycf-login-password" data-yj-da>Adgangskode</label>';
    h +=       '<label for="ycf-login-password" data-yj-en hidden>Password</label>';
    h +=       '<input type="password" id="ycf-login-password" name="password" required autocomplete="current-password" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022">';
    h +=     '</div>';
    h +=     '<div class="yb-auth-error" id="ycf-login-error" hidden role="alert"></div>';
    h +=     '<button type="submit" class="yb-auth-submit" id="ycf-login-btn" data-yj-da>Log ind</button>';
    h +=     '<button type="submit" class="yb-auth-submit" id="ycf-login-btn-en" data-yj-en hidden>Sign in</button>';
    h +=   '</form>';

    h +=   '<div class="yb-auth-links">';
    h +=     '<a href="#" data-ycf-action="forgot" data-yj-da>Glemt adgangskode?</a>';
    h +=     '<a href="#" data-ycf-action="forgot" data-yj-en hidden>Forgot password?</a>';
    h +=   '</div>';
    h +=   '<div class="yb-auth-notice" style="background:#e8f4f6;border-left:3px solid #3f99a5;border-radius:0 10px 10px 0">';
    h +=     '<p style="color:#2d6b74" data-yj-da>Allerede klient? <a href="https://profile.hotyogacph.dk" style="color:#3f99a5;font-weight:700;text-decoration:underline">Log ind p\u00e5 din profil</a> \u2014 der kan du k\u00f8be direkte.</p>';
    h +=     '<p style="color:#2d6b74" data-yj-en hidden>Already a client? <a href="https://profile.hotyogacph.dk" style="color:#3f99a5;font-weight:700;text-decoration:underline">Sign in to your profile</a> \u2014 you can buy directly there.</p>';
    h +=   '</div>';
    h +=   '<div class="yb-auth-divider">';
    h +=     '<span data-yj-da>Ny klient?</span>';
    h +=     '<span data-yj-en hidden>New client?</span>';
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

    // Age bracket toggle (register step)
    h +=   '<div class="ycf-age" id="ycf-age-toggle-register" hidden>';
    h +=     '<span class="ycf-age__label" data-yj-da>Alder:</span>';
    h +=     '<span class="ycf-age__label" data-yj-en hidden>Age:</span>';
    h +=     '<div class="ycf-age__toggle">';
    h +=       '<button class="ycf-age__btn is-active" type="button" data-ycf-age="under30" data-yj-da>Under 30</button>';
    h +=       '<button class="ycf-age__btn is-active" type="button" data-ycf-age="under30" data-yj-en hidden>Under 30</button>';
    h +=       '<button class="ycf-age__btn" type="button" data-ycf-age="over30" data-yj-da>30+</button>';
    h +=       '<button class="ycf-age__btn" type="button" data-ycf-age="over30" data-yj-en hidden>30+</button>';
    h +=     '</div>';
    h +=     '<span class="ycf-age__vat" id="ycf-age-vat-register" hidden></span>';
    h +=   '</div>';

    // Product preview badge (register step)
    h +=   '<div class="ycf-product-badge" id="ycf-product-badge-register">';
    h +=     '<div class="ycf-product-badge__top">';
    h +=       '<span class="ycf-product-badge__name" id="ycf-rbadge-name"></span>';
    h +=       '<span class="ycf-product-badge__price" id="ycf-rbadge-price"></span>';
    h +=     '</div>';
    h +=     '<span class="ycf-product-badge__cohort" id="ycf-rbadge-cohort" hidden></span>';
    h +=     '<div class="ycf-product-badge__saving" id="ycf-rbadge-saving" hidden></div>';
    h +=     '<div class="ycf-product-badge__due" id="ycf-rbadge-due" hidden></div>';
    h +=     '<span class="ycf-product-badge__vat" id="ycf-rbadge-vat" hidden></span>';
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
    h +=       '<small class="yb-auth-hint" data-yj-da>Brug den email du booker med \u2014 vi kobler din konto automatisk</small>';
    h +=       '<small class="yb-auth-hint" data-yj-en hidden>Use the email you book with \u2014 we\'ll link your account automatically</small>';
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

    // Age bracket toggle (shown only for products with age pricing)
    h +=   '<div class="ycf-age" id="ycf-age-toggle" hidden>';
    h +=     '<span class="ycf-age__label" data-yj-da>Alder:</span>';
    h +=     '<span class="ycf-age__label" data-yj-en hidden>Age:</span>';
    h +=     '<div class="ycf-age__toggle">';
    h +=       '<button class="ycf-age__btn is-active" type="button" data-ycf-age="under30" data-yj-da>Under 30</button>';
    h +=       '<button class="ycf-age__btn is-active" type="button" data-ycf-age="under30" data-yj-en hidden>Under 30</button>';
    h +=       '<button class="ycf-age__btn" type="button" data-ycf-age="over30" data-yj-da>30+</button>';
    h +=       '<button class="ycf-age__btn" type="button" data-ycf-age="over30" data-yj-en hidden>30+</button>';
    h +=     '</div>';
    h +=     '<span class="ycf-age__vat" id="ycf-age-vat" hidden></span>';
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

    // Start date picker (contracts only — shown/hidden by JS)
    h +=   '<div id="ycf-startdate-section" hidden>';
    h +=     '<label for="ycf-start-date" data-yj-da>Startdato for medlemskab</label>';
    h +=     '<label for="ycf-start-date" data-yj-en hidden>Membership start date</label>';
    h +=     '<input type="date" id="ycf-start-date">';
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
    h +=     '<p class="yb-auth-modal__subtitle" data-yj-da>Du modtager en bekr\u00e6ftelse p\u00e5 email.</p>';
    h +=     '<p class="yb-auth-modal__subtitle" data-yj-en hidden>You\'ll receive a confirmation email.</p>';
    h +=     '<p class="yb-auth-modal__subtitle" style="margin-top:4px" data-yj-da>Log ind med dine oplysninger for at booke din f\u00f8rste klasse.</p>';
    h +=     '<p class="yb-auth-modal__subtitle" style="margin-top:4px" data-yj-en hidden>Log in with your credentials to book your first class.</p>';
    h +=     '<button class="yb-auth-submit" type="button" id="ycf-go-profile" data-yj-da>Book en klasse</button>';
    h +=     '<button class="yb-auth-submit" type="button" id="ycf-go-profile-en" data-yj-en hidden>Book a class</button>';
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
    // Track abandonment if user closes during checkout step
    if (currentStep >= 3 && currentProdId) {
      trackCheckoutAbandoned();
      pushDataLayer('checkout_funnel_abandoned', {
        funnel_stage: 'checkout_abandoned',
        product_id: currentProdId,
        product_name: getProductName(currentProdId),
        product_category: getProductCategory(currentProdId)
      });
    }
    modal.setAttribute('aria-hidden', 'true');
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.width = '';
    document.body.style.top = '';
    window.scrollTo(0, scrollY);
    // Clean up contract-specific elements appended to product card
    var prodCard = $('ycf-product-info');
    if (prodCard) {
      var extras = prodCard.querySelectorAll('.ycf-product__features,.ycf-product__terms,.ycf-product__saving,.ycf-product__due');
      for (var x = 0; x < extras.length; x++) extras[x].remove();
    }
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

    // Helper to build cohort string
    function buildCohortParts(prod) {
      var cp = [];
      var lbl = isDa ? prod.label_da : prod.label_en;
      if (lbl) cp.push(lbl);
      if (prod.validity) cp.push(prod.validity);
      if (prod.classes) cp.push(prod.classes + t(' klasser', ' classes'));
      return cp;
    }

    // Helper to update a badge (login or register) with all info
    function populateBadge(ids, prod) {
      var bName   = $(ids.name);
      var bPrice  = $(ids.price);
      var bCohort = $(ids.cohort);
      var bSaving = $(ids.saving);
      var bDue    = $(ids.due);
      var bVat    = $(ids.vat);
      var bDescDa = $(ids.descDa);
      var bDescEn = $(ids.descEn);
      if (!bName) return;

      var bLabel = isDa ? prod.name_da : prod.name_en;
      bName.textContent = bLabel;

      // Price: for contracts show reg fee as "amount due", otherwise full price
      var displayPrice = (prod._itemType === 'contract' && prod.firstMonthFree && prod.regFee)
        ? formatDKK(prod.regFee)
        : prod.price.toLocaleString('da-DK') + ' DKK';
      if (bPrice) bPrice.textContent = displayPrice;

      // Cohort
      if (bCohort) {
        var cp = buildCohortParts(prod);
        if (prod._itemType === 'contract') cp = [t('Medlemskab', 'Membership'), t('pr. måned', 'per month')];
        bCohort.textContent = cp.join(' \u00b7 ');
        bCohort.hidden = cp.length === 0;
      }

      // Savings + due (contracts with first-month-free)
      if (bSaving) {
        if (prod._itemType === 'contract' && prod.firstMonthFree) {
          bSaving.innerHTML = '<s>' + formatDKK(prod.price) + '</s>&nbsp;<span class="ycf-free">' + t('0 kr første måned', '0 kr first month') + '</span>';
          bSaving.hidden = false;
        } else {
          bSaving.hidden = true;
        }
      }
      if (bDue) {
        if (prod._itemType === 'contract' && prod.firstMonthFree && prod.regFee) {
          bDue.innerHTML = t('Betaler nu: ', 'Pay now: ') + '<strong>' + formatDKK(prod.regFee) + '</strong> <span class="ycf-due-note">' + t('(registreringsgebyr)', '(registration fee)') + '</span>';
          bDue.hidden = false;
        } else {
          bDue.hidden = true;
        }
      }

      // VAT badge (over30 only)
      var ageInfo2 = getAgePair(prod === p ? prodId : prodId);
      if (bVat) {
        if (ageInfo2 && ageInfo2.age === 'over30') {
          bVat.textContent = t('Inkl. 25% moms', 'Incl. 25% VAT');
          bVat.hidden = false;
        } else {
          bVat.hidden = true;
        }
      }

      // Desc: hide for contracts (savings/due says it all)
      if (bDescDa) bDescDa.hidden = prod._itemType === 'contract';
      if (bDescEn) bDescEn.hidden = prod._itemType === 'contract';
    }

    // Show/hide ALL age toggles + update VAT info
    var ageInfo = getAgePair(prodId);
    var isOver30 = ageInfo && ageInfo.age === 'over30';
    var vatText = isOver30 ? t('Inkl. 25% moms', 'Incl. 25% VAT') : '';

    var toggleIds = ['ycf-age-toggle', 'ycf-age-toggle-early', 'ycf-age-toggle-register'];
    var vatIds    = ['ycf-age-vat',    'ycf-age-vat-early',    'ycf-age-vat-register'];
    for (var ti = 0; ti < toggleIds.length; ti++) {
      var tog = $(toggleIds[ti]);
      if (!tog) continue;
      if (hasAgePricing(prodId)) {
        tog.hidden = false;
        var vatEl = $(vatIds[ti]);
        if (vatEl) { vatEl.textContent = vatText; vatEl.hidden = !isOver30; }
      } else {
        tog.hidden = true;
      }
    }

    // Badge (login step)
    populateBadge({
      name: 'ycf-badge-name', price: 'ycf-badge-price', cohort: 'ycf-badge-cohort',
      saving: 'ycf-badge-saving', due: 'ycf-badge-due', vat: 'ycf-badge-vat',
      descDa: 'ycf-badge-desc-da', descEn: 'ycf-badge-desc-en'
    }, p);

    // Badge (register step)
    populateBadge({
      name: 'ycf-rbadge-name', price: 'ycf-rbadge-price', cohort: 'ycf-rbadge-cohort',
      saving: 'ycf-rbadge-saving', due: 'ycf-rbadge-due', vat: 'ycf-rbadge-vat',
      descDa: null, descEn: null
    }, p);

    // Checkout step product card
    var prodName  = $('ycf-prod-name');
    var prodPrice = $('ycf-prod-price');
    var prodDesc  = $('ycf-prod-desc');
    var prodChips = $('ycf-prod-chips');
    var prodNote  = $('ycf-prod-note');

    if (prodName) prodName.textContent = name;
    if (prodPrice) prodPrice.textContent = price;
    if (prodDesc) prodDesc.textContent = (isDa ? p.desc_da : p.desc_en) || '';

    // Chips: validity + classes (services) or /md (contracts)
    if (prodChips) {
      var chips = '';
      if (p._itemType === 'contract') {
        chips += '<span class="ycf-chip ycf-chip--brand">' + t('Medlemskab', 'Membership') + '</span>';
        chips += '<span class="ycf-chip">' + t('pr. måned', 'per month') + '</span>';
      } else {
        if (p.validity) chips += '<span class="ycf-chip">' + p.validity + '</span>';
        if (p.classes) chips += '<span class="ycf-chip">' + p.classes + t(' klasser', ' classes') + '</span>';
      }
      prodChips.innerHTML = chips;
    }

    // Contract-specific: features, terms, first-month-free
    if (p._itemType === 'contract') {
      var extraHtml = '';
      // Features checklist
      var features = isDa ? p.features_da : p.features_en;
      if (features && features.length) {
        extraHtml += '<ul class="ycf-product__features">';
        for (var fi = 0; fi < features.length; fi++) extraHtml += '<li>' + features[fi] + '</li>';
        extraHtml += '</ul>';
      }
      // First month free savings
      if (p.firstMonthFree) {
        extraHtml += '<div class="ycf-product__saving">';
        extraHtml += '<s>' + formatDKK(p.price) + '</s> ';
        extraHtml += '<span class="ycf-free">' + t('0 kr første måned', '0 kr first month') + '</span>';
        extraHtml += '</div>';
        if (p.regFee) {
          extraHtml += '<div class="ycf-product__due">';
          extraHtml += t('Beløb at betale nu: ', 'Amount due now: ');
          extraHtml += '<strong>' + formatDKK(p.regFee) + '</strong> ';
          extraHtml += '<span class="ycf-due-note">' + t('(registreringsgebyr)', '(registration fee)') + '</span>';
          extraHtml += '</div>';
        }
      }
      // Terms
      var terms = isDa ? p.terms_da : p.terms_en;
      if (terms && terms.length) {
        extraHtml += '<ul class="ycf-product__terms">';
        for (var ti = 0; ti < terms.length; ti++) extraHtml += '<li>' + terms[ti] + '</li>';
        extraHtml += '</ul>';
      }
      // Append to product card
      var prodCard = $('ycf-product-info');
      if (prodCard && extraHtml) {
        var extraDiv = document.createElement('div');
        extraDiv.innerHTML = extraHtml;
        while (extraDiv.firstChild) prodCard.appendChild(extraDiv.firstChild);
      }
      // Show start date picker
      var startSection = $('ycf-startdate-section');
      if (startSection) {
        startSection.hidden = false;
        var startInput = $('ycf-start-date');
        if (startInput) {
          var today = toLocalDateStr(new Date());
          var maxDate = new Date();
          maxDate.setDate(maxDate.getDate() + 60);
          startInput.min = today;
          startInput.max = toLocalDateStr(maxDate);
          startInput.value = today;
        }
      }
      // Update price display to show regFee as amount due
      if (p.firstMonthFree && p.regFee && prodPrice) {
        prodPrice.textContent = formatDKK(p.regFee);
      }
    } else {
      // Service: hide start date
      var startSectionEl = $('ycf-startdate-section');
      if (startSectionEl) startSectionEl.hidden = true;
    }

    // Note section (hidden for services, could be used for contracts)
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
        var consents = {
          termsAndConditions: { accepted: true, timestamp: new Date().toISOString(), version: '2026-02-09' },
          privacyPolicy:     { accepted: true, timestamp: new Date().toISOString(), version: '2026-02-09' },
          codeOfConduct:     { accepted: true, timestamp: new Date().toISOString(), version: '2026-02-09' }
        };
        // Store for MB client creation
        window._ybRegistration = {
          firstName: firstName,
          lastName: lastName,
          phone: phone,
          consents: consents
        };
        // Create Firestore user profile immediately
        createFirestoreProfile(cred.user, firstName, lastName, phone, consents);
        return cred.user.updateProfile({ displayName: fullName });
      })
      .then(function () { callback(null); })
      .catch(function (err) { callback(err); });
  }

  function doForgotPassword(email, callback) {
    // Send branded reset email via Resend (better deliverability than
    // Firebase's built-in noreply@*.firebaseapp.com emails).
    var apiBase = 'https://www.hotyogacph.dk/.netlify/functions';
    fetch(apiBase + '/send-password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, lang: isDa ? 'da' : 'en' })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.ok) { callback(null); }
        else { callback({ code: 'custom', message: data.error || 'Failed' }); }
      })
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

  function persistMindbodyClientId(clientId) {
    // Write the resolved MB client ID back to the Firebase user doc so
    // later sessions (direct booking, member area) don't re-lookup by email.
    try {
      if (typeof firebase === 'undefined' || !firebase.auth) return;
      var user = firebase.auth().currentUser;
      if (!user || !clientId) return;
      firebase.firestore().collection('users').doc(user.uid).set({
        mindbodyClientId: String(clientId),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true }).catch(function (err) {
        console.warn('[Checkout Embed] Could not persist mindbodyClientId:', err);
      });
    } catch (ex) {
      console.warn('[Checkout Embed] persistMindbodyClientId error:', ex);
    }
  }

  function findOrCreateClient(firstName, lastName, email, phone) {
    return fetch(API_BASE + '/mb-client?email=' + encodeURIComponent(email))
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.found && data.client) {
          persistMindbodyClientId(data.client.id);
          return data.client.id;
        }
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
          if (d.client) {
            persistMindbodyClientId(d.client.id);
            return d.client.id;
          }
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

        // Track checkout opened
        trackCheckoutOpened();
        pushDataLayer('checkout_funnel_checkout_opened', {
          funnel_stage: 'checkout_opened',
          product_id: currentProdId,
          product_name: getProductName(currentProdId),
          product_category: getProductCategory(currentProdId)
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
    loginOnlyMode = false;
    currentProdId = String(prodId);
    mbClientId = null;
    storedCard = null;

    modal = $('ycf-modal');
    if (!modal) return;

    // Sync age bracket with the product being opened
    var ageInfo = getAgePair(currentProdId);
    if (ageInfo) {
      selectedAge = ageInfo.age;
    }
    // Sync toggle button styles across all age toggle widgets
    var allAgeWrapIds = ['ycf-age-toggle', 'ycf-age-toggle-early', 'ycf-age-toggle-register'];
    for (var aw = 0; aw < allAgeWrapIds.length; aw++) {
      var ageWrap = $(allAgeWrapIds[aw]);
      if (ageWrap) {
        var ageBtns = ageWrap.querySelectorAll('[data-ycf-age]');
        for (var ab = 0; ab < ageBtns.length; ab++) {
          ageBtns[ab].classList.toggle('is-active', ageBtns[ab].getAttribute('data-ycf-age') === selectedAge);
        }
      }
    }

    // Restore product badges + step dots (may have been hidden by login-only mode)
    var badge = $('ycf-product-badge');
    if (badge) badge.hidden = false;
    var badgeReg = $('ycf-product-badge-register');
    if (badgeReg) badgeReg.hidden = false;
    var stepDots = modal.querySelector('.ycf-steps');
    if (stepDots) stepDots.hidden = false;

    // Restore login subtitle for checkout context
    var loginStep = $('ycf-step-login');
    if (loginStep) {
      var subtitles = loginStep.querySelectorAll('.yb-auth-modal__subtitle');
      for (var s = 0; s < subtitles.length; s++) {
        if (subtitles[s].hasAttribute('data-yj-da')) subtitles[s].textContent = 'Log ind for at forts\u00e6tte til betaling';
        if (subtitles[s].hasAttribute('data-yj-en')) subtitles[s].textContent = 'Sign in to continue to payment';
      }
    }

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

  // ── 3J-b: Login-only modal (no product context) ────────────────────
  // Opens the same modal at the login step, but without product badge
  // or step dots. After successful login/register, redirects to profile.

  function openLoginModal(callback) {
    loginOnlyMode = true;
    loginOnlyCallback = (typeof callback === 'function') ? callback : null;
    currentProdId = null;
    mbClientId = null;
    storedCard = null;

    modal = $('ycf-modal');
    if (!modal) return;

    // Check if already logged in — go straight to profile
    var user = null;
    try { user = firebase.auth().currentUser; } catch (ex) { /* not ready */ }
    if (user) {
      window.location.href = PROFILE_URL + '/#schedule';
      return;
    }

    // Reset forms
    var inputs = modal.querySelectorAll('input');
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i].type === 'checkbox') inputs[i].checked = false;
      else if (inputs[i].type === 'radio') { /* skip */ }
      else if (inputs[i].type !== 'hidden') inputs[i].value = '';
    }
    var errorEls = modal.querySelectorAll('.yb-auth-error, .yb-auth-success');
    for (var e = 0; e < errorEls.length; e++) { errorEls[e].textContent = ''; errorEls[e].hidden = true; }

    // Hide product badge + step dots (not relevant for login-only)
    var badge = $('ycf-product-badge');
    if (badge) badge.hidden = true;
    var stepDots = modal.querySelector('.ycf-steps');
    if (stepDots) stepDots.hidden = true;

    // Update login subtitle for login-only context
    var loginStep = $('ycf-step-login');
    if (loginStep) {
      var subtitles = loginStep.querySelectorAll('.yb-auth-modal__subtitle');
      for (var s = 0; s < subtitles.length; s++) {
        if (subtitles[s].hasAttribute('data-yj-da')) subtitles[s].textContent = 'Log ind for at se din profil og book klasser';
        if (subtitles[s].hasAttribute('data-yj-en')) subtitles[s].textContent = 'Sign in to view your profile and book classes';
      }
    }

    cameFromLoggedIn = false;
    showStep('ycf-step-login');
    openModal();
  }

  // Helper: redirect to profile after login-only auth (or call callback)
  function loginOnlyRedirect() {
    loginOnlyMode = false;
    currentProdId = null;
    closeModal();
    if (typeof loginOnlyCallback === 'function') {
      var cb = loginOnlyCallback;
      loginOnlyCallback = null;
      cb();
    } else {
      window.location.href = PROFILE_URL + '/#schedule';
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

    // ── Age bracket toggle ─────────────────────────────────────────
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-ycf-age]');
      if (!btn) return;
      e.preventDefault();
      var targetAge = btn.getAttribute('data-ycf-age');
      if (targetAge === selectedAge) return; // already selected

      selectedAge = targetAge;

      // Update toggle button styles across ALL age toggle widgets
      var allAgeWraps = ['ycf-age-toggle', 'ycf-age-toggle-early', 'ycf-age-toggle-register'];
      for (var aw = 0; aw < allAgeWraps.length; aw++) {
        var ageWrap = $(allAgeWraps[aw]);
        if (ageWrap) {
          var ageBtns = ageWrap.querySelectorAll('[data-ycf-age]');
          for (var ab = 0; ab < ageBtns.length; ab++) {
            ageBtns[ab].classList.toggle('is-active', ageBtns[ab].getAttribute('data-ycf-age') === targetAge);
          }
        }
      }

      // Swap to the equivalent product in the new age bracket
      if (currentProdId && hasAgePricing(currentProdId)) {
        var newProdId = getProdForAge(currentProdId, targetAge);
        currentProdId = newProdId;

        // Clean contract extras before re-populating
        var prodCard = $('ycf-product-info');
        if (prodCard) {
          var extras = prodCard.querySelectorAll('.ycf-product__features,.ycf-product__terms,.ycf-product__saving,.ycf-product__due');
          for (var x = 0; x < extras.length; x++) extras[x].remove();
        }

        populateProduct(currentProdId);
      }
    });

    // ── Language toggle (DA / EN) ──────────────────────────────────
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-ycf-lang]');
      if (!btn) return;
      e.preventDefault();
      var lang = btn.getAttribute('data-ycf-lang');
      if ((lang === 'da') === isDa) return; // already active
      // Clean contract extras before re-populating
      var prodCard = $('ycf-product-info');
      if (prodCard) {
        var extras = prodCard.querySelectorAll('.ycf-product__features,.ycf-product__terms,.ycf-product__saving,.ycf-product__due');
        for (var x = 0; x < extras.length; x++) extras[x].remove();
      }
      switchLanguage(lang);
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
            var code = err.code || '';
            if (code === 'auth/user-not-found' || code === 'auth/invalid-credential') {
              // Try migrating from Mindbody — create account with their password
              fetch(API_BASE + '/migrate-mb-user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email, password: password })
              })
                .then(function(res) { return res.json(); })
                .then(function(data) {
                  if (data.created) {
                    doLogin(email, password, function(err2) {
                      if (err2) {
                        showError('ycf-login-error', authErrorMsg(err2));
                        return;
                      }
                      if (!modal || modal.getAttribute('aria-hidden') === 'true') return;
                      authOriginStep = 'login';
                      trackAuthComplete();
                      pushDataLayer('checkout_funnel_auth_complete', {
                        funnel_stage: 'auth_complete',
                        product_id: currentProdId,
                        product_name: getProductName(currentProdId),
                        product_category: getProductCategory(currentProdId)
                      });
                      if (loginOnlyMode) { loginOnlyRedirect(); return; }
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
                    return;
                  }
                  // Account exists in Firebase — wrong password. Auto-send reset email.
                  if (data.hasFirebaseAccount) {
                    var apiBase = 'https://www.hotyogacph.dk/.netlify/functions';
                    fetch(apiBase + '/send-password-reset', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ email: email, lang: isDa ? 'da' : 'en' })
                    }).catch(function() {});
                    var el = $('ycf-login-error');
                    if (el) {
                      el.innerHTML = t(
                        'Forkert adgangskode. Vi har sendt en email til <strong>' + email + '</strong> s\u00e5 du kan nulstille din adgangskode. Tjek din indbakke (og spam).',
                        'Incorrect password. We\u2019ve sent an email to <strong>' + email + '</strong> to reset your password. Check your inbox (and spam).'
                      );
                      el.hidden = false;
                    }
                    return;
                  }
                  var el = $('ycf-login-error');
                  if (el) {
                    el.innerHTML = t(
                      'Vi kunne ikke finde en konto med disse oplysninger. Allerede klient hos os? <a href="#" data-ycf-action="register" style="color:inherit;font-weight:700;text-decoration:underline">Opret profil</a> med samme email som du booker med. Har du allerede en konto her? <a href="#" data-ycf-action="forgot" style="color:inherit;font-weight:700;text-decoration:underline">Nulstil adgangskode \u2192</a>',
                      'We couldn\'t find an account with these details. Already a client? <a href="#" data-ycf-action="register" style="color:inherit;font-weight:700;text-decoration:underline">Create a profile</a> with the same email you book with. Already have one here? <a href="#" data-ycf-action="forgot" style="color:inherit;font-weight:700;text-decoration:underline">Reset password \u2192</a>'
                    );
                    el.hidden = false;
                  }
                })
                .catch(function() {
                  var el = $('ycf-login-error');
                  if (el) {
                    el.innerHTML = t(
                      'Vi kunne ikke finde en konto med disse oplysninger. Allerede klient hos os? <a href="#" data-ycf-action="register" style="color:inherit;font-weight:700;text-decoration:underline">Opret profil</a> med samme email som du booker med. Har du allerede en konto her? <a href="#" data-ycf-action="forgot" style="color:inherit;font-weight:700;text-decoration:underline">Nulstil adgangskode \u2192</a>',
                      'We couldn\'t find an account with these details. Already a client? <a href="#" data-ycf-action="register" style="color:inherit;font-weight:700;text-decoration:underline">Create a profile</a> with the same email you book with. Already have one here? <a href="#" data-ycf-action="forgot" style="color:inherit;font-weight:700;text-decoration:underline">Reset password \u2192</a>'
                    );
                    el.hidden = false;
                  }
                })
                .finally(function() {
                  if (btn) { btn.disabled = false; btn.textContent = t('Log ind', 'Sign in'); }
                });
              return;
            } else {
              showError('ycf-login-error', authErrorMsg(err));
            }
            return;
          }

          // If onAuthStateChanged already handled this (closed modal / redirected), bail out
          if (!modal || modal.getAttribute('aria-hidden') === 'true') return;

          authOriginStep = 'login';
          // Track auth complete
          trackAuthComplete();
          pushDataLayer('checkout_funnel_auth_complete', {
            funnel_stage: 'auth_complete',
            product_id: currentProdId,
            product_name: getProductName(currentProdId),
            product_category: getProductCategory(currentProdId)
          });

          // Login-only mode: redirect to profile instead of checkout
          if (loginOnlyMode) { loginOnlyRedirect(); return; }

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
            var code = err.code || '';
            if (code === 'auth/email-already-in-use') {
              var el = $('ycf-register-error');
              if (el) {
                el.innerHTML = t(
                  'Der findes allerede en konto med denne email. Vi har sendt dig en email til at oprette din adgangskode. Tjek din indbakke (og spam), eller <a href="#" data-ycf-action="forgot" style="color:inherit;font-weight:700;text-decoration:underline">nulstil adgangskode \u2192</a>',
                  'An account with this email already exists. We\'ve sent you an email to set your password. Check your inbox (and spam), or <a href="#" data-ycf-action="forgot" style="color:inherit;font-weight:700;text-decoration:underline">reset password \u2192</a>'
                );
                el.hidden = false;
              }
              // Send branded reset email via Resend
              var apiBase = 'https://www.hotyogacph.dk/.netlify/functions';
              fetch(apiBase + '/send-password-reset', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email, lang: isDa ? 'da' : 'en' })
              }).catch(function() {});
            } else {
              showError('ycf-register-error', authErrorMsg(err));
            }
            return;
          }

          // If onAuthStateChanged already handled this (closed modal / redirected), bail out
          if (!modal || modal.getAttribute('aria-hidden') === 'true') return;

          // Track auth complete with profile data
          authOriginStep = 'register';
          trackAuthComplete({ firstName: firstName, lastName: lastName, phone: phone });
          pushDataLayer('checkout_funnel_auth_complete', {
            funnel_stage: 'auth_complete',
            product_id: currentProdId,
            product_name: getProductName(currentProdId),
            product_category: getProductCategory(currentProdId)
          });

          // Login-only mode: create MB client then redirect to profile
          if (loginOnlyMode) {
            findOrCreateClient(firstName, lastName, email, phone)
              .then(function () { loginOnlyRedirect(); })
              .catch(function () { loginOnlyRedirect(); });
            return;
          }

          // Create MB client immediately (triggers welcome email) → checkout
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

    // ── Send payment — contracts use mb-contracts, services use mb-checkout
    var realProdId = getRealProdId(currentProdId);
    var isContractPurchase = product._itemType === 'contract';

    clientPromise
      .then(function (clientId) {
        mbClientId = clientId;

        if (isContractPurchase) {
          // Contract purchase via mb-contracts
          var startDateInput = $('ycf-start-date');
          var startDate = (startDateInput && startDateInput.value) || toLocalDateStr(new Date());
          return fetch(API_BASE + '/mb-contracts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              clientId: clientId,
              contractId: Number(realProdId),
              locationId: 1,
              startDate: startDate,
              payment: paymentInfo
            })
          });
        } else {
          // Service purchase via mb-checkout
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
        }
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

        // Track purchase in Firestore + GA
        trackPurchased();
        pushDataLayer('checkout_funnel_purchased', {
          funnel_stage: 'purchased',
          product_id: currentProdId,
          product_name: getProductName(currentProdId),
          product_category: getProductCategory(currentProdId),
          product_price: product.price,
          product_type: isContractPurchase ? 'contract' : 'service'
        });

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

    // ── "Book a class" buttons on success step — redirect to profile booking ──
    document.addEventListener('click', function (e) {
      if (e.target.id === 'ycf-go-profile' || e.target.id === 'ycf-go-profile-en') {
        e.preventDefault();
        // Clear prodId before close so abandonment tracking is skipped
        currentProdId = null;
        closeModal();
        window.location.href = PROFILE_URL + '/#schedule';
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

    // GA tracking for CTA click
    pushDataLayer('checkout_funnel_cta_click', {
      funnel_stage: 'cta_click',
      product_id: prodId,
      product_name: getProductName(prodId),
      product_category: getProductCategory(prodId),
      source_page: window.location.pathname,
      source_site: 'hotyogacph.dk'
    });

    // Track CTA click to Firestore (if user is already logged in)
    trackFunnelStage('cta_click');

    console.log('[HYC Embed] Checkout started for prodId:', prodId);

    // Open the checkout flow modal
    openCheckoutFlow(prodId);
  }

  // ── Part 5: Auth listener, CTA binding, boot, public API, IIFE close

  // ── 5A: Firebase auth state listener ────────────────────────────────
  // If the user is already signed in when the modal opens (e.g. they
  // refreshed, or the embed page already has a Firebase session) we
  // skip auth steps and go straight to checkout (Step 3).

  // ── Session persistence helpers (shared with login-cta.js) ────────
  var SESSION_KEY = 'hyc_auth_token';
  function _parentStorage() {
    // Try parent localStorage first (survives tab close + page nav)
    try { var s = window.top.localStorage; s.getItem('_'); return s; }
    catch (e) { /* cross-origin */ }
    // Try own localStorage
    try { var s2 = window.localStorage; s2.getItem('_'); return s2; }
    catch (e) { /* sandboxed */ }
    // Try parent sessionStorage
    try { var s3 = window.top.sessionStorage; s3.getItem('_'); return s3; }
    catch (e) { /* cross-origin */ }
    // Try own sessionStorage
    try { var s4 = window.sessionStorage; s4.getItem('_'); return s4; }
    catch (e) { /* sandboxed */ }
    return null;
  }
  function persistAuthToken(user) {
    if (!user) return;
    user.getIdToken().then(function (t) {
      var s = _parentStorage();
      if (s) s.setItem(SESSION_KEY, t);
    }).catch(function () {});
  }
  function clearAuthToken() {
    var s = _parentStorage();
    if (s) s.removeItem(SESSION_KEY);
  }

  // ── Cross-iframe auth sync (polling — shared with login-cta.js) ─
  var _cePollingStarted = false;

  function startAuthPolling() {
    if (_cePollingStarted) return;
    _cePollingStarted = true;
    setInterval(function () {
      if (typeof firebase === 'undefined' || !firebase.auth) return;
      var s = _parentStorage();
      var hasToken = s && s.getItem(SESSION_KEY);

      if (hasToken && !firebase.auth().currentUser) {
        // Another iframe logged in — restore from shared token
        var token = s.getItem(SESSION_KEY);
        fetch(API_BASE + '/auth-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: token })
        })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data.customToken) return firebase.auth().signInWithCustomToken(data.customToken);
          })
          .catch(function () {});
      } else if (!hasToken && firebase.auth().currentUser) {
        firebase.auth().signOut();
      }
    }, 2000);
  }

  // ── Cross-iframe auth sync via shared bridge iframe ─────────────────
  // Storage-based sync (_parentStorage) is unreliable in cross-origin
  // srcdoc iframes (Safari, Chrome 115+). We load a hidden iframe from
  // profile.hotyogacph.dk/auth-sync.html which has real localStorage
  // and relays auth events between sibling embeds.
  var _ceSyncFrame = null;
  var _ceSyncReady = false;
  var _ceSyncQueue = [];

  function initAuthSyncBridge() {
    try {
      var f = document.createElement('iframe');
      f.src = 'https://profile.hotyogacph.dk/auth-sync.html';
      f.style.cssText = 'display:none;width:0;height:0;border:0';
      f.setAttribute('aria-hidden', 'true');
      document.body.appendChild(f);
      _ceSyncFrame = f;
      f.addEventListener('load', function () {
        _ceSyncReady = true;
        for (var i = 0; i < _ceSyncQueue.length; i++) {
          try { f.contentWindow.postMessage(_ceSyncQueue[i], '*'); } catch (x) {}
        }
        _ceSyncQueue = [];
        // Ask bridge if anyone is already logged in
        try { f.contentWindow.postMessage({ type: 'hyc-auth-sync', action: 'query' }, '*'); } catch (x) {}
      });
    } catch (e) { /* iframe blocked */ }
  }

  function sendToSyncBridge(msg) {
    if (_ceSyncReady && _ceSyncFrame && _ceSyncFrame.contentWindow) {
      try { _ceSyncFrame.contentWindow.postMessage(msg, '*'); } catch (e) {}
    } else {
      _ceSyncQueue.push(msg);
    }
  }

  function broadcastAuthChange(user) {
    if (!user) {
      sendToSyncBridge({ type: 'hyc-auth-sync', action: 'logout' });
      return;
    }
    user.getIdToken().then(function (token) {
      sendToSyncBridge({ type: 'hyc-auth-sync', action: 'login', idToken: token });
    }).catch(function () {});
  }

  var _ceSyncListening = false;
  function listenForAuthSync() {
    if (_ceSyncListening) return;
    _ceSyncListening = true;
    window.addEventListener('message', function (e) {
      try {
        if (!e.data || e.data.type !== 'hyc-auth-sync') return;
        if (e.data.action === 'login' && e.data.idToken && !firebase.auth().currentUser) {
          fetch(API_BASE + '/auth-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken: e.data.idToken })
          })
            .then(function (r) { return r.json(); })
            .then(function (data) {
              if (data.customToken) return firebase.auth().signInWithCustomToken(data.customToken);
            })
            .catch(function () {});
        } else if (e.data.action === 'logout' && firebase.auth().currentUser) {
          firebase.auth().signOut();
        }
      } catch (x) {}
    });
  }

  function initAuthListener() {
    // Poll for Firebase availability then listen for auth state
    var checkInterval = setInterval(function () {
      if (typeof firebase !== 'undefined' && firebase.auth) {
        clearInterval(checkInterval);
        initAuthSyncBridge();
        listenForAuthSync();
        firebase.auth().onAuthStateChanged(function (user) {
          // Persist / clear token so login survives page reloads
          if (user) persistAuthToken(user);
          else clearAuthToken();
          // Broadcast to sibling iframes via bridge
          broadcastAuthChange(user);

          if (!user) return;

          // If modal is not open, nothing to do yet
          if (!modal || modal.getAttribute('aria-hidden') !== 'false') return;

          // If we are still on login / register step, advance to checkout
          var loginStep    = $('ycf-step-login');
          var registerStep = $('ycf-step-register');
          var loginVisible    = loginStep && !loginStep.hidden;
          var registerVisible = registerStep && !registerStep.hidden;

          if (loginVisible || registerVisible) {
            // Login-only mode: redirect to profile
            if (loginOnlyMode) {
              console.log('[HYC Embed] Auth state changed (login-only) — redirecting to profile');
              loginOnlyRedirect();
              return;
            }
            console.log('[HYC Embed] Auth state changed while modal open — advancing to checkout');
            mbClientId = null;
            var displayName = user.displayName || '';
            var nameParts = displayName.split(' ');
            resolveClientAndAdvance(
              nameParts[0] || 'User',
              nameParts.slice(1).join(' ') || '',
              user.email || '',
              ''
            );
          }
        });
      }
    }, 100);
    // Stop polling after 10s
    setTimeout(function () { clearInterval(checkInterval); }, 10000);
  }

  // ── 5B: CTA button binding ──────────────────────────────────────────
  // Attach click handlers to any element with data-checkout-product.
  // Works for buttons injected dynamically (Framer, CMS, etc.) via
  // a MutationObserver fallback.

  function attachCTAButtons() {
    // Checkout product buttons
    var buttons = document.querySelectorAll('[data-checkout-product]');
    buttons.forEach(function (btn) {
      if (btn._ycfBound) return;
      btn._ycfBound = true;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var prodId = btn.getAttribute('data-checkout-product');
        startCheckoutEmbed(prodId);
      });
    });

    // Login trigger buttons (e.g., nav LOGIN link)
    // Usage: <a href="#" data-login-trigger>LOGIN</a>
    var loginBtns = document.querySelectorAll('[data-login-trigger]');
    loginBtns.forEach(function (btn) {
      if (btn._ycfLoginBound) return;
      btn._ycfLoginBound = true;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        openLoginModal();
      });
    });
  }

  // Re-scan for CTA buttons when the DOM changes (Framer lazy-loads)
  function observeCTAButtons() {
    if (typeof MutationObserver === 'undefined') return;
    var observer = new MutationObserver(function () { attachCTAButtons(); });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ── 5C: Boot sequence ──────────────────────────────────────────────
  // Runs once on DOMContentLoaded (or immediately if DOM is already ready).

  function boot() {
    injectCSS();
    injectModalHTML();

    // Cache the modal reference now that HTML is injected
    modal = document.getElementById('ycf-modal');

    // Initialize Firebase before wiring events that depend on auth
    loadFirebaseSDK(function () {
      wireAuthEvents();
      wireCheckoutEvents();
      wireCardFormatting();
      attachCTAButtons();
      observeCTAButtons();
      initAuthListener();
      startAuthPolling();

      console.log('[HYC Embed] Checkout embed booted — ' + Object.keys(PRODUCTS).length + ' products loaded');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // ── 5D: Public API ─────────────────────────────────────────────────
  // Framer pages call: startCheckoutEmbed('100174')
  // or use: <button data-checkout-product="100174">Buy</button>

  window.startCheckoutEmbed = startCheckoutEmbed;
  window.openCheckoutFlow   = openCheckoutFlow;
  window.openLoginModal     = openLoginModal;

  // Expose funnel helpers for external analytics / debugging
  window.HYCCheckout = {
    open:                  openCheckoutFlow,
    start:                 startCheckoutEmbed,
    login:                 openLoginModal,
    loadFunnel:            loadFunnel,
    clearFunnel:           clearFunnel,
    trackAuthComplete:     trackAuthComplete,
    trackCheckoutOpened:   trackCheckoutOpened,
    trackPurchased:        trackPurchased,
    trackCheckoutAbandoned: trackCheckoutAbandoned,
    pushDataLayer:         pushDataLayer,
    getProductName:        getProductName,
    getProductCategory:    getProductCategory,
    PRODUCTS:              PRODUCTS
  };

})();
