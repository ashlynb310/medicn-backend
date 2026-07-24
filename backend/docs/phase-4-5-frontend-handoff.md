# Phase 4.5 Frontend Handoff

All endpoints use the `/api/v1` base path and the shared response envelope:

```json
{
  "data": {},
  "meta": {},
  "error": null
}
```

## Host Listings

### `GET /listings/mine`

Requires `Authorization: Bearer <supabase_access_token>`. Only a user with the
`host` or `admin` role may call it. It returns the caller's non-deleted
listings, including `draft`, `pending`, `rejected`, `hidden`, and `approved`
statuses. Soft-deleted listings are excluded.

Optional query parameters:

- `status`: one of `draft`, `pending`, `approved`, `rejected`, or `hidden`
- `page`: positive integer, defaults to `1`
- `limit`: positive integer up to `100`, defaults to `20`

Example response:

```json
{
  "data": [
    {
      "id": "listing-id",
      "title": "Private room near hospital",
      "city": "Houston",
      "priceCents": 8000,
      "currency": "USD",
      "priceUnit": "day",
      "status": "pending",
      "coverPhotoUrl": null,
      "stayDurations": ["short_term"],
      "host": { "id": "host-id", "firstName": "Maya", "displayName": "Maya H" }
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 1 },
  "error": null
}
```

### `GET /listings/:id`

Public callers can retrieve only an approved, non-deleted listing. An
authenticated owner can also retrieve their own non-deleted listing before
approval, and an admin can retrieve any non-deleted listing. No response shape
changed from the existing listing-detail endpoint.

When a pending/non-public listing is requested by an unauthenticated or
non-owner user, the API returns `404 NOT_FOUND`, rather than revealing its
existence.

## Booking Decisions

### `PATCH /bookings/:id/status`

Requires `Authorization: Bearer <supabase_access_token>`. The booking's host
or an admin may change only a `requested` booking.

Request body:

```json
{ "status": "accepted" }
```

`status` must be exactly `accepted` or `rejected`. The API performs a guarded
update so concurrent/repeated decisions cannot overwrite a prior decision.
The successful response is the existing booking DTO, with the updated status.

Errors for the frontend to surface:

- `UNAUTHORIZED`: missing or malformed bearer token
- `FORBIDDEN`: caller is not the booking host or an admin
- `NOT_FOUND`: booking does not exist
- `VALIDATION_ERROR`: request body has an invalid status
- `BOOKING_STATUS_NOT_ALLOWED`: the booking is no longer `requested`, including
  a concurrent decision made just before this request

On success, the backend writes an outbox-backed transactional email for the
renter using `booking_accepted_renter` or `booking_rejected_renter`. The
frontend must not call Redis, BullMQ, or an email API directly.
