# MediCN final backend gap audit

Initial audit date: 2026-07-19  
Phase 5.6B remediation date: 2026-07-19  
Scope: the original audit is retained below, with Phase 5.6B, Phase 5.7A,
Phase 5.7B, Phase 5.7C, Phase 5.8A, Phase 5.8B, Phase 5.8B2, Phase 5.9A, and
Phase 5.9B implementation results plus the accepted ADR decisions incorporated.
No frontend files were changed.

## Phase 5.9B HTTP contract, security, and scale-hardening result

The backend now uses one shared Nest bootstrap for runtime and integration
tests. It installs the `/api/v1` prefix, strict DTO transformation and unknown-
field rejection, protected-by-default bearer authentication, response/error
envelopes with correlation IDs, bounded parsers with exact raw webhook bytes,
Helmet headers, explicit CORS origins, and an explicit trusted-proxy hop count.
The generated 77-operation OpenAPI contract and the manually audited actor
matrix agree on public, optional-auth, participant/owner, and Admin boundaries.
Private resources preserve opaque `NOT_FOUND`; intentionally visible privilege
failures use `FORBIDDEN` without leaking private fields.

Redis-backed fixed-window policies independently protect public search/calendar,
inquiry/message writes, upload intents, identity, checkout/cancellation, Admin
commands, and Socket.IO connections/events. Sensitive policies fail closed;
public browse policies fail open. Production validation requires Redis-backed
limiting and readiness includes it. Keys contain hashed subjects only. Socket.IO
remains notification-only, message bodies remain in PostgreSQL, REST writes do
not depend on realtime delivery, and reconnect catch-up uses `afterSequence`.

Migration `20260802000000_add_http_scale_indexes` adds only the compound indexes
supported by a rollback-only seeded `EXPLAIN (ANALYZE, BUFFERS)` audit. All 15
recorded query plans avoid sequential scans at the documented local dataset.
The bounded real-Nest/PostgreSQL smoke completed 170 requests with no failures
across search, booking reads, message catch-up, calendars, health, and concurrent
read-cursor writes. This is local regression evidence, not capacity or
production-readiness evidence.

Deterministic `openapi:generate`/`openapi:check`, `query-plans:audit`, and
`smoke:http` commands are documented in
[security-load-testing-runbook.md](security-load-testing-runbook.md). The final
runtime dependency audit has five moderate and zero high/critical findings; the
initial Swagger highs were removed with a compatible patch update. Remaining
Prisma/Hono and frontend Next/PostCSS advisories have only breaking or out-of-
scope fixes and were not force-fixed. The known Prisma adapter/pg concurrent-
query deprecation remains a pg 9 upgrade blocker. No provider or Live Mode call
was made and no frontend file was changed.

Final local verification reports all 24 migrations applied. Prisma generation
and validation, shared-types typecheck/build, API typecheck/lint/build, and the
77-operation OpenAPI drift check pass. The normal run passes 58 suites / 462
tests with 17 suites / 56 infrastructure tests skipped (518 discovered).
PostgreSQL-only passes 73 suites / 516 tests with two Redis tests skipped;
Redis-only passes 60 suites / 464 tests with 15 suites / 54 PostgreSQL tests
skipped. The combined infrastructure run passes all 75 suites / 518 tests. The
query audit records 15 plans with no sequential scans, and all 170 bounded HTTP
smoke requests succeed.

## Phase 5.8B2 request expiry and booking completion result

ADR-009 now includes the accepted exact 24-hour request lifetime, and ADR-010
is Accepted for automatic completion exactly two hours after the immutable
booking-local checkout instant. Migration
`20260731000000_add_booking_expiry_completion` adds listing checkout time
(strict `HH:mm`, default/backfill `11:00`), immutable booking timezone/checkout/
expiry snapshots, lifecycle timestamps and sources, constraints, and bounded
scan indexes. Existing completed bookings are marked as legacy backfill rather
than misattributed to the scheduler.

The existing operations scheduler owns two stable recurring jobs:
`medicn:requested-booking-expiry:v1` and
`medicn:booking-completion:v1`. Exact request expiry is an atomic system
cancellation with `request_expired` and `no_payment_collected`; it creates no
Stripe/provider command. Completion accepts only fulfillable paid state, allows
a settled non-total partial refund, and blocks active cancellation, pending or
total refund, dispute, cancellation, and non-fulfillable payment state. Both
transitions serialize with the established listing/booking/checkout/payment/
transfer advisory locks and write only opaque participant notification records
to PostgreSQL Outbox in the lifecycle transaction.

Participant/Admin booking DTOs expose the accepted lifecycle fields. Listing
checkout time is owner/Admin-only, public calendars remain unavailable-only,
and unrelated booking reads or decision attempts preserve opaque `NOT_FOUND`.
Unit and real-PostgreSQL tests exercise exact boundaries, expiry/decision/
cancellation races, commit visibility and rollback, IANA zones and DST dates,
completion blockers, partial refunds, concurrent idempotency, payload privacy,
stable scheduler ownership, and clean queue shutdown. Reviews, support/damage
flows, Admin lifecycle correction, frontend work, requested auto-extension,
and external calendar sync remain unimplemented. See
[phase-5.8B2-request-expiry-booking-completion.md](phase-5.8B2-request-expiry-booking-completion.md).

Local verification reports all 22 migrations applied. Prisma generation and
validation, shared-types typecheck/build, and API typecheck/lint/build pass.
Normal tests pass 48 suites / 390 tests with 14 suites / 50 tests gated (440
discovered). PostgreSQL-only passes 61 suites / 439 tests with the single Redis
test skipped; Redis-only passes 49 suites / 391 tests with 49 PostgreSQL tests
skipped. The combined infrastructure run passes all 62 suites / 440 tests. The
known Prisma adapter `pg@9` concurrent-query deprecation warning remains
non-failing dependency-maintenance work. No live provider call was made, and
this is not production-readiness evidence.

## Phase 5.8B local availability implementation result

ADR-009 is implemented as a backend-only local calendar. Dedicated Host/Admin
CRUD manages `available|blocked` civil-date windows; bookings remain the sole
source of opaque reservations. Private projection returns windows plus merged
reserved ranges, while the public approved-listing projection collapses
availability gaps, blocks, and reservations into unavailable date ranges only.

Migration `20260730000000_add_local_availability_timezones` converts stay and
window dates to PostgreSQL `DATE`, adds validated IANA listing timezones, copies
the locked listing timezone to bookings, and enforces booking-timezone
immutability in PostgreSQL. Booking creation and all calendar writes serialize
on the existing listing advisory lock and reload authoritative state. Public
date search now applies available-window union, blocked precedence, and the
`requested|accepted|payment_pending|paid` reservation set.

Unit and real-PostgreSQL tests cover ownership, opaque responses, DST, strict
date-only inputs, half-open adjacency, all booking states, safe edits, public
search, and booking/calendar races. See
[phase-5.8B-local-availability.md](phase-5.8B-local-availability.md). The
subsequent Phase 5.8B2 result above implements requested-booking expiry and the
accepted automatic-completion subset. Reviews, frontend work, and external
synchronization remain unimplemented.

## Phase 5.8A booking cancellation implementation result

The accepted subset of ADR-006 is implemented as a backend-only durable
cancellation state machine. The authenticated idempotent cancellation endpoint
supports immediate no-payment Renter/Admin cases, unsettled Checkout expiry,
and paid Host/Admin full-refund orchestration. Paid-Renter self-service remains
blocked with `PAID_CANCELLATION_POLICY_UNAVAILABLE`; no percentage, cutoff,
fee, exception, credit, penalty, or override was invented.

Migration `20260729000000_add_booking_cancellation_operations` preserves
versioned actor/reason/status/financial-disposition history and enforces both
per-booking idempotency and one active operation. Cancellation and every
competing payment/decision/transfer path share listing, booking, checkout,
payment, then transfer advisory locks. Financially pending cancellation revokes
Renter exact-location access but retains inventory until authoritative expiry,
failure, refund/dispute confirmation, and any required transfer reversal.

Stripe expiry/refund commands travel through PostgreSQL Outbox and the existing
operations BullMQ worker with stable provider idempotency keys; refund amount is
derived only from the stored Payment. Webhooks, not request acceptance or a
browser redirect, complete financial state. Payloads and logs are restricted to
opaque IDs and operation types. See
[phase-5.8A-booking-cancellation.md](phase-5.8A-booking-cancellation.md).
Provider sandbox and deployment evidence remain absent, and this result is not
production-readiness evidence.

## Phase 5.7C archive/location correctness implementation result

ADR-007 and ADR-008 are implemented as a backend-only hardening pass. Listing
archive now serializes with booking creation on the same PostgreSQL listing
advisory lock, reloads authoritative state after locking, uses database time,
and refuses future `requested|accepted|payment_pending|paid` obligations with
the private-safe `LISTING_ARCHIVE_BLOCKED_BY_ACTIVE_BOOKINGS` contract. Archive
continues to preserve all historical rows while removing the listing from
public discovery and new booking/inquiry creation.

