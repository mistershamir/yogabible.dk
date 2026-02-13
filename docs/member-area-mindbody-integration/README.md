# Member Area / Mindbody Integration — Multi Brand

> Reusable reference for building member areas on Yoga Bible DK, Hot Yoga CPH, and future brand sites.
> All brands share the same Mindbody Site ID and Firebase project (yoga-bible-dk-com).
> **Last updated: 2026-02-10** — reflects invoice/receipt rewrite with 3-source merge, correct MB field mappings, HTML invoice generation.

## What This System Does

A complete self-service member area powered by Firebase Auth + Mindbody API v6:

- **Profile & Auth** — Firebase login, Firestore profiles, Mindbody client sync, avatar upload, consent checkboxes + audit trail, mandatory phone/DOB onboarding
- **Class Schedule** — Weekly view, book/cancel, waitlist, teacher bios, pass validation
- **Online Store** — Sell services AND contracts (recurring memberships) from Mindbody, with search bar, category tabs, descriptions, contract terms, and T&C links
- **My Passes** — Active passes, contract management (pause/suspend/cancel/terminate), retention card with reactivation CTA
- **Visit History** — Filterable past + upcoming visits with status badges
- **Receipts** — Purchase history from 3 MB sources with downloadable HTML invoices (company header, line items, VAT, bank details)
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
9. Update consent checkbox links to point to new brand's T&C, Privacy Policy, Code of Conduct pages
10. Update consent `version` string in `firebase-auth.js` when policy documents change
11. Set up Firestore security rules for `consents` collection (write-only from clients, admin-read)
12. Build and verify: `npx @11ty/eleventy`

## Architecture

```
Browser (Client-Side)
├── firebase-auth.js ── Firebase Auth (login/register/reset)
│                        └── Consent checkboxes (T&C, Privacy, Conduct) + Firestore audit trail
│                        └── Auto-creates Mindbody client on signup
│                        └── Bidirectional sync: links existing MB clients on login (pulls phone/DOB)
│                        └── Syncs membershipTier to Firestore
├── profile.js ───────── 7-tab member dashboard
│   ├── Onboarding ───── Mandatory phone/DOB overlay (blocks tabs until filled)
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
└── Firestore ────────── users/{uid} profiles + consents/{id} audit trail + course data
```

### Key Design Decisions

- **Staff token auth** — All API calls use staff credentials, which bypasses Mindbody's "Sell Online" filter. This means we can sell ANY pass/contract from our store, even if not marked "Sell Online" in Mindbody admin. Positive for flexibility, but requires careful product curation on our side.
- **Backend validation** — Staff tokens also bypass payment/pass validation, so we must always validate pass-to-program match server-side before booking.
- **Text-first JSON parsing** — `shared/mb-api.js` reads responses as text first, then parses JSON. This prevents cryptic `Unexpected token '<'` errors when Mindbody returns HTML error pages.
- **Dedicated manage function** — Contract management (pause/cancel) uses a separate `mb-contract-manage.js` function to avoid routing ambiguity with the purchase endpoint.
- **Fresh token for management** — `clearTokenCache()` forces a fresh staff token before terminate/suspend/activate operations to avoid stale permission errors.
- **Retention over revoke** — Mindbody's `activatecontract` endpoint doesn't exist (HTML 404 on all paths). Instead, terminated contracts show a retention card with "first month free" reactivation CTA that navigates to the Store for a new contract purchase.
- **My Passes tab** — Membership details moved from Profile tab to dedicated "My Passes" tab for cleaner UX.
- **Consent on signup** — Registration requires accepting Terms & Conditions, Privacy Policy, and Code of Conduct. Consent records stored both on user profile AND in a separate `consents` Firestore collection as a legally defensible audit trail.
- **Mandatory onboarding** — After login/signup, if phone or date of birth is missing, a blocking overlay prevents tab navigation until both are filled. Data pushed to Mindbody automatically.
- **Bidirectional MB sync** — Existing Mindbody clients are auto-linked when they create a Firebase account (409 duplicate → lookup + link). Phone and DOB are pulled from MB into Firestore if available.

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
2. User must check two consent checkboxes: Terms & Conditions + Privacy Policy, and Code of Conduct
3. Firebase creates auth account
4. `ensureUserProfile()` creates Firestore doc at `users/{uid}` with `consents` object
5. `storeConsentAuditTrail()` writes 3 individual records to `consents` collection (one per document)
6. `createMindbodyClient()` calls `mb-client` POST to create MB client
7. If MB returns 409 (duplicate email) → `linkExistingMindbodyClient()` looks up existing client, stores `mindbodyClientId`, pulls phone/DOB from MB
8. On profile page: if phone or DOB missing → mandatory onboarding overlay blocks all tabs until filled
9. Onboarding save pushes phone + DOB to Mindbody via `PUT mb-client`

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

### Membership Management (Updated 2026-02-10)
1. My Passes tab shows active contracts with **info box** directing users to email `info@yogabible.dk`
2. **Pause/Cancel buttons removed** — pending Mindbody API clarification (see `docs/email-mindbody-support.md`)
3. **Status displays remain**: paused badge, terminated badge, billing info, retention card
4. Backend `mb-contract-manage.js` still supports suspend/terminate (can be re-enabled)
5. **Terminate**: POST to `/sale/terminatecontract` — WORKING
6. **Suspend**: POST to `/client/suspendcontract` — WORKING but `SuspendDate` = end date, not start
7. **Resume/Delete pause**: NO API endpoint exists — requires MB admin UI
8. **Revoke termination**: NO API endpoint exists — retention card + new purchase flow instead
9. **Before termination date**: Retention card with perks + "Reactivate — first month free" CTA
10. **After termination date**: Simple "Become a member again" CTA linking to Store memberships

## See Also

- [API Reference & Debug Trail](./api-reference.md) — ALL the lessons learned the hard way
- [Function Catalog](./function-catalog.md) — Every Netlify function with params and returns
- [Profile JS Architecture](./profile-architecture.md) — How the frontend works (tabs, store, membership mgmt)
