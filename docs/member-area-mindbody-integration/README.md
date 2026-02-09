# Member Area / Mindbody Integration — Multi Brand

> Reusable reference for building member areas on Yoga Bible DK, Hot Yoga CPH, and future brand sites.
> All brands share the same Mindbody Site ID and Firebase project (yoga-bible-dk-com).
> **Last updated: 2026-02-09** — reflects store redesign, retention card, My Passes tab, and all debugging.

## What This System Does

A complete self-service member area powered by Firebase Auth + Mindbody API v6:

- **Profile & Auth** — Firebase login, Firestore profiles, Mindbody client sync, avatar upload
- **Class Schedule** — Weekly view, book/cancel, waitlist, teacher bios, pass validation
- **Online Store** — Sell services AND contracts (recurring memberships) from Mindbody, with search bar, category tabs, descriptions, contract terms, and T&C links
- **My Passes** — Active passes, contract management (pause/suspend/cancel/terminate), retention card with reactivation CTA
- **Visit History** — Filterable past + upcoming visits with status badges
- **Receipts** — Purchase history with downloadable text receipts
- **Courses** — Custom course system via Firestore (separate from Mindbody)

## Quick Start for New Brand

1. Copy all `netlify/functions/mb-*.js` and `netlify/functions/shared/` to the new project
2. Copy `src/js/profile.js` as a starting point for the member area JS
3. Copy `src/js/firebase-auth.js` for auth + Mindbody client auto-creation
4. Set up Firebase Auth + Firestore (or connect to existing project)
5. Configure Netlify env vars (see Environment Setup below)
6. Adapt the profile template and translations for the new brand
7. Customize `storeCategories` and `categorizeService()` heuristics for brand-specific product names
8. Customize termination/pause business rules (notice period, min/max pause duration)
9. Build and verify: `npx @11ty/eleventy`

## Architecture

```
Browser (Client-Side)
├── firebase-auth.js ── Firebase Auth (login/register/reset)
│                        └── Auto-creates Mindbody client on signup
│                        └── Syncs membershipTier to Firestore
├── profile.js ───────── 7-tab member dashboard
│   ├── Profile tab ──── Firestore profile + MB client sync + tier badge
│   ├── Schedule tab ─── Classes + booking + pass validation
│   ├── Store tab ────── Services + contracts with search, descriptions, terms
│   ├── My Passes tab ── Active passes + contract management + retention card
│   ├── Visits tab ───── Visit history with status filters
│   ├── Receipts tab ─── Purchase history with download
│   └── Courses tab ──── Firestore-only (not connected to MB)
└── mindbody.js ──────── Original checkout modal (standalone pages)

Netlify Functions (Server-Side)
├── shared/mb-api.js ─── Centralized auth, token caching, error handling
├── mb-classes.js ────── GET class schedule
├── mb-book.js ───────── POST book / DELETE cancel (with retry logic)
├── mb-client.js ─────── GET find / POST create / PUT update client
├── mb-sync.js ───────── POST sync Firebase user to Mindbody
├── mb-client-services.js GET client passes + contracts
├── mb-services.js ───── GET purchasable services/products/categories
├── mb-contracts.js ──── GET contracts / POST purchase|terminate|suspend
├── mb-contract-manage.js POST terminate|suspend (standalone function)
├── mb-checkout.js ───── POST checkout with credit card
├── mb-purchases.js ──── GET purchase/receipt history
├── mb-visits.js ─────── GET visit history
├── mb-staff.js ──────── GET teacher bios/photos
├── mb-waitlist.js ───── GET/POST/DELETE waitlist management
├── mb-class-descriptions.js GET class type library
├── mb-site.js ───────── GET site config (programs, locations, etc.)
└── mb-return-sale.js ── POST refund (admin-only, needs auth guard)

External Services
├── Mindbody API v6 ──── https://api.mindbodyonline.com/public/v6
├── Firebase Auth ────── Email/password authentication
└── Firestore ────────── users/{uid} profiles + course data
```

### Key Design Decisions

