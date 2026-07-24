# MediCN

MediCN is a marketplace MVP for healthcare-affiliated housing workflows.

## Workspace

- `apps/api`: NestJS API
- `packages/types`: Shared API and domain contracts
- `prisma/schema.prisma`: PostgreSQL schema managed by Prisma
- `docs/backend-database-setup.md`: Backend and database setup guide
- `docs/decisions`: Architecture decision records

The formal MediCN frontend is maintained in a separate repository.

## Required Versions

Install these versions for local development:

| Tool | Version |
| --- | --- |
| Node.js | 24.16.0 LTS |
| npm | 11.17.0 |
| Docker Desktop | Stable release with Docker Engine 29.x and Docker Compose v5.x |
| PostgreSQL container | `postgres:18.4-alpine` |
| Redis container | `redis:7-alpine` |
| Supabase JavaScript SDK | 2.108.2 |
| Supabase SSR helpers | 0.12.0 |

## Quick Start

From this project directory, create `.env` from `.env.example`, then run:

```bash
npm install
npm run db:up
npm run prisma:generate
npm run prisma:migrate
npm run dev:api
```

The local API listens on `http://localhost:4100/api/v1`.

Phase 5.7A also exposes the authenticated Socket.IO namespace
`http://localhost:4100/messaging`. Pass the Supabase access token as
`auth.accessToken`, never in the URL. REST remains the only message write path;
the socket carries opaque notification events and clients catch up through
`GET /api/v1/inquiries/:id?afterSequence=<last-sequence>`. See
`docs/phase-5.7A-messaging-mvp.md` for the contracts.

Phase 5.7B exposes backend-only healthcare claim/evidence and Admin review APIs.
Evidence is held only in the dedicated private `healthcare-credentials` bucket,
review access uses an audited URL valid for at most 60 seconds, and every
decision or withdrawal durably requests provider-confirmed deletion. See
`docs/phase-5.7B-healthcare-evidence.md` for the endpoint and privacy contract.

Phase 5.7C hardens the existing backend listing archive and exact check-in
location rules. Ordinary Host/Admin archive is blocked by future active booking
obligations, and active partially refunded stays retain renter snapshot access
unless cancellation, full refund, or dispute revokes it. See
`docs/phase-5.7C-archive-location-correctness.md` for the exact contracts and
explicitly deferred workflows.

Phase 5.8A adds the backend-only idempotent
`POST /api/v1/bookings/:id/cancel` command and durable full-refund
orchestration for the accepted ADR-006 cases. Financially pending cancellation
keeps inventory reserved, immediately revokes Renter check-in location, and is
completed only from authoritative provider state. Paid-Renter self-service
remains policy-blocked. See `docs/phase-5.8A-booking-cancellation.md`.

Phase 5.8B adds backend-only Host/Admin availability-window CRUD and separate
private/public calendar projections. Dates are half-open local civil dates,
listings own validated IANA timezones, bookings retain immutable timezone
snapshots, and requested through paid bookings remain opaque reservations. See
`docs/phase-5.8B-local-availability.md`. Requested-booking expiry, completion,
reviews, frontend calendar UI, and external synchronization remain deferred.

Phase 5.9B hardens the backend HTTP boundary. Every unmarked route now requires
a valid bearer session, public and optional-auth routes are explicit, request
validation rejects unknown fields, response/error envelopes include a generated
correlation ID, and abuse-sensitive routes use distributed Redis limits. The
complete 77-operation HTTP inventory and actor matrix are in
`docs/http-endpoint-inventory.md`; Socket.IO is documented separately in
`docs/socket-io-messaging-contract.md`.

OpenAPI is generated deterministically from the Nest application:

```bash
npm run openapi:generate
npm run openapi:check
```

In development/test, `/api/v1/docs` and `/api/v1/docs-json` are available. In
production they are absent unless `OPENAPI_ENABLED=true`; when enabled, the
exact dedicated `OPENAPI_BEARER_TOKEN` is required. Do not reuse a user or
provider token. See `docs/security-load-testing-runbook.md` for CORS, proxy,
body limits, rate policies, query-plan evidence, and bounded local smoke tools.

