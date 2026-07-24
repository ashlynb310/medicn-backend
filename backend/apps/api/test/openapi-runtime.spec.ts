import type { INestApplication } from "@nestjs/common";
import { Controller, Get } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { configureOpenApi } from "../src/openapi/openapi-runtime";

@Controller("probe")
class ProbeController {
  @Get()
  get() {
    return { ok: true };
  }
}

async function get(app: INestApplication, authorization?: string) {
  const address = app.getHttpServer().address() as AddressInfo;
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port: address.port,
        path: "/api/v1/docs-json",
        headers: authorization ? { authorization } : undefined
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8")
          })
        );
      }
    );
    req.on("error", reject);
    req.end();
  });
}

describe("runtime OpenAPI exposure", () => {
  it("keeps production JSON disabled unless explicitly enabled", async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              ({ NODE_ENV: "production", OPENAPI_ENABLED: false })[key]
          }
        }
      ]
    }).compile();
    const app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    configureOpenApi(app);
    await app.listen(0, "127.0.0.1");
    try {
      await expect(get(app)).resolves.toMatchObject({ status: 404 });
    } finally {
      await app.close();
    }
  });

  it("requires the dedicated exact bearer token when production docs are enabled", async () => {
    const token = "openapi-token-with-at-least-thirty-two-characters";
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              ({
                NODE_ENV: "production",
                OPENAPI_ENABLED: true,
                OPENAPI_BEARER_TOKEN: token
              })[key]
          }
        }
      ]
    }).compile();
    const app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    configureOpenApi(app);
    await app.listen(0, "127.0.0.1");
    try {
      await expect(get(app)).resolves.toMatchObject({ status: 401 });
      const allowed = await get(app, `Bearer ${token}`);
      expect(allowed.status).toBe(200);
      expect(JSON.parse(allowed.body)).toMatchObject({
        info: { title: "MediCN backend API" }
      });
    } finally {
      await app.close();
    }
  });
});
