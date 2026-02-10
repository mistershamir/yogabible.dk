# Namaste Online — Mindbody Integration Guide for Flutter

> **For:** The namasteonline.com development team (Flutter)
> **Context:** Namaste Online is an online yoga studio sharing the same Mindbody site/API credentials as Yoga Bible / Hot Yoga Copenhagen. This guide covers how to integrate payments, contracts, class booking, and schedule filtering for the Namaste Online brand specifically.

---

## What You're Building

A member area in a Flutter app that:
1. Shows a class schedule filtered to Namaste Online classes only
2. Sells passes and memberships (filtered to Namaste Online revenue category)
3. Processes card payments through Mindbody
4. Manages contracts (purchase, pause, terminate)
5. Shows purchase history and generates invoices
6. Handles class booking with pass validation

All of this uses the **same Mindbody site, same API key, same credentials** as yogabible.dk — you just filter to the "Namaste Online" revenue category (Program) and the Namaste session types.

---

## Shared Mindbody Credentials

```
MB_API_KEY=<same key as yogabible.dk — get from project owner>
MB_SITE_ID=<same site ID>
MB_STAFF_USERNAME=<same staff user>
MB_STAFF_PASSWORD=<same staff password>
API_BASE=https://api.mindbodyonline.com/public/v6
```

The API key and site ID are the same. You're hitting the same Mindbody account — the differentiation is done by filtering on **Program** (revenue category) and **Session Type** (class type).

---

## Key Concept: Filtering by Brand

### Programs (Revenue Categories)
Every service, pass, and class in Mindbody belongs to a **Program** (= Revenue Category). Namaste Online has its own program. To find it:

```
GET /site/programs
Headers: Api-Key, SiteId, Authorization (staff token)
```

Look for the program named "Namaste Online" (or similar). Note its `Id`.

Then filter everything:
- **Services/passes:** `GET /sale/services?ProgramIds={namasteId}&SellOnline=true`
- **Classes:** `GET /class/classes?ProgramIds={namasteId}&StartDateTime=...&EndDateTime=...`
- **Purchase history:** Fetch all, filter client-side by `programId`

### Session Types (Class Types)
Your class types in Mindbody:
- **Namaste Flow**
- **Namaste Gentle**
- **Namaste Pilates**

These come from `ClassDescription.SessionType.Name` on each class. Use them for filter pills in your schedule UI.

To get the full list:
```
GET /site/sessiontypes
```

---

## Authentication Flow

### 1. Staff Token (Server-Side)
All API calls use a staff token. Acquire and cache it:

```
POST /usertoken/issue
Body: {
  "Username": MB_STAFF_USERNAME,
  "Password": MB_STAFF_PASSWORD
}
Response: { "AccessToken": "...", "TokenType": "Bearer" }
```

Cache for 6 hours. Every subsequent API call includes:
```
Headers:
  Api-Key: {MB_API_KEY}
  SiteId: {MB_SITE_ID}
  Authorization: {AccessToken}
  Content-Type: application/json
```

### 2. Client Accounts
Each user needs a Mindbody client account. On signup:

```
POST /client/addclient
Body: {
  "FirstName": "...",
  "LastName": "...",
  "Email": "...",
  "ReferredBy": "NamasteOnline"   // tag for tracking
}
```

If email already exists (409 error), look up instead:
```
GET /client/clients?SearchText={email}
```

Store the Mindbody `ClientId` in your own database.

---

## Class Schedule

### Fetching Classes
```
GET /class/classes?StartDateTime={date}&EndDateTime={date}&ProgramIds={namasteId}&Limit=200
```

### Response Mapping
```dart
class YogaClass {
  int id;                    // cls.Id
  String name;               // cls.ClassDescription.Name
  String description;        // cls.ClassDescription.Description
  DateTime startDateTime;    // cls.StartDateTime
  DateTime endDateTime;      // cls.EndDateTime
  String instructor;         // cls.Staff.Name
  int? instructorId;         // cls.Staff.Id
  int? maxCapacity;          // cls.MaxCapacity
  int? totalBooked;          // cls.TotalBooked
  int? spotsLeft;            // MaxCapacity - TotalBooked
  bool isCanceled;           // cls.IsCanceled
  String sessionTypeName;    // cls.ClassDescription.SessionType.Name
  int? sessionTypeId;        // cls.ClassDescription.SessionType.Id
  int? programId;            // cls.ClassDescription.Program.Id
}
```

