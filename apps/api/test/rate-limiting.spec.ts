import { ServiceUnavailableException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import {
  DistributedRateLimitService,
  RATE_LIMIT_POLICIES,
  type RateLimitCounterStore
} from "../src/common/http/distributed-rate-limit.service";

function service(store: RateLimitCounterStore, enabled = true) {
  const values: Record<string, unknown> = {
    RATE_LIMITING_ENABLED: enabled,
    REDIS_KEY_PREFIX: "medicn-test"
  };
  return new DistributedRateLimitService(
    { get: (key: string) => values[key] } as ConfigService,
    store
  );
}

describe("distributed rate-limit policy", () => {
  it("isolates endpoint policies and opaque subjects", async () => {
    const keys: string[] = [];
    const store: RateLimitCounterStore = {
      increment: jest.fn(async (key) => {
        keys.push(key);
        return { count: 1, ttlMilliseconds: 60_000 };
      })
    };
    const limiter = service(store);

    await limiter.consume("inquiry_create", "auth:user-one");
    await limiter.consume("message_send", "auth:user-one");
    await limiter.consume("message_send", "auth:user-two");

    expect(new Set(keys).size).toBe(3);
    expect(keys.join("\n")).not.toContain("user-one");
    expect(keys.join("\n")).not.toContain("user-two");
  });

  it("returns stable 429 behavior with reset information", async () => {
    const store: RateLimitCounterStore = {
      increment: jest.fn().mockResolvedValue({
        count: RATE_LIMIT_POLICIES.inquiry_create.limit + 1,
        ttlMilliseconds: 2_500
      })
    };

    await expect(
      service(store).consume("inquiry_create", "ip:127.0.0.1")
    ).rejects.toMatchObject({
      status: 429,
      response: {
        code: "RATE_LIMIT_EXCEEDED",
        details: { retryAfterSeconds: 3 }
      }
    });
  });

  it("fails closed for sensitive mutations and open for public reads when Redis is unavailable", async () => {
    const store: RateLimitCounterStore = {
      increment: jest.fn().mockRejectedValue(new Error("private redis failure"))
    };
    await expect(
      service(store).consume("checkout_or_cancel", "auth:subject")
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      service(store).consume("public_search", "ip:127.0.0.1")
    ).resolves.toMatchObject({ allowed: true, storeAvailable: false });
  });

  it("does not contact Redis when rate limiting is explicitly disabled", async () => {
    const store: RateLimitCounterStore = { increment: jest.fn() };
    await expect(
      service(store, false).consume("admin_command", "auth:subject")
    ).resolves.toMatchObject({ allowed: true, disabled: true });
    expect(store.increment).not.toHaveBeenCalled();
  });
});
