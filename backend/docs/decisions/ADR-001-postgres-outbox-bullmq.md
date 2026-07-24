# ADR-001: Use Postgres Outbox and BullMQ for Week 6 async jobs

## Status
Accepted

## Date
2026-07-09

## Context
Week 6 requires background workers and automated transactional email dispatch.
Booking and payment flows create business records in PostgreSQL and then need to
trigger email notifications. The earlier in-memory queue was useful for unit
tests, but it lost jobs on process restart and could not be consumed by a
separate worker process.

## Decision
Use a Postgres `OutboxEvent` table as the durable source of pending async work,
then publish those events into Redis-backed BullMQ queues for worker execution.

Business services write `OutboxEvent` records inside the same Prisma transaction
as the related `Booking` or `Payment` update. A worker process polls pending
outbox events, enqueues BullMQ jobs with stable IDs, and sends transactional
emails through the provider-agnostic email adapter.

## Alternatives Considered

### In-memory queue
- Pros: Simple and fast for local unit tests.
- Cons: Jobs disappear on restart and cannot be consumed across processes.
- Rejected because Week 6 is moving toward production-like worker behavior.

### Redis/BullMQ only
- Pros: Strong worker primitives, retries, backoff, and concurrency.
- Cons: A business transaction can commit while the Redis enqueue fails, losing
  the notification event unless additional recovery logic exists.
- Rejected as the only source of truth because booking/payment events should be
  durably recorded with the database state that caused them.

### Postgres outbox only
- Pros: Fewer moving parts and transactional safety.
- Cons: Worker retry, backoff, concurrency, and operational tooling would need
  to be built in-house.
- Rejected as the full worker execution layer because BullMQ already provides
  those primitives.

## Consequences
- Redis is now part of local Week 6 backend infrastructure.
- `OutboxEvent` is the durable source of pending app events.
- BullMQ job IDs use outbox IDs so publishing retries are idempotent.
- Unit tests should fake BullMQ/Redis boundaries rather than requiring a live
  Redis server.
- Production email-provider enablement remains separate from the local/dev email
  adapter.
