# Netlify Functions — Mindbody Integration Catalog

> All functions live in `netlify/functions/` and share `netlify/functions/shared/mb-api.js`
> **Last updated: 2026-02-08** — reflects final working state after all debugging.

## Shared Module

### shared/mb-api.js
- **`mbFetch(path, options?)`** — Authenticated API call with staff token. Parses response as text first, then JSON (handles HTML 404 gracefully). Logs full URL for every request.
- **`jsonResponse(status, body)`** — CORS-enabled JSON response helper
- **`corsHeaders`** — Standard CORS headers (`GET, POST, PUT, DELETE, OPTIONS`)
- **`getStaffToken()`** — Token acquisition + 6-hour in-memory caching
- **`getBaseHeaders()`** — API key + SiteId headers
- **`MB_BASE`** — `https://api.mindbodyonline.com/public/v6`

## Core Functions

### mb-classes.js
- **Method:** GET
- **Purpose:** Fetch class schedule from Mindbody
- **Params:** `startDate`, `endDate`, `clientId` (optional, for booking status)
- **MB Endpoint:** `GET /class/classes` with `StartDateTime`, `EndDateTime`
- **Returns:** `{ classes[], startDate, endDate, total }`
- **Each class:** `id`, `name`, `description` (HTML), `startDateTime`, `endDateTime`, `instructor`, `instructorId`, `instructorBio`, `instructorImageUrl`, `spotsLeft`, `isBooked`, `isCanceled`, `programId`, `programName`
- **Note:** Uses `StartDateTime` NOT `StartDate` (different from other endpoints)

### mb-book.js
- **Method:** POST (book) / DELETE (cancel)
- **Purpose:** Book or cancel a class for a client
- **POST Body:** `{ clientId, classId, test? }`
- **DELETE Body:** `{ clientId, classId, lateCancel? }`
- **MB Endpoints:**
  - `GET /class/classes?ClassIds=X` — fetch class program
  - `GET /client/clientservices?ClientId=X` — fetch passes (parallel)
  - `GET /client/clientcontracts?ClientId=X` — fetch memberships (parallel)
  - `POST /class/addclienttoclass` — book
  - `POST /class/removeclientfromclass` — cancel
- **Retry Logic:**
  - Pass validation: `validateClientPass()` checks program match, fails open on error
  - "Already booked" detection: keywords "already", "enrolled", "signed up" → success
  - Payment error + autopay → retry with `RequirePayment: false`
  - Cancel window error → retry with `LateCancel: true`
- **Returns:** `{ success, visit?, alreadyBooked?, lateCancel?, error? }`
- **Error:** `{ error: 'no_pass' }` with 403 status when no valid pass

### mb-client.js
- **Method:** GET (find) / POST (create) / PUT (update)
- **Purpose:** Find, create, or update a Mindbody client
- **GET Params:** `email` — searches by email, filters to exact match client-side
- **POST Body:** `{ firstName, lastName, email, phone? }`
- **PUT Body:** `{ clientId, firstName?, lastName?, email?, phone? }`
- **MB Endpoints:**
  - `GET /client/clients?searchText=X&limit=10`
  - `POST /client/addclient` (returns 400 for duplicates → mapped to 409)
  - `POST /client/updateclient` with `CrossRegionalUpdate: true`
- **Returns:** GET: `{ found, client }` | POST/PUT: `{ success, client }`

### mb-sync.js
- **Method:** POST
- **Purpose:** Sync Firebase user with Mindbody (find client, determine membership tier)
- **Body:** `{ email, firebaseUid? }`
- **MB Endpoints:**
  - `GET /client/clients?searchText=X` — find by email
  - `GET /client/clientcontracts?clientId=X` — check memberships (optional, graceful fallback)
  - `GET /client/clientservices?clientId=X` — check passes (optional, graceful fallback)
- **Tier Logic:** Active autopay contract → `'member'`, active service → `'member'`, otherwise → `'free'`
- **Returns:** `{ found, mindbodyClientId, membershipTier, activeMemberships[], clientName }`

