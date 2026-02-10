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

## 26-File Reference Map

Everything needed to replicate the member area for Hot Yoga CPH, listed in order of importance. All paths are relative to the Yoga Bible DK repo root.

### Backend — Netlify Functions (18 files)

Copy as-is into the new `profile.hotyogacph.dk` project. Only change: update CORS origins to allow `profile.hotyogacph.dk` (and the Framer domain if needed).

| # | File | Lines | Purpose |
|---|------|-------|---------|
| 1 | `netlify/functions/shared/mb-api.js` | 122 | **Core dependency** — centralized Mindbody API auth (token management, request wrapper). Every other function imports this. |
| 2 | `netlify/functions/mb-classes.js` | 92 | Fetch weekly class schedule from Mindbody. Powers the Schedule tab. |
| 3 | `netlify/functions/mb-book.js` | 329 | Book / cancel class reservations. Handles waitlist promotion, visit validation, error mapping. |
| 4 | `netlify/functions/mb-client.js` | 159 | CRUD for Mindbody client profiles (get, create, update). Called during registration and profile edits. |
| 5 | `netlify/functions/mb-sync.js` | 116 | Sync Firebase user ↔ Mindbody client. Ensures the Firebase UID maps to a Mindbody ClientId. |
| 6 | `netlify/functions/mb-client-services.js` | 146 | Fetch a client's active services (passes, clip cards). Powers the My Passes tab. |
| 7 | `netlify/functions/mb-services.js` | 87 | Fetch purchasable services from Mindbody catalog. Powers the Store tab (non-contract items). |
| 8 | `netlify/functions/mb-contracts.js` | 396 | Fetch purchasable contracts (memberships, autopay). Powers the Store tab (contract items). Also handles contract purchase flow. |
| 9 | `netlify/functions/mb-contract-manage.js` | 260 | Suspend (pause) and terminate (cancel) active autopay contracts. Powers My Passes tab actions. |
| 10 | `netlify/functions/mb-checkout.js` | 128 | Purchase a service (non-contract) with stored credit card. Powers Store tab checkout. |
| 11 | `netlify/functions/mb-purchases.js` | 399 | Fetch purchase/transaction history. Powers the Receipts tab. Includes receipt text generation. |
| 12 | `netlify/functions/mb-visits.js` | 72 | Fetch client visit history (attended, late-cancelled, no-show). Powers the Visits tab. |
| 13 | `netlify/functions/mb-staff.js` | 48 | Fetch staff/teacher list. Used for teacher bios in Schedule tab. |
| 14 | `netlify/functions/mb-waitlist.js` | 122 | Add/remove from class waitlist. Used when a class is full. |
| 15 | `netlify/functions/mb-waiver.js` | 224 | Fetch and sign liability waivers. Required before first class booking. |
| 16 | `netlify/functions/mb-site.js` | 118 | Fetch Mindbody site/location info. Used for site metadata and location filtering. |
| 17 | `netlify/functions/mb-class-descriptions.js` | 63 | Fetch detailed class descriptions from Mindbody. Used in Schedule tab class detail modals. |
| 18 | `netlify/functions/mb-return-sale.js` | 55 | Process refunds/returns for purchases. Admin-triggered or error-recovery flow. |

**Total backend: 2,936 lines** — copy verbatim, only update CORS headers.

### Frontend — JavaScript (3 files)

These need branding adaptation and the `isDa()` language detection change.

| # | File | Lines | Purpose | Key Changes for HYC |
|---|------|-------|---------|---------------------|
| 19 | `src/js/profile.js` | 3,593 | **Main dashboard** — all 6 tabs, booking flows, store, receipts, membership management. The largest and most complex file. | Extract membership → My Passes tab. Change `isDa()` to localStorage. Update receipt footer (HYC name/address). Update all brand color refs. Add DA/EN toggle UI. |
| 20 | `src/js/firebase-auth.js` | 615 | Firebase Authentication — login, register, password reset, session management, Mindbody sync on first login. | Swap Firebase config to new HYC project. Update redirect URLs. |
| 21 | `src/js/mindbody.js` | 534 | Mindbody client-side helper — API call wrapper, error handling, loading states. Shared utility used by profile.js. | Update function base URL if Netlify domain differs. |

**Total frontend JS: 4,742 lines** — requires careful adaptation.

### Templates & Data (4 files)

