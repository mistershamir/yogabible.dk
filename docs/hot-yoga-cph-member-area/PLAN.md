# Hot Yoga Copenhagen — Member Area Plan

> Standalone member area at `profile.hotyogacph.dk`, adapted from Yoga Bible DK's member system.
> **Status: WAITING** — Do not build until Yoga Bible DK user area is fully debugged and stable.
> **Created: 2026-02-08**

## Overview

A self-service member area for Hot Yoga Copenhagen, hosted as a standalone Netlify site on a subdomain. Reuses all existing Mindbody integration (same Site ID, same functions) with Hot Yoga CPH branding.

The main Hot Yoga CPH website stays on Framer. The member area lives on `profile.hotyogacph.dk` — users click "Min profil" / "My Profile" in Framer and land here.

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Domain | `profile.hotyogacph.dk` | Clear, professional subdomain |
| Hosting | Netlify (free tier, separate site) | 125k function invocations/month is plenty. Independent from yogabible.dk |
| Firebase | Separate project | Clean separation for potential future sale. Same email = same Mindbody client regardless |
| Mindbody | Same Site ID (5748831) | Both brands share Mindbody. Use `LocationId` to filter per studio |
| Language | In-app toggle (DA/EN) | Framer has its own i18n for main site. Profile uses localStorage-based toggle |
| Branding | Teal `#3f99a5` with sage-green gradient feel | Matches Hot Yoga CPH brand identity |
| Bilingual | NOT path-based | Single `/profil/` page, `t()` function reads from localStorage preference |

## Tabs (6)

| # | Tab ID | Label (DA) | Label (EN) | Source |
|---|--------|-----------|------------|--------|
| 1 | profile | Profil | Profile | Firebase Auth + Firestore |
| 2 | passes | Mine Pas | My Passes | `mb-client-services` (extracted from Profile tab) |
| 3 | schedule | Skema | Schedule | `mb-classes` + `mb-visits` |
| 4 | store | Butik | Store | `mb-services` + `mb-contracts` |
| 5 | visits | Besog | Visits | `mb-visits` |
| 6 | receipts | Kvitteringer | Receipts | `mb-purchases` |

### Tab details

**1. Profile** — Edit name, phone, DOB, avatar, yoga level, practice frequency. NO membership section (moved to My Passes).

**2. My Passes (NEW)** — Extracted from Yoga Bible's Profile tab membership section. Shows:
- Active passes with remaining clips
- Active contracts with autopay info
- Pause (suspend) and Cancel (terminate) buttons for autopay contracts
- Past/expired passes
- Tier badge (Membership / Clip Card / No active pass)

**3. Schedule** — Weekly class view, book/cancel, waitlist, teacher bios, pass validation banner.

**4. Store** — Purchasable services + contracts from Mindbody. Category tabs (Trials, Memberships, Clip Cards, etc.). Credit card checkout. Dual routing: services → `mb-checkout`, contracts → `mb-contracts`.

**5. Visits** — Visit history with period picker (30/90/180/365 days). Filter pills: All / Upcoming / Attended / Late Cancelled / No-show. Status summary bar.

**6. Receipts** — Purchase history with downloadable text receipts. Period picker. Receipt cards with status badges.

## Architecture

```
profile.hotyogacph.dk (Netlify - free tier)
├── index.html ─────────── Single page with 6-tab profile dashboard
├── css/
│   └── profile.css ────── Hot Yoga CPH branded styles (teal #3f99a5)
├── js/
│   ├── firebase-auth.js ── Firebase Auth (separate project from YB)
│   └── profile.js ──────── 6-tab dashboard (adapted from YB)
├── netlify/functions/
│   ├── shared/mb-api.js ── Centralized Mindbody auth (copied from YB)
│   ├── mb-classes.js
│   ├── mb-book.js
│   ├── mb-client.js
│   ├── mb-sync.js
│   ├── mb-client-services.js
│   ├── mb-services.js
│   ├── mb-contracts.js
│   ├── mb-contract-manage.js
│   ├── mb-checkout.js
│   ├── mb-purchases.js
│   ├── mb-visits.js
│   ├── mb-staff.js
│   └── mb-waitlist.js
└── netlify.toml ──────── Build config + redirects

External Services
├── Mindbody API v6 ──── Same Site ID as Yoga Bible
├── Firebase Auth ────── SEPARATE project (hot-yoga-cph or similar)
└── Firestore ────────── SEPARATE — users/{uid} profiles only (no courses)
```

## Firebase Strategy — Separate but Shareable

### Why separate projects
- **Clean ownership**: If you sell Hot Yoga CPH, hand over the Firebase project. Done.
- **Independent billing**: Each project has its own usage/quotas
- **No cross-contamination**: Hot Yoga CPH users don't appear in Yoga Bible admin and vice versa

