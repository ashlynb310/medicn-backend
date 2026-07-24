# Phase 5.8A booking cancellation framework

Phase 5.8A implements the backend-only portion of ADR-006 that has an accepted
policy. It does not select or implement paid-Renter refund percentages,
cutoffs, fees, credits, penalties, exceptions, or support overrides.

## HTTP contract

`POST /api/v1/bookings/:id/cancel` requires a Supabase bearer token and a
non-empty `Idempotency-Key` of at most 200 characters. The JSON body contains
only `reason`:

| Actor | Reasons |
| --- | --- |
| Renter | `plans_changed`, `booking_no_longer_needed`, `other` |
| Host | `property_unavailable`, `cannot_accommodate`, `safety_issue`, `other` |
| Admin | `support_resolution`, `safety_issue`, `fraud_risk`, `provider_failure`, `other` |

Actor identity and type come from the authenticated database user. The API
never accepts actor IDs, amounts, provider identifiers, payment state,
financial disposition, operation state, or free-form financial instructions.
Unrelated bookings return opaque `NOT_FOUND`.

The response contains the booking ID/state and a safe cancellation summary:
operation ID, actor type, allowlisted reason, operation status, financial
disposition, requested time, and effective time. It never contains Stripe
references, provider errors, private notes, or job data.

## Implemented state machine

| Authoritative state | Result |
| --- | --- |
| `requested` + Renter/Admin | Immediate cancellation; `no_payment_collected`; Host continues to use reject. |
| `accepted` with no settled payment | Immediate cancellation; `no_payment_collected`. |
| `payment_pending` with unsettled payment | `checkout_expiry_pending`; inventory stays reserved until authoritative expiry/failure or a later full refund. |
| Concurrent settlement after an unsettled cancellation request | Atomically promotes the operation to `refund_pending` and queues a full-refund command. The booking is not made fulfillable. |
| `paid` future stay + Host/Admin | `refund_pending`; booking and inventory remain active until the refund webhook confirms the full refund. |
| `paid` future stay + Renter | `PAID_CANCELLATION_POLICY_UNAVAILABLE`. |
| `completed` or `rejected` | `BOOKING_CANCELLATION_NOT_ALLOWED`. |
| `cancelled` | Returns the existing operation without creating new financial work. |

A pending operation immediately revokes Renter `checkInLocation`. Financially
unsafe cancellation does not release reservation inventory. Full refund,
dispute, definitive unpaid expiry/failure, or equivalent authoritative provider
state makes the cancellation effective. A transferred Host balance leaves the
operation in `transfer_reversal_pending` until the existing reversal path
confirms the complete target amount.

## Durable model and locking

Migration `20260729000000_add_booking_cancellation_operations` adds
`BookingCancellationOperation` plus actor, reason, status, and financial
disposition enums. Operations are versioned, preserve history, use a unique
`(bookingId, idempotencyKey)` boundary, and have a PostgreSQL partial unique
index permitting only one `active = true` operation per booking. Safe bounded
failure codes and operational provider references are retained where required.

All competing paths use the same PostgreSQL advisory-lock order and reload
authoritative rows after locking:

1. listing ID;
2. `booking:<bookingId>`;
3. `checkout:<bookingId>`;
4. `payment:<paymentId>`, when present;
5. `host-transfer:<hostTransferId>`, when present.

This order is shared by cancellation, Host decisions, checkout
creation/finalization/expiry, payment/refund/dispute transitions, and Host
transfer eligibility. Immediate cancellation writes the booking state,
operation, and opaque notification Outbox events in one transaction. A rollback
therefore publishes neither provider commands nor email.

## Stripe and worker orchestration

The HTTP request never waits for Stripe. It writes deterministic PostgreSQL
Outbox commands that the Outbox publisher routes to the operations BullMQ
queue:

- `booking_cancellation_checkout_expiry` expires an authoritative Checkout
  Session using a stable operation-based idempotency key;
- `booking_cancellation_full_refund` asks Stripe for exactly the stored payment
  amount less the stored amount already refunded, using a stable idempotency
  key;
- `booking_cancellation_recovery` finds a bounded set of active operations and
  restores missing work after interruption.

Provider request acceptance does not mean financial completion. Stripe webhook
reconciliation remains authoritative. Retryable provider failures retain the
active operation and inventory and expose a bounded failure code to operations,
not raw provider content. Cancellation email jobs contain only opaque IDs; the
recipient, listing title, and approved copy are resolved after commit. Unpaid
copy says: “The booking was cancelled. No payment was collected.”

## Stable errors

- `PAID_CANCELLATION_POLICY_UNAVAILABLE`
- `BOOKING_CANCELLATION_NOT_ALLOWED`
- `CANCELLATION_ALREADY_IN_PROGRESS`
- `PAYMENT_STATE_CHANGED`
- `PAYMENT_PROVIDER_UNAVAILABLE`
- `VALIDATION_ERROR`
- `FORBIDDEN`
- `NOT_FOUND`

## Operations and privacy

Run `worker:outbox`, `worker:operations`, and `worker:email`. The existing
operations heartbeat covers cancellation work. Admin operations status includes
bounded counts by cancellation operation status; it exposes no booking, user,
payment, or provider identifiers.

Redis/BullMQ and Outbox payloads contain cancellation operation IDs, booking or
payment IDs where the consumer needs them, and an allowlisted operation type.
They do not contain addresses, coordinates, email addresses, message bodies,
payment credentials, provider secrets, raw Stripe errors, or private notes.
Logs follow the same rule.

## Deferred and prohibited scope

Paid-Renter cancellation remains policy-blocked. Production also still requires
Stripe Test Mode/Connect certification, webhook and worker deployment drills,
monitoring, legal approval of refund/fee/liability economics, and operational
reconciliation procedures. This phase made no frontend change and no live
provider call; it is not production-readiness evidence.
