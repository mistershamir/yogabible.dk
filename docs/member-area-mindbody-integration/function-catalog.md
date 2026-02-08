# Netlify Functions — Mindbody Integration Catalog

> All functions live in `netlify/functions/` and share `netlify/functions/shared/mb-api.js`

## Core Functions (Essential)

### mb-classes.js
- **Method:** GET
- **Purpose:** Fetch class schedule from Mindbody
- **Params:** `startDate`, `endDate`, `clientId`
- **Returns:** `{ classes[], startDate, endDate, total }`
- **Each class:** `id`, `name`, `description`, `startDateTime`, `endDateTime`, `instructor`, `instructorId`, `instructorBio`, `instructorImageUrl`, `spotsLeft`, `isBooked`, `isCanceled`, `programId`, `programName`

### mb-book.js
- **Method:** POST (book) / DELETE (cancel)
- **Purpose:** Book or cancel a class for a client
- **POST Body:** `{ clientId, classId, test? }`
- **DELETE Body:** `{ clientId, classId, lateCancel? }`
- **Features:**
  - Server-side pass validation (checks program match before booking)
  - "Already booked" detection (returns success + flag)
  - Late cancel auto-retry (detects window error, retries with LateCancel: true)
- **Returns:** `{ success, visit?, alreadyBooked?, lateCancel? }`

### mb-client.js
- **Method:** POST
- **Purpose:** Create or update a Mindbody client
- **Body:** `{ firstName, lastName, email, phone?, action: 'create'|'update', clientId? }`
- **Returns:** `{ client, clientId }`

### mb-sync.js
- **Method:** POST
- **Purpose:** Sync a Firebase user to Mindbody (find or create client)
- **Body:** `{ email, firstName, lastName }`
- **Returns:** `{ clientId, synced: true }`

### mb-client-services.js
- **Method:** GET
- **Purpose:** Fetch client's active passes, services, and contracts
- **Params:** `clientId`
- **Returns:** `{ services[], contracts[], activeServices[], activeContracts[], hasActivePass }`

### mb-visits.js
- **Method:** GET
- **Purpose:** Fetch client visit history (past + 30 days future)
- **Params:** `clientId`, `startDate?`, `endDate?`
- **Returns:** `{ visits[], total }` — each visit has `isFuture` flag

### mb-staff.js
- **Method:** GET
- **Purpose:** Fetch teacher/staff details (bio, photo)
- **Params:** `staffId?` (if omitted, returns all)
- **Returns:** `{ staff[], total }`

## Store & Payment Functions

### mb-services.js
- **Method:** GET
- **Purpose:** Fetch purchasable services, products, or categories
- **Params:** `type=services|products|categories`, `serviceIds?`, `sellOnline?`, `programIds?`
- **Returns:** `{ services[] }` or `{ products[] }` or `{ categories[] }`

### mb-checkout.js
- **Method:** POST
- **Purpose:** Purchase a service/product with credit card
- **Body:** `{ clientId, items[], payment: { cardNumber, expMonth, expYear, cvv, ... }, test? }`
- **Handles:** SCA (Strong Customer Authentication) redirects
- **Returns:** `{ success, transactionId }` or `{ requiresSCA, authenticationUrl }`

### mb-purchases.js
- **Method:** GET
- **Purpose:** Fetch client purchase receipts
- **Params:** `clientId`, `startDate?`, `endDate?`
- **Strategy:** Tries `/sale/sales` first, falls back to `/sale/clientpurchases`
- **Returns:** `{ purchases[], total }`

### mb-contracts.js
- **Method:** GET (list) / POST (purchase)
- **Purpose:** Fetch available contracts/memberships and purchase them
- **GET Params:** `contractId?`, `locationId?`, `sellOnline?`
- **POST Body:** `{ clientId, contractId, startDate?, payment?, promoCode?, test? }`
- **Returns:** GET: `{ contracts[], total }` | POST: `{ success, clientContractId }`

### mb-return-sale.js
- **Method:** POST
- **Purpose:** Process a sale return/refund
- **Body:** `{ saleId, test? }`
- **Returns:** `{ success, sale }`

## Site Configuration Functions

### mb-site.js
- **Method:** GET
- **Purpose:** Fetch site configuration data
- **Params:** `type=sessionTypes|programs|locations|memberships|promoCodes`
- **Returns:** Depends on type

### mb-class-descriptions.js
- **Method:** GET
- **Purpose:** Fetch class type library (descriptions, programs, images)
- **Params:** `classDescriptionId?`, `programId?`, `startDate?`, `endDate?`
- **Returns:** `{ classDescriptions[], total }`

### mb-waitlist.js
- **Method:** GET (list) / POST (add) / DELETE (remove)
- **Purpose:** Manage class waitlists
- **GET Params:** `classScheduleId?`, `clientId?`, `classDescriptionId?`
- **POST Body:** `{ clientId, classScheduleId }`
- **DELETE Body:** `{ waitlistEntryId }`

## Shared Module

### shared/mb-api.js
- **`mbFetch(path, options?)`** — Authenticated API call with staff token
- **`jsonResponse(status, body)`** — CORS-enabled JSON response helper
- **`corsHeaders`** — Standard CORS headers object
- **`getStaffToken()`** — Token acquisition + 6-hour caching