### How users "bridge" naturally
- Both sites use the **same Mindbody Site ID** (5748831)
- Mindbody client lookup is by **email** — if the same person registers on both sites with the same email, they get the same Mindbody client
- Their passes, bookings, and memberships are shared at the Mindbody level (because it's the same studio system)
- Their Firebase profiles (avatar, preferences) are independent per site

### If you want to disconnect later
- Just stop sharing the Mindbody Site ID (if applicable)
- Each Firebase project is already standalone — nothing to migrate
- No shared databases, no shared auth, no dependencies

## Branding — Hot Yoga CPH

### Color Palette
```
--hycph-brand:        #3f99a5    /* Primary teal */
--hycph-brand-dark:   #357f89    /* Hover/active states */
--hycph-brand-light:  #5bb8c4    /* Accents, gradients */
--hycph-black:        #0F0F0F    /* Text, dark backgrounds */
--hycph-muted:        #6F6A66    /* Secondary text */
--hycph-border:       #E8E4E0    /* Dividers */
--hycph-light-bg:     #F5F3F0    /* Section backgrounds */
--hycph-warm-white:   #FFFCF9    /* Cards */
```

### Visual direction
- Sage-green/teal gradient feel (per the provided screenshots)
- Same component patterns as Yoga Bible but with teal accents instead of orange
- Buttons: teal primary, black secondary
- Cards: teal stroke for active/important states
- Tab active indicator: teal underline or pill

## Language System — In-App Toggle

### How it works
```javascript
// Instead of URL-based detection:
// OLD: function isDa() { return window.location.pathname.indexOf('/en/') !== 0; }

// NEW: localStorage-based detection:
function isDa() {
  return localStorage.getItem('hycph-lang') !== 'en';
}

function setLang(lang) {
  localStorage.setItem('hycph-lang', lang);
  // Re-render current tab with new language
  refreshCurrentTab();
}
```

### Toggle UI
- Small DA/EN toggle in the profile header (next to avatar)
- Defaults to Danish
- Persists across sessions via localStorage
- The existing `t()` translation map in profile.js works as-is — just swap the detection method

## Netlify Free Tier — What You Get

| Resource | Free Limit | Expected Usage |
|----------|-----------|----------------|
| Bandwidth | 100 GB/month | <1 GB (single page + API calls) |
| Build minutes | 300/month | <10/month (rarely rebuilds) |
| Function invocations | 125,000/month | ~5,000-20,000 (depends on active members) |
| Function runtime | 10s per invocation | Mindbody calls typically 1-3s |
| Concurrent builds | 1 | Fine for a single-page app |

**Verdict**: Free tier is more than sufficient. You'd need hundreds of active daily users to approach limits.

## Adaptation Checklist (When Ready to Build)

### Phase 1: Project Setup
- [ ] Create new Netlify site
- [ ] Create new Firebase project (hot-yoga-cph)
- [ ] Set up Firebase Auth (email/password)
- [ ] Set up Firestore (users collection)
- [ ] Configure DNS: `profile.hotyogacph.dk` → Netlify
- [ ] Set Netlify env vars (MB_API_KEY, MB_SITE_ID, MB_STAFF_USERNAME, MB_STAFF_PASSWORD)

### Phase 2: Copy & Adapt Backend
- [ ] Copy all `netlify/functions/mb-*.js` and `shared/`
- [ ] Update CORS to allow `profile.hotyogacph.dk` + Framer domain
- [ ] Verify all functions work with same Mindbody credentials
- [ ] Add LocationId filtering if Hot Yoga CPH has a specific location

### Phase 3: Copy & Adapt Frontend
- [ ] Create `index.html` with 6-tab structure
- [ ] Copy `profile.js` → adapt:
  - [ ] Extract membership section into separate "My Passes" tab
  - [ ] Change `isDa()` to localStorage-based
  - [ ] Update function URLs (if different Netlify domain)
  - [ ] Update receipt footer (Hot Yoga CPH name/address)
  - [ ] Update store category heuristics if needed
  - [ ] Add DA/EN toggle to header
- [ ] Copy `firebase-auth.js` → update Firebase config to new project
- [ ] Create `profile.css` — rebrand from orange → teal:
  - [ ] All `#f75c03` → `#3f99a5`
  - [ ] All `#d94f02` → `#357f89`
  - [ ] All `#ff9966` → `#5bb8c4`
  - [ ] Update gradient backgrounds to sage-green feel
  - [ ] Match Framer site's font if different from Abacaxi

### Phase 4: Test
- [ ] Test registration flow (new Firebase project)
- [ ] Test Mindbody client creation
- [ ] Test class booking + cancel
- [ ] Test store checkout (service + contract)
- [ ] Test membership pause + cancel
- [ ] Test visit history
- [ ] Test receipts + download
- [ ] Test language toggle
- [ ] Test on mobile

### Phase 5: Connect to Framer
- [ ] Add "Min profil" / "My Profile" link in Framer nav → `profile.hotyogacph.dk`
- [ ] Add login/register links in Framer → `profile.hotyogacph.dk`
- [ ] Style the transition so it feels seamless (matching colors, fonts)

## Dependencies

**BLOCKER**: Yoga Bible DK user area must be fully debugged and stable first. All Mindbody edge cases, booking flows, checkout, and membership management need to be battle-tested on Yoga Bible before porting to Hot Yoga CPH.

**Reason**: The Netlify Functions are copied as-is. Any bug fixed in Yoga Bible's functions needs to be fixed before copying — otherwise you're debugging the same issues twice.

## Future Considerations

- **Shared login banner**: "Also a Yoga Bible member? Your passes work here too" — since Mindbody is shared
- **Cross-site navigation**: Small link in profile footer to switch between `profile.hotyogacph.dk` and yogabible.dk's profile (if user uses both)
- **Unified course system**: If Hot Yoga CPH adds courses later, can add the Courses tab back
