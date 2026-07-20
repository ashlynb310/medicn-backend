import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createHash } from "node:crypto";
import {
  DistributedRateLimitService,
  type RateLimitPolicyName
} from "./distributed-rate-limit.service";
import { RATE_LIMIT_POLICY } from "./rate-limit.decorator";

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: DistributedRateLimitService
  ) {}

  async canActivate(context: ExecutionContext) {
    if (context.getType() !== "http") return true;
    const policy = this.reflector.getAllAndOverride<RateLimitPolicyName>(
      RATE_LIMIT_POLICY,
      [context.getHandler(), context.getClass()]
    );
    if (!policy) return true;

    const request = context.switchToHttp().getRequest<{
      ip?: string;
      headers: { authorization?: string };
    }>();
    const response = context.switchToHttp().getResponse<{
      setHeader(name: string, value: string): void;
    }>();
    const token = request.headers.authorization?.match(/^Bearer ([^\s]+)$/)?.[1];
    const subject = token
      ? `auth:${createHash("sha256").update(token).digest("hex")}`
      : `ip:${request.ip ?? "unknown"}`;

    try {
      const decision = await this.limiter.consume(policy, subject);
      response.setHeader("ratelimit-policy", policy);
      response.setHeader("ratelimit-limit", String(decision.limit));
      response.setHeader("ratelimit-remaining", String(decision.remaining));
      return true;
    } catch (error) {
      const retryAfterSeconds = this.retryAfter(error);
      if (retryAfterSeconds) {
        response.setHeader("retry-after", String(retryAfterSeconds));
      }
      throw error;
    }
  }

  private retryAfter(error: unknown) {
    if (typeof error !== "object" || error === null || !("response" in error)) {
      return undefined;
    }
    const response = (error as {
      response?: { details?: { retryAfterSeconds?: unknown } };
    }).response;
    return typeof response?.details?.retryAfterSeconds === "number"
      ? response.details.retryAfterSeconds
      : undefined;
  }
}
