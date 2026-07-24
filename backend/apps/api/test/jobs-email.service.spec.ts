import type { ConfigService } from "@nestjs/config";
import { OutboxEventStatus } from "@prisma/client";
import {
  BrevoEmailAdapter,
  EmailService,
} from "../src/email/email.service";
import { SEND_TRANSACTIONAL_EMAIL_JOB } from "../src/email/email.types";
import type { BullMqEmailQueueService } from "../src/jobs/bullmq-email-queue.service";
import { JobsService, type OutboxJob } from "../src/jobs/jobs.service";
import { OutboxPublisherService } from "../src/jobs/outbox-publisher.service";
import type { PrismaService } from "../src/prisma/prisma.service";

const now = new Date("2026-07-09T00:00:00.000Z");

function createPrismaFake() {
  const events: OutboxJob[] = [];
  const outboxEvent = {
    create: jest.fn(async ({ data }: { data: Partial<OutboxJob> }) => {
      const existing = events.find(
        (event) => event.idempotencyKey === data.idempotencyKey
      );
      if (existing) {
        throw { code: "P2002" };
      }

      const event = {
        id: `outbox_${events.length + 1}`,
        eventType: data.eventType,
        aggregateType: data.aggregateType,
        aggregateId: data.aggregateId,
        payload: data.payload,
        idempotencyKey: data.idempotencyKey,
        status: OutboxEventStatus.pending,
        attempts: 0,
        maxAttempts: data.maxAttempts ?? 3,
        lastError: null,
        availableAt: data.availableAt ?? now,
        enqueuedAt: null,
        createdAt: now,
        updatedAt: now
      } as OutboxJob;

      events.push(event);
      return event;
    }),
    findUnique: jest.fn(async ({ where }: { where: { idempotencyKey: string } }) =>
      events.find((event) => event.idempotencyKey === where.idempotencyKey) ??
      null
    ),
    findMany: jest.fn(async () => events),
    update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<OutboxJob> }) => {
      const event = events.find((event) => event.id === where.id);
      if (!event) {
        throw new Error("missing event");
      }

      Object.assign(event, data);
      return event;
    })
  };

  return {
    events,
    prisma: {
      outboxEvent
    } as unknown as PrismaService
  };
}

