# Phase 5.9A payment and transfer operations

## Objective

Add backend-only operational inspection, safe durable requeue, participant
payment summaries, and explicit Stripe test-mode reconciliation without
changing the marketplace fund-flow policy or enabling Live Mode.

## Accepted contract

- Admin operations reads are paginated, bounded, allowlisted serializers over
  Payment, HostTransfer, JobExecution, and durable OperationalCommand records.
- Participant payment summary is available only to the booking Renter, Host, or
  an Admin. Unrelated and missing bookings are opaque `NOT_FOUND`.
- Requeue and reconciliation requests create an idempotent OperationalCommand
  plus an opaque PostgreSQL Outbox event in one transaction. The existing
  operations worker executes the command and records JobExecution attempts.
- Requeue accepts only a failed, retryable JobExecution on a repository-known
  queue. Active, successful, non-retryable, unknown-queue, or otherwise unsafe
  executions are rejected before enqueue and revalidated during execution.
- Payment reconciliation uses provider PaymentIntent/Charge/refund/dispute
  state and the existing webhook transition machinery. Transfer reconciliation
  validates Stripe Transfer accounting snapshots and reconciles monotonic
  reversal totals. Reads never call Stripe.
- Reconciliation operates on one explicitly selected eligible record or a
  stale bounded batch. Batch default is 10, hard maximum is 25; list endpoints
  cap pages at 100 and date windows at 366 days.
- Stripe configuration/provider unavailability fails closed. Retryable provider
  failures remain visible and resumable through the same command/job identity;
  permanent failures are retained without unsafe automatic replay.

## Trust and privacy boundaries

- Supabase authentication and persisted `admin` role protect every Admin route.
- HTTP bodies and filters reject unknown fields and validate UUIDs, enums,
  bounded integers, canonical timestamps, reason length, and idempotency keys.
- No request supplies a queue name, job type, BullMQ payload, provider object,
  amount, currency, or transition target.
- Participant responses contain no provider identifiers. Admin list responses
  omit them; Admin detail allowlists only the provider references needed for
  reconciliation. No response includes webhook payloads, raw errors, stack
  traces, email content, address, bank details, credentials, internal notes, or
  private evidence.
- A Stripe Transfer is labeled as a transfer to a connected Stripe balance and
  explicitly is not represented as bank payout.

## Endpoints

- `GET /api/v1/admin/operations/payments`
- `GET /api/v1/admin/operations/payments/:id`
- `GET /api/v1/admin/operations/host-transfers`
- `GET /api/v1/admin/operations/host-transfers/:id`
- `GET /api/v1/admin/operations/job-executions`
- `GET /api/v1/admin/operations/job-executions/failed`
- `GET /api/v1/admin/operations/job-executions/:id`
- `POST /api/v1/admin/operations/job-executions/:id/requeue`
- `GET /api/v1/admin/operations/commands`
- `GET /api/v1/admin/operations/commands/:id`
- `POST /api/v1/admin/operations/reconciliation/payments`
- `POST /api/v1/admin/operations/reconciliation/host-transfers`
- `GET /api/v1/bookings/:id/payment-summary`

## CLI

- `npm run jobs:requeue -- <execution-id> --idempotency-key <key> --reason <reason>`
- `npm run payments:reconcile -- [--payment-id <id>] [--limit 1..25] [--stale-before <ISO>] --idempotency-key <key> --reason <reason>`
- `npm run host-transfers:reconcile -- [--host-transfer-id <id>] [--limit 1..25] [--stale-before <ISO>] --idempotency-key <key> --reason <reason>`

Each command supports `--help`. Commands enqueue durable work; they do not call
Stripe directly.

## Implementation tasks

1. Add OperationalCommand schema, indexes, lifecycle enums, migration, and
   shared response contracts.
2. Add Admin inspection filters/serializers and participant payment summary,
   with authorization/privacy tests.
3. Add idempotent command creation, Outbox routing, worker execution, and safe
   requeue eligibility/audit tests.
4. Add payment/transfer reconciliation provider adapters and monotonic
   execution with mocked-provider and PostgreSQL race/rollback tests.
5. Add CLI/help, metrics, ADR/runbook/audit evidence, then run the complete
   migration/static/normal/PostgreSQL/Redis matrix.

## Boundaries

- Always: parameterized database access, server-derived targets/payloads,
  transactional command/Outbox creation, stable idempotency, sanitized output,
  bounded provider calls, and mocked Stripe in tests.
- Never: frontend edits, arbitrary queue/payload replay, provider calls on read,
  startup scans, bank-payout claims, invented tax/liability policy, real money,
  secrets, or Stripe Live Mode enablement.

## Success criteria

All endpoints and CLIs have stable contracts; eligible work is idempotent and
audited; stale provider state cannot regress terminal state; transaction and
concurrency tests pass on real PostgreSQL/Redis; Prisma/static/full test gates
pass; ADR-013 remains Blocked for Live Mode.
