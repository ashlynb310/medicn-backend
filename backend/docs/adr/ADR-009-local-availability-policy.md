# ADR-009: Use local availability windows and reserve requested bookings

- Date: 2026-07-19
- Status: Accepted

## Context

MediCN needs a first-party local calendar that cannot invalidate bookings or
leak reservation identity. Stay dates are local civil dates, while lifecycle
jobs need an authoritative local checkout instant. External calendar sync is a
future concern.

## Decision

- Hosts manage only `available` and `blocked` windows. Reservations are a
  read-only projection derived from bookings and cannot be written directly.
- All stay and availability ranges are half-open local civil dates
  `[startDate, endDate)` with `endDate > startDate`.
- `requested`, `accepted`, `payment_pending`, and `paid` reserve dates.
  `rejected`, `cancelled`, and historical `completed` bookings do not reserve
  future inventory.
- Calendar mutation and booking creation serialize on the same PostgreSQL
  listing advisory lock and reload authoritative state after locking. A Host
  cannot block, remove, or reopen dates protected by an active booking.
- Blocked wins over available for unreserved dates. If no available window
  exists, the listing retains the legacy default-open behavior.
- Each listing persists a server-validated IANA `timeZone` and canonical
  `checkoutTime` (`HH:mm`, default `11:00`). Booking creation snapshots both;
  PostgreSQL makes those snapshots immutable. Browser timezone is never
  authoritative, and later listing edits affect only future bookings.
- A requested booking expires exactly at `createdAt + 24 hours`. Until the
  expiry transaction commits, it continues to reserve its dates.
- Public calendar responses expose merged unavailable ranges only. They never
  expose blocked-versus-reserved distinctions, renter identity, booking IDs,
  exact address, messages, payment data, or Host window IDs.
- Google, Apple, iCal, or other external synchronization is deferred.

## Consequences

- Dedicated Host/Admin CRUD and private/public projections are required.
- PostgreSQL `DATE`, immutable timezone/checkout snapshots, shared listing
  locks, and an atomic expiry transition are authoritative.
- Requested inventory is released only by reject, cancel, or committed expiry.
- Recurring calendar rules and external sync remain future decisions.

## API implications

- Host/Admin APIs manage `available|blocked` windows and view opaque reserved
  ranges.
- Public calendar APIs return unavailable ranges only.
- Listing create/update accepts validated `checkoutTime`; it is private in
  listing responses. Booking requests accept neither timezone nor checkout
  authority from the client.
- Missing, archived, cross-listing, and unrelated private resources preserve
  opaque `NOT_FOUND` behavior.

## Alternatives rejected

1. Reserving only accepted/paid bookings permits multiple competing requests
   for the same stay and changes the accepted concurrency policy.
2. Writing bookings as availability rows duplicates authoritative state and can
   drift.
3. Browser-supplied UTC instants make civil dates vulnerable to timezone and
   daylight-saving errors.
4. External calendar sync is outside the accepted backend milestone.

## Implementation evidence

Phase 5.8B migration `20260730000000_add_local_availability_timezones` and its
availability services implement local civil dates, projections, privacy, and
shared-lock correctness. Phase 5.8B2 migration
`20260731000000_add_booking_expiry_completion` adds listing checkout time,
immutable booking snapshots, and exact 24-hour request expiry through the
durable cancellation-operation and Outbox boundary.

See [Phase 5.8B](../phase-5.8B-local-availability.md) and
[Phase 5.8B2](../phase-5.8B2-request-expiry-booking-completion.md).

## Deferred

Reviews, recurrence, frontend calendar work, external synchronization, and
requested-booking auto-extension are not part of this decision.
