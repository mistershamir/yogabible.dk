# Debug Notes & Hard-Won Lessons

> Compilation of all debugging findings, gotchas, and decisions made during development.
> Reference this first before investigating issues — the answer may already be here.
> **Last updated: 2026-02-25**

---

## Mindbody API Gotchas

### 1. PascalCase Parameters (Critical)
Mindbody API v6 requires **PascalCase** for ALL request body parameters.
- `clientId` → `ClientId`
- `startDate` → `StartDate`
- `cardNumber` → `CardNumber`
- `firstName` → `FirstName`
- Our Netlify functions handle this mapping internally, but if you ever call the API directly, use PascalCase.

### 2. SuspensionStart vs SuspendDate (Fixed 2026-02-13)
- **Wrong:** `SuspendDate` — MB treated this as the end/resume date, not start
- **Correct:** `SuspensionStart` — the actual start date of the suspension
- Duration + DurationUnit calculate the resume date automatically
- See `docs/email-mindbody-support.md` for the full email trail with MB support

### 3. Contract Management — No Delete/Cancel APIs
- **No API to cancel an existing suspension** — admin UI only
- **No API to revoke a pending termination** — admin UI only
- `activatecontract` endpoint does NOT exist despite what some docs suggest
- Users who want to undo a pause/cancel must contact the studio

### 4. BirthDate Edge Case
- Mindbody returns `0001-01-01T00:00:00` for unset DOB — **filter this out** before storing
- Use `if (birthDate && birthDate.indexOf('0001') !== 0)` to check

### 5. IsSuspended = Currently Active Only
- MB `IsSuspended` is `true` ONLY when the suspension is currently active
- For **future-dated suspensions** (pause starts next week), `IsSuspended` remains `false`
- This is why we need the Firestore pause bridge (90-second grace period)

### 6. Cross-Category Pass Validation
- Use `ClassId` filter on `/client/clientservices` to let MB determine valid passes
- Without ClassId, you get ALL passes — but not all may be valid for the class
- Service Category Relationships in MB admin control which passes work for which class types
- See `docs/namaste-online-handoff/CROSS-CATEGORY-PASS-VALIDATION.md`

### 7. Client Services — Unlimited = 99999/999999
- Mindbody uses absurdly high numbers (99999, 999999) as "unlimited" placeholder
- In UI: `if (count > 9999)` → show "Unlimited" text instead of the number

### 8. StartDateTime vs StartDate
- `GET /class/classes` uses `StartDateTime` (NOT `StartDate`)
- Other endpoints may use `StartDate` — always check the specific endpoint docs

### 9. HTML 404 from Netlify Functions
- During deploy propagation, Netlify may return HTML 404 pages instead of JSON
- Frontend fetches must check `content-type: application/json` before parsing
- Pattern: `r.headers.get('content-type').indexOf('application/json') === -1` → throw

### 10. Token Caching & Stale Permissions
- Staff token is cached for 6 hours in `mb-api.js`
- For sensitive operations (contract manage), call `clearTokenCache()` first
- Stale tokens can cause 401/403 errors on admin-level operations

### 11. Metadata Must Be String
- Mindbody API requires all metadata values to be strings
- Numbers, booleans, etc. must be stringified: `"true"`, `"123"`

### 12. Sale Sources for Receipts (3-Source Merge)
- `/sale/sales` — rich invoice data (line items, tax, payments) but limited to 365 days
- `/client/clientservices` — passes purchased (no price info, needs cross-reference)
- `/client/clientcontracts` — memberships (price from `UpcomingAutopayEvents`)
- All 3 must be fetched and merged for complete receipt history

---

## Frontend Debugging Notes

### Store Catalog vs API Fetch
**Decision (2026-02-12):** Switched from API-fetched store to hardcoded catalog.
**Why:**
- Mindbody's service listing was unreliable (inconsistent `SellOnline` flags)
- Prices varied between what MB returned and what we wanted to show
- Age bracket pricing (under30/over30) couldn't be properly represented in MB
- VAT-exempt under-30 pricing required separate prodIds with custom logic
- Hardcoded catalog gives full control over display, pricing tiers, and categorization

### Coming Soon Categories
- Categories with 0 items show "Coming soon" badge and show a toast on click
- Currently only `private` is coming soon (teacher and courses now active as of 2026-02-14)
- The check is: `!hasItems && (cat.id === 'private')`