### Session Type Filtering
Build filter chips from the `sessionTypeName` values present in the current week's classes. Don't hardcode — build dynamically so new types auto-appear.

### 3-Day Progressive Loading
Show today + 2 more days initially. "Show more" reveals the rest of the week. "Show next week" navigates forward.

---

## Store / Purchasing

### Fetching Purchasable Items

**Services (class passes):**
```
GET /sale/services?ProgramIds={namasteId}&SellOnline=true&Limit=200
```

**Contracts (memberships):**
```
GET /sale/contracts?LocationId=1
```
Filter contracts client-side by name containing "Namaste" or by associated program.

### Service Response
```json
{
  "Id": 123,
  "Name": "Namaste 10-Class Pass",
  "Price": 800,
  "OnlinePrice": 750,
  "Count": 10,
  "Program": { "Id": 5, "Name": "Namaste Online" }
}
```

### Contract Response
```json
{
  "Id": 456,
  "ContractName": "Namaste Unlimited Monthly",
  "FirstPaymentAmount": 0,
  "RecurringPaymentAmount": 499,
  "AutopaySchedule": { "FrequencyType": "Monthly" },
  "FirstMonthFree": true,
  "AgreementTerms": "<html>...</html>"
}
```

### Card Payment (Services)
```
POST /sale/checkoutshoppingcart
Body: {
  "ClientId": "100000037",
  "CartItems": [
    { "Item": { "Type": "Service", "Metadata": { "Id": "123" } }, "Quantity": 1 }
  ],
  "Payments": [
    {
      "Type": "CreditCard",
      "Metadata": {
        "Amount": "750",
        "CreditCardNumber": "4111111111111111",
        "ExpMonth": "12",
        "ExpYear": "2028",
        "Cvv": "123",
        "BillingName": "John Doe",
        "BillingPostalCode": "1400"
      }
    }
  ],
  "Test": false
}
```

**CRITICAL: ALL Metadata values must be STRINGS.** `"750"` not `750`. `"false"` not `false`.

### Contract Purchase (Memberships)
```
POST /sale/purchasecontract
Body: {
  "ClientId": "100000037",
  "ContractId": 456,
  "LocationId": 1,
  "StartDate": "2026-02-10",
  "PromoCode": "WELCOME",      // optional
  "CreditCardNumber": "...",
  "ExpMonth": "12",
  "ExpYear": "2028",
  "CvCv": "123",
  "BillingName": "John Doe",
  "BillingPostalCode": "1400"
}
```

### Contract Terms / Signature
For online purchases, you don't need a handwritten signature. The `AgreementTerms` HTML from the contract can be displayed as a scrollable text block with a checkbox:

```
☑ I agree to the terms and conditions
[Purchase]
```

No canvas signature pad needed. The act of submitting the purchase with the checkbox is sufficient.

---

## Class Booking

### Book a Class
```
POST /class/addclienttoclass
Body: {
  "ClientId": "100000037",
  "ClassId": 12345,
  "SendEmail": true
}
```

### CRITICAL: Server-Side Pass Validation
The staff token bypasses Mindbody's payment validation. You MUST validate server-side:

1. Fetch the class → get `Program.Id`
2. Fetch `GET /client/clientservices?ClientId=X&Limit=200`
3. Check if any active service has matching `Program.Id` AND `Remaining > 0`
4. If no match → return error, redirect to store

### Autopay Billing Gap
Members between billing cycles may have "expired" services. If booking fails with payment error:
1. Check if client has active autopay contract for this program
2. If yes → retry with `RequirePayment: false`

### Cancel a Booking
```
POST /class/removeclientfromclass
Body: {
  "ClientId": "100000037",
  "ClassId": 12345,
  "LateCancel": false,
  "SendEmail": true
}
```

If cancellation fails due to "outside window" → retry with `LateCancel: true`.

### Waitlist (Full Classes)
```
POST /class/addclienttowaitlist
Body: {
  "ClientId": "100000037",
  "ClassScheduleId": 12345
}
```

---

## Contract Management

### Pause (Suspend)
```
POST /client/suspendcontract
Body: {
  "ClientId": "100000037",
  "ClientContractId": 456,
  "SuspendDate": "2026-03-15",     // END date, not start
  "ResumeDate": "2026-03-15",      // same as SuspendDate
  "Duration": 14,                   // number of days
  "DurationUnit": "Day",
  "SuspensionType": "Vacation"      // REQUIRED: "Vacation", "Illness", or "Injury"
}
```

