# Mindbody API v6 — Integration Reference & Debug Trail

> This is the living reference document. Update it every time you debug a new issue.
> Copy this to every new brand project. **Last updated: 2026-02-09.**

## Credentials & Auth

- Base URL: `https://api.mindbodyonline.com/public/v6`
- Headers: `Api-Key`, `SiteId`, `Authorization` (staff token)
- Staff token: POST `/usertoken/issue` with `Username`, `Password`
- Token lasts 7 days, cache for 6 hours in function memory
- Token is reused across warm Netlify function containers

## CRITICAL RULES (read first!)

1. **ALL query params are PascalCase** — `ClientId`, `StartDateTime`, `Limit` etc. camelCase silently returns empty results.
2. **Checkout Metadata values are ALL strings** — `Dict<string,string>`. Numbers like `amount: 10` will fail. Use `amount: "10"`.
3. **Cart field is `Items`** — NOT `CartItems`. Mindbody error: "Items is a required parameter"
4. **`IsAvailable` flag on classes is UNRELIABLE** — always show Book button, let backend validate
5. **`Clients[]` array on classes is UNRELIABLE** — cross-reference with `/client/clientvisits` to detect bookings
6. **Staff token bypasses payment AND pass validation** — you MUST manually check client services match the class program before booking
7. **`/sale/sales` uses `StartSaleDateTime`/`EndSaleDateTime`** — NOT `StartDate`/`EndDate` like other endpoints
8. **ServiceIds use repeated params** — `ServiceIds=100&ServiceIds=200` NOT `ServiceIds=100,200`
9. **Staff Bio/ImageUrl not in classes endpoint** — must fetch from `/staff/staff` separately and cache
10. **`/sale/contracts` may not support `sellOnline` filter** — fetch all, filter client-side
11. **`/sale/contracts` may require `LocationId`** — if first call returns 400, retry with `LocationId=1`
12. **Contract `autopaySchedule` can be object or string** — extract `FrequencyType` if it's an object, otherwise use as-is
13. **Netlify Functions don't reliably route PUT requests** — PUT returns HTML 404. Use POST with an `action` field instead
14. **Mindbody may return HTML 404 for wrong endpoint paths** — `res.json()` will crash with "Unexpected token '<'". Always parse as text first, then try JSON
15. **TerminateContract/SuspendContract endpoint path is ambiguous** — docs are unclear on category. Try `/contract/`, `/sale/`, `/client/` with fallback. Response includes `endpointUsed` to identify correct path
16. **`ReferredBy` is read-only in public API v6** — must set referrals in Mindbody admin panel
17. **`/sale/sales` silently ignores ClientId filter** — may return ALL studio sales or empty. Use `/client/clientservices` + `/client/clientcontracts` as receipt data source
18. **Mindbody clips with 99999/999999 remaining = unlimited** — hide these counts in UI
19. **Contract `ClientContractId` vs `ContractId`** — `ContractId` is the template, `ClientContractId` is the specific client's instance. Terminate/suspend need `ClientContractId`
20. **`BirthDate` returns `0001-01-01T00:00:00` for unset** — Mindbody's placeholder. Filter this out before storing in Firestore. Extract `YYYY-MM-DD` from ISO string.
21. **`addclient` returns 400 for duplicate email** — Not 409. Map to 409 in our function, then look up the existing client to link accounts.
22. **BirthDate format is always ISO `YYYY-MM-DD`** — `<input type="date">` returns ISO regardless of locale display. Mindbody returns ISO datetime, we strip the time part. Danish users see dd/mm/yyyy in their browser, US sees mm/dd/yyyy, but the actual value is always `YYYY-MM-DD`. If a DOB looks wrong in Mindbody admin, it's a display issue on MB's side, not a data issue.

## Endpoint Reference

### Class Endpoints

