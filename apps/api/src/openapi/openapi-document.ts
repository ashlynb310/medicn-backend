import type { INestApplication } from "@nestjs/common";
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject
} from "@nestjs/swagger";
import type {
  OperationObject,
  PathItemObject
} from "@nestjs/swagger/dist/interfaces/open-api-spec.interface";

const PUBLIC_OPERATIONS = new Set([
  "get:/api/v1/health",
  "get:/api/v1/health/live",
  "get:/api/v1/health/ready",
  "get:/api/v1/listings",
  "get:/api/v1/listings/{id}/calendar",
  "get:/api/v1/users/{id}",
  "post:/api/v1/webhooks/stripe",
  "post:/api/v1/webhooks/veriff/events",
  "post:/api/v1/webhooks/veriff/decisions",
  "post:/api/v1/webhooks/brevo/transactional"
]);

const OPTIONAL_BEARER_OPERATIONS = new Set(["get:/api/v1/listings/{id}"]);
const CUSTOM_BEARER_OPERATIONS = new Set(["get:/api/v1/metrics"]);
const RATE_LIMITED_OPERATIONS = new Set([
  "get:/api/v1/listings",
  "get:/api/v1/listings/{id}/calendar",
  "post:/api/v1/listings/{listingId}/inquiries",
  "post:/api/v1/inquiries/{id}/messages",
  "post:/api/v1/uploads/presigned-url",
  "post:/api/v1/healthcare-verifications/{id}/evidence/upload-intents",
  "post:/api/v1/identity/verifications/session",
  "post:/api/v1/payments/checkout-session",
  "post:/api/v1/bookings/{id}/cancel",
  "post:/api/v1/admin/operations/job-executions/{id}/requeue",
  "post:/api/v1/admin/operations/reconciliation/payments",
  "post:/api/v1/admin/operations/reconciliation/host-transfers"
]);

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const base = new DocumentBuilder()
    .setTitle("MediCN backend API")
    .setDescription(
      "Stable backend-only REST contracts. All ordinary JSON responses use the MediCN data/meta/error envelope. Socket.IO is documented separately."
    )
    .setVersion("5.9C")
    .addBearerAuth(
      { type: "http", scheme: "bearer", bearerFormat: "Supabase JWT" },
      "bearerAuth"
    )
    .addSecurity("metricsToken", {
      type: "http",
      scheme: "bearer",
      description: "Dedicated operations metrics token; not a Supabase token."
    })
    .build();
  const document = SwaggerModule.createDocument(app, base);
  document.components ??= {};
  document.components.schemas = {
    ...document.components.schemas,
    PaginationMeta: {
      type: "object",
      required: ["page", "limit", "total", "totalPages"],
      properties: {
        page: { type: "integer", minimum: 1 },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        total: { type: "integer", minimum: 0 },
        totalPages: { type: "integer", minimum: 0 }
      },
      additionalProperties: true
    },
    ApiError: {
      type: "object",
      required: ["code", "message", "details"],
      properties: {
        code: { type: "string", description: "Stable machine-readable code." },
        message: { type: "string" },
        details: { type: "object", additionalProperties: true }
      }
    },
    ApiSuccessEnvelope: {
      type: "object",
      required: ["data", "meta", "error"],
      properties: {
        data: { nullable: true },
        meta: { type: "object", additionalProperties: true },
        error: { type: "null" }
      }
    },
    ApiErrorEnvelope: {
      type: "object",
      required: ["data", "meta", "error"],
      properties: {
        data: { type: "null" },
        meta: { type: "object", additionalProperties: true },
        error: { $ref: "#/components/schemas/ApiError" }
      }
    }
  };

  for (const [path, pathItem] of Object.entries(document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = (pathItem as PathItemObject)[method];
      if (!operation) continue;
      hardenOperation(method, path, operation);
    }
  }
  return document;
}

function hardenOperation(method: string, path: string, operation: OperationObject) {
  const key = `${method}:${path}`;
  operation.tags ??= [path.split("/").filter(Boolean)[2] ?? "api"];
  if (PUBLIC_OPERATIONS.has(key)) operation.security = [];
  else if (OPTIONAL_BEARER_OPERATIONS.has(key)) {
    operation.security = [{}, { bearerAuth: [] }];
  } else if (CUSTOM_BEARER_OPERATIONS.has(key)) {
    operation.security = [{ metricsToken: [] }];
  } else {
    operation.security = [{ bearerAuth: [] }];
  }

  operation.responses ??= {};
  for (const status of ["400", "404", "413", "500"]) {
    operation.responses[status] ??= errorResponse(status);
  }
  if (!PUBLIC_OPERATIONS.has(key) && !CUSTOM_BEARER_OPERATIONS.has(key)) {
    operation.responses["401"] ??= errorResponse("401");
    operation.responses["403"] ??= errorResponse("403");
  }
  if (RATE_LIMITED_OPERATIONS.has(key)) {
    operation.responses["429"] ??= errorResponse("429");
    operation.responses["503"] ??= errorResponse("503");
  }

  if (path.startsWith("/api/v1/webhooks/")) {
    operation.description = `${operation.description ? `${operation.description} ` : ""}The provider credential/signature is checked against the exact raw request bytes before durable processing. Provider retries are deduplicated and this route is not subject to a naive client-IP rate limit.`;
    operation.requestBody ??= {
      required: true,
      content: {
        "application/json": {
          schema: { type: "object", additionalProperties: true }
        }
      }
    };
  }
}

function errorResponse(status: string) {
  return {
    description: `HTTP ${status} in the stable error envelope.`,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/ApiErrorEnvelope" }
      }
    }
  };
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortValue(nested)])
  );
}

export function stableOpenApiJson(document: OpenAPIObject) {
  return `${JSON.stringify(sortValue(document), null, 2)}\n`;
}
