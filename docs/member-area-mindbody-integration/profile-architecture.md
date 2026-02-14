# Profile Page Architecture — Frontend Reference

> Frontend architecture for the member area profile page (`src/js/profile.js`, ~3700 lines).
> Adapt for each brand's design system. **Last updated: 2026-02-14** — reflects catalog-based store rewrite, teacher training deposits, course builder, gift cards tab (replacing courses), pause button re-enablement (1/2/3 month selector), waiver management, and stored card system.

## Overview

Single-page profile dashboard with 7 tabs. Each tab lazy-loads data on first click. All data comes from Netlify Functions (Mindbody proxy) except Profile (Firestore).

```
┌─────────────────────────────────────────────────────────────┐
│  Header: Avatar | Name | Email | Tier Badge                  │
│                                                               │
│  ┌─ ONBOARDING CARD (shown until phone+DOB filled) ────────┐ │
│  │  "Welcome! Let's complete your profile"                   │ │
│  │  [Phone*] [Date of Birth*]                                │ │
│  │  [Save and continue]                                      │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                               │
│  Reminder Banner (soft — if phone/DOB missing)                │
├─────────────────────────────────────────────────────────────┤
│  [Profil] [Skema] [Butik] [Besøg] [Mine Pas] [Kvit] [Gavekort]│
├─────────────────────────────────────────────────────────────┤
│  Tab Content (lazy-loaded on first click)                     │
└─────────────────────────────────────────────────────────────┘
```

## Init Flow

```
1. Poll for Firebase SDK readiness (setInterval 100ms)
2. init() — attach tab handlers, store form, schedule nav, avatar upload, visit filters, onboarding form
3. onAuthStateChanged → if logged in:
   a. loadProfile(user, db) — populate form from Firestore
      → If phone or DOB missing: show onboarding overlay, hide tabs
      → If both present: hide overlay, show tabs normally
   b. ensureBackendClient(user, db) — find-or-create Mindbody client
   c. Deep-link to courses tab via #mine-kurser / #my-courses hash
4. Onboarding form submit → save to Firestore + push to MB → dismiss overlay → show tabs
5. First tab click triggers lazy data fetch
```

## Global State Variables

```javascript
// ── Auth & User ──
var currentUser = null;          // Firebase auth user
var currentDb = null;            // Firestore instance
var clientId = null;             // Mindbody client ID (from Firestore users/{uid})
var userDateOfBirth = null;      // DOB for age bracket pricing (under30/over30)

// ── Cached Data ──
var clientPassData = null;       // Cached pass/service data (mb-client-services response)
var staffCache = {};             // Teacher bios by staffId (session-persistent, never cleared)
var storedCardData = null;       // Cached stored credit card info { cardType, lastFour, holderName, ... }
var tabLoaded = {};              // Track which tabs have been loaded (prevents re-fetch)

// ── Schedule ──
var scheduleWeekOffset = 0;      // Week navigation: 0 = current, -1 = last, 1 = next

// ── Visits ──
var allVisits = [];              // Cached visits for client-side filtering
var activeVisitFilter = 'all';   // Visit filter: all|upcoming|attended|lateCancelled|noshow
var visitsPeriod = '90';         // Visit history lookback (days)

// ── Receipts ──
var receiptsPeriod = '365';      // Receipts lookback (days)

// ── Store (catalog-based since 2026-02-12) ──
var storeServices = [];          // Normalized items built from storeCatalog (age-bracket aware)
var storeView = 'categories';    // 'categories' (top-level) or 'items' (inside a category)
var storeTopCategory = null;     // Active top category: 'daily'|'teacher'|'courses'|'private'
var storeSubCategory = 'all';    // Active sub category: 'memberships'|'clips'|'timebased'|'trials'|'tourist'|'test'|'all'
var storeSearchQuery = '';       // Store search bar text (real-time filtering)
var selectedCourses = [];        // Course builder: selected course IDs for bundle calculation

// ── Waiver ──
var waiverSigned = false;        // Liability waiver sign status
var waiverStatusLoaded = false;  // Has waiver status been checked (3-tier: localStorage → Firestore → MB)
var checkoutSigPad = null;       // Signature pad instance for checkout/waiver
```

## Tab Details

### 1. Profile Tab (Profil)

**Data source:** Firebase Auth + Firestore `users/{uid}`

**Fields displayed:**
- First name, last name, email (read-only), phone, date of birth
- Yoga level (select), practice frequency (select)
- Avatar (photo upload — resized to 200x200, saved as base64 JPEG to Firestore)
- Member since date
- Mindbody Client ID (shown if linked)
- Membership tier badge (calculated from pass data, not stored)

**Profile save flow:**
1. Validate first + last name required
2. Update Firebase Auth `displayName`
3. Update Firestore `users/{uid}` (firstName, lastName, phone, dateOfBirth, yogaLevel, practiceFrequency, etc.)
4. Silently sync to Mindbody via `PUT /.netlify/functions/mb-client` (includes phone + birthDate)
5. Hide reminder banner + dismiss onboarding overlay if phone + DOB now complete

