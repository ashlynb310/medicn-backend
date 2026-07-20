# Phase 4.6 Admin Moderation Handoff

All endpoints use the `/api/v1` base path, require `Authorization: Bearer
<supabase_access_token>`, and require the MediCN `admin` role. Responses use
the existing `{ data, meta, error }` envelope.

## List Listings For Review

### `GET /admin/listings`

The default query is `status=pending`. Optional query parameters are:

- `status`: `draft`, `pending`, `approved`, `rejected`, or `hidden`
- `page`: positive integer, defaults to `1`
- `limit`: positive integer up to `100`, defaults to `20`

The response contains a paginated list of non-deleted listings with the host's
identity fields needed for moderation. It intentionally does not expose the
host's full profile or internal storage paths.

## Approve Or Reject A Listing

### `PATCH /admin/listings/:id/status`

Request body:

```json
{
  "status": "approved",
  "note": "Listing details reviewed."
}
```

`status` must be exactly `approved` or `rejected`; `note` is optional and has a
maximum of 1000 characters. Only a `pending` listing can be moderated. A
successful decision atomically changes the listing and records an `AdminAction`
audit row.

Errors to surface:

- `UNAUTHORIZED`: missing or malformed bearer token
- `FORBIDDEN`: caller is not an administrator
- `NOT_FOUND`: listing does not exist or was soft-deleted
- `VALIDATION_ERROR`: invalid body or query parameter
- `LISTING_STATUS_NOT_ALLOWED`: listing was already moderated or changed by a
  concurrent review

## Bootstrap The First Administrator

There is intentionally no browser API for granting the `admin` role. First,
sign in once with the intended account so it is synced to the MediCN database.
Then, from a terminal with database access, run:

```bash
npm run admin:grant -- --email admin@example.com
```

For production only, set `ALLOW_ADMIN_BOOTSTRAP=true` temporarily while running
the command, then remove it again. The command grants `admin` without removing
existing renter or host roles.