| Endpoint | Method | Params | Response Key | Notes |
|----------|--------|--------|-------------|-------|
| `/class/classes` | GET | `StartDateTime`, `EndDateTime`, `Limit`, `ClientId`, `ClassIds` | `Classes[]` | Schedule data. Use `StartDateTime` NOT `StartDate` |
| `/class/classdescriptions` | GET | `ClassDescriptionId`, `ProgramIds`, `StartClassDateTime`, `EndClassDateTime`, `Limit` | `ClassDescriptions[]` | Class type library |
| `/class/addclienttoclass` | POST | Body: `ClientId`, `ClassId`, `Test`, `SendEmail`, `RequirePayment` | `Visit` | Book a class. `RequirePayment: false` for autopay members |
| `/class/removeclientfromclass` | POST | Body: `ClientId`, `ClassId`, `LateCancel`, `SendEmail` | — | Cancel booking |
| `/class/waitlistentries` | GET | `ClassScheduleIds`, `ClientIds`, `ClassDescriptionIds`, `Limit` | `WaitlistEntries[]` | Waitlist data |
| `/class/addclienttowaitlist` | POST | Body: `ClientId`, `ClassScheduleId` | `WaitlistEntry` | Join waitlist |
| `/class/removeclientfromwaitlist` | POST | Body: `WaitlistEntryIds[]` | — | Leave waitlist. Note: uses POST, not DELETE |

### Client Endpoints

| Endpoint | Method | Params | Response Key | Notes |
|----------|--------|--------|-------------|-------|
| `/client/clients` | GET | `SearchText`, `Limit` | `Clients[]` | Search clients. Filter to exact email match client-side (case-insensitive) |
| `/client/addclient` | POST | Body: `FirstName`, `LastName`, `Email`, `SendAccountEmails`, `MobilePhone`, `BirthDate` | `Client` | Create client. Returns 400 for duplicates → mapped to 409 |
| `/client/updateclient` | POST | Body: `Client: {ClientId, FirstName, LastName, Email, MobilePhone, BirthDate, ...}`, `CrossRegionalUpdate` | `Client` | Update client. Note: POST not PUT. Supports `BirthDate` (ISO format) |
| `/client/clientservices` | GET | `ClientId`, `Limit`, `CrossRegionalLookup` | `ClientServices[]` | Active passes. Check `Current` flag + date range |
| `/client/clientcontracts` | GET | `ClientId` | `Contracts[]` | Memberships. Has `UpcomingAutopayEvents` for billing dates |
| `/client/clientvisits` | GET | `ClientId`, `StartDate`, `EndDate`, `Limit` | `Visits[]` | Visit history. Include 30 days future for upcoming bookings |

### Sale Endpoints

| Endpoint | Method | Params | Response Key | Notes |
|----------|--------|--------|-------------|-------|
| `/sale/services` | GET | `ServiceIds` (repeated), `SellOnline`, `ProgramIds`, `Limit` | `Services[]` | Purchasable services |
| `/sale/servicecategories` | GET | — | `ServiceCategories[]` | Service categories |
| `/sale/contracts` | GET | `ContractIds`, `LocationId`, `Limit` | `Contracts[]` | Available memberships. Retry with `LocationId=1` on 400 |
| `/sale/checkoutshoppingcart` | POST | Body: `ClientId`, `Items[]`, `Payments[]`, `Test`, `SendEmail`, `InStore` | `ShoppingCart` | Purchase services. May return `AuthenticationUrls` for SCA |
| `/sale/purchasecontract` | POST | Body: `ClientId`, `ContractId`, `LocationId`, `StartDate`, `CreditCardInfo`, `PromotionCode` | `ClientContractId` | Buy membership |
| `/sale/returnsale` | POST | Body: `Id`, `Test` | `Sale` | Refund. Admin-level — needs auth guard |

### Contract Management Endpoints (RESOLVED)

| Endpoint | Method | Body | Notes |
|----------|--------|------|-------|
| `/sale/terminatecontract` | POST | `ClientId`, `ClientContractId`, `TerminationDate`, `SendNotifications` | **CONFIRMED WORKING.** `/contract/` returns permission error. `/client/` returns HTML 404 |
| `/client/suspendcontract` | POST | `ClientId`, `ClientContractId`, `SuspendDate`, `Duration`, `DurationUnit`, `SuspensionType` | **CONFIRMED WORKING (2026-02-09).** See details below |
| `/sale/activatecontract` | POST | `ClientId`, `ClientContractId` | **DOES NOT EXIST** — all 3 paths return HTML 404. Revoke cancellation is not possible via API |
| `resumecontract` / `removecontractsuspension` | POST | — | **NOT FOUND** — tried all 3 path categories, none exist. Cancel pause early requires studio admin |