**Simplified to:**
- Tier badge + Mindbody Client ID display only
- Membership details moved to dedicated "My Passes" tab (see section 3.5)

### 0. Mandatory Onboarding Overlay

**Trigger:** Shown when `loadProfile()` finds phone OR dateOfBirth missing in Firestore.

**Behavior:**
- Hides all tab buttons + tab panels (`display: none`)
- Shows centered card with phone + DOB form (both required, marked with `*`)
- User cannot interact with any tab until form is submitted
- Pre-fills any existing partial data (e.g., phone exists but DOB is missing)

**Submit flow:**
1. Validate phone is not empty
2. Validate DOB is not empty
3. Update Firestore `users/{uid}` with `phone` + `dateOfBirth`
4. Push to Mindbody via `PUT /.netlify/functions/mb-client` with `phone` + `birthDate`
5. If `clientId` isn't ready yet (async), poll every 1s for up to 15s before pushing
6. Hide onboarding overlay, restore tab display
7. Also hides the soft reminder banner

**Translations:** `onboarding_title`, `onboarding_desc`, `onboarding_submit`, `onboarding_note`, `onboarding_error_phone`, `onboarding_error_dob`, `onboarding_saving` — in both `profile.json` and `t()` map.

**HTML location:** `profile.njk` → `#yb-onboarding-overlay` div inside `#yb-profile-user`, before the tab navigation.

**CSS:** `.yb-onboarding` (flex center), `.yb-onboarding__card` (warm white card, 440px max-width, 16px border-radius, light shadow).

### 2. Schedule Tab (Skema)

**Data source:** `mb-classes` + `mb-visits` (parallel fetch)

**Week navigation:**
- Week offset 0 = today through Sunday (partial week)
- Week offset ±N = full Mon–Sun week
- Label shows date range with locale formatting

**Parallel data fetch:**
```
Promise.all([
  fetch(mb-classes?startDate=X&endDate=Y&clientId=Z),   // class schedule
  fetch(mb-visits?clientId=Z&startDate=X&endDate=Y)      // for booking detection
])
```
- Visits used to build `bookedClassIds` set → mark classes as `isBooked`
- This cross-referencing is necessary because MB `Clients[]` array on classes is unreliable

**Pass info banner (smart logic):**
1. Fetches `mb-client-services` (cached in `clientPassData`)
2. Has active services → show pass name + remaining clips
3. Remaining < 3 → show orange "Snart opbrugt — overvej at fylde op" warning
4. Has active contracts → show membership name + renewal date (green accent)
5. Has ANY active pass/contract → **never** show "buy pass" banner
6. No passes at all → show "buy pass" banner linking to Store tab

**Class card display:**
- Grouped by day, sorted by start time within each day
- Shows: time range, class name, instructor (clickable for bio), spots warning (≤7)
- Description toggle (HTML from Mindbody, rendered with orange left border)
- Action buttons: Book (future + available), Cancel (booked), Join Waitlist (full), badge (cancelled/past)

**Booking flow (3-tier validation):**
1. **Has clientId?** No → show "buy a pass" error + banner
2. **Has ANY active pass?** No → show "buy a pass" error + banner
3. **`clientCanBook(programId)`** — frontend check:
   - Active contracts → always true (memberships cover all programs)
   - Active services → match `service.programId === class.programId`
   - No pass data loaded → true (let backend decide)
4. POST to `mb-book` → server validates again → books
5. On success: swap Book → Cancel button, refresh pass data (clip used)
6. On `no_pass` error: show buy-pass banner, hide pass info
7. On `alreadyBooked`: treated as success

**Cancel flow:**
1. DELETE to `mb-book` with `{ clientId, classId }`
2. On success: swap Cancel → Book button, refresh pass data (clip returned)
3. On late cancel (`data.lateCancel`): show warning toast
4. Late cancel toast is rich HTML with wellness note (6s timeout vs 3.5s normal)

**Teacher bio expansion:**
- Clickable instructor name → toggles bio panel
- First click: fetches `mb-staff?staffId=X` → cached in `staffCache`
- Subsequent clicks: uses cache (never refetched during session)
- Shows: photo, name, bio text

**Waitlist:**
- Shown when `spotsLeft === 0`
- POST to `mb-waitlist` with `{ clientId, classScheduleId }`
- On success: button changes to "På venteliste" (disabled)

### 3. Store Tab (Butik) — Rewritten 2026-02-12, updated 2026-02-14

**Data source:** Hardcoded `storeCatalog` object in profile.js (NOT fetched from Mindbody API)

**Architecture change (2026-02-12):** The store was rewritten from API-fetch to a hardcoded catalog model. Products, pricing, and VAT are defined in `storeCatalog` and built into `storeServices[]` at runtime based on the user's age bracket (under30/over30). This ensures reliable display, correct pricing tiers, and eliminates dependency on Mindbody's inconsistent service listing.

**Two-level navigation:**
1. **Top-level categories** — 4 large card buttons: Daily Classes, Teacher Training, Courses, Private Classes
2. **Inside a category** — subcategory pills (Daily only) + search + product cards

