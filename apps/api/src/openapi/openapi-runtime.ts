import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SwaggerModule } from "@nestjs/swagger";
import type { NextFunction, Request, Response } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { buildOpenApiDocument } from "./openapi-document";

export function configureOpenApi(app: INestApplication) {
  const config = app.get(ConfigService);
  const production = config.get<string>("NODE_ENV") === "production";
  const enabled = config.get<boolean>("OPENAPI_ENABLED") ?? false;
  if (production && !enabled) return false;

  if (production) {
    const expected = config.get<string>("OPENAPI_BEARER_TOKEN");
    app.use(
      ["/api/v1/docs", "/api/v1/docs-json"],
      (request: Request, response: Response, next: NextFunction) => {
        if (matchesBearer(request.headers.authorization, expected)) {
          next();
          return;
        }
        response.status(401).json({
          data: null,
          meta: {},
          error: {
            code: "UNAUTHORIZED",
            message: "OpenAPI authorization failed.",
            details: {}
          }
        });
      }
    );
  }

  SwaggerModule.setup("docs", app, buildOpenApiDocument(app), {
    useGlobalPrefix: true,
    jsonDocumentUrl: "docs-json",
    swaggerOptions: { persistAuthorization: false }
  });
  return true;
}

function matchesBearer(authorization: string | undefined, expected: string | undefined) {
  const supplied = authorization?.match(/^Bearer ([^\s]+)$/)?.[1];
  if (!supplied || !expected) return false;
  const suppliedDigest = createHash("sha256").update(supplied).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(suppliedDigest, expectedDigest);
}