Renter exact-location access now requires an immutable snapshot, an active
`paid|completed` booking, no cancellation, and the latest authoritative payment
attempt in `paid|partially_refunded` without dispute or cumulative full refund.
An older paid attempt cannot override a later revocation. The protected read
uses repeatable-read transaction isolation so it cannot combine incompatible
booking and payment states during an atomic transition. Host/Admin operational
access remains separate and unchanged.

Focused unit tests and three real PostgreSQL tests cover the archive race,
history survival, archived-listing visibility/creation rules, and concurrent
refund/cancellation location reads. Evidence and the explicitly deferred scope
are in [phase-5.7C-archive-location-correctness.md](phase-5.7C-archive-location-correctness.md).
No schema change, migration, frontend change, or live provider call was needed.
Prisma generation/validation, API typecheck/lint/build, and shared-types build
pass. The normal run passes 39 suites / 312 tests with 11 gated suites / 21
tests skipped (333 discovered); the combined PostgreSQL and Redis run passes all
50 suites / 333 tests.

## Phase 5.7A messaging implementation result

The selected inquiry/messaging branch is implemented as a backend-only MVP.
PostgreSQL now owns one-open-thread uniqueness, inquiry-scoped message sequence,
thread close, per-user archive, and monotonic read cursor state. The seven REST
routes use the shared Supabase/disabled-account boundary and opaque inquiry
authorization. Message/email Outbox writes are atomic and the new messaging
Outbox payload contains IDs and template metadata only.

Socket.IO `/messaging` authenticates with handshake `auth.accessToken`, binds
socket lifetime to the verified token expiry, applies connection limits, and
authorizes inquiry-room subscription server-side. The Socket.IO Redis adapter
provides cross-instance propagation; Redis or emit failure cannot roll back a
committed REST write. Events contain no message body or sensitive profile or
listing fields. REST sequence catch-up is authoritative.

Implementation evidence is documented in
[phase-5.7A-messaging-mvp.md](phase-5.7A-messaging-mvp.md). Realtime deployment,
managed Redis/proxy validation, abuse/reporting policy, and retention policy are
still not production-certified.

Phase 5.7A normal verification passed Prisma generation/validation, API
typecheck/lint/build, shared-types build, and 35 Jest suites / 272 tests. Nine
gated suites / 16 tests were skipped. Prisma reports all 17 migrations applied.
The combined PostgreSQL and Redis gated run passed all 44 suites / 288 tests,
including four real PostgreSQL messaging concurrency/atomicity tests and a
two-instance test through the repository's `MessagingSocketAdapter` and
`MessagingRealtimeService`. The production dependency audit reported no
high/critical and five moderate Prisma/Next-chain advisories.

## Phase 5.7B healthcare-evidence implementation result

The ADR-016 backend workflow is implemented. It supports versioned claims, one
active submission per user under PostgreSQL concurrency, up to three private
JPEG/PNG/WebP images, server-side sanitization, audited Admin access through a
signed URL valid for at most 60 seconds, row-locked Admin decisions, and durable
deletion after a decision or withdrawal. Originals are deleted once a sanitized
private derivative is ready. Evidence is marked deleted only after the storage
provider confirms every object is absent; retry exhaustion is visible as
`deletion_failed` in Admin operations status.

The private bucket and immutable paths never receive a public URL. Generic media
endpoints reject healthcare assets opaquely, while subject/Admin DTO allowlists,
audit metadata, Outbox/BullMQ payloads, and logs exclude paths, URLs, evidence
content, reviewer notes, and other sensitive material. Implementation evidence
and endpoint contracts are in
[phase-5.7B-healthcare-evidence.md](phase-5.7B-healthcare-evidence.md).

Identity and healthcare status remain completely separate. The accepted
engineering boundary does not authorize PDF/OCR, permanent evidence retention,
public URLs, authoritative credential-provider claims, or collection from real
users in public production. Privacy/legal basis, disclosure and consent,
reviewer operations, incident handling, appeal, data residency, backup, and
audit-retention decisions remain production blockers.

Phase 5.7B verification reports 19 applied migrations. Prisma generation and
validation plus API typecheck, lint, and build pass. The normal run passes 39
suites / 297 tests with 10 gated suites / 18 tests skipped (315 total). The
combined PostgreSQL and Redis run passes all 49 suites / 315 tests, including
healthcare creation/decision concurrency and the repository's two-instance
messaging Redis adapter test. No live provider was called.

## Phase 5.6B remediation result

The three P1 findings from the initial audit are fixed and covered by regression tests:

- `AuthService.getCurrentUserRecord` now returns `ACCOUNT_DISABLED` (HTTP 403) when `User.disabledAt` is non-null. `syncCurrentUser` checks an existing record before the upsert and checks the returned record again. A protected-path trace found no request-authenticated service bypassing this boundary; public listing reads and health endpoints remain public.
- Veriff writes only `IdentityVerification`. The removed compatibility writer can no longer project identity into `User.currentVerificationStatus`. `/auth/me` now reports `identityVerification` separately from `healthcareVerification`; the deprecated `currentVerificationStatus` mirrors healthcare only.
- Migration `20260726000000_separate_identity_healthcare_status` marks legacy identity-origin healthcare rows through the same-ID Veriff copy provenance, preserves all rows, and recalculates the User cache from the newest non-legacy healthcare record or `not_started`. Its DML is PostgreSQL-tested for two-pass idempotency.
- Admin approval row-locks and reloads the Host, requires `emailVerifiedAt`, and returns `EMAIL_NOT_VERIFIED` before identity/location/status/audit side effects. Draft/pending create and edit behavior is unchanged; rejection remains allowed. Existing approved listings are not automatically hidden, and ongoing enforcement for them remains a separate product policy.
- `/health/live` remains HTTP 200. `/health/ready` returns 200 for ready and 503 for failed required dependencies while retaining the safe dependency summary inside the standard response envelope.

No P1 finding from the initial audit remains. This result does not make the complete backend production-ready; the P2/P3, product, legal, provider, deployment, and Phase 5.6C decisions below remain.

### Verification evidence

- Prisma generate and schema validation: passed.
- API build, typecheck, and lint: passed.
- Normal API tests: 31 suites, 244 tests passed; 7 PostgreSQL-gated suites / 11 tests skipped as designed.
- PostgreSQL-enabled API tests: 38 suites, 255 tests passed, including all 7 gated suites / 11 PostgreSQL tests.
- Migration status: 16 migrations found; database schema is up to date.
- The existing Prisma adapter emitted the already-documented `pg` concurrent-query deprecation warning during gated concurrency tests; no test failed.

### Phase 5.6B implementation files

- Runtime: [auth.service.ts](../apps/api/src/auth/auth.service.ts), [identity.service.ts](../apps/api/src/identity/identity.service.ts), [admin.service.ts](../apps/api/src/admin/admin.service.ts), [health.controller.ts](../apps/api/src/health/health.controller.ts), and [api-exception.filter.ts](../apps/api/src/common/api-exception.filter.ts).
- Schema/migration: [schema.prisma](../prisma/schema.prisma) and [20260726000000 migration](../prisma/migrations/20260726000000_separate_identity_healthcare_status/migration.sql).
- Shared contracts/scripts: [packages/types/src/index.ts](../packages/types/src/index.ts), [packages/types/src/index.d.ts](../packages/types/src/index.d.ts), and [package.json](../package.json).
- Tests: [auth.service.spec.ts](../apps/api/test/auth.service.spec.ts), [listings.service.spec.ts](../apps/api/test/listings.service.spec.ts), [admin.service.spec.ts](../apps/api/test/admin.service.spec.ts), [identity.service.spec.ts](../apps/api/test/identity.service.spec.ts), [health.spec.ts](../apps/api/test/health.spec.ts), and [identity-healthcare-migration.integration.spec.ts](../apps/api/test/identity-healthcare-migration.integration.spec.ts).
- Report: [backend-final-gap-audit.md](backend-final-gap-audit.md).

### Decisions still required before Phase 5.6C can close

- Decide whether email verification should be continuously enforced for listings that are already approved; Phase 5.6B only gates new Admin approval and does not auto-hide existing inventory.
- Decide the Week 7 messaging-versus-calendar branch.
- Define cancellation/refund initiation and economics. Partial-refund exact-location
  access and ordinary archive-with-active-booking policies are now implemented
  under ADR-007/ADR-008; emergency hide and restoration remain separate.
- Settle merchant-of-record, tax, platform-liability, payout/bank-payout, dispute ownership, retention/erasure, and related legal policies.
- Provider sandbox and deployment certification remain later phases and are not evidence supplied by Phase 5.6B.

## Audit basis and classification rules

This report reconciles the complete nested Notion export (92 nested archive files: 88 HTML, 2 CSV, 2 images; the checked-in Markdown/CSV extraction is the readable equivalent), all 579 lines of `AGENTS.md`, the Week 2 API/ERD contracts, 15 migrations, the current Prisma schema, 14 controllers, 16 request/response DTO files, 35 services, 17 modules, 18 command/worker entry points, and 37 test files. The supplied verified baseline is 229/229 normal tests and 239/239 PostgreSQL-enabled tests, with build, typecheck, and lint passing. No provider sandbox or live-provider E2E was run.

Primary trace sources:

