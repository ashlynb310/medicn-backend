import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaService } from "../src/prisma/prisma.service";
import {
  buildOpenApiDocument,
  stableOpenApiJson
} from "../src/openapi/openapi-document";

describe("deterministic OpenAPI contract", () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.DATABASE_URL ??=
      "postgresql://medicn:medicn_dev_password@localhost:5432/medicn_dev";
    process.env.NODE_ENV = "test";
    const { AppModule } = await import("../src/app.module");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    app.setGlobalPrefix("api/v1");
  });

  afterAll(async () => {
    await app.close();
  });

  it("inventories every REST operation and excludes Socket.IO", () => {
    const document = buildOpenApiDocument(app);
    const operations = Object.values(document.paths).flatMap((path) =>
      Object.entries(path ?? {}).filter(([method]) =>
        ["get", "post", "patch", "delete", "put"].includes(method)
      )
    );

    expect(operations).toHaveLength(77);
    expect(document.paths).toHaveProperty("/api/v1/listings");
    expect(document.paths).toHaveProperty("/api/v1/webhooks/stripe");
    expect(document.paths).not.toHaveProperty("/messaging");
  });

  it("documents bearer auth, standard envelopes, errors, and raw webhooks", () => {
    const document = buildOpenApiDocument(app);
    expect(document.components?.securitySchemes).toHaveProperty("bearerAuth");
    expect(document.components?.schemas).toMatchObject({
      ApiSuccessEnvelope: expect.any(Object),
      ApiErrorEnvelope: expect.any(Object),
      PaginationMeta: expect.any(Object)
    });
    expect(document.paths["/api/v1/bookings"]?.get?.security).toEqual([
      { bearerAuth: [] }
    ]);
    expect(document.paths["/api/v1/health/live"]?.get?.security).toEqual([]);
    expect(
      document.paths["/api/v1/webhooks/stripe"]?.post?.description
    ).toContain("raw");
    expect(
      document.paths["/api/v1/listings"]?.get?.responses?.["429"]
    ).toBeDefined();
  });

  it("documents the complete protected Checkout Session return contract", () => {
    const document = buildOpenApiDocument(app);
    const checkout = document.paths["/api/v1/payments/checkout-session"]?.post;
    const response = checkout?.responses?.["201"] as {
      content?: Record<string, { schema?: unknown }>;
    };

    expect(checkout?.security).toEqual([{ bearerAuth: [] }]);
    expect(document.components?.schemas?.CheckoutSessionDto).toMatchObject({
      required: ["checkoutSessionId", "checkoutUrl", "expiresAt"],
      properties: {
        checkoutSessionId: { type: "string" },
        checkoutUrl: { type: "string" },
        expiresAt: { type: "string", format: "date-time" }
      }
    });
    expect(response.content?.["application/json"]?.schema).toMatchObject({
      required: ["data", "meta", "error"],
      properties: {
        data: { $ref: "#/components/schemas/CheckoutSessionDto" },
        meta: { type: "object" },
        error: { type: "null" }
      }
    });
  });

  it("serializes identical documents deterministically", () => {
    expect(stableOpenApiJson(buildOpenApiDocument(app))).toBe(
      stableOpenApiJson(buildOpenApiDocument(app))
    );
  });
});