### mb-client-services.js
- **Method:** GET
- **Purpose:** Fetch client's active passes, services, and contracts with billing data
- **Params:** `clientId`
- **MB Endpoints:** Parallel fetch with graceful fallback:
  - `GET /client/clientservices?ClientId=X&Limit=200`
  - `GET /client/clientcontracts?ClientId=X`
- **Service "current" logic:** `Current` flag OR (activeDate ≤ now AND expirationDate ≥ now)
- **Contract billing:** Extracts `nextBillingDate` from `UpcomingAutopayEvents` (sorted, first future event)
- **Returns:** `{ services[], contracts[], activeServices[], activeContracts[], hasActivePass }`
- **Enriched contract fields:** `isAutopay`, `autopayStatus`, `nextBillingDate`, `autopayAmount`, `isSuspended`, `terminationDate`, `agreementDate`
- **Calculates** `nextBillingDate` from `UpcomingAutopayEvents` array

### mb-visits.js
- **Method:** GET
- **Purpose:** Fetch client visit history (past + 30 days future)
- **Params:** `clientId`, `startDate?` (default 90 days ago), `endDate?` (default 30 days future)
- **MB Endpoint:** `GET /client/clientvisits?ClientId=X&StartDate=X&EndDate=X&Limit=200`
- **Returns:** `{ visits[], total }` — each visit has `isFuture` flag
- **Note:** 30-day future window captures upcoming bookings

### mb-staff.js
- **Method:** GET
- **Purpose:** Fetch teacher/staff details (bio, photo)
- **Params:** `staffId?` (if omitted, returns all)
- **MB Endpoint:** `GET /staff/staff?Limit=200&StaffIds=X`
- **Returns:** `{ staff[], total }` — each has `bio`, `imageUrl`

## Store & Payment Functions

### mb-services.js
- **Method:** GET
- **Purpose:** Fetch purchasable services, products, or categories
- **Params:** `type=services|products|categories`, `serviceIds?` (comma-separated), `sellOnline?`, `programIds?`, `serviceCategoryIds?`
- **MB Endpoints:**
  - `GET /sale/services?Limit=200` with repeated `ServiceIds=X&ServiceIds=Y`
  - `GET /sale/products?Limit=200`
  - `GET /sale/servicecategories`
- **Note:** Multiple ServiceIds use repeated params, NOT comma-separated

### mb-checkout.js
- **Method:** POST
- **Purpose:** Purchase a service/product with credit card
- **Body:** `{ clientId, items[], payment: { cardNumber, expMonth, expYear, cvv, cardHolder, ... }, test? }`
- **MB Endpoint:** `POST /sale/checkoutshoppingcart`
- **Critical:** ALL Metadata values must be strings. Card data passed through, never stored.
- **SCA Handling:** If response has `AuthenticationUrls`, returns 202 with redirect URL
- **Returns:** `{ success, transactionId }` or `{ requiresSCA, authenticationUrl }`

### mb-contracts.js
- **Method:** GET (list) / POST (purchase OR manage)
- **Purpose:** Fetch contracts, purchase them, OR terminate/suspend memberships
- **GET Params:** `contractId?`, `locationId?`, `sellOnline?`, `limit?`
- **GET Retry:** If 400 error, retries with `LocationId=1`
- **POST Body (purchase):** `{ clientId, contractId, startDate?, payment?, promoCode?, locationId?, test? }`
- **POST Body (manage):** `{ action: 'terminate'|'suspend', clientId, clientContractId, terminationDate?, startDate?, endDate? }`
- **MB Endpoints:**
  - `GET /sale/contracts` (with LocationId=1 retry)
  - `POST /sale/purchasecontract` (with CreditCardInfo in PascalCase)
  - `POST /{category}/terminatecontract` (tries `/contract/`, `/sale/`, `/client/`)
  - `POST /{category}/suspendcontract` (tries `/contract/`, `/sale/`, `/client/`)
- **Returns:** GET: `{ contracts[], total }` | POST: `{ success, endpointUsed?, clientContractId?, ... }`
- **Each contract:** `id`, `name`, `description`, `price`, `recurringPaymentAmount`, `autopaySchedule` (object with `FrequencyType`), `locationId`, `durationMonths`, `autopay`, `onlineDescription`
- **POST Note:** `LocationId` is REQUIRED for purchase — defaults to 1 if not provided

