import { validateEnv } from "../src/config/env.validation";

const baseEnv = {
  DATABASE_URL: "postgresql://user:password@localhost:5432/medicn",
  ALLOWED_ORIGINS: "https://app.medicn.example",
  RATE_LIMITING_ENABLED: "true",
  REDIS_URL: "rediss://redis.example.com:6379"
};

describe("production HTTP boundary environment validation", () => {
  it("requires explicit safe production origins and distributed rate limiting", () => {
    const incomplete = { DATABASE_URL: baseEnv.DATABASE_URL };

    expect(() =>
      validateEnv({ ...incomplete, NODE_ENV: "production" })
    ).toThrow("ALLOWED_ORIGINS");
    expect(() =>
      validateEnv({
        ...incomplete,
        NODE_ENV: "production",
        ALLOWED_ORIGINS: "https://app.medicn.example"
      })
    ).toThrow("RATE_LIMITING_ENABLED");
  });

  it("rejects wildcard, credential-bearing, path-bearing, and insecure production origins", () => {
    for (const ALLOWED_ORIGINS of [
      "*",
      "https://user:password@app.medicn.example",
      "https://app.medicn.example/path",
      "http://app.medicn.example"
    ]) {
      expect(() =>
        validateEnv({
          ...baseEnv,
          NODE_ENV: "production",
          ALLOWED_ORIGINS
        })
      ).toThrow("ALLOWED_ORIGINS");
    }
  });

  it("bounds proxy trust and protects explicitly enabled production OpenAPI", () => {
    expect(() => validateEnv({ ...baseEnv, TRUST_PROXY_HOPS: "6" }))
      .toThrow("TRUST_PROXY_HOPS");
    expect(() =>
      validateEnv({
        ...baseEnv,
        NODE_ENV: "production",
        OPENAPI_ENABLED: "true"
      })
    ).toThrow("OPENAPI_BEARER_TOKEN");
    expect(
      validateEnv({
        ...baseEnv,
        NODE_ENV: "production",
        OPENAPI_ENABLED: "true",
        OPENAPI_BEARER_TOKEN: "d".repeat(48),
        TRUST_PROXY_HOPS: "1"
      })
    ).toMatchObject({ OPENAPI_ENABLED: true, TRUST_PROXY_HOPS: 1 });
  });
});

describe("payment environment validation", () => {
  it("allows missing Stripe credentials in development until payment use", () => {
    expect(
      validateEnv({
        ...baseEnv,
        NODE_ENV: "development",
        PAYMENTS_ENABLED: "false"
      })
    ).toMatchObject({
      PAYMENTS_ENABLED: false,
      CHECKOUT_SESSION_TTL_MINUTES: 30
    });
  });

  it("rejects an unsafe Checkout Session TTL", () => {
    expect(() =>
      validateEnv({
        ...baseEnv,
        CHECKOUT_SESSION_TTL_MINUTES: "29"
      })
    ).toThrow("CHECKOUT_SESSION_TTL_MINUTES");
  });

  it("requires complete Stripe configuration when production payments are enabled", () => {
    expect(() =>
      validateEnv({
        ...baseEnv,
        NODE_ENV: "production",
        PAYMENTS_ENABLED: "true"
      })
    ).toThrow("STRIPE_SECRET_KEY");

    expect(
      validateEnv({
        ...baseEnv,
        NODE_ENV: "production",
        PAYMENTS_ENABLED: "true",
        NEXT_PUBLIC_APP_URL: "https://medicn.example.com",
        PAYMENTS_OPERATIONS_EMAIL: "payments@medicn.example.com",
        STRIPE_SECRET_KEY: "configured-secret",
        STRIPE_WEBHOOK_SECRET: "configured-webhook-secret"
      })
    ).toMatchObject({ PAYMENTS_ENABLED: true });
  });

  it("requires an explicit production Connect fee and delay", () => {
    expect(() =>
      validateEnv({
        ...baseEnv,
        NODE_ENV: "production",
        STRIPE_CONNECT_ENABLED: "true"
      })
    ).toThrow("PLATFORM_FEE_BPS");

    expect(
      validateEnv({
        ...baseEnv,
        NODE_ENV: "production",
        STRIPE_CONNECT_ENABLED: "true",
        STRIPE_SECRET_KEY: "configured-secret",
        NEXT_PUBLIC_APP_URL: "https://medicn.example.com",
        PLATFORM_FEE_BPS: "1250",
        HOST_TRANSFER_DELAY_HOURS: "24"
      })
    ).toMatchObject({
      STRIPE_CONNECT_ENABLED: true,
      PLATFORM_FEE_BPS: 1250,
      HOST_TRANSFER_DELAY_HOURS: 24
    });
  });
});

