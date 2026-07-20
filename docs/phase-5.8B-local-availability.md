# Phase 5.8B local availability management

Phase 5.8B implements ADR-009's backend-only local calendar policy. Request
expiry and booking completion were intentionally absent from this phase and
were subsequently implemented by Phase 5.8B2. Reviews, frontend calendar UI,
recurring rules, and external calendar synchronization remain out of scope.

## Date and timezone contract

Stay and availability ranges are half-open local civil dates:
`[startDate, endDate)`. HTTP dates must be real `YYYY-MM-DD` values; timestamps,
offsets, and browser-local instants are rejected. PostgreSQL stores
`ListingAvailability.startDate/endDate` and `Booking.startDate/endDate` as
`DATE`.

Every new listing requires a canonical IANA `timeZone` such as
`America/Chicago`. The server validates and persists it; a booking request does
not accept a timezone and copies the locked listing value to immutable
`Booking.timeZone`. A database trigger rejects later booking-timezone changes.
The migration backfills legacy listing and booking rows with `UTC`, preserving
the old UTC civil-date interpretation without guessing a location from a
browser or city string. Hosts should confirm legacy listing timezones before
later time-of-day lifecycle work is enabled.

## HTTP contracts

All endpoints are under `/api/v1`.

| Method and path | Authorization | Contract |
| --- | --- | --- |
| `GET /listings/:id/availability?page=1&limit=50` | Listing Host or Admin | Paginated Host-managed windows. |
| `POST /listings/:id/availability` | Listing Host or Admin | Create one `available` or `blocked` range. |
| `PATCH /listings/:id/availability/:windowId` | Listing Host or Admin | Change provided range/status fields. |
| `DELETE /listings/:id/availability/:windowId` | Listing Host or Admin | Delete one Host-managed window. |
| `GET /listings/:id/availability/calendar?startDate=...&endDate=...` | Listing Host or Admin | Bounded windows plus merged opaque `reserved` ranges. |
| `GET /listings/:id/calendar?startDate=...&endDate=...` | Public approved listing | Bounded merged `unavailable` ranges only. |

Mutation input contains only `startDate`, `endDate`, and `status` where status
is `available|blocked`. There is no writable `reserved` or `booked` status.
Calendar reads cover at most 366 days. Private IDs use opaque `NOT_FOUND` for
missing, archived, unrelated, or cross-listing resources.

The public response contains only:

```json
{
  "timeZone": "America/Chicago",
  "range": { "startDate": "2027-01-01", "endDate": "2027-02-01" },
  "unavailable": [
    { "startDate": "2027-01-10", "endDate": "2027-01-15" }
  ]
}
```

It never distinguishes blocked from reserved dates and never contains booking
IDs/statuses, renter identity, exact address, messages, payment data, or Host
window IDs. Raw availability was removed from anonymous listing detail; clients
use this public calendar contract instead.

## Effective availability and reservation projection

- `requested`, `accepted`, `payment_pending`, and `paid` bookings reserve their
  ranges.
- `rejected` and `cancelled` release their ranges.
- `completed` rows are historical and do not reserve future dates.
- If no `available` rows exist, the listing is open except for blocks and
  reservations, preserving the prior default-open behavior.
- If `available` rows exist, their union defines open dates.
- `blocked` wins over `available` for unreserved dates.
- Adjacent ranges meet without overlap because end dates are exclusive.
- Public listing date search applies the same available-union, block, and
  reservation rules.

Bookings remain the only reservation source. Host calendar writes never create
or mutate booking/reservation rows.

## Transactions and safe edits

Booking creation, listing/calendar mutation, listing archive, and cancellation
use the same PostgreSQL advisory lock keyed by listing ID. After taking the
lock, calendar mutation reloads the listing, ownership, windows, and reserving
bookings. A change is rejected if it would block or remove effective
availability from any protected reservation. A booking-versus-block race can
therefore commit only one side; the loser receives a stable conflict or
availability error.

The legacy `PATCH /listings/:id` bulk `availability` replacement is rejected
with `AVAILABILITY_DEDICATED_ENDPOINT_REQUIRED`, ensuring all post-creation
calendar writes use the booking-safe transaction. Initial available windows may
still be supplied while creating a brand-new listing because no booking can yet
exist.

## Stable errors

- `AVAILABILITY_RANGE_INVALID`
- `AVAILABILITY_CONFLICTS_WITH_RESERVATION`
- `AVAILABILITY_DEDICATED_ENDPOINT_REQUIRED`
- `CALENDAR_RANGE_TOO_LARGE`
- `LISTING_TIMEZONE_INVALID`
- `BOOKING_NOT_AVAILABLE`
- `VALIDATION_ERROR`
- `FORBIDDEN`
- `NOT_FOUND`

## Follow-on lifecycle work

Phase 5.8B2 accepts the separate lifecycle decisions: requested bookings expire
at `createdAt + 24 hours`, listing checkout time defaults to `11:00`, and paid
bookings may complete two hours after their snapshotted local checkout instant.
See [Phase 5.8B2](phase-5.8B2-request-expiry-booking-completion.md). Review
eligibility, recurrence, frontend work, and external iCal/Google/Apple sync
remain separate and unimplemented.