**Top-level categories (`storeTopCategories`):**
| ID | DA | EN | Status |
|----|----|----|--------|
| `daily` | Daglige Klasser | Daily Classes | Active — clips, memberships, timebased, trials, tourist, test |
| `teacher` | Yogalæreruddannelse | Yoga Teacher Training | Active — 5 deposit cards |
| `courses` | Kurser | Courses | Active — course builder with bundle discounts |
| `private` | Privattimer | Private Classes | Coming soon — shows toast on click |

**Daily Classes subcategories (`storeDailySubs`):**
| ID | DA | EN |
|----|----|----|
| `memberships` | Medlemskab | Memberships |
| `timebased` | Tidsbegrænsede pas | Time-based Passes |
| `clips` | Klippekort | Clip Cards |
| `trials` | Prøvekort | Trial Passes |
| `tourist` | Turistpas | Tourist Pass |
| `test` | Test | Test |

**Age bracket pricing:**
- Determined by `getAgeBracket()` which checks user's DOB vs 30-year threshold
- Under-30: VAT-exempt (0%) for clips & time-based passes
- Over-30: Standard 25% VAT
- Teacher training: Always VAT-exempt (education, not age-based) — shows "Momsfrit (uddannelse)"
- Courses: Always VAT-exempt

**Store catalog structure (see `docs/store-catalog-reference.md` for full product list):**
```javascript
storeCatalog = {
  clips:       { over30: [...], under30: [...] },      // 1-200 class clip cards
  memberships: { over30: [...], under30: [...] },      // 10/Unlimited/Premium monthly contracts
  timebased:   { over30: [...], under30: [...] },      // 14d to 12+1 month unlimited passes
  trials:      { over30: [...], under30: [...] },      // Refs to clips/timebased + KickStarter
  tourist:     { over30: [...], under30: [...] },      // 7-day pass incl. mat/towel
  teacher:     [...],                                   // 5 YTT deposit items (non-age-bracketed)
  courses:     { single_price, discounts, items, bundles }, // Course builder config
  test:        { over30: [...], under30: [...] }       // Dev test items
}
```

**Teacher Training category (added 2026-02-14):**
- 5 deposit cards, all 3,750 kr, VAT-exempt (education)
- Info banner at top explains deposit benefits: class access, preparation, hours toward training
- Each card shows: program format, period (e.g., "Marts – Juni 2026"), description
- "Betal depositum" / "Pay deposit" CTA button
- Routed through standard `mb-checkout` as service purchase

**Courses category — Course Builder (added 2026-02-14):**
- Custom interactive UI (NOT standard card grid) with toggle-based course selection
- 3 courses available: Inversions, Splits, Backbends (each 2,300 kr)
- Bundle discount logic:
  - 1 course: full price (2,300 kr)
  - 2 courses: 10% off total (4,140 kr)
  - 3 courses (All-In): 15% off total (5,865 kr) + FREE 30-day unlimited pass (value 1,249 kr)
- Live pricing summary updates as user toggles courses
- Maps to correct Mindbody prodIds based on selection:
  - Singles: Inversions=100145, Splits=100150, Backbends=100140
  - 2-course bundles: Inv+Back=119, Inv+Splits=120, Back+Splits=121
  - All-In: 127
- Bundle key format: sorted alphabetically, pipe-separated (e.g., `backbends|inversions|splits`)
- "Read more" links to `/inversions`, `/splits`, `/backbends`
- Course builder has its own `renderCourseBuilder()` and `attachCourseBuilderHandlers()` functions
- `getCourseCheckoutItem()` creates temporary service objects for bundles and routes to `openCheckout()`

**Search bar:**
- Real-time text filtering by item name
- `storeSearchQuery` state variable persisted across re-renders
- Clear button (×) shown when search active
- Empty state shows "No results for {query}" when search finds nothing

**Enhanced item cards:**
- **Badges row:** "First month free", "Popular", "Best deal", "Incl. mat & towel", "CPH only", "Membership", "Deposit"
- **Per-class pricing:** Shown for clip cards
- **Validity period:** "30 days from first booking" etc.
- **Sharing details:** For large clip cards (60+), persons + instructions collapsible
- **Membership features:** Checkmark list + terms + T&C link
- **Teacher deposits:** Calendar icon + period + format badge
- **Buy button:** "Køb" (standard) / "Betal depositum" (deposits) / "Køb nu" (course builder)

**Checkout overlay (two-column layout):**
- **Left column** (conditionally shown):
  - Liability Waiver section (if not already signed)
  - Contract Terms section (if purchasing a contract/membership)
  - Unified agree checkbox + signature pad (canvas)
  - Grid switches to `yb-checkout__grid--split` when documents are shown
- **Right column** (always shown):
  - Stored card radio toggle (if user has saved card)
  - Card input fields (cardholder, number, expiry, CVV)
  - Address fields (address, city, zip)
  - "Save card" checkbox
  - Submit/Cancel buttons

**Checkout flow (dual routing):**
- **Service checkout:** POST to `/.netlify/functions/mb-checkout`
  ```json
  { "clientId": "X", "items": [{"type":"Service","id":123,"quantity":1}], "amount": 799, "payment": {...} }
  ```
