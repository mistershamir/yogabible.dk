# Profile Page Architecture

> Frontend architecture for the member area profile page.
> Adapt for each brand's design system.

## Overview

Single-page profile with tab navigation. Each tab loads data on demand.

```
┌──────────────────────────────────────────────────┐
│  Header: Avatar | Name | Email | Tier Badge      │
│  Reminder Banner (if profile incomplete)          │
├──────────────────────────────────────────────────┤
│  [Profil] [Skema] [Butik] [Besøg] [Kvit] [Kurs] │
├──────────────────────────────────────────────────┤
│  Tab Content (loaded on demand)                   │
└──────────────────────────────────────────────────┘
```

## Tab Details

### 1. Profile Tab (Profil)
- **Data source:** Firebase Auth + Firestore `users/{uid}`
- **Fields:** Name, email, phone, DOB, avatar (photo upload)
- **Membership section:** Loads from `mb-client-services` to show active passes/contracts
- **Save:** Updates Firestore + syncs to Mindbody via `mb-client`

### 2. Schedule Tab (Skema)
- **Data source:** `mb-classes` + `mb-visits` (parallel fetch)
- **Key features:**
  - Weekly navigation (prev/next with date labels)
  - Pass info banner with smart logic:
    - Shows all active passes with remaining clip count
    - Low-clip warning when remaining < 3 (orange accent)
    - Membership info with green accent + renewal date
    - Never shows "buy pass" banner for autopay members
  - Book/Cancel buttons (with dual pass validation)
  - Teacher bio expansion (clickable names, fetches from `mb-staff`, session cached)
  - Class description expansion (HTML from Mindbody, orange left border styling)
  - Waitlist for full classes (uses `mb-waitlist`)
- **Booking flow:**
  1. Frontend `clientCanBook(programId)` checks active services/contracts match class program
  2. If no match → show "no pass" error, don't send request
  3. If match → POST to `mb-book` → server `validateClientPass()` again → books → show Cancel button
  4. If already booked → server returns `alreadyBooked: true` → treated as success
- **Cancel flow:**
  1. DELETE to `mb-book`
  2. If window error → auto-retries with LateCancel: true
  3. Late cancel → rich HTML toast with wellness message about fees (6s timeout)
  4. Success → standard toast (3s timeout)

### 3. Store Tab (Butik)
- **Data source:** `mb-services` (services + categories)
- **Category tabs:** Trials, Tourist Pass, Memberships, Clip Cards, Time-based Passes, Teacher Trainings, Courses, Private Sessions
- **Categorization:** Heuristic name matching via `categorizeService()` — keywords in service name map to category
- **Features:**
  - Category filter tabs with item counts per category
  - Active tab styling (pill buttons)
  - Service cards with name, price, description
- **Flow:** Select service → fill payment form → POST to `mb-checkout`
- **Future:** Add contracts from `mb-contracts`, promo codes from `mb-site`, specific barcode→category mapping

### 4. Visit History Tab (Besøgshistorik)
- **Data source:** `mb-visits`
- **Time period picker:** 30, 90, 180, 365 days (select dropdown)
- **Filter pills:** All / Upcoming / Attended / Late Cancelled / No-show
- **Status counts:** Summary bar showing total counts per status (upcoming=orange, attended=green, late-cancelled=amber, no-show=red)
- **Sorting:** Upcoming first (ascending by date), then past (descending by date)
- **Upcoming filter fix:** Uses full datetime comparison (`classTime > now`) not just date, so 8am class correctly becomes "past" at 8:01am

### 5. Receipts Tab (Kvitteringer)
- **Data source:** `mb-purchases` (tries /sale/sales first, fallback to /sale/clientpurchases)
- **Time period picker:** 90, 180, 365, 730 days (select dropdown)
- **Display:** Card layout with date, item name, amount, payment method
- **Download receipt:** Generates text file with all receipt details (triggers browser download)
- **Loading state:** Shows spinner while fetching
- **Empty state:** Shows message when no receipts found in period

### 6. Courses Tab (Mine Kurser)
- **Data source:** Firestore (separate course system)
- **Not connected to Mindbody** — custom enrollment + progress tracking

## JavaScript Architecture

