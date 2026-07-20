import { Injectable, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { SEND_TRANSACTIONAL_EMAIL_JOB } from "../email/email.types";
import { BullMqEmailQueueService } from "./bullmq-email-queue.service";
import { BullMqMediaQueueService } from "./bullmq-media-queue.service";
import { BullMqMapsQueueService } from "./bullmq-maps-queue.service";
import { ENRICH_LISTING_LOCATION_JOB } from "../maps/maps.types";
import { CLEANUP_MEDIA_ASSET_JOB, PROCESS_MEDIA_ASSET_JOB } from "../media/media.types";
import { JobsService, type OutboxJob, type PublishFailure } from "./jobs.service";
import { OperationalError } from "./operational-error";
import { MESSAGING_NOTIFICATION_EMAIL_JOB } from "../messaging/messaging.types";
import { DELETE_HEALTHCARE_EVIDENCE_JOB } from "../healthcare/healthcare.types";
import {
  BOOKING_CANCELLATION_CHECKOUT_EXPIRY_JOB,
  BOOKING_CANCELLATION_EMAIL_JOB,
  BOOKING_CANCELLATION_FULL_REFUND_JOB
} from "../bookings/booking-cancellation.types";
import { BullMqOperationsQueueService } from "./bullmq-operations-queue.service";
import { BOOKING_COMPLETION_EMAIL_JOB } from "../bookings/booking-lifecycle.types";
import { EXECUTE_OPERATIONAL_COMMAND_JOB } from "../operations/operational-command.types";

export interface PublishPendingResult {
  failed: number;
  published: number;
  total: number;
}

@Injectable()
export class OutboxPublisherService {
  private readonly workerIdentity: string;

  constructor(
    private readonly jobs: JobsService,
    private readonly emailQueue: BullMqEmailQueueService,
    @Optional() private readonly mediaQueue?: BullMqMediaQueueService,
    @Optional() private readonly mapsQueue?: BullMqMapsQueueService,
    @Optional() workerIdentity?: string,
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly operationsQueue?: BullMqOperationsQueueService
  ) {
    this.workerIdentity = workerIdentity ?? `outbox-${randomUUID()}`;
  }

  async publishPending(limit = 25, eventTypes?: string[]): Promise<PublishPendingResult> {
    const jobs = await this.jobs.claimPublishableJobs(
      limit,
      this.workerIdentity,
      this.config?.get<number>("OUTBOX_CLAIM_LEASE_MS") ?? 30_000,
      eventTypes
    );
    let published = 0;
    let failed = 0;

    for (const job of jobs) {
      try {
        await this.publish(job);
        await this.jobs.markEnqueued(job.id, this.workerIdentity);
        published += 1;
      } catch (error) {
        await this.jobs.markPublishFailed(
          job,
          this.workerIdentity,
          this.classifyPublishFailure(error)
        );
        failed += 1;
      }
    }

    return {
      total: jobs.length,
      published,
      failed
    };
  }

  private async publish(job: OutboxJob) {
    if (
      job.eventType === SEND_TRANSACTIONAL_EMAIL_JOB ||
      job.eventType === MESSAGING_NOTIFICATION_EMAIL_JOB ||
      job.eventType === BOOKING_CANCELLATION_EMAIL_JOB ||
      job.eventType === BOOKING_COMPLETION_EMAIL_JOB
    ) {
      await this.emailQueue.add(job);
      return;
    }

    if (
      job.eventType === PROCESS_MEDIA_ASSET_JOB ||
      job.eventType === CLEANUP_MEDIA_ASSET_JOB ||
      job.eventType === DELETE_HEALTHCARE_EVIDENCE_JOB
    ) {
      if (!this.mediaQueue) throw new OutboxRouteError(job.eventType);
      await this.mediaQueue.add(job);
      return;
    }
    if (job.eventType === ENRICH_LISTING_LOCATION_JOB) {
      if (!this.mapsQueue) throw new OutboxRouteError(job.eventType);
      await this.mapsQueue.add(job);
      return;
    }
    if (
      job.eventType === BOOKING_CANCELLATION_CHECKOUT_EXPIRY_JOB ||
      job.eventType === BOOKING_CANCELLATION_FULL_REFUND_JOB ||
      job.eventType === EXECUTE_OPERATIONAL_COMMAND_JOB
    ) {
      if (!this.operationsQueue) throw new OutboxRouteError(job.eventType);
      await this.operationsQueue.add(job);
      return;
    }

    throw new OutboxRouteError(job.eventType);
  }

  private classifyPublishFailure(error: unknown): PublishFailure {
    if (error instanceof OutboxRouteError) {
      return {
        category: "outbox_route_missing",
        message: "No BullMQ route is configured for this event type.",
        retryable: false
      };
    }
    if (error instanceof OperationalError) {
      return {
        category: error.category,
        message: error.safeMessage,
        retryable: error.retryable
      };
    }

    return {
      category: "redis_publish_failed",
      message: "BullMQ did not accept the outbox event.",
      retryable: true
    };
  }
}

class OutboxRouteError extends Error {
  constructor(eventType: string) {
    super(`Missing route: ${eventType}`);
  }
}
