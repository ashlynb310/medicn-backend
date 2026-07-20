import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, type RedisClientType } from "redis";
import type { RateLimitCounterStore } from "./distributed-rate-limit.service";

const INCREMENT_WITH_EXPIRY = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return { current, ttl }
`;

@Injectable()
export class RedisRateLimitStore
  implements RateLimitCounterStore, OnModuleDestroy
{
  private client?: RedisClientType;
  private connecting?: Promise<RedisClientType>;

  constructor(private readonly config: ConfigService) {}

  async increment(key: string, windowMilliseconds: number) {
    const client = await this.getClient();
    const result = (await client.eval(INCREMENT_WITH_EXPIRY, {
      keys: [key],
      arguments: [String(windowMilliseconds)]
    })) as [number, number];
    return {
      count: Number(result[0]),
      ttlMilliseconds: Math.max(0, Number(result[1]))
    };
  }

  async onModuleDestroy() {
    const client = this.client;
    this.client = undefined;
    this.connecting = undefined;
    if (client?.isOpen) await client.quit();
  }

  private async getClient() {
    if (this.client?.isReady) return this.client;
    if (this.connecting) return this.connecting;

    const url = this.config.get<string>("REDIS_URL");
    if (!url) throw new Error("rate_limit_redis_not_configured");
    const candidate = createClient({
      url,
      socket: {
        connectTimeout:
          this.config.get<number>("REDIS_CONNECT_TIMEOUT_MS") ?? 5_000,
        reconnectStrategy: false
      }
    }) as RedisClientType;
    candidate.on("error", () => undefined);
    this.connecting = candidate
      .connect()
      .then(() => {
        this.client = candidate;
        return candidate;
      })
      .catch(async (error: unknown) => {
        if (candidate.isOpen) await candidate.close();
        throw error;
      })
      .finally(() => {
        this.connecting = undefined;
      });
    return this.connecting;
  }
}
