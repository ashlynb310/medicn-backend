import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import { MAPS_QUEUE_NAME } from "../maps/maps.types";
import type { OutboxJob } from "./jobs.service";
import { bullMqPrefix, redisConnectionFromConfig } from "./redis";

@Injectable()
export class BullMqMapsQueueService implements OnModuleDestroy {
  private queue: Queue | undefined;
  constructor(private readonly config: ConfigService) {}
  async add(job: OutboxJob) {
    await this.getQueue().add(job.eventType, job.payload, {
      jobId: job.id,
      attempts: job.maxAttempts,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 1000,
      removeOnFail: false
    });
  }
  async onModuleDestroy() { await this.queue?.close(); }
  private getQueue() {
    if (!this.queue) {
      this.queue = new Queue(MAPS_QUEUE_NAME, {
        connection: redisConnectionFromConfig(this.config, "producer"),
        prefix: bullMqPrefix(this.config)
      });
      this.queue.on("error", () => undefined);
    }
    return this.queue;
  }
}