### Waiver 3-Tier Status Check
The waiver status is checked in 3 layers with trust hierarchy:
1. **localStorage** (instant, per-browser) — `yb_waiver_signed_{uid}`
2. **Firestore** (cloud, cross-device) — `users/{uid}/documents` collection
3. **Mindbody API** (authoritative) — `GET /.netlify/functions/mb-waiver?clientId=...`

**Rule:** Only upgrade `waiverSigned` flag, never downgrade. If localStorage says signed but MB says not, trust MB but don't un-sign — instead, sync to MB.

### Checkout Signature Validation
- Canvas must have >10 drawn pixels to count as signed
- This prevents accidental acceptance with an empty signature

### Schedule Pass Info Banner Logic
Priority order:
1. Has active services → show pass name + remaining clips
2. Remaining clips < 3 → show orange "low clips" warning
3. Has active contracts → show membership name + renewal date
4. Has ANY active pass → **never** show "buy pass" banner
5. No passes → show "buy pass" banner linking to Store tab

### Course Builder — Bundle prodId Mapping
Courses are sorted alphabetically and joined with `|` to create the bundle key:
- User selects Inversions + Backbends → sorted to `backbends|inversions` → prodId `119`
- User selects all 3 → `backbends|inversions|splits` → prodId `127`
- **If the sort order is wrong, the lookup will fail** — always sort first

### Stored Card Toggle
- If user has a saved card, checkout shows radio toggle: "Use saved card" / "Use new card"
- When "saved card" is selected, card input fields are hidden
- Payment info becomes `{ useStoredCard: true, lastFour: "1234" }`
- Card is saved to both Firestore and local `storedCardData` variable

### Tab Locking
- All tabs except Profile are locked until phone + DOB are filled
- `tabsLocked` flag controls this
- Clicking a locked tab shows a toast message explaining what's needed
- After onboarding complete, `tabsLocked = false` and all tabs become clickable

### Pause Persistence Race Condition
After user pauses a contract:
1. Firestore updated immediately with pause info
2. MB API processes the suspension (may take a moment)
3. On next `loadMembershipDetails()`:
   - If within 90 seconds of save: trust Firestore pause info
   - If after 90 seconds and MB doesn't show suspended: clean up Firestore record
   - This handles the case where MB rejected the suspension or admin cancelled it

---

## Deployment & Build Notes

### Eleventy Build
- `npx @11ty/eleventy` — builds the full site
- Output: `_site/` directory
- ~98 pages, ~1.4 seconds build time
- Journal posts use Eleventy pagination (size: 1)

### Netlify Deploy
- Deploys from `main` branch
- Functions in `netlify/functions/`
- Environment variables needed:
  - `MB_API_KEY` — Mindbody API key
  - `MB_SITE_ID` — Mindbody Site ID (5748831)
  - `MB_USERNAME` — Staff credentials for token
  - `MB_PASSWORD` — Staff credentials for token
  - Firebase config is client-side (not secret)

### Function Cold Starts
- First function call after deploy may take 3-5 seconds (cold start)
- Subsequent calls are fast (~200ms)
- Token caching (6-hour) reduces MB API calls significantly

---

## Common Issues & Solutions

### "Server returned non-JSON" Error
**Cause:** Netlify returned HTML 404 during deploy propagation
**Fix:** Wait 30-60 seconds and retry. Frontend already handles this with content-type check.

### "No valid pass for this class"
**Cause:** User's pass doesn't cover the class's service category
**Fix:** Use ClassId-filtered clientservices check. If pass should cover it, check Service Category Relationships in MB admin.

### Checkout Fails with "Could not set up account"
**Cause:** `clientId` is null — user not synced with Mindbody
**Fix:** The code auto-retries by calling `mb-sync`. If it persists, check Firestore for `mindbodyClientId` field.

### Pause Shows Wrong Dates
**Cause:** Old `SuspendDate` vs new `SuspensionStart` confusion
**Fix:** Backend uses `SuspensionStart` now (fixed 2026-02-13). If dates look wrong, check `mb-contract-manage.js`.

### Store Shows "Coming Soon" for Teacher/Courses
**Fix:** This was removed 2026-02-14. If it reappears, check the `comingSoon` condition in `renderStoreItems()` — should only include `private`.

### Gift Cards Tab Not Showing
**Cause:** Merge conflict may have reverted giftcards tab to courses tab
**Fix:** Check `profile.njk` line ~64 — should have `data-yb-tab="giftcards"`, not `data-yb-tab="courses"`

### Age Bracket Pricing Wrong
**Cause:** User's DOB not set or format issue
**Fix:** Check `userDateOfBirth` global. `getAgeBracket()` returns 'over30' if DOB is missing (safe default).

