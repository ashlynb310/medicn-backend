import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { json, urlencoded, type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import * as classTransformer from "class-transformer";
import * as classValidator from "class-validator";
import { ApiExceptionFilter } from "../api-exception.filter";
import { ApiResponseInterceptor } from "../api-response.interceptor";
import { MessagingSocketAdapter } from "../../messaging/messaging-socket.adapter";
import { configureOpenApi } from "../../openapi/openapi-runtime";

export const API_JSON_BODY_LIMIT = 128 * 1024;
export const WEBHOOK_JSON_BODY_LIMIT = 512 * 1024;

export interface ConfigureHttpApplicationOptions {
  installWebSocketAdapter?: boolean;
}

type RawBodyRequest = Request & {
  rawBody?: Buffer;
  medicnRequestId?: string;
};

function preserveRawBody(request: Request, _response: Response, body: Buffer) {
  (request as RawBodyRequest).rawBody = Buffer.from(body);
}

function configuredOrigins(config: ConfigService) {
  return (config.get<string>("ALLOWED_ORIGINS") ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function configureHttpApplication(
  app: INestApplication,
  options: ConfigureHttpApplicationOptions = {}
) {
  const config = app.get(ConfigService);
  const allowedOrigins = new Set(configuredOrigins(config));
  const expressApplication = app.getHttpAdapter().getInstance() as {
    set(name: string, value: unknown): void;
  };

  expressApplication.set(
    "trust proxy",
    config.get<number>("TRUST_PROXY_HOPS") ?? 0
  );
  app.use((request: RawBodyRequest, response: Response, next: NextFunction) => {
    const requestId = randomUUID();
    request.medicnRequestId = requestId;
    response.setHeader("x-request-id", requestId);
    next();
  });
  app.use(helmet());
  app.enableCors({
    origin(
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void
    ) {
      callback(null, !origin || allowedOrigins.has(origin));
    },
    credentials: true
  });
  app.use(
    "/api/v1/webhooks",
    json({ limit: WEBHOOK_JSON_BODY_LIMIT, verify: preserveRawBody })
  );
  app.use(json({ limit: API_JSON_BODY_LIMIT, verify: preserveRawBody }));
  app.use(urlencoded({ extended: false, limit: API_JSON_BODY_LIMIT }));
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      validatorPackage: classValidator,
      transformerPackage: classTransformer
    })
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ApiResponseInterceptor());
  app.enableShutdownHooks(["SIGINT", "SIGTERM"]);
  configureOpenApi(app);

  if (options.installWebSocketAdapter === false) return undefined;

  const socketAdapter = new MessagingSocketAdapter(app, config);
  app.useWebSocketAdapter(socketAdapter);
  return socketAdapter;
}
