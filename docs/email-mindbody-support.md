# Email to Mindbody Developer Support

**To:** Mindbody API Support (via Developer Portal contact form)
**Subject:** Clarification on SuspendContract parameters + missing endpoints (Public API V6)

---

Dear Mindbody Developer Support,

We are integrating the Mindbody Public API V6 into our yoga studio management platform and have encountered several questions regarding contract suspension and termination endpoints. We would greatly appreciate your guidance on the following:

## 1. SuspendContract — SuspendDate parameter semantics

We are using `POST /client/suspendcontract` with the following request body:

```json
{
  "ClientId": "12345",
  "ClientContractId": 678,
  "SuspendDate": "2026-03-09",
  "Duration": 14,
  "DurationUnit": "Day",
  "SuspensionType": "Vacation"
}
```

Our intention was for `SuspendDate` to represent the **start date** of the suspension (March 9). However, the resulting suspension in Mindbody shows:

- **Start:** February 10 (the date the API call was made)
- **End:** March 9 (the value we passed as `SuspendDate`)

It appears that `SuspendDate` is being interpreted as the **end date** (or "suspend through" date) rather than the start date, and the suspension always begins from the current date. The `Duration` parameter also appears to be ignored when `SuspendDate` is provided.

**Could you please clarify:**
- What does `SuspendDate` represent — the suspension start date or end date?
- Is `Duration` ignored when `SuspendDate` is provided, or do they work together?
- Is it possible to schedule a future-dated suspension start via the API (e.g., start on March 9, end on March 23)? If so, what is the correct parameter combination?
- Are there additional parameters such as `StartDate`, `ResumeDate`, or `EndDate` that we may be missing?

## 2. Delete / Cancel a Suspension

The Mindbody admin UI provides a **"Delete"** button to remove an existing contract suspension. However, we have been unable to find a corresponding Public API V6 endpoint to programmatically delete or cancel a suspension.

We have tested the following paths without success:
- `POST /client/unsuspendcontract`
- `POST /client/resumecontract`
- `DELETE /client/suspendcontract`
- `POST /sale/unsuspendcontract`

**Is there a Public API V6 endpoint to delete or cancel an existing contract suspension?** If not, is this functionality planned for a future release?

## 3. Cancel / Revoke a Contract Termination

Similarly, the Mindbody admin UI allows staff to **cancel (revoke) a pending termination** on a contract. We have successfully used `POST /sale/terminatecontract` to terminate contracts, but we cannot find an endpoint to reverse/cancel that termination.

**Is there a Public API V6 endpoint to cancel or revoke a pending contract termination?** For example, an `ActivateContract`, `RevokeTermination`, or similar endpoint?

## Summary of Requested Endpoints

| Action | Admin UI Available? | Public API V6 Endpoint? |
|--------|-------------------|------------------------|
| Suspend contract | Yes | Yes (`POST /client/suspendcontract`) |
| Delete/cancel suspension | Yes (Delete button) | **Unknown — requesting clarification** |
| Terminate contract | Yes | Yes (`POST /sale/terminatecontract`) |
| Cancel/revoke termination | Yes | **Unknown — requesting clarification** |

Any guidance on these questions would be extremely helpful for our integration. We are happy to provide additional details, API logs, or request/response examples if needed.

Thank you for your time and support.

Best regards,
Yoga Bible / Vibro Yoga
info@yogabible.dk
Site ID: [YOUR_SITE_ID]
