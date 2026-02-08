# Mindbody API v6 — Integration Reference

> This is the living reference document. Update it every time you debug a new issue.
> Copy this to every new brand project.

## Credentials & Auth
- Base URL: `https://api.mindbodyonline.com/public/v6`
- Headers: `Api-Key`, `SiteId`, `Authorization` (staff token)
- Staff token: POST `/usertoken/issue` with `Username`, `Password`
- Token lasts 7 days, cache for 6 hours in function memory

## CRITICAL RULES (read first!)

1. **ALL query params are PascalCase** — `ClientId`, `StartDateTime`, `Limit` etc. camelCase silently returns empty results.
2. **Checkout Metadata values are ALL strings** — `Dict<string,string>`. Numbers like `amount: 10` will fail. Use `amount: "10"`.
3. **Cart field is `Items`** — NOT `CartItems`
4. **`IsAvailable` flag on classes is UNRELIABLE** — always show Book button, let backend validate
5. **`Clients[]` array on classes is UNRELIABLE** — cross-reference with `/client/clientvisits` to detect bookings
6. **Staff token bypasses payment AND pass validation** — you MUST manually check client services match the class program before booking
7. **`/sale/sales` uses `StartSaleDateTime`/`EndSaleDateTime`** — NOT `StartDate`/`EndDate` like other endpoints
8. **ServiceIds use repeated params** — `ServiceIds=100&ServiceIds=200` NOT `ServiceIds=100,200`
9. **Staff Bio/ImageUrl not in classes endpoint** — must fetch from `/staff/staff` separately

## Endpoint Reference

### Class Endpoints

| Endpoint | Method | Params | Response Key | Notes |
|----------|--------|--------|-------------|-------|
| `/class/classes` | GET | `StartDateTime`, `EndDateTime`, `Limit`, `ClientId`, `ClassIds` | `Classes[]` | Schedule data |
| `/class/classdescriptions` | GET | `ClassDescriptionId`, `ProgramIds`, `StartClassDateTime`, `EndClassDateTime`, `Limit` | `ClassDescriptions[]` | Class type library |
| `/class/addclienttoclass` | POST | Body: `ClientId`, `ClassId`, `Test`, `SendEmail` | `Visit` | Book a class |
| `/class/removeclientfromclass` | POST | Body: `ClientId`, `ClassId`, `LateCancel`, `SendEmail` | — | Cancel booking |
| `/class/waitlistentries` | GET | `ClassScheduleIds`, `ClientIds`, `ClassDescriptionIds`, `Limit` | `WaitlistEntries[]` | Waitlist data |
| `/class/addclienttowaitlist` | POST | Body: `ClientId`, `ClassScheduleId` | `WaitlistEntry` | Join waitlist |
| `/class/removeclientfromwaitlist` | POST | Body: `WaitlistEntryIds[]` | — | Leave waitlist |

### Client Endpoints

| Endpoint | Method | Params | Response Key | Notes |
|----------|--------|--------|-------------|-------|
| `/client/clients` | GET | `SearchText`, `Limit` | `Clients[]` | Search clients |
| `/client/addclient` | POST | Body: `FirstName`, `LastName`, `Email` | `Client` | Create client |
| `/client/updateclient` | POST | Body: `Client: {ClientId, ...}`, `CrossRegionalUpdate` | `Client` | Update client |
| `/client/clientservices` | GET | `ClientId`, `Limit` | `ClientServices[]` | Active passes |
| `/client/clientcontracts` | GET | `ClientId` | `Contracts[]` | Memberships |
| `/client/clientvisits` | GET | `ClientId`, `StartDate`, `EndDate`, `Limit` | `Visits[]` | Visit history |

### Sale Endpoints