| # | File | Lines | Purpose | Key Changes for HYC |
|---|------|-------|---------|---------------------|
| 22 | `src/_includes/pages/profile.njk` | 749 | Profile page template — HTML structure for all 6 tabs, modals, loading states. | Rebrand to HYC. For standalone site, this becomes `index.html`. Remove Eleventy dependencies (convert to static HTML). |
| 23 | `src/profile.njk` + `src/en/profile.njk` | ~20 | DA/EN wrapper pages (Eleventy thin wrappers). | **Not needed for HYC** — standalone site uses single `index.html` with in-app language toggle instead of path-based routing. |
| 24 | `src/_data/i18n/profile.json` | 438 | All translatable strings for the profile page (DA + EN). | Copy and adapt. Remove YB-specific strings. Add any HYC-specific labels. Embed as JS object in profile.js or load as separate JSON. |
| 25 | `src/css/main.css` (lines ~5959–9800) | ~3,841 | Profile and auth styles. All prefixed with `yb-profile-`, `yb-auth-`, etc. | Full rebrand: `#f75c03` → `#3f99a5`, `#d94f02` → `#357f89`, `#ff9966` → `#5bb8c4`. Rename prefixes from `yb-` to `hycph-` (or keep `yb-` if easier — it's a standalone site). Extract into dedicated `profile.css`. |

### Documentation Guide (1 file)

| # | File | Lines | Purpose |
|---|------|-------|---------|
| 26 | `docs/member-area-mindbody-integration/REPLICATION-GUIDE.md` | 375 | Step-by-step guide for replicating the member area to a new brand/site. Covers project setup, Firebase config, Mindbody credentials, file-by-file adaptation, testing checklist. |

### Key Configuration Changes for Hot Yoga CPH

| Setting | Yoga Bible DK | Hot Yoga CPH |
|---------|--------------|--------------|
| Brand color (primary) | `#f75c03` | `#3f99a5` |
| Brand color (dark) | `#d94f02` | `#357f89` |
| Brand color (light) | `#ff9966` | `#5bb8c4` |
| Firebase project | `yogabible-dk` (existing) | New separate project |
| MB_API_KEY | Same | Same |
| MB_SITE_ID | `5748831` | `5748831` (same studio) |
| MB_STAFF_USERNAME | (YB credentials) | `info@hotyogacph.dk` |
| MB_STAFF_PASSWORD | (YB credentials) | `HotYogaCph1234%` |
| Language detection | URL-based (`/en/` path) | localStorage-based (`hycph-lang` key) |
| i18n approach | Build-time path routing (Eleventy) | Runtime in-app toggle (DA/EN) |
| Invoice template | Same | Same |
| Hosting | yogabible.dk (Netlify) | profile.hotyogacph.dk (Netlify, separate site) |

### Dependency Graph

```
mb-api.js (shared auth)
├── mb-classes.js ─────────── Schedule tab
├── mb-book.js ────────────── Schedule tab (book/cancel)
├── mb-client.js ──────────── Registration + Profile tab
├── mb-sync.js ────────────── Registration (Firebase↔MB link)
├── mb-client-services.js ─── My Passes tab
├── mb-services.js ────────── Store tab (services)
├── mb-contracts.js ───────── Store tab (contracts)
├── mb-contract-manage.js ─── My Passes tab (pause/cancel)
├── mb-checkout.js ────────── Store tab (purchase)
├── mb-purchases.js ───────── Receipts tab
├── mb-visits.js ──────────── Visits tab
├── mb-staff.js ───────────── Schedule tab (teacher info)
├── mb-waitlist.js ────────── Schedule tab (waitlist)
├── mb-waiver.js ──────────── First booking (waiver)
├── mb-site.js ────────────── Site metadata
├── mb-class-descriptions.js ─ Schedule tab (class details)
└── mb-return-sale.js ──────── Admin/error recovery

firebase-auth.js ──── Auth flows → calls mb-sync on first login
mindbody.js ────────── Client-side API wrapper → calls all mb-* functions
profile.js ─────────── Dashboard UI → uses firebase-auth.js + mindbody.js
```

## Future Considerations

- **Shared login banner**: "Also a Yoga Bible member? Your passes work here too" — since Mindbody is shared
- **Cross-site navigation**: Small link in profile footer to switch between `profile.hotyogacph.dk` and yogabible.dk's profile (if user uses both)
- **Unified course system**: If Hot Yoga CPH adds courses later, can add the Courses tab back
