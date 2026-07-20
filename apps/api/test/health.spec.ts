import type { INestApplication } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { ApiResponseInterceptor } from "../src/common/api-response.interceptor";
import { HealthController } from "../src/health/health.controller";
import { HealthService } from "../src/health/health.service";
import type { QueueObservabilityService } from "../src/operations/queue-observability.service";
import type { PrismaService } from "../src/prisma/prisma.service";

type ReadyMocks = {
  postgresql?: "ok" | "failed";
  redis?: "ok" | "failed";
  config?: Record<string, unknown>;
};

async function createApp(mocks: ReadyMocks = {}) {
  const prisma = {
    $queryRaw: mocks.postgresql === "failed"
      ? jest.fn().mockRejectedValue(new Error("database unavailable"))
      : jest.fn().mockResolvedValue([{ one: 1 }])
  };
  const configValues = mocks.config ?? {};
  const config = {
    get: jest.fn((key: string) => configValues[key])
  };
  const queues = {
    readiness: mocks.redis === "failed"
      ? jest.fn().mockResolvedValue({ reachable: false, policy: null, policyVerified: false })
      : jest.fn().mockResolvedValue({ reachable: true, policy: "noeviction", policyVerified: true })
  };
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [
      HealthService,
      { provide: "PRISMA", useValue: prisma },
      { provide: "CONFIG", useValue: config },
      { provide: "QUEUES", useValue: queues }
    ]
  })
    .overrideProvider(HealthService)
    .useValue(
      new HealthService(
        prisma as unknown as PrismaService,
        config as unknown as ConfigService,
        queues as unknown as QueueObservabilityService
      )
    )
    .compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalInterceptors(new ApiResponseInterceptor());
  await app.listen(0, "127.0.0.1");
  return { app, queues };
}

async function get(app: INestApplication, path: string) {
  const address = app.getHttpServer().address() as AddressInfo;
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const req = request(
      { hostname: "127.0.0.1", port: address.port, path, method: "GET" },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => resolve({
          status: response.statusCode ?? 0,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>
        }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

describe("Health HTTP contract", () => {
  jest.setTimeout(15_000);
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("keeps liveness public and returns HTTP 200 in the standard envelope", async () => {
    ({ app } = await createApp({ postgresql: "failed" }));
    await expect(get(app, "/health/live")).resolves.toMatchObject({
      status: 200,
      body: { data: { service: "medicn-api", status: "ok" }, meta: {}, error: null }
    });
  });

  it("returns HTTP 200 when required dependencies are ready", async () => {
    ({ app } = await createApp());
    await expect(get(app, "/health/ready")).resolves.toMatchObject({
      status: 200,
      body: { data: { status: "ready", checks: { postgresql: { status: "ok" } } }, meta: {}, error: null }
    });
  });

  it("returns HTTP 503 with the safe readiness body when PostgreSQL fails", async () => {
    ({ app } = await createApp({ postgresql: "failed" }));
    await expect(get(app, "/health/ready")).resolves.toMatchObject({
      status: 503,
      body: { data: { status: "not_ready", checks: { postgresql: { status: "failed" } } }, meta: {}, error: null }
    });
  });

  it("returns HTTP 503 when required Redis is unreachable", async () => {
    ({ app } = await createApp({
      redis: "failed",
      config: { TRANSACTIONAL_EMAIL_ENABLED: true, EMAIL_PROVIDER: "local" }
    }));
    await expect(get(app, "/health/ready")).resolves.toMatchObject({
      status: 503,
      body: { data: { status: "not_ready", checks: { redis: { status: "failed" } } }, meta: {}, error: null }
    });
  });

  it("treats Redis as required when distributed rate limiting is enabled", async () => {
    ({ app } = await createApp({
      redis: "failed",
      config: { RATE_LIMITING_ENABLED: true }
    }));
    await expect(get(app, "/health/ready")).resolves.toMatchObject({
      status: 503,
      body: {
        data: { status: "not_ready", checks: { redis: { status: "failed" } } }
      }
    });
  });

  it("does not require Redis or optional providers when those features are disabled", async () => {
    const result = await createApp();
    app = result.app;
    await expect(get(app, "/health/ready")).resolves.toMatchObject({
      status: 200,
      body: {
        data: {
          status: "ready",
          checks: { redis: { status: "skipped" }, transactionalEmail: { enabled: false } }
        },
        meta: {},
        error: null
      }
    });
    expect(result.queues.readiness).not.toHaveBeenCalled();
  });
});