- **Contract checkout:** POST to `/.netlify/functions/mb-contracts` (routes to `/sale/purchasecontract`)
  ```json
  { "clientId": "X", "contractId": 456, "locationId": 1, "startDate": "2026-02-08", "payment": {...}, "promoCode": "...", "clientSignature": "data:image/png;..." }
  ```
- Payment info shape: `{ cardNumber, expMonth, expYear, cvv, cardHolder, billingAddress, billingCity, billingPostalCode, saveCard }` OR `{ useStoredCard: true, lastFour: "1234" }`
- Card formatting: auto-spaces every 4 digits, expiry auto-formats MM/YY
- Promo code: passed as `promoCode` in contract purchase body
- SCA: shows "card requires additional authentication" message
- No clientId? → syncs via `mb-sync` first, then retry

**After successful purchase:**
- Hides checkout, shows success panel with "Book a class" → Schedule tab CTA
- Resets form, clears left column sections
- Saves card locally if "save card" checked
- Clears `clientPassData` cache and reloads membership details

### 3.5. My Passes Tab (Mine Pas)

**Data source:** `mb-client-services` (same as membership details)

**Lazy loaded:** Fetches data on first tab click via `loadMembershipDetails()`

**Sections displayed:**
1. **Active passes** — service name, remaining clips (or "Unlimited"), expiration date, active badge
2. **Active contracts** — contract name, autopay info, billing date, status badge, manage buttons
3. **Past passes** — expired services listed below active ones

**Contract status display:**
- **Active:** Green badge, shows "Next billing {date}", info box with contact instructions for pause/cancel
- **Paused/Suspended:** Amber badge, pause dates, auto-resume message, contact info for changes
- **Terminated (before date):** "Membership Terminated" red badge, "Last billing {date}", "Active until {date}", notice period note with T&C link, retention card
- **Terminated (after date):** "Membership Terminated" red badge, "Become a member again" button

**Membership management (updated 2026-02-14):**
- **Pause button re-enabled** with 1/2/3 month duration selector (replaced date picker UX)
- User clicks "Pause" → shown 3 pill buttons: 1 month, 2 months, 3 months
- Calls `/.netlify/functions/mb-contract-manage` with `action: 'pause'`, `monthsToSuspend`
- Pause persisted to Firestore `users/{uid}/pauses/pause_{contractId}` for cross-device sync
- **Cancel** still contact-based — info box directs to `info@yogabible.dk` (no self-serve cancellation)
- **Suspend API fixed (2026-02-13):** Correct parameter is `SuspensionStart` (NOT `SuspendDate`). Future-dated starts supported.
- **Still no API for:** delete/cancel suspension, cancel/revoke termination (admin UI only)
- Paused contracts show: amber badge, pause period dates, auto-resume note, "Reactivate" button
- Backend `mb-contract-manage.js` uses correct `SuspensionStart` parameter

**Retention card (terminated contracts, before termination date):**
- Heart icon, "We already miss you!" title
- "Reactivate before {date} and save the registration fee"
- Checkmark perks: "No new registration fee", "First month free"
- "Reactivate — first month free" CTA button
- CTA navigates to Store tab → Memberships category → auto-opens matching contract checkout
- Contract matching: first by template ID (`contractId`), fallback by name match in `storeServices[]`

**Rejoin CTA (terminated contracts, after termination date):**
- Simple full-width "Become a member again" / "Bliv medlem igen" button
- Navigates to Store tab → Memberships category

**Termination date calculation:**
```
nextBillingDate = March 8, 2026
lastPaymentDate = March 8 (the next billing)
useUntilDate    = April 7 (March 8 + 1 month - 1 day)
terminationDate = useUntilDate (sent to Mindbody API)
```
If `nextBillingDate` is in the past, use today as the base date.

### 4. Visit History Tab (Besøgshistorik)

**Data source:** `mb-visits`

**Time period picker:** 30, 90, 180, 365 days (select dropdown)
- Always adds 30 days into the future for upcoming bookings

**Filter pills:** All / Upcoming / Attended / Late Cancelled / No-show
- Filters applied client-side on cached `allVisits` array
- **Critical datetime fix:** Uses `new Date(v.startDateTime) > now` (full datetime comparison), NOT date-only. This ensures an 8am class correctly becomes "past" at 8:01am.

**Status determination:**
```
if (lateCancelled)           → Late Cancelled (amber)
else if (classTime > now)    → Booked/Upcoming (orange)
else if (signedIn)           → Attended (green)
else                         → No-show (red)
```

**Status summary bar:** Counts from ALL visits (not just filtered), shown above table

**Sorting:** Upcoming first (ascending by date), then past (descending by date)
- Two-pass sort: upcoming items sorted earliest-first, past items sorted newest-first

### 5. Receipts Tab (Kvitteringer) — Updated 2026-02-10

**Data source:** `mb-purchases` — fetches ALL 3 Mindbody sources in parallel:
1. `/sale/sales` (365-day window) — rich invoice data with line items, payments, tax
2. `/client/clientservices` — passes (no price field, enriched via cross-reference)
3. `/client/clientcontracts` — memberships (price from `UpcomingAutopayEvents`)