| Endpoint | Method | Params | Response Key | Notes |
|----------|--------|--------|-------------|-------|
| `/sale/services` | GET | `ServiceIds`, `SellOnline`, `ProgramIds`, `Limit` | `Services[]` | Purchasable services |
| `/sale/products` | GET | `Limit` | `Products[]` | Retail products |
| `/sale/servicecategories` | GET | — | `ServiceCategories[]` | Service categories |
| `/sale/contracts` | GET | `ContractIds`, `LocationId`, `SellOnline`, `Limit` | `Contracts[]` | Available memberships |
| `/sale/sales` | GET | `ClientId`, `StartSaleDateTime`, `EndSaleDateTime`, `Limit` | `Sales[]` | Receipts (PREFERRED) |
| `/sale/clientpurchases` | GET | `ClientId`, `StartDate`, `EndDate`, `Limit` | `Purchases[]` | Receipts (FALLBACK) |
| `/sale/checkoutshoppingcart` | POST | Body: `ClientId`, `Items[]`, `Payments[]`, `Test`, `SendEmail` | `TransactionIds[]` | Purchase |
| `/sale/purchasecontract` | POST | Body: `ClientId`, `ContractId`, `StartDate`, `CreditCardInfo`, `PromotionCode` | `ClientContractId` | Buy membership |
| `/sale/returnsale` | POST | Body: `Id`, `Test` | `Sale` | Refund |

### Site Endpoints

| Endpoint | Method | Params | Response Key | Notes |
|----------|--------|--------|-------------|-------|
| `/site/sessiontypes` | GET | `Limit` | `SessionTypes[]` | Class type config |
| `/site/programs` | GET | `Limit` | `Programs[]` | Program categories |
| `/site/locations` | GET | — | `Locations[]` | Studio locations |
| `/site/memberships` | GET | `Limit` | `Memberships[]` | Membership types |
| `/site/promocodes` | GET | `Limit` | `PromoCodes[]` | Promo codes |

### Staff Endpoints

| Endpoint | Method | Params | Response Key | Notes |
|----------|--------|--------|-------------|-------|
| `/staff/staff` | GET | `StaffIds`, `Limit` | `StaffMembers[]` | Teacher details + bio |
| `/usertoken/issue` | POST | Body: `Username`, `Password` | `AccessToken` | Auth token |

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

## Booking Strategy

1. **Frontend pass check**: Verify `clientPassData.activeServices` has matching `programId`
2. **Server-side pass check**: Fetch class program + client services, deny if no match
3. Try `addclienttoclass` directly
4. Detect "already booked" errors → treat as success
5. If payment error → check for autopay contract → retry with `RequirePayment: false`
6. If no autopay → return `no_pass` error

## Cancel Strategy

1. Try `removeclientfromclass` with `LateCancel: false`
2. Detect "cancel" + "window"/"late"/"deadline"/"period" → retry with `LateCancel: true`
3. Return `lateCancel: true` flag for frontend warning toast

## Error Debugging Trail

| # | Wrong | Correct | Notes |
|---|-------|---------|-------|
| 1 | `CardNumber` | `creditCardNumber` | camelCase inside Metadata |
| 2 | `Amount` outside Metadata | `amount` inside Metadata | Must be in Metadata dict |
| 3 | `expirationMonth` | `expMonth` | Abbreviated |
| 4 | `expirationYear` | `expYear` | Abbreviated |
| 5 | Non-string Metadata values | ALL strings | `Dict<string,string>` |
| 6 | `CartItems` | `Items` | Field name |
| 7 | camelCase query params | PascalCase | `clientId` → `ClientId` |
| 8 | `StartDate` for /sale/sales | `StartSaleDateTime` | Different from other endpoints |
| 9 | Trust `IsAvailable` flag | Ignore it, always show Book | Flag is unreliable |
| 10 | Trust `Clients[]` for bookings | Cross-ref with clientvisits | Array unreliable |
| 11 | Trust staff token for pass check | Validate manually | Token bypasses validation |
| 12 | Fail on cancel window error | Retry with `LateCancel: true` | Auto-detect |
| 13 | Comma-separated ServiceIds | Repeated params | `ServiceIds=X&ServiceIds=Y` |
| 14 | Staff Bio from /class/classes | Fetch from /staff/staff | Classes only has Id+Name |
| 15 | Compare dates for "upcoming" filter | Compare full datetimes | `new Date(startDateTime) > now`, not date-only |
| 16 | Show "buy pass" banner always | Smart logic: clips < 3 warning, never for members | Membership autopays should never see buy-pass CTA |
| 17 | Trust `ReferredBy` is writable via API | It's read-only in public API v6 | Must set referrals in admin panel |
| 18 | Single error toast for late cancel | Rich HTML toast with wellness note | 6s timeout, explain fee purpose |
