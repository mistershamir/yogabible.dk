# Changelog — Yoga Bible DK

> Chronological record of major changes, integrations, and updates.
> **Last updated: 2026-02-14**

---

## 2026-02-14

### Store: Teacher Training & Courses Activated
- **Teacher Training category:** 5 deposit cards (3,750 kr each) for 200hr YTT programs
  - 18-Week Flexible (March–June 2026) — prodId: 100078
  - 4-Week Intensive (April 2026) — prodId: 100121
  - 4-Week Intensive (July 2026) — prodId: 100211
  - 8-Week Semi-Intensive (May–June 2026) — prodId: 100209
  - 18-Week Flexible (August–December 2026) — prodId: 100210
  - Info banner explaining deposit benefits (class access, preparation, hours counting)
  - VAT-exempt labeled as "education" not "under 30"
- **Courses category:** Interactive course builder
  - 3 courses: Inversions (100145), Splits (100150), Backbends (100140)
  - Bundle discounts: 2 courses = 10% off, 3 courses = 15% off + free 30-day unlimited pass (1,249 kr value)
  - 2-course bundles: Inv+Back=119, Inv+Splits=120, Back+Splits=121
  - All-In bundle: prodId 127
  - Toggle selection cards with live pricing summary
- Removed "coming soon" state for teacher & courses (only private remains)

### Profile Tab Changes
- Gift Cards tab replaced Courses tab in navigation
- Merge conflict resolved: kept giftcards tab, removed courses tab from main branch

### Documentation
- Updated `profile-architecture.md` with all latest changes
- Created `store-catalog-reference.md` — complete product/pricing reference
- Created `debug-notes-and-lessons.md` — debugging findings compilation
- Created this `changelog.md`

---

## 2026-02-13

### Mindbody Suspend API Fix
- Confirmed correct parameter is `SuspensionStart` (NOT `SuspendDate`)
- `mb-contract-manage.js` updated with correct parameter
- Future-dated suspension starts now work correctly
- Duration + DurationUnit calculate resume date automatically
- Documented in `email-mindbody-support.md`

### Pause Button Re-enablement
- Pause buttons re-added to My Passes tab
- Changed from date pickers to 1/2/3 month duration selector (simpler UX)
- Firestore pause bridge maintained for cross-device sync

---

## 2026-02-12

### Store Rewrite: Catalog-Based Architecture
- **Major change:** Rewrote store from API-fetch to hardcoded `storeCatalog`
- Added two-level category navigation (top categories → subcategories)
- 4 top-level categories: Daily Classes, Teacher Training, Courses, Private
- 6 Daily subcategories: Memberships, Time-based, Clips, Trials, Tourist, Test
- Age bracket pricing (under30/over30) with automatic VAT calculation
- Full product catalog with all Mindbody prodIds
- Search bar with real-time filtering
- Enhanced card display: badges, per-class pricing, sharing details, validity

### Cross-Studio Feature Sync
- Synced profile features between Yoga Bible and Hot Yoga CPH
- Ported store catalog system to both sites

---

## 2026-02-11

### Cross-Category Pass Validation
- Implemented ClassId-filtered `clientservices` check for booking
- Mindbody determines which passes are valid per class (respects Service Category Relationships)
- Documented in `CROSS-CATEGORY-PASS-VALIDATION.md`

---

## 2026-02-10

### Receipts Rewrite
- 3-source merge strategy for complete purchase history:
  - `/sale/sales` — rich invoice data with line items
  - `/client/clientservices` — passes (cross-referenced for pricing)
  - `/client/clientcontracts` — memberships (price from autopay events)
- HTML invoice generation with print/PDF support
- Invoice includes: company header, line items, VAT, bank details, payment info
- Danish formatting throughout (CVR, IBAN, date format)

### Membership Management UX Change
- Removed self-serve pause/cancel buttons (suspend API was broken)
- Added info box directing users to email `info@yogabible.dk`
- Retained status displays: paused badge, terminated badge, retention card

### Documentation Created
- `profile-architecture.md` — 36 KB frontend deep dive
- `function-catalog.md` — all 18 Netlify functions
- `PAYMENT-INTEGRATION.md` — complete payment reference
- `REPLICATION-GUIDE.md` — step-by-step brand replication
- `api-reference.md` — all MB API gotchas

---

## 2026-02-09

### Registration Consent System
- Added consent checkboxes: T&C, Privacy Policy, Code of Conduct
- Firestore audit trail: individual records per document per user
- Consent version tracking for re-consent when policies update
- `consents` collection with write-only security rules

### Hot Yoga CPH Member Area Plan
- Created infrastructure plan for standalone member area at `profile.hotyogacph.dk`
- 6-tab dashboard, separate Firebase project, same Mindbody Site ID
- Teal branding (#3f99a5), localStorage-based i18n toggle
- 26-file replication map documented in `hot-yoga-cph-member-area/PLAN.md`

### Yoga Bible App Architecture
- React Native + TypeScript app design documented
- 5 screens: Home, Schedule, Library, Courses, Profile
- Mux video (HLS + DRM) for content delivery
- 4-phase roadmap: MVP mobile → content → TV apps → advanced

---

## Key Integration Points

### Mindbody API v6
- Site ID: 5748831
- Base URL: `https://api.mindbodyonline.com/public/v6`
- Auth: Staff token with 6-hour cache
- 18 Netlify function proxies in `netlify/functions/mb-*.js`

### Firebase
- Project: yoga-bible-dk-com
- Auth: Email/password
- Firestore: User profiles, consent audit trail, course materials, pause bridge
- Shared between Yoga Bible DK and Hot Yoga CPH

### Netlify
- Deploy from `main` branch
- Functions: serverless proxies for Mindbody
- Environment: `MB_API_KEY`, `MB_SITE_ID`, `MB_USERNAME`, `MB_PASSWORD`

### Instagram DM Automation
- Meta Webhook integration
- 13 keyword triggers (HEJ, 200HR, KURSER, etc.)
- Firestore analytics tracking
- Setup documented in `instagram-dm-setup.md`
