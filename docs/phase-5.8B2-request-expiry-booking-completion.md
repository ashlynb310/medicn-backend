# Phase 5.8B2 requested-booking expiry and booking completion

## Objective

Implement the approved backend-only lifecycle rules for expiring unanswered
booking requests and completing ended paid stays. Success means the database,
operations worker, Outbox/email boundary, and participant DTOs agree under
concurrency without adding a user completion API, review flow, frontend work,
support workflow, external calendar integration, or live provider call.

## Accepted contracts

- A `requested` booking expires at `createdAt + 24 hours`. Before that instant it
  reserves inventory; at and after that instant the system may atomically cancel
  it with reason `request_expired` and financial disposition
  `no_payment_collected`.
- Expiry is represented by the existing durable cancellation operation model.
  It never creates a Stripe checkout-expiry, refund, reversal, or other provider
  command. Participant email jobs are written to PostgreSQL Outbox in the same
  transaction and contain opaque IDs plus an allowlisted template only.
- Listings have a canonical local `checkoutTime` in strict `HH:mm` form, with a
  default/backfill of `11:00`. Booking creation copies the locked listing
  `timeZone` and `checkoutTime`; PostgreSQL rejects later snapshot changes.
- Completion eligibility is the instant two hours after `endDate` at the booking
  snapshot's local checkout time. PostgreSQL timezone conversion is
  authoritative, including its deterministic IANA tzdata handling for DST gaps
  and folds.
- Only a `paid` booking whose current payment is `paid` or a non-total
  `partially_refunded` payment may complete. Active cancellation, pending refund,
  total refund, or unresolved dispute blocks completion. Completion updates only
  booking lifecycle metadata and transactional notification Outbox rows.
- Expiry, Host decisions, Renter cancellation, completion, payment/refund/
  dispute processing, and transfer work share the established advisory-lock
  order: listing, booking, checkout, payment, transfer. Repeated or concurrent
  scheduler execution is bounded and idempotent.

## API and data boundaries

- Listing create/update accepts optional `checkoutTime`; omitted create input
  persists `11:00`. Owner/Admin listing detail exposes it; public listing and
  public calendar responses do not.
- Authorized participant/Admin booking DTOs expose `checkoutTime`,
  `requestExpiresAt`, `expiredAt`, `expirySource`, `completedAt`, and
  `completionSource`. No anonymous endpoint exposes booking lifecycle metadata.
- Unknown DTO fields remain rejected by the global validation pipe. No new
  end-user lifecycle command endpoint is added.

## Implementation tasks and verification

1. Add and migrate the checkout/lifecycle columns, enums, constraints, indexes,
   backfills, and immutable booking trigger; generate and validate Prisma.
2. Add strict listing DTO/service validation, owner serialization, booking
   snapshots, shared types, and focused DTO/service tests.
3. Add serialized expiry and completion services with transactional opaque
   Outbox notifications; verify exact boundaries, state blockers, rollback,
   idempotency, and PostgreSQL races.
4. Add the two stable recurring operations to the existing BullMQ scheduler and
   operations worker, plus bounded operational counts/metrics and shutdown-safe
   tests.
5. Update ADR-009, accept ADR-010 only for automatic completion, update the gap
   audit, then run migrations/status, shared/API static checks, normal tests,
   PostgreSQL-gated tests, and Redis-gated tests.

## Commands

- `npx prisma migrate deploy`
- `npx prisma migrate status`
- `npm run prisma:generate`
- `npx prisma validate`
- `npm run typecheck -w packages/types`
- `npm run build -w packages/types`
- `npm run typecheck -w apps/api`
- `npm run lint -w apps/api`
- `npm run build -w apps/api`
- `npm run test -w apps/api -- --runInBand`
- `$env:RUN_DATABASE_INTEGRATION_TESTS='true'; npm run test -w apps/api -- --runInBand`
- `$env:RUN_REDIS_INTEGRATION_TESTS='true'; npm run test -w apps/api -- --runInBand`
- both gated flags together for the complete infrastructure suite

## Security and operational boundaries

- All HTTP time input is allowlisted and normalized; SQL remains parameterized.
- Queue, Outbox, logs, metrics, and audit metadata contain no address, email,
  payment secret, provider error, free text, or message body.
- No schema or code path introduces a Host-writable reservation, a browser
  timezone authority, a second scheduler, or a live provider call.
- This phase is implementation evidence, not production-readiness evidence.

## Implementation evidence

Migration `20260731000000_add_booking_expiry_completion` is applied after all
21 prior migrations; Prisma reports 22 migrations and an up-to-date schema. It
adds the two lifecycle reason values, `BookingLifecycleSource`, checkout and
lifecycle columns, safe backfills, canonical-time and metadata consistency
constraints, bounded-scan indexes, and the database trigger that makes booking
timezone, checkout time, and request expiry immutable.

The existing operations worker owns these stable recurring scheduler IDs:

- `medicn:requested-booking-expiry:v1` -> `requested_booking_expiry`
- `medicn:booking-completion:v1` -> `booking_completion`

Both scan at most 100 rows per scheduled invocation (service hard maximum 500),
reuse the existing retry, execution-record, stale-claim recovery, heartbeat,
metrics, and bounded worker-shutdown infrastructure, and serialize each booking
through the shared advisory-lock order. No second scheduler exists.

Verification on local PostgreSQL and Redis:

- Normal: 48 suites / 390 passed, with 14 suites / 50 tests gated (440 tests
  discovered).
- PostgreSQL gate: 61 suites / 439 passed, with only the one Redis suite/test
  skipped (440 discovered).
- Redis gate: 49 suites / 391 passed, with 13 PostgreSQL suites / 49 tests
  skipped (440 discovered). The repository's two-instance
  `MessagingSocketAdapter` configuration connected to Redis.
- Combined PostgreSQL + Redis: all 62 suites / 440 tests passed.
- The Phase 5.8B2 real-PostgreSQL lifecycle suite contributes 17 tests covering
  expiry and completion boundaries, races, commit visibility, rollback/retry,
  IANA/DST conversion, blockers, partial refunds, real refund/dispute webhook
  races, idempotency, payload privacy, and snapshot immutability.

Prisma generation/validation, shared-types typecheck/build, and API typecheck,
lint, and build pass. Tests make no live provider call. The existing Prisma
PostgreSQL adapter still emits the repository's known `pg@9` concurrent-query
deprecation warning during some gated concurrency tests; it causes no failure
but remains a dependency-maintenance item.

## Remaining scope

Reviews, support/damage cases, issue reporting, Admin correction/reopening,
requested-booking auto-extension, frontend work, external calendars, provider
sandbox certification, and Stripe Live Mode remain unimplemented or outside
this phase. These results are local implementation evidence only.