**Time period picker:** 90, 180, 365, 730 days (select dropdown, default 730)

**Receipt card displays:**
- Date, item description, sale reference number
- Refunded badge (if returned)
- Multi-item support: shows each line item with individual price
- Details grid: Total amount (DKK), Payment method, VAT/tax, Discount, Location

**Download invoice (HTML → PDF):**
- `generateInvoiceHTML(purchase)` creates a full professional invoice
- Opens in new browser window — user prints/saves as PDF
- Falls back to HTML file download if popup is blocked
- Invoice includes:
  - **Business header:** Yoga Bible, 66 Torvegade, 1400 København, CVR 41295252
  - **Bill To:** Customer name + Mindbody client ID
  - **Invoice meta:** Invoice number (Aps-XXXXXXXX), Sale ID, dates
  - **Line items table:** Description, Qty, Unit Price, VAT%, VAT, Amount
  - **Totals:** Subtotal, Discount, VAT, Invoice Total
  - **Payment adjustment:** Method, date, amount (with negative notation)
  - **Amount Due** box + "Paid" stamp when fully paid
  - **Footer:** Bank details (Reg 3409, Acc 13011206, Danske Bank, IBAN DK7430000013011206)
- Print button styled with brand orange, hidden on print via `@media print`

### Membership Management (within My Passes Tab) — Updated 2026-02-14

**Current state:** Pause button **re-enabled** with 1/2/3 month duration selector. Cancel remains contact-based (email `info@yogabible.dk`).

**Pause UX (re-enabled 2026-02-14):**
- "Pause" button shows on active, non-suspended contracts
- Click reveals 3 pill buttons: 1 month, 2 months, 3 months
- POST to `mb-contract-manage` with `action: 'pause'`, `monthsToSuspend`
- On success: contract shows amber "Paused" badge with period dates + auto-resume note
- "Reactivate" button searches store for matching contract and opens checkout

**Cancel UX (contact-based):**
- Info box directing users to email `info@yogabible.dk`
- Explains: cancel requires 1 month notice per T&C

**Paused contract display:**
- Amber "Paused" badge
- Pause period dates (from/to)
- Auto-resume message
- "Reactivate" button → searches store for matching contract

**Post-termination UX:**
- **Before termination date:** Retention card (heart icon, perks, "Reactivate — first month free" CTA)
- **After termination date:** "Become a member again" button → Store memberships
- Revoke cancellation NOT possible via API → "Contact us" hint shown

**Backend:**
- `mb-contract-manage.js` supports `action: 'suspend'|'terminate'`
- Uses correct `SuspensionStart` parameter (fixed 2026-02-13)
- Business rules: min 14 days, max 93 days, earliest start after next billing

**Pause persistence (Firestore bridge):**
- After pause, saves to Firestore `users/{uid}/pauses/pause_{contractId}`
- Fields: `contractId`, `startDate`, `endDate`, `savedAt`
- MB `IsSuspended` is ONLY true for currently active pauses (false for future-dated)
- 90-second grace period: trust Firestore for 90s, then defer to MB as authority
- If MB never confirms (admin deleted suspension), Firestore record auto-removed

**API limitations (still no API for):**
- Delete/cancel an existing suspension (admin UI only)
- Revoke/cancel a pending termination (admin UI only)

### 6. Gift Cards Tab (Gavekort) — Replaced Courses Tab (2026-02-14)

**Data source:** `mb-giftcards` Netlify function

**Note:** The original "Courses" (Mine Kurser) tab was replaced with "Gift Cards" (Gavekort). Course materials are accessed via the `/course-bundles` page and course-specific pages (`/inversions`, `/splits`, `/backbends`), not from the profile area.

**Gift card selection:**
- API call: GET `/.netlify/functions/mb-giftcards` → returns available gift card types
- Each option shown as a selectable card with: description, terms (if any), price
- Clicking a card reveals the purchase form below

**Purchase form (two-column):**
- **Left — Gift details:**
  - Recipient name + email (required)
  - Gift title/message
  - Personal message (textarea)
  - Delivery date picker
- **Right — Payment:**
  - Stored card option (if available)
  - Card input fields (name, number, expiry, CVV)
  - Save card checkbox
  - "Buy gift card" CTA

**Checkout flow:**
- POST to `/.netlify/functions/mb-giftcards` with gift details + payment info
- On success: shows confirmation state with "Close" button
- On error: inline error message

## Bilingual System

**Language detection:**
```javascript
function isDa() { return window.location.pathname.indexOf('/en/') !== 0; }
```

**Translation function `t(key)`:**
- Returns DA or EN string based on `isDa()` result
- **Hardcoded JS map** inside profile.js — does NOT read from `profile.json` at runtime
- ~90+ translation keys covering all tabs, including membership management, retention card, store search, and notice period
- When adding new features, you must add translation keys to BOTH:
  1. `src/_data/i18n/profile.json` (for template-level translations)
  2. The `t()` map in `src/js/profile.js` (for JS-generated UI)

