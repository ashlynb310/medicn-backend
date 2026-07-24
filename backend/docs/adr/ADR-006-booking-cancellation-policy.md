# ADR-006: Establish the booking cancellation framework without selecting a paid-renter refund policy

- Date: 2026-07-19
- Status: Accepted

## Context

The schema has cancellation status/reasons and provider-driven cancellation behavior, but no complete actor policy or cancellation endpoint. Safe unpaid, Host, and Admin/system cases can be specified now. The paid-renter refund window, percentage, exceptions, and fees require product/legal approval and must not be invented.

## Source requirements

- [Week 2 ERD](../../../MediCN-Weekly-Report/Week2/ERD-Database-Backend.md): booking states, cancellation timestamp, and backend-controlled lifecycle.
- [Week 2 API design](../../../MediCN-Weekly-Report/Week2/API-Design.md): participant-only booking reads and Stripe webhook refund/dispute states; no user cancellation contract was approved.
- [AGENTS.md](../../AGENTS.md): refund/dispute transitions must update booking/access policy and preserve payment correctness.
- [Legal & Compliance](../../../_extracted_export/Legal%20%26%20Compliance%20cf2ddd28f07146dabd3e079984281942.md): cancellation/refund and dispute policies are draft legal action items.
- [Backend gap audit](../backend-final-gap-audit.md): user cancellation/refund lifecycle is incomplete and legally blocked in its paid portion.

## Decision

Adopt this actor/state matrix. `Cancel` always records actor, reason, and time;
`reject` remains the existing Host decision on a request.

| Current state | Renter | Host | Admin/system |
| --- | --- | --- | --- |
| `requested` | May cancel; no funds were collected, so no refund operation occurs | May reject; no funds were collected | May cancel for support/platform reason; no funds were collected |
| `accepted` | May cancel while unpaid; no funds were collected | May cancel while unpaid; no funds were collected | May cancel; refund only if funds settle concurrently |
| `payment_pending` | May cancel while unsettled; expire/void active checkout | May cancel; expire/void active checkout; full refund if payment settles concurrently | May cancel; full refund if funds settle |
| `paid` future stay | **Blocked pending paid-renter policy** | May cancel only through full-refund orchestration | May cancel for platform/provider/support cause with full refund where funds settled |
| `completed` | Terminal | Terminal | No normal transition; audited correction workflow requires a later ADR |
| `rejected` | Terminal | Terminal | No normal transition; audited correction workflow requires a later ADR |
| `cancelled` | Idempotent repeat returns existing result | Same | Same |

Additional rules:

- Cancellation releases the booking's reservation projection once cancellation and required financial action reach the safe state defined by the implementation.
- Host/Admin cancellation of paid future bookings must initiate/confirm full refund and any required transfer reversal. The system must fail closed if financial orchestration cannot be established.
- Platform/provider failure cancellation requires full refund when funds settled.
- Cancellation, full refund, and dispute revoke renter check-in-location access immediately based on authoritative booking/payment state.
- The API never treats a browser redirect as refund success.

Paid-renter alternatives for owner/legal selection:

1. **Flexible:** full refund before stay start; post-start exceptions only through support.
2. **Moderate:** full refund until an owner-defined pre-stay cutoff, then an owner-defined partial/no-refund schedule plus documented exceptions.
3. **Strict:** refund only within an initial grace period or approved exceptional circumstances, with the remainder retained according to a legally reviewed policy.

No alternative, cutoff, percentage, fee, or exception list is selected by this ADR.

## Alternatives

- **Implement all cancellations only after final paid policy:** rejected because it needlessly blocks unambiguous unpaid and provider-failure cases.
- **Let Stripe refund state alone cancel bookings:** rejected because actor/reason, inventory, location access, and Host transfer reversal are domain responsibilities.
- **Allow state reversal from cancelled/rejected/completed:** rejected until an audited support-correction workflow is approved.

## Consequences

- Phase 5.8A may implement the accepted unpaid Renter, unpaid Host, and
  Admin/system failure cases now.
- Paid-renter cancellation remains blocked.
- A durable cancellation operation/idempotency boundary and likely richer reason/audit representation are required.
- Email and inventory changes must use the existing transactional Outbox.

## Backend invariants

- Cancellation is idempotent and serialized against payment success, checkout expiry, Host decisions, refunds, disputes, and transfer release.
- Every cancellation records actor type/id (or named system process), reason, effective timestamp, and financial disposition.
- No inventory release permits a conflicting paid booking while a refund/payment race is unresolved.
- Full refund/dispute/cancelled state always removes renter exact-location access; immutable snapshots remain retained for authorized records.
- `completed`, `rejected`, and `cancelled` are terminal in normal APIs.

## API implications

- Add an idempotent cancellation command such as `POST /api/v1/bookings/:id/cancel` with a client idempotency key and an allowlisted reason.
- Keep Host rejection as the requested-booking decision endpoint rather than disguising it as cancellation.
- Responses expose booking state and a safe financial disposition, never Stripe secrets or raw provider errors.
- Paid-renter attempts return a stable policy-unavailable error until a policy is approved.

## Data/privacy implications

- Cancellation reasons must be allowlisted; free-text support notes, if later needed, are private and access-controlled.
- Preserve financial/audit records and location snapshots under retention/legal-hold policy even when access is revoked.
- Transactional emails omit exact address and sensitive payment details.

## Tests required

- Full actor/state matrix, role/ownership, terminal states, stable errors, and idempotent repeat calls.
- Concurrent cancel versus payment success, checkout expiry, refund, dispute, Host acceptance, and transfer release.
- Atomic actor/reason/audit/outbox changes and retry-safe provider idempotency.
- Inventory remains reserved during unsafe races and releases after effective cancellation.
- Exact-location revocation on cancellation/full refund/dispute, including stale-token and cached DTO cases.
- No paid-renter cancellation succeeds until an approved policy is configured/implemented.

## Unresolved questions

- Which paid-renter alternative, cutoff, percentages, grace period, exceptions, and fees apply?
- Who economically bears Host-cancelled and Admin-cancelled refunds and Stripe fees?
- Whether Host penalties, renter credits, or support overrides exist.
- Required notice/copy and governing-law treatment.

## Approval needed

The product owner approved the baseline matrix on 2026-07-19. Founder/legal
approval is still required for any paid-renter refund policy, fees, exceptions,
and liability allocation.

## Status

**Accepted.** The unpaid Renter/Host/Admin framework may be implemented. Paid
Renter self-service cancellation remains blocked pending product and legal
approval of refund timing, percentages, fees, exceptions, and liability.

## Implementation evidence

Phase 5.8A implements the accepted subset through migration
`20260729000000_add_booking_cancellation_operations`, the authenticated
`POST /api/v1/bookings/:id/cancel` command, PostgreSQL-serialized durable
operations, Outbox-to-BullMQ Checkout expiry/full-refund commands, webhook
reconciliation, transfer-reversal completion, safe booking summaries, and
unit plus PostgreSQL concurrency coverage. See
[Phase 5.8A booking cancellation](../phase-5.8A-booking-cancellation.md).

This evidence does not change the unresolved paid-Renter, fee, exception,
credit, penalty, liability, Live Mode, or provider-certification decisions.