- [AGENTS.md](../AGENTS.md), especially Week 6 (lines 156-342), location privacy (227-310), and production follow-on (346-483).
- [Week 6/7 Backend task database](<../../_extracted_export/Backend & Database Tasks 66d46e7b9f424dc09fc88aafc155381e.csv>) rows 7-8.
- [Week 6/7 Full-Stack task database](<../../_extracted_export/Full-Stack & Integrations Tasks 1765b4e8dcd14d02ba8ae87b1d59e2ba.csv>) rows 7-8.
- [Master internship task database](<../../_extracted_export/Internship Tasks 40a564fe2c8a4e738eded759ba62f59b_all.csv>) rows 32-43.
- [Product Planning](<../../_extracted_export/Product Planning e296cd360a844ace803814a81eb2a1ca.md>) lines 14-214.
- [Founder Ideas](<../../_extracted_export/Founder Ideas c71bd3bbe0a44100910728a8c60991e1.md>) lines 67-98 and 132-172.
- [Legal & Compliance](<../../_extracted_export/Legal & Compliance cf2ddd28f07146dabd3e079984281942.md>) lines 68-103 and 123-129.
- [Week 2 API contract](<../../MediCN-Weekly-Report/Week2/API-Design.md>) lines 83-154 and 541-930.
- [Week 2 ERD](<../../MediCN-Weekly-Report/Week2/ERD-Database-Backend.md>) lines 10-24 and 75-388.

The status labels below have exact meanings: `IMPLEMENTED_AND_TESTED`, `IMPLEMENTED_NOT_PROVIDER_E2E_TESTED`, `PARTIALLY_IMPLEMENTED`, `SCHEMA_ONLY`, `DOCUMENTED_ONLY`, `FRONTEND_ONLY_REMAINING`, `BLOCKED_BY_BUSINESS_DECISION`, `BLOCKED_BY_PROVIDER_OR_LEGAL_DECISION`, `OUT_OF_SCOPE`, and `NOT_IMPLEMENTED`. A Prisma model alone is never counted as an implementation.

## 1. Executive summary

The Week 6 coursework backend is code-complete and strongly tested, but provider validation is incomplete. Postgres Outbox, BullMQ workers, transactional email, Maps-backed private/public locations, Stripe payment preparation, secure media, Veriff identity, Connect onboarding, delayed host transfers, recovery schedules, readiness, and bounded metrics are real implementations rather than SDK scaffolding.

The backend is not product code-complete. The largest explicit gaps are the inquiry/message API, healthcare-credential review, Admin verification review, and a coherent end-to-end booking lifecycle (user cancellation/refund policy and booking completion). Availability exists through listing create/update/search and booking validation, but lacks an independently manageable calendar/blocked-window workflow. Reviews are schema-only and depend on the missing completion transition. Account disable is schema-only and, more seriously, `disabledAt` is not enforced at authentication.

The initial audit identified three P1 findings, all remediated by Phase 5.6B:

1. A user with `User.disabledAt` set still passes the common authentication lookup and can invoke authenticated business operations.
2. Veriff identity webhook processing wrote the legacy `User.currentVerificationStatus`, although that field originated as healthcare verification and the production instruction explicitly says identity must not imply healthcare affiliation/license verification.
3. `/health/ready` reports failed dependencies in its JSON body but still returns HTTP 200, so a conventional deployment probe will not remove the unhealthy instance from service.

There are no observed P0 findings. Exact public location is withheld; paid-time address snapshots are immutable; full refunds, disputes, and cancellations revoke renter check-in access; provider webhook signatures use untouched raw bytes; payment amounts come from the backend; originals are not published; and sensitive provider fields are allowlisted.

Completion layers must remain distinct:

| Layer | Result |
| --- | --- |
| Week 6 coursework | Code complete; provider E2E outstanding |
| Week 7 coursework | Partial: observability exists; query-scale evidence and messaging/calendar choice remain |
| Backend product code | Not complete |
| Provider E2E | Not complete |
| Production readiness | Not complete; business/legal/provider/deployment blockers remain |

## 2. Week 6 requirement matrix

| Source requirement | Classification | Evidence and remaining work |
| --- | --- | --- |
| Background workers and automated transactional email | `IMPLEMENTED_NOT_PROVIDER_E2E_TESTED` | Postgres Outbox, BullMQ publisher/email worker, durable delivery records, Brevo adapter/webhook/suppression, recovery, smoke command, unit/PG tests. Brevo sender/domain/webhook E2E remains. Source: Backend task CSV row 7; `AGENTS.md` 166-204. |
| Mapping API and basic Stripe payment prep | `IMPLEMENTED_NOT_PROVIDER_E2E_TESTED` | Google provider boundary, geocoding/enrichment, public displacement, payment attempts, raw Stripe webhook inbox, correctness transitions. Google and Stripe Test Mode E2E remain. Source: Full-Stack CSV row 7; `AGENTS.md` 211-342. |
| Async jobs, email delivery, workflow testing | `IMPLEMENTED_AND_TESTED` | Unit suites plus PG concurrency suites cover outbox, job claims, media/maps, bookings, payments, identity, and transfers. Provider sandbox tests remain a different layer. Source: master CSV row 35. |
| Integration setup, secrets, deployment implications | `DOCUMENTED_ONLY` | `.env.example` and phase/runbook docs exist; actual cloud resources and public HTTPS callbacks are not deployed by code. Source: master CSV row 36. |
| In-app notification UI | `FRONTEND_ONLY_REMAINING` | Not a backend requirement for Week 6; no notification-preference contract was required. Source: master CSV row 32; `AGENTS.md` 202-204 explicitly defers preferences. |
| Workflow/content decisions | `DOCUMENTED_ONLY` | Product and legal pages remain planning inputs rather than executable policy. Source: master CSV row 37. |

## 3. Week 7 requirement matrix

| Source requirement | Classification | Evidence and remaining work |
| --- | --- | --- |
| Optimize database queries for performance at scale | `PARTIALLY_IMPLEMENTED` | Pagination, targeted selects, model indexes, bounded worker scans, and PG concurrency tests exist. No production-like dataset, `EXPLAIN (ANALYZE, BUFFERS)` baseline, slow-query budget, or load test proves scale. Source: Backend CSV row 8. |
| Messaging MVP **or** calendar-sync exploration | `IMPLEMENTED_AND_TESTED` | Messaging was selected. Durable participant/read/archive state, REST inquiry/message APIs, ID-only Outbox email, authenticated Socket.IO, Redis adapter, and unit plus gated PostgreSQL/Redis tests are implemented. Calendar sync remains deferred. |
| Enhanced dashboards/profile views | `FRONTEND_ONLY_REMAINING` | Current auth/user/listing/booking APIs supply core data; dashboard UX is frontend. Source: master CSV row 38. |
| Prototype marketplace enhancements | `OUT_OF_SCOPE` | An exploratory QA/product task, not an approved backend contract. Source: master CSV row 41. |
| Observability and implementation notes | `IMPLEMENTED_AND_TESTED` | Protected metrics, Admin operational summary, readiness checks, worker heartbeats, durable job executions, runbook, and scheduler tests exist. Alert routing/deployment remains production work. Source: master CSV row 42. |
| Evaluate usefulness/trade-offs | `DOCUMENTED_ONLY` | Requires a product decision, not code. Source: master CSV row 43. |

## 4. Production follow-on matrix

| Follow-on requirement | Classification | Notes |
| --- | --- | --- |
| Merchant of record, liability, tax, platform fee, payout timing | `BLOCKED_BY_PROVIDER_OR_LEGAL_DECISION` | Fee and delay are configurable, but merchant/liability/tax policy is not decided. `AGENTS.md` 355-368. |
| Hosted/embedded Connect onboarding without bank/tax data in MediCN | `IMPLEMENTED_NOT_PROVIDER_E2E_TESTED` | Accounts v2 recipient flow and safe readiness snapshot exist. |
| Prevent paid bookings until host transfer-ready | `IMPLEMENTED_AND_TESTED` | Checkout requires a stored transfer-ready account; unit coverage exists. |
| Delayed separate transfer plus recorded fee | `IMPLEMENTED_NOT_PROVIDER_E2E_TESTED` | Immutable fee/host-net snapshot, delayed release, stable idempotency, reversal recovery. |
| Payout failure and bank-payout lifecycle | `PARTIALLY_IMPLEMENTED` | MediCN tracks transfers to a connected Stripe balance, not downstream bank payouts or payout webhooks. Provider/product model decision remains. |
| Refund/dispute/reconciliation states | `PARTIALLY_IMPLEMENTED` | Refund/dispute/payment/transfer-reversal states and webhook retries exist. There is no authoritative Stripe polling/reconciliation command or user/Admin case workflow. |
| PostgreSQL double-booking invariant | `IMPLEMENTED_AND_TESTED` | Advisory lock plus conflict query and gated PG concurrency tests. |
| Single active checkout and expiry | `IMPLEMENTED_AND_TESTED` | Durable attempts, stable provider idempotency, expiry sweep, late-event monotonicity. |
| Verify provider amount/currency/identity | `IMPLEMENTED_AND_TESTED` | Checkout/payment/refund/dispute/transfer data are matched before state changes. Provider sandbox remains. |
| Veriff backend boundary, binding, raw HMAC inbox | `IMPLEMENTED_NOT_PROVIDER_E2E_TESTED` | Implemented and mocked; Veriff Sandbox remains. |
| Approved identity gates listing approval, booking, payout | `IMPLEMENTED_AND_TESTED` | Enforced transactionally. |
| Healthcare credential as a separate review workflow | `IMPLEMENTED_AND_TESTED` | Versioned claims, private sanitized evidence, Admin review, opaque durable deletion, and operations visibility are implemented. Identity remains a separate prerequisite and never writes healthcare state. Public production collection remains policy-blocked. |
| Secure processed media and cleanup | `IMPLEMENTED_NOT_PROVIDER_E2E_TESTED` | MIME/magic/decode limits, re-encoding, variants, private ingest, deletion/cleanup. Supabase bucket E2E remains. |
| Production worker/retry/dead-letter operations | `PARTIALLY_IMPLEMENTED` | Durable executions, retries, counts, metrics, scheduler and `jobs:requeue` exist. There is no operator list/detail command that yields failed execution IDs, so dead-letter inspection is incomplete. `AGENTS.md` 455-477. |
| Redis TLS/noeviction/readiness | `IMPLEMENTED_NOT_PROVIDER_E2E_TESTED` | URI/TLS handling and noeviction observation exist; deployed Redis validation remains. |

