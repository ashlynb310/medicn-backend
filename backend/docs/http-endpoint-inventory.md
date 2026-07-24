# HTTP endpoint inventory and authorization/error matrix

Generated/audited: 2026-07-19  
Base path: `/api/v1`  
Inventory: **77 operations across 69 paths and 18 controllers**

The OpenAPI operation count is checked independently. `docs/openapi.json`
contains these 77 REST operations; Socket.IO `/messaging` is intentionally not
an HTTP/OpenAPI operation.

## Matrix legend

- `A`: allowed when request data and resource state are valid.
- `U`: `401 UNAUTHORIZED` before private state is loaded.
- `D`: `403 ACCOUNT_DISABLED` at the shared authenticated-user boundary.
- `F`: intentional `403 FORBIDDEN`; the endpoint/role policy is public and
  revealing that the role cannot perform the operation is safe.
- `N`: opaque `404 NOT_FOUND` for missing or unrelated private resources.
- `E`: `403 EMAIL_NOT_VERIFIED` where verified email is an accepted prerequisite.
- `P`: authenticated but subject to stable workflow policy/state errors (for
  example identity required, cancellation unavailable, or status conflict).
- `S`: provider credential/signature boundary; Supabase user roles do not grant access.
- `M`: dedicated metrics bearer token; Supabase user roles do not grant access.

“Host owner” means the listing/booking Host for the addressed resource.
“Participant” means the booking Renter/Host or inquiry Renter/Host as applicable.
An Admin is not silently treated as a participant; Admin access is an explicit
operational policy. An unverified user otherwise retains self/profile reads and
draft editing; `E` applies only to flows whose accepted policy requires email
verification.

## Access-class matrix

| Access class | Anonymous | Renter | Host owner | Unrelated Host | Participant | Admin | Disabled | Unverified email |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `PUBLIC` | A | A | A | A | A | A | A (no auth lookup) | A |
| `OPTIONAL_LISTING` | A for approved | A for approved | A incl. owned private | A for approved, otherwise N | A for approved | A incl. private | D when token supplied | A |
| `AUTH_SELF` | U | A | A | A | A | A | D | A |
| `HOST_COLLECTION` | U | F | A | A (own collection) | role-dependent | A | D | A; publish/approval prerequisites remain P/E |
| `LISTING_OWNER` | U | N | A | N | N unless owner | A | D | A for draft edits; approval remains E |
| `BOOKING_CREATE` | U | A after E/identity/availability | F | F | Renter only | F unless also Renter | D | E |
| `BOOKING_PARTICIPANT` | U | A if participant, else N | A if participant, else N | N | A | A | D | A/P by command |
| `BOOKING_HOST_DECISION` | U | N | A | N | Host participant only | A | D | A/P |
| `INQUIRY_CREATE` | U | A after E/identity/listing checks | F/self-inquiry F | F | Renter only | F unless also Renter | D | E |
| `INQUIRY_PARTICIPANT` | U | A if participant, else N | A if participant, else N | N | A | A | D | A |
| `CONNECT_HOST` | U | F | A | A for self only | role-dependent | A | D | A/P |
| `HEALTHCARE_SUBJECT` | U | A for own records | A for own records | N for another subject | own only | own flow or Admin endpoint | D | A/P |
| `UPLOAD_OWNER` | U | A for own profile/assets | A for own listing/profile/assets | N | own only | A where service policy permits | D | A |
| `ADMIN` | U | F | F unless Admin | F | F unless Admin | A | D | A (Admin target policies may return E) |
| `PROVIDER_WEBHOOK` | S | S | S | S | S | S | S | S |
| `METRICS` | M/404 if disabled | M | M | M | M | M | M | M |

## Complete operation inventory

Rate policy names refer to the quotas below. `—` means the endpoint has no
Phase 5.9B distributed limiter because it is either a normal read/write, a
provider-retry route, or protected by another bounded workflow.

