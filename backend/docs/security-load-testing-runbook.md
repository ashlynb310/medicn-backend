# HTTP security and local scale evidence

This runbook records the Phase 5.9B backend-only boundary. It is implementation
and local verification evidence, not a production-readiness or capacity claim.

## HTTP boundary

The shared bootstrap used by production and integration tests installs the
`/api/v1` prefix, strict `ValidationPipe` transformation/whitelisting, bearer
guard, response/error envelopes, request correlation IDs, Helmet headers, CORS,
body parsing, and rate guards. Routes are protected by default; public and
optional-bearer routes require explicit metadata. The exact 77-operation actor
matrix is in `http-endpoint-inventory.md`.

`ALLOWED_ORIGINS` is a comma-separated exact-origin allowlist. Wildcards,
credentials, URL paths, and insecure non-loopback production origins are
rejected. `TRUST_PROXY_HOPS` defaults to zero and must equal the known ingress
topology; never trust arbitrary forwarded headers. Logs may contain the
generated/request `x-request-id`, route template, bounded status and duration,
but never authorization/cookie headers, query tokens, bodies, addresses,
credentials, healthcare evidence, provider payloads, or raw exceptions.

Ordinary JSON and URL-encoded bodies are capped at 128 KiB. Webhook JSON is
capped at 512 KiB and preserves the exact raw bytes for signature verification.
Malformed or oversized input uses stable envelope codes. Webhook signatures are
verified before expensive processing; retries are durable/idempotent and are
not authorized by source IP. Media bytes continue to flow directly through
bounded signed storage URLs—the API does not proxy uploads.

## Distributed rate policies

All limits use Redis fixed windows and independent policy key spaces:

| Policy | Limit | Failure mode |
| --- | ---: | --- |
| public search | 120/minute | fail open |
| public calendar | 120/minute | fail open |
| inquiry create | 10/minute | fail closed |
| message send | 60/minute | fail closed |
| upload intent | 20/minute | fail closed |
| identity session | 5/10 minutes | fail closed |
| checkout or cancellation | 10/minute | fail closed |
| Admin command | 20/minute | fail closed |
| Socket.IO connect | 20/minute | fail closed |
| Socket.IO event | 120/minute | fail closed |

Limits are deployment safety defaults, not commercial quotas. HTTP `429`
includes `Retry-After`; a required limiter outage returns the bounded
`RATE_LIMIT_UNAVAILABLE` error. Production validation requires the limiter and
Redis, and readiness checks that dependency.

## OpenAPI

```bash
npm run openapi:generate
npm run openapi:check
```

Generation creates `docs/openapi.json`; check fails on drift. It describes
request DTOs, bearer/public security, envelopes, pagination, common errors and
status codes, rate responses, and raw-body webhook requirements. Socket.IO is
intentionally excluded and documented in `socket-io-messaging-contract.md`.
Production docs are absent by default. Enabling them requires both
`OPENAPI_ENABLED=true` and a dedicated random token of at least 32 characters.

## PostgreSQL query-plan evidence

```bash
npm run query-plans:audit
```

The command refuses production, seeds a rollback-only dataset (2,000 listings,
2,000 availability windows, 4,000 bookings, 1,000 inquiries across 100 renters,
10,000 messages, 4,000 payments, 1,000 transfers, 5,000 jobs, 5,000 Outbox rows,
and 2,000 operational commands), and captures 15
`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` plans. Evidence is written to
`query-plan-evidence.json`; no seed persists. Migration
`20260802000000_add_http_scale_indexes` adds only indexes justified by the
recorded listing, participant-list, and Admin operation queries. The gated test
requires all 15 plans to avoid sequential scans on this dataset and verifies
fixture rollback.

## Bounded local HTTP smoke

```bash
npm run smoke:http
```

Defaults are 30 requests at concurrency five (hard caps: 200 and 20). It starts
the real Nest HTTP pipeline and PostgreSQL services, makes no provider calls,
and cleans its fixtures. It exercises public listing search, participant booking
reads, REST message catch-up, public calendar reads, liveness/readiness, and
concurrent monotonic read-cursor writes. Redis rate limiting is disabled only
for repeatable latency measurement and is tested separately by gated tests.

The 2026-07-19 local run used Node 24.16.0 on Windows x64 with a 13th Gen Intel
Core i9-13980HX. All 170 requests succeeded. Recorded p95 values were 239.10 ms
(search), 64.70 ms (bookings), 65.84 ms (catch-up), 25.64 ms (calendar),
12.52 ms (live), 31.06 ms (ready), and 141.80 ms (concurrent cursor writes), all
inside the script's deliberately loose local smoke thresholds. Results vary by
host and do not establish production latency, throughput, saturation, or SLOs.

## Dependency disposition

The final runtime-tree audit reports five moderate and zero high/critical
findings. The moderate Prisma/Hono chain has only a breaking Prisma downgrade
offered; the Hono static server is tooling and is not the API server. The
Next/PostCSS chain is frontend and outside this backend-only phase. No force fix
was applied. Prisma 7.8.0, `@prisma/adapter-pg` 7.8.0, and `pg` 8.21.0 remain
pinned: real transaction tests pass, but Prisma's relation interpreter can emit
the pg concurrent-query deprecation warning on one interactive transaction
client. Treat pg 9 as blocked until a tested Prisma adapter release supports
that execution model; do not suppress the warning.