## 5. Endpoint inventory

All routes are prefixed `/api/v1`. Unless noted, successful values are wrapped as `{data, meta, error}` by `ApiResponseInterceptor`; validation uses whitelist/transform/forbid-unknown. `U` means unit/service test, `PG` gated PostgreSQL integration, `C` controller-boundary test, and `—` no direct endpoint test. Most endpoints have service tests but no full HTTP E2E. Nest defaults are 200 for GET/PATCH/DELETE and 201 for POST.

Inventory shorthand is exact: **auth errors** = `UNAUTHORIZED`, `INVALID_SUPABASE_TOKEN`, `USER_NOT_SYNCED`; **identity errors** = `IDENTITY_VERIFICATION_REQUIRED`, `IDENTITY_VERIFICATION_PENDING`, `IDENTITY_VERIFICATION_REJECTED`, `IDENTITY_VERIFICATION_EXPIRED`; **media/storage errors** = `MEDIA_NOT_CONFIGURED`, `MEDIA_STORAGE_UNAVAILABLE`, `MEDIA_UPLOAD_LIMIT_REACHED`, `MEDIA_UPLOAD_EXPIRED`/legacy `UPLOAD_EXPIRED`, `INPUT_TOO_LARGE`, `PROCESSING_FAILED`; and **prior** means every code listed in the immediately preceding row plus the additional codes shown. Global DTO failures are `VALIDATION_ERROR`; unexpected failures are normalized to `INTERNAL_SERVER_ERROR`.