### Suspend Contract — CONFIRMED WORKING FORMAT

**Endpoint:** `POST /client/suspendcontract` (NOT `/sale/` — returns 404)

**Request body:**
```json
{
  "ClientId": "100000037",
  "ClientContractId": 12345,
  "SuspendDate": "2026-03-09",
  "Duration": 14,
  "DurationUnit": "Day",
  "SuspensionType": "Vacation"
}
```

**Key findings (2026-02-09):**
- `/sale/suspendcontract` → **HTML 404** (does not exist)
- `/contract/suspendcontract` → **HTML 404** (does not exist)
- `/client/suspendcontract` → **ONLY working path** (returns JSON)
- `SuspensionType` is **REQUIRED**. Valid values: `"Vacation"`, `"Illness"`, `"Injury"` (configured in MB admin: Settings > Contract Options > Suspension Types)
- Without `SuspensionType`, error = `"Duration and DurationUnit are required."` with code `InvalidParameter`
- With `SuspensionType: "None"`, error = **500 server crash** (invalid value)
- `DurationUnit` accepts both `"Day"` and `"Days"` when `SuspensionType` is valid
- `Duration` accepts both number and string when `SuspensionType` is valid
- Duplicate suspension check: use `IsSuspended` field from `GET /client/clientcontracts`

### Site & Staff Endpoints

| Endpoint | Method | Params | Response Key | Notes |
|----------|--------|--------|-------------|-------|
| `/site/sessiontypes` | GET | `Limit` | `SessionTypes[]` | Class type config |
| `/site/programs` | GET | `Limit` | `Programs[]` | Program categories |
| `/site/locations` | GET | — | `Locations[]` | Studio locations |
| `/site/memberships` | GET | `Limit` | `Memberships[]` | Membership types |
| `/site/promocodes` | GET | `Limit` | `PromoCodes[]` | Promo codes |
### Staff & Auth Endpoints

| Endpoint | Method | Params | Response Key | Notes |
|----------|--------|--------|-------------|-------|
| `/staff/staff` | GET | `StaffIds`, `Limit` | `StaffMembers[]` | Teacher details + bio + photo |
| `/usertoken/issue` | POST | Body: `Username`, `Password` | `AccessToken` | Auth token. Cache 6 hours |

**Note on Contract Management:** The preferred endpoint category is **`/sale/`** (i.e., `/sale/terminatecontract` and `/sale/suspendcontract`). Despite the docs being ambiguous, `/contract/` has a **different permission model** and returns "User does not have permission" even when the same staff token works on `/sale/`. `/client/` doesn't exist for these endpoints (returns HTML 404). Code tries all 3 paths with fallback but `/sale/` should always be first. `activatecontract` (revoke termination) **does not exist** in the API — all paths return 404.

## Checkout Payment Format (WORKING)

```json
{
  "ClientId": "12345",
  "Items": [{
    "Item": { "Type": "Service", "Metadata": { "Id": 100203 } },
    "Quantity": 1
  }],
  "Payments": [{
    "Type": "CreditCard",
    "Metadata": {
      "amount": "10",
      "creditCardNumber": "4111111111111111",
      "expMonth": "03",
      "expYear": "2028",
      "cvv": "527",
      "billingName": "John Doe",
      "billingAddress": "123 Main St",
      "billingCity": "Copenhagen",
      "billingPostalCode": "2300",
      "saveInfo": "true"
    }
  }],
  "Test": false,
  "SendEmail": true,
  "InStore": false
}
```

**ALL Metadata values MUST be strings.** `amount: 10` fails, `amount: "10"` works.


## Contract Purchase Format (WORKING)

```json
{
  "ClientId": "12345",
  "ContractId": 456,
  "LocationId": 1,
  "StartDate": "2026-02-08",
  "Test": false,
  "SendNotifications": true,
  "PromotionCode": "PROMO10",
  "CreditCardInfo": {
    "CreditCardNumber": "4111111111111111",
    "ExpMonth": "03",
    "ExpYear": "2028",
    "CVV": "527",
    "BillingName": "John Doe",
    "SaveInfo": true
  }
}
```

