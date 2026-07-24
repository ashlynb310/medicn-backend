# Phase 5.9B HTTP contract, security, and scale hardening

Status: implementation specification (approved user scope)  
Date: 2026-07-19

## Objective and success criteria

Harden the existing backend HTTP and Socket.IO boundaries without adding a
business workflow or changing the frontend. Phase 5.9B is complete only when:

- every HTTP route has an inventory entry and an authorization/error contract;
- representative public, authenticated, participant, owner, Admin, disabled,
  and unverified-email cases execute through the real Nest application pipeline;
- private records use opaque `NOT_FOUND` semantics, while intentional role or
  state policy failures retain stable errors;
- abuse-sensitive HTTP and Socket.IO operations use bounded Redis-backed
  policies with documented fail behavior and multi-instance tests;
- body, query, pagination, date, message, metadata, and socket payload sizes are
  bounded while provider webhook raw bytes remain signature-verifiable;
- production CORS, proxy trust, rate limiting, documentation exposure,
  correlation IDs, headers, and error sanitization fail safe;
- a deterministic OpenAPI artifact and drift check describe stable REST
  contracts, with Socket.IO documented separately;
- seeded PostgreSQL `EXPLAIN` evidence covers the named high-traffic queries and
  supports any index migration (no index is added speculatively);
- a reproducible local smoke/load harness reports its exact environment and
  thresholds without representing production capacity;
- all static, migration, normal, PostgreSQL, Redis, combined, startup/shutdown,
  OpenAPI, security, and load checks pass, or remaining blockers are exact.

## Assumptions

1. Existing endpoint semantics and response DTO allowlists are stable contracts;
   this phase changes them only to close an evidenced security or bounds defect.
2. Redis is the shared distributed limiter store. Production HTTP startup
   requires it; local development/tests may explicitly disable rate limiting.
3. Sensitive mutations fail closed when the limiter store is unavailable.
   Public reads fail open but emit bounded safe diagnostics so an outage does
   not make health or public discovery inaccessible.
4. Webhooks are not subject to client-IP rate limits. They have independent body
   limits, verify the provider signature/credential before durable processing,
   and rely on provider event deduplication for retry safety.
5. Client-supplied request IDs are untrusted. The API generates the correlation
   ID returned in headers and error metadata; tokens and secrets never become
   limiter keys, logs, or response details.
6. Local latency thresholds are regression signals for this machine and dataset,
   not capacity, SLO, deployment, or production-readiness evidence.

## Threat model

Trust boundaries are HTTP headers/query/body, raw provider webhook bytes,
Supabase bearer tokens, Socket.IO handshake/event payloads, Redis, PostgreSQL,
and provider responses. Protected assets include exact addresses, identity and
healthcare evidence, messages, email addresses/content, payment/provider data,
Admin actions, credentials, and availability/booking integrity.

- Spoofing: verify Supabase/provider credentials before protected or expensive
  work; accept Socket.IO tokens only in handshake auth.
- Tampering: whitelist/validate DTOs, verify raw webhook signatures, use existing
  transactional/locking boundaries, and never accept queue/payload selectors.
- Repudiation: preserve redacted Admin and operational audit records plus a
  generated correlation ID.
- Information disclosure: serialize allowlists, return opaque `NOT_FOUND` for
  private records, sanitize errors/logs, and never persist sensitive limiter data.
- Denial of service: explicit parser/query/date/message/socket bounds and
  distributed policies separated by endpoint sensitivity.
- Elevation of privilege: retain service-level owner/participant/Admin checks
  and prove them through the real HTTP pipeline.

## Contract decisions

- Base path: `/api/v1`; the success/error envelope remains
  `{ data, meta, error }`.
- Default JSON body limit: 128 KiB. Provider webhook JSON limit: 512 KiB. Large
  media remains direct-to-storage through a presigned intent.
- Production origins are explicit HTTPS origins (HTTP loopback is allowed only
  outside production); wildcard or credential-bearing wildcard configuration is
  invalid.
- Proxy trust is an explicit non-negative hop count. The default is zero.
- OpenAPI JSON is a committed deterministic artifact. Runtime docs are disabled
  in production unless explicitly enabled and protected with a dedicated bearer
  token.
