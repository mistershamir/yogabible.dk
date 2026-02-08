# Mindbody API v6 — Integration Reference & Debug Trail

> This is the living reference document. Update it every time you debug a new issue.
> Copy this to every new brand project. **Last updated: 2026-02-08.**

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
| `/client/addclient` | POST | Body: `FirstName`, `LastName`, `Email`, `SendAccountEmails`, `MobilePhone` | `Client` | Create client. Returns 400 for duplicates |
| `/client/updateclient` | POST | Body: `Client: {ClientId, ...}`, `CrossRegionalUpdate` | `Client` | Update client. Note: POST not PUT |
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

### Contract Management Endpoints (AMBIGUOUS PATH)

These endpoints exist in Mindbody v6 but the exact category path is unclear from docs.
Our code tries paths in order: `/contract/`, `/sale/`, `/client/`.

| Endpoint | Method | Body | Notes |
|----------|--------|------|-------|
| `/{category}/terminatecontract` | POST | `ClientId`, `ClientContractId`, `TerminationDate`, `SendNotifications`, `TerminationCode?` | If code-related error, retry without `TerminationCode` |
| `/{category}/suspendcontract` | POST | `ClientId`, `ClientContractId`, `SuspendDate`, `ResumeDate`, `SendNotifications` | Duration: 14-93 days |

### Site & Staff Endpoints

| Endpoint | Method | Params | Response Key | Notes |
|----------|--------|--------|-------------|-------|
| `/site/sessiontypes` | GET | `Limit` | `SessionTypes[]` | Class type config |
| `/site/programs` | GET | `Limit` | `Programs[]` | Program categories |
| `/site/locations` | GET | — | `Locations[]` | Studio locations |
| `/site/memberships` | GET | `Limit` | `Memberships[]` | Membership types |
| `/site/promocodes` | GET | `Limit` | `PromoCodes[]` | Promo codes |
| `/staff/staff` | GET | `StaffIds`, `Limit` | `StaffMembers[]` | Teacher details + bio + photo |
| `/usertoken/issue` | POST | Body: `Username`, `Password` | `AccessToken` | Auth token. Cache 6 hours |

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

Note: `CreditCardInfo` uses **PascalCase** (unlike checkout Metadata which uses camelCase).

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

## Contract Management Endpoints — RESOLVED

After extensive debugging, the correct paths are under the **Sale** category:

| Action | Correct Path | Body Fields |
|--------|-------------|-------------|
| Terminate | `POST /sale/terminatecontract` | `ClientId`, `ClientContractId`, `TerminationDate`, `SendNotifications` |
| Suspend | `POST /sale/suspendcontract` | `ClientId`, `ClientContractId`, `SuspendDate`, `ResumeDate`, `SendNotifications` |
| Activate (revoke) | `POST /sale/activatecontract` | `ClientId`, `ClientContractId` |

**Key findings:**
- `/contract/terminatecontract` exists but has **different permission model** — returns "User does not have permission" even when the same staff user succeeds via `/sale/`
- `/client/terminatecontract` does NOT exist — returns HTML 404
- The code tries all 3 paths (`/sale/`, `/contract/`, `/client/`) with fallback, but `/sale/` should be first
- `activatecontract` (revoke termination) — endpoint path is undocumented. Same multi-path trial strategy used.
- Staff token must be **fresh** for contract management — code clears token cache before these operations

## Revoke Cancellation (Activate Contract)

Users can revoke a pending termination before the termination date. Frontend shows a "Revoke cancellation" button on terminated contracts. The backend tries `/sale/activatecontract` first. If the API path doesn't exist, falls back gracefully with a "contact studio" message.

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
| 20 | `res.json()` on MB API response | Parse as text first, try JSON | HTML 404 pages crash JSON parse |
| 21 | `/contract/terminatecontract` | Try `/contract/`, `/sale/`, `/client/` | Endpoint category is ambiguous in docs |
| 22 | `/sale/contracts?sellOnline=true` | No filter, fetch all | MB contracts endpoint may not support sellOnline |
| 23 | `/sale/contracts` without LocationId | Retry with `LocationId=1` on 400 | Single-location sites may require it |
| 24 | `autopaySchedule` as string | Could be object — extract `FrequencyType` | Was showing `[object Object]` in UI |
| 25 | Separate `mb-contract-manage` function | Merged into `mb-contracts` as POST with action | New Netlify functions can 404 before deploy completes |
| 26 | `Limit=200` on contracts fetch | No default Limit | May cause 400 errors |
| 27 | `/sale/sales` for per-client receipts | `/client/clientservices` + `/client/clientcontracts` | `/sale/sales` ignores ClientId filter |
| 28 | 99999 remaining clips displayed | Hide if >= 99999 | Mindbody's "unlimited" placeholder |
| 29 | `ContractId` for terminate/suspend | `ClientContractId` | Template ID vs instance ID |
| 30 | `StartDate`/`EndDate` for classes | `StartDateTime`/`EndDateTime` | Classes endpoint uses DateTime variant |
| 31 | Firestore compound `.where()` queries | Filter client-side | Avoids need for composite indexes |
| 32 | `client.updateclient` with PUT | Uses POST internally | MB API uses POST for updates despite convention |
