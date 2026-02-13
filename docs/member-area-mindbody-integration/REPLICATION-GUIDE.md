# Member Area + Mindbody Integration — Complete Replication Guide

> **Purpose:** Everything a new Claude session needs to replicate the full Yoga Bible member area on another site (Hot Yoga Copenhagen). This is the single-source-of-truth reference to avoid re-debugging.

---

## Quick Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  FRONTEND (Eleventy + Nunjucks)                         │
│                                                         │
│  firebase-auth.js ─── Auth + Firestore profiles         │
│  profile.js ────────── 7-tab member dashboard           │
│  mindbody.js ───────── Standalone schedule widget        │
│                                                         │
│  profile.njk (DA) ──┐                                   │
│  en/profile.njk ────┤── _includes/pages/profile.njk     │
│                     └── _data/i18n/profile.json          │
└──────────────────┬──────────────────────────────────────┘
                   │ HTTPS (Netlify Functions)
┌──────────────────▼──────────────────────────────────────┐
│  NETLIFY FUNCTIONS (17 endpoints)                        │
│                                                         │
│  shared/mb-api.js ── Token mgmt, mbFetch(), corsHeaders  │
│  mb-classes.js     mb-book.js       mb-checkout.js       │
│  mb-client.js      mb-sync.js       mb-services.js       │
│  mb-contracts.js   mb-contract-manage.js                 │
│  mb-client-services.js   mb-visits.js    mb-purchases.js │
│  mb-staff.js       mb-waitlist.js    mb-site.js          │
│  mb-waiver.js      mb-return-sale.js                     │
│  mb-class-descriptions.js                                │
└──────────────────┬──────────────────────────────────────┘
                   │ REST API v6