### mb-contract-manage.js
- **Method:** POST
- **Purpose:** Standalone terminate/suspend function (avoids routing ambiguity with mb-contracts purchase endpoint)
- **Body (terminate):** `{ action: 'terminate', clientId, clientContractId, terminationDate, terminationCode? }`
- **Body (suspend):** `{ action: 'suspend', clientId, clientContractId, startDate, endDate }`
- **API Path:** Uses `/contract/terminatecontract` and `/contract/suspendcontract` (with fallback to `/sale/`, `/client/`)
- **Suspension validation:** 14 days minimum, 93 days maximum
- **Fallback:** If terminate fails with TerminationCode, retries without it
- **Returns:** `{ success, action, terminationDate|suspendDate, message }`

### mb-purchases.js
- **Method:** GET
- **Purpose:** Fetch client purchase/receipt history
- **Params:** `clientId`, `startDate?`, `endDate?`
- **MB Endpoints:** (with graceful fallback)
  - `GET /client/clientservices?ClientId=X` — purchased passes
  - `GET /client/clientcontracts?ClientId=X` — purchased memberships
- **Note:** `/sale/sales` was removed — it ignores ClientId filter and floods results
- **Returns:** `{ purchases[], total }` — includes type, amount, paymentMethod, remaining, etc.

### mb-return-sale.js
- **Method:** POST
- **Purpose:** Process a sale return/refund
- **Body:** `{ saleId, test? }`
- **MB Endpoint:** `POST /sale/returnsale`
- **SECURITY:** Admin-level operation. No frontend auth checks. Add authorization in production.

## Site Configuration Functions

### mb-site.js
- **Method:** GET
- **Purpose:** Fetch site configuration data
- **Params:** `type=sessionTypes|programs|locations|memberships|promoCodes`
- **MB Endpoints:** `/site/sessiontypes`, `/site/programs`, `/site/locations`, `/site/memberships`, `/site/promocodes`

### mb-class-descriptions.js
- **Method:** GET
- **Purpose:** Fetch class type library (descriptions, programs, images)
- **Params:** `classDescriptionId?`, `programId?`, `startDate?`, `endDate?`, `limit?`
- **MB Endpoint:** `GET /class/classdescriptions`

### mb-waitlist.js
- **Method:** GET (list) / POST (add) / DELETE (remove)
- **Purpose:** Manage class waitlists
- **GET Params:** `classScheduleId?`, `clientId?`, `classDescriptionId?`
- **POST Body:** `{ clientId, classScheduleId }`
- **DELETE Body:** `{ waitlistEntryId }`
- **Note:** DELETE method sends to Mindbody POST endpoint with array wrapper: `{ WaitlistEntryIds: [id] }`

## Cross-Function Patterns

### Pattern 1: Graceful Fallback
If optional endpoint fails → return empty array, continue. Used in `mb-sync`, `mb-client-services`, `mb-purchases`.

### Pattern 2: Retry on Specific Errors
- Autopay booking retry: payment error → `RequirePayment: false`
- Late cancel retry: window error → `LateCancel: true`
- Location retry: 400 → add `LocationId=1`
- Termination code retry: code error → remove `TerminationCode`
- Endpoint path retry: 404/405/HTML → try next category path

### Pattern 3: Parallel Requests
`Promise.all()` with per-promise `.catch()` fallbacks. Both requests attempted regardless of failures.

### Pattern 4: PascalCase → camelCase Transform
All functions transform MB PascalCase responses to camelCase for frontend. Request bodies transform camelCase inputs to PascalCase for MB.

### Pattern 5: API Inspection Logging
Key functions log raw field names and sample data (truncated to 500 chars) for debugging schema changes without code modification.

### Pattern 6: Non-JSON Response Detection
`shared/mb-api.js` reads response as text first, then parses JSON. This prevents `Unexpected token '<'` errors when Mindbody returns HTML error pages. On non-JSON response, throws descriptive error with first 200 chars of raw response. On API error, includes `error.status` and `error.data` for downstream handling.
