import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import { EMAIL_QUEUE_NAME } from "../email/email.types";
import { bullMqPrefix, redisConnectionFromConfig } from "../jobs/redis";
import { MAPS_QUEUE_NAME } from "../maps/maps.types";
import { MEDIA_QUEUE_NAME } from "../media/media.types";
import { OPERATIONS_QUEUE_NAME } from "./operations.types";

const OBSERVED_QUEUES = [EMAIL_QUEUE_NAME, MEDIA_QUEUE_NAME, MAPS_QUEUE_NAME, OPERATIONS_QUEUE_NAME] as const;

@Injectable()
export class QueueObservabilityService implements OnModuleDestroy {
  private readonly queues = new Map<string, Queue>();

  constructor(private readonly config: ConfigService) {}

  async snapshot() {
    if (!this.config.get<string>("REDIS_URL")) return [];
    return Promise.all(OBSERVED_QUEUES.map(async (name) => ({
      name,
      counts: await this.getQueue(name).getJobCounts("waiting", "active", "delayed", "failed", "paused")
    })));
  }

  async readiness() {
    if (!this.config.get<string>("REDIS_URL")) {
      return { reachable: false, policy: "not_configured", policyVerified: false };
    }
    const client = await this.getQueue(OPERATIONS_QUEUE_NAME).client as unknown as {
      ping(): Promise<string>;
      config(command: "GET", key: string): Promise<string[]>;
    };
    await client.ping();
    try {
      const result = await client.config("GET", "maxmemory-policy") as string[];
      const policy = result[1] ?? "unknown";
      return { reachable: true, policy, policyVerified: true };
    } catch {
      return { reachable: true, policy: "unverifiable", policyVerified: false };
    }
  }

  async onModuleDestroy() {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
  }

  private getQueue(name: string) {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, {
        connection: redisConnectionFromConfig(this.config, "producer"),
        prefix: bullMqPrefix(this.config)
      });
      queue.on("error", () => undefined);
      this.queues.set(name, queue);
    }
    return queue;
  }
}
