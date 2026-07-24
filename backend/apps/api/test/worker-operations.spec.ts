import type { OutboxEvent } from "@prisma/client";
import type { BullMqEmailQueueService } from "../src/jobs/bullmq-email-queue.service";
import type { BullMqMediaQueueService } from "../src/jobs/bullmq-media-queue.service";
import { JobsService } from "../src/jobs/jobs.service";
import { JobExecutionService } from "../src/jobs/job-execution.service";
import { OutboxPublisherService } from "../src/jobs/outbox-publisher.service";
import { createRedisConnection } from "../src/jobs/redis";
import type { PrismaService } from "../src/prisma/prisma.service";
import { DELETE_HEALTHCARE_EVIDENCE_JOB } from "../src/healthcare/healthcare.types";
import {
  BOOKING_CANCELLATION_FULL_REFUND_JOB
} from "../src/bookings/booking-cancellation.types";
import type { BullMqOperationsQueueService } from "../src/jobs/bullmq-operations-queue.service";
import { BOOKING_COMPLETION_EMAIL_JOB } from "../src/bookings/booking-lifecycle.types";
import { EXECUTE_OPERATIONAL_COMMAND_JOB } from "../src/operations/operational-command.types";

describe("worker operations hardening", () => {
  it("uses bounded producer Redis behavior with TLS and a parsed database", () => {
    const connection = createRedisConnection(
      "rediss://queue-user:queue-pass@redis.example:6380/4",
      "producer",
      { connectTimeoutMs: 2_500, maxRetryDelayMs: 7_500 }
    );
    const redisOptions = connection as Record<string, any>;

    expect(connection).toMatchObject({
      host: "redis.example",
      port: 6380,
      username: "queue-user",
      password: "queue-pass",
      db: 4,
      tls: {},
      connectTimeout: 2_500,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1
    });
    expect(redisOptions.retryStrategy?.(20)).toBe(7_500);
  });

  it("keeps worker Redis reconnection enabled with a bounded delay", () => {
    const connection = createRedisConnection(
      "redis://localhost:6379",
      "worker",
      { connectTimeoutMs: 1_500, maxRetryDelayMs: 4_000 }
    );
    const redisOptions = connection as Record<string, any>;

    expect(redisOptions.maxRetriesPerRequest).toBeNull();
    expect(redisOptions.enableOfflineQueue).toBe(true);
    expect(redisOptions.retryStrategy?.(20)).toBe(4_000);
  });

  it("publishes only claimed rows and completes the matching lease", async () => {
    const event = {
      id: "outbox_1",
      eventType: "send_transactional_email",
      payload: {},
      maxAttempts: 3
    } as OutboxEvent;
    const jobs = {
      claimPublishableJobs: jest.fn().mockResolvedValue([event]),
      markEnqueued: jest.fn().mockResolvedValue(true),
      markPublishFailed: jest.fn()
    };
    const emailQueue = { add: jest.fn().mockResolvedValue(undefined) };
    const publisher = new OutboxPublisherService(
      jobs as unknown as JobsService,
      emailQueue as unknown as BullMqEmailQueueService,
      undefined,
      undefined,
      "publisher-a"
    );

    await expect(publisher.publishPending(10)).resolves.toEqual({
      total: 1,
      published: 1,
      failed: 0
    });
    expect(jobs.claimPublishableJobs).toHaveBeenCalledWith(
      10,
      "publisher-a",
      expect.any(Number),
      undefined
    );
    expect(jobs.markEnqueued).toHaveBeenCalledWith("outbox_1", "publisher-a");
  });

  it("makes an unknown outbox route a permanent visible failure", async () => {
    const event = {
      id: "outbox_2",
      eventType: "not_configured",
      payload: {},
      maxAttempts: 3
    } as OutboxEvent;
    const jobs = {
      claimPublishableJobs: jest.fn().mockResolvedValue([event]),
      markEnqueued: jest.fn(),
      markPublishFailed: jest.fn().mockResolvedValue(true)
    };
    const publisher = new OutboxPublisherService(
      jobs as unknown as JobsService,
      { add: jest.fn() } as unknown as BullMqEmailQueueService,
      undefined,
      undefined,
      "publisher-a"
    );

    await publisher.publishPending();

    expect(jobs.markPublishFailed).toHaveBeenCalledWith(
      event,
      "publisher-a",
      expect.objectContaining({ category: "outbox_route_missing", retryable: false })
    );
  });

  it("routes opaque healthcare evidence deletion through the existing media queue", async () => {
    const event = {
      id: "outbox-healthcare-1",
      eventType: DELETE_HEALTHCARE_EVIDENCE_JOB,
      payload: { healthcareVerificationId: "verification_1" },
      maxAttempts: 5
    } as unknown as OutboxEvent;
    const jobs = {
      claimPublishableJobs: jest.fn().mockResolvedValue([event]),
      markEnqueued: jest.fn().mockResolvedValue(true),
      markPublishFailed: jest.fn()
    };
    const mediaQueue = { add: jest.fn().mockResolvedValue(undefined) };
    const publisher = new OutboxPublisherService(
      jobs as unknown as JobsService,
      { add: jest.fn() } as unknown as BullMqEmailQueueService,
      mediaQueue as unknown as BullMqMediaQueueService,
      undefined,
      "publisher-healthcare"
    );

    await expect(publisher.publishPending()).resolves.toEqual({
      total: 1,
      published: 1,
      failed: 0
    });
    expect(mediaQueue.add).toHaveBeenCalledWith(event);
    expect(JSON.stringify(event.payload)).toBe(
      '{"healthcareVerificationId":"verification_1"}'
    );
  });

  it("routes an opaque cancellation command through the operations queue", async () => {
    const event = {
      id: "outbox-cancel-1",
      eventType: BOOKING_CANCELLATION_FULL_REFUND_JOB,
      payload: { cancellationOperationId: "cancel_1" },
      maxAttempts: 5
    } as unknown as OutboxEvent;
    const jobs = {
      claimPublishableJobs: jest.fn().mockResolvedValue([event]),
      markEnqueued: jest.fn().mockResolvedValue(true),
      markPublishFailed: jest.fn()
    };
    const operationsQueue = { add: jest.fn().mockResolvedValue(undefined) };
    const publisher = new OutboxPublisherService(
      jobs as unknown as JobsService,
      { add: jest.fn() } as unknown as BullMqEmailQueueService,
      undefined,
      undefined,
      "publisher-cancellation",
      undefined,
      operationsQueue as unknown as BullMqOperationsQueueService
    );

    await expect(publisher.publishPending()).resolves.toMatchObject({ published: 1 });
    expect(operationsQueue.add).toHaveBeenCalledWith(event);
    expect(JSON.stringify(event.payload)).toBe(
      '{"cancellationOperationId":"cancel_1"}'
    );
  });

  it("routes an opaque operational command through the operations queue", async () => {
    const event = {
      id: "outbox-command-1",
      eventType: EXECUTE_OPERATIONAL_COMMAND_JOB,
      payload: { operationalCommandId: "command_1" },
      maxAttempts: 5
    } as unknown as OutboxEvent;
    const jobs = {
      claimPublishableJobs: jest.fn().mockResolvedValue([event]),
      markEnqueued: jest.fn().mockResolvedValue(true),
      markPublishFailed: jest.fn()
    };
    const operationsQueue = { add: jest.fn().mockResolvedValue(undefined) };
    const publisher = new OutboxPublisherService(
      jobs as unknown as JobsService,
      { add: jest.fn() } as unknown as BullMqEmailQueueService,
      undefined,
      undefined,
      "publisher-command",
      undefined,
      operationsQueue as unknown as BullMqOperationsQueueService
    );

    await expect(publisher.publishPending()).resolves.toMatchObject({ published: 1 });
    expect(operationsQueue.add).toHaveBeenCalledWith(event);
    expect(JSON.stringify(event.payload)).toBe(
      '{"operationalCommandId":"command_1"}'
    );
  });

  it("routes opaque completion notifications through the existing email queue", async () => {
    const event = {
      id: "outbox-completion-1",
      eventType: BOOKING_COMPLETION_EMAIL_JOB,
      payload: { bookingId: "booking_1", recipientUserId: "renter_1" },
      maxAttempts: 3
    } as unknown as OutboxEvent;
    const jobs = {
      claimPublishableJobs: jest.fn().mockResolvedValue([event]),
      markEnqueued: jest.fn().mockResolvedValue(true),
      markPublishFailed: jest.fn()
    };
    const emailQueue = { add: jest.fn().mockResolvedValue(undefined) };
    const publisher = new OutboxPublisherService(
      jobs as unknown as JobsService,
      emailQueue as unknown as BullMqEmailQueueService,
      undefined,
      undefined,
      "publisher-completion"
    );

    await expect(publisher.publishPending()).resolves.toMatchObject({ published: 1 });
    expect(emailQueue.add).toHaveBeenCalledWith(event);
    expect(JSON.stringify(event.payload)).toBe(
      '{"bookingId":"booking_1","recipientUserId":"renter_1"}'
    );
  });

  it("records durable success and sanitized failure outcomes for worker attempts", async () => {
    const records = new Map<string, any>();
    const jobExecution = {
      upsert: jest.fn(async ({ create, update }: any) => {
        const key = `${create.queueName}:${create.jobId}:${create.attemptNumber}`;
        const current = records.get(key);
        const row = current ? { ...current, ...update } : { id: `execution-${records.size + 1}`, ...create, state: "running" };
        records.set(key, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const entry = [...records.entries()].find(([, value]) => value.id === where.id)!;
        Object.assign(entry[1], data);
        return entry[1];
      })
    };
    const executions = new JobExecutionService({ jobExecution } as unknown as PrismaService);
    const context = {
      queueName: "email",
      jobType: "send_transactional_email",
      jobId: "outbox-1",
      attemptNumber: 1,
      workerIdentity: "email-worker-1"
    };

    await expect(executions.run(context, async () => ({ value: "ok", providerRef: "provider-1" })))
      .resolves.toBe("ok");
    await expect(executions.run({ ...context, attemptNumber: 2 }, async () => {
      throw new Error("redis://user:secret@private-host should never persist");
    })).rejects.toThrow();

    expect([...records.values()]).toEqual([
      expect.objectContaining({ state: "succeeded", providerRef: "provider-1" }),
      expect.objectContaining({
        state: "failed",
        retryable: true,
        errorCategory: "job_processing_failed",
        errorMessage: "The background job did not complete."
      })
    ]);
  });
});