describe("Veriff environment validation", () => {
  it("defaults disabled and permits missing credentials outside production", () => {
    expect(validateEnv(baseEnv)).toMatchObject({ VERIFF_ENABLED: false });
  });

  it("requires the complete configuration when enabled in production", () => {
    expect(() =>
      validateEnv({
        ...baseEnv,
        NODE_ENV: "production",
        VERIFF_ENABLED: "true"
      })
    ).toThrow("VERIFF_API_BASE_URL");

    expect(
      validateEnv({
        ...baseEnv,
        NODE_ENV: "production",
        VERIFF_ENABLED: "true",
        VERIFF_API_BASE_URL: "https://stationapi.veriff.com",
        VERIFF_API_KEY: "api-key",
        VERIFF_SHARED_SECRET: "shared-secret",
        VERIFF_CALLBACK_URL: "https://api.medicn.example.com/identity/callback"
      })
    ).toMatchObject({ VERIFF_ENABLED: true });
  });

  it("requires HTTPS provider and callback URLs in production", () => {
    expect(() =>
      validateEnv({
        ...baseEnv,
        NODE_ENV: "production",
        VERIFF_ENABLED: "true",
        VERIFF_API_BASE_URL: "https://stationapi.veriff.com",
        VERIFF_API_KEY: "api-key",
        VERIFF_SHARED_SECRET: "shared-secret",
        VERIFF_CALLBACK_URL: "http://api.medicn.example.com/identity/callback"
      })
    ).toThrow("VERIFF_CALLBACK_URL");
  });
});

describe("media processing environment validation", () => {
  it("defaults to disabled with bounded processing limits", () => {
    expect(validateEnv(baseEnv)).toMatchObject({
      MEDIA_PROCESSING_ENABLED: false,
      MEDIA_MAX_INPUT_BYTES: 5_242_880,
      MEDIA_MAX_INPUT_PIXELS: 40_000_000,
      MEDIA_MAX_DIMENSION: 12_000,
      MEDIA_PROCESSING_CONCURRENCY: 2,
      MEDIA_INGEST_RETENTION_HOURS: 24,
      SUPABASE_MEDIA_INGEST_BUCKET: "media-ingest",
      SUPABASE_LISTING_MEDIA_BUCKET: "listing-photos",
      SUPABASE_PROFILE_MEDIA_BUCKET: "profile-photos"
    });
  });

  it("rejects unsafe limits", () => {
    expect(() => validateEnv({ ...baseEnv, MEDIA_MAX_INPUT_BYTES: "0" }))
      .toThrow("MEDIA_MAX_INPUT_BYTES");
    expect(() => validateEnv({ ...baseEnv, MEDIA_PROCESSING_CONCURRENCY: "0" }))
      .toThrow("MEDIA_PROCESSING_CONCURRENCY");
  });

  it("requires credentials and distinct ingest storage in production", () => {
    expect(() =>
      validateEnv({
        ...baseEnv,
        NODE_ENV: "production",
        MEDIA_PROCESSING_ENABLED: "true",
        SUPABASE_MEDIA_INGEST_BUCKET: "listing-photos",
        SUPABASE_LISTING_MEDIA_BUCKET: "listing-photos"
      })
    ).toThrow("SUPABASE_MEDIA_INGEST_BUCKET");

    expect(
      validateEnv({
        ...baseEnv,
        NODE_ENV: "production",
        MEDIA_PROCESSING_ENABLED: "true",
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_SECRET_KEY: "service-key",
        REDIS_URL: "rediss://redis.example.com:6379"
      })
    ).toMatchObject({ MEDIA_PROCESSING_ENABLED: true });
  });
});

