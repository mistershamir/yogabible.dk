# Member Area / Mindbody Integration — Multi Brand

> Reusable reference for building member areas on Yoga Bible DK, Hot Yoga CPH, and future brand sites.
> All brands share the same Mindbody Site ID and Firebase project (yoga-bible-dk-com).
> **Last updated: 2026-02-08** — reflects all debugging from the full build session.

## Quick Start for New Brand

1. Copy all `netlify/functions/mb-*.js` and `netlify/functions/shared/` to the new project
2. Copy `src/js/profile.js` as a starting point for the member area JS
3. Copy `src/js/firebase-auth.js` for auth + Mindbody client auto-creation
4. Set up Firebase Auth + Firestore (or connect to existing project)
5. Configure Netlify env vars (see Environment Setup below)
6. Adapt the profile template and translations for the new brand
7. Build and verify: `npx @11ty/eleventy`

## Architecture

```
Browser (Client-Side)
├── firebase-auth.js ── Firebase Auth (login/register/reset)
│                        └── Auto-creates Mindbody client on signup
│                        └── Syncs membershipTier to Firestore
├── profile.js ───────── 6-tab member dashboard
│   ├── Profile tab ──── Firestore profile + MB client sync
│   ├── Schedule tab ─── Classes + booking + pass validation
│   ├── Store tab ────── Services + contracts (parallel fetch)
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

## Environment Variables (Netlify)

```
MB_API_KEY=<your-mindbody-api-key>
MB_SITE_ID=<your-site-id>
MB_STAFF_USERNAME=<staff-email-for-token>
MB_STAFF_PASSWORD=<staff-password-for-token>
```

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
1. Profile tab shows active contracts with Pause/Cancel buttons
2. **Pause**: Date picker (14-93 days), starts after next billing cycle
3. **Cancel**: Calculates termination date (next billing + 1 month - 1 day)
4. POST to `mb-contracts` with `action: 'suspend'` or `action: 'terminate'`
5. Server tries multiple Mindbody endpoint paths with fallback

## See Also

- [API Reference & Debug Trail](./api-reference.md) — ALL the lessons learned
- [Function Catalog](./function-catalog.md) — Every Netlify function with usage
- [Profile JS Architecture](./profile-architecture.md) — How the frontend works
