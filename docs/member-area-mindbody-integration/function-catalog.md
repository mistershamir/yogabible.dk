# Netlify Functions — Mindbody Integration Catalog

> All functions live in `netlify/functions/` and share `netlify/functions/shared/mb-api.js`
> **Last updated: 2026-02-10** — reflects invoice/receipt rewrite with correct MB field mappings, cross-reference enrichment, and 3-source merge strategy.

## Shared Module

### shared/mb-api.js
- **`mbFetch(path, options?)`** — Authenticated API call with staff token. Parses response as text first, then JSON (handles HTML 404 gracefully). Logs full URL for every request.
- **`jsonResponse(status, body)`** — CORS-enabled JSON response helper
- **`corsHeaders`** — Standard CORS headers (`GET, POST, PUT, DELETE, OPTIONS`)
- **`getStaffToken()`** — Token acquisition + 6-hour in-memory caching
- **`clearTokenCache()`** — Resets `cachedToken` and `tokenExpiry` to force fresh token on next call. Called before contract management operations (terminate/suspend/activate) to avoid stale permission errors.
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
- **POST Body:** `{ firstName, lastName, email, phone?, birthDate? }`
- **PUT Body:** `{ clientId, firstName?, lastName?, email?, phone?, birthDate? }`
- **MB Endpoints:**
  - `GET /client/clients?searchText=X&limit=10`
  - `POST /client/addclient` (returns 400 for duplicates → mapped to 409)
  - `POST /client/updateclient` with `CrossRegionalUpdate: true`
- **GET client fields:** `id`, `firstName`, `lastName`, `email`, `phone`, `birthDate`, `status`, `active`, `membershipName`
- **PUT client fields:** `id`, `firstName`, `lastName`, `email`, `phone`, `birthDate`
- **Returns:** GET: `{ found, client }` | POST: `{ success, client }` | PUT: `{ success, client }`
- **BirthDate:** Mapped to Mindbody's `BirthDate` field (PascalCase). Returns ISO date from GET, accepts YYYY-MM-DD for POST/PUT. Mindbody returns `0001-01-01T00:00:00` for unset — filter this out client-side.
- **Duplicate handling:** POST returns 409 when email exists. Frontend `createMindbodyClient()` catches this and calls `linkExistingMindbodyClient()` to auto-link.

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
- **Enriched contract fields:** `id` (instance), `contractId` (template ID for store matching), `locationId`, `isAutopay`, `autopayStatus`, `nextBillingDate`, `autopayAmount`, `isSuspended`, `terminationDate`, `agreementDate`
- **Calculates** `nextBillingDate` from `UpcomingAutopayEvents` array
- **Note:** `contractId` (template ID) is different from `id` (instance ID). The template ID matches store items for reactivation CTA. Instance ID is used for terminate/suspend operations

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
- **Returns per service:** `id`, `name`, `price`, `onlinePrice`, `count`, `description`, `programId`, `programName`
- **Returns per product:** `id`, `name`, `price`, `onlinePrice`, `description` (ShortDescription || LongDescription), `categoryId`, `subCategoryId`
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
  - `POST /sale/terminatecontract` (primary — also tries `/contract/`, `/client/` as fallback)
  - `POST /client/suspendcontract` (ONLY working path — `/sale/` returns HTML 404)
  - `POST /sale/activatecontract` — **DOES NOT EXIST** (all 3 paths return HTML 404)
- **Actions:** `terminate`, `suspend` (via `body.action`). `activate` kept in code but non-functional
- **Token:** Forces fresh token (clears cache) for all management actions
- **Diagnostics:** Returns `_pathResults` array showing which paths were tried and what each returned
- **Returns:** GET: `{ contracts[], total }` | POST: `{ success, endpointUsed?, _pathResults, ... }`
- **Each contract:** `id`, `name`, `description`, `onlineDescription`, `firstPaymentAmount`, `firstMonthFree` (boolean, true when first payment is 0), `recurringPaymentAmount`, `totalContractAmount`, `autopaySchedule` (extracted FrequencyType string), `numberOfAutopays`, `duration`, `durationUnit`, `locationId`, `soldOnline`, `assignsMembershipId`, `assignsMembershipName`, `contractItems[]`, `programIds[]`, `membershipTypeRestrictions[]`
- **POST Note:** `LocationId` is REQUIRED for purchase — defaults to 1 if not provided

### mb-contract-manage.js (Updated 2026-02-10)
- **Method:** POST
- **Purpose:** Dedicated contract management: terminate, suspend (pause), or resume
- **UI Status:** Pause/Cancel buttons removed from user profile (2026-02-10) — backend still functional, can be re-enabled
- **Body (terminate):** `{ action: 'terminate', clientId, clientContractId, terminationDate, terminationCode? }`
- **Body (suspend):** `{ action: 'suspend', clientId, clientContractId, startDate, endDate }`
- **Body (resume):** `{ action: 'resume', ... }` → Returns error: no MB API endpoint exists
- **API Paths:**
  - Terminate: tries `/sale/`, `/contract/`, `/client/` (fallback order — `/sale/` is correct)
  - Suspend: `POST /client/suspendcontract` only (the ONLY working path)
- **Suspend body sent to MB:** `{ ClientId, ClientContractId, SuspendDate: endDate, ResumeDate: endDate, Duration, DurationUnit: "Day", SuspensionType: "Vacation" }`
- **IMPORTANT:** `SuspendDate` = end date ("suspend through"), NOT start date. MB starts suspension from today.
- **Suspension validation:** 14 days minimum, 93 days maximum
- **Duplicate detection:** Uses MB `IsSuspended` field (not notes). MB returns "exceeded maximum iterations" if at max pauses
- **Fallback:** If terminate fails with TerminationCode, retries without it
- **Returns:** `{ success, action, suspendDate, resumeDate, durationDays, mbResponse }`

### mb-purchases.js (Updated 2026-02-10)
- **Method:** GET
- **Purpose:** Fetch client purchase/receipt history with full invoice data
- **Params:** `clientId`, `startDate?` (default 730 days), `endDate?`
- **Strategy:** Fetches ALL 3 data sources in parallel, merges, deduplicates:
  1. `GET /sale/sales` — rich data (line items, payments, tax, discounts). Uses narrower 365-day window to avoid pagination limits. Matches by BOTH `ClientId` AND `RecipientClientId` (MB uses them inconsistently)
  2. `GET /client/clientservices?ClientId=X` — purchased passes. Has NO price field — enriched by cross-referencing with sales data by description match
  3. `GET /client/clientcontracts?ClientId=X` — memberships. Price extracted from `UpcomingAutopayEvents[0].ChargeAmount` (NOT top-level fields which are 0)
- **Cross-reference:** `enrichServicesWithSaleData()` matches services with sales by description to copy price/payment data
- **Deduplication:** Sales added first (rich data), then services/contracts only if no matching sale exists (by description + date)
- **Correct MB field mapping:**
  - Sale items: `UnitPrice`, `TotalAmount`, `TaxAmount` (+ Tax1-Tax5 fallback), `DiscountAmount`, `DiscountPercent`, `Quantity`
  - Sale payments: `Amount`, `Type`, `Last4`, `TransactionId`
  - Contract prices: `UpcomingAutopayEvents[0].ChargeAmount` / `.Subtotal` / `.Tax` / `.PaymentMethod`
- **Returns:** `{ purchases[], total }` — each purchase has `items[]`, `payments[]`, `subtotal`, `tax`, `discount`, `totalPaid`, `source` ('sale'|'clientservice'|'clientcontract')

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
