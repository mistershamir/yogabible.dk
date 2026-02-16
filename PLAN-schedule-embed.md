# Schedule Embed for Hot Yoga CPH (Framer Site)

## Goal
Replace the MindBody widget on hotyogacph.dk (Framer) with a custom schedule embed that handles booking, auth, and pass validation — all from a single `<script>` tag, just like `checkout-embed.js`.

---

## How It Works (User's Perspective)

### On the Schedule Page
1. **Schedule loads automatically** — shows this week's classes grouped by day
2. Each class shows: **time**, **class name**, **instructor**, **spots left** (if < 8)
3. Week navigation: **Previous / Next week** buttons + week label
4. **Class type filters** — dynamic pills based on session types (e.g., "All", "Hot Yoga", "Yin", "Flow")

### Booking Flow (Button States)

| User State | Button | On Click |
|-----------|--------|----------|
| **Not logged in** | `Book` | Opens login popup (reuses checkout-embed auth modal) |
| **Logged in, no pass** | `Book` | Shows "You need a pass" message + link to store/pricing page |
| **Logged in, has pass** | `Book` | Books class → confirmation toast → button becomes "Booked" |
| **Already booked** | `Booked ✓` | Shows "Cancel or change via your profile" message with link |
| **Class full** | `Waitlist` | Joins waitlist (if logged in) or opens login first |
| **Cancelled class** | `Cancelled` (disabled) | No action |
| **Past class** | No button | — |

### After Booking
- Toast notification: "You're booked! [Class Name] at [Time]"
- Button changes to "Booked ✓" (teal outline, disabled-looking)
- Clicking "Booked ✓" shows message: "To cancel or change, visit your profile" with a link to `profile.hotyogacph.dk/#schedule`

---

## Technical Architecture

### New File: `hot-yoga-cph/public/js/schedule-embed.js`

Self-contained IIFE (same pattern as `checkout-embed.js`):
- Prevents double-loading with `window.__hyc_schedule_embed_loaded` guard
- Injects its own CSS into the page
- Injects schedule container HTML into a target element
- Loads Firebase SDK (if not already loaded by checkout-embed)
- Uses same API base: `https://profile.hotyogacph.dk/.netlify/functions`

