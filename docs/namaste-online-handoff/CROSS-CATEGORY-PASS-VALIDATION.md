# Cross-Category Pass Validation — Mindbody API v6

> **Finding date:** 2026-02-11
> **Context:** Debugging why a "Daily Classes" pass couldn't book a "Vibro Yoga" class despite a Service Category Relationship configured in Mindbody business settings.

---

## The Problem

Mindbody allows configuring **Service Category Relationships** so that a pass purchased under one service category (Program) can also pay for classes in a different service category. For example: a "Daily Classes" pass can book "Vibro Yoga" classes.

Our booking function (`mb-book.js`) was checking `client.pass.Program.Id === class.Program.Id` (exact match), which rejected cross-category bookings.

## What Does NOT Work

### 1. `HideRelatedPrograms=false` on `/sale/services`

```
GET /sale/services?ProgramIds=30&HideRelatedPrograms=false&Limit=200
```

**Expected:** Returns services from program 30 AND from related programs (e.g., program 22).
**Actual:** Returned 50 services, ALL with `Program.Id = 30`. No cross-category services appeared.

The `HideRelatedPrograms` parameter did not expose cross-category relationships despite documentation suggesting it would. Comparing with `HideRelatedPrograms=true` returned the same results.

### 2. `ClassId` filter on `/sale/services`

```
GET /sale/services?ClassId=2287&Limit=200
```

This was tried as an alternative but also did not return cross-category pricing options.

## What DOES Work

### `/client/clientservices` with `ClassId` filter

```
GET /client/clientservices?ClientId=100000001&ClassId=2287&Limit=200
```

**This is the correct approach.** When you add `ClassId` to the client services query, Mindbody returns ONLY the client's passes that can pay for that specific class — **including cross-category passes** based on Service Category Relationships configured in the business settings.

**Example result:**
```
Client services valid for this class (ClassId filter): 1
  - TEST1 YB | program: 22 (Daily Classes) | current: true | remaining: 4
ALLOWED — client has valid service: TEST1 YB program: 22 (class program: 30)
```

The client's "Daily Classes" pass (program 22) was returned as valid for a "Vibro Yoga" class (program 30) because the relationship is configured in Mindbody.

## Implementation

### mb-book.js — `validateClientPass()`

```javascript
// Three parallel API calls:
var [classData, classFilteredServices, allClientServices] = await Promise.all([
  // 1. Get class info (for program name in error messages)
  mbFetch('/class/classes?ClassIds=' + classId + '&Limit=1'),
  // 2. KEY: Get client's passes valid for THIS class (cross-category aware)
  mbFetch('/client/clientservices?ClientId=' + clientId + '&ClassId=' + classId + '&Limit=200'),
  // 3. Fallback: Get ALL client passes (for same-category exact match)
  mbFetch('/client/clientservices?ClientId=' + clientId + '&Limit=200')
]);

// Check #2 first (cross-category aware), then fall back to #3 (exact program match)
```

### Why the fallback?

The `ClassId` filter is the primary check. The fallback (checking all services by exact program ID match) exists in case the `ClassId` filter behaves unexpectedly on certain Mindbody configurations. It ensures same-category bookings always work.

## Key Takeaways for Future Development

1. **Never check `pass.Program.Id === class.Program.Id` directly** — this ignores cross-category relationships.
2. **Use `GET /client/clientservices?ClientId=X&ClassId=Y`** to ask Mindbody which passes are valid for a class.
3. **The `HideRelatedPrograms` parameter on `/sale/services` is unreliable** for discovering cross-category relationships.
4. **Service Category Relationships are a business setting** — they can be changed by studio admins at any time. Don't hardcode relationship mappings.
5. **Netlify function warm containers** cache old code for up to 15 minutes after a new deploy. If you don't see your changes, wait or trigger a fresh deploy.

## Mindbody API Terminology Reference

| Business UI Term | API v6 Term | Endpoint |
|---|---|---|
| Service Category | Program | `GET /site/programs` |
| Pricing Option / Pass | Service | `GET /sale/services` |
| Client's Active Pass | ClientService | `GET /client/clientservices` |
| Class Type | ClassDescription | `GET /class/classdescriptions` |
| Session Type | SessionType | `GET /site/sessiontypes` |
