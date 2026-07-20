import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { QueueObservabilityService } from "../operations/queue-observability.service";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly queues: QueueObservabilityService
  ) {}

  async ready() {
    const checks: Record<string, unknown> = {};
    let ready = true;
    try {
      await this.prisma.$queryRaw(Prisma.sql`SELECT 1`);
      checks.postgresql = { status: "ok" };
    } catch {
      checks.postgresql = { status: "failed" };
      ready = false;
    }

    const queuesRequired = [
      "TRANSACTIONAL_EMAIL_ENABLED",
      "MEDIA_PROCESSING_ENABLED",
      "MAPS_ENABLED",
      "OPERATIONS_SCHEDULER_ENABLED",
      "RATE_LIMITING_ENABLED"
    ].some((key) => this.config.get<boolean>(key));
    if (queuesRequired || this.config.get<string>("REDIS_URL")) {
      try {
        const redis = await this.queues.readiness();
        checks.redis = {
          status: redis.reachable ? "ok" : "failed",
          evictionPolicy: redis.policy,
          policyVerified: redis.policyVerified,
          warning: redis.policyVerified && redis.policy !== "noeviction"
            ? "Redis should use noeviction for BullMQ."
            : undefined
        };
        if (!redis.reachable) ready = false;
      } catch {
        checks.redis = { status: "failed" };
        ready = false;
      }
    } else {
      checks.redis = { status: "skipped" };
    }

    const provider = this.config.get<string>("EMAIL_PROVIDER") ?? "local";
    const emailEnabled = this.config.get<boolean>("TRANSACTIONAL_EMAIL_ENABLED") ?? false;
    const providerReady = !emailEnabled || provider === "local" || Boolean(
      this.config.get<string>("BREVO_API_KEY") &&
      this.config.get<string>("TRANSACTIONAL_EMAIL_FROM") &&
      this.config.get<string>("BREVO_WEBHOOK_BEARER_TOKEN")
    );
    checks.transactionalEmail = { status: providerReady ? "ok" : "failed", provider, enabled: emailEnabled };
    if (!providerReady) ready = false;

    return { service: "medicn-api", status: ready ? "ready" : "not_ready", checks, timestamp: new Date().toISOString() };
  }
}
