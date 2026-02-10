# Profile Page Architecture — Frontend Reference

> Frontend architecture for the member area profile page (`src/js/profile.js`, ~2600 lines).
> Adapt for each brand's design system. **Last updated: 2026-02-09** — reflects store redesign, My Passes tab, retention card, consent/audit trail, mandatory onboarding, bidirectional MB sync.

## Overview

Single-page profile dashboard with 7 tabs. Each tab lazy-loads data on first click. All data comes from Netlify Functions (Mindbody proxy) except Profile (Firestore) and Courses (Firestore).

```
┌─────────────────────────────────────────────────────────────┐
│  Header: Avatar | Name | Email | Tier Badge                  │
│                                                               │
│  ┌─ ONBOARDING OVERLAY (blocks everything below) ──────────┐ │
│  │  "Welcome! Let's complete your profile"                   │ │
│  │  [Phone*] [Date of Birth*]                                │ │
│  │  [Save and continue]                                      │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                               │
│  Reminder Banner (soft — if phone/DOB missing, hidden if      │
│  onboarding overlay is shown instead)                         │
├─────────────────────────────────────────────────────────────┤
│  [Profil] [Skema] [Butik] [Mine Pas] [Besøg] [Kvit] [Kurs] │
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
var currentUser = null;        // Firebase auth user
var currentDb = null;          // Firestore instance
var clientId = null;           // Mindbody client ID (from Firestore users/{uid})
var clientPassData = null;     // Cached pass/service data (mb-client-services response)
var staffCache = {};           // Teacher bios by staffId (session-persistent, never cleared)
var scheduleWeekOffset = 0;    // Week navigation: 0 = current, -1 = last, 1 = next
var allVisits = [];            // Cached visits for client-side filtering
var activeVisitFilter = 'all'; // Visit filter: all|upcoming|attended|lateCancelled|noshow
var storeActiveCategory = 'all'; // Store category filter
var storeSearchQuery = '';     // Store search bar text (real-time filtering)
var visitsPeriod = '90';       // Visit history lookback (days)
var receiptsPeriod = '365';    // Receipts lookback (days)
var storeServices = [];        // Combined services + contracts for store display
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

### 3. Store Tab (Butik)

**Data source:** `mb-services` + `mb-contracts` (parallel fetch)

**Parallel fetch strategy:**
```javascript
Promise.all([
  fetch('/.netlify/functions/mb-services?sellOnline=true'),
  fetch('/.netlify/functions/mb-contracts')  // no sellOnline filter — MB may not support it
])
```
- Contracts fetch has `.catch()` fallback → returns `{ contracts: [] }` on error
- Both results merged into single `storeServices` array with `_itemType` marker
- Each item stores `data-item-type` ('service' or 'contract') and `data-location-id`
- Staff token bypass: can sell items not marked "Sell Online" in Mindbody admin

**Contract normalization:**
- Price: `recurringPaymentAmount || firstPaymentAmount || totalContractAmount`
- `_recurringInfo` string: e.g. "799 kr / Monthly"
- `autopaySchedule` handled as both string and object (extract `FrequencyType` if object)
- `description` pulled from MB contract Description or OnlineDescription fields
- `firstMonthFree` flag (true when `firstPaymentAmount === 0`)
- `_terms` array built with: first-month-free notice, first payment if different from recurring, duration, number of autopays
- All contracts categorized as `'memberships'`

**Search bar:**
- Real-time text filtering by item name and description
- `storeSearchQuery` state variable persisted across re-renders
- Clear button (×) shown when search active
- Results count displayed below category tabs (e.g. "5 results")
- Empty state shows "No results for {query}" when search finds nothing

**Category system (`categorizeService()`):**
| Category | Keywords | Notes |
|----------|----------|-------|
| `trials` | trial, prøv, intro | |
| `tourist` | tourist, turist, drop-in | |
| `timebased` | day/month/week + unlimited/non-contract | Time period + unlimited keyword. "unlimited 1 month" is timebased NOT memberships |
| `memberships` | membership, medlems, autopay | + ALL contracts regardless of name |
| `clips` | clip, klip, punch, pack, class | |
| `teacher` | teacher, lærer, training, 200, 300 | Teacher trainings |
| `courses` | course, kursus, workshop | |
| `private` | private, privat, 1-on-1, personal | |

- Categories with 0 items are hidden (except "All")
- Each category tab shows item count badge (pill buttons with active styling)
- Search and category filter work together (category first, then search within)

**Enhanced item cards:**
- **Badges row:** "First month free" (orange border) + "Membership" (muted) for contracts
- **Description:** Truncated to 120 chars, shown below name in muted text
- **Pricing section:** Price + recurring info inline
- **Terms list:** Checkmark list showing key contract terms + T&C link (opens in new tab)
- **Buy button:** Full-width primary CTA

**Unlimited clips display:**
- Mindbody uses 99999/999999 as "unlimited" placeholder
- Hidden in UI: `if (s.count && s.count < 9999)` — only show real clip counts, show "Unlimited" text instead

**Checkout flow (dual routing):**
- **Service checkout:** POST to `/.netlify/functions/mb-checkout`
  ```json
  { "clientId": "X", "items": [{"type":"Service","id":123,"quantity":1}], "amount": 799, "payment": {...} }
  ```
- **Contract checkout:** POST to `/.netlify/functions/mb-contracts` (routes to `/sale/purchasecontract`)
  ```json
  { "clientId": "X", "contractId": 456, "locationId": 1, "startDate": "2026-02-08", "payment": {...} }
  ```
- **Checkout item panel:** Shows contract terms summary (checkmark list) alongside name and price
- Payment info shape: `{ cardNumber, expMonth, expYear, cvv, cardHolder, billingAddress, billingCity, billingPostalCode, saveCard }`
- Card number input: auto-formats with spaces every 4 digits
- Expiry input: auto-formats as MM/YY
- Promo code support: `data-promo-code` attribute on checkout element, passed as `promoCode` in contract purchase body
- SCA handling: if `requiresSCA` in response, shows "card requires additional authentication" message
- No clientId? → tries to sync account first via `mb-sync`, then asks to retry

**After successful purchase:**
- Hides checkout, shows success panel
- Resets form
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

**Membership management (Contact-based, updated 2026-02-10):**
- Pause and Cancel buttons have been **removed** from the user profile
- Replaced with an info box directing users to email `info@yogabible.dk`
- Info box text explains: pause (14 days – 3 months, special circumstances) or cancel (1 month notice per T&C)
- **Reason:** Unresolved Mindbody API issues — `SuspendDate` interpreted as end date (not start), no API to delete suspension or cancel termination
- **Awaiting** Mindbody Developer Support response (email drafted in `docs/email-mindbody-support.md`)
- Status displays remain: paused badge, terminated badge, billing info, retention card, contact hints
- Backend `mb-contract-manage.js` still functional for suspend/terminate actions (can be re-enabled when API issues are resolved)

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

### 5. Receipts Tab (Kvitteringer)

**Data source:** `mb-purchases`
- Fetches from `clientservices` + `clientcontracts` (NOT `/sale/sales` — that endpoint ignores ClientId filter)

**Time period picker:** 90, 180, 365, 730 days (select dropdown)

**Receipt card displays:**
- Date, item name, program name
- Type badge: Membership (contract), Pass (service), Purchase (sale)
- Status badges: Active, Refunded
- Details grid: Amount, Payment method (with last 4 digits), Quantity, Sessions used (X/Y), Expiration, End date, Autopay amount, Discount, Tax, Location

**Download receipt (TXT):**
```
═══════════════════════════════════
       YOGA BIBLE — KVITTERING
