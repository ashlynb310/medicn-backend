# Transactional worker operations runbook

## Deployment topology

Deploy these as independently scalable processes from the same application
image:

| Process | Command | Responsibility |
| --- | --- | --- |
| API | `npm run start -w apps/api` | HTTP only; live/ready/status/metrics endpoints |
| Outbox | `npm run worker:outbox` | PostgreSQL claim leases and BullMQ publication |
| Email | `npm run worker:email` | Transactional email submission and delivery attempt state |
| Media | `npm run worker:media` | Public image processing plus private healthcare sanitization and deletion |
| Maps | `npm run worker:maps` | Address/geocode/enrichment jobs |
| Operations | `npm run worker:operations` | BullMQ Job Schedulers and bounded recurring handlers |

Every process must receive SIGTERM before the platform's hard-stop deadline.
Workers stop accepting new jobs, finish the current bounded work, close BullMQ
and Nest/Prisma resources, and let unfinished outbox claim leases expire for
safe recovery. Startup configuration failures exit non-zero.

## Redis requirements

- Use an authenticated `rediss://username:password@host:port/database` URL in
  production. TLS is enabled from the URL scheme.
- Set `maxmemory-policy noeviction`. BullMQ keys must not be evicted. The app
  checks this policy when Redis permits `CONFIG GET`; restricted managed Redis
  may return `unverifiable`, which is a readiness warning to verify out of band.
  The app never changes Redis configuration.
- Enable durable persistence appropriate to the service. The local Compose
  profile uses AOF with `appendfsync everysec`; production persistence,
  replication, backups, and restore tests belong to the managed Redis plan.
- Set `REDIS_KEY_PREFIX` per environment. Never configure ioredis `keyPrefix`
  for BullMQ; MediCN uses BullMQ's queue prefix option.
- Producers have a finite request retry and disabled offline queue so Redis
  outages fail within a bounded interval. Workers use
  `maxRetriesPerRequest: null` and capped reconnect delay as BullMQ requires.

## Transactional email and Brevo

Production with `TRANSACTIONAL_EMAIL_ENABLED=true` requires
`EMAIL_PROVIDER=brevo`, `BREVO_API_KEY`, `TRANSACTIONAL_EMAIL_FROM`,
`BREVO_WEBHOOK_BEARER_TOKEN` (at least 32 characters), and `REDIS_URL`.
There is no local fallback. Provider HTTP requests are aborted after
`EMAIL_PROVIDER_TIMEOUT_MS`.

Configure the transactional webhook to POST to
`/api/v1/webhooks/brevo/transactional` with Bearer authentication. Enable
request/sent, delivered, deferred, soft bounce, hard bounce, blocked, invalid,
spam, error, and unsubscribe events. Brevo's payload event names include
`request`, `delivered`, `soft_bounce`, `hard_bounce`, `invalid_email`, and
`spam`; the API also accepts Brevo batches of at most 500 events.

The webhook stores only allowlisted lifecycle fields and hashes. It never
matches on the webhook's recipient address. Unknown provider message IDs are
retained as unmatched. Hard bounce, invalid, blocked, and spam/complaint events
suppress the trusted recipient recorded on the original delivery; deferred and
soft bounce do not. The local provider remains `simulated` and ignores Brevo
delivery transitions.

## Operations and recovery

## Messaging WebSocket and Redis topology

Each API replica opens one Redis publish client and one Redis subscribe client
for the Socket.IO adapter. The adapter key is
`<REDIS_KEY_PREFIX>:socket.io`; BullMQ continues to use its own prefixed keys.
Redis packets contain only opaque messaging event fields. PostgreSQL remains the
source of truth and the REST transaction commits before any emit attempt.

Configure `MESSAGING_MAX_SOCKETS_PER_USER`,
`MESSAGING_MAX_SOCKET_CONNECTIONS`, `MESSAGING_PING_INTERVAL_MS`, and
`MESSAGING_PING_TIMEOUT_MS`. A Redis startup failure degrades that API replica
to local Socket.IO and is logged without a URL or credential; it cannot fail a
REST message write. Alert on this degraded state because cross-replica delivery
is unavailable until reconnect/restart. Clients must catch up through REST by
sequence after reconnect.

The reverse proxy/load balancer must:

- forward HTTP/1.1 `Upgrade` and `Connection` headers for `/socket.io/`;
- keep idle connections longer than ping interval plus ping timeout;
- preserve TLS and the configured Origin allowlist;
- use sticky sessions if Socket.IO long-polling remains enabled; and
- drain sockets during deploys before terminating an API instance.

Shutdown closes the Socket.IO server and both Redis adapter clients. Exercise a
two-replica propagation and graceful-drain test before deployment.

## Operations and recovery