| # | Method and path | Access class | Rate policy | Primary private/error rule |
| ---: | --- | --- | --- | --- |
| 1 | `GET /admin/healthcare-verifications` | ADMIN | — | Non-Admin F; response is redacted summary only |
| 2 | `GET /admin/healthcare-verifications/{id}` | ADMIN | — | Missing N; no storage path/signed URL/raw evidence |
| 3 | `PATCH /admin/healthcare-verifications/{id}` | ADMIN | — | Missing N; final/conflict P; audit note bounded/redacted |
| 4 | `POST /admin/healthcare-verifications/{id}/evidence/{evidenceId}/view-url` | ADMIN | — | Missing N; URL ≤60 seconds and audited, never persisted |
| 5 | `GET /admin/listings` | ADMIN | — | Non-Admin F; bounded page |
| 6 | `PATCH /admin/listings/{id}/status` | ADMIN | — | Missing N; target email/identity/location policy E/P |
| 7 | `GET /admin/operations/commands` | ADMIN | — | Redacted bounded operational summaries |
| 8 | `GET /admin/operations/commands/{id}` | ADMIN | — | Missing N; no raw provider/worker errors |
| 9 | `GET /admin/operations/host-transfers` | ADMIN | — | Transfer is not bank payout; provider fields omitted |
| 10 | `GET /admin/operations/host-transfers/{id}` | ADMIN | — | Missing N; only allowlisted operational provider reference |
| 11 | `GET /admin/operations/job-executions` | ADMIN | — | Worker identity/raw stack/provider payload omitted |
| 12 | `GET /admin/operations/job-executions/{id}` | ADMIN | — | Missing N; sanitized failure classification only |
| 13 | `POST /admin/operations/job-executions/{id}/requeue` | ADMIN | admin_command | Missing/unsafe N/P; bounded reason + idempotency key |
| 14 | `GET /admin/operations/job-executions/failed` | ADMIN | — | Eligible/dead-letter inspection, redacted |
| 15 | `GET /admin/operations/payments` | ADMIN | — | No payment methods/secrets/raw errors |
| 16 | `GET /admin/operations/payments/{id}` | ADMIN | — | Missing N; explicitly allowlisted provider references only |
| 17 | `POST /admin/operations/reconciliation/host-transfers` | ADMIN | admin_command | Bounded explicit command; no request payload/queue injection |
| 18 | `POST /admin/operations/reconciliation/payments` | ADMIN | admin_command | Bounded explicit command; no provider call on read |
| 19 | `GET /admin/operations/status` | ADMIN | — | Safe counts/status only |
| 20 | `GET /auth/me` | AUTH_SELF | — | Current user only; identity and healthcare remain separate |
| 21 | `POST /auth/sync` | AUTH_SELF | — | Cannot self-assign Admin; disabled remains D |
| 22 | `GET /bookings` | BOOKING_PARTICIPANT | — | Participant-scoped; Admin explicit; page ≤100 |
| 23 | `POST /bookings` | BOOKING_CREATE | — | E + approved identity; dates ≤366 days |
| 24 | `GET /bookings/{id}` | BOOKING_PARTICIPANT | — | Unrelated/missing N; exact address only under accepted access rules |
| 25 | `POST /bookings/{id}/cancel` | BOOKING_PARTICIPANT | checkout_or_cancel | Unrelated N; idempotency required; paid-Renter policy P |
| 26 | `GET /bookings/{id}/payment-summary` | BOOKING_PARTICIPANT | — | Unrelated N; safe lifecycle only, no methods/bank/raw payload |
| 27 | `PATCH /bookings/{id}/status` | BOOKING_HOST_DECISION | — | Unrelated N; stable state conflict P |
| 28 | `GET /connect/account` | CONNECT_HOST | — | Self/Admin target only; no bank details |
| 29 | `POST /connect/account` | CONNECT_HOST | — | Hosted provider flow only; no bank/tax credentials |
| 30 | `POST /connect/management-link` | CONNECT_HOST | — | Self/Admin target only; transient provider URL |
| 31 | `POST /connect/onboarding-link` | CONNECT_HOST | — | Self/Admin target only; transient provider URL |
| 32 | `GET /health` | PUBLIC | — | Safe service/timestamp only |
| 33 | `GET /health/live` | PUBLIC | — | Always liveness semantics; no dependency secrets |
| 34 | `GET /health/ready` | PUBLIC | — | 503 on required dependency failure; safe summaries |
| 35 | `POST /healthcare-verifications` | HEALTHCARE_SUBJECT | — | Approved identity prerequisite; one active submission |
| 36 | `POST /healthcare-verifications/{id}/evidence/{evidenceId}/complete` | HEALTHCARE_SUBJECT | — | Another subject N; object size/type checked server-side |
| 37 | `POST /healthcare-verifications/{id}/evidence/upload-intents` | HEALTHCARE_SUBJECT | upload_intent | Another subject N; JPEG/PNG/WebP, ≤3, ≤10 MiB direct upload |
| 38 | `POST /healthcare-verifications/{id}/submit` | HEALTHCARE_SUBJECT | — | Another subject N; sanitized evidence required |
| 39 | `POST /healthcare-verifications/{id}/withdraw` | HEALTHCARE_SUBJECT | — | Another subject N; durable deletion request |
| 40 | `GET /healthcare-verifications/me` | HEALTHCARE_SUBJECT | — | Subject-only redacted history |
| 41 | `GET /identity/verifications/current` | AUTH_SELF | — | Allowlisted status/guidance; no provider payload/document |
| 42 | `POST /identity/verifications/session` | AUTH_SELF | identity_session | Hosted session only; provider secret/token withheld |
| 43 | `GET /inquiries` | INQUIRY_PARTICIPANT | — | Actor-scoped summaries; page ≤100 |
| 44 | `GET /inquiries/{id}` | INQUIRY_PARTICIPANT | — | Unrelated/missing N; `afterSequence` ≥0, limit ≤100 |
| 45 | `POST /inquiries/{id}/archive` | INQUIRY_PARTICIPANT | — | Unrelated/missing N; only caller state changes |
| 46 | `POST /inquiries/{id}/close` | INQUIRY_PARTICIPANT | — | Unrelated/missing N; idempotent close |
| 47 | `POST /inquiries/{id}/messages` | INQUIRY_PARTICIPANT | message_send | Unrelated/missing N; ≤4,000 code points; contact blocked |
| 48 | `POST /inquiries/{id}/read` | INQUIRY_PARTICIPANT | — | Unrelated/missing N; monotonic bounded cursor |
| 49 | `GET /listings` | PUBLIC | public_search | Approved active listings only; page ≤100, dates ≤366 days |
| 50 | `POST /listings` | HOST_COLLECTION | — | Renter F; exact location remains private |
| 51 | `DELETE /listings/{id}` | LISTING_OWNER | — | Unrelated/missing N; active obligation conflict P |
| 52 | `GET /listings/{id}` | OPTIONAL_LISTING | — | Public approved projection; private owner/Admin projection |
| 53 | `PATCH /listings/{id}` | LISTING_OWNER | — | Unrelated/missing N; protected location/calendar conflicts P |
| 54 | `GET /listings/{id}/availability` | LISTING_OWNER | — | Unrelated/missing N; reservation rows not writable |
| 55 | `POST /listings/{id}/availability` | LISTING_OWNER | — | Unrelated/missing N; reservation conflict P |
| 56 | `DELETE /listings/{id}/availability/{windowId}` | LISTING_OWNER | — | Missing/unrelated window N; reservation conflict P |
| 57 | `PATCH /listings/{id}/availability/{windowId}` | LISTING_OWNER | — | Missing/unrelated window N; reservation conflict P |
| 58 | `GET /listings/{id}/availability/calendar` | LISTING_OWNER | — | Unrelated/missing N; reservations opaque |
| 59 | `GET /listings/{id}/calendar` | PUBLIC | public_calendar | Approved only; unavailable ranges only; ≤366 days |
| 60 | `POST /listings/{id}/photos` | LISTING_OWNER | — | Unrelated/missing N; processed issued asset only |
| 61 | `POST /listings/{listingId}/inquiries` | INQUIRY_CREATE | inquiry_create | E + approved identity; archived/private listing N |
| 62 | `DELETE /listings/{listingId}/photos/{photoId}` | LISTING_OWNER | — | Unrelated/missing photo/listing N |
| 63 | `PATCH /listings/{listingId}/photos/{photoId}/order` | LISTING_OWNER | — | Unrelated/missing N; display order ≤10,000 |
| 64 | `GET /listings/mine` | HOST_COLLECTION | — | Renter F; own listings only; page ≤100 |
| 65 | `GET /metrics` | METRICS | — | 404 disabled; exact dedicated bearer token otherwise |
| 66 | `POST /payments/checkout-session` | BOOKING_PARTICIPANT | checkout_or_cancel | Renter participant only; E/identity/payout readiness P |
| 67 | `DELETE /uploads/{assetId}` | UPLOAD_OWNER | — | Unrelated/missing/healthcare asset N |
| 68 | `GET /uploads/{intentId}` | UPLOAD_OWNER | — | Unrelated/missing/healthcare asset N |
| 69 | `POST /uploads/{intentId}/complete` | UPLOAD_OWNER | — | Unrelated/missing N; provider object bounds checked |
| 70 | `POST /uploads/presigned-url` | UPLOAD_OWNER | upload_intent | Direct-to-storage only; no API media proxy |
| 71 | `GET /users/{id}` | PUBLIC | — | Disabled/missing user N; public allowlist only |
| 72 | `PATCH /users/me` | AUTH_SELF | — | External profile-photo URLs rejected |
| 73 | `DELETE /users/me/profile-photo` | UPLOAD_OWNER | — | Current user only; healthcare storage unreachable |
| 74 | `POST /webhooks/brevo/transactional` | PROVIDER_WEBHOOK | — | Credential first; ≤500 events; retry/dedup safe |
| 75 | `POST /webhooks/stripe` | PROVIDER_WEBHOOK | — | Signature over exact raw bytes first; retry/dedup safe |
| 76 | `POST /webhooks/veriff/decisions` | PROVIDER_WEBHOOK | — | Client + raw HMAC first; monotonic/deduplicated |
| 77 | `POST /webhooks/veriff/events` | PROVIDER_WEBHOOK | — | Client + raw HMAC first; monotonic/deduplicated |