- **Staff token auth** — All API calls use staff credentials, which bypasses Mindbody's "Sell Online" filter. This means we can sell ANY pass/contract from our store, even if not marked "Sell Online" in Mindbody admin. Positive for flexibility, but requires careful product curation on our side.
- **Backend validation** — Staff tokens also bypass payment/pass validation, so we must always validate pass-to-program match server-side before booking.
- **Text-first JSON parsing** — `shared/mb-api.js` reads responses as text first, then parses JSON. This prevents cryptic `Unexpected token '<'` errors when Mindbody returns HTML error pages.
- **Dedicated manage function** — Contract management (pause/cancel) uses a separate `mb-contract-manage.js` function to avoid routing ambiguity with the purchase endpoint.
- **Fresh token for management** — `clearTokenCache()` forces a fresh staff token before terminate/suspend/activate operations to avoid stale permission errors.
- **Retention over revoke** — Mindbody's `activatecontract` endpoint doesn't exist (HTML 404 on all paths). Instead, terminated contracts show a retention card with "first month free" reactivation CTA that navigates to the Store for a new contract purchase.
- **My Passes tab** — Membership details moved from Profile tab to dedicated "My Passes" tab for cleaner UX.

## Environment Variables (Netlify)

```
MB_API_KEY=<your-mindbody-api-key>
MB_SITE_ID=<your-site-id>
MB_STAFF_USERNAME=<staff-email-for-token>
MB_STAFF_PASSWORD=<staff-password-for-token>
```

## Function Overview

| Function | Methods | Purpose |
|----------|---------|---------|
| `mb-classes` | GET | Class schedule |
| `mb-book` | POST/DELETE | Book/cancel classes |
| `mb-client` | POST | Create/update MB client |
| `mb-sync` | POST | Firebase → MB client sync |
| `mb-client-services` | GET | Active passes + contract billing data |
| `mb-services` | GET | Purchasable services/products/categories |
| `mb-contracts` | GET/POST | List + purchase contracts |
| `mb-contract-manage` | POST | Pause (suspend) / cancel (terminate) contracts |
| `mb-checkout` | POST | Purchase services with credit card |
| `mb-purchases` | GET | Purchase receipts |
| `mb-visits` | GET | Visit history |
| `mb-staff` | GET | Teacher bios/photos |
| `mb-waitlist` | GET/POST/DELETE | Waitlist management |
| `mb-site` | GET | Site config (programs, locations, etc.) |
| `mb-class-descriptions` | GET | Class type library |
| `mb-return-sale` | POST | Refunds |

## Key Flows

### User Registration
1. User fills signup form (first name, last name, email, password)
2. Firebase creates auth account
3. `ensureUserProfile()` creates Firestore doc at `users/{uid}`
4. `createMindbodyClient()` calls `mb-client` POST to create MB client
5. `mindbodyClientId` stored back in Firestore

### Class Booking
1. Frontend checks `clientCanBook(programId)` against cached pass data
2. If no pass match → show error, don't send request
3. If match → POST to `mb-book` → server validates again → books
4. If "already booked" → treated as success
5. If payment error → check autopay contract → retry with `RequirePayment: false`
6. If no pass at all → return `no_pass` error

### Service Purchase (Checkout)
1. User selects service in Store tab → opens checkout form
2. Find or create Mindbody client by email
3. **Services** → POST to `mb-checkout` (uses `/sale/checkoutshoppingcart`)
4. **Contracts** → POST to `mb-contracts` (uses `/sale/purchasecontract`)
5. Handle SCA (3D Secure) redirect if needed

### Membership Management (Pause/Cancel)
1. My Passes tab shows active contracts with Pause/Cancel buttons
2. **Pause**: Date picker (14-93 days), starts after next billing cycle
3. **Cancel**: Calculates termination date (next billing + 1 month - 1 day)
4. POST to `mb-contracts` with `action: 'suspend'` or `action: 'terminate'`
5. Server tries endpoint paths in order: `/sale/` first, then `/contract/`, `/client/`
6. Shows "Membership Terminated" badge, "Last billing" date, notice period note with T&C link
7. **Before termination date**: Retention card with perks + "Reactivate — first month free" CTA
8. **After termination date**: Simple "Become a member again" CTA linking to Store memberships

## See Also

- [API Reference & Debug Trail](./api-reference.md) — ALL the lessons learned the hard way
- [Function Catalog](./function-catalog.md) — Every Netlify function with params and returns
- [Profile JS Architecture](./profile-architecture.md) — How the frontend works (tabs, store, membership mgmt)