**Store pause state in your own database** — MB's `IsSuspended` is `false` for future-dated pauses.

**There is NO resume/cancel-pause API endpoint.** Users must contact the studio.

### Terminate (Cancel)
Try these 3 paths in sequence:
```
POST /sale/terminatecontract        { ClientContractId: 456, ClientId: "..." }
POST /contract/terminatecontract    { ClientContractId: 456, ClientId: "..." }
POST /client/terminatecontract      { ClientContractId: 456, ClientId: "..." }
```

### Active Passes Check
```
GET /client/clientservices?ClientId=X&Limit=200
GET /client/clientcontracts?ClientId=X
```

For contract prices, use `UpcomingAutopayEvents[0].ChargeAmount` (NOT top-level fields which are 0).

---

## Purchase History

### The Problem
There's no single "purchase history" API. You must merge 3 sources:

1. **Sales:** `GET /sale/sales` (paginated, 200/page)
2. **Services:** `GET /client/clientservices?ClientId=X`
3. **Contracts:** `GET /client/clientcontracts?ClientId=X`

### Sales ClientId Filter is BROKEN
`/sale/sales?ClientId=X` **ignores the filter**. Fetch all, then match by:
```dart
bool isMatch = sale.clientId.toString() == targetId.toString()
            || sale.recipientClientId.toString() == targetId.toString();
```

`RecipientClientId` = actual client (number). `ClientId` = purchaser account (string). Compare as strings.

### Correct Field Names
| What | Correct | Wrong (returns 0/null) |
|---|---|---|
| Item price | `UnitPrice` | `Price` |
| Total | `TotalAmount` | `AmountPaid` |
| Tax | `TaxAmount` | `Tax` |
| Payment amount | `Amount` | `PaymentAmountPaid` |
| Payment method | `Type` | `PaymentMethodName` |

### Services Have No Price
Cross-reference with sales by matching description text.

---

## Query Parameter Rules

**ALL query parameters MUST be PascalCase.** `camelCase` silently returns empty results.

```
CORRECT: ?ClientId=X&StartDateTime=2026-02-10
WRONG:   ?clientId=X&startDateTime=2026-02-10  (returns empty!)
```

---

## PUT Does Not Work on Serverless

If you're using serverless functions (Netlify, Cloud Functions, etc.), `PUT` requests may return 404. Use `POST` with an `action` field in the body:

```json
{ "action": "terminate", "clientId": "...", "contractId": 456 }
```

---

## Invoice Data

For generating invoices in Flutter, you need:
- Sale date, sale ID, client name
- Line items: description, quantity, unit price, tax, total
- Payments: method, card last 4, amount
- Company info: name, address, CVR/VAT number, bank details

All this comes from the purchase history merge described above.

---

## Implementation Checklist

```
[ ] 1. Token management — staff token acquisition + 6-hour caching
[ ] 2. Client lookup/create — link MB client to app user
[ ] 3. Schedule — fetch classes filtered by Namaste program, show session types
[ ] 4. Store — fetch services + contracts filtered by Namaste program
[ ] 5. Checkout — card payment for services (strings in Metadata!)
[ ] 6. Contract purchase — membership signup with terms checkbox
[ ] 7. Booking — with server-side pass validation + autopay gap handling
[ ] 8. Active passes — fetch + display remaining sessions, expiry
[ ] 9. Contract management — pause (with DB persistence) + terminate
[ ] 10. Purchase history — 3-source merge with correct field mappings
[ ] 11. Invoices — generate from purchase data
[ ] 12. Waitlist — for full classes
```

---

## Reference Files

These files from the yogabible.dk repo contain the complete, working implementation:

| File | What to Study |
|---|---|
| `netlify/functions/shared/mb-api.js` | Token management pattern |
| `netlify/functions/mb-checkout.js` | Card payment flow |
| `netlify/functions/mb-contracts.js` | Contract fetch + purchase + terminate + suspend |
| `netlify/functions/mb-contract-manage.js` | Pause logic with all gotchas handled |
| `netlify/functions/mb-book.js` | Booking with pass validation + autopay retry |
| `netlify/functions/mb-purchases.js` | 3-source purchase history merge |
| `netlify/functions/mb-services.js` | Service/pass fetching with program filter |
| `netlify/functions/mb-client-services.js` | Active passes + contract status |
| `docs/member-area-mindbody-integration/PAYMENT-INTEGRATION.md` | Full payment reference |
