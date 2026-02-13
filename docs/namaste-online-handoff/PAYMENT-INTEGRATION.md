# Mindbody Payment Integration — Complete Technical Reference

> **Audience:** Developers implementing payment, checkout, contracts, invoicing, and purchase history via the Mindbody Public API v6.
> **Source:** Battle-tested production code from yogabible.dk (2026).

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Shared API Module (mb-api.js)](#2-shared-api-module)
3. [Checkout / Card Payment](#3-checkout--card-payment)
4. [Service (Pass) Purchases](#4-service-pass-purchases)
5. [Contract (Membership) Purchases](#5-contract-membership-purchases)
6. [Contract Management (Pause / Terminate)](#6-contract-management)
7. [Active Passes & Client Services](#7-active-passes--client-services)
8. [Purchase History & Receipts](#8-purchase-history--receipts)
9. [Invoice Generation](#9-invoice-generation)
10. [Booking with Pass Validation](#10-booking-with-pass-validation)
11. [Field Name Reference (Gotchas)](#11-field-name-reference)
12. [Revenue Categories / Programs](#12-revenue-categories)

---

## 1. Architecture Overview

```
Frontend (profile.js)
  │
  │ fetch('/.netlify/functions/mb-*')
  │
  ├─ mb-services.js ─────── GET purchasable services (class passes, packages)
  ├─ mb-contracts.js ────── GET/POST purchasable contracts (memberships), terminate, suspend
  ├─ mb-checkout.js ─────── POST card payment for services
  ├─ mb-contract-manage.js  POST dedicated pause/terminate management
  ├─ mb-client-services.js  GET client's active passes & contracts
  ├─ mb-purchases.js ────── GET purchase history (3-source merge)
  ├─ mb-book.js ─────────── POST/DELETE booking with server-side pass validation
  └─ mb-return-sale.js ──── POST refund processing
       │
       ▼
  shared/mb-api.js ──── Token management, authenticated fetch, CORS
       │
       ▼
  Mindbody Public API v6 (api.mindbodyonline.com/public/v6)
```

---

## 2. Shared API Module

**File:** `netlify/functions/shared/mb-api.js`

### Token Management
- Staff token issued via `POST /usertoken/issue` with `MB_STAFF_USERNAME` + `MB_STAFF_PASSWORD`
- Cached in memory for 6 hours (tokens last 7 days, but containers restart)
- `clearTokenCache()` forces fresh token — call before contract management operations

### Authenticated Fetch
```javascript
// Usage in any Netlify function:
const { mbFetch, jsonResponse, corsHeaders } = require('./shared/mb-api');

// GET
const data = await mbFetch('/sale/services?SellOnline=true&Limit=200');

// POST
const data = await mbFetch('/class/addclienttoclass', {
  method: 'POST',
  body: JSON.stringify({ ClientId: '100000037', ClassId: 12345 })
});
```

### CRITICAL: Response Parsing
MB sometimes returns HTML instead of JSON (e.g., 404 pages, auth failures). The `mbFetch` function reads the response as TEXT first, then parses:
```javascript
var text = await response.text();
try { var data = JSON.parse(text); }
catch { throw new Error('MB returned non-JSON: ' + text.substring(0, 200)); }
```

### Environment Variables
```
MB_API_KEY=<your-api-key>
MB_SITE_ID=<numeric-site-id>
MB_STAFF_USERNAME=<staff-user-for-api>
MB_STAFF_PASSWORD=<staff-password>
```

---

## 3. Checkout / Card Payment

**File:** `netlify/functions/mb-checkout.js`
**Endpoint:** `POST /.netlify/functions/mb-checkout`

### Request Body
```json
{
  "clientId": "100000037",
  "items": [
    { "id": "service-or-product-id", "type": "Service" }
  ],
  "payment": {
    "cardNumber": "4111111111111111",
    "expMonth": "12",
    "expYear": "2028",
    "cvv": "123",
    "cardHolder": "John Doe",
    "postalCode": "1400",
    "amount": 499
  },
  "test": false
}
```

### What It Calls
```
POST /sale/checkoutshoppingcart
```

### CRITICAL GOTCHA: Metadata Must Be Strings
All values in the `Metadata` field MUST be strings. Numbers or booleans cause silent failures:
```javascript
// WRONG — will fail silently
Metadata: { Amount: 499, Test: false }

// CORRECT
Metadata: { Amount: "499", Test: "false" }
```

### SCA / 3D Secure
If the card requires Strong Customer Authentication, MB returns a challenge URL. The function detects this and returns it for the frontend to handle in an iframe/redirect.

### Response
```json
{
  "success": true,
  "saleId": "12345",
  "sale": { /* full MB sale object */ }
}
```

---

## 4. Service (Pass) Purchases

**File:** `netlify/functions/mb-services.js`
**Endpoint:** `GET /.netlify/functions/mb-services`

### Query Parameters
| Param | Description |
|---|---|
| `type` | `services` (default), `products`, or `categories` |
| `sellOnline` | `true` to filter online-purchasable only |
| `serviceIds` | Comma-separated IDs |
| `serviceCategoryIds` | Filter by MB service category |
| `programIds` | Filter by revenue category (program) — **key for multi-brand** |

### What It Returns
```json
{
  "services": [
    {
      "id": 123,
      "name": "10-Class Pass",
      "price": 1200,
      "onlinePrice": 1100,
      "count": 10,
      "description": "...",
      "programId": 5,
      "programName": "Namaste Online"
    }
  ]
}
```

### Frontend Categorization
Services are categorized by heuristic name matching in `categorizeService()`:
- **trials** — name contains "trial", "prøv", "intro"
- **tourist** — "tourist", "turist", "drop-in"
- **memberships** — "membership", "medlems", "autopay"
- **clips** — "clip", "klip", "punch", "pack", "class"
- **timebased** — has time period + "unlimited" or "non-contract"
- **teacher** — "teacher", "training", "200", "300"
- **courses** — "course", "kursus", "workshop"
- **private** — "private", "1-on-1", "personal"

For multi-brand filtering, use `programIds` query param or filter client-side by `programId`.

---

## 5. Contract (Membership) Purchases

**File:** `netlify/functions/mb-contracts.js`
**Endpoint:** `GET/POST /.netlify/functions/mb-contracts`

### Fetching Available Contracts
```
GET /.netlify/functions/mb-contracts
```
Returns:
```json
{
  "contracts": [
    {
      "id": 456,
      "name": "Unlimited Monthly",
      "firstPaymentAmount": 0,
      "recurringPaymentAmount": 799,
      "totalContractAmount": 0,
      "autopaySchedule": "Monthly",
      "firstMonthFree": true,
      "locationId": 1,
      "agreementTerms": "<html>contract terms text...</html>",
      "description": "...",
      "onlineDescription": "..."
    }
  ]
}
```

### Purchasing a Contract
```
POST /.netlify/functions/mb-contracts
Body: {
  "action": "purchase",
  "clientId": "100000037",
  "contractId": 456,
  "locationId": 1,
  "promoCode": "WELCOME",        // optional
  "startDate": "2026-02-10",     // optional
  "signature": "base64-png-data"  // optional (no handwritten sig needed for online)
}
```

### Calls
```
POST /sale/purchasecontract
```

### Contract Pricing Display
When rendering contracts in the store:
- `recurringPaymentAmount` = what they pay each billing cycle
- `firstPaymentAmount` = initial charge (may differ)
- `totalContractAmount` = total commitment (0 = month-to-month)
- `autopaySchedule` maps to "per month", "per week", etc.

```javascript
// Extract per-class cost from name
var nameClasses = name.match(/(\d+)\s*class/i);
var classCount = nameClasses ? parseInt(nameClasses[1], 10) : 0;
if (classCount > 0 && recurringAmt > 0) {
  perClassCost = Math.round(recurringAmt / classCount);
}
```

---

## 6. Contract Management

**File:** `netlify/functions/mb-contract-manage.js`
**Endpoint:** `POST /.netlify/functions/mb-contract-manage`

### Terminate (Cancel Membership)
```json
{
  "action": "terminate",
  "clientId": "100000037",
  "contractId": 12345
}
```
**Tries 3 endpoint paths in sequence** (one will work):
1. `POST /sale/terminatecontract`
2. `POST /contract/terminatecontract`
3. `POST /client/terminatecontract`

If `TerminationCode` causes errors, retries without it.

### Suspend (Pause Membership) — CONFIRMED WORKING

```json
{
  "action": "suspend",
  "clientId": "100000037",
  "contractId": 12345,
  "startDate": "2026-03-01",
  "endDate": "2026-03-15"
}
```

**Endpoint:** `POST /client/suspendcontract`

**ALL of these fields are REQUIRED:**
```javascript
{
  ClientId: "100000037",
  ClientContractId: 12345,
  SuspendDate: endDate,      // YES — the END date, not start
  ResumeDate: endDate,       // Same as SuspendDate
  Duration: daysDiff,        // Number of days
  DurationUnit: "Day",       // Must be "Day"
  SuspensionType: "Vacation" // "Vacation", "Illness", or "Injury"
}
```

### PAUSE GOTCHAS (hard-won lessons):

| Issue | What Happens |
|---|---|
| Missing `SuspensionType` | Misleading error: "Duration and DurationUnit are required" |
| `SuspensionType: "None"` | **500 server crash** — do NOT use |
| `/sale/suspendcontract` | Returns HTML 404 — endpoint does NOT exist at this path |
| Future-dated pauses | `IsSuspended` stays `false` until the pause actually starts |
| "exceeded maximum iterations" | Contract has hit the max allowed pauses |
| Cancel/resume a pause | **No API endpoint exists.** Requires studio admin action |

### Pause Persistence Strategy
Since MB `IsSuspended` is unreliable for future-dated pauses:
1. **Primary:** Save pause to Firestore `users/{uid}.pausedContracts` map
2. **On load:** Read both MB `IsSuspended` and Firestore pauses
3. **MB confirms** → use MB data, backfill dates from Firestore
4. **MB says not paused, Firestore has pause** → trust Firestore only if saved < 90 seconds ago
5. **Firestore pause expired** → clean it up

```javascript
// Firestore pause structure
users/{uid} → {
  pausedContracts: {
    "pause_12345": {
      contractId: "12345",
      startDate: "2026-03-01",
      endDate: "2026-03-15",
      savedAt: "2026-02-10T12:00:00Z"
    }
  }
}
```

### Resume
```json
{ "action": "resume" }
```
**Returns error** — no MB API endpoint exists. Display "contact studio" message.

---

## 7. Active Passes & Client Services

**File:** `netlify/functions/mb-client-services.js`
**Endpoint:** `GET /.netlify/functions/mb-client-services?clientId=X`

### What It Calls
- `GET /client/clientservices?ClientId=X&Limit=200`
- `GET /client/clientcontracts?ClientId=X`

### Response
```json
{
  "activeServices": [
    {
      "id": "svc-123",
      "name": "10-Class Pass",
      "remaining": 7,
      "current": true,
      "activeDate": "2026-01-01",
      "expirationDate": "2026-04-01",
      "programId": 5,
      "programName": "Namaste Online"
    }
  ],
  "activeContracts": [
    {
      "id": 456,
      "name": "Unlimited Monthly",
      "isActive": true,
      "isAutopay": true,
      "autopayAmount": 799,
      "nextBillingDate": "2026-03-08",
      "endDate": "2026-03-08",
      "isSuspended": false,
      "pauseStartDate": null,
      "pauseEndDate": null,
      "terminationDate": null
    }
  ],
  "hasActivePass": true
}
```

### GOTCHA: Contract Prices
- Top-level `AutopayAmount` fields are often `0`
- Use `UpcomingAutopayEvents[0].ChargeAmount` for the actual recurring price
- `99999` remaining = unlimited in Mindbody

---

## 8. Purchase History & Receipts

**File:** `netlify/functions/mb-purchases.js`
**Endpoint:** `GET /.netlify/functions/mb-purchases?clientId=X&startDate=Y&endDate=Z`

### 3-Source Merge Strategy
MB has no single "purchase history" endpoint. We merge from:

1. **Sales** (`/sale/sales`) — Direct card purchases
2. **Client Services** (`/client/clientservices`) — Active/past passes
3. **Client Contracts** (`/client/clientcontracts`) — Memberships

### CRITICAL: Sales ClientId Filter Is BROKEN
`/sale/sales` **ignores** the `ClientId` parameter. You must:
1. Fetch ALL sales (paginated, 200 per page, max 2000)
2. Filter client-side by BOTH `ClientId` AND `RecipientClientId`
3. Compare as **strings** (RecipientClientId is a number, ClientId is a string)

```javascript
// CORRECT matching
var isMatch = String(sale.ClientId) === String(targetClientId)
           || String(sale.RecipientClientId) === String(targetClientId);
```

### Field Mappings (Correct vs Wrong)
| Data | Correct Field | Wrong Field |
|---|---|---|
| Item price | `item.UnitPrice` | `item.Price` |
| Sale total | `sale.TotalAmount` | `sale.AmountPaid` |
| Tax | `item.TaxAmount` + `Tax1`–`Tax5` | `item.Tax` |
| Discount | `item.DiscountAmount` | — |
| Payment amount | `payment.Amount` | `payment.PaymentAmountPaid` |
| Payment method | `payment.Type` | `payment.PaymentMethodName` |
| Card last 4 | `payment.Last4` | — |
| Transaction ID | `payment.TransactionId` | — |

### ClientServices Has NO Price
Cross-reference with sales by matching description text to enrich with actual amounts.

---

## 9. Invoice Generation

Invoices are generated client-side as HTML, opened in a new window for Print → Save as PDF.

### Key Components
- Company header (name, address, VAT/CVR number)
- Bill-to section (client name + MB ID)
- Invoice meta (invoice number, date, amount due)
- Line items table (description, qty, unit price, VAT%, VAT amount, total)
- Totals section (subtotal, discount, VAT, total)
- Payment adjustment (method, card last 4, amount)
- Paid stamp (if amount due = 0)
- Bank details footer (account number, IBAN, BIC)

### Invoice Number Format
`Aps-{saleId padded to 8 digits}` (e.g., `Aps-00012345`)

---

## 10. Booking with Pass Validation

**File:** `netlify/functions/mb-book.js`

### The Problem
Staff tokens bypass Mindbody's built-in payment validation. A user without a valid pass could book any class.

### The Solution: Server-Side Validation
Before every booking, `mb-book.js`:
1. Fetches the class to get its `Program.Id`
2. Fetches the client's active services
3. Checks if ANY active service covers that program AND has remaining uses
4. If no match → returns `{ error: "no_pass", programId, programName }`
5. Frontend redirects to Store tab filtered to matching passes

### Autopay Billing Gap Handling
Members have recurring contracts that create new services each billing cycle. Between cycles, the service may briefly "expire" even though the membership is active. `mb-book.js` handles this:
1. Initial booking fails with payment error
2. Checks if client has active autopay contract matching the class program
3. If yes → retries with `RequirePayment: false`

### Late Cancellation Handling
If cancellation fails due to "outside cancellation window":
1. Auto-retries with `LateCancel: true`
2. Returns `lateCancel: true` flag for frontend messaging

---

## 11. Field Name Reference

### Sale Object
```
Sale.Id                      → saleId
Sale.SaleDate               → date
Sale.TotalAmount            → total (NOT AmountPaid)
Sale.ClientId               → purchaser account (string)
Sale.RecipientClientId      → actual client (number) — compare as strings!
Sale.Payments[].Amount      → payment amount (NOT PaymentAmountPaid)
Sale.Payments[].Type        → "Visa", "Mastercard", etc. (NOT PaymentMethodName)
Sale.Payments[].Last4       → card last 4 digits
Sale.Items[].UnitPrice      → item price (NOT Price)
Sale.Items[].TotalAmount    → line total
Sale.Items[].TaxAmount      → tax (also check Tax1-Tax5)
Sale.Items[].DiscountAmount → discount applied
```

### Contract Object
```
Contract.Id                              → contract ID
Contract.ContractName                    → display name
Contract.StartDate / EndDate             → active period
Contract.IsAutoRenewing                  → autopay flag
Contract.UpcomingAutopayEvents[0].ChargeAmount  → recurring price (TOP-LEVEL = 0!)
Contract.UpcomingAutopayEvents[0].ChargeDate    → next billing date
Contract.UpcomingAutopayEvents[0].Subtotal      → pre-tax amount
Contract.UpcomingAutopayEvents[0].Tax           → tax amount
Contract.IsSuspended                     → pause flag (LIES for future pauses)
Contract.SuspendDate / ResumeDate        → pause dates (if active)
```

### Service (ClientService) Object
```
Service.Id                → service ID
Service.Name              → display name
Service.Current           → is currently active
Service.Remaining         → uses left (99999 = unlimited)
Service.ActiveDate        → start date
Service.ExpirationDate    → expiry date
Service.Program.Id        → revenue category ID
Service.Program.Name      → revenue category name
// NO PRICE FIELD — cross-reference with /sale/sales
```

---

## 12. Revenue Categories / Programs

In Mindbody, **Programs** = **Revenue Categories**. Every service and class belongs to a Program.

### How to Filter by Brand
For multi-brand setups (e.g., Yoga Bible + Namaste Online sharing one MB site):
- **Services:** Filter by `programId` or `programName`
- **Contracts:** Filter by name pattern or associated program
- **Classes:** Each class has `ClassDescription.Program.Id` and `ClassDescription.Program.Name`

### API Calls
```
GET /sale/services?ProgramIds=5           → services in program 5
GET /site/programs                        → list all programs (revenue categories)
GET /class/classes?ProgramIds=5           → classes in program 5
```

### Fetching Available Programs
```
GET /.netlify/functions/mb-site?type=programs
```
Returns all revenue categories with their IDs and names.
