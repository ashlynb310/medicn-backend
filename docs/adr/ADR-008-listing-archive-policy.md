# ADR-008: Block ordinary Host archive while future active bookings exist

- Date: 2026-07-19
- Status: Accepted

## Context

Listing delete is a soft archive, but the current operation can diverge from future booking obligations. Archive must remove supply from public discovery without erasing booking records or bypassing cancellation/refund rules.

## Source requirements

- [Week 2 API design](../../../MediCN-Weekly-Report/Week2/API-Design.md): `DELETE /listings/:id` archives/deletes a Host-owned listing.
- [Week 2 ERD](../../../MediCN-Weekly-Report/Week2/ERD-Database-Backend.md): `deletedAt` is soft-delete/archive support and bookings retain listing relationships.
- [AGENTS.md](../../AGENTS.md): paid location snapshots are immutable and cancellation/refund state controls access.
- [Backend gap audit](../backend-final-gap-audit.md): archive currently ignores active bookings.

## Decision

- Host archive is a soft lifecycle transition, not row deletion.
- A listing with a future overlapping booking in `requested`, `accepted`, `payment_pending`, or `paid` cannot be archived by its Host.
- Return stable error `LISTING_ARCHIVE_BLOCKED_BY_ACTIVE_BOOKINGS` with no private booking identifiers in error details.
- The Host must reject or otherwise resolve all `requested` bookings first.
- `accepted`, `payment_pending`, and `paid` bookings require their approved cancellation/support/refund workflow; archive never performs implicit cancellation.
- A future booking means its `endDate` is after the authoritative current instant/date under ADR-009 timezone rules.
- Once unblocked, archive removes the listing from public search and new booking/inquiry creation while preserving participant booking/inquiry records.
- Paid `BookingLocationSnapshot` records remain immutable.
- Admin emergency hide is separate from Host archive, may operate despite active bookings for safety/legal reasons, and requires actor, reason, timestamp, and audit history. It does not silently cancel bookings.

## Alternatives

1. **Archive and cascade-cancel:** rejected because it invents refund/liability policy and risks financial/access races.
2. **Archive public listing but leave active bookings without warning:** rejected because it hides obligations and permits inconsistent Host behavior.
3. **Never allow archive once any historical booking exists:** rejected because terminal/past records can be retained without keeping inventory public.

## Consequences

- Archive requires a transactional active-booking check and concurrency protection against new requests.
- Admin emergency hide needs its own audited endpoint/lifecycle phase.
- Participants can continue viewing authorized historical/active bookings even if the listing is archived/hidden.

## Backend invariants

- Archive and booking creation for the same listing serialize so both cannot succeed against incompatible state.
- Active statuses are exactly `requested|accepted|payment_pending|paid`; terminal/past bookings do not alone block archive.
- Archive never deletes listing, booking, payment, snapshot, inquiry, message, transfer, or audit records.
- Public search/detail and new inquiry/booking creation exclude archived listings.
- Error responses do not reveal counts, dates, renter identities, or booking IDs to unauthorized callers.

## API implications

- `DELETE /api/v1/listings/:id` remains the Host soft-archive command.
- Add `LISTING_ARCHIVE_BLOCKED_BY_ACTIVE_BOOKINGS` to shared error contracts.
- Host listing-management DTO may expose a coarse `archiveBlocked: true` or active-obligation count only if authorization and product need are approved.
- Admin hide/restore/reapproval endpoints are separate and apply ADR-005 gates.

## Data/privacy implications

- Soft archive preserves participant and financial history.
- Host-facing errors must not expose renter identity or sensitive dates beyond data the Host is already authorized to see in booking APIs.
- Deletion/erasure requests do not reuse archive semantics; ADR-015 governs them.

## Tests required

- Each future active status blocks Host archive with stable error and no mutation.
- Resolved/past terminal bookings permit archive.
- Concurrent booking creation versus archive yields exactly one compatible outcome.
- Archive removes public search/detail and blocks new inquiry/booking creation.
- Existing participant booking reads and immutable paid snapshot remain accessible under normal authorization.
- Admin emergency hide is audited and does not cancel/refund implicitly when implemented.
- Non-owner, disabled Host, and unrelated-user behavior remains opaque and authorized correctly.

## Unresolved questions

- Whether a future `completed` anomaly should block until corrected.
- Which Admin roles/reasons may emergency-hide and what participant notifications are required.
- Whether archived listings can be restored directly or must always return to pending review.

## Approval needed

No additional approval is needed for Host archive blocking. Admin emergency-hide roles, notifications, and restoration require product owner approval before implementation.

## Status

**Accepted.** Ordinary Host archive is blocked by future active booking obligations.

## Implementation status (Phase 5.7C)

Implemented on 2026-07-19 in `ListingsService`. Archive and booking creation use
the same listing advisory lock, the archive check reloads state after the lock,
and PostgreSQL supplies the comparison instant. Unit coverage and a real
booking-versus-archive race are recorded in
[`phase-5.7C-archive-location-correctness.md`](../phase-5.7C-archive-location-correctness.md).
Admin emergency hide and restoration remain deliberately unimplemented.
