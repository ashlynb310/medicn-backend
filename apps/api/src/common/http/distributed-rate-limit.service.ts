import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  ServiceUnavailableException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";

export type RateLimitPolicyName =
  | "public_search"
  | "public_calendar"
  | "inquiry_create"
  | "message_send"
  | "upload_intent"
  | "identity_session"
  | "checkout_or_cancel"
  | "admin_command"
  | "websocket_connect"
  | "websocket_event";

interface RateLimitPolicy {
  limit: number;
  windowMilliseconds: number;
  fail: "open" | "closed";
}

export const RATE_LIMIT_POLICIES: Record<
  RateLimitPolicyName,
  RateLimitPolicy
> = {
  public_search: { limit: 120, windowMilliseconds: 60_000, fail: "open" },
  public_calendar: { limit: 120, windowMilliseconds: 60_000, fail: "open" },
  inquiry_create: { limit: 10, windowMilliseconds: 60_000, fail: "closed" },
  message_send: { limit: 60, windowMilliseconds: 60_000, fail: "closed" },
  upload_intent: { limit: 20, windowMilliseconds: 60_000, fail: "closed" },
  identity_session: {
    limit: 5,
    windowMilliseconds: 10 * 60_000,
    fail: "closed"
  },
  checkout_or_cancel: {
    limit: 10,
    windowMilliseconds: 60_000,
    fail: "closed"
  },
  admin_command: { limit: 20, windowMilliseconds: 60_000, fail: "closed" },
  websocket_connect: {
    limit: 20,
    windowMilliseconds: 60_000,
    fail: "closed"
  },
  websocket_event: {
    limit: 120,
    windowMilliseconds: 60_000,
    fail: "closed"
  }
};

export interface RateLimitCounterStore {
  increment(
    key: string,
    windowMilliseconds: number
  ): Promise<{ count: number; ttlMilliseconds: number }>;
}

export const RATE_LIMIT_COUNTER_STORE = Symbol("RATE_LIMIT_COUNTER_STORE");

@Injectable()
export class DistributedRateLimitService {
  constructor(
    private readonly config: ConfigService,
    @Inject(RATE_LIMIT_COUNTER_STORE)
    private readonly store: RateLimitCounterStore
  ) {}

  async consume(policyName: RateLimitPolicyName, subject: string) {
    const policy = RATE_LIMIT_POLICIES[policyName];
    if (!this.config.get<boolean>("RATE_LIMITING_ENABLED")) {
      return {
        allowed: true,
        disabled: true,
        storeAvailable: false,
        limit: policy.limit,
        remaining: policy.limit
      };
    }

    const prefix = this.config.get<string>("REDIS_KEY_PREFIX") ?? "medicn";
    const digest = createHash("sha256").update(subject).digest("hex");
    const key = `${prefix}:rate:v1:${policyName}:${digest}`;
    try {
      const result = await this.store.increment(
        key,
        policy.windowMilliseconds
      );
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil(result.ttlMilliseconds / 1_000)
      );
      if (result.count > policy.limit) {
        throw new HttpException(
          {
            code: "RATE_LIMIT_EXCEEDED",
            message: "Too many requests. Try again later.",
            details: { retryAfterSeconds }
          },
          HttpStatus.TOO_MANY_REQUESTS
        );
      }
      return {
        allowed: true,
        disabled: false,
        storeAvailable: true,
        limit: policy.limit,
        remaining: Math.max(0, policy.limit - result.count),
        retryAfterSeconds
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (policy.fail === "open") {
        return {
          allowed: true,
          disabled: false,
          storeAvailable: false,
          limit: policy.limit,
          remaining: policy.limit
        };
      }
      throw new ServiceUnavailableException({
        code: "RATE_LIMIT_UNAVAILABLE",
        message: "Request protection is temporarily unavailable.",
        details: {}
      });
    }
  }
}