```javascript
// profile.js structure (~1500+ lines)
(function() {
  'use strict';

  // ─── State ───
  var currentUser = null;
  var currentDb = null;
  var clientId = null;           // Mindbody client ID from Firestore
  var clientPassData = null;     // Cached pass/service data
  var staffCache = {};           // Cached teacher bios by ID (session-persistent)
  var scheduleWeekOffset = 0;    // Week navigation state
  var allVisits = [];            // Cached for filtering
  var activeVisitFilter = 'all';
  var storeActiveCategory = 'all'; // Store category filter
  var visitsPeriod = '90';       // Visit history period (days)
  var receiptsPeriod = '365';    // Receipts period (days)

  // ─── Store Categories ───
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

  // ─── Init Flow ───
  // 1. Wait for Firebase SDK to load
  // 2. Listen for auth state change
  // 3. Load Firestore profile → get mindbodyClientId
  // 4. Init tabs, store form, schedule nav, avatar upload, visit filters
  // 5. Load initial tab data

  // ─── Key Functions ───
  // loadProfile(user, db)           — Firebase profile + Mindbody sync
  // loadSchedule()                  — Classes + visits parallel fetch
  // renderSchedule()                — Build schedule HTML with book/cancel/bio
  // renderSchedulePassInfo()        — Smart pass banner (clips, membership, low warning)
  // clientCanBook(programId)        — Frontend pass-to-program validation
  // bookClass(btn)                  — Pass validation + booking
  // cancelClass(btn)                — Cancel with late-cancel retry
  // loadReceipts(periodDays?)       — Purchase history with period filter
  // loadVisitHistory(periodDays?)   — Visit data + filters + status counts
  // loadStore()                     — Services with category tabs
  // categorizeService(s)            — Heuristic name→category mapping
  // downloadReceipt(purchase)       — Generate + download text receipt

  // ─── Helper Functions ───
  // t(key)           — Translation lookup (bilingual DA/EN)
  // isDa()           — Language detection (hostname-based)
  // esc(str)         — HTML escape
  // formatTime(iso)  — Time formatting
  // formatDKK(num)   — Danish Krone formatting
  // toDateStr(date)  — YYYY-MM-DD formatting
})();
```

## Firestore Schema

```
users/{uid}:
  email: string
  displayName: string
  firstName: string
  lastName: string
  phone: string
  dateOfBirth: string (YYYY-MM-DD)
  membershipTier: string ('free' | 'member' | 'premium')
  mindbodyClientId: string
  photoURL: string (Firebase Storage URL)
  createdAt: timestamp
  lastLogin: timestamp
```

## UX Patterns

### Late Cancel Wellness Toast
When a class is cancelled outside the cancellation window, the system auto-retries with `LateCancel: true` and shows a rich HTML toast with:
- Main message: "Cancelled (may carry late cancel fee)"
- Wellness note: Explains that fees go toward ginger shots, herbal tea, frozen face towels, clean hand towels
- 6-second timeout (vs 3s for normal toasts)
- Both DA and EN versions

### Pass Banner Smart Logic
The pass info banner in the Schedule tab follows these rules:
1. **Has active services (clip cards):** Show each pass name + remaining count
2. **Remaining < 3:** Show orange "low clip" warning ("Snart opbrugt — overvej at fylde op")
3. **Has active contracts (memberships):** Show membership name + renewal date with green accent
4. **Is a member:** NEVER show "buy pass" banner
5. **No passes at all:** Show "buy pass" banner linking to Store tab

### Store Category Heuristics
`categorizeService(s)` maps service names to categories using keyword matching:
- `trial`, `prøv` → trials
- `tourist`, `turist`, `travel` → tourist
- `member`, `medlem`, `unlimited`, `ubegrænset` → memberships
- `klip`, `clip`, `x kort`, `pack` → clips
- `month`, `måned`, `week`, `uge`, `day`, `dag` → timebased
- `teacher`, `lærer`, `200h`, `300h`, `yttc` → teacher
- `course`, `kursus`, `workshop` → courses
- `private`, `privat`, `1:1`, `personal` → private

## Client Referral API

**Status: NOT available via Mindbody Public API v6**

The Mindbody API v6 does not expose a dedicated client referral endpoint. The `Client` object has a `ReferredBy` field but it is read-only in the public API. Options:
1. **Manual admin:** Set referrals in Mindbody admin panel (current workflow)
2. **Custom Firebase solution:** Build a referral tracking system in Firestore, then admin syncs to Mindbody manually
3. **Future:** Monitor Mindbody API updates for referral endpoints

## Bilingual Support

- Language detection: `window.location.hostname` or `window.location.pathname.startsWith('/en/')`
- Translation function `t(key)` returns DA or EN based on current language
- Inline fallbacks for toast messages: `isDa() ? 'Danish text' : 'English text'`
- Template uses `{% set t = i18n.profile[lang or "da"] %}` for Nunjucks
