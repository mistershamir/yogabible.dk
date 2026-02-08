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
  - Pass info banner (shows active pass name + remaining uses)
  - Book/Cancel buttons (with pass validation)
  - Teacher bio expansion (clickable names, fetches from `mb-staff`)
  - Class description expansion (HTML from Mindbody)
  - Waitlist for full classes (uses `mb-waitlist`)
- **Booking flow:**
  1. Frontend checks `clientPassData.activeServices` matches class `programId`
  2. If no match → show "no pass" error, don't send request
  3. If match → POST to `mb-book` → server validates again → books → show Cancel button
- **Cancel flow:**
  1. DELETE to `mb-book`
  2. If window error → auto-retries with LateCancel: true
  3. Show appropriate toast (success / late cancel warning)

### 3. Store Tab (Butik)
- **Data source:** `mb-services` (services + categories)
- **Flow:** Select service → fill payment form → POST to `mb-checkout`
- **Future:** Add contracts from `mb-contracts`, promo codes from `mb-site`

### 4. Visit History Tab (Besøgshistorik)
- **Data source:** `mb-visits`
- **Features:** Filter pills (All / Upcoming / Attended / No-show)
- **Status colors:** Booked (orange), Attended (green), No-show (red)

### 5. Receipts Tab (Kvitteringer)
- **Data source:** `mb-purchases` (tries /sale/sales first, fallback to /sale/clientpurchases)
- **Display:** Card layout with date, item name, amount, payment method

### 6. Courses Tab (Mine Kurser)
- **Data source:** Firestore (separate course system)
- **Not connected to Mindbody** — custom enrollment + progress tracking

## JavaScript Architecture

```javascript
// profile.js structure (~1200 lines)
(function() {
  'use strict';

  // ─── State ───
  var currentUser = null;
  var currentDb = null;
  var clientId = null;        // Mindbody client ID from Firestore
  var clientPassData = null;  // Cached pass/service data
  var staffCache = {};        // Cached teacher bios by ID
  var scheduleWeekOffset = 0; // Week navigation state
  var allVisits = [];         // Cached for filtering
  var activeVisitFilter = 'all';

  // ─── Init Flow ───
  // 1. Wait for Firebase SDK to load
  // 2. Listen for auth state change
  // 3. Load Firestore profile → get mindbodyClientId
  // 4. Init tabs, store form, schedule nav, avatar upload, visit filters
  // 5. Load initial tab data

  // ─── Key Functions ───
  // loadProfile(user, db)      — Firebase profile + Mindbody sync
  // loadSchedule()             — Classes + visits parallel fetch
  // renderSchedule()           — Build schedule HTML with book/cancel/bio
  // bookClass(btn)             — Pass validation + booking
  // cancelClass(btn)           — Cancel with late-cancel retry
  // loadReceipts()             — Purchase history
  // loadVisitHistory()         — Visit data + filters

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

## Bilingual Support

- Language detection: `window.location.hostname` or `window.location.pathname.startsWith('/en/')`
- Translation function `t(key)` returns DA or EN based on current language
- Inline fallbacks for toast messages: `isDa() ? 'Danish text' : 'English text'`
- Template uses `{% set t = i18n.profile[lang or "da"] %}` for Nunjucks