| Method and route | Authentication / role | Request DTO | Response contract | Main stable errors | Status | Coverage |
| --- | --- | --- | --- | --- | --- | --- |
| GET `/admin/listings` | Bearer; Admin | `ListAdminListingsQueryDto` | inline `{data: AdminListing[], meta, error}` | `UNAUTHORIZED`, `INVALID_SUPABASE_TOKEN`, `FORBIDDEN` | `IMPLEMENTED_AND_TESTED` | `admin.service.spec` U |
| PATCH `/admin/listings/:id/status` | Bearer; Admin | `ModerateListingDto` | inline Admin listing serializer | prior + `NOT_FOUND`, `LISTING_STATUS_NOT_ALLOWED`, `LISTING_LOCATION_NOT_READY`, identity errors | `IMPLEMENTED_AND_TESTED` | `admin.service.spec` U |
| GET `/admin/operations/status` | Bearer; Admin | none | inline outbox/failure/worker summary | auth errors, `FORBIDDEN` | `IMPLEMENTED_AND_TESTED` | indirect operations tests; no C |
| GET `/auth/me` | Supabase Bearer; synced user | none | internal `CurrentUserDto` | `UNAUTHORIZED`, `INVALID_SUPABASE_TOKEN`, `USER_NOT_SYNCED` | `IMPLEMENTED_NOT_PROVIDER_E2E_TESTED` | `auth.service.spec` U |
| POST `/auth/sync` | Supabase Bearer | none; trusted Supabase metadata | `CurrentUserDto` | auth errors, `VALIDATION_ERROR` | `IMPLEMENTED_NOT_PROVIDER_E2E_TESTED` | `auth.service.spec` U |
| POST `/bookings` | Bearer; Renter (Admin accepted by code), verified email + identity | `CreateBookingDto` | inline booking serializer | auth, `FORBIDDEN`, identity errors, `EMAIL_NOT_VERIFIED`, `NOT_FOUND`, `LISTING_LOCATION_NOT_READY`, `BOOKING_NOT_AVAILABLE`, `VALIDATION_ERROR` | `IMPLEMENTED_AND_TESTED` | `bookings.service.spec` U + `bookings.concurrency.integration` PG |
| GET `/bookings` | Bearer; party bookings, Admin gets all | none | inline `{data: Booking[], meta}` without exact location | auth errors | `IMPLEMENTED_AND_TESTED` | `bookings.service.spec` U |
| GET `/bookings/:id` | Bearer; Renter/Host party or Admin | none | booking + optional `CheckInLocationDto` | auth, `NOT_FOUND`, `FORBIDDEN` | `IMPLEMENTED_AND_TESTED` | `bookings.service.spec` U |
| PATCH `/bookings/:id/status` | Bearer; booking Host or Admin | `UpdateBookingStatusDto` (`accepted|rejected`) | booking serializer | auth, `NOT_FOUND`, `FORBIDDEN`, `BOOKING_STATUS_NOT_ALLOWED` | `IMPLEMENTED_AND_TESTED` | `bookings.service.spec` U |
| POST `/webhooks/brevo/transactional` | Exact bearer webhook token | provider JSON | normalized receipt, explicit 200 | `WEBHOOK_UNAUTHORIZED`, `INVALID_WEBHOOK_PAYLOAD` | `IMPLEMENTED_NOT_PROVIDER_E2E_TESTED` | `email-webhook.spec` U |
| GET `/health` | public | none | inline liveness, enveloped | generic 500 | `IMPLEMENTED_AND_TESTED` | `health.spec` C |
| GET `/health/live` | public | none | same as `/health` | generic 500 | `IMPLEMENTED_AND_TESTED` | indirect C |
| GET `/health/ready` | public | none | DB/Redis/email readiness, enveloped | generic 500 | `IMPLEMENTED_AND_TESTED` | service behavior indirect; no HTTP E2E |
| POST `/identity/verifications/session` | Bearer; any synced user | none | private `toSessionDto` allowlist | auth, `VERIFF_NOT_CONFIGURED`, `VERIFF_PROVIDER_UNAVAILABLE` | `IMPLEMENTED_NOT_PROVIDER_E2E_TESTED` | `identity.service`, `veriff.provider`, PG concurrency |
| GET `/identity/verifications/current` | Bearer | none | private `toSummary` guidance | auth errors | `IMPLEMENTED_NOT_PROVIDER_E2E_TESTED` | `identity.service.spec` U |
| POST `/webhooks/veriff/events` | `X-AUTH-CLIENT` + raw-body HMAC | provider raw JSON | inbox processing acknowledgement | `INVALID_VERIFF_SIGNATURE` | `IMPLEMENTED_NOT_PROVIDER_E2E_TESTED` | `identity.service`, `veriff.provider` U |
| POST `/webhooks/veriff/decisions` | same | provider raw JSON | same | `INVALID_VERIFF_SIGNATURE` | `IMPLEMENTED_NOT_PROVIDER_E2E_TESTED` | same |
| GET `/listings` | public | `SearchListingsQueryDto` | inline paged public summaries | `VALIDATION_ERROR` | `IMPLEMENTED_AND_TESTED` | `listings.service.spec` U |
| GET `/listings/mine` | Bearer; owner scope | `ListMyListingsQueryDto` | paged owner summaries | auth errors | `IMPLEMENTED_AND_TESTED` | `listings.service.spec` U |
| GET `/listings/:id` | public for approved; Bearer owner/Admin for non-public | none | inline detail using `PublicListingLocationDto`; exact only owner/Admin | `NOT_FOUND`, auth errors | `IMPLEMENTED_AND_TESTED` | `listings.service.spec` U |
| POST `/listings` | Bearer; Host; identity is checked later at Admin approval | `CreateListingDto` | inline `{id,status}` | auth, `FORBIDDEN`, `LISTING_LOCATION_INVALID`, `VALIDATION_ERROR`, provider validation errors | `IMPLEMENTED_NOT_PROVIDER_E2E_TESTED` | `listings`, `maps`, `location` U |
| PATCH `/listings/:id` | Bearer; owner Host or Admin | `UpdateListingDto` | inline listing detail | auth, `NOT_FOUND`, `FORBIDDEN`, `LISTING_LOCATION_CHANGE_BLOCKED`, `LISTING_LOCATION_INVALID` | `IMPLEMENTED_NOT_PROVIDER_E2E_TESTED` | `listings.service.spec` U |
| DELETE `/listings/:id` | Bearer; owner Host or Admin | none | inline `{id,status,deletedAt}` | auth, `NOT_FOUND`, `FORBIDDEN`, `LISTING_ARCHIVE_BLOCKED_BY_ACTIVE_BOOKINGS` | `IMPLEMENTED_AND_TESTED` | `listings.service.spec` U plus archive/location PG race |
| POST `/listings/:id/photos` | Bearer; owner Host or Admin in service | `AddListingPhotoDto` | inline photo serializer | auth, `NOT_FOUND`, `FORBIDDEN`, `MEDIA_PROCESSING_REQUIRED`, `VALIDATION_ERROR` | `IMPLEMENTED_AND_TESTED` | `listings.service.spec` U |
| PATCH `/listings/:listingId/photos/:photoId/order` | Bearer; owner or Admin | `ReorderMediaDto` | inline photo/order | auth, `NOT_FOUND`, `FORBIDDEN`, `VALIDATION_ERROR` | `IMPLEMENTED_AND_TESTED` | media service coverage is incomplete for reorder |
| DELETE `/listings/:listingId/photos/:photoId` | Bearer; owner or Admin | none | inline deletion result | auth, `NOT_FOUND`, `FORBIDDEN` | `IMPLEMENTED_AND_TESTED` | media deletion indirectly covered |
| DELETE `/users/me/profile-photo` | Bearer; self | none | inline deletion result | auth, media errors | `IMPLEMENTED_AND_TESTED` | users/media U |
| GET `/metrics` | exact metrics bearer; feature flag | none | Prometheus text, not envelope | `NOT_FOUND`, `METRICS_UNAUTHORIZED` | `IMPLEMENTED_AND_TESTED` | `metrics-auth.spec` U; collection no direct test |
| POST `/connect/account` | Bearer; Host self or Admin-targeted Host | `CreateConnectedAccountDto` | private `toSafeAccount` | auth, `FORBIDDEN`, `VALIDATION_ERROR`, `CONNECT_NOT_CONFIGURED` | `IMPLEMENTED_NOT_PROVIDER_E2E_TESTED` | `connect.service`, `stripe.service` U |
| POST `/connect/onboarding-link` | same | `ConnectAccountTargetDto` | allowlisted hosted URL/expiry | prior + `NOT_FOUND` | `IMPLEMENTED_NOT_PROVIDER_E2E_TESTED` | `connect.service` U |
| GET `/connect/account` | same | query `ConnectAccountTargetDto` | safe synchronized account | prior + provider errors | `IMPLEMENTED_NOT_PROVIDER_E2E_TESTED` | `connect.service` U |
| POST `/connect/management-link` | same | `ConnectAccountTargetDto` | allowlisted hosted URL/expiry | prior + `CONNECT_ONBOARDING_REQUIRED` | `IMPLEMENTED_NOT_PROVIDER_E2E_TESTED` | `connect`, `stripe` U |
| POST `/payments/checkout-session` | Bearer; booking Renter, email + identity; Host Connect-ready | `CreateCheckoutSessionDto` | `CheckoutSessionDto` (`checkoutSessionId`, `checkoutUrl`, ISO `expiresAt`); success/cancel return `bookingId` is a locator only | auth, identity/email errors, `FORBIDDEN`, `NOT_FOUND`, `BOOKING_NOT_AVAILABLE`, `HOST_PAYOUT_ACCOUNT_NOT_READY`, `PAYMENT_FAILED` | `IMPLEMENTED_NOT_PROVIDER_E2E_TESTED` | `payments.service`, `stripe.service`, OpenAPI contract U |
| POST `/webhooks/stripe` | raw body + Stripe signature | provider raw JSON | acknowledgement | `VALIDATION_ERROR`, `WEBHOOK_SIGNATURE_INVALID` | `IMPLEMENTED_NOT_PROVIDER_E2E_TESTED` | `payments.controller` C; payments/stripe U |
| POST `/uploads/presigned-url` | Bearer; self; listing ownership for listing media | `CreatePresignedUploadDto` | inline intent/upload contract | auth, `FORBIDDEN`, `NOT_FOUND`, `MEDIA_NOT_CONFIGURED`, `MEDIA_UPLOAD_LIMIT_REACHED`, `VALIDATION_ERROR` | `IMPLEMENTED_NOT_PROVIDER_E2E_TESTED` | uploads/media U |
| POST `/uploads/:intentId/complete` | Bearer; asset owner/Admin | none | safe asset status | auth, `NOT_FOUND`, `FORBIDDEN`, `UPLOAD_EXPIRED`, `INPUT_TOO_LARGE`, storage errors | `IMPLEMENTED_NOT_PROVIDER_E2E_TESTED` | media U + PG concurrency |
| GET `/uploads/:intentId` | Bearer; asset owner/Admin | none | safe asset/variant status | auth, `NOT_FOUND`, `FORBIDDEN` | `IMPLEMENTED_NOT_PROVIDER_E2E_TESTED` | uploads/media U |
| DELETE `/uploads/:assetId` | Bearer; asset owner/Admin | none | deletion result | auth, `NOT_FOUND`, `FORBIDDEN` | `IMPLEMENTED_NOT_PROVIDER_E2E_TESTED` | uploads/media U |
| POST `/listings/:listingId/inquiries` | Bearer; verified Renter | `MessageBodyDto` | safe inquiry plus first message | auth, `FORBIDDEN`, `EMAIL_NOT_VERIFIED`, `INQUIRY_NOT_AVAILABLE`, `INQUIRY_ALREADY_OPEN`, contact/validation errors | `IMPLEMENTED_AND_TESTED` | messaging U + PG |
| GET `/inquiries` | Bearer; captured party/Admin | `ListInquiriesQueryDto` | paged safe summaries with unread/archive state | auth errors, `VALIDATION_ERROR` | `IMPLEMENTED_AND_TESTED` | messaging U |
| GET `/inquiries/:id` | Bearer; captured party/Admin | `InquiryMessagesQueryDto` | safe detail and sequence cursor page | auth errors, opaque `NOT_FOUND`, `VALIDATION_ERROR` | `IMPLEMENTED_AND_TESTED` | messaging U |
| POST `/inquiries/:id/messages` | Bearer; enabled captured party/Admin | `MessageBodyDto` | safe message | auth, opaque `NOT_FOUND`, `FORBIDDEN`, `INQUIRY_CLOSED`, contact/validation errors | `IMPLEMENTED_AND_TESTED` | messaging U + PG rollback |
| POST `/inquiries/:id/read` | Bearer; captured party/Admin | `ReadInquiryDto` | bounded monotonic cursor/unread | auth, opaque `NOT_FOUND`, `VALIDATION_ERROR` | `IMPLEMENTED_AND_TESTED` | messaging U + PG |
| POST `/inquiries/:id/close` | Bearer; captured party/Admin | none | idempotent close state | auth, opaque `NOT_FOUND` | `IMPLEMENTED_AND_TESTED` | messaging U |
| POST `/inquiries/:id/archive` | Bearer; captured party/Admin | `ArchiveInquiryDto` | actor-only archive state | auth, opaque `NOT_FOUND`, `VALIDATION_ERROR` | `IMPLEMENTED_AND_TESTED` | messaging U |
| GET `/users/:id` | public; active users only | none | `PublicUserDto` allowlist | `NOT_FOUND` | `IMPLEMENTED_AND_TESTED` | users C + U |
| PATCH `/users/me` | Bearer; self | `UpdateCurrentUserDto` | `CurrentUserDto` | auth, `MEDIA_PROCESSING_REQUIRED`, `VALIDATION_ERROR` | `IMPLEMENTED_AND_TESTED` | users U |

API contract gaps: response shapes are mostly private TypeScript return types/inline serializers rather than exported response DTOs; there is no generated OpenAPI contract or full HTTP authorization/error suite. The exception filter's `ApiErrorCode` union predates many runtime codes, although structured codes still pass through correctly.

## 6. Worker, command, scheduler, and code inventory

### Runtime workers

| Command | Runtime ownership | Durable behavior | Test status |
| --- | --- | --- | --- |
| `worker:outbox` | DB poller; claims/publishes Outbox rows | leases, retries, stable job IDs | U + PG |
| `worker:email` | BullMQ `email` | delivery record, suppression, Brevo/local adapter | U; no Brevo E2E |
| `worker:media` | BullMQ `media` | process/cleanup, durable executions | U + PG; no Supabase E2E |
| `worker:maps` | BullMQ `maps` | versioned enrichment | U + PG; no Google E2E |
| `worker:operations` | BullMQ `operations`; sole recurring scheduler owner | ten recurring maintenance jobs | U; deployment pending |

### Commands

| Command | Purpose |
| --- | --- |
| `jobs:recover` | Recover expired outbox claims and stale executions |
| `jobs:requeue -- <JobExecutionId>` | Explicitly republish/requeue a failed durable job |
| `email:webhook-retry` | Retry failed Brevo inbox rows |
| `payments:webhook-retry` | Retry failed/crash-left Stripe inbox rows |
| `payments:expire-checkouts` | Expire attempts and release inventory |
| `payments:release-host-transfers` | Release eligible transfers/reversals |
| `identity:webhook-retry` | Retry Veriff inbox rows |
| `maps:retry`, `maps:refresh` | Recover failed / refresh expired location enrichment |
| `media:retry`, `media:cleanup` | Recover processing / clean due objects |
| `smoke:email` | Local/provider email smoke path; no live run in this audit |
| `admin:grant` | guarded Admin bootstrap (`ALLOW_ADMIN_BOOTSTRAP`) |

