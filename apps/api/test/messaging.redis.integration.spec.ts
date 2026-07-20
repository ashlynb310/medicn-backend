import type { INestApplicationContext } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { createServer, type Server as HttpServer } from "node:http";
import { createClient, type RedisClientType } from "redis";
import { type Namespace, type Server, type ServerOptions } from "socket.io";
import { io as createSocketClient, type Socket } from "socket.io-client";
import { MessagingRealtimeService } from "../src/messaging/messaging-realtime.service";
import { MessagingSocketAdapter } from "../src/messaging/messaging-socket.adapter";

const describeWithRedis =
  process.env.RUN_REDIS_INTEGRATION_TESTS === "true" ? describe : describe.skip;

describeWithRedis("messaging Redis/Socket.IO propagation", () => {
  let httpOne: HttpServer;
  let httpTwo: HttpServer;
  let adapterOne: MessagingSocketAdapter;
  let adapterTwo: MessagingSocketAdapter;
  let ioOne: Server;
  let ioTwo: Server;
  let namespaceOne: Namespace;
  let namespaceTwo: Namespace;
  let observer: RedisClientType;
  let client: Socket;
  const prefix = `medicn-test-${Date.now()}`;
  const adapterKey = `${prefix}:socket.io`;

  beforeAll(async () => {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) throw new Error("REDIS_URL is required for Redis integration tests.");
    const values: Record<string, string | number> = {
      REDIS_URL: redisUrl,
      REDIS_KEY_PREFIX: prefix,
      ALLOWED_ORIGINS: "http://127.0.0.1",
      REDIS_CONNECT_TIMEOUT_MS: 5_000,
      MESSAGING_PING_INTERVAL_MS: 25_000,
      MESSAGING_PING_TIMEOUT_MS: 20_000
    };
    const config = {
      get: <T>(key: string) => values[key] as T | undefined
    } as ConfigService;

    httpOne = createServer();
    httpTwo = createServer();
    adapterOne = new MessagingSocketAdapter(
      httpOne as unknown as INestApplicationContext,
      config
    );
    adapterTwo = new MessagingSocketAdapter(
      httpTwo as unknown as INestApplicationContext,
      config
    );
    await Promise.all([adapterOne.connectToRedis(), adapterTwo.connectToRedis()]);
    const socketOptions = { transports: ["websocket"] } as ServerOptions;
    ioOne = adapterOne.createIOServer(0, socketOptions);
    ioTwo = adapterTwo.createIOServer(0, socketOptions);
    namespaceOne = ioOne.of("/messaging");
    namespaceTwo = ioTwo.of("/messaging");
    namespaceTwo.on("connection", (socket) => void socket.join("inquiry:redis-test"));

    observer = createClient({ url: redisUrl }) as RedisClientType;
    observer.on("error", () => undefined);
    await observer.connect();
    await Promise.all([
      new Promise<void>((resolve) => httpOne.listen(0, "127.0.0.1", resolve)),
      new Promise<void>((resolve) => httpTwo.listen(0, "127.0.0.1", resolve))
    ]);
    const address = httpTwo.address();
    if (!address || typeof address === "string") throw new Error("missing test port");
    client = createSocketClient(`http://127.0.0.1:${address.port}/messaging`, {
      transports: ["websocket"]
    });
    await new Promise<void>((resolve, reject) => {
      client.once("connect", resolve);
      client.once("connect_error", reject);
    });
  });

  afterAll(async () => {
    client?.close();
    if (observer?.isOpen) await observer.quit();
    await Promise.allSettled([
      adapterOne && ioOne ? adapterOne.close(ioOne) : Promise.resolve(),
      adapterTwo && ioTwo ? adapterTwo.close(ioTwo) : Promise.resolve()
    ]);
  });

  it("propagates an opaque realtime event between two configured application adapters", async () => {
    const payload = {
      eventId: "message:redis-message-1",
      inquiryId: "redis-test",
      messageId: "redis-message-1",
      sequence: 7,
      createdAt: new Date().toISOString()
    };
    const privateCanary = "PRIVATE_MESSAGE_BODY_CANARY@example.com";
    const redisPackets: string[] = [];
    await observer.pSubscribe(`${adapterKey}#*`, (message) => {
      redisPackets.push(message);
    });
    const received = new Promise<typeof payload>((resolve) => {
      client.once("message.created", resolve);
    });
    const realtime = new MessagingRealtimeService();
    realtime.register(namespaceOne);

    realtime.publish([
      {
        name: "message.created",
        rooms: ["inquiry:redis-test"],
        payload
      }
    ]);

    await expect(received).resolves.toEqual(payload);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(redisPackets.length).toBeGreaterThan(0);
    const serializedPackets = redisPackets.join("\n");
    expect(serializedPackets).toContain("redis-message-1");
    expect(serializedPackets).not.toContain(privateCanary);
    expect(serializedPackets).not.toContain("body");
    expect(serializedPackets).not.toContain("recipientEmail");
  });
});
