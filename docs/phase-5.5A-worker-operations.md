# Phase 5.5A transactional delivery and worker operations

Status: implementation specification (2026-07-19)

## Objective

Harden the existing PostgreSQL outbox and BullMQ background work so multiple
replicas can safely publish and process jobs, provider outcomes are durable,
and production operations are observable and recoverable without exposing
secrets or sensitive payloads.

## Process topology

- `start`: HTTP API only. It must not poll the outbox or run recurring work.
- `worker:outbox`: the only shared outbox publisher. It claims PostgreSQL rows
  with a lease and publishes them to their routed BullMQ queue.
- `worker:email`, `worker:media`, `worker:maps`: consume one domain queue each.
  They never scan or publish the shared outbox.
- `worker:operations`: owns BullMQ 5 Job Schedulers and consumes the operations
  queue for recurring recovery, expiry, release, refresh, and cleanup work.

All long-running processes publish a durable heartbeat and implement bounded
SIGINT/SIGTERM shutdown. A fatal startup error exits non-zero.

## Outbox state machine

`pending -> publishing -> enqueued`

- A publisher atomically selects due `pending` rows and expired `publishing`
  leases with PostgreSQL `FOR UPDATE SKIP LOCKED`, then records `claimedAt`,
  `claimExpiresAt`, and `claimedBy`.
- BullMQ job IDs are derived solely from the immutable outbox ID. A crash after
  Redis acceptance and before the database update therefore republishes the
  same logical job safely.
- `enqueued` means Redis accepted the job. It does not mean a provider accepted
  or delivered it.
- Retryable publication failures return to `pending` with bounded exponential
  backoff plus jitter. Permanent route/configuration failures and exhausted
  retries move to `failed` with a sanitized category and message.
- Claim completion and failure updates require the same worker identity and a
  current `publishing` state, preventing one replica from completing another
  replica's reclaimed row.

## Durable execution and email delivery

- Every BullMQ attempt creates or updates a `JobExecution` keyed by queue, job
  ID, and attempt number. It records bounded identifiers, state, worker,
  timestamps, retryability, sanitized error metadata, and provider reference.
- `EmailDelivery` is keyed by outbox event and stores recipient, template,
  provider, provider message ID, accepted/delivery lifecycle timestamps,
  status, and safe errors. Bodies and queue payloads are not copied into it.
- The email adapter returns `{ provider, messageId, acceptedAt }`. Local mode is
  always `simulated`; it can never become Brevo-delivered.
- Before provider submission, email checks an active hashed-recipient
  suppression. Hard bounce, invalid, blocked, and spam/complaint events create
  suppression. Deferred and soft bounce do not.
- Production with transactional email enabled requires the Brevo provider,
  sender, API key, webhook bearer token, and Redis. There is no local fallback.
  Provider calls have a configured timeout. HTTP 429/5xx/network/timeout errors
  are retryable; authentication, invalid requests, and sender errors are
  permanent.

## Brevo webhook contract

- `POST /api/v1/webhooks/brevo/transactional` accepts either one documented
  transactional event object or a batch array (maximum 500).
- Authorization is a constant-time comparison of an exact Bearer token.
- The inbox deduplicates a digest of the allowlisted event fields, stores no
  raw request, and never uses webhook recipient data to find a delivery.
- Provider message ID is the sole delivery lookup key. Unknown IDs are retained
  as unmatched for operations visibility.
- Lifecycle application is monotonic by occurrence time and precedence:
  an older `sent` cannot replace `delivered`; a later hard bounce, blocked,
  invalid, or complaint remains visible and suppresses the trusted recipient.

## Redis and BullMQ

- `redis://` and `rediss://`, username/password/database, TLS, connect timeout,
  capped reconnect delay, and a BullMQ queue prefix are supported.
- Producers use finite retries and disabled offline buffering so API/publisher
  operations fail within a bounded time. Workers use BullMQ's required
  `maxRetriesPerRequest: null` and keep reconnecting with bounded delay.
- Every Queue, Worker, QueueEvents, and explicit Redis client has an error
  listener and is closed on shutdown.
- Production deployment must use persistence and `maxmemory-policy noeviction`.
  Readiness may report an unverifiable policy when Redis `CONFIG` is denied,
  but the application never changes server configuration.

## Recurring operations

Stable BullMQ Job Scheduler IDs cover Stripe webhook retry, checkout expiry,
host transfer release, Veriff webhook retry, media recovery/cleanup, Maps
recovery/refresh, Brevo webhook retry, and stale outbox/execution recovery.
Scheduler upsert is safe across replicas. Handlers scan bounded batches and do
not hold database transactions across provider or Redis network calls. Existing
manual commands remain available, plus email webhook retry and job recovery.

## Health, status, and metrics

- `/health/live` only confirms the API process is alive.
- `/health/ready` checks PostgreSQL, Redis when queue-backed features are in
  use, and provider configuration without calling paid provider APIs.
- An admin-only operations status response reports bounded queue/outbox ages,
  failed executions/webhooks, and stale worker identities without payloads,
  email addresses, exact listing addresses, or provider secrets.
- A separately token-protected Prometheus endpoint exposes bounded-label queue,
  outbox, execution, webhook, suppression, worker-age, transfer, and provider
  timing/error metrics. Email must not be the sole alert transport.

## Security and privacy invariants

- Logs contain event type, queue, status, and shortened opaque IDs only.
- Logs and operational APIs never contain secrets, authorization headers, raw
  webhook bodies, email bodies, recipient addresses, exact listing addresses,
  identity payloads, or medical details.
- Webhook/request limits, allowlisting, deduplication, claim leases, and bounded
  queries prevent unbounded memory, database, or label growth.
- Maps remains disabled without explicit configuration. Google-derived data,
  attribution, refresh, and retention requirements remain distinct from user
  supplied listing data and are documented as a deployment compliance blocker.

## Acceptance tests

- Concurrent outbox publishers claim each row once; expired claims recover.
- Producer outages fail boundedly and preserve durable retry state; unknown
  routes become visibly failed.
- Every domain worker records successful and failed attempts and no domain
  worker scans the outbox.
- Email adapter classification, timeout, missing/invalid provider ID, local
  simulation, suppression, webhook auth/deduplication/batches/ordering, unknown
  message IDs, and retry recovery are covered with mocks only.
- Redis URL/TLS/mode options, environment validation, scheduler IDs, readiness,
  metrics authentication, heartbeats, status privacy, and graceful shutdown are
  covered without live Redis or provider calls.

## Rollback

Stop the new workers, deploy the prior API/workers, and leave additive tables
and columns in place. Rows in `publishing` are safe to reset to `pending` after
their leases expire. Do not down-migrate while any new worker is running.