### Dependencies on checkout-embed.js
The schedule embed **requires** `checkout-embed.js` to be loaded on the same page (it already is for store CTAs). It reuses:
- `window.openLoginModal()` — for the login popup
- `window.openCheckoutFlow(prodId)` — NOT used here (schedule doesn't sell)
- Firebase instance (already initialized by checkout-embed)

If checkout-embed is NOT loaded, schedule-embed gracefully degrades:
- Schedule still displays (no auth required to view)
- Book buttons show "Log in to book" and link to the profile site

### CORS Header
Add to `netlify.toml`:
```toml
[[headers]]
  for = "/js/schedule-embed.js"
  [headers.values]
    Access-Control-Allow-Origin = "*"
    Cache-Control = "public, max-age=300"  # 5 min (schedule data changes more often)
```

---

## Embed Usage (on Framer)

```html
<!-- Already loaded for store: -->
<script src="https://profile.hotyogacph.dk/js/checkout-embed.js"></script>

<!-- New: Schedule embed -->
<script src="https://profile.hotyogacph.dk/js/schedule-embed.js"></script>

<!-- Target container (Framer HTML embed block): -->
<div id="hyc-schedule"></div>
```

The script auto-finds `#hyc-schedule` and renders the schedule inside it.

---

## API Calls Used

| Endpoint | Purpose | Auth Required |
|----------|---------|---------------|
| `GET /mb-classes?startDate=X&endDate=Y` | Fetch weekly schedule | No |
| `GET /mb-classes?startDate=X&endDate=Y&clientId=Z` | Fetch schedule with booking status | Yes (clientId) |
| `GET /mb-visits?clientId=Z&startDate=X&endDate=Y` | Check which classes user has booked | Yes |
| `GET /mb-client-services?clientId=Z` | Check if user has active pass | Yes |
| `POST /mb-book` | Book a class | Yes |
| `GET /mb-staff?staffId=X` | Fetch teacher bio (on click) | No |
| `POST /mb-waitlist` | Join waitlist | Yes |

---

## Detailed Booking Logic

```
User clicks "Book" on a class:
│
├─ Is user logged in? (check firebase.auth().currentUser)
│  ├─ NO → call window.openLoginModal()
│  │        After login completes, re-check and continue flow
│  │
│  └─ YES → Do we have their MB clientId?
│     ├─ NO → fetch from Firestore (users/{uid}.mindbodyClientId)
│     │
│     └─ YES → Do they have an active pass?
│        ├─ UNKNOWN (not loaded yet) → fetch GET /mb-client-services
│        ├─ NO → show toast: "You need a pass to book."
│        │        Show link/button: "Buy a pass →" pointing to pricing page or store
│        │
│        └─ YES → Has waiver been signed?
│           ├─ NO → show toast: "Sign waiver first" + link to profile
│           └─ YES → POST /mb-book { clientId, classId }
│              ├─ Success → toast "You're booked!" + switch to "Booked ✓"
│              ├─ error: 'no_pass' → toast "Your pass doesn't cover this class type"
│              │                     + link to store/pricing
│              └─ error: other → toast with error message
```

---

## UI Design

### Schedule Layout
Uses HYC brand teal (`#3f99a5`) throughout. Clean, minimal design matching Framer site aesthetic.

```
┌─────────────────────────────────────────────────┐
│  ◀ Previous     15 Feb – 21 Feb 2026    Next ▶  │
├─────────────────────────────────────────────────┤
│  [All] [Hot Yoga] [Yin] [Flow] [Restore]        │  ← filter pills
├─────────────────────────────────────────────────┤
│                                                   │
│  MONDAY · 17 February                            │
│  ─────────────────────────────────────────────── │
│  06:00 – 07:15  │ Hot Yoga 60        │  Sarah  │ [Book]      │
│  08:00 – 09:15  │ Yin Yoga           │  Lars   │ [Book]      │
│  17:00 – 18:15  │ Hot Flow 75        │  Maria  │ [Booked ✓]  │
│  19:00 – 20:00  │ Hot Yoga 60        │  TBA    │ [Waitlist]  │
│                  │                    │ 2 spots │             │
│                                                   │
│  TUESDAY · 18 February                           │
│  ─────────────────────────────────────────────── │
│  ...                                              │
│                                                   │
│              [ Show more days ]                   │
└─────────────────────────────────────────────────┘
```

### Toast Notifications
Slide-in from top, auto-dismiss after 4 seconds:
- **Success** (teal bg): "You're booked! Hot Yoga 60 at 06:00"
- **Error** (red bg): "You need a pass to book classes."
- **Warning** (amber bg): "Late cancellation may incur fees."

### Mobile Responsive
- Full width on mobile
- Class rows stack vertically (time above, name + instructor below, button right-aligned)
- Filter pills scroll horizontally

---

## State Management

```javascript
// Internal state (closure variables)
var scheduleUser = null;       // Firebase user
var scheduleMbClientId = null; // Mindbody client ID
var schedulePassData = null;   // Cached pass/service data
var scheduleWaiverSigned = false;
var scheduleWeekOffset = 0;    // 0 = current week, 1 = next, -1 = prev
var scheduleClassFilter = 'all';
var scheduleClasses = [];      // Cached classes for current week
```

### Auth State Listener
```javascript
firebase.auth().onAuthStateChanged(function(user) {
  scheduleUser = user;
  if (user) {
    // Resolve MB clientId from Firestore
    // Fetch pass data
    // Re-render schedule with booking status
  } else {
    // Clear state
    // Re-render schedule without booking status
  }
});
```

---

## Implementation Steps

### Step 1: Create `schedule-embed.js` skeleton
- IIFE with double-load guard
- Config constants (BRAND, API_BASE, etc.)
- Language detection (`isDa` from URL path)
- CSS injection function
- HTML container setup

### Step 2: Schedule fetching & rendering
- `loadSchedule()` — fetch classes from API, group by day
- `renderSchedule()` — build HTML for days, classes, filters
- Week navigation (prev/next buttons)
- Class type filter pills
- "Show more" / "Show next week" progressive disclosure

### Step 3: Auth integration
- Firebase auth state listener
- Firestore clientId resolution
- Pass data fetching (`mb-client-services`)
- Waiver status checking
- Re-render schedule when auth state changes (to show booked classes)

### Step 4: Booking flow
- `bookClass()` — full flow with auth check, pass check, waiver check
- `handleBookedClick()` — "Cancel or change via your profile" message
- Toast notification system
- Button state transitions (Book → Booking... → Booked ✓)

### Step 5: Polish
- Teacher bio on-click (optional, v2)
- Class description toggle (optional, v2)
- Waitlist support
- Loading states & error handling
- Mobile responsive CSS
- Spots-left indicator

### Step 6: Deployment
- Add CORS header in netlify.toml
- Test on Framer site
- Verify all booking flows work

---

## What This Does NOT Include
- **Cancellation** — handled in the profile dashboard only. The embed shows "Booked ✓" with a link to profile for changes.
- **Pass purchasing** — the embed links to the pricing page or triggers `checkout-embed.js` if a specific prodId is known.
- **Visit history** — profile-only feature.
- **Waiver signing** — profile-only feature. Embed just checks status and directs to profile if unsigned.

---

## File Changes Summary

| File | Action |
|------|--------|
| `hot-yoga-cph/public/js/schedule-embed.js` | **NEW** — the schedule embed script |
| `hot-yoga-cph/netlify.toml` | **EDIT** — add CORS header for schedule-embed.js |

No changes needed to existing files (`checkout-embed.js`, `profile.js`, etc.) — the schedule embed is fully standalone.
