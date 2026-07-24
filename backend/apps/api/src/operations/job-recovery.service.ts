import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JobExecutionState, OutboxEventStatus } from "@prisma/client";
import { Queue } from "bullmq";
import { EMAIL_QUEUE_NAME } from "../email/email.types";
import { bullMqPrefix, redisConnectionFromConfig } from "../jobs/redis";
import { MAPS_QUEUE_NAME } from "../maps/maps.types";
import { MEDIA_QUEUE_NAME } from "../media/media.types";
import { PrismaService } from "../prisma/prisma.service";
import { OPERATIONS_QUEUE_NAME } from "./operations.types";

export const RECOVERABLE_QUEUE_NAMES = new Set([
  EMAIL_QUEUE_NAME,
  MEDIA_QUEUE_NAME,
  MAPS_QUEUE_NAME,
  OPERATIONS_QUEUE_NAME
]);

@Injectable()
export class JobRecoveryService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async requeue(executionId: string) {
    const execution = await this.prisma.jobExecution.findUnique({ where: { id: executionId } });
    if (!execution) throw new NotFoundException("Job execution was not found.");
    if (execution.state !== JobExecutionState.failed || execution.retryable !== true || !RECOVERABLE_QUEUE_NAMES.has(execution.queueName)) {
      throw new BadRequestException("Only retryable failed executions on known queues can be requeued.");
    }
    const queue = new Queue(execution.queueName, {
      connection: redisConnectionFromConfig(this.config, "producer"),
      prefix: bullMqPrefix(this.config)
    });
    queue.on("error", () => undefined);
    try {
      const job = await queue.getJob(execution.jobId);
      if (job) {
        await job.retry("failed");
        return { action: "bullmq_retry", queue: execution.queueName, jobId: execution.jobId.slice(0, 12) };
      }
      if (!execution.outboxEventId) throw new BadRequestException("The failed job is no longer present in Redis and has no outbox event.");
      const reset = await this.prisma.outboxEvent.updateMany({
        where: {
          id: execution.outboxEventId,
          status: { in: [OutboxEventStatus.enqueued, OutboxEventStatus.failed] }
        },
        data: {
          status: OutboxEventStatus.pending,
          attempts: 0,
          availableAt: new Date(),
          enqueuedAt: null,
          claimedAt: null,
          claimExpiresAt: null,
          claimedBy: null,
          errorCategory: null,
          lastError: null
        }
      });
      if (reset.count !== 1) throw new BadRequestException("The outbox event is not in a recoverable state.");
      return { action: "outbox_republish", queue: execution.queueName, jobId: execution.jobId.slice(0, 12) };
    } finally {
      await queue.close();
    }
  }
}