═══════════════════════════════════

Dato: 8. feb. 2026
Vare: 10-klippekort
Beløb: 1.200 kr.
Reference: #12345

═══════════════════════════════════
Yoga Bible DK | yogabible.dk
Torvegade 66, 1400, København K
```
- Generated as Blob → `URL.createObjectURL()` → triggers `<a>` download
- Filename: `kvittering-{saleId}.txt`

### Membership Management (within My Passes Tab) — Updated 2026-02-10

**Current state:** Pause and Cancel buttons have been **removed** from the user profile. Users are directed to email `info@yogabible.dk` to request pause or cancellation.

**Info box (active contracts):**
- Shown for active, non-suspended, non-terminating autopay contracts
- Contains styled text with orange left border accent explaining:
  - Pause options: 14 days – 3 months, special circumstances
  - Cancel: 1 month notice per terms & conditions
  - Contact: email `info@yogabible.dk`

**Paused contract display:**
- Amber "Paused" badge
- Pause period dates (from/to)
- Auto-resume message
- Contact info: "Want to cancel the pause? Contact us at info@yogabible.dk"

**Post-termination UX (unchanged):**
- **Before termination date:** Retention card (heart icon, perks, "Reactivate — first month free" CTA)
- **After termination date:** "Become a member again" button → Store memberships
- Revoke cancellation is NOT possible via Mindbody API (`activatecontract` doesn't exist)
- "Want to cancel the termination? Contact us at info@yogabible.dk" hint shown

**Backend (ready for re-activation):**
- `mb-contract-manage.js` still supports `action: 'suspend'|'terminate'`
- Can re-enable buttons once Mindbody clarifies SuspendDate semantics
- Business rules remain in code: min 14 days, max 93 days, earliest start after next billing

**Pause persistence (Firestore bridge):**
- After user pauses, Firestore `users/{uid}.pausedContracts` stores pause info with `savedAt` timestamp
- MB `IsSuspended` is ONLY true for currently active pauses (false for future-dated)
- 90-second grace period: trust Firestore for 90s after save, then defer to MB as authority
- If MB never confirms (admin deleted suspension), Firestore record auto-removed after 90s

**Date formatting:**
- All dates use `formatDateDK()` for consistent Danish-style display

**Why buttons were removed (2026-02-10):**
1. `SuspendDate` treated by MB as end date, not start — can't schedule future-dated pause starts
2. No API to delete/cancel an existing suspension — only available in MB admin UI
3. No API to revoke/cancel a pending termination — only available in MB admin UI
4. Email sent to Mindbody Developer Support requesting clarification (see `docs/email-mindbody-support.md`)

### 6. Courses Tab (Mine Kurser)

**Data source:** Firestore only (not connected to Mindbody)

**Data fetch:**
1. Query `enrollments` where `userId == currentUser.uid` and `status == 'active'`
   - Uses single `.where()` to avoid composite Firestore indexes
2. For each enrolled course: fetch `courses/{courseId}` + modules count + progress
3. Modules and progress fetched with `.catch()` fallback (may fail on Firestore rules)

**Course card displays:**
- Icon, title (bilingual), description, module count
- Progress: chapters read count
- Deep-link to last chapter if progress exists
- Button: "Start" (no progress) or "Fortsæt/Continue" (has progress)
- Links to course viewer page: `/kursus-materiale/?course=X&module=Y&chapter=Z`

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

// For store categories
storeCategories = [
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
loadReceipts(periodDays?)          — Purchase history with period filter
loadVisitHistory(periodDays?)      — Visit data + filters + status counts
loadStore()                        — Services + contracts (parallel fetch) with search + category tabs
renderStoreItems(container)        — Build store HTML: search bar, categories, item grid, badges, terms
categorizeService(s)               — Heuristic name→category mapping
downloadReceipt(purchase)          — Generate + download text receipt

// ─── Membership Management Functions ───
loadMembershipDetails()            — Fetch passes/contracts, render, set tier badge
renderMembershipDetails(el, data)  — Build membership HTML (passes, contracts, panels)
bindMembershipManageEvents(el, d)  — Wire up pause/cancel buttons + date pickers
calcTerminationDates(nextBilling)  — Returns { lastPaymentDate, useUntilDate }
calcEarliestPauseStart(nextBill)   — Returns earliest valid pause start date
showMembershipToast(msg, type)     — Toast notification for manage actions

// ─── Store Checkout Functions ───
openCheckout(item)                 — Open payment modal, store item-type + location-id
processCheckout(formData)          — Route to mb-checkout (services) or mb-contracts (contracts)

// ─── Helper Functions ───
t(key)              — Translation lookup (hardcoded DA/EN map, ~80+ keys)
isDa()              — Language detection (path-based)
esc(str)            — HTML escape
formatTime(iso)     — Time formatting
formatDKK(num)      — Danish Krone formatting
formatDateDK(date)  — Danish date format (d. MMM yyyy)
toDateStr(date)     — YYYY-MM-DD formatting
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

enrollments/{id}:
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
3. **Update receipt footer:** Change studio name/address in `downloadReceipt()`
4. **Update Firebase config:** Change `firebaseConfig` in `firebase-auth.js` (can share same project yoga-bible-dk-com or use separate)
5. **Update category heuristics:** Adjust `categorizeService()` keywords if services have different naming
6. **Termination rules:** Adjust `calcTerminationDates()` — notice period, billing cycle logic may differ per brand's T&C
7. **Pause rules:** Adjust min/max duration in `mb-contract-manage.js` (currently 14 days min, 93 days max)
8. **Retention card messaging:** Update `membership_retention_*` translations for brand-specific perks and reactivation offer
9. **Notice period text:** Update `membership_notice_period` translation — different brands may have different T&C URLs and notice periods
10. **Adapt CSS:** Keep class naming convention, update brand colors — all classes prefixed `yb-` for Yoga Bible
11. **Template:** Create profile page template with required DOM IDs (see element IDs in init functions). Must include 7 tab panels: profile, schedule, store, passes, visits, receipts, courses. Include `#yb-onboarding-overlay` div and consent checkboxes in auth modal
12. **Consent checkbox links:** Update links in `modal-auth.njk` consent checkboxes to point to new brand's Terms & Conditions, Privacy Policy, and Code of Conduct pages
13. **Consent version:** Update the `version` string in `firebase-auth.js` registration handler whenever policy documents change
14. **Firestore rules:** Set up security rules for `consents` collection — write-only from clients, admin-read for legal queries
15. **Share Mindbody functions:** All `mb-*.js` files are brand-agnostic — same Site ID (5748831), use LocationId to filter per studio if needed