describe("Maps environment validation", () => {
  it("defaults disabled with bounded cost and cache controls", () => {
    expect(validateEnv(baseEnv)).toMatchObject({
      MAPS_ENABLED: false,
      MAPS_PROVIDER_TIMEOUT_MS: 5000,
      MAPS_NEARBY_RADIUS_METERS: 5000,
      MAPS_MAX_NEARBY_PER_CATEGORY: 5,
      MAPS_NEARBY_CACHE_TTL_HOURS: 720,
      MAPS_ROUTE_CACHE_TTL_HOURS: 168,
      MAPS_WORKER_CONCURRENCY: 2,
      MAPS_PUBLIC_DISTANCE_ROUNDING_METERS: 100
    });
  });

  it("rejects unsafe Maps ranges", () => {
    expect(() => validateEnv({ ...baseEnv, MAPS_PROVIDER_TIMEOUT_MS: "0" }))
      .toThrow("MAPS_PROVIDER_TIMEOUT_MS");
    expect(() => validateEnv({ ...baseEnv, MAPS_NEARBY_CACHE_TTL_HOURS: "721" }))
      .toThrow("MAPS_NEARBY_CACHE_TTL_HOURS");
    expect(() => validateEnv({ ...baseEnv, MAPS_MAX_NEARBY_PER_CATEGORY: "51" }))
      .toThrow("MAPS_MAX_NEARBY_PER_CATEGORY");
  });

  it("requires a server key, privacy secret and Redis when enabled in production", () => {
    expect(() => validateEnv({
      ...baseEnv,
      NODE_ENV: "production",
      MAPS_ENABLED: "true"
    })).toThrow("GOOGLE_MAPS_SERVER_API_KEY");

    expect(validateEnv({
      ...baseEnv,
      NODE_ENV: "production",
      MAPS_ENABLED: "true",
      GOOGLE_MAPS_SERVER_API_KEY: "server-key",
      MAPS_LOCATION_PRIVACY_SECRET: "a-long-private-location-secret-at-least-32",
      REDIS_URL: "rediss://redis.example.com:6379"
    })).toMatchObject({ MAPS_ENABLED: true });
  });
});

describe("transactional delivery environment validation", () => {
  it("defaults to a disabled local provider with bounded worker settings", () => {
    expect(validateEnv(baseEnv)).toMatchObject({
      EMAIL_PROVIDER: "local",
      TRANSACTIONAL_EMAIL_ENABLED: false,
      EMAIL_PROVIDER_TIMEOUT_MS: 5000,
      REDIS_KEY_PREFIX: "medicn",
      REDIS_CONNECT_TIMEOUT_MS: 5000,
      REDIS_MAX_RETRY_DELAY_MS: 10000,
      MESSAGING_MAX_SOCKETS_PER_USER: 5,
      MESSAGING_MAX_SOCKET_CONNECTIONS: 10000,
      MESSAGING_PING_INTERVAL_MS: 25000,
      MESSAGING_PING_TIMEOUT_MS: 20000,
      OUTBOX_CLAIM_LEASE_MS: 30000
    });
  });

  it("requires explicit complete Brevo configuration when enabled in production", () => {
    expect(() => validateEnv({
      ...baseEnv,
      NODE_ENV: "production",
      TRANSACTIONAL_EMAIL_ENABLED: "true"
    })).toThrow("EMAIL_PROVIDER");

    expect(validateEnv({
      ...baseEnv,
      NODE_ENV: "production",
      TRANSACTIONAL_EMAIL_ENABLED: "true",
      EMAIL_PROVIDER: "brevo",
      BREVO_API_KEY: "configured",
      BREVO_WEBHOOK_BEARER_TOKEN: "w".repeat(48),
      TRANSACTIONAL_EMAIL_FROM: "MediCN <noreply@example.com>",
      REDIS_URL: "rediss://queue-user:queue-password@redis.example:6380/2"
    })).toMatchObject({ EMAIL_PROVIDER: "brevo", TRANSACTIONAL_EMAIL_ENABLED: true });
  });

  it("requires a strong token when protected metrics are enabled", () => {
    expect(() => validateEnv({ ...baseEnv, OPERATIONS_METRICS_ENABLED: "true" }))
      .toThrow("OPERATIONS_METRICS_TOKEN");
  });
});
