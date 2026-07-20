import "reflect-metadata";
import { config as loadEnvironment } from "dotenv";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { performance } from "node:perf_hooks";
import { cpus } from "node:os";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { AuthService } from "../src/auth/auth.service";
import { configureHttpApplication } from "../src/common/http/configure-http-application";
import { PrismaService } from "../src/prisma/prisma.service";

loadEnvironment({ path: resolve(process.cwd(), "../../.env"), quiet: true });
process.env.NODE_ENV = "test";
process.env.RATE_LIMITING_ENABLED = "false";

const HOST_ID = "60000000-0000-4000-8000-000000000001";
const RENTER_ID = "60000000-0000-4000-8000-000000000002";
const LISTING_ID = "61000000-0000-4000-8000-000000000001";
const AVAILABILITY_ID = "62000000-0000-4000-8000-000000000001";
const BOOKING_ID = "63000000-0000-4000-8000-000000000001";
const INQUIRY_ID = "64000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "65000000-0000-4000-8000-000000000001";

interface Scenario {
  name: string;
  method?: string;
  path: string;
  token?: string;
  body?: unknown;
  requests: number;
  concurrency: number;
  p95LimitMs: number;
}

async function seed(prisma: PrismaService) {
  await cleanup(prisma);
  await prisma.$executeRawUnsafe(`
    INSERT INTO "User" ("id", "supabaseUserId", "email", "emailVerifiedAt", "roles", "profileComplete", "createdAt", "updatedAt")
    VALUES
      ('${HOST_ID}', 'phase59b-load-host', 'phase59b-load-host@example.invalid', now(), ARRAY['host']::"UserRole"[], true, now(), now()),
      ('${RENTER_ID}', 'phase59b-load-renter', 'phase59b-load-renter@example.invalid', now(), ARRAY['renter']::"UserRole"[], true, now(), now());

    INSERT INTO "Listing" (
      "id", "hostId", "title", "description", "city", "timeZone", "checkoutTime",
      "priceCents", "currency", "priceUnit", "listingType", "status", "createdAt", "updatedAt"
    ) VALUES (
      '${LISTING_ID}', '${HOST_ID}', 'Load smoke listing', 'Non-production local fixture',
      'Houston', 'America/Chicago', '11:00', 12000, 'USD', 'night'::"PriceUnit",
      'private_room'::"ListingType", 'approved'::"ListingStatus", now(), now()
    );

    INSERT INTO "ListingAvailability" ("id", "listingId", "startDate", "endDate", "status", "createdAt", "updatedAt")
    VALUES ('${AVAILABILITY_ID}', '${LISTING_ID}', DATE '2026-01-01', DATE '2027-12-31', 'available'::"AvailabilityStatus", now(), now());

    INSERT INTO "Booking" (
      "id", "listingId", "renterId", "hostId", "startDate", "endDate", "timeZone", "checkoutTime",
      "selectedOption", "status", "totalAmountCents", "currency", "createdAt", "updatedAt", "requestExpiresAt"
    ) VALUES (
      '${BOOKING_ID}', '${LISTING_ID}', '${RENTER_ID}', '${HOST_ID}', DATE '2026-10-01', DATE '2026-10-03',
      'America/Chicago', '11:00', 'two nights', 'requested'::"BookingStatus", 24000, 'USD', now(), now(), now() + interval '24 hours'
    );

    INSERT INTO "Inquiry" (
      "id", "listingId", "renterId", "hostId", "status", "lastSequence", "lastMessageAt", "createdAt", "updatedAt"
    ) VALUES (
      '${INQUIRY_ID}', '${LISTING_ID}', '${RENTER_ID}', '${HOST_ID}', 'open'::"InquiryStatus", 1, now(), now(), now()
    );

    INSERT INTO "InquiryParticipantState" ("id", "inquiryId", "userId", "role", "createdAt", "updatedAt")
    VALUES
      ('66000000-0000-4000-8000-000000000001', '${INQUIRY_ID}', '${RENTER_ID}', 'renter'::"UserRole", now(), now()),
      ('66000000-0000-4000-8000-000000000002', '${INQUIRY_ID}', '${HOST_ID}', 'host'::"UserRole", now(), now());

    INSERT INTO "Message" ("id", "inquiryId", "sequence", "senderId", "senderRole", "body", "createdAt")
    VALUES ('${MESSAGE_ID}', '${INQUIRY_ID}', 1, '${RENTER_ID}', 'renter'::"UserRole", 'local smoke fixture', now());
  `);
}

async function cleanup(prisma: PrismaService) {
  await prisma.$executeRawUnsafe(`
    DELETE FROM "Message" WHERE "id" = '${MESSAGE_ID}';
    DELETE FROM "InquiryParticipantState" WHERE "inquiryId" = '${INQUIRY_ID}';
    DELETE FROM "Inquiry" WHERE "id" = '${INQUIRY_ID}';
    DELETE FROM "Booking" WHERE "id" = '${BOOKING_ID}';
    DELETE FROM "ListingAvailability" WHERE "id" = '${AVAILABILITY_ID}';
    DELETE FROM "Listing" WHERE "id" = '${LISTING_ID}';
    DELETE FROM "User" WHERE "id" IN ('${HOST_ID}', '${RENTER_ID}');
  `);
}

