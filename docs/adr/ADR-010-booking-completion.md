# ADR-010: Complete paid bookings after local checkout through an idempotent scheduler

- Date: 2026-07-19
- Status: Accepted

## Context

`completed` is an established booking state, but service fulfillment must stay
distinct from payment, Stripe transfer, bank payout, and dispute settlement.
The operations scheduler needs an exact, timezone-safe transition policy and
clear financial blockers.

## Decision

- Normal completion is automatic only; no Host, Renter, or Admin completion
  endpoint is introduced.
- A booking becomes eligible exactly two hours after its exclusive `endDate`
  at its immutable local `checkoutTime` and IANA `timeZone` snapshots.
  PostgreSQL timezone conversion and database time are authoritative.
- Listing checkout time is strict `HH:mm`, defaults/backfills to `11:00`, and
  affects future snapshots only.
- Only `paid` bookings may normally complete. Their current payment must be
  `paid`, or `partially_refunded` with a positive fulfillable remainder.
- Cancellation (including a pending active cancellation), pending/full refund,
  total partial refund, unresolved dispute, cancelled state, or missing
  fulfillable payment blocks completion. A settled non-total partial refund is
  allowed.
- Completion changes only booking lifecycle metadata and atomically inserts
  participant notification records in PostgreSQL Outbox. It does not mutate a
  payment, refund, transfer, payout, address snapshot, or provider object.
- Completion, cancellation, checkout, payment/refund/dispute, and transfer
  paths use the established advisory-lock order: listing, booking, checkout,
  payment, transfer. The recurring scan is bounded and repeated/concurrent
  execution is idempotent.
- `completedAt` and `completionSource` are participant/Admin-only lifecycle
  fields. Notification payloads contain opaque IDs only; the email worker
  reloads authorized server state.

## Consequences

- Completion may coexist with later provider reconciliation; it is evidence of
  elapsed service time, not evidence of bank payout or a closed dispute window.
- Scheduler health, retry/failure counts, duration metrics, stable job identity,
  and shutdown use the existing operations BullMQ boundary.
- A blocked booking remains `paid` for later retry after authoritative financial
  state is settled.
- Reviews are not activated by this ADR or Phase 5.8B2.

## Alternatives rejected

1. Manual participant confirmation creates disagreement and abandonment states
   without an accepted support policy.
2. Completing at transfer release conflates fulfillment with money movement.
3. UTC midnight ignores listing-local civil dates.
4. Inferring completion at read time cannot provide durable idempotency,
   notifications, or lifecycle audit metadata.

## API and privacy implications

- No lifecycle command endpoint is added.
- Authorized booking DTOs may expose checkout, eligibility-derived lifecycle
  timestamps, and sources; public listing/calendar APIs expose none of them.
- Emails omit exact address and payment/provider details. Queue, Outbox, logs,
  and metrics contain no free text, secrets, or sensitive booking content.
- Unrelated booking reads and decision attempts remain opaque `NOT_FOUND`.

## Implementation evidence

Phase 5.8B2 migration `20260731000000_add_booking_expiry_completion`,
`BookingLifecycleService`, and the stable
`medicn:booking-completion:v1` operations schedule implement this decision.
Unit and real-PostgreSQL tests cover exact boundaries, multiple IANA zones and
DST transition dates, blockers, partial refunds, rollback, concurrent runs,
opaque Outbox payloads, scheduler identity, and clean shutdown.

See [Phase 5.8B2](../phase-5.8B2-request-expiry-booking-completion.md).

## Deferred

Reviews, support/damage cases, participant error reporting, Admin correction or
reopening, frontend work, and external calendar synchronization remain separate
decisions and are not implemented.
