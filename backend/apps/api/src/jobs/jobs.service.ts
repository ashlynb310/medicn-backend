import { Injectable, Logger } from "@nestjs/common";
import {
  OutboxEventStatus,
  Prisma,
  type OutboxEvent
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";

export type BackgroundJobStatus = "pending" | "publishing" | "enqueued" | "failed";

export type OutboxJob = OutboxEvent;

type OutboxClient = Pick<PrismaService, "outboxEvent"> | Prisma.TransactionClient;

interface EnqueueOptions {
  aggregateId: string;
  aggregateType: string;
  availableAt?: Date;
  client?: OutboxClient;
  deduplicationKey?: string;
  maxAttempts?: number;
}

export interface PublishFailure {
  category: string;
  message: string;
  retryable: boolean;
}

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async enqueue<TPayload>(
    eventType: string,
    payload: TPayload,
    options: EnqueueOptions
  ): Promise<OutboxJob> {
    const client = options.client ?? this.prisma;
    const idempotencyKey =
      options.deduplicationKey ?? `${eventType}:${randomUUID()}`;

    try {
      return await client.outboxEvent.create({
        data: {
          eventType,
          aggregateType: options.aggregateType,
          aggregateId: options.aggregateId,
          payload: this.toJsonPayload(payload),
          idempotencyKey,
          maxAttempts: options.maxAttempts ?? 3,
          availableAt: options.availableAt ?? new Date()
        }
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const existing = await client.outboxEvent.findUnique({
          where: { idempotencyKey }
        });

        if (existing) {
          return existing;
        }
      }

      throw error;
    }
  }

  async listJobs(eventType?: string) {
    return this.prisma.outboxEvent.findMany({
      where: eventType ? { eventType } : undefined,
      orderBy: { createdAt: "asc" }
    });
  }

  async claimPublishableJobs(
    limit: number,
    workerIdentity: string,
    leaseMs: number,
    eventTypes?: string[]
  ) {
    const boundedLimit = Math.min(Math.max(limit, 1), 100);
    const now = new Date();
    const claimExpiresAt = new Date(now.getTime() + leaseMs);

    return this.prisma.$transaction(async (transaction) => {
      const typeFilter = eventTypes?.length
        ? Prisma.sql`AND "eventType" IN (${Prisma.join(eventTypes)})`
        : Prisma.empty;
      const candidates = await transaction.$queryRaw<OutboxJob[]>(Prisma.sql`
        SELECT *
        FROM "OutboxEvent"
        WHERE (
          ("status" = 'pending' AND "availableAt" <= ${now})
          OR ("status" = 'publishing' AND "claimExpiresAt" <= ${now})
        )
        ${typeFilter}
        ORDER BY "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${boundedLimit}
      `);

      if (candidates.length === 0) return [];

      const ids = candidates.map((candidate) => candidate.id);
      await transaction.outboxEvent.updateMany({
        where: { id: { in: ids } },
        data: {
          status: OutboxEventStatus.publishing,
          claimedAt: now,
          claimExpiresAt,
          claimedBy: workerIdentity
        }
      });

      return candidates.map((candidate) => ({
        ...candidate,
        status: OutboxEventStatus.publishing,
        claimedAt: now,
        claimExpiresAt,
        claimedBy: workerIdentity
      }));
    });
  }

  async markEnqueued(id: string, workerIdentity: string) {
    const result = await this.prisma.outboxEvent.updateMany({
      where: {
        id,
        status: OutboxEventStatus.publishing,
        claimedBy: workerIdentity
      },
      data: {
        status: OutboxEventStatus.enqueued,
        enqueuedAt: new Date(),
        claimedAt: null,
        claimExpiresAt: null,
        claimedBy: null,
        errorCategory: null,
        lastError: null
      }
    });
    return result.count === 1;
  }

  async markPublishFailed(
    job: OutboxJob,
    workerIdentity: string,
    failure: PublishFailure
  ) {
    const nextAttempts = job.attempts + 1;
    const exhausted = !failure.retryable || nextAttempts >= job.maxAttempts;

    this.logger.warn(
      `Outbox publish failed type=${job.eventType} id=${job.id.slice(0, 12)} category=${failure.category} retryable=${failure.retryable}`
    );

    const result = await this.prisma.outboxEvent.updateMany({
      where: {
        id: job.id,
        status: OutboxEventStatus.publishing,
        claimedBy: workerIdentity
      },
      data: {
        attempts: nextAttempts,
        status: exhausted ? OutboxEventStatus.failed : OutboxEventStatus.pending,
        errorCategory: failure.category.slice(0, 100),
        lastError: failure.message.slice(0, 500),
        claimedAt: null,
        claimExpiresAt: null,
        claimedBy: null,
        availableAt: exhausted
          ? job.availableAt
          : new Date(Date.now() + this.retryDelayMs(nextAttempts))
      }
    });
    return result.count === 1;
  }

  recoverExpiredClaims(now = new Date()) {
    return this.prisma.outboxEvent.updateMany({
      where: {
        status: OutboxEventStatus.publishing,
        claimExpiresAt: { lte: now }
      },
      data: {
        status: OutboxEventStatus.pending,
        claimedAt: null,
        claimExpiresAt: null,
        claimedBy: null,
        availableAt: now,
        errorCategory: "publisher_claim_expired",
        lastError: "The publisher claim expired before Redis acceptance was recorded."
      }
    });
  }

  private retryDelayMs(attempts: number) {
    const base = Math.min(300_000, 5_000 * 2 ** Math.max(0, attempts - 1));
    return Math.round(base * (0.75 + Math.random() * 0.5));
  }

  private toJsonPayload(payload: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue;
  }

  private isUniqueViolation(error: unknown) {
    return (
      (error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002") ||
      (typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === "P2002")
    );
  }
}
