# ADR-007: Base check-in-location access on booking fulfillability, not partial-refund amount alone

- Date: 2026-07-19
- Status: Accepted

## Context

Exact check-in location is a sensitive fulfillment entitlement. Current policy correctly revokes it after cancellation, full refund, or dispute, but the behavior for a partial refund is ambiguous. A partial refund may be a service adjustment while the stay remains active, or it may accompany termination.

## Source requirements

- [AGENTS.md](../../AGENTS.md): only the authorized renter of a currently paid/completed booking receives exact location; revoked reservations fail closed.
- [Week 2 ERD](../../../MediCN-Weekly-Report/Week2/ERD-Database-Backend.md): booking and payment lifecycle states are separate.
- [Backend gap audit](../backend-final-gap-audit.md): partial-refund exact-location behavior required a product decision.

## Decision

- A partial refund alone does not revoke check-in-location access when the booking remains `paid` or legitimately `completed`, active, undisputed, and fulfillable.
- Cancellation, full refund, or dispute revokes renter access.
- A partial refund that terminates the stay must also transition the booking to `cancelled` through the cancellation workflow; that booking transition revokes access.
- Authorization uses authoritative booking state plus authoritative aggregate payment/refund/dispute state, not refund amount alone and not historical `paidAt` alone.
- For an active booking, both `paid` and `partially_refunded` payment states can establish settled-payment eligibility, subject to the revocation conditions above.
- Host/Admin operational access remains separately authorized and audited; this ADR does not make exact location public.

## Alternatives

1. **Revoke on any refund:** rejected because a goodwill/price-adjustment refund does not necessarily terminate fulfillment.
2. **Never revoke for partial refunds:** rejected because a termination represented only as a partial refund would leave access open; termination must also cancel the booking.
3. **Authorize by net amount threshold:** rejected because no amount reliably represents whether a stay remains fulfillable.

## Consequences

- Booking serialization must recognize `partially_refunded` as settled for a still-fulfillable booking.
- Refund orchestration must explicitly state whether the stay continues; financial amount cannot silently decide access.
- Existing immutable `BookingLocationSnapshot` data is preserved even when renter access is revoked.

## Backend invariants

- Renter access requires participant ownership, booking `paid|completed`, an immutable snapshot, a settled `paid|partially_refunded` payment, and no cancellation/full refund/dispute.
- Booking/payment authorization is evaluated on every protected read; no browser cache or old token grants entitlement.
- Full refund/dispute/cancellation revocation is monotonic unless a later audited correction policy explicitly says otherwise.
- A terminating partial refund and booking cancellation are committed/reconciled as one domain operation.

## API implications

- `checkInLocation` remains optional in authorized booking detail.
- Refund commands/events must carry a domain disposition such as `stay_continues` or `stay_terminated`; browsers cannot supply the authoritative final disposition.
- A partially refunded, active booking continues returning exact location only to the authorized renter/Host/Admin.
- No refund amount or provider reason is exposed in public listing APIs.

## Data/privacy implications

- Access revocation does not delete the snapshot because operational, dispute, and record-retention needs may continue.
- Exact address and coordinates remain excluded from email, queue payloads, logs, metrics, and public DTOs.
- Retention and deletion remain governed by ADR-015 and future legal approval.

## Tests required

- Partial refund with active `paid` booking retains renter access.
- Partial refund plus cancellation revokes access.
- Full refund, dispute, cancellation, unpaid state, unrelated user, and missing snapshot fail closed.
- Multiple partial refunds remain monotonic; cumulative full refund revokes access.
- Out-of-order partial/full refund events cannot restore revoked access.
- Concurrent booking cancellation and refund serialization produces one authoritative result.
- Host/Admin operational access and public/anonymous non-access remain unchanged.

## Unresolved questions

- Which service-adjustment reasons are allowed to produce a continuing-stay partial refund?
- Whether a post-stay partial refund on `completed` changes review/moderation behavior.
- The support UI and audit detail needed to declare `stay_continues` versus `stay_terminated`.

## Approval needed

No additional approval is needed for this access-control rule. Refund eligibility and economics remain separate decisions under ADR-006 and ADR-013.

## Status

**Accepted.** Partial refund does not revoke access by itself; authoritative loss of fulfillability does.

## Implementation status (Phase 5.7C)

Implemented on 2026-07-19 in `BookingsService`. Renter access now uses the
latest payment attempt, immutable location snapshot, cancellation state, and
cumulative refunded amount inside a repeatable-read transaction. Focused unit
coverage and real PostgreSQL transition-race coverage are recorded in
[`phase-5.7C-archive-location-correctness.md`](../phase-5.7C-archive-location-correctness.md).
Refund initiation and stay-disposition workflows remain outside this phase.
