import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import { OPERATIONS_QUEUE_NAME } from "../operations/operations.types";
import type { OutboxJob } from "./jobs.service";
import { bullMqPrefix, redisConnectionFromConfig } from "./redis";

@Injectable()
export class BullMqOperationsQueueService implements OnModuleDestroy {
  private queue?: Queue;

  constructor(private readonly config: ConfigService) {}

  async add(job: OutboxJob) {
    await this.getQueue().add(job.eventType, job.payload, {
      jobId: job.id,
      attempts: job.maxAttempts,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: 1_000,
      removeOnFail: false
    });
  }

  async onModuleDestroy() {
    await this.queue?.close();
  }

  private getQueue() {
    if (!this.queue) {
      this.queue = new Queue(OPERATIONS_QUEUE_NAME, {
        connection: redisConnectionFromConfig(this.config, "producer"),
        prefix: bullMqPrefix(this.config)
      });
      this.queue.on("error", () => undefined);
    }
    return this.queue;
  }
}