**Inline bilingual patterns:**
```javascript
// For toast messages and dynamic text
isDa() ? 'Du er booket!' : "You're booked!"

// For store top-level categories
storeTopCategories = [
  { id: 'daily', da: 'Daglige Klasser', en: 'Daily Classes' },
  { id: 'teacher', da: 'Yogalæreruddannelse', en: 'Yoga Teacher Training' },
  { id: 'courses', da: 'Kurser', en: 'Courses' },
  { id: 'private', da: 'Privattimer', en: 'Private Classes' }
];
// Daily Classes subcategories
storeDailySubs = [
  { id: 'memberships', da: 'Medlemskab', en: 'Memberships' },
  { id: 'timebased', da: 'Tidsbegrænsede pas', en: 'Time-based Passes' },
  { id: 'clips', da: 'Klippekort', en: 'Clip Cards' },
  { id: 'trials', da: 'Prøvekort', en: 'Trial Passes' },
  { id: 'tourist', da: 'Turistpas', en: 'Tourist Pass' },
  { id: 'test', da: 'Test', en: 'Test' }
];
```

**Template-level translations:**
- Nunjucks template uses `{% set t = i18n.profile[lang or "da"] %}`
- Static labels come from `src/_data/i18n/profile.json`
- Dynamic content (from JS) uses the `t()` function and `isDa()` checks

**Key functions reference:**
```
// ─── Core Data Functions ───
loadProfile(user, db)              — Firebase profile + Mindbody sync
loadSchedule()                     — Classes + visits parallel fetch
renderSchedule()                   — Build schedule HTML with book/cancel/bio
renderSchedulePassInfo()           — Smart pass banner (clips, membership, low warning)
clientCanBook(programId)           — Frontend pass-to-program validation
bookClass(btn)                     — Pass validation + booking
cancelClass(btn)                   — Cancel with late-cancel retry
loadReceipts(periodDays?)          — Purchase history with period filter (3-source merge)
renderReceipts(container, purchases) — Receipt cards with price, tax, download button
generateInvoiceHTML(purchase)      — Full HTML invoice (opens in new window for Print/PDF)
loadVisitHistory(periodDays?)      — Visit data + filters + status counts
formatDKK(num)                     — Danish Krone formatting (e.g. "1.200 kr.")

// ─── Store Functions (catalog-based) ───
buildStoreFromCatalog()            — Build storeServices[] from storeCatalog by age bracket
loadStore()                        — Entry point: build catalog + render categories
renderStoreItems(container)        — Two-mode renderer: categories view OR items view
renderStoreCardGrid(filtered)      — Card HTML for standard items (clips, memberships, deposits, etc.)
attachStoreHandlers(container)     — Wire search, back, subcategory, buy, sharing handlers
renderCourseBuilder()              — Course builder HTML with toggle cards + pricing summary
attachCourseBuilderHandlers(container) — Wire course toggle + buy button
getCourseCheckoutItem()            — Map selected courses → correct prodId + price
resolveCatalogRef(item, bracket)   — Resolve _ref items (trials/tourist → clips/timebased)
getAgeBracket()                    — Returns 'over30' or 'under30' based on DOB
filterStoreByProgram(programId)    — Auto-navigate to store from failed booking

// ─── Store Checkout Functions ───
openCheckout(uid, itemType)        — Open checkout overlay, populate item + waiver/terms
processCheckout()                  — Validate, submit waiver, route to mb-checkout or mb-contracts
initStoreForm()                    — Wire checkout form handlers, card formatting, cancel/success

// ─── Membership Management Functions ───
loadMembershipDetails()            — Fetch passes/contracts, merge Firestore pauses, render
renderMembershipDetails(el, data)  — Build membership HTML (passes, contracts, pause/resume panels)
pauseContract(contractId, months)  — POST to mb-contract-manage + save pause to Firestore
savePauseToFirestore()             — Persist pause info for cross-device sync
removePauseFromFirestore()         — Clean up stale pause records

// ─── Waiver Functions ───
fetchWaiverStatus(mbClientId)      — 3-tier check: localStorage → Firestore → Mindbody API
renderWaiverCard()                 — Show signed/unsigned waiver card in My Passes tab
submitLiabilityWaiver(clientId, source) — Sign waiver + sync to Firestore + Mindbody

// ─── Gift Card Functions ───
loadGiftCards()                    — Fetch available gift cards from mb-giftcards
purchaseGiftCard()                 — Submit gift card purchase with recipient + payment

// ─── Stored Card Functions ───
loadStoredCard()                   — Fetch saved card from mb-client?action=storedCard
saveCardInfoLocally(paymentInfo)   — Save card summary to storedCardData + Firestore
initializeStoredCardToggle(prefix) — Wire stored/new card radio toggle in checkout

// ─── Helper Functions ───
t(key)              — Translation lookup (hardcoded DA/EN map, ~100+ keys)
isDa()              — Language detection (path-based)
esc(str)            — HTML escape
formatTime(iso)     — Time formatting
formatDKK(num)      — Danish Krone formatting
formatDateDK(date)  — Danish date format (d. MMM yyyy)
toDateStr(date)     — YYYY-MM-DD formatting
toLocalDateStr(d)   — Local YYYY-MM-DD (used for contract startDate)
```

