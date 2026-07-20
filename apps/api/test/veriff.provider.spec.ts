import { ServiceUnavailableException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { createHmac } from "node:crypto";
import { VeriffIdentityProvider } from "../src/identity/veriff.provider";

const values: Record<string, unknown> = {
  VERIFF_ENABLED: true,
  VERIFF_API_BASE_URL: "https://stationapi.veriff.com",
  VERIFF_API_KEY: "client-key",
  VERIFF_SHARED_SECRET: "shared-secret",
  VERIFF_CALLBACK_URL: "https://api.example.com/identity/callback"
};

function provider(overrides: Record<string, unknown> = {}) {
  const config = {
    get: jest.fn((key: string) => ({ ...values, ...overrides })[key])
  };
  return new VeriffIdentityProvider(config as unknown as ConfigService);
}

describe("VeriffIdentityProvider", () => {
  afterEach(() => jest.restoreAllMocks());

  it("creates a minimal session and never returns the session token", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "success",
        verification: {
          id: "session-1",
          url: "https://magic.veriff.me/session-1",
          status: "created",
          sessionToken: "must-not-leak"
        }
      })
    } as Response);

    await expect(
      provider().createSession({
        vendorData: "opaque-binding",
        endUserId: "opaque-binding",
        callbackUrl: "https://api.example.com/identity/callback"
      })
    ).resolves.toEqual({
      providerSessionId: "session-1",
      hostedUrl: "https://magic.veriff.me/session-1",
      providerStatus: "created",
      expiresAt: null
    });
    const body = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)
    );
    expect(body).toEqual({
      verification: {
        callback: "https://api.example.com/identity/callback",
        vendorData: "opaque-binding",
        endUserId: "opaque-binding"
      }
    });
  });

  it("fails safely when the provider is disabled", async () => {
    await expect(
      provider({ VERIFF_ENABLED: false }).createSession({
        vendorData: "opaque",
        endUserId: "opaque",
        callbackUrl: "https://api.example.com/callback"
      })
    ).rejects.toMatchObject({
      response: { code: "VERIFF_NOT_CONFIGURED" }
    });
  });

  it("verifies the exact raw-body HMAC and normalizes a decision allowlist", () => {
    const raw = Buffer.from(
      JSON.stringify({
        status: "success",
        verification: {
          id: "session-1",
          attemptId: "attempt-1",
          status: "approved",
          code: 9001,
          vendorData: "opaque",
          endUserId: "opaque",
          decisionTime: "2026-07-19T12:00:00.000Z",
          person: { firstName: "Sensitive", dateOfBirth: "1990-01-01" },
          document: { number: "Sensitive" }
        }
      })
    );
    const signature = createHmac("sha256", "shared-secret")
      .update(raw)
      .digest("hex");

    const normalized = provider().verifyAndNormalizeWebhook(
      "decision",
      raw,
      "client-key",
      signature
    );
    expect(normalized).toMatchObject({
      sessionId: "session-1",
      attemptId: "attempt-1",
      providerStatus: "approved",
      providerCode: "9001",
      normalizedStatus: "approved"
    });
    expect(JSON.stringify(normalized.payload)).not.toContain("Sensitive");
    expect(normalized.payload).not.toHaveProperty("document");
  });

  it.each([
    ["wrong client", "wrong", undefined],
    ["missing HMAC", "client-key", undefined],
    ["invalid HMAC", "client-key", "00"]
  ])("rejects %s", (_label, client, signature) => {
    expect(() =>
      provider().verifyAndNormalizeWebhook(
        "event",
        Buffer.from('{"id":"session-1","action":"submitted"}'),
        client,
        signature
      )
    ).toThrow();
  });

  it("maps submitted events but never treats browser flow completion as approval", () => {
    const raw = Buffer.from(
      JSON.stringify({
        id: "session-1",
        attemptId: "attempt-1",
        code: 7009,
        action: "flow_finished",
        vendorData: "opaque"
      })
    );
    const signature = createHmac("sha256", "shared-secret").update(raw).digest("hex");
    expect(
      provider().verifyAndNormalizeWebhook("event", raw, "client-key", signature)
        .normalizedStatus
    ).toBeNull();
  });

  it("maps transport failures to a stable provider-unavailable error", async () => {
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("network"));
    await expect(
      provider().createSession({
        vendorData: "opaque",
        endUserId: "opaque",
        callbackUrl: "https://api.example.com/callback"
      })
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
