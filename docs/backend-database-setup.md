# Backend and Database Setup

This guide explains how to run the MediCN backend and PostgreSQL database locally.

## Prerequisites

Install these stable versions for local development:

| Tool | Required version | Notes |
| --- | --- | --- |
| Node.js | 24.16.0 LTS | Matches `.nvmrc` and `.node-version`. Prisma 7 requires Node `^22.12` or `>=24.0`; use Node 24 LTS for this project. |
| npm | 11.17.0 | Matches `packageManager` in `package.json`. Node 24.16.0 includes npm 11.13.0, so upgrade npm after installing Node. |
| Docker Desktop | Stable release with Docker Engine 29.x and Docker Compose v5.x | This project has been checked with Docker Engine 29.2.1 and Docker Compose v5.1.0. |
| PostgreSQL | 18.4 | Runs through Docker as `postgres:18.4-alpine`. |
| Redis | 7.x | Runs through Docker as `redis:7-alpine` for BullMQ worker queues. |

## 1. Install Dependencies

From this project directory:

```bash
npm --version
npm install
```

If `npm --version` is lower than `11.17.0`, update npm first:

```bash
npm install --global npm@11.17.0
```

This installs dependencies for:

- `apps/api`: NestJS backend
- `packages/types`: shared TypeScript contracts

Key project package versions:

| Package | Version |
| --- | --- |
| NestJS | 11.1.x (`@nestjs/platform-express` patched to 11.1.28) |
| Prisma / `@prisma/client` | 7.8.0 |
| TypeScript | 6.0.3 |
| ESLint | 10.5.0 |
| Jest | 30.4.2 |
| Supabase JavaScript SDK | 2.108.2 |

## 2. Create Local Environment File

Create a local `.env` file from `.env.example`.

For local database setup, the default values are enough:

```env
DATABASE_URL=postgresql://medicn:medicn_dev_password@localhost:5432/medicn_dev?schema=public
POSTGRES_USER=medicn
POSTGRES_PASSWORD=medicn_dev_password
POSTGRES_DB=medicn_dev
POSTGRES_PORT=5432
REDIS_URL=redis://localhost:6379
REDIS_PORT=6379
OUTBOX_POLL_INTERVAL_MS=5000
```

For Supabase Auth and Storage, fill these values from the Supabase project settings:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
SUPABASE_STORAGE_BUCKET=listing-photos
```

`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is safe for the browser. `SUPABASE_SECRET_KEY` is server-only and should stay in `.env`.

For Week 6 integrations, use server-only keys for backend calls and public keys
only in the official frontend:

```env
GOOGLE_MAPS_SERVER_API_KEY=
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=
STRIPE_SECRET_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
TRANSACTIONAL_EMAIL_FROM=
```

`GOOGLE_MAPS_SERVER_API_KEY`, `STRIPE_SECRET_KEY`, and
`STRIPE_WEBHOOK_SECRET` are server-only. Leave them blank in local development
when you only need mocked tests or fail-soft behavior.

Do not commit `.env`. Only `.env.example` should be committed.

## 3. Start PostgreSQL and Redis

Start the local database and Redis containers:

```bash
npm run db:up
```

Check logs if needed:

```bash
npm run db:logs
```

The database service uses:

- Image: `postgres:18.4-alpine`
- Container name: `medicn-postgres`
- Database: `medicn_dev`
- User: `medicn`
- Port: `5432`

The Redis service uses:

- Image: `redis:7-alpine`
- Container name: `medicn-redis`
- Port: `6379`
- Append-only local persistence for BullMQ development queues

PostgreSQL 18 stores Docker data under a major-version-aware directory layout, so this compose file mounts the named volume at `/var/lib/postgresql`. The volume name is `medicn_postgres_18_data` to avoid accidentally reusing an older PostgreSQL 16 local development volume. If you need data from an older local volume, dump and restore it instead of reusing the volume directly.

## 4. Generate Prisma Client

Generate the Prisma client from `prisma/schema.prisma`:

```bash
npm run prisma:generate
```

Prisma 7 reads database connection settings from `prisma.config.ts`, which loads `.env`.

Run this again whenever the Prisma schema changes.

## 5. Apply Database Migrations

Apply the committed local development migrations:

```bash
npm run prisma:migrate
```

The schema includes the Week 2 ERD models:

- `User`
- `HealthcareVerification`
- `Listing`
- `ListingPhoto`
- `ListingAvailability`
- `ListingPlace`
- `Inquiry`
- `Message`
- `Booking`
- `Payment`
- `Review`
- `AdminAction`

## 6. Start the Backend API

Run the NestJS backend:

```bash
npm run dev:api
```

The API runs at:

```text
http://localhost:4100/api/v1
```

Health check:

```text
GET http://localhost:4100/api/v1/health
```

Expected response shape:

```json
{
  "data": {
    "service": "medicn-api",
    "status": "ok",
    "timestamp": "2026-06-15T00:00:00.000Z"
  },
  "meta": {},
  "error": null
}
```

## 7. Run Backend Checks

Run tests:

```bash
npm run test -w apps/api
```

Run type checks:

```bash
npm run typecheck -w apps/api
```

Build the API:

```bash
npm run build -w apps/api
```

## 8. Stop Local Services

Stop the local database and Redis containers:

```bash
npm run db:down
```

This keeps the named Docker volume unless you remove it manually.

## Notes for Week 3 Auth Work

- Supabase Auth handles sign-up, sign-in, password reset, email verification, and sessions.
- The backend verifies Supabase access tokens from the `Authorization` header.
- Protected endpoints should expect:

```http
Authorization: Bearer <supabase_access_token>
```

- The Week 3 backend endpoints are:
  - `GET /api/v1/auth/me`
  - `POST /api/v1/auth/sync`
  - `PATCH /api/v1/users/me`

User roles are synced from Supabase signup metadata through `/api/v1/auth/sync`.

Do not build custom password authentication for Week 3.

## Storage

Use Supabase Storage for uploaded listing and profile assets. The default bucket name is:

```env
SUPABASE_STORAGE_BUCKET=listing-photos
```

The Prisma `ListingPhoto.storagePath` field stores the object path inside the bucket. `ListingPhoto.fileUrl` stores the public URL or signed URL generated for the app flow.

## Week 6 Backend Integrations

Week 6 adds backend-first integration surfaces that can be tested before the
official frontend is merged:

- Maps enrichment for listing coordinates and `ListingPlace` map URLs.
- Postgres Outbox plus Redis/BullMQ background jobs and a local transactional
  email adapter.
- Booking endpoints:
  - `POST /api/v1/bookings`
  - `GET /api/v1/bookings`
  - `GET /api/v1/bookings/:id`
- Stripe prep endpoints:
  - `POST /api/v1/payments/checkout-session`
  - `POST /api/v1/webhooks/stripe`

Automated tests should mock third-party services. Do not use live Stripe or
Google Maps keys for unit tests.

## Phase 5.7A Messaging API and realtime

The backend-only messaging routes are:

- `POST /api/v1/listings/:listingId/inquiries`
- `GET /api/v1/inquiries`
- `GET /api/v1/inquiries/:id`
- `POST /api/v1/inquiries/:id/messages`
- `POST /api/v1/inquiries/:id/read`
- `POST /api/v1/inquiries/:id/close`
- `POST /api/v1/inquiries/:id/archive`

Socket.IO uses the `/messaging` namespace. Put the same Supabase access token in
the Socket.IO handshake `auth.accessToken` field; query-string tokens are
rejected. Redis distributes opaque events between API replicas. If Redis is
unavailable, durable REST/PostgreSQL writes still succeed and clients recover
by requesting messages after their last observed sequence.

For gated verification use `RUN_DATABASE_INTEGRATION_TESTS=true` for PostgreSQL
tests and `RUN_REDIS_INTEGRATION_TESTS=true` for the two-instance Redis/Socket.IO
test. See `phase-5.7A-messaging-mvp.md` for exact REST and event contracts.

### Transactional Email Worker

Business flows write `OutboxEvent` records in the same Prisma transaction as the
related booking or payment update. The email worker publishes pending outbox
events into BullMQ and consumes the Redis-backed queue:

```bash
npm run worker:email
```

To enqueue and publish one local smoke event:

```bash
npm run smoke:email
```

`smoke:email` requires the local database and Redis containers. With the default
local adapter, sent email is logged instead of delivered through a production
provider.