## Firestore Schema

```
users/{uid}:
  uid: string
  email: string
  firstName: string
  lastName: string
  name: string (full name)
  phone: string
  dateOfBirth: string (YYYY-MM-DD)
  yogaLevel: string
  practiceFrequency: string
  membershipTier: string ('free' | 'member')
  mindbodyClientId: string
  photoURL: string (base64 data URL from resized image)
  yogabibleDkLinked: boolean
  yogabibleComLinked: boolean
  locale: string
  role: string ('user')
  consents: {                              // Set on registration, serves as quick reference
    termsAndConditions: { accepted: true, timestamp: string (ISO), version: string }
    privacyPolicy: { accepted: true, timestamp: string (ISO), version: string }
    codeOfConduct: { accepted: true, timestamp: string (ISO), version: string }
  }
  createdAt: timestamp
  updatedAt: timestamp
  lastLogin: timestamp

consents/{auto-id}:                        // Audit trail — one doc per document per user
  userId: string (uid)
  email: string
  document: string ('termsAndConditions' | 'privacyPolicy' | 'codeOfConduct')
  documentLabel: string ('Terms & Conditions' | 'Privacy Policy' | 'Code of Conduct')
  accepted: boolean (true)
  timestamp: string (ISO)                  // When the user clicked accept
  version: string                          // Document version date (e.g. '2026-02-09')
  userAgent: string                        // Browser UA string
  locale: string ('da' | 'en')
  source: string ('registration')          // Where consent was collected
  createdAt: timestamp                     // Server timestamp

users/{uid}/documents/{docId}:     // Waiver + legal documents
  document: string                   // "liability_waiver"
  timestamp: timestamp
  createdAt: timestamp
  signature: string (base64 canvas data URL)
  acceptedAt: timestamp

users/{uid}/pauses/pause_{contractId}: // Membership pause bridge
  contractId: string
  startDate: string (YYYY-MM-DD)
  endDate: string (YYYY-MM-DD)
  savedAt: timestamp

enrollments/{id}:                  // Course enrollments (legacy, for course viewer)
  userId: string (uid)
  courseId: string
  status: string ('active')

courses/{courseId}:
  title_da: string
  title_en: string
  description_da: string
  description_en: string
  icon: string (emoji)

courseProgress/{uid_courseId}:
  viewed: { [chapterId]: true }
  lastModule: string
  lastChapter: string
```

## Backend Client Sync (ensureBackendClient)

On every login, silently ensures user has a Mindbody client:
1. Check Firestore for `mindbodyClientId` → if exists, done
2. GET `mb-client?email=X` → search by email → if found, save ID to Firestore
3. If not found → POST `mb-client` to create → save new ID to Firestore
4. All errors caught silently (non-blocking)

## Firebase Auth Integration (firebase-auth.js)

**Registration flow:**
1. User submits signup form (firstName, lastName, email, password)
2. User must check two consent checkboxes: T&C + Privacy Policy, and Code of Conduct
3. Consent validation: both must be checked, otherwise error shown
4. Firebase creates auth account + sets `displayName`
5. `window._ybRegistration` stores name parts + consent data (document, timestamp, version) temporarily
6. `ensureUserProfile()` creates Firestore doc at `users/{uid}` including `consents` object
7. `storeConsentAuditTrail()` writes 3 individual records to `consents` collection (one per policy document) with userId, email, timestamp, version, userAgent, locale, source
8. `createMindbodyClient()` calls `mb-client` POST in background
9. If 409 (duplicate email) → `linkExistingMindbodyClient()` looks up existing MB client, stores `mindbodyClientId`, pulls phone/DOB from MB profile into Firestore
10. `window.syncMindbodyClient()` called if available → checks membership tier