### Recurring schedules

The operations worker owns stable BullMQ scheduler IDs for: `stripe_webhook_retry`, `checkout_expiry`, `host_transfer_release`, `veriff_webhook_retry`, `media_recovery`, `media_cleanup`, `maps_recovery`, `maps_refresh`, `brevo_webhook_retry`, and `stale_operational_recovery`. Recovery jobs use `OPERATIONS_RECOVERY_INTERVAL_MS`; maintenance jobs use `OPERATIONS_MAINTENANCE_INTERVAL_MS`. No duplicate scheduler owner was found.

### Controllers, DTOs, modules, services, and models

- Controllers include separate subject and Admin healthcare-verification controllers in addition to the pre-Phase-5.7B inventory.
- DTOs include strict healthcare claim, upload-intent, review-list, and decision boundaries.
- Modules include the `HealthcareModule`; its services own subject lifecycle, Admin review, and durable evidence deletion.
- Prisma models add `HealthcareVerificationEvidence` and extend `HealthcareVerification` with versioned claim, decision, and deletion lifecycle metadata.

Schema-only/application-workflow status: `Review` has no complete service or
API. `HealthcareVerification` now has the Phase 5.7B subject/Admin/private-media
workflow. `Inquiry` and
`Message` now have the Phase 5.7A REST/realtime workflow. `ListingAvailability`
is not schema-only: it is written on listing create/update, searched,
serialized, and enforced at booking creation, but has no dedicated calendar
workflow. `AdminAction` is write-only audit data with no read API. `Payment` and
`HostTransfer` are fully active operational models, but have no user/Admin read
API.

### Feature gates and modes

`PAYMENTS_ENABLED`, `STRIPE_CONNECT_ENABLED`, `VERIFF_ENABLED`, `MEDIA_PROCESSING_ENABLED`, `MAPS_ENABLED`, `TRANSACTIONAL_EMAIL_ENABLED`, `OPERATIONS_SCHEDULER_ENABLED`, `OPERATIONS_METRICS_ENABLED`, `ALLOW_ADMIN_BOOTSTRAP`, and `EMAIL_PROVIDER=local|brevo`. Provider-specific production configuration is startup-validated; Redis is required when queue-backed features are enabled.

## 7. Missing product workflows

| Workflow | Requirement conclusion | Classification | Exact source and current reality |
| --- | --- | --- | --- |
| Renter/Host cancellation | ADR-006 accepted subset implemented; paid-Renter economics still require policy | `PARTIALLY_IMPLEMENTED` | `POST /bookings/:id/cancel` supports accepted immediate/unsettled and paid Host/Admin cases with durable operations. Paid-Renter self-service remains stable-error blocked. |
| Cancellation-triggered refunds | Full refund is accepted for paid Host/Admin cancellation | `IMPLEMENTED_NOT_PROVIDER_E2E_TESTED` | Outbox/BullMQ requests stored-payment full refund and webhook confirmation remains authoritative. Percent/partial paid-Renter policy and liability are unresolved. |
| Inquiries and renter/Host messaging | Selected Phase 5.7A branch | `IMPLEMENTED_AND_TESTED` | Create/list/detail/send/read/close/archive contracts, participant/Admin authorization, transactional messages/notifications, and post-commit realtime events are implemented. |
| Message authorization/unread | Required by Phase 5.7A | `IMPLEMENTED_AND_TESTED` | Per-user PostgreSQL read cursors and archive state replace legacy `Message.readAt` and global archive semantics; opaque horizontal-access tests exist. |
| Listing availability/calendar | ADR-009 local calendar implemented; external sync is future | `IMPLEMENTED_AND_TESTED` | Dedicated `available|blocked` CRUD, private reservation projection, public unavailable-only projection, authoritative timezones, safe edits, public search, and PG race tests are implemented. Recurrence/external sync remain deferred. |
| Booking completion | Necessary dependency for contracted review creation; transition mechanism unspecified | `NOT_IMPLEMENTED` | Week 2 ERD 303-313 and Review API 781-796. Enum/transition allowance exists; no endpoint/scheduler/service action. |
| Renter/Host reviews | Conflicting source priority needs decision | `BLOCKED_BY_BUSINESS_DECISION` | Week 2 API 138-143 makes listing review create required after completion; Product Planning 204-214 calls user reviews future roadmap. `Review` is schema-only. |
| Healthcare credential/affiliation verification | Explicit must-have and must be separate from identity | `IMPLEMENTED_AND_TESTED` | ADR-016's temporary private image evidence, sanitized derivative, subject history, and durable deletion are implemented. Public production collection remains policy-blocked. |
| Admin verification review | Explicit | `IMPLEMENTED_AND_TESTED` | Bounded list/detail, audited <=60-second derivative access, and row-locked atomic approval/rejection are implemented. |
| Listing archive/hide/delete | Ordinary archive correctness is implemented; hide/restore lifecycle is not | `PARTIALLY_IMPLEMENTED` | DELETE soft-archives and now serializes with booking creation, blocking future active obligations while preserving participant history. Admin emergency hide and restoration remain deferred. |
| Account disable | Existing disabled accounts are enforced; Admin mutation endpoint remains out of scope | `PARTIALLY_IMPLEMENTED` | Shared request authentication rejects `disabledAt` with `ACCOUNT_DISABLED`. No Admin disable endpoint was added in Phase 5.6B. |
| Account deletion/data erasure | Legal/privacy decision required, not an approved API | `BLOCKED_BY_PROVIDER_OR_LEGAL_DECISION` | Legal page 84-95 says privacy policy is draft-needed. No contract defines retention, financial/audit preservation, or deletion. |
| Notification preferences | Deferred, not current scope | `OUT_OF_SCOPE` | `AGENTS.md` 202-204 explicitly defers final copy/preferences until product flows exist. |
| Favorite/saved listings | Future roadmap | `OUT_OF_SCOPE` | Product Planning 204-214. No model/API is expected now. |
| Payment reconciliation | Operational correctness required | `PARTIALLY_IMPLEMENTED` | `AGENTS.md` 367-392. Durable inbox/retry/monotonic transitions exist; authoritative provider polling and Admin reconciliation UI/API do not. |
| Stripe bank payout lifecycle | Production decision/provider boundary | `BLOCKED_BY_PROVIDER_OR_LEGAL_DECISION` | `AGENTS.md` 355-369. MediCN releases Stripe Transfers and observes payout readiness; it does not track bank payout events/failures. |
| Tax reporting | Explicit decision before live money | `BLOCKED_BY_PROVIDER_OR_LEGAL_DECISION` | `AGENTS.md` 355-358. No tax workflow should be invented before legal/Stripe-account model decisions. |
| Property verification | Explicitly not implied by Veriff; no approved workflow | `OUT_OF_SCOPE` | `AGENTS.md` 399-403. A future product decision is required before implementation. |
| Support/dispute workflow | Provider state exists; operational/user case handling is not defined | `BLOCKED_BY_PROVIDER_OR_LEGAL_DECISION` | Stripe dispute transitions and operations email exist. Legal page 70-80 still requires a dispute-resolution policy; no case/ticket/Admin resolution API is specified. |

## 8. Cross-feature correctness findings