describe("JobsService, OutboxPublisherService, and EmailService", () => {
  it("deduplicates outbox events with the same key", async () => {
    const { prisma, events } = createPrismaFake();
    const jobs = new JobsService(prisma);

    const first = await jobs.enqueue(
      "send_email",
      { to: "a@example.com" },
      {
        aggregateId: "email_1",
        aggregateType: "email",
        deduplicationKey: "email:1"
      }
    );
    const second = await jobs.enqueue(
      "send_email",
      { to: "a@example.com" },
      {
        aggregateId: "email_1",
        aggregateType: "email",
        deduplicationKey: "email:1"
      }
    );

    expect(second.id).toBe(first.id);
    expect(events).toHaveLength(1);
  });

  it("queues transactional email as a durable outbox event", async () => {
    const { prisma, events } = createPrismaFake();
    const jobs = new JobsService(prisma);
    const config = {
      get: jest.fn((key: string) =>
        key === "TRANSACTIONAL_EMAIL_FROM"
          ? "hello@medicn.test"
          : undefined
      )
    };
    const email = new EmailService(jobs, config as unknown as ConfigService);

    const job = await email.queueTransactionalEmail(
      {
        to: "host@example.com",
        template: "booking_requested_host",
        subject: "New booking",
        text: "A renter requested your listing."
      },
      {
        aggregateId: "booking_1",
        aggregateType: "booking",
        deduplicationKey: "booking:1"
      }
    );

    expect(job.eventType).toBe(SEND_TRANSACTIONAL_EMAIL_JOB);
    expect(job.aggregateType).toBe("booking");
    expect(job.aggregateId).toBe("booking_1");
    expect(events).toHaveLength(1);
  });

  it("sends transactional email through Brevo with the configured sender", async () => {
    const fetchClient = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: jest.fn().mockResolvedValue({ messageId: "provider-message-1" })
    });
    const adapter = new BrevoEmailAdapter(
      fetchClient,
      "brevo-api-key",
      "MediCN <noreply@example.com>"
    );

    await adapter.send({
      to: "renter@example.com",
      template: "booking_accepted_renter",
      subject: "Your booking was accepted",
      text: "Your host accepted the booking request."
    });

    expect(fetchClient).toHaveBeenCalledWith(
      "https://api.brevo.com/v3/smtp/email",
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "api-key": "brevo-api-key",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          sender: {
            email: "noreply@example.com",
            name: "MediCN"
          },
          to: [{ email: "renter@example.com" }],
          subject: "Your booking was accepted",
          textContent: "Your host accepted the booking request.",
          tags: ["booking_accepted_renter"]
        }),
        signal: expect.any(Object)
      }
    );
  });

  it("fails an email job when Brevo rejects the request", async () => {
    const fetchClient = jest.fn().mockResolvedValue({
      ok: false,
      status: 401
    });
    const adapter = new BrevoEmailAdapter(
      fetchClient,
      "invalid-api-key",
      "noreply@example.com"
    );

    await expect(
      adapter.send({
        to: "renter@example.com",
        template: "booking_rejected_renter",
        subject: "Your booking was declined",
        text: "Your host declined the booking request."
      })
    ).rejects.toMatchObject({
      category: "brevo_authentication_failed",
      retryable: false
    });
  });

  it("publishes pending email outbox events to BullMQ and marks them enqueued", async () => {
    const event = {
      id: "outbox_1",
      eventType: SEND_TRANSACTIONAL_EMAIL_JOB,
      payload: {
        to: "host@example.com",
        template: "booking_requested_host",
        subject: "New booking",
        text: "A renter requested your listing."
      },
      maxAttempts: 3
    } as unknown as OutboxJob;
    const jobs = {
      claimPublishableJobs: jest.fn().mockResolvedValue([event]),
      markEnqueued: jest.fn(),
      markPublishFailed: jest.fn()
    };
    const emailQueue = {
      add: jest.fn().mockResolvedValue(undefined)
    };
    const publisher = new OutboxPublisherService(
      jobs as unknown as JobsService,
      emailQueue as unknown as BullMqEmailQueueService
    );

    await expect(publisher.publishPending()).resolves.toEqual({
      total: 1,
      published: 1,
      failed: 0
    });
    expect(emailQueue.add).toHaveBeenCalledWith(event);
    expect(jobs.markEnqueued).toHaveBeenCalledWith("outbox_1", expect.any(String));
    expect(jobs.markPublishFailed).not.toHaveBeenCalled();
  });

  it("keeps an outbox event retryable when BullMQ publishing fails", async () => {
    const event = {
      id: "outbox_1",
      eventType: SEND_TRANSACTIONAL_EMAIL_JOB,
      payload: {},
      maxAttempts: 3
    } as unknown as OutboxJob;
    const error = new Error("Redis unavailable");
    const jobs = {
      claimPublishableJobs: jest.fn().mockResolvedValue([event]),
      markEnqueued: jest.fn(),
      markPublishFailed: jest.fn()
    };
    const emailQueue = {
      add: jest.fn().mockRejectedValue(error)
    };
    const publisher = new OutboxPublisherService(
      jobs as unknown as JobsService,
      emailQueue as unknown as BullMqEmailQueueService
    );

    await expect(publisher.publishPending()).resolves.toEqual({
      total: 1,
      published: 0,
      failed: 1
    });
    expect(jobs.markPublishFailed).toHaveBeenCalledWith(
      event,
      expect.any(String),
      expect.objectContaining({ category: "redis_publish_failed", retryable: true })
    );
    expect(jobs.markEnqueued).not.toHaveBeenCalled();
  });
});
