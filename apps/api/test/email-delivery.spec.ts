import type { ConfigService } from "@nestjs/config";
import {
  BrevoEmailAdapter,
  EmailService,
  LocalEmailAdapter,
  createEmailAdapter
} from "../src/email/email.service";
import type { JobsService } from "../src/jobs/jobs.service";
import type { PrismaService } from "../src/prisma/prisma.service";

const payload = {
  to: "renter@example.com",
  template: "booking_accepted_renter" as const,
  subject: "Accepted",
  text: "Your booking was accepted."
};

describe("transactional email provider adapter", () => {
  it("returns Brevo's provider message ID and accepted timestamp", async () => {
    const client = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: jest.fn().mockResolvedValue({ messageId: "<brevo-123@example>" })
    });
    const adapter = new BrevoEmailAdapter(
      client,
      "secret",
      "MediCN <noreply@example.com>",
      2_000
    );

    await expect(adapter.send(payload)).resolves.toMatchObject({
      provider: "brevo",
      messageId: "brevo-123@example",
      acceptedAt: expect.any(Date)
    });
    expect(client.mock.calls[0]?.[1]).toMatchObject({ signal: expect.any(Object) });
  });

  it.each([
    [429, true, "brevo_rate_limited"],
    [503, true, "brevo_unavailable"],
    [401, false, "brevo_authentication_failed"],
    [400, false, "brevo_request_invalid"]
  ])("classifies Brevo HTTP %s without response details", async (status, retryable, category) => {
    const adapter = new BrevoEmailAdapter(
      jest.fn().mockResolvedValue({ ok: false, status }),
      "secret",
      "noreply@example.com",
      2_000
    );

    await expect(adapter.send(payload)).rejects.toMatchObject({
      category,
      retryable
    });
  });

  it("rejects a successful response without a provider message ID", async () => {
    const adapter = new BrevoEmailAdapter(
      jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: jest.fn().mockResolvedValue({})
      }),
      "secret",
      "noreply@example.com",
      2_000
    );

    await expect(adapter.send(payload)).rejects.toMatchObject({
      category: "brevo_response_invalid",
      retryable: true
    });
  });

  it("uses local only when EMAIL_PROVIDER explicitly selects local", () => {
    const config = {
      get: jest.fn((key: string) => ({
        EMAIL_PROVIDER: "local",
        BREVO_API_KEY: "configured-but-not-selected",
        TRANSACTIONAL_EMAIL_FROM: "noreply@example.com"
      })[key])
    } as unknown as ConfigService;

    expect(createEmailAdapter(config)).toBeInstanceOf(LocalEmailAdapter);
  });

  it("aborts a provider request after the configured timeout", async () => {
    const client = jest.fn((_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))))
    );
    const adapter = new BrevoEmailAdapter(client as any, "secret", "noreply@example.com", 1);

    await expect(adapter.send(payload)).rejects.toMatchObject({
      category: "brevo_timeout",
      retryable: true
    });
  });

  it("persists local sends only as simulated delivery outcomes", async () => {
    const delivery: any = { id: "delivery-1", attempts: 0 };
    const prisma = {
      emailDelivery: {
        upsert: jest.fn().mockResolvedValue(delivery),
        update: jest.fn(async ({ data }: any) => {
          Object.assign(delivery, data, { attempts: delivery.attempts + (data.attempts?.increment ?? 0) });
          return delivery;
        })
      },
      recipientSuppression: { findFirst: jest.fn().mockResolvedValue(null) }
    } as unknown as PrismaService;
    const config = {
      get: jest.fn((key: string) => key === "EMAIL_PROVIDER" ? "local" : undefined)
    } as unknown as ConfigService;
    const service = new EmailService({} as JobsService, config, prisma);

    const result = await service.sendNow(payload, { outboxEventId: "outbox-1" });

    expect(result).toMatchObject({ provider: "local", simulated: true });
    expect(delivery).toMatchObject({ status: "simulated", attempts: 1 });
    expect(delivery.status).not.toBe("delivered");
  });
});