Transactional work uses PostgreSQL Outbox plus Redis/BullMQ. Run each process
independently; the HTTP API never publishes the outbox or runs recurring work:

```bash
npm run worker:outbox
npm run worker:email
npm run worker:media
npm run worker:maps
npm run worker:operations
```

Local development defaults to a simulated email adapter. It records a durable
`simulated` result and does not log recipient addresses or message bodies. To
send real transactional email, explicitly select Brevo and add these
backend-only values to `.env`:

```bash
EMAIL_PROVIDER=brevo
TRANSACTIONAL_EMAIL_ENABLED=true
BREVO_API_KEY=xkeysib-your_api_key
BREVO_WEBHOOK_BEARER_TOKEN=a-random-token-with-at-least-32-characters
TRANSACTIONAL_EMAIL_FROM="MediCN <noreply@your-verified-domain.example>"
```

`TRANSACTIONAL_EMAIL_FROM` must be a verified Brevo sender. Never place the
API key in a frontend environment file or expose it through a `NEXT_PUBLIC_`
variable.

Configure Brevo's transactional webhook URL as
`https://<api-host>/api/v1/webhooks/brevo/transactional`, select the delivery,
deferred, soft/hard bounce, blocked, spam, invalid, error, sent/request, and
unsubscribe events, and configure the exact Bearer token above. Both single
events and batches of at most 500 are accepted. See
`docs/worker-operations-runbook.md` for Redis, health, metrics, recovery, and
deployment requirements.

## Location enrichment

Phase 5.4A uses backend-only Google Maps Platform calls: Geocoding API v4,
Places API (New) Nearby Search, and Routes API v2 Compute Route Matrix. Enable
the pipeline only after setting `GOOGLE_MAPS_SERVER_API_KEY`, a random
`MAPS_LOCATION_PRIVACY_SECRET` of at least 32 characters, and `REDIS_URL`.
Restrict the server key by production egress IP/CIDR and to those three APIs;
do not reuse the browser key.

Run the worker and the bounded recovery/refresh commands with:

```bash
npm run worker:maps
npm run maps:retry -- 25
npm run maps:refresh -- 25
```

Nearby provider data expires after at most 720 hours and route data after at
most 168 hours by default. Exact coordinates never appear in anonymous/public
listing responses; public listings expose only a stable displaced coordinate,
a 500 m uncertainty radius, and rounded proximity distances. Review Google
Maps Platform terms before production launch because durable marketplace
address/snapshot requirements may require a separate license or non-Google
source of truth. See `docs/phase-5.4A-location-enrichment.md`.

## Auth And Storage

MediCN uses Supabase Auth for signup, sign-in, sessions, and access tokens.
Upload flows use Supabase Storage with the `listing-photos` bucket:

- Listing photos are stored below `listings/<listingId>/...`.
- Profile photos are stored below `profiles/<userId>/...`; a user can receive a
  signed upload URL only for their own profile path.

For local and production use, configure that bucket for public reads, permit
only `image/jpeg`, `image/png`, and `image/webp`, and set a 5 MB file-size
limit. The API signs uploads; browser clients must never receive the Supabase
secret key.

Healthcare evidence is not part of the public upload flow. It accepts at most
three JPEG/PNG/WebP images of at most 10 MiB through the healthcare endpoints,
uses the separate private `healthcare-credentials` bucket, and never returns a
public URL. Do not reuse listing/profile bucket policies for this data.

Protected API requests use:

```http
Authorization: Bearer <supabase_access_token>
```

Messaging endpoints are `POST /listings/:listingId/inquiries`,
`GET /inquiries`, `GET /inquiries/:id`, `POST /inquiries/:id/messages`,
`POST /inquiries/:id/read`, `POST /inquiries/:id/close`, and
`POST /inquiries/:id/archive`, all below `/api/v1`.
