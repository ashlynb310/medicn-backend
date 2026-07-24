import type { ConnectionOptions } from "bullmq";
import type { ConfigService } from "@nestjs/config";
import { OperationalError } from "./operational-error";

export type RedisConnectionMode = "producer" | "worker";

interface RedisConnectionSettings {
  connectTimeoutMs?: number;
  maxRetryDelayMs?: number;
}

export function requireRedisUrl(redisUrl: string | undefined) {
  if (!redisUrl) {
    throw new OperationalError(
      "redis_configuration_missing",
      "Redis is required for this queue process.",
      false
    );
  }

  return redisUrl;
}

export function createRedisConnection(
  redisUrl: string,
  mode: RedisConnectionMode = "producer",
  settings: RedisConnectionSettings = {}
): ConnectionOptions {
  let url: URL;
  try {
    url = new URL(redisUrl);
  } catch (error) {
    throw new OperationalError(
      "redis_configuration_invalid",
      "The Redis URL is invalid.",
      false,
      { cause: error }
    );
  }
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new OperationalError(
      "redis_configuration_invalid",
      "The Redis URL must use redis or rediss.",
      false
    );
  }
  const db = url.pathname.length > 1 ? Number(url.pathname.slice(1)) : undefined;
  const maxRetryDelayMs = settings.maxRetryDelayMs ?? 10_000;

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    ...(url.username
      ? { username: decodeURIComponent(url.username) }
      : {}),
    ...(url.password
      ? { password: decodeURIComponent(url.password) }
      : {}),
    ...(db === undefined || Number.isNaN(db) ? {} : { db }),
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
    connectTimeout: settings.connectTimeoutMs ?? 5_000,
    enableOfflineQueue: mode === "worker",
    maxRetriesPerRequest: mode === "worker" ? null : 1,
    retryStrategy: (attempts) =>
      Math.min(maxRetryDelayMs, Math.max(250, 250 * 2 ** Math.min(attempts - 1, 8)))
  };
}

export function redisConnectionFromConfig(
  config: Pick<ConfigService, "get">,
  mode: RedisConnectionMode
) {
  return createRedisConnection(
    requireRedisUrl(config.get<string>("REDIS_URL")),
    mode,
    {
      connectTimeoutMs: config.get<number>("REDIS_CONNECT_TIMEOUT_MS") ?? 5_000,
      maxRetryDelayMs: config.get<number>("REDIS_MAX_RETRY_DELAY_MS") ?? 10_000
    }
  );
}

export function bullMqPrefix(config: Pick<ConfigService, "get">) {
  return config.get<string>("REDIS_KEY_PREFIX") ?? "medicn";
}