- Rate-limit responses use HTTP 429 and stable `RATE_LIMIT_EXCEEDED`. Policies
  and exact quotas live in the endpoint inventory rather than controllers.

## Project structure and style

- `apps/api/src/common/http/`: bootstrap, correlation, bounds, and rate limiting.
- `apps/api/test/http-*.spec.ts`: real Nest pipeline contract/security tests.
- `apps/api/src/openapi/`: deterministic document construction/generation.
- `apps/api/src/operations/`: non-production query-plan/load commands.
- `docs/openapi.json`: generated REST contract.
- `docs/http-endpoint-inventory.md`: route/auth/error/rate matrix.
- `docs/security-load-testing-runbook.md`: exact local procedures and evidence.

Use the existing Nest DTO/decorator patterns, structured stable exceptions, and
Prisma parameterization. New behavior is test-first and each slice must leave
typecheck and focused tests green.

## Ordered implementation tasks

1. Contract inventory and bootstrap seam
   - Acceptance: inventory covers all routes and actor categories; one exported
     bootstrap configurator is used by production and HTTP tests.
   - Verify: inventory count test and real `/api/v1/health/live` envelope test.
2. Production boundary hardening
   - Acceptance: safe CORS/proxy/body/correlation/header configuration with
     startup validation and raw webhook preservation.
   - Verify: environment, CORS, headers, oversize, malformed, and raw-body tests.
3. Redis rate limiter
   - Acceptance: atomic distributed counters, isolated policies/subjects,
     reset/multi-instance/failure tests, graceful close, safe keys.
   - Verify: unit HTTP tests plus gated Redis tests.
4. Route and Socket.IO policy application
   - Acceptance: every listed abuse-sensitive route/event has its documented
     policy; websocket auth/event payload limits remain opaque.
   - Verify: HTTP 429 and websocket abuse tests.
5. DTO/private-resource audit
   - Acceptance: explicit remaining bounds and opaque private responses; no
     sensitive response/audit fields in tested paths.
   - Verify: authorization matrix, bounds, and privacy assertions.
6. OpenAPI contract
   - Acceptance: deterministic JSON includes every HTTP route, bearer/envelope/
     pagination/error/raw-body notes; runtime exposure is safe.
   - Verify: generation followed by zero-diff check.
7. Query and local load evidence
   - Acceptance: seeded `EXPLAIN` records named plans; smoke script enforces
     documented thresholds across required reads/mutations.
   - Verify: PostgreSQL gate and local smoke command.
8. Final verification and documentation
   - Acceptance: requested command matrix passes; dependency and Prisma/pg
     warnings have explicit non-destructive dispositions.

## Commands

```text
npm run prisma:generate
npx prisma validate
npx prisma migrate deploy
npx prisma migrate status
npm run typecheck -w packages/types
npm run build -w packages/types
npm run typecheck -w apps/api
npm run lint -w apps/api
npm run build -w apps/api
npm run test -w apps/api -- --runInBand
RUN_DATABASE_INTEGRATION_TESTS=true npm run test -w apps/api -- --runInBand
RUN_REDIS_INTEGRATION_TESTS=true npm run test -w apps/api -- --runInBand
RUN_DATABASE_INTEGRATION_TESTS=true RUN_REDIS_INTEGRATION_TESTS=true npm run test -w apps/api -- --runInBand
npm run openapi:check -w apps/api
npm run smoke:http -w apps/api
npm audit --omit=dev
```

## Boundaries

- Always: validate untrusted input, preserve provider raw bytes, use allowlisted
  outputs, parameterize SQL, keep frontend untouched, and mock providers.
- Approved in this scope: CORS, rate limiting, dependencies strictly needed for
  OpenAPI/testing, and evidence-backed index migrations.
- Never: Live Mode, real provider calls or money movement, large upload proxying,
  a new business workflow, forced dependency upgrades, or a production-readiness
  claim.

## Open questions / blockers

Provider sandbox certification, deployment/network proxy validation, production
traffic modelling, legal/payment marketplace decisions, and external security
review remain outside this local hardening phase.
