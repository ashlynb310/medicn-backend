import {
  HttpException,
  HttpStatus,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  type INestApplication
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { AppModule } from "../src/app.module";
import { AuthService } from "../src/auth/auth.service";
import { HealthService } from "../src/health/health.service";
import { ListingsService } from "../src/listings/listings.service";
import { PaymentsService } from "../src/payments/payments.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { configureHttpApplication } from "../src/common/http/configure-http-application";
import { DistributedRateLimitService } from "../src/common/http/distributed-rate-limit.service";
import { BookingsService } from "../src/bookings/bookings.service";
import { AdminOperationsService } from "../src/admin/admin-operations.service";

interface HttpResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

function call(
  app: INestApplication,
  options: {
    method?: string;
    path: string;
    headers?: Record<string, string>;
    body?: string;
  }
) {
  const address = app.getHttpServer().address() as AddressInfo;
  return new Promise<HttpResult>((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port: address.port,
        method: options.method ?? "GET",
        path: options.path,
        headers: options.headers
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let body: unknown = text;
          try {
            body = text ? JSON.parse(text) : null;
          } catch {
            // The malformed JSON test intentionally receives a JSON error body.
          }
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body
          });
        });
      }
    );
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

describe("real Nest HTTP application pipeline", () => {
  jest.setTimeout(20_000);
  let app: INestApplication;
  const rawStripeBodies: Buffer[] = [];
  let limitedPolicy: string | undefined;

  beforeAll(async () => {
    process.env.DATABASE_URL ??=
      "postgresql://medicn:medicn_dev_password@localhost:5432/medicn_dev";
    process.env.NODE_ENV = "test";
    process.env.ALLOWED_ORIGINS = "https://allowed.example";
    process.env.RATE_LIMITING_ENABLED = "false";

    const auth = {
      extractBearerToken: jest.fn((authorization?: string) => {
        const match = authorization?.match(/^Bearer ([^\s]+)$/);
        if (!match) {
          throw new UnauthorizedException({
            code: "UNAUTHORIZED",
            message: "Missing or invalid bearer token.",
            details: {}
          });
        }
        return match[1];
      }),
      getCurrentUserRecord: jest.fn(),
      getAccessTokenExpiry: jest.fn()
    };
    const listings = {
      searchListings: jest.fn().mockResolvedValue({ items: [], pagination: {} }),
      getListing: jest.fn().mockResolvedValue({ id: "listing-public" })
    };
    const payments = {
      handleStripeWebhook: jest.fn((rawBody: Buffer) => {
        rawStripeBodies.push(Buffer.from(rawBody));
        return { received: true };
      })
    };
    const privateNotFound = () =>
      new NotFoundException({
        code: "NOT_FOUND",
        message: "Booking was not found.",
        details: {}
      });
    const bookings = {
      getBooking: jest.fn((token: string, id: string) => {
        if (token === "disabled") {
          throw new ForbiddenException({
            code: "ACCOUNT_DISABLED",
            message: "This MediCN account is disabled.",
            details: {}
          });
        }
        if (token === "unrelated-host" || id === "missing") {
          throw privateNotFound();
        }
        return {
          id,
          status: "paid",
          checkInLocation: token === "participant" ? { address: "allowlisted" } : null
        };
      }),
      createBooking: jest.fn((token: string) => {
        if (token === "unverified") {
          throw new ForbiddenException({
            code: "EMAIL_NOT_VERIFIED",
            message: "Email verification is required.",
            details: {}
          });
        }
        if (token === "host-owner" || token === "unrelated-host") {
          throw new ForbiddenException({
            code: "FORBIDDEN",
            message: "Only renters can create bookings.",
            details: {}
          });
        }
        return { id: "booking-created", status: "requested" };
      }),
      listBookings: jest.fn().mockResolvedValue({ data: [], meta: {}, error: null }),
      decideBooking: jest.fn(),
    };
    const adminOperations = {
      status: jest.fn((token: string) => {
        if (token !== "admin") {
          throw new ForbiddenException({
            code: "FORBIDDEN",
            message: "Administrator access is required.",
            details: {}
          });
        }
        return { status: "ok" };
      })
    };
    const configValues: Record<string, unknown> = {
      NODE_ENV: "test",
      ALLOWED_ORIGINS: "https://allowed.example",
      TRUST_PROXY_HOPS: 0,
      RATE_LIMITING_ENABLED: false
    };
    const limiter = {
      consume: jest.fn(async (policy: string) => {
        if (policy === limitedPolicy) {
          throw new HttpException(
            {
              code: "RATE_LIMIT_EXCEEDED",
              message: "Too many requests. Try again later.",
              details: { retryAfterSeconds: 7 }
            },
            HttpStatus.TOO_MANY_REQUESTS
          );
        }
        return { limit: 120, remaining: 119 };
      })
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(AuthService)
      .useValue(auth)
      .overrideProvider(ListingsService)
      .useValue(listings)
      .overrideProvider(PaymentsService)
      .useValue(payments)
      .overrideProvider(BookingsService)
      .useValue(bookings)
      .overrideProvider(AdminOperationsService)
      .useValue(adminOperations)
      .overrideProvider(HealthService)
      .useValue({
        ready: jest.fn().mockResolvedValue({
          service: "medicn-api",
          status: "ready",
          checks: {},
          timestamp: new Date(0).toISOString()
        })
      })
      .overrideProvider(ConfigService)
      .useValue({
        get: jest.fn((key: string) => configValues[key])
      })
      .overrideProvider(DistributedRateLimitService)
      .useValue(limiter)
      .compile();

    app = moduleRef.createNestApplication({ bodyParser: false, rawBody: true });
    configureHttpApplication(app, { installWebSocketAdapter: false });
    await app.listen(0, "127.0.0.1");
  });

  afterAll(async () => {
    await app.close();
  });

  it("uses the production prefix, response envelope, generated correlation ID, and security headers", async () => {
    const response = await call(app, { path: "/api/v1/health/live" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      data: { service: "medicn-api", status: "ok" },
      meta: { requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) },
      error: null
    });
    expect(response.headers["x-request-id"]).toEqual(
      (response.body as { meta: { requestId: string } }).meta.requestId
    );
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-security-policy"]).toBeDefined();
    await expect(call(app, { path: "/health/live" })).resolves.toMatchObject({
      status: 404
    });
  });

  it("runs authentication and ValidationPipe failures through the shared exception envelope", async () => {
    const missingAuth = await call(app, {
      method: "POST",
      path: "/api/v1/bookings",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    expect(missingAuth).toMatchObject({
      status: 401,
      body: { data: null, error: { code: "UNAUTHORIZED" } }
    });

    const validation = await call(app, {
      path: "/api/v1/listings?limit=101"
    });
    expect(validation).toMatchObject({
      status: 400,
      body: { data: null, error: { code: "VALIDATION_ERROR" } }
    });
  });

  it("allows only configured credentialed CORS origins", async () => {
    const allowed = await call(app, {
      path: "/api/v1/health/live",
      headers: { origin: "https://allowed.example" }
    });
    expect(allowed.headers["access-control-allow-origin"]).toBe(
      "https://allowed.example"
    );
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");

    const denied = await call(app, {
      path: "/api/v1/health/live",
      headers: { origin: "https://denied.example" }
    });
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("preserves exact raw webhook bytes while keeping the webhook public", async () => {
    const payload = '{"id":"evt_raw","nested":{"space":"preserved"}}\n';
    const response = await call(app, {
      method: "POST",
      path: "/api/v1/webhooks/stripe",
      headers: {
        "content-type": "application/json",
        "stripe-signature": "mock-signature"
      },
      body: payload
    });

    expect(response).toMatchObject({
      status: 201,
      body: { data: { received: true }, error: null }
    });
    expect(rawStripeBodies.at(-1)?.equals(Buffer.from(payload))).toBe(true);
  });

  it("returns stable envelopes for malformed and oversized JSON", async () => {
    const malformed = await call(app, {
      method: "POST",
      path: "/api/v1/webhooks/stripe",
      headers: { "content-type": "application/json" },
      body: '{"broken":'
    });
    expect(malformed).toMatchObject({
      status: 400,
      body: { data: null, error: { code: "VALIDATION_ERROR" } }
    });

    const oversized = await call(app, {
      method: "POST",
      path: "/api/v1/auth/sync",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({ padding: "x".repeat(129 * 1024) })
    });
    expect(oversized).toMatchObject({
      status: 413,
      body: { data: null, error: { code: "PAYLOAD_TOO_LARGE" } }
    });
  });

  it("returns the stable distributed rate-limit contract through the real guard", async () => {
    limitedPolicy = "public_search";
    try {
      const response = await call(app, { path: "/api/v1/listings" });
      expect(response).toMatchObject({
        status: 429,
        headers: { "retry-after": "7" },
        body: {
          data: null,
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            details: { retryAfterSeconds: 7 }
          }
        }
      });
    } finally {
      limitedPolicy = undefined;
    }
  });

  it.each([
    [undefined, 401, "UNAUTHORIZED"],
    ["Bearer unrelated-host", 404, "NOT_FOUND"],
    ["Bearer disabled", 403, "ACCOUNT_DISABLED"],
    ["Bearer renter", 200, null],
    ["Bearer host-owner", 200, null],
    ["Bearer participant", 200, null],
    ["Bearer admin", 200, null],
    ["Bearer unverified", 200, null]
  ])(
    "enforces the private booking read matrix for %s",
    async (authorization, status, errorCode) => {
      const response = await call(app, {
        path: "/api/v1/bookings/11111111-1111-4111-8111-111111111111",
        headers: authorization ? { authorization } : undefined
      });
      expect(response.status).toBe(status);
      expect((response.body as { error?: { code?: string } | null }).error?.code ?? null)
        .toBe(errorCode);
    }
  );

  it.each([
    ["Bearer renter", 201, null],
    ["Bearer host-owner", 403, "FORBIDDEN"],
    ["Bearer unrelated-host", 403, "FORBIDDEN"],
    ["Bearer unverified", 403, "EMAIL_NOT_VERIFIED"]
  ])(
    "enforces the booking-create role/email matrix for %s",
    async (authorization, status, errorCode) => {
      const response = await call(app, {
        method: "POST",
        path: "/api/v1/bookings",
        headers: { authorization, "content-type": "application/json" },
        body: JSON.stringify({
          listingId: "11111111-1111-4111-8111-111111111111",
          startDate: "2026-08-01",
          endDate: "2026-08-02",
          selectedOption: "one night"
        })
      });
      expect(response.status).toBe(status);
      expect((response.body as { error?: { code?: string } | null }).error?.code ?? null)
        .toBe(errorCode);
    }
  );

  it("uses intentional FORBIDDEN rather than private-resource NOT_FOUND for the Admin surface", async () => {
    await expect(
      call(app, {
        path: "/api/v1/admin/operations/status",
        headers: { authorization: "Bearer renter" }
      })
    ).resolves.toMatchObject({
      status: 403,
      body: { error: { code: "FORBIDDEN" } }
    });
    await expect(
      call(app, {
        path: "/api/v1/admin/operations/status",
        headers: { authorization: "Bearer admin" }
      })
    ).resolves.toMatchObject({ status: 200, body: { error: null } });
  });
});
