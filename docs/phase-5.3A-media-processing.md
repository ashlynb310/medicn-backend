# Phase 5.3A Secure Product Media Processing

## Objective

Build a backend-only quarantine and sanitization pipeline for ordinary listing
photos and profile photos. Browser uploads remain private and untrusted until a
bounded Sharp decode and deterministic re-encode produces publishable variants.
Veriff, healthcare credentials, video, SVG, GIF, PDF, HEIC, and arbitrary binary
files are outside this domain and must never be accepted by it.

The attached Phase 5.3A request is the reviewed feature specification. These
implementation assumptions make its remaining choices explicit:

- Media processing is disabled by default and provider credentials are not
  required for normal API startup or automated tests.
- Accepted inputs are JPEG, PNG, and WebP, capped at 5 MiB, 40 megapixels,
  12,000 pixels on either axis, and one page/frame.
- All derivatives are deterministic WebP at quality 82 and effort 4.
- Listing variants use `inside` fit without upscaling: `thumbnail` at 480 px
  and `display` at 1600 px.
- Profile variants use a centered square `cover` crop without upscaling at
  96, 256, and 512 px. Sources smaller than a requested square produce a
  smaller square instead of being enlarged.
- Successful and rejected ingest originals are retained privately for the
  configured retention period (24 hours by default), then removed by cleanup.
- A terminal rejected/deleted asset requires a new upload intent; retries are
  for recoverable worker/storage failures only.
- Existing listing URLs and `User.profilePhotoUrl` values remain visible as
  explicitly labelled `legacy` media. They are never relabelled sanitized.

## Threat Model

Trust boundaries are authenticated HTTP requests, browser-uploaded objects,
Supabase Storage responses, PostgreSQL outbox records, and Redis jobs.

- Spoofing/elevation: every listing operation checks owner/Admin; every profile
  operation checks user/Admin; paths come only from durable records.
- Tampering: the worker hashes downloaded bytes, checks magic/decoder format,
  and uploads immutable deterministic variants before committing `ready`.
- Information disclosure: ingest paths, internal errors, credentials, and
  rejected/pending media are excluded from public DTOs.
- Denial of service: signed intents and outstanding limits bound ingress;
  downloads have timeouts and byte caps; Sharp has pixel/dimension/page caps;
  BullMQ and Sharp concurrency are bounded.
- Repudiation/recovery: upload, processing, failure, deletion, and cleanup state
  is durable in PostgreSQL; outbox and BullMQ job IDs are stable.

## Storage Architecture

- `SUPABASE_MEDIA_INGEST_BUCKET`: private quarantine bucket; browser upload
  target and worker-only download/removal.
- `SUPABASE_LISTING_MEDIA_BUCKET`: public, processed listing WebP variants only.
- `SUPABASE_PROFILE_MEDIA_BUCKET`: public, processed profile WebP variants only.
- The API never creates buckets. Production validation rejects an ingest bucket
  equal to either derivative bucket.

## API Contract

### Create intent

`POST /api/v1/uploads/presigned-url`

Input: `purpose`, optional `listingId`, `fileName`, `contentType`.

Output: `uploadIntentId`, `uploadUrl`, `storagePath`, `expiresAt`,
`maxBytes`. No public URL is returned.

### Complete intent

`POST /api/v1/uploads/:intentId/complete`

Verifies authority, expiry, expected object existence, and atomically moves the
asset from `pending_upload` to `uploaded` while writing
`process_media_asset` with idempotency key `media-process:<assetId>`. Repeated
completion is idempotent.

### Status and deletion

- `GET /api/v1/uploads/:intentId` returns safe state and ready variants only.
- `DELETE /api/v1/media/assets/:assetId` marks the asset deleted and schedules
  cleanup; paths are never accepted from the caller.
- `DELETE /api/v1/users/me/profile-photo` clears the active profile media and
  schedules cleanup.
- Existing `POST /listings/:id/photos` may only reject the obsolete
  client-supplied `storagePath` contract; listing publication happens from the
  ready media asset.

`PATCH /users/me` accepts `profilePhotoUrl: null` only. Any non-null value is a
validation error. A ready profile asset updates the URL server-side.

## Data Contract

`MediaAsset` owns the intent and processing lifecycle. `MediaVariant` represents
each immutable derivative. Legacy `ListingPhoto` rows are retained and marked
legacy. New listing photos reference a ready media asset. The active profile
asset is represented by a partial unique current-profile constraint.

## Worker and Recovery

- `worker:media` publishes the shared PostgreSQL outbox and consumes only the
  media queue with configured concurrency.
- `media:retry -- 25` recovers stale processing claims and re-enqueues durable
  failed/uploaded assets.
- `media:cleanup -- 100` expires stale intents and removes retained ingest,
  deleted/superseded variants, and retry leftovers idempotently.
- Derivative paths are `media/<assetId>/<variant>.webp`; retries overwrite the
  same immutable-intent path rather than creating unbounded objects.

## Commands

- Generate: `npm run prisma:generate`
- Build: `npm run build -w apps/api`
- Typecheck: `npm run typecheck -w apps/api`
- Lint: `npm run lint -w apps/api`
- Test: `npm run test -w apps/api -- --runInBand`
- Worker: `npm run worker:media -w apps/api`
- Retry: `npm run media:retry -w apps/api -- 25`
- Cleanup: `npm run media:cleanup -w apps/api -- 100`

## Project Structure and Style

- `prisma/`: durable models and explicit SQL migration.
- `apps/api/src/media/`: storage boundary, processor, lifecycle service,
  BullMQ route, worker, and recovery commands.
- `apps/api/src/uploads/`: authenticated intent API.
- `apps/api/src/listings/`, `users/`, `auth/`: publication serializers and
  compatibility changes.
- `apps/api/test/`: Jest unit tests and gated PostgreSQL concurrency tests.

Use existing NestJS exception envelopes, Prisma transactions, parameterized
`Prisma.sql` advisory locks, constructor injection, and camelCase DTO fields.

## Testing Strategy

- Pure/small tests use generated Sharp fixtures and a fake storage adapter.
- Service tests cover authorization, intent idempotency, publication filtering,
  replacement/deletion, retries, cleanup, and separation from verification.
- One gated PostgreSQL suite proves concurrent completion/processing claims.
- No automated test calls Supabase or requires Redis.

## Boundaries

- Always: authenticate/authorize, validate claimed types and filenames, use
  database-owned paths, re-encode, strip metadata, and preserve existing data.
- Never: expose ingest paths publicly, trust browser MIME/extensions, accept
  arbitrary URLs/paths, upload verification evidence, create buckets at API
  startup, or store secrets.
- Deferred: frontend, Maps, moderation/AI, video, healthcare evidence,
  Veriff media, CDN migration, and Phase 5.4.

## Success Criteria

The exact Phase 5.3A acceptance list is covered by focused tests; all baseline
tests, build, typecheck, lint, Prisma generation, migration application, and all
available gated database tests pass. Supabase Storage E2E remains explicitly
unverified until real safe buckets and credentials are provided.