async function executeScenario(baseUrl: string, scenario: Scenario) {
  const timings: number[] = [];
  let failures = 0;
  let next = 0;
  const worker = async () => {
    while (true) {
      const index = next++;
      if (index >= scenario.requests) return;
      const started = performance.now();
      const response = await fetch(`${baseUrl}${scenario.path}`, {
        method: scenario.method ?? "GET",
        headers: {
          ...(scenario.token
            ? { authorization: `Bearer ${scenario.token}` }
            : {}),
          ...(scenario.body ? { "content-type": "application/json" } : {})
        },
        body: scenario.body ? JSON.stringify(scenario.body) : undefined
      });
      timings.push(performance.now() - started);
      if (!response.ok) failures += 1;
      await response.arrayBuffer();
    }
  };
  await Promise.all(
    Array.from({ length: scenario.concurrency }, () => worker())
  );
  timings.sort((left, right) => left - right);
  const p95 = timings[Math.max(0, Math.ceil(timings.length * 0.95) - 1)] ?? 0;
  return {
    name: scenario.name,
    requests: scenario.requests,
    concurrency: scenario.concurrency,
    failures,
    p95Ms: Number(p95.toFixed(2)),
    thresholdMs: scenario.p95LimitMs,
    passed: failures === 0 && p95 <= scenario.p95LimitMs
  };
}

async function run() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const prisma = new PrismaService();
  await prisma.$connect();
  let app: INestApplication | undefined;
  try {
    await seed(prisma);
    const [host, renter] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: HOST_ID } }),
      prisma.user.findUniqueOrThrow({ where: { id: RENTER_ID } })
    ]);
    const auth = {
      extractBearerToken(authorization?: string) {
        const token = authorization?.match(/^Bearer ([^\s]+)$/)?.[1];
        if (!token) throw new Error("smoke bearer token missing");
        return token;
      },
      getCurrentUserRecord(token: string) {
        if (token === "load-renter") return Promise.resolve(renter);
        if (token === "load-host") return Promise.resolve(host);
        return Promise.reject(new Error("smoke token invalid"));
      },
      getAccessTokenExpiry() {
        return Math.floor(Date.now() / 1000) + 300;
      }
    };
    const { AppModule } = await import("../src/app.module");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuthService)
      .useValue(auth)
      .compile();
    app = moduleRef.createNestApplication({ bodyParser: false, rawBody: true });
    configureHttpApplication(app, { installWebSocketAdapter: false });
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const readRequests = Math.min(200, Math.max(10, Number(process.env.LOAD_SMOKE_REQUESTS ?? 30)));
    const concurrency = Math.min(20, Math.max(1, Number(process.env.LOAD_SMOKE_CONCURRENCY ?? 5)));
    const scenarios: Scenario[] = [
      { name: "public_listing_search", path: "/api/v1/listings?city=Houston&limit=20", requests: readRequests, concurrency, p95LimitMs: 750 },
      { name: "authenticated_booking_reads", path: "/api/v1/bookings?limit=20", token: "load-renter", requests: readRequests, concurrency, p95LimitMs: 750 },
      { name: "message_rest_catchup", path: `/api/v1/inquiries/${INQUIRY_ID}?afterSequence=0&limit=100`, token: "load-renter", requests: readRequests, concurrency, p95LimitMs: 750 },
      { name: "calendar_reads", path: `/api/v1/listings/${LISTING_ID}/calendar?startDate=2026-09-01&endDate=2026-11-01`, requests: readRequests, concurrency, p95LimitMs: 750 },
      { name: "health_live", path: "/api/v1/health/live", requests: readRequests, concurrency, p95LimitMs: 500 },
      { name: "health_ready", path: "/api/v1/health/ready", requests: 10, concurrency: 2, p95LimitMs: 1000 },
      { name: "bounded_read_cursor_mutations", method: "POST", path: `/api/v1/inquiries/${INQUIRY_ID}/read`, token: "load-renter", body: { sequence: 1 }, requests: 10, concurrency: 5, p95LimitMs: 1000 }
    ];
    const results = [];
    for (const scenario of scenarios) {
      results.push(await executeScenario(baseUrl, scenario));
    }
    const report = {
      environment: {
        scope: "local non-production HTTP+PostgreSQL smoke; not capacity evidence",
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        cpu: cpus()[0]?.model ?? "unknown",
        rateLimiting: "disabled for repeatable latency smoke; gated Redis behavior tested separately",
        providers: "no provider calls"
      },
      results
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (results.some((result) => !result.passed)) {
      throw new Error("One or more local HTTP smoke thresholds failed.");
    }
  } finally {
    await app?.close();
    await cleanup(prisma).catch(() => undefined);
    await prisma.$disconnect();
  }
}

void run().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "HTTP load smoke failed."}\n`
  );
  process.exitCode = 1;
});