## Distributed rate policies

All Redis keys are `${REDIS_KEY_PREFIX}:rate:v1:<policy>:<sha256-subject>`.
The raw bearer token, email, message, resource body, and address never enter the
key or a log. Authenticated requests use a one-way token-derived subject before
the service hashes it again; anonymous requests use the explicitly trusted
Express client IP after `TRUST_PROXY_HOPS` is applied.

| Policy | Limit/window | Failure policy | Applied operations |
| --- | --- | --- | --- |
| `public_search` | 120 / 60 s | fail open | public listing search |
| `public_calendar` | 120 / 60 s | fail open | public calendar projection |
| `inquiry_create` | 10 / 60 s | fail closed | inquiry creation |
| `message_send` | 60 / 60 s | fail closed | REST message send |
| `upload_intent` | 20 / 60 s | fail closed | generic and healthcare presigned intents |
| `identity_session` | 5 / 10 min | fail closed | hosted identity session creation |
| `checkout_or_cancel` | 10 / 60 s | fail closed | Checkout and cancellation requests |
| `admin_command` | 20 / 60 s | fail closed | requeue and both reconciliation commands |
| `websocket_connect` | 20 / 60 s | fail closed | authenticated Socket.IO connections |
| `websocket_event` | 120 / 60 s | fail closed | subscribe, unsubscribe, heartbeat events |

An exceeded policy returns HTTP 429 `RATE_LIMIT_EXCEEDED` and `Retry-After`.
A sensitive store outage returns 503 `RATE_LIMIT_UNAVAILABLE`. Public search
and calendar remain available during a limiter outage, but readiness fails when
production rate limiting makes Redis a required dependency.

## Webhook and error rules

Webhook routes are deliberately excluded from per-IP policies because provider
retry traffic may share egress addresses. They use the 512 KiB webhook parser,
retain exact raw bytes, authenticate before durable work, and rely on unique
provider delivery/event IDs for replay safety. Ordinary JSON uses a 128 KiB
limit. Parser failures use the standard envelope with `VALIDATION_ERROR` or
`PAYLOAD_TOO_LARGE` and never echo a body, token, signature, or stack.

Private resource services must query/authorize using the current user and map
both missing and unrelated records to `NOT_FOUND`. `FORBIDDEN` remains only for
intentional public role rules such as non-Admin use of an Admin surface, a
Renter attempting Host listing creation, or a Host attempting Renter-only
booking creation.
