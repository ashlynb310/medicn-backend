# Phase 5.7C listing archive and location-access correctness

Date: 2026-07-19  
Scope: backend-only implementation of ADR-007 and ADR-008

## Listing archive contract

`DELETE /api/v1/listings/:id` remains a soft archive. It sets the listing to
`archived` with `deletedAt` and does not delete related bookings, payments,
location snapshots, inquiries, messages, transfers, or audit history.

The archive command and booking creation use the same PostgreSQL transaction
advisory lock for a listing:

```sql
pg_advisory_xact_lock(hashtextextended(listingId, 0))
```

After acquiring the lock, archive reloads the listing and obtains the current
instant from PostgreSQL. It refuses the transition when a booking whose
`endDate` is later than that instant has one of exactly these statuses:
`requested`, `accepted`, `payment_pending`, or `paid`.

The refusal is HTTP 409 with stable code
`LISTING_ARCHIVE_BLOCKED_BY_ACTIVE_BOOKINGS`. Its `details` value is empty and
does not expose booking IDs, counts, dates, renter identity, or payment data.
The ordinary Admin DELETE path follows the same rule. This phase does not add
an Admin emergency-hide override.

Once archived, the listing is absent from public detail/search and cannot
receive new bookings or inquiries. Existing authorized participant booking
and inquiry reads continue to work, and historical rows remain intact.

## Renter check-in-location contract

Renter `checkInLocation` is derived from the immutable
`BookingLocationSnapshot`; the live listing location is never a renter
fallback. Access requires all of the following:

- the caller owns the renter side of the booking;
- booking status is `paid` or `completed`;
- `cancelledAt` is null;
- an immutable location snapshot exists;
- the current authoritative payment attempt is `paid` or
  `partially_refunded`;
- that payment is not `refunded` or `disputed`; and
- cumulative refunded cents remain below the payment amount.

A partial refund alone therefore retains access for a fulfillable stay.
Cancellation, full refund, cumulative full refund, dispute, missing snapshot,
unpaid state, or unrelated ownership fails closed. An older paid attempt cannot
override the latest authoritative refunded/disputed attempt. Booking detail is
read in a PostgreSQL repeatable-read transaction so booking, current payment,
and snapshot state cannot be mixed across an atomic transition.

Existing Host/Admin operational access is unchanged and remains separate from
the renter entitlement.

## Verification evidence

Unit tests enumerate every archive-blocking status, terminal and past cases,
owner/Admin behavior, disabled and unrelated callers, partial/full/cumulative
refund behavior, cancellation, dispute, current-payment ordering, missing
snapshot, and anonymous access.

The gated PostgreSQL suite additionally races booking creation against archive,
proves that exactly one compatible outcome commits, verifies historical row
survival and archived-listing invisibility, and races a location read against an
atomic refund/cancellation transition. No provider call is part of these tests.

Final verification passed Prisma generation/validation, API typecheck/lint/build,
and the shared-types build. The normal API run passed 39 suites / 312 tests,
with 11 gated suites / 21 tests skipped (333 discovered). With both established
PostgreSQL and Redis flags enabled, all 50 suites / 333 tests passed.

## Explicitly deferred

This phase does not implement cancellation or refund initiation, Admin
emergency hide, restoration/reapproval, calendar synchronization, booking
completion, reviews, or frontend behavior. Refund economics and eligibility
remain governed by separate product/legal decisions.