| Severity | Finding | Concrete code evidence / consequence |
| --- | --- | --- |
| Pass | Identity and healthcare status are separate | [identity.service.ts](../apps/api/src/identity/identity.service.ts) writes only identity records. [auth.service.ts](../apps/api/src/auth/auth.service.ts) returns separate identity and healthcare summaries; the legacy alias is healthcare-only. |
| Pass | Disabled accounts are rejected | [auth.service.ts](../apps/api/src/auth/auth.service.ts) enforces `disabledAt` at the shared request-authentication lookup and during sync. |
| Pass | Host publication requires verified email | [admin.service.ts](../apps/api/src/admin/admin.service.ts) requires the current row-locked Host `emailVerifiedAt` for approval. Draft/pending edits and Admin rejection remain available. |
| Resolved in Phase 5.8A for accepted ADR-006 scope | Cancellation/refund initiation | [bookings.controller.ts](../apps/api/src/bookings/bookings.controller.ts) exposes the authenticated idempotent cancellation command; [booking-cancellations.service.ts](../apps/api/src/payments/booking-cancellations.service.ts) serializes durable no-payment, Checkout-expiry, full-refund, and transfer-reversal orchestration. Paid-Renter economics remain deliberately blocked. |
| Resolved in Phase 5.7C | Partial-refund location policy | [bookings.service.ts](../apps/api/src/bookings/bookings.service.ts) implements ADR-007: active partially refunded fulfillment retains snapshot access, while cancellation, full/cumulative refund, dispute, missing snapshot, unrelated ownership, and unpaid state fail closed. |
| Resolved in Phase 5.8B | Availability could diverge from reservations | [listing-availability.service.ts](../apps/api/src/listings/listing-availability.service.ts) and [bookings.service.ts](../apps/api/src/bookings/bookings.service.ts) share the listing lock and authoritative reservation rules. Unsafe bulk replacement is rejected; dedicated safe edits and opaque projections are PostgreSQL-tested. |
| Resolved in Phase 5.7C | Ordinary archive did not account for active bookings | `deleteListing` implements ADR-008 with the booking-create advisory lock, database time, an exact future-active status set, private-safe conflict response, and preserved participant history. Emergency hide/restore is still a separate gap. |
| Pass | Address changes and paid snapshots | `assertLocationChangeAllowed` blocks active accepted/payment-pending/paid future reservations; payment success creates `BookingLocationSnapshot`; PG tests prove later listing moves do not mutate it. |
| Pass | Refunded/disputed/cancelled check-in revocation | Booking detail requires status `paid|completed`, at least one paid payment, and no full-refund/dispute. Full refund/dispute also cancels. Tests cover all three. |
| Pass | Host identity and Connect eligibility | Listing approval, booking, checkout, and transfer paths all use approved identity; checkout additionally requires Host transfer readiness. |
| P2 | Suppression can silence the only configured operational email | [email.service.ts](../apps/api/src/email/email.service.ts) applies active suppression uniformly. Dispute/transfer-failure emails have no bypass; metrics exist, but no deployed alert channel is defined. This is operationally safe only if monitoring alerts are independently routed. |
| Pass | Readiness uses deployment-safe HTTP semantics | [health.controller.ts](../apps/api/src/health/health.controller.ts) maps `ready` to HTTP 200 and `not_ready` to HTTP 503 without discarding the safe dependency summary or response envelope. |
| Pass | Scheduler ownership | Only `worker:operations`, when `OPERATIONS_SCHEDULER_ENABLED`, upserts the eleven stable scheduler IDs, including booking-cancellation recovery. Domain workers do not create repeat jobs. |
| Pass | Webhook monotonicity | Stripe and Veriff use durable inbox rows, aggregate locks/claims, allowlisted transitions, provider timestamps, and explicit retry. Brevo delivery state is monotonic and deduplicated. |
| Pass | Admin boundaries | Admin listing/operations and Connect cross-user actions perform backend role checks; Admin grant is separately gated. |
| Pass | Operational inspection and repair | Phase 5.9A adds Admin-only bounded Payment, HostTransfer, JobExecution/dead-letter, and command views; audited idempotent inspect-to-requeue; explicit stale reconciliation; safe metrics; and PostgreSQL command/Outbox/race tests. No request can supply an arbitrary queue or payload. |
| Pass | Profile/media deletion | Processed profile/listing media is soft-deleted, detached, and durably queued for object cleanup; legacy URLs are detached but external legacy object ownership cannot be guaranteed. |

## 9. Security and privacy findings

### P0 critical

None observed.

### P1 high

None remaining from the initial audit after Phase 5.6B.

### P2 medium

1. **Private-resource enumeration:** booking and media paths fetch by ID and return `FORBIDDEN` to unrelated authenticated users, while missing IDs return `NOT_FOUND`. Listing private reads correctly collapse unauthorized to 404. Tests currently assert booking 403. Prefer policy-consistent 404 for opaque private IDs unless the caller already has a relationship.
2. **No API rate limiter:** Helmet, CORS, size/semantic limits, idempotency, and provider timeouts exist, but there is no per-user/IP throttling for auth sync, upload intents, Veriff session creation, Connect links, checkout, or webhooks. Add only with proxy/IP and provider-retry semantics defined.
3. **Existing-listing email policy remains undecided:** new approval now requires verified Host email, but Phase 5.6B intentionally does not hide already-approved listings if a Host is unverified later.
4. **Partial-refund exact-location ambiguity (resolved in Phase 5.7C):** ADR-007 is implemented and covered by fail-closed unit and PostgreSQL transition tests.
5. **Critical email versus suppression:** an independently deployed alert path is needed for payment/transfer failures.
6. **Readiness blind spots:** `/health/ready` checks PostgreSQL, Redis, and email configuration, but not Stripe/Veriff/Google enabled configuration or worker-heartbeat freshness. Startup validation catches missing production keys, not runtime provider reachability or worker absence.

### P3 low

1. Stable error-code unions were reconciled in Phase 5.6B; future endpoint additions still need the same contract discipline.
2. Most authorization is service-layer/manual rather than declarative guards. It is presently consistent, but easier to omit on new endpoints; HTTP authorization tests are sparse.

### Confirmed protections

- `.env` is ignored; `.env.example` has empty/placeholders for secrets; browser source contains no server-secret identifiers.
- Public listing serializers expose displaced approximate coordinates and omit exact address/coordinates/unsafe place origins.
- No Veriff document image or document payload is stored; only opaque IDs, status, allowlisted reason metadata, and inbox payload needed for processing are persisted.
- Media publishes re-encoded variants only; ingest originals remain private and are cleaned.
- Checkout trusts stored backend amount/currency/fee snapshots, never a frontend amount.
- Stripe and Veriff trust only verified untouched raw-body webhooks; Brevo requires an exact bearer token.
- Host/Admin operations have backend role/ownership checks.
- Metrics labels are bounded; no booking/user/listing/provider IDs appear as Prometheus labels.
- Full refund, dispute, rejection, cancellation, missing snapshot, and unpaid state fail closed for renter exact-location access.

## 10. Provider and legal blockers

| Blocker | Kind | Exit evidence required |
| --- | --- | --- |
| Stripe Test Mode and Connect Accounts v2 recipient access | Provider | Project enabled; hosted onboarding, checkout, async success/failure, refund, dispute, delayed transfer, reversal, and failure scenarios exercised with persisted evidence. |
| Veriff Sandbox | Provider | Signed event/decision callbacks, retry/resubmission/expiry, out-of-order delivery, and vendor binding verified. |
| Supabase buckets | Provider/deployment | Private ingest plus correct processed public/private policy, signed upload, cleanup, and access-policy tests. |
| Redis TLS/noeviction/workers | Deployment | Managed `rediss://`, auth, `noeviction`, persistence/HA decision, all five processes supervised, graceful shutdown and restart drill. |
| Brevo sender/domain/webhook | Provider | Domain authentication, sender approval, HTTPS webhook bearer, delivered/bounce/complaint tests, suppression and retry evidence. |
| Google API keys/billing/quota | Provider | Server key restricted to APIs/egress, browser key restricted to origins, billing/quota alerts, timeout/rate budget exercised. |
| Google Maps retention/licensing | Legal/provider | Counsel/product approves stored fields, TTLs, attribution, display, and refresh/deletion policy. |
| Public HTTPS webhook URLs | Deployment | Stable TLS endpoints, proxy raw-body preservation, secret rotation, replay/load limits, provider delivery verified. |
| Secrets management | Deployment | Managed secret store, least privilege, rotation/runbook, no shared developer/live keys. |
| Scheduler deployment | Deployment | Exactly one logical scheduler owner (multiple replicas safe through stable IDs), clock/interval policy, restart and duplicate-job evidence. |
| Monitoring/alert delivery | Deployment | Scraping configured; alerts for stale workers, queue/outbox age, webhook backlog, provider error rate, transfer failure, and suppressed operations email routed to an independent on-call channel. |
| Merchant/refund/dispute/tax/payout policy | Business/legal | Signed decision defines merchant, fees, cancellation windows, partial refunds, chargeback handling, tax reporting, transfer/bank-payout responsibility. |
| Privacy/ToS/listing/dispute policies | Legal | Attorney-reviewed policies, retention/erasure rules, consent and support process. |
| `pg` 9 / Prisma adapter warning | Dependency | Track Prisma adapter compatibility; rerun traced PG concurrency suites before a `pg` 9 upgrade. The current `pg@8.21.0` baseline passes. See [worker runbook](worker-operations-runbook.md). |
| Moderate npm advisories | Dependency | Phase 5.8B `npm audit --omit=dev` reports five moderate nodes and no high/critical findings; offered Prisma/Next remediations are breaking downgrades. Track upstream fixes and do not force them. |

## 11. Testing gaps

