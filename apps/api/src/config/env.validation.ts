import { z } from "zod";

const emptyStringToUndefined = (value: unknown) =>
  value === "" ? undefined : value;

const optionalString = z.preprocess(emptyStringToUndefined, z.string().optional());
const optionalUrl = z.preprocess(emptyStringToUndefined, z.string().url().optional());
const optionalEmail = z.preprocess(
  emptyStringToUndefined,
  z.string().email().optional()
);
const booleanFromEnvironment = z.preprocess(
  (value) => {
    if (value === "true") return true;
    if (value === "false" || value === "") return false;
    return value;
  },
  z.boolean().default(false)
);
const optionalNonNegativeInteger = z.preprocess(
  emptyStringToUndefined,
  z.coerce.number().int().nonnegative().optional()
);
const positiveIntegerWithDefault = (defaultValue: number, maximum: number) =>
  z.preprocess(
    (value) => (value === "" || value === undefined ? defaultValue : value),
    z.coerce.number().int().positive().max(maximum)
  );
const bucketNameWithDefault = (defaultValue: string) =>
  z.preprocess(
    (value) => (value === "" || value === undefined ? defaultValue : value),
    z.string().min(1).max(100).regex(/^[a-z0-9][a-z0-9._-]*$/)
  );

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().positive().default(4000),
    NEXT_PUBLIC_APP_URL: optionalUrl,
    DATABASE_URL: z.string().url(),
    ALLOWED_ORIGINS: z.preprocess(
      emptyStringToUndefined,
      z.string().optional()
    ),
    TRUST_PROXY_HOPS: z.preprocess(
      (value) => (value === "" || value === undefined ? 0 : value),
      z.coerce.number().int().min(0).max(5)
    ),
    RATE_LIMITING_ENABLED: booleanFromEnvironment,
    OPENAPI_ENABLED: booleanFromEnvironment,
    OPENAPI_BEARER_TOKEN: z.preprocess(
      emptyStringToUndefined,
      z.string().min(32).optional()
    ),
    NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: optionalString,
    SUPABASE_SECRET_KEY: optionalString,
    SUPABASE_STORAGE_BUCKET: z.preprocess(
      (value) =>
        value === "" || value === undefined ? "listing-photos" : value,
      z.string().min(1)
    ),
    MEDIA_PROCESSING_ENABLED: booleanFromEnvironment,
    MEDIA_MAX_INPUT_BYTES: positiveIntegerWithDefault(5_242_880, 20_971_520),
    MEDIA_MAX_INPUT_PIXELS: positiveIntegerWithDefault(40_000_000, 200_000_000),
    MEDIA_MAX_DIMENSION: positiveIntegerWithDefault(12_000, 30_000),
    MEDIA_PROCESSING_CONCURRENCY: positiveIntegerWithDefault(2, 16),
    MEDIA_INGEST_RETENTION_HOURS: positiveIntegerWithDefault(24, 720),
    SUPABASE_MEDIA_INGEST_BUCKET: bucketNameWithDefault("media-ingest"),
    SUPABASE_LISTING_MEDIA_BUCKET: bucketNameWithDefault("listing-photos"),
    SUPABASE_PROFILE_MEDIA_BUCKET: bucketNameWithDefault("profile-photos"),
    SUPABASE_HEALTHCARE_EVIDENCE_BUCKET: bucketNameWithDefault("healthcare-credentials"),
    HEALTHCARE_EVIDENCE_MAX_INPUT_BYTES: positiveIntegerWithDefault(10_485_760, 10_485_760),
    HEALTHCARE_EVIDENCE_VIEW_URL_TTL_SECONDS: positiveIntegerWithDefault(60, 60),
    HEALTHCARE_EVIDENCE_DELETION_MAX_ATTEMPTS: positiveIntegerWithDefault(5, 20),
    REDIS_URL: optionalString,
    REDIS_KEY_PREFIX: z.preprocess(
      (value) => (value === "" || value === undefined ? "medicn" : value),
      z.string().min(1).max(40).regex(/^[a-zA-Z0-9_-]+$/)
    ),
    REDIS_CONNECT_TIMEOUT_MS: positiveIntegerWithDefault(5000, 30_000),
    REDIS_MAX_RETRY_DELAY_MS: positiveIntegerWithDefault(10_000, 120_000),
    MESSAGING_MAX_SOCKETS_PER_USER: positiveIntegerWithDefault(5, 50),
    MESSAGING_MAX_SOCKET_CONNECTIONS: positiveIntegerWithDefault(10_000, 1_000_000),
    MESSAGING_PING_INTERVAL_MS: positiveIntegerWithDefault(25_000, 120_000),
    MESSAGING_PING_TIMEOUT_MS: positiveIntegerWithDefault(20_000, 120_000),
    OUTBOX_POLL_INTERVAL_MS: z.preprocess(
      (value) => (value === "" || value === undefined ? 5000 : value),
      z.coerce.number().int().positive()
    ),
    OUTBOX_CLAIM_LEASE_MS: positiveIntegerWithDefault(30_000, 300_000),
    WORKER_HEARTBEAT_INTERVAL_MS: positiveIntegerWithDefault(15_000, 120_000),
    WORKER_HEARTBEAT_STALE_MS: positiveIntegerWithDefault(60_000, 600_000),
    OPERATIONS_SCHEDULER_ENABLED: booleanFromEnvironment,
    OPERATIONS_RECOVERY_INTERVAL_MS: positiveIntegerWithDefault(60_000, 86_400_000),
    OPERATIONS_MAINTENANCE_INTERVAL_MS: positiveIntegerWithDefault(300_000, 86_400_000),
    OPERATIONS_METRICS_ENABLED: booleanFromEnvironment,
    OPERATIONS_METRICS_TOKEN: z.preprocess(
      emptyStringToUndefined,
      z.string().min(32).optional()
    ),
    GOOGLE_MAPS_SERVER_API_KEY: optionalString,
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: optionalString,
    MAPS_ENABLED: booleanFromEnvironment,
    MAPS_LOCATION_PRIVACY_SECRET: z.preprocess(
      emptyStringToUndefined,
      z.string().min(32).optional()
    ),
    MAPS_PROVIDER_TIMEOUT_MS: z.preprocess(
      (value) => (value === "" || value === undefined ? 5000 : value),
      z.coerce.number().int().min(1000).max(30_000)
    ),
    MAPS_NEARBY_RADIUS_METERS: z.preprocess(
      (value) => (value === "" || value === undefined ? 5000 : value),
      z.coerce.number().int().min(100).max(50_000)
    ),
    MAPS_MAX_NEARBY_PER_CATEGORY: z.preprocess(
      (value) => (value === "" || value === undefined ? 5 : value),
      z.coerce.number().int().min(1).max(20)
    ),
    MAPS_NEARBY_CACHE_TTL_HOURS: positiveIntegerWithDefault(720, 720),
    MAPS_ROUTE_CACHE_TTL_HOURS: positiveIntegerWithDefault(168, 720),
    MAPS_WORKER_CONCURRENCY: positiveIntegerWithDefault(2, 16),
    MAPS_PUBLIC_DISTANCE_ROUNDING_METERS: z.preprocess(
      (value) => (value === "" || value === undefined ? 100 : value),
      z.coerce.number().int().min(10).max(1000)
    ),
    VERIFF_ENABLED: booleanFromEnvironment,
    VERIFF_API_BASE_URL: optionalUrl,
    VERIFF_API_KEY: optionalString,
    VERIFF_SHARED_SECRET: optionalString,
    VERIFF_CALLBACK_URL: optionalUrl,
    PAYMENTS_ENABLED: booleanFromEnvironment,
    STRIPE_CONNECT_ENABLED: booleanFromEnvironment,
    PLATFORM_FEE_BPS: z.preprocess(
      emptyStringToUndefined,
      z.coerce.number().int().min(0).max(9_999).optional()
    ),
    HOST_TRANSFER_DELAY_HOURS: optionalNonNegativeInteger,
    CHECKOUT_SESSION_TTL_MINUTES: z.preprocess(
      (value) => (value === "" || value === undefined ? 30 : value),
      z.coerce.number().int().min(30).max(1440)
    ),
    PAYMENTS_OPERATIONS_EMAIL: optionalEmail,
    STRIPE_SECRET_KEY: optionalString,
    STRIPE_WEBHOOK_SECRET: optionalString,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: optionalString,
    EMAIL_PROVIDER: z.enum(["local", "brevo"]).default("local"),
    TRANSACTIONAL_EMAIL_ENABLED: booleanFromEnvironment,
    TRANSACTIONAL_EMAIL_FROM: optionalString,
    BREVO_API_KEY: optionalString,
    BREVO_WEBHOOK_BEARER_TOKEN: z.preprocess(
      emptyStringToUndefined,
      z.string().min(32).optional()
    ),
    EMAIL_PROVIDER_TIMEOUT_MS: positiveIntegerWithDefault(5000, 30_000)
  })
  .superRefine((env, context) => {
    const configuredOrigins = env.ALLOWED_ORIGINS
      ?.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean) ?? [];
    if (env.NODE_ENV === "production" && configuredOrigins.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ALLOWED_ORIGINS"],
        message: "ALLOWED_ORIGINS is required in production."
      });
    }
    for (const origin of configuredOrigins) {
      let parsed: URL | undefined;
      try {
        parsed = new URL(origin);
      } catch {
        // The common issue below intentionally avoids echoing the unsafe value.
      }
      const isLoopbackHttp =
        parsed?.protocol === "http:" &&
        (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
      const safeProtocol =
        parsed?.protocol === "https:" ||
        (env.NODE_ENV !== "production" && isLoopbackHttp);
      if (
        origin === "*" ||
        !parsed ||
        !safeProtocol ||
        parsed.origin !== origin ||
        parsed.username !== "" ||
        parsed.password !== ""
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ALLOWED_ORIGINS"],
          message: "ALLOWED_ORIGINS must contain only explicit safe origins."
        });
        break;
      }
    }
    if (env.NODE_ENV === "production" && !env.RATE_LIMITING_ENABLED) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["RATE_LIMITING_ENABLED"],
        message: "RATE_LIMITING_ENABLED must be true in production."
      });
    }
    if (
      env.NODE_ENV === "production" &&
      env.RATE_LIMITING_ENABLED &&
      !env.REDIS_URL
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["REDIS_URL"],
        message: "REDIS_URL is required for production rate limiting."
      });
    }
    if (
      env.NODE_ENV === "production" &&
      env.OPENAPI_ENABLED &&
      !env.OPENAPI_BEARER_TOKEN
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["OPENAPI_BEARER_TOKEN"],
        message: "OPENAPI_BEARER_TOKEN is required for production OpenAPI."
      });
    }
    if (env.EMAIL_PROVIDER === "brevo") {
      for (const key of ["BREVO_API_KEY", "TRANSACTIONAL_EMAIL_FROM"] as const) {
        if (!env[key]) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when EMAIL_PROVIDER is brevo.`
          });
        }
      }
    }

    if (env.OPERATIONS_METRICS_ENABLED && !env.OPERATIONS_METRICS_TOKEN) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["OPERATIONS_METRICS_TOKEN"],
        message: "OPERATIONS_METRICS_TOKEN is required when metrics are enabled."
      });
    }

    if (env.NODE_ENV === "production" && env.TRANSACTIONAL_EMAIL_ENABLED) {
      if (env.EMAIL_PROVIDER !== "brevo") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["EMAIL_PROVIDER"],
          message: "EMAIL_PROVIDER must be brevo when transactional email is enabled in production."
        });
      }
      for (const key of [
        "BREVO_API_KEY",
        "BREVO_WEBHOOK_BEARER_TOKEN",
        "TRANSACTIONAL_EMAIL_FROM",
        "REDIS_URL"
      ] as const) {
        if (!env[key]) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when transactional email is enabled in production.`
          });
        }
      }
    }

    if (env.NODE_ENV === "production" && env.PAYMENTS_ENABLED) {
      for (const key of [
        "STRIPE_SECRET_KEY",
        "STRIPE_WEBHOOK_SECRET",
        "NEXT_PUBLIC_APP_URL",
        "PAYMENTS_OPERATIONS_EMAIL"
      ] as const) {
        if (!env[key]) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when payments are enabled in production.`
          });
        }
      }
    }

    if (env.NODE_ENV === "production" && env.STRIPE_CONNECT_ENABLED) {
      for (const key of [
        "STRIPE_SECRET_KEY",
        "NEXT_PUBLIC_APP_URL",
        "PLATFORM_FEE_BPS",
        "HOST_TRANSFER_DELAY_HOURS"
      ] as const) {
        if (env[key] === undefined) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when Stripe Connect is enabled in production.`
          });
        }
      }
    }

    if (env.NODE_ENV === "production" && env.VERIFF_ENABLED) {
      for (const key of [
        "VERIFF_API_BASE_URL",
        "VERIFF_API_KEY",
        "VERIFF_SHARED_SECRET",
        "VERIFF_CALLBACK_URL"
      ] as const) {
        if (!env[key]) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when Veriff is enabled in production.`
          });
        }
      }
      for (const key of [
        "VERIFF_API_BASE_URL",
        "VERIFF_CALLBACK_URL"
      ] as const) {
        if (env[key] && new URL(env[key]).protocol !== "https:") {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} must use HTTPS when Veriff is enabled in production.`
          });
        }
      }
    }

    if (env.NODE_ENV === "production" && env.MEDIA_PROCESSING_ENABLED) {
      for (const key of [
        "NEXT_PUBLIC_SUPABASE_URL",
        "SUPABASE_SECRET_KEY",
        "REDIS_URL"
      ] as const) {
        if (!env[key]) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when media processing is enabled in production.`
          });
        }
      }
      if (
        env.SUPABASE_MEDIA_INGEST_BUCKET === env.SUPABASE_LISTING_MEDIA_BUCKET ||
        env.SUPABASE_MEDIA_INGEST_BUCKET === env.SUPABASE_PROFILE_MEDIA_BUCKET
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["SUPABASE_MEDIA_INGEST_BUCKET"],
          message:
            "SUPABASE_MEDIA_INGEST_BUCKET must differ from public derivative buckets."
        });
      }
      if (
        env.SUPABASE_HEALTHCARE_EVIDENCE_BUCKET === env.SUPABASE_LISTING_MEDIA_BUCKET ||
        env.SUPABASE_HEALTHCARE_EVIDENCE_BUCKET === env.SUPABASE_PROFILE_MEDIA_BUCKET ||
        env.SUPABASE_HEALTHCARE_EVIDENCE_BUCKET === env.SUPABASE_MEDIA_INGEST_BUCKET
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["SUPABASE_HEALTHCARE_EVIDENCE_BUCKET"],
          message: "SUPABASE_HEALTHCARE_EVIDENCE_BUCKET must be a dedicated private bucket."
        });
      }
    }

    if (env.NODE_ENV === "production" && env.MAPS_ENABLED) {
      for (const key of [
        "GOOGLE_MAPS_SERVER_API_KEY",
        "MAPS_LOCATION_PRIVACY_SECRET",
        "REDIS_URL"
      ] as const) {
        if (!env[key]) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when Maps is enabled in production.`
          });
        }
      }
    }
  });

export function validateEnv(config: Record<string, unknown>) {
  const parsed = envSchema.safeParse(config);

  if (!parsed.success) {
    const details = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid environment configuration: ${JSON.stringify(details)}`);
  }

  return parsed.data;
}