---

## Architecture Decisions Log

| Date | Decision | Reasoning |
|------|----------|-----------|
| 2026-02-09 | Consent checkboxes on registration | Legal requirement — GDPR audit trail |
| 2026-02-10 | Remove pause/cancel buttons | MB suspend API was broken (SuspendDate bug) |
| 2026-02-10 | 3-source receipt merge | No single MB endpoint gives complete purchase history |
| 2026-02-10 | HTML invoice generation | Browser-native, no PDF library dependency |
| 2026-02-12 | Hardcoded store catalog | Reliability, age-bracket pricing, full control |
| 2026-02-13 | Fix suspend API (SuspensionStart) | MB support confirmed correct parameter |
| 2026-02-14 | Re-enable pause buttons | Suspend API now works correctly |
| 2026-02-14 | Replace Courses tab with Gift Cards | Courses sold via store builder, not a separate tab |
| 2026-02-14 | Add Teacher Training Preparation Phase | Direct purchase of YTT Preparation Phase |
| 2026-02-14 | Add Course Builder | Interactive selection with bundle discounts |
| 2026-02-25 | e-conomic billing panel | Invoicing via e-conomic REST API (create, book, send, PDF) |
| 2026-02-25 | PDF endpoint returns binary | e-conomic `/pdf` endpoint returns raw PDF, not JSON |
| 2026-02-25 | Booking instructions cleanup | Must delete `self`/`metaData` before POST |
| 2026-02-25 | Parallel PDF+invoice fetch | sendInvoiceEmail now fetches both concurrently |

---

## e-conomic REST API Integration

### Architecture

| Component | File | Purpose |
|-----------|------|---------|
| **Server proxy** | `netlify/functions/economic-admin.js` | All e-conomic REST calls, keeps tokens server-side |
| **Admin JS** | `src/js/billing-admin.js` | UI logic, form handling, API calls via `apiCall()` |
| **Admin HTML** | `src/_includes/partials/admin-billing-panel.njk` | Billing tab template |
| **Translations** | `src/_data/i18n/course-admin.json` | All `billing_*` keys |

### API Base & Auth

```
Base: https://restapi.e-conomic.com
Headers:
  X-AppSecretToken:      env.ECONOMIC_APP_SECRET
  X-AgreementGrantToken: env.ECONOMIC_AGREEMENT_TOKEN
  Content-Type:          application/json
```

Tokens live in Netlify env vars only — never exposed to the client. All client calls go through the Netlify function with Firebase admin auth (`requireAuth(event, ['admin'])`).

### Gotcha 1: PDF Endpoint Returns Binary (Critical)

**`GET /invoices/booked/{number}/pdf` returns the actual PDF binary**, not a JSON object with a download URL.

**What went wrong:** The original code routed this through `ecoFetch()` which:
1. Called `res.text()` → garbled binary-as-text
2. Tried `JSON.parse()` → failed
3. Wrapped as `{ raw: garbled-text }`
4. `pdfInfo.download` → `undefined` → threw error

**Fix:** Bypass `ecoFetch` entirely. Use `fetch()` directly and check `Content-Type`:

```javascript
const res = await fetch(BASE + '/invoices/booked/' + num + '/pdf', { headers: ecoHeaders() });
const contentType = (res.headers.get('content-type') || '').toLowerCase();

if (contentType.includes('pdf') || contentType.includes('octet-stream')) {
  // Direct binary — convert to base64
  return Buffer.from(await res.arrayBuffer()).toString('base64');
}

// Fallback: check for %PDF magic bytes (wrong Content-Type header)
const raw = await res.arrayBuffer();
const text = Buffer.from(raw).toString('utf-8');
if (text.startsWith('%PDF')) { /* it's a PDF */ }

// Last resort: try to parse as JSON with download URL
```

**Rule:** Never pass the `/pdf` endpoint through a JSON-parsing helper. Always handle the response directly.

### Gotcha 2: Booking Instructions Have Read-Only Fields

**`GET /invoices/drafts/{number}/templates/booking-instructions`** returns a template to POST to `/invoices/booked`. But the response includes metadata fields that e-conomic rejects on POST.

**Fix:** Clean up before posting (same pattern as `createInvoice`):

```javascript
const instructions = await ecoFetch('/invoices/drafts/' + num + '/templates/booking-instructions');
delete instructions.self;
delete instructions.metaData;
delete instructions.templates;
delete instructions.pdf;
return ecoFetch('/invoices/booked', 'POST', instructions);
```