**Key notes:**
- `CreditCardInfo` uses **PascalCase** (unlike checkout Metadata which uses camelCase)
- `LocationId` is REQUIRED — omitting it returns "LocationID provided is not valid"
- `ContractId` is the contract template ID from `/sale/contracts`, NOT the client's contract ID
- Staff token bypasses payment — no credit card info needed for staff-authenticated purchases
- Response returns `ClientContractId` — store this for future manage operations

## Contract Suspend Format (WORKING)

```json
{
  "ClientContractId": 12345,
  "SuspendDate": "2025-04-08",
  "ResumeDate": "2025-05-08",
  "SendNotifications": true
}
```

**Business rules (configurable per brand):**
- Minimum suspension: 14 days
- Maximum suspension: 3 months (93 days)
- Start date must be after next billing cycle (can't pause mid-cycle)

## Contract Terminate Format (WORKING)

```json
{
  "ClientContractId": 12345,
  "TerminationDate": "2025-04-07",
  "SendNotifications": true
}
```

**Business rules (Yoga Bible DK):**
- Next billing date = last payment taken
- Use membership until end of that billing cycle (next billing + 1 month - 1 day)
- Example: next billing Mar 8 → last payment Mar 8 → use until Apr 7

## Staff Token "Sell Online" Bypass

**Discovery:** When calling Mindbody API with staff credentials, you can sell ANY pass or contract — even if NOT marked "Sell Online" in Mindbody admin. This means:
- Our store can display and sell everything, regardless of Mindbody's online visibility setting
- The `sellOnline=true` filter is optional — we control what to show in our own UI
- Useful for brand-specific promotions or internal-only passes

## Booking Strategy

1. **Frontend pass check**: `clientCanBook(programId)` — contracts cover all programs, services need matching `programId`
2. **Server-side pass check**: Fetch class program + client services/contracts, deny if no match
3. **Fail-open on validation error**: If pass check API call fails, allow booking (let Mindbody decide)
4. Try `addclienttoclass` directly
5. Detect "already booked" errors (keywords: "already", "enrolled", "signed up") → treat as success
6. If payment error → check for autopay contract → retry with `RequirePayment: false`
7. If no autopay → return `no_pass` error

## Cancel Strategy

1. Try `removeclientfromclass` with `LateCancel: false`
2. Detect cancel window error (keywords: "cancel", "window", "late", "deadline", "period")
3. Auto-retry with `LateCancel: true`
4. Return `lateCancel: true` flag for frontend warning toast
5. Frontend shows rich HTML toast with wellness context (6s timeout)

## Termination Date Calculation

```
nextBillingDate = March 8, 2026
lastPaymentDate = March 8 (the next billing)
useUntilDate    = April 7 (March 8 + 1 month - 1 day)
terminationDate = useUntilDate (sent to Mindbody API)
```

If `nextBillingDate` is in the past (edge case), use today as base.

## Contract Management Endpoints — RESOLVED (Updated 2026-02-09)

| Action | Correct Path | Body Fields | Status |
|--------|-------------|-------------|--------|
| Terminate | `POST /sale/terminatecontract` | `ClientId`, `ClientContractId`, `TerminationDate`, `SendNotifications` | **WORKING** |
| Suspend | `POST /client/suspendcontract` | `ClientId`, `ClientContractId`, `SuspendDate`, `Duration`, `DurationUnit`, `SuspensionType` | **WORKING** (SuspensionType:"Vacation", DurationUnit:"Day") |
| Resume/Cancel Pause | N/A | N/A | **DOES NOT EXIST** — tried all path categories |
| Activate (revoke) | N/A | N/A | **DOES NOT EXIST** |

**Key findings:**
- **Suspend uses `/client/` category** (NOT `/sale/`) — `/sale/suspendcontract` returns HTML 404
- **`SuspensionType` is the missing required field** — without it, API says "Duration and DurationUnit are required" (misleading error)
- Valid suspension types configured in MB admin: Vacation, Illness, Injury
- `/contract/terminatecontract` exists but has **different permission model** — returns "User does not have permission" even when the same staff user succeeds via `/sale/`
- `/client/terminatecontract` does NOT exist — returns HTML 404
- The code tries all 3 paths (`/sale/`, `/contract/`, `/client/`) with fallback, but `/sale/` **must be first**
- **Permission errors now trigger fallback** — if a path returns a permission error, the code continues to the next path
- `activatecontract` (revoke termination) — **does not exist in the API**. All 3 paths (`/sale/`, `/contract/`, `/client/`) return HTML 404. Frontend replaced revoke button with retention card + new contract purchase flow
- Staff token must be **fresh** for contract management — `clearTokenCache()` clears in-memory token before these operations
- Diagnostic trail: all management responses include `_pathResults` array showing which paths were tried and each response

## Revoke Cancellation — NOT POSSIBLE VIA API

`activatecontract` does **not exist** in Mindbody API v6. All 3 path attempts (`/sale/`, `/contract/`, `/client/`) return HTML 404. This means:
- **There is no API endpoint to revoke a pending contract termination**
- The backend returns `{ error: 'not_available' }` when the activate action is attempted
- **Frontend solution:** Instead of a revoke button, terminated contracts show a **retention card** with reactivation incentives. The CTA navigates to the Store tab to purchase a new contract (first month free is automatic on all contracts).
- After the termination date passes, the retention card is replaced with a simple "Become a member again" button linking to Store → Memberships.

## Error Debugging Trail

| # | Wrong | Correct | Notes |
|---|-------|---------|-------|
| 1 | `CardNumber` | `creditCardNumber` | camelCase inside Metadata |
| 2 | `Amount` outside Metadata | `amount` inside Metadata | Must be in Metadata dict |
| 3 | `expirationMonth` | `expMonth` | Abbreviated |
| 4 | `expirationYear` | `expYear` | Abbreviated |
| 5 | Non-string Metadata values | ALL strings | `Dict<string,string>` — numbers/booleans fail |
| 6 | `CartItems` | `Items` | Field name in checkout |
| 7 | camelCase query params | PascalCase | `clientId` → `ClientId` silently fails |
| 8 | `StartDate` for /sale/sales | `StartSaleDateTime` | Different from other endpoints |
| 9 | Trust `IsAvailable` flag | Ignore it, always show Book | Flag is unreliable |
| 10 | Trust `Clients[]` for bookings | Cross-ref with clientvisits | Array unreliable |
| 11 | Trust staff token for pass check | Validate manually | Token bypasses Mindbody validation |
| 12 | Fail on cancel window error | Retry with `LateCancel: true` | Auto-detect keywords |
| 13 | Comma-separated ServiceIds | Repeated params | `ServiceIds=X&ServiceIds=Y` |
| 14 | Staff Bio from /class/classes | Fetch from /staff/staff | Classes only has Id+Name |
| 15 | Compare dates for "upcoming" filter | Compare full datetimes | `new Date(startDateTime) > now`, not date-only |
| 16 | Show "buy pass" banner always | Smart logic: clips < 3 warning, never for members | Membership autopays should never see buy-pass CTA |
| 17 | Trust `ReferredBy` is writable via API | It's read-only in public API v6 | Must set referrals in admin panel |
| 18 | Single error toast for late cancel | Rich HTML toast with wellness note | 6s timeout, explain fee purpose |
| 19 | PUT method to Netlify Functions | POST with action field | PUT returns HTML 404 on Netlify |
| 20 | `res.json()` on MB API response | Parse as text first, try JSON | HTML 404 pages crash JSON parse. `shared/mb-api.js` reads text→JSON to catch HTML responses gracefully |
| 21 | `/contract/terminatecontract` first | Try `/sale/`, `/contract/`, `/client/` — `/sale/` must be first | `/contract/` has different permission model → returns "User does not have permission". `/sale/` works with same staff token |
| 22 | `/sale/contracts?sellOnline=true` | No filter, fetch all | MB contracts endpoint may not support sellOnline |
| 23 | `/sale/contracts` without LocationId | Retry with `LocationId=1` on 400 | Single-location sites may require it |
| 24 | `autopaySchedule` as string | Could be object `{FrequencyType: "Monthly"}` — extract `FrequencyType` | Was showing `[object Object]` in UI |
| 25 | Separate `mb-contract-manage` function | Use dedicated `mb-contract-manage.js` to avoid routing ambiguity | New Netlify functions can 404 before deploy completes. POST to mb-contracts for manage returns 405 |
| 26 | `Limit=200` on contracts fetch | No default Limit | May cause 400 errors |
| 27 | `/sale/sales` for per-client receipts | `/client/clientservices` + `/client/clientcontracts` | `/sale/sales` ignores ClientId filter |
| 28 | 99999 remaining clips displayed | Hide if >= 99999, show "Unlimited" text | Mindbody's "unlimited" placeholder |
| 29 | `ContractId` for terminate/suspend | `ClientContractId` | Template ID vs instance ID |
| 30 | `StartDate`/`EndDate` for classes | `StartDateTime`/`EndDateTime` | Classes endpoint uses DateTime variant |
| 31 | Firestore compound `.where()` queries | Filter client-side | Avoids need for composite indexes |
| 32 | `client.updateclient` with PUT | Uses POST internally | MB API uses POST for updates despite convention |
| 33 | `recurringPaymentAmount` ignored | Use as primary price for contracts | The `price` field may show first payment, not recurring |
| 34 | Time-based passes = memberships | They're NOT contracts | "unlimited 1 month" is a time-based pass, not a membership |
| 35 | `/sale/purchasecontract` without LocationId | Must include `LocationId` | Returns "LocationID provided is not valid" |
| 36 | `isDa` in serverless function | Variable doesn't exist server-side | Only use language detection in frontend JS, not in Netlify functions |
| 37 | Terminate with TerminationCode always | Some sites don't have codes configured | Retry without TerminationCode if first attempt fails |
| 38 | Permission error stops path fallback | Permission errors should try next path | "User does not have permission" from `/contract/` shouldn't stop trying `/sale/` |
| 39 | Stale staff token for management ops | Call `clearTokenCache()` before terminate/suspend | 6-hour cached token may have stale permissions after admin changes |
| 40 | `activatecontract` exists in MB API | It does NOT exist — all paths return HTML 404 | No API to revoke pending contract termination. Use retention card + new purchase flow |
| 41 | Frontend calls `mb-contract-manage` | Should call `mb-contracts` with action field | Old code referenced wrong function endpoint — caused 401 errors on deployed site |
| 42 | `c.contractId` in client-services = template ID | `c.Id` is instance, `c.ContractId` is template | Must return both: `id` (instance for manage) + `contractId` (template for store matching) |
| 43 | `FirstPaymentAmountSubtotal` of 0 | Means first month is free | Check `firstMonthFree: firstPaymentRaw === 0` — useful for retention card messaging |
| 44 | `addclient` returns 400 for duplicate email | Handle as 409 → look up existing client | `createMindbodyClient()` must catch 409 and call `linkExistingMindbodyClient()` to auto-link |
| 45 | Mindbody `BirthDate` returns `0001-01-01T00:00:00` for unset | Filter out `0001-01-01` | When pulling DOB from MB, check `bd !== '0001-01-01'` before storing in Firestore |
| 46 | `updateclient` doesn't accept `BirthDate` | It DOES — use PascalCase `BirthDate` in body | `mb-client.js` PUT now supports `birthDate` → mapped to `BirthDate` |
| 47 | Date format conflict: dd/mm/yyyy (DK) vs mm/dd/yyyy (US/MB) | **No conflict** — all dates use ISO `YYYY-MM-DD` end-to-end | `<input type="date">` always returns `YYYY-MM-DD` regardless of browser locale display. Mindbody returns `YYYY-MM-DDTHH:MM:SS` → we extract `YYYY-MM-DD`. Firestore stores `YYYY-MM-DD`. **If DOB looks wrong in MB admin**, check: (1) was it sent as `YYYY-MM-DD`? (2) does MB display interpret it as mm/dd or dd/mm? The API always uses ISO but the MB admin UI may display in US format |
