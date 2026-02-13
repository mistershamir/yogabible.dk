# Mindbody API Support — Contract Suspension & Termination

**Status:** RESOLVED (2026-02-13) — Response from Mindbody Support (Rachel)

---

## 1. SuspendContract — Correct Parameter: `SuspensionStart`

### Our original bug
We were using `SuspendDate` which Mindbody treated as the end/through date.
Suspensions always started immediately regardless of the date we passed.

### Mindbody's confirmed answer
The correct parameter is **`SuspensionStart`** (NOT `SuspendDate`).

**Parameters:**
- `SuspensionStart` (optional) — Start date of suspension. Defaults to today if omitted.
- `Duration` — How long the suspension lasts (number).
- `DurationUnit` — Unit for duration (e.g., `"Day"`).
- `OpenEnded` — If `true`, Duration/DurationUnit are ignored.
- `SuspensionType` — e.g., `"Vacation"`. May auto-apply Duration/Fee from site config.
- `SuspensionFee` — Optional fee for suspension.
- `SuspensionNotes` — Optional notes.

**Formula:** `SuspensionStart + Duration(DurationUnit) = Resume date`

**Correct request example:**
```json
{
  "ClientId": "12345",
  "ClientContractId": 678,
  "SuspensionStart": "2026-03-09T00:00:00",
  "Duration": 14,
  "DurationUnit": "Day",
  "SuspensionType": "Vacation"
}
```
Result: Start March 9, End March 23.

**Future-dated suspensions:** YES, supported via `SuspensionStart` as a future DateTime.

### Why our original code failed
We sent `SuspendDate` which is not the correct parameter name. Mindbody likely
ignored it (unrecognized param) and defaulted to starting today. The "end date"
we saw was probably the Duration calculation from today's date.

---

## 2. Delete / Cancel a Suspension

**Answer: NO API endpoint exists.**

- Admin UI supports deleting suspensions.
- Public API v6 has NO endpoint to delete or remove an existing suspension.
- No `unsuspendcontract`, `resumecontract`, or delete suspension endpoint.

---

## 3. Cancel / Revoke a Contract Termination

**Answer: NO API endpoint exists.**

- `POST /sale/terminatecontract` — supported for terminating.
- No API endpoint exists to reverse or revoke a pending termination.
- Admin UI supports it, Public API does not.

---

## Summary

| Action | Admin UI | Public API V6 |
|--------|----------|---------------|
| Suspend contract | Yes | Yes (`POST /client/suspendcontract` with `SuspensionStart`) |
| Delete/cancel suspension | Yes | **No** |
| Terminate contract | Yes | Yes (`POST /sale/terminatecontract`) |
| Cancel/revoke termination | Yes | **No** |

---

## Impact on our implementation

1. **Pause (suspend):** Now works correctly with `SuspensionStart` + `Duration` + `DurationUnit`.
   Future-dated pauses are supported.
2. **Cancel pause:** Users must contact the studio (email). Cannot be done via API.
3. **Cancel termination:** Users must contact the studio (email). Cannot be done via API.