**Rule:** Always strip `self`, `metaData`, `templates`, `pdf` from any e-conomic template before POSTing it back.

### Gotcha 3: Binary Downloads Must Not Use Content-Type: application/json

**`ecoHeaders()`** includes `Content-Type: application/json`. This is correct for API calls, but **wrong for downloading binary files** (PDFs, images).

**Fix:** Use separate headers for binary downloads:

```javascript
const dlHeaders = {
  'X-AppSecretToken': process.env.ECONOMIC_APP_SECRET,
  'X-AgreementGrantToken': process.env.ECONOMIC_AGREEMENT_TOKEN
  // NO Content-Type — let the browser negotiate
};
```

### Gotcha 4: Netlify Function Timeouts on Multi-Call Chains

Netlify functions have a 10s (free) or 26s (pro) timeout. Operations that chain multiple API calls can hit this:

| Operation | Calls | Est. Time |
|-----------|-------|-----------|
| `createInvoice` | 2 (get template + POST draft) | 4-6s ✓ |
| `bookInvoice` | 2 (get instructions + POST book) | 4-6s ✓ |
| `getInvoicePdf` | 1-2 (fetch endpoint + maybe download) | 3-5s ✓ |
| `sendInvoice` | 3+ (invoice + PDF + email) | 8-15s ⚠ |

**Fix for sendInvoice:** Fetch invoice details and PDF in parallel:

```javascript
const [invoice, pdfData] = await Promise.all([
  ecoFetch('/invoices/booked/' + num),
  getInvoicePdf(num)
]);
```

This saves 3-5 seconds vs sequential fetching.

### Gotcha 5: Client Must Handle Non-JSON Error Responses

When a Netlify function times out, Netlify returns a **502 HTML page**, not JSON. The original `apiCall()` used `res.json()` which threw a JSON parse error, hiding the real timeout cause.

**Fix:** Use `res.text()` + `JSON.parse()` in a try/catch:

```javascript
return res.text().then(function (text) {
  try { return JSON.parse(text); }
  catch (e) {
    return { ok: false, error: 'Server timed out (' + res.status + ')' };
  }
});
```

### Invoice Creation Flow (Working Reference)

```
1. GET /customers/{num}/templates/invoice     → Get customer's default template
2. Merge: date, dueDate, lines[], paymentTerms, layout, product, notes
3. DELETE template-only fields: self, templates, pdf
4. POST /invoices/drafts                      → Creates draft → draftInvoiceNumber
```

### Invoice Booking Flow (Working Reference)

```
1. GET /invoices/drafts/{num}/templates/booking-instructions
2. DELETE metadata fields: self, metaData, templates, pdf
3. POST /invoices/booked                      → Books draft → bookedInvoiceNumber
```

### Invoice PDF Flow (Working Reference)

```
1. fetch(BASE + '/invoices/booked/{num}/pdf', { headers: ecoHeaders() })
2. Check Content-Type:
   - application/pdf → direct binary, convert to base64
   - other → check %PDF magic bytes → try JSON with download URL
3. Return { base64, filename, size }
```

### Invoice Email Flow (Working Reference)

```
1. Promise.all: fetch invoice details + getInvoicePdf (parallel)
2. Build branded HTML email (Danish, with invoice summary table)
3. Attach PDF via nodemailer (sendRawEmail)
4. Return { sent, messageId, invoiceNumber }
```

### e-conomic REST API Quick Reference

| Endpoint | Method | Returns |
|----------|--------|---------|
| `/customers?filter=name$like:X` | GET | Customer search results |
| `/customers` | POST | Created customer |
| `/customers/{num}/templates/invoice` | GET | Invoice template (JSON) |
| `/invoices/drafts` | POST | Created draft (JSON) |
| `/invoices/drafts?sort=-draftInvoiceNumber` | GET | Draft list (JSON) |
| `/invoices/drafts/{num}` | GET | Draft detail (JSON) |
| `/invoices/drafts/{num}/templates/booking-instructions` | GET | Booking template (JSON) |
| `/invoices/booked` | POST | Booked invoice (JSON) |
| `/invoices/booked?sort=-bookedInvoiceNumber` | GET | Booked list (JSON) |
| `/invoices/booked/{num}` | GET | Booked detail (JSON) |
| `/invoices/booked/{num}/pdf` | GET | **PDF binary** (NOT JSON!) |
| `/payment-terms` | GET | Payment terms list |
| `/layouts` | GET | Invoice layout list |
| `/customer-groups` | GET | Customer group list |
| `/vat-zones` | GET | VAT zone list |
| `/products` | GET | Product list |
