import { Logger, type INestApplicationContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient, type RedisClientType } from "redis";
import type { Server, ServerOptions } from "socket.io";

export class MessagingSocketAdapter extends IoAdapter {
  private readonly logger = new Logger(MessagingSocketAdapter.name);
  private pubClient?: RedisClientType;
  private subClient?: RedisClientType;
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private closed = false;

  constructor(
    app: INestApplicationContext,
    private readonly config: ConfigService
  ) {
    super(app);
  }

  async connectToRedis() {
    const url = this.config.get<string>("REDIS_URL");
    if (!url) {
      this.logger.warn("messaging_redis_adapter_disabled reason=missing_url");
      return;
    }
    const connectTimeout = this.config.get<number>("REDIS_CONNECT_TIMEOUT_MS") ?? 5_000;
    const socket = { connectTimeout, reconnectStrategy: false as const };
    const pubClient = createClient({ url, socket });
    const subClient = pubClient.duplicate();
    pubClient.on("error", () => undefined);
    subClient.on("error", () => undefined);
    try {
      await Promise.all([pubClient.connect(), subClient.connect()]);
      this.pubClient = pubClient as RedisClientType;
      this.subClient = subClient as RedisClientType;
      this.adapterConstructor = createAdapter(pubClient, subClient, {
        key: `${this.config.get<string>("REDIS_KEY_PREFIX") ?? "medicn"}:socket.io`
      });
      this.logger.log("messaging_redis_adapter_connected");
    } catch {
      await Promise.allSettled([pubClient.close(), subClient.close()]);
      this.logger.warn("messaging_redis_adapter_unavailable fallback=local_socket_io");
    }
  }

  createIOServer(port: number, options?: ServerOptions) {
    const allowedOrigins =
      this.config
        .get<string>("ALLOWED_ORIGINS")
        ?.split(",")
        .map((origin) => origin.trim()) ?? ["http://localhost:3000"];
    const server = super.createIOServer(port, {
      ...options,
      cors: { origin: allowedOrigins, credentials: true },
      pingInterval: this.config.get<number>("MESSAGING_PING_INTERVAL_MS") ?? 25_000,
      pingTimeout: this.config.get<number>("MESSAGING_PING_TIMEOUT_MS") ?? 20_000,
      maxHttpBufferSize: 16_384
    });
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }

  async close(server: Server) {
    await super.close(server);
    if (this.closed) return;
    this.closed = true;
    await Promise.allSettled([
      this.pubClient?.quit() ?? Promise.resolve(),
      this.subClient?.quit() ?? Promise.resolve()
    ]);
  }
}
