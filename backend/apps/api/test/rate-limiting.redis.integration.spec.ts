import type { ConfigService } from "@nestjs/config";
import { RedisRateLimitStore } from "../src/common/http/redis-rate-limit.store";

const describeWithRedis =
  process.env.RUN_REDIS_INTEGRATION_TESTS === "true" ? describe : describe.skip;

describeWithRedis("Redis rate-limit counter", () => {
  jest.setTimeout(15_000);
  const stores: RedisRateLimitStore[] = [];

  afterEach(async () => {
    await Promise.all(stores.splice(0).map((store) => store.onModuleDestroy()));
  });

  it("shares an atomic counter across instances and resets after the window", async () => {
    const values: Record<string, unknown> = {
      REDIS_URL: process.env.REDIS_URL,
      REDIS_CONNECT_TIMEOUT_MS: 5_000
    };
    const config = { get: (key: string) => values[key] } as ConfigService;
    const one = new RedisRateLimitStore(config);
    const two = new RedisRateLimitStore(config);
    stores.push(one, two);
    const key = `medicn-test:rate:${Date.now()}`;

    const [first, second] = await Promise.all([
      one.increment(key, 150),
      two.increment(key, 150)
    ]);
    expect([first.count, second.count].sort()).toEqual([1, 2]);

    await new Promise((resolve) => setTimeout(resolve, 200));
    await expect(one.increment(key, 150)).resolves.toMatchObject({ count: 1 });
  });
});