`worker:operations` upserts stable BullMQ 5 Job Scheduler IDs when
`OPERATIONS_SCHEDULER_ENABLED=true`. Configure recovery and maintenance cadence
with `OPERATIONS_RECOVERY_INTERVAL_MS` and
`OPERATIONS_MAINTENANCE_INTERVAL_MS`. Handlers use bounded batches and preserve
the existing manual Stripe, Veriff, media, and Maps commands. Media recovery
also retries healthcare submissions in `deletion_pending` or
`deletion_failed`; only provider-confirmed absence completes deletion.

Recovery commands:

```bash
npm run jobs:recover
npm run jobs:requeue -- <job-execution-uuid> --idempotency-key <key> --reason "<audited reason>"
npm run payments:reconcile -- --idempotency-key <key> --reason "<audited reason>" [--payment-id <uuid>] [--limit 1-25] [--stale-before <ISO-8601>]
npm run host-transfers:reconcile -- --idempotency-key <key> --reason "<audited reason>" [--host-transfer-id <uuid>] [--limit 1-25] [--stale-before <ISO-8601>]
npm run email:webhook-retry -w apps/api -- 100
npm run media:retry -w apps/api -- 25
```

Run any of the three financial/requeue commands with `--help` before an
incident. They enqueue an `OperationalCommand`; they do not call Stripe in the
CLI process. Keep `worker:outbox` and `worker:operations` running to publish and
execute accepted commands. The command and its opaque
`execute_operational_command` Outbox event commit atomically.

Admin inspection routes are under `/api/v1/admin/operations`: paginated
Payments, HostTransfers, JobExecutions (including `/failed`), and commands.
Lists cap at 100 rows. Date filtering requires both endpoints and spans at most
366 days. Reconciliation defaults to 10 stale records and caps at 25; the
default staleness threshold is 15 minutes. Reads never contact Stripe.

`jobs:requeue` accepts only a failed, retryable JobExecution whose stored queue
is one of the repository's known queues. The request and CLI cannot replace the
queue name, job name, or payload. Active, successful, permanently failed, and
unknown-queue records fail closed. The audited reason and idempotency key remain
in PostgreSQL and are intentionally absent from Outbox, BullMQ, logs, metrics,
and API responses.

Reconciliation uses Stripe's configured 10-second request timeout, bounded SDK
network retries, and sanitized retryable/permanent error categories. Missing
Stripe configuration is permanent/fail-closed for that command. Rate limits
and provider availability failures remain retryable. A single command is
resumable because successful transitions are idempotent and candidates are
reloaded from PostgreSQL on retry. Do not run reconciliation with a Live Mode
key; ADR-013 remains Blocked.

Operational metrics include `medicn_operational_commands`,
`medicn_job_inspection_candidates`, `medicn_reconciliation_outcomes`,
`medicn_reconciliation_provider_failures`,
`medicn_reconciliation_stale_records`, and
`medicn_reconciliation_lag_seconds`. Labels contain bounded types/states only,
never record or provider identifiers.

Booking cancellation provider work is also owned by `worker:operations`.
Committed Outbox events route `booking_cancellation_checkout_expiry` and
`booking_cancellation_full_refund` jobs to that queue. The stable
`booking_cancellation_recovery` scheduler scans only a bounded set of active
operations and restores retryable work. Checkout expiry and refund jobs use
stable operation-derived provider idempotency keys. A successful refund request
does not complete cancellation; only authoritative webhook reconciliation can
do so. Keep the operations and Outbox workers deployed while cancellation is
enabled, and alert on active `failed_retryable`, `failed_permanent`,
`refund_pending`, and `transfer_reversal_pending` counts.

`jobs:recover` only expires stale publication/execution claims. The durable
`jobs:requeue` command reuses the existing recovery behavior: it retries the
retained BullMQ job when present and otherwise resets its known Outbox event for
stable-ID republishing. It refuses permanent failures and unknown queues.

## Health, metrics, and alerting

- `GET /api/v1/health/live` checks only that the API process is alive.
- `GET /api/v1/health/ready` checks PostgreSQL, Redis when queue features are
  configured or distributed HTTP/Socket.IO rate limiting is enabled, Redis
  eviction-policy visibility, and provider configuration. It
  does not call Brevo, Stripe, Veriff, Google, Supabase, or any paid API.
- `GET /api/v1/admin/operations/status` requires a Supabase access token for an
  admin user and returns only bounded operational identifiers/counts, including
  the `healthcareEvidenceDeletions` terminal-failure count.
- `GET /api/v1/metrics` is present only when
  `OPERATIONS_METRICS_ENABLED=true` and requires the exact
  `OPERATIONS_METRICS_TOKEN` Bearer token. Protect it with private networking,
  an ingress allowlist, and TLS as well.

Alert on sustained queue waiting/delayed depth, failed jobs, outbox age, stale
claims, webhook failed/unmatched backlog, transfer failures, suppression spikes,
provider error ratio/latency, healthcare `deletion_failed` records, and missing
worker heartbeats. Route critical
alerts to an on-call/paging channel; transactional email must not be the only
alert transport.

## Privacy-safe logging

