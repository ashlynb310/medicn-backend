import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import { bullMqPrefix, redisConnectionFromConfig } from "../jobs/redis";
import { OPERATION_SCHEDULES, OPERATIONS_QUEUE_NAME } from "./operations.types";

@Injectable()
export class OperationsQueueService implements OnModuleDestroy {
  private queue?: Queue;

  constructor(private readonly config: ConfigService) {}

  async upsertSchedulers() {
    const recovery = this.config.get<number>("OPERATIONS_RECOVERY_INTERVAL_MS") ?? 60_000;
    const maintenance = this.config.get<number>("OPERATIONS_MAINTENANCE_INTERVAL_MS") ?? 300_000;
    for (const schedule of OPERATION_SCHEDULES) {
      await this.getQueue().upsertJobScheduler(
        schedule.schedulerId,
        { every: schedule.interval === "recovery" ? recovery : maintenance },
        {
          name: schedule.name,
          data: {},
          opts: {
            attempts: 3,
            backoff: { type: "exponential", delay: 5_000 },
            removeOnComplete: 1_000,
            removeOnFail: false
          }
        }
      );
    }
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