| Requirement area | Unit | PostgreSQL integration | Provider sandbox | Frontend/manual E2E | Gap |
| --- | --- | --- | --- | --- | --- |
| Auth/profile/roles | Yes | No | No Supabase E2E | No | Disabled-user shared-boundary and representative protected-flow tests exist; broader real Supabase HTTP auth matrix remains. |
| Listings/Admin | Yes | Location, archive, availability, and booking/calendar races | Google missing | No | Local calendar CRUD/search/projection is PostgreSQL-tested; emergency hide/restore and external calendar sync remain unimplemented. |
| Booking/conflicts/access | Yes | Yes, including cancellation races | n/a | No | Cancellation framework is covered; completion/reviews and an HTTP route E2E remain. |
| Stripe checkout/webhooks | Extensive, including explicit mocked reconciliation | webhook/completion and webhook/reconciliation races | Missing | No | Test Mode async methods, public HTTPS/raw proxy, and provider sandbox certification remain. |
| Connect/transfers | Extensive, including transfer/reversal reconciliation | transfer and command concurrency | Missing | No | Accounts v2 access, onboarding return, and real Test Mode transfer/reversal scenarios remain. A Stripe Transfer is not bank payout evidence. |
| Identity | Extensive | session concurrency/separation | Missing | No | Sandbox callbacks and separate credential workflow. |
| Media | Extensive | completion/claim concurrency | Supabase missing | No | Real bucket RLS/policies, signed upload, cleanup, browser variant render. |
| Maps/location privacy | Extensive | enrichment/snapshot concurrency | Google missing | No | Real key restrictions/quota and map disclosure UX. |
| Outbox/workers/email | Extensive | outbox concurrency | Redis/Brevo missing | No | Managed Redis restart/eviction, Brevo delivery chain, independent alerts. |
| Health/metrics/operations | Admin inspection, durable requeue/reconciliation, privacy, metrics | command/Outbox rollback and concurrent claim plus HTTP readiness | deployment missing | Manual ops drill missing | Provider sandbox, metrics scraping/alerts, scheduler restart, and a supervised incident drill remain. |
| Inquiry/message | Yes | Gated concurrency/rollback/cursor | Gated two-instance Redis | Frontend deferred | Backend MVP implemented; managed Redis/proxy and formal frontend E2E remain. |
| Healthcare/Admin verification | Subject/Admin/media/deletion allowlists and failure paths | Gated create/decision concurrency and transactional side effects | Real private-bucket policy/provider behavior remains uncertified | Frontend deferred | Backend workflow implemented; cloud privacy operations and public-production approvals remain. |

Missing automated tests are not the same as missing provider E2E. The Phase
5.7A 272-test normal / 288-test combined gated baseline was evidence for implemented
application logic, but it cannot validate cloud configuration, provider account
capability, DNS/TLS/webhook routing, bucket policy, deliverability, quota, or
legal policy.

The Phase 5.9A local validation baseline is 425 normal passing tests (54 gated
skips), 478 passing tests with the PostgreSQL gate (one Redis-only skip), and
426 passing tests with the Redis gate (53 PostgreSQL-only skips), across 479
defined tests. Provider behavior remains mocked; these totals are not provider
sandbox or Live Mode certification.

## 12. Recommended implementation order

1. Fix shared disabled-user enforcement and failing readiness HTTP semantics, decide/enforce the listing-publication email gate, and separate healthcare status from identity, with a data migration/backfill plan reviewed before code changes.
2. Obtain product/legal decisions for cancellation/refund initiation and economics,
   merchant/tax/payout responsibility, emergency hide/restoration, and calendar
   synchronization. ADR-007/ADR-008 and the messaging branch are implemented.
3. If messaging is selected, implement inquiry/message/read authorization before reviews; it is the documented connection-layer bottleneck.
4. Implement healthcare credential submission/status/Admin review independently of Veriff identity.
5. Complete booking lifecycle and local availability management: cancel policy, completion transition, blocked windows, reservation projection, then reviews if approved.
6. Add Admin/user operational read contracts for payments/transfers and inspect-to-requeue; then add provider reconciliation if the chosen Stripe model needs it.
7. Expand HTTP authorization/error tests, scale-query evidence, and operations metrics tests.
8. Only then execute provider sandbox and deployment-readiness phases; do not couple live money enablement to feature development.

## 13. Frontend handoff blockers

- `currentVerificationStatus` is a deprecated healthcare-only alias. Use
  `identityVerification` for identity and `healthcareVerification.status` for
  future healthcare UI. The Phase 5.7B subject and Admin APIs are documented in
  `phase-5.7B-healthcare-evidence.md`; formal frontend integration is deferred.
- Inquiry/message/unread REST and `/messaging` Socket.IO contracts are available;
  the formal frontend still needs sequence catch-up and duplicate-event handling.
- The cancellation endpoint is available for ADR-006's accepted subset;
  frontend integration is deferred and paid-Renter cancellation remains
  policy-blocked. No booking completion endpoint exists.
- Review UI cannot be enabled because creation API and completion transition are absent.
- Dedicated Host/Admin available/blocked CRUD and private/public calendar
  projections are available; frontend calendar integration remains deferred.
- There is no account disable/delete/preferences/favorites contract.
- Booking participants have a safe booking-scoped payment lifecycle summary;
  Admins have bounded Payment/HostTransfer operational views. Frontend
  integration remains intentionally deferred.
- Exact location must be read only from authorized booking detail `checkInLocation`; never reconstruct it from listing/map data.
- Frontend must handle feature-disabled/provider-unavailable stable errors and asynchronous media/identity/payment states.
- Provider-return screens are not evidence of success; the UI must wait for synchronized/webhook-backed state.

## 14. Definition of backend code-complete

Backend code-complete means all approved—not speculative—product workflows have a tested server contract and durable state policy. At minimum:

- P1 findings are fixed and covered by unit plus PG tests where state races matter.
- Product/legal decisions are recorded for cancellation/refund economics,
  emergency hide/restoration, merchant/tax/payout responsibility, and deferred
  calendar work. Partial-refund access, ordinary archive, and the messaging
  branch already have implemented decisions.
- Chosen messaging/calendar scope is implemented or explicitly removed from the milestone.
- Healthcare credential and Admin review are separate from Veriff identity.
- Booking cancellation/completion and availability behavior are coherent; reviews are implemented or explicitly deferred by an updated source decision.
- Every private endpoint has consistent opaque-resource behavior and an HTTP auth/error test matrix.
- Failed jobs can be inspected and requeued without ad hoc database discovery.
- Response DTO/API documentation is stable enough for frontend integration.
- Build, typecheck, lint, normal tests, and PostgreSQL-enabled tests pass with current migrations.

This definition does not require provider credentials or live money; those belong to production readiness.

## 15. Definition of production-ready

Production-ready additionally means:

- Attorney/product decisions and public policies are approved.
- Stripe, Veriff, Supabase, Google, Brevo, and managed Redis sandbox/deployment matrices pass without exposing live secrets or money in automated unit tests.
- Public HTTPS callbacks preserve raw bytes, authenticate correctly, rotate secrets, and survive replay/retry/load tests.
- All workers and the scheduler are supervised and observable; independent on-call alerts are delivered and a recovery drill passes.
- Storage, retention, deletion, Maps licensing, privacy disclosure, and data-subject procedures are approved and tested.
- Database backup/restore, migration rollout/rollback, performance budgets, connection capacity, and production-like load tests pass.
- Dependency advisories and the Prisma/`pg` compatibility warning have an accepted, documented disposition.
- A staged launch demonstrates checkout, refund, dispute, transfer/reversal, identity, media, map privacy, email delivery, and failure recovery end to end.

## Follow-on implementation phases

1. **Phase 5.6B — account/readiness/email-gate enforcement and verification-status separation:** design the data transition, stop identity from writing healthcare status, enforce `disabledAt` and the decided publication email gate, return failing readiness HTTP status, and add unit/PG/auth/readiness tests.
2. **Product/legal decision ADRs:** settle cancellation/refund economics,
   emergency hide/restoration, calendar synchronization, merchant/tax/payout,
   retention, and dispute ownership. The messaging branch, partial-refund
   access, and ordinary listing archive decisions are already implemented.
3. **Phase 5.7A — inquiry and messaging MVP (if selected):** participant-only create/list/detail/send/read APIs, unread counts, durable notifications, and authorization/concurrency tests.
4. **Phase 5.7B — healthcare credential and Admin review:** implement ADR-016's
   approved-identity gate, separate credential history/status, private
   image-evidence upload and sanitization, audited short-lived Admin viewing,
   decision endpoints, durable provider-confirmed deletion, privacy allowlists,
   and concurrency/cleanup tests. Public production collection remains blocked
   pending the approvals listed in ADR-016.
5. **Phase 5.8A — booking cancellation and refund orchestration:** implement
   ADR-006's accepted requested/unpaid Renter/Host/Admin matrix, idempotent
   actor/reason/financial-disposition records, Checkout expiry, full-refund
   orchestration for paid Host/Admin cancellation, inventory/access updates,
   Outbox events, and PostgreSQL concurrency tests. Paid-Renter self-service
   remains policy-blocked and must fail with a stable error.
6. **Phase 5.8B — local availability (implemented):** dedicated available/blocked window APIs, reservation projection, civil dates/timezones, safe edits, public search, and PostgreSQL races. Completion remains deferred under proposed ADR-010.
7. **Phase 5.8C — reviews (if reaffirmed):** completed-booking-only create/list, one-review invariant, moderation/privacy policy, and tests.
8. **Phase 5.9A — payment/transfer operations and reconciliation (implemented):** Admin-safe state views, participant summary, failed-job inspection/requeue, explicit bounded reconciliation, metrics, and PostgreSQL tests. ADR-013 and provider/legal certification remain Blocked.
9. **Phase 5.9B — HTTP contract and scale hardening:** response DTO/OpenAPI decision, opaque 404 policy, throttling, endpoint E2E matrix, query plans, indexes backed by evidence, and load tests.
10. **Phase 5.10A — provider sandbox certification:** Stripe/Connect, Veriff, Supabase media, Google Maps, Brevo, Redis, and HTTPS callback test matrix with captured evidence.
11. **Phase 5.10B — production operations certification:** deployment, secrets, scheduler ownership, monitoring/on-call alerts, backup/restore, recovery drills, dependency disposition, and staged-launch sign-off.