Worker logs contain bounded queue/job type and shortened opaque IDs only. Never
add API keys, authorization headers, Redis URLs, webhook bodies, recipient
addresses, message bodies, listing addresses/coordinates, identity payloads, or
medical data to worker logs, status endpoints, or metric labels. Healthcare
deletion and processing payloads contain opaque record IDs only; never add
storage paths, signed URLs, claim text, reviewer notes, or evidence bytes.
Cancellation Outbox and BullMQ payloads must likewise remain opaque: never add
addresses, email copy/recipients, payment amounts or credentials, provider
secrets/errors, or support notes. Email workers resolve approved recipient and
copy from committed PostgreSQL state.

Healthcare storage configuration uses
`SUPABASE_HEALTHCARE_EVIDENCE_BUCKET=healthcare-credentials`,
`HEALTHCARE_EVIDENCE_MAX_INPUT_BYTES=10485760`,
`HEALTHCARE_EVIDENCE_VIEW_URL_TTL_SECONDS=60`, and
`HEALTHCARE_EVIDENCE_DELETION_MAX_ATTEMPTS=5`. In production the healthcare
bucket must differ from ingest, listing, and profile buckets.

## Maps compliance blocker

`MAPS_ENABLED` remains false by default. User-entered listing address data and
Google-derived geocodes/place/route data have separate provenance and retention
rules. Preserve Google attribution and refresh/expiry metadata. Production
launch remains blocked on legal/licensing review of durable marketplace address
and snapshot retention; disabling Maps must not delete the user-supplied source
address or weaken exact-location privacy.

## Dependency investigation notes (2026-07-19)

Phase 5.9B adds a distributed fixed-window limiter using the existing Redis
deployment and a separate `medicn:rate:v1` key space. Production environment
validation requires `RATE_LIMITING_ENABLED=true` and `REDIS_URL`. Sensitive
write, identity, checkout/cancellation, Admin command, and Socket.IO policies
fail closed if Redis is unavailable; public search/calendar policies fail open
to avoid making browse availability depend on Redis. Keys contain only a
bounded policy name plus a SHA-256 digest, never a bearer token, address,
message, email, or request body. Monitor readiness and `429`/`503` rates; never
disable the limiter as a production incident workaround.

The bounded local evidence commands are:

```bash
npm run query-plans:audit
npm run smoke:http
npm run openapi:check
```

They refuse production execution or use a test environment, make no provider
calls, and are not production capacity evidence. See
`docs/security-load-testing-runbook.md` for dataset size and thresholds.

The PostgreSQL concurrent-query warning comes from `pg@8.21.0`, which deprecates
calling `client.query()` while that same client's query queue is non-empty.
Inspection found one real application trigger: `MediaService.nextDisplayOrder`
used `Promise.all` for two queries on the same Prisma interactive-transaction
client. Those two queries are now sequential. Pool-level queries outside an
interactive transaction remain safely parallel.

The gated suite still emits the adapter warning in transaction-heavy PostgreSQL
concurrency paths. `--trace-deprecation` places the investigated calls inside
`@prisma/client-engine-runtime`'s `interpretNode` `Array.map`, reached through
`PgTransaction.queryRaw`; there is no application `Promise.all` on those
transaction clients. Both paths load several Prisma relations inside an
interactive transaction, and Prisma 7.8's JavaScript query interpreter issues
those relation-plan children concurrently on the adapter's single client. The
transactions and the Phase 5.9A PostgreSQL gate (478 passing tests) complete
correctly under `pg@8.21.0`, but
this remains a `pg@9` compatibility blocker to track against Prisma's
`@prisma/adapter-pg`. Do not suppress the warning or upgrade to pg 9 until the
adapter supports that execution model; re-run the traced concurrency suites on
the next Prisma patch.

The final Phase 5.9B `npm audit --omit=dev --json` check reports five moderate
runtime-tree nodes and no high or critical findings. An initial
`@nestjs/swagger@11.2.0` install exposed three high findings through its bundled
`lodash`, `path-to-regexp`, and `js-yaml`; it was immediately replaced by the
compatible patched `@nestjs/swagger@11.4.6` and the audit was rerun:

- `@hono/node-server` through Prisma's development tooling (static middleware
  path bypass); MediCN does not use that server at runtime.
- `@prisma/dev` and `prisma` are propagation nodes for the same advisory; npm's
  offered fix is a breaking Prisma downgrade from 7.8.0 to 6.19.3.
- `js-yaml` is nested under Istanbul test configuration and is not used to parse
  untrusted production YAML.
- `postcss` nested inside Next.js and `next` are the frontend propagation nodes
  for a CSS-stringification XSS advisory. Frontend upgrades are outside this
  backend phase and require a separately tested Next.js release update.

No high or critical advisories were reported. No automated fix was applied:
`npm audit fix --force` would introduce breaking/out-of-scope dependency
changes. Track the Prisma and Next upstream patch paths and rerun the complete
workspace regression suite before updating them.