**Bidirectional Mindbody sync:**
- **Website → MB:** On registration, `createMindbodyClient()` creates new MB client
- **MB → Website:** If MB client already exists (409), `linkExistingMindbodyClient()` looks up by email, stores `mindbodyClientId`, and pulls phone + DOB from MB into Firestore (if user hasn't set them locally)
- **On login (existing user):** `ensureUserProfile()` checks if `mindbodyClientId` is missing, calls `linkExistingMindbodyClient()` to auto-link
- **BirthDate filtering:** Mindbody returns `0001-01-01T00:00:00` for unset DOB — filtered out before storing

**Consent audit trail:**
- Each consent record stored individually in `consents` Firestore collection
- Fields: `userId`, `email`, `document` (type), `documentLabel`, `accepted`, `timestamp`, `version`, `userAgent`, `locale`, `source`, `createdAt`
- Queryable by userId or email for legal proof of consent
- Consent summary also stored on user profile for quick reference

**Content gating:**
- `handleContentGating(user)` — shows/hides gated content based on auth state
- Elements with `data-yb-gated` attribute are hidden for non-authenticated users

**Header UI:**
- Updates login/profile links based on auth state
- Shows user avatar/initials in header

## CSS Class Naming Convention

All profile-related CSS classes use these prefixes:
- `yb-profile__` — Profile tab elements
- `yb-schedule__` — Schedule tab elements
- `yb-store__` — Store tab elements (also used for loading/empty states in other tabs)
- `yb-visits__` — Visit history elements
- `yb-receipts__` — Receipts elements
- `yb-membership__` — Membership/passes section in My Passes tab (includes retention card, manage panels)
- `yb-onboarding__` — Mandatory onboarding overlay (phone + DOB form)
- `yb-auth-consent__` — Consent checkboxes in registration form
- `yb-mb-spinner` — Loading spinner
- `yb-btn` / `yb-btn--primary` / `yb-btn--outline` — Button styles
- `is-active` — Active state for tabs, filters, categories
- `is-past` / `is-cancelled` — Schedule class states

## Key UX Patterns

### Toast Notifications
- Normal success/error: 3.5s timeout, plain text
- Late cancel warning: 6s timeout, rich HTML with wellness note
- Membership actions: 5s default, 8s for cancel farewell. `showMembershipToast(message, type, duration)` supports optional duration parameter

### Loading States
- All tabs show spinner + localized text while fetching
- Empty states show localized message
- Error states show localized error message

### Cache Invalidation
- `clientPassData = null` after: booking, cancel, purchase, membership management
- Triggers refetch of pass data on next schedule load or membership render
- `staffCache` never cleared (bios don't change during session)
- `tabLoaded` tracks which tabs have been loaded (prevents re-fetch on tab switch)

### Mandatory Onboarding Overlay
- Shown when phone OR dateOfBirth is missing in Firestore on login
- **Blocks all tab navigation** — tabs and panels set to `display: none`
- Centered card with phone + DOB form (both required)
- On save: updates Firestore + pushes to Mindbody + dismisses overlay + shows tabs
- If `clientId` not yet available (async MB sync), polls every 1s for up to 15s before MB push
- Existing partial data is pre-filled

### Profile Reminder Banner (soft)
- Shows inside profile form when phone OR dateOfBirth is missing
- Hidden when onboarding overlay is shown (overlay takes priority)
- Hidden after successful profile save if both are now filled

### Avatar Upload
- Client-side image resize: canvas crop to square, scale to 200x200
- Saved as base64 JPEG (quality 0.85) directly to Firestore
- Max file size check: 10 MB
- Immediate preview before Firestore save completes

## Error Handling Patterns

### Loading Spinner Safety
All data-loading functions use `try/finally` to guarantee spinner hide:
```javascript
.then(function(data) {
  try {
    renderMembershipDetails(contentEl, data);
    // ... more logic
  } catch (renderErr) {
    console.error('[Membership] Render error:', renderErr);
  } finally {
    if (loadingEl) loadingEl.hidden = true;  // Always hides
  }
})
```

### Non-JSON Response Detection
Frontend fetch calls check `content-type` before parsing:
```javascript
.then(function(r) {
  var ct = r.headers.get('content-type') || '';
  if (ct.indexOf('application/json') === -1) {
    throw new Error('Server returned non-JSON (status ' + r.status + ')');
  }
  return r.json().then(function(d) { return { ok: r.ok, data: d }; });
})
```
This catches the case where Netlify returns HTML 404 pages instead of function responses (common during deploy propagation).

## Adaptation Guide for New Brands

When porting this system to a new brand (e.g., Hot Yoga CPH):

1. **Copy files:** `src/js/profile.js`, `src/js/firebase-auth.js`, `src/js/mindbody.js`
2. **Update translations:** Modify `t()` function map and `storeCategories` array, add brand-specific keys to both `t()` map and `profile.json`
3. **Update invoice template:** Change company name/address/CVR/bank details in `generateInvoiceHTML()`
4. **Update Firebase config:** Change `firebaseConfig` in `firebase-auth.js` (can share same project yoga-bible-dk-com or use separate)
5. **Update category heuristics:** Adjust `categorizeService()` keywords if services have different naming
6. **Termination rules:** Adjust `calcTerminationDates()` — notice period, billing cycle logic may differ per brand's T&C
7. **Pause rules:** Adjust min/max duration in `mb-contract-manage.js` (currently 14 days min, 93 days max)
8. **Retention card messaging:** Update `membership_retention_*` translations for brand-specific perks and reactivation offer
9. **Notice period text:** Update `membership_notice_period` translation — different brands may have different T&C URLs and notice periods
10. **Adapt CSS:** Keep class naming convention, update brand colors — all classes prefixed `yb-` for Yoga Bible
11. **Template:** Create profile page template with required DOM IDs (see element IDs in init functions). Must include 7 tab panels: profile, schedule, store, visits, passes, receipts, giftcards. Include `#yb-onboarding-inline` div and consent checkboxes in auth modal
12. **Consent checkbox links:** Update links in `modal-auth.njk` consent checkboxes to point to new brand's Terms & Conditions, Privacy Policy, and Code of Conduct pages
13. **Consent version:** Update the `version` string in `firebase-auth.js` registration handler whenever policy documents change
14. **Firestore rules:** Set up security rules for `consents` collection — write-only from clients, admin-read for legal queries
15. **Share Mindbody functions:** All `mb-*.js` files are brand-agnostic — same Site ID (5748831), use LocationId to filter per studio if needed