┌──────────────────▼──────┐  ┌────────────────────────────┐
│  MINDBODY PUBLIC API v6  │  │  FIREBASE (Auth+Firestore)  │
│  api.mindbodyonline.com  │  │  Auth: email/password       │
│                          │  │  Firestore: users, consents │
└──────────────────────────┘  └────────────────────────────┘
```

---

## FILES TO PROVIDE TO THE NEW SESSION

### Essential — Copy These Directly

| # | File | Purpose | Lines |
|---|------|---------|-------|
| 1 | `netlify/functions/shared/mb-api.js` | Token management, authenticated fetch wrapper | ~123 |
| 2 | `netlify/functions/mb-classes.js` | Class schedule fetch (with sessionType) | ~92 |
| 3 | `netlify/functions/mb-book.js` | Book/cancel classes with pass validation | ~250 |
| 4 | `netlify/functions/mb-client.js` | Find/create/update MB client | ~120 |
| 5 | `netlify/functions/mb-sync.js` | Firebase↔MB sync | ~90 |
| 6 | `netlify/functions/mb-client-services.js` | Active passes/contracts fetch | ~100 |
| 7 | `netlify/functions/mb-services.js` | Purchasable services/products | ~80 |
| 8 | `netlify/functions/mb-contracts.js` | Memberships: fetch/purchase/terminate/suspend | ~200 |
| 9 | `netlify/functions/mb-contract-manage.js` | Dedicated contract pause/terminate/resume | ~180 |
| 10 | `netlify/functions/mb-checkout.js` | Credit card checkout via MB shopping cart | ~120 |
| 11 | `netlify/functions/mb-purchases.js` | Purchase history (3-source merge) | ~200 |
| 12 | `netlify/functions/mb-visits.js` | Visit history | ~70 |
| 13 | `netlify/functions/mb-staff.js` | Teacher bios & photos | ~60 |
| 14 | `netlify/functions/mb-waitlist.js` | Waitlist management | ~90 |
| 15 | `netlify/functions/mb-waiver.js` | Liability waiver check/sign | ~150 |
| 16 | `netlify/functions/mb-site.js` | Site config (session types, programs, locations) | ~70 |
| 17 | `netlify/functions/mb-class-descriptions.js` | Class type library | ~60 |
| 18 | `netlify/functions/mb-return-sale.js` | Refund processing | ~50 |
| 19 | `src/js/profile.js` | Full 7-tab member dashboard | ~3593 |
| 20 | `src/js/firebase-auth.js` | Auth, Firestore profiles, content gating | ~615 |
| 21 | `src/js/mindbody.js` | Standalone schedule widget (non-profile pages) | ~534 |
| 22 | `src/_includes/pages/profile.njk` | Profile template (shared DA/EN) | ~500 |
| 23 | `src/profile.njk` | DA wrapper | ~8 |
| 24 | `src/en/profile.njk` | EN wrapper | ~8 |
| 25 | `src/_data/i18n/profile.json` | All bilingual strings | ~300 |
| 26 | `src/css/main.css` (lines 5959–9800) | All member area styles | ~3800 |

### Reference Docs

| # | File | Purpose |
|---|------|---------|
| 27 | `docs/member-area-mindbody-integration/README.md` | Architecture overview |
| 28 | `docs/member-area-mindbody-integration/function-catalog.md` | Endpoint reference |
| 29 | `docs/member-area-mindbody-integration/api-reference.md` | MB API v6 field mappings & gotchas |
| 30 | `docs/member-area-mindbody-integration/profile-architecture.md` | Tab-by-tab UX breakdown |

---

## ENVIRONMENT VARIABLES (Netlify)

```env
MB_API_KEY=<your-mindbody-api-key>
MB_SITE_ID=<your-mindbody-site-id>
MB_STAFF_USERNAME=<staff-username-for-token>
MB_STAFF_PASSWORD=<staff-password-for-token>
```

Firebase config is embedded in `firebase-auth.js` — update for the new project.

---

## CRITICAL MINDBODY API GOTCHAS

These are hard-won lessons. Do NOT re-learn them the hard way.

### 1. PascalCase Everything
All MB query parameters MUST be PascalCase. `clientId` → silently returns empty. Use `ClientId`.

### 2. Checkout Metadata = All Strings
`Metadata` values in `/sale/checkoutshoppingcart` must ALL be strings. Numbers/booleans cause silent failures.

### 3. Booking Validation — Don't Trust Staff Token
Staff token bypasses MB's own pass validation. You MUST check the client's active services/contracts match the class's `Program.Id` server-side in `mb-book.js`.

### 4. `Clients[]` on Classes is Unreliable
The `Clients` array on `/class/classes` response is often empty even for booked clients. Cross-reference with `/client/clientvisits` for confirmed bookings.

### 5. Contract Suspend (Pause) — CONFIRMED WORKING
```
POST /client/suspendcontract
```
**Required fields — all of them or it fails with misleading errors:**
- `ClientId` (string)
- `ClientContractId` (number)
- `SuspendDate` (ISO date string — this is the START date)
- `Duration` (number)
- `DurationUnit` ("Day")
- `SuspensionType` ("Vacation", "Illness", or "Injury" — NOT "None" which crashes)

**What does NOT work:**
- `/sale/suspendcontract` → HTML 404 (endpoint doesn't exist)
- Omitting `SuspensionType` → misleading "Duration and DurationUnit are required" error
- `SuspensionType: "None"` → 500 server crash
- "exceeded maximum iterations for SuspensionType" = contract has hit max allowed pauses

### 6. Resume/Cancel Pause — NO API Endpoint
Tried every combination. Requires studio admin action. Show user a "contact us" message.

### 7. `IsSuspended` Lies for Future Pauses
`IsSuspended` is `false` for future-dated pauses. Use Firestore `users/{uid}.pausedContracts` map as the reliable source.

### 8. Liability Waiver — `updateclient` Doesn't Persist
`POST /client/updateclient` with `LiabilityRelease: true` does NOT reliably stick. Use client notes with "WAIVER_SIGNED" marker instead:
- **Write:** `POST /client/addclientnote` with text containing "WAIVER_SIGNED"
- **Read:** `GET /client/clientnotes?ClientId=X&Limit=50` → scan for "WAIVER_SIGNED"

### 9. Sales API — ClientId Filter is Ignored
`/sale/sales` ignores the `ClientId` filter parameter. Fetch all and match by BOTH `ClientId` AND `RecipientClientId` client-side.

### 10. Field Name Confusion
| What You Want | Correct Field | Wrong Field (returns 0/null) |
|---|---|---|
| Item price | `UnitPrice` | `Price` |
| Sale total | `TotalAmount` | `AmountPaid` |
| Tax | `TaxAmount` + `Tax1`–`Tax5` | `Tax` |
| Payment amount | `Amount` | `PaymentAmountPaid` |
| Payment method | `Type` | `PaymentMethodName` |
| Client (actual person) | `RecipientClientId` (number) | — |
| Purchaser account | `ClientId` (string) | — |

### 11. `ClientServices` Has No Price
Cross-reference with `/sale/sales` by matching description text.

### 12. Contract Prices
Use `UpcomingAutopayEvents[0].ChargeAmount` / `.Subtotal` / `.Tax`. The top-level autopay fields are all 0.

### 13. "99999 remaining" = Unlimited
Mindbody uses 99999 as the sentinel value for unlimited sessions.

### 14. PUT to Netlify Functions → 404
Netlify Functions don't support PUT. Use POST with an `action` field in the body.

### 15. Session Types for Class Filtering
`ClassDescription.SessionType.Name` gives you the class category (e.g., "Bikram Yoga Variation", "Yin Yoga (Passive/Static)"). Set these up in MB admin → Class Setup → Session Types. The schedule filter builds dynamically from these.

---

## PROFILE.JS — SECTION MAP

```
Lines 1–17:     Module header, variables (currentUser, clientId, clientPassData, staffCache, waiverSigned)
Lines 18–102:   SignaturePad() — canvas-based waiver signature
Lines 104–155:  init() — Firebase auth state listener, tab init, deep-link handling
Lines 156–357:  Profile form save, password change, phone/DOB onboarding flow
Lines 358–423:  Tab lock system (setTabsLocked, showTabLockedToast)
Lines 424–551:  loadProfile(), ensureBackendClient() — Firestore + MB client sync
Lines 552–831:  Waiver system (fetch text, check status, sign form, submit)
Lines 831–887:  Avatar upload (resize + Firestore storage)
Lines 887–1237: MY PASSES TAB — loadMembershipDetails, pause/terminate with date calc
Lines 1237–1340: bindMembershipManageEvents() — pause/cancel modal handlers
Lines 1340–1500: Store variables, categories, storeForm init, loadStore()
Lines 1500–1860: renderStoreItems(), checkout flow, processCheckout()
Lines 2006–2040: Schedule variables, filters, initScheduleNav()
Lines 2040–2130: loadSchedule() — fetch classes + visits, detect booked
Lines 2130–2250: loadSchedulePassInfo(), renderSchedulePassInfo() — collapsible dropdown
Lines 2250–2460: renderSchedule() — day grid, class cards, filter buttons, show more
Lines 2460–2520: Event handlers (book, cancel, waitlist, desc toggle, teacher bio)
Lines 2520–2735: bookClass(), cancelClass(), showScheduleToast(), renderTeacherBio()
Lines 2735–2890: VISITS TAB — loadVisits, renderVisits, filter buttons
Lines 2890–3240: RECEIPTS TAB — loadReceipts, renderReceipts, generateInvoiceHTML
Lines 3240–3400: Helper functions (t, isDa, formatDKK, formatTime, toDateStr, esc, stripHtml)
Lines 3400–3593: COURSES TAB — loadMyCourses, renderCourseCards, openCourseViewer
```

---

## CSS ARCHITECTURE

All styles use `yb-` prefix. Key sections in `main.css`:

```
Lines 5959–6170:  .yb-mb-* — Standalone schedule widget (non-profile pages)
Lines 6700–6960:  .yb-profile__* — Profile container, hero, tabs, content areas
Lines 6960–7060:  Responsive (mobile) profile overrides
Lines 7065–7290:  .yb-store__* — Store grid, items, pricing, badges
Lines 7290–7540:  Checkout overlay, form, success states
Lines 7540–7670:  .yb-schedule__* — Schedule day labels, class cards, book buttons
Lines 7670–7860:  .yb-visits__*, .yb-receipts__* — List layouts, status badges
Lines 7860–7960:  .yb-store__categories, .yb-store__cat-btn — Category filter pills
Lines 7960–8160:  Store search, program filter, results count
Lines 8160–8270:  Onboarding overlay, reminder cards
Lines 8270–8660:  Schedule nav, teacher bio, spots indicators
Lines 8660–8770:  Schedule pass dropdown, class description expandable
Lines 8770–8900:  Schedule class type filters, show more button
Lines 8900–9540:  .yb-membership__* — Passes tab, billing info, manage modals
Lines 9540–9720:  Schedule toast, animation keyframes
```

---

## FIRESTORE DATA MODEL

### Collection: `users/{uid}`
```javascript
{
  uid: "firebase-uid",
  email: "user@example.com",
  firstName: "John",
  lastName: "Doe",
  phone: "004512345678",
  dateOfBirth: "01/15/1990",
  yogaLevel: "beginner",           // beginner, intermediate, advanced
  practiceFrequency: "2-3",        // 1, 2-3, 4-5, daily
  role: "user",                    // user, admin
  membershipTier: "member",        // free, member
  mindbodyClientId: "100000037",   // Linked MB client ID
  photoUrl: "data:image/jpeg;base64,...",  // Avatar (base64 in Firestore)
  pausedContracts: {               // Map of paused contracts
    "12345": {
      startDate: "2026-03-01",
      endDate: "2026-03-15",
      reason: "Vacation",
      pausedAt: "2026-02-10T12:00:00Z"
    }
  },
  consents: {
    terms: true,
    privacy: true,
    codeOfConduct: true,
    newsletter: false,
    acceptedAt: Timestamp
  },
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

### Collection: `consents/{id}`
```javascript
{
  uid: "firebase-uid",
  email: "user@example.com",
  consents: {
    terms: { accepted: true, version: "2026-01", timestamp: Timestamp },
    privacy: { accepted: true, version: "2026-01", timestamp: Timestamp },
    codeOfConduct: { accepted: true, version: "2026-01", timestamp: Timestamp }
  },
  userAgent: "Mozilla/5.0...",
  createdAt: Timestamp
}
```

---

## ONBOARDING FLOW

1. User registers (Firebase Auth)
2. `ensureUserProfile()` creates Firestore `users/{uid}` document
3. `createMindbodyClient()` creates MB client → stores `mindbodyClientId`
4. Profile page loads → tabs are LOCKED until phone + DOB are filled
5. User fills phone + DOB → `setTabsLocked(false)` → all tabs accessible
6. Waiver check runs → if unsigned, waiver modal appears before first booking
7. Schedule/Store/Passes tabs lazy-load on first click

---

## FEATURE-BY-FEATURE IMPLEMENTATION NOTES

### Schedule Tab
- Fetches classes for the current week (today → Sunday, or Mon → Sun for future weeks)
- Class type filter pills built dynamically from `sessionTypeName` (MB SessionType)
- Shows 3 days initially → "Show more" → reveals rest → "Show next week"
- Active passes shown in collapsible dropdown at top
- Book button only appears if client has a valid pass for that program
- Booking: POST to `mb-book` → validates pass server-side → calls MB addclienttoclass
- Cancel: POST to `mb-book` with DELETE action → calls MB removeclientfromclass
- Waitlist: POST to `mb-waitlist` for full classes
- Teacher bios: click instructor name → fetch from `mb-staff` → expandable card

### Store Tab
- Fetches services (`mb-services?sellOnline=true`) + contracts (`mb-contracts`) in parallel
- Categories built from heuristic name matching (see `categorizeService()`)
- Category pills wrap (no horizontal scroll)
- Checkout: opens overlay → credit card form → POST to `mb-checkout`
- Contract purchase: different flow → POST to `mb-contracts` with action=purchase

### My Passes Tab
- Fetches active services + contracts from `mb-client-services`
- Shows billing info, next autopay date, remaining sessions
- Pause: opens date picker → validates (14-day min, 93-day max) → POST to `mb-contract-manage`
- Terminate: shows notice period → confirms → POST to `mb-contract-manage`
- Pause persistence: Firestore `pausedContracts` map (MB `IsSuspended` unreliable for future pauses)

### Receipts Tab
- Merges data from 3 sources (sales, services, contracts) via `mb-purchases`
- `RecipientClientId` = actual client (compare as strings!)
- Invoice generation: full HTML with company header, VAT breakdown, payment details

### Visit History Tab
- Fetches from `mb-visits` (90 days back, 30 days forward)
- Filters: All, Upcoming, Completed, No-shows
- Shows class name, instructor, time, status badge

---

## STEP-BY-STEP REPLICATION ORDER

For a new site (Hot Yoga Copenhagen), implement in this order:

1. **Environment setup** — Eleventy + Nunjucks project, Firebase project, Netlify site
2. **`shared/mb-api.js`** — Token management (change env var names if needed)
3. **`mb-client.js` + `mb-sync.js`** — Client find/create/link
4. **`firebase-auth.js`** — Auth + auto MB client creation
5. **Profile template** — `profile.njk` with basic hero + tab structure
6. **`mb-classes.js`** — Schedule endpoint
7. **Schedule tab** in `profile.js` — Class display, filters, navigation
8. **`mb-book.js`** — Booking with pass validation
9. **`mb-services.js` + `mb-contracts.js` + `mb-checkout.js`** — Store endpoints
10. **Store tab** — Product listing, categories, checkout
11. **`mb-client-services.js`** — Active passes
12. **My Passes tab** — Display + pause/terminate
13. **`mb-contract-manage.js`** — Pause/terminate backend
14. **`mb-visits.js`** — Visit history endpoint
15. **Visits tab** — Display + filters
16. **`mb-purchases.js`** — Purchase history (3-source merge)
17. **Receipts tab** — Display + invoice generation
18. **`mb-waiver.js`** — Waiver backend
19. **Waiver flow** — Check + sign in profile.js
20. **`mb-staff.js`** — Teacher bios
21. **`mb-waitlist.js`** — Waitlist backend
22. **CSS** — Copy relevant sections, adjust brand colors
23. **i18n** — Create profile.json with all translation keys
24. **Testing** — Test each tab end-to-end

---

## WHAT TO CHANGE FOR HOT YOGA COPENHAGEN

1. **Brand colors** — Replace `#f75c03` (Yoga Bible orange) with `#3f99a5` (Hot Yoga CPH teal)
2. **Firebase project** — New Firebase config
3. **MB credentials** — New `MB_API_KEY`, `MB_SITE_ID`, `MB_STAFF_USERNAME`, `MB_STAFF_PASSWORD`
4. **i18n strings** — Update studio name, descriptions, URLs
5. **Session types** — Will auto-populate from MB (your class types may differ)
6. **Invoice template** — Update company name, address, CVR, bank details
7. **Waiver text** — Fetched from MB automatically (studio-specific)
8. **Domain/URLs** — Update internal links
