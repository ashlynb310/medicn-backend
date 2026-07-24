import { UnauthorizedException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { EmailDeliveryStatus, EmailProvider, EmailWebhookProcessingStatus } from "@prisma/client";
import {
  assertBrevoWebhookAuthorization,
  EmailWebhookService,
  normalizeBrevoEvent
} from "../src/email/email-webhook.service";
import type { PrismaService } from "../src/prisma/prisma.service";

function createWebhookPrisma(deliveryOverrides: Record<string, unknown> = {}) {
  const inbox: any[] = [];
  const suppressions: any[] = [];
  const delivery: any = {
    id: "delivery-1",
    providerMessageId: "provider-message-1",
    provider: EmailProvider.brevo,
    recipientHash: "trusted-recipient-hash",
    status: EmailDeliveryStatus.accepted,
    lastEventAt: null,
    lastEventPrecedence: 0,
    ...deliveryOverrides
  };
  const apply = (target: any, data: Record<string, any>) => {
    for (const [key, value] of Object.entries(data)) {
      target[key] = typeof value === "object" && value !== null && "increment" in value
        ? (target[key] ?? 0) + value.increment
        : value;
    }
    return target;
  };
  const prisma: any = {
    emailWebhookEvent: {
      create: jest.fn(async ({ data }: any) => {
        if (inbox.some((item) => item.deliveryKey === data.deliveryKey)) throw { code: "P2002" };
        const item = { id: `inbox-${inbox.length + 1}`, status: EmailWebhookProcessingStatus.received, processingAttempts: 0, ...data };
        inbox.push(item);
        return item;
      }),
      findUnique: jest.fn(async ({ where }: any) => inbox.find((item) => item.id === where.id) ?? null),
      update: jest.fn(async ({ where, data }: any) => apply(inbox.find((item) => item.id === where.id), data)),
      findMany: jest.fn(async () => [])
    },
    emailDelivery: {
      findUnique: jest.fn(async ({ where }: any) =>
        delivery.providerMessageId === where.providerMessageId ? delivery : null),
      update: jest.fn(async ({ data }: any) => apply(delivery, data))
    },
    recipientSuppression: {
      upsert: jest.fn(async ({ create, update }: any) => {
        const current = suppressions.find((item) => item.recipientHash === create.recipientHash);
        if (current) return apply(current, update);
        suppressions.push({ id: `suppression-${suppressions.length + 1}`, ...create });
        return suppressions.at(-1);
      })
    }
  };
  prisma.$transaction = jest.fn(async (callback: any) => callback(prisma));
  return { prisma: prisma as PrismaService, inbox, suppressions, delivery };
}

describe("Brevo transactional webhook boundary", () => {
  it("normalizes the documented message-id and ts_event fields", () => {
    expect(normalizeBrevoEvent({
      event: "hard_bounce",
      "message-id": "provider-message-1",
      ts_event: 1_784_419_200,
      email: "untrusted@example.com",
      reason: "provider detail must not be retained"
    })).toMatchObject({
      eventType: "hard_bounce",
      providerMessageId: "provider-message-1",
      occurredAt: new Date("2026-07-19T00:00:00.000Z"),
      payload: {
        event: "hard_bounce",
        messageId: "provider-message-1",
        reasonPresent: true
      }
    });
  });

  it("maps Brevo spam to the complaint lifecycle", () => {
    expect(normalizeBrevoEvent({
      event: "spam",
      "message-id": "provider-message-2",
      ts_event: 1_784_419_200
    }).eventType).toBe("complaint");
  });

  it("accepts only an exact bearer token", () => {
    const token = "a".repeat(48);
    expect(() => assertBrevoWebhookAuthorization(`Bearer ${token}`, token)).not.toThrow();
    expect(() => assertBrevoWebhookAuthorization(`Bearer ${token}x`, token)).toThrow(
      UnauthorizedException
    );
    expect(() => assertBrevoWebhookAuthorization(undefined, token)).toThrow(
      UnauthorizedException
    );
  });

  it("deduplicates delivery events and preserves monotonic lifecycle ordering", async () => {
    const state = createWebhookPrisma();
    const service = new EmailWebhookService(state.prisma, { get: jest.fn() } as unknown as ConfigService);
    const delivered = { event: "delivered", "message-id": "provider-message-1", ts_event: 200 };

    await expect(service.receive(delivered)).resolves.toEqual({ accepted: 1, duplicates: 0 });
    await expect(service.receive(delivered)).resolves.toEqual({ accepted: 0, duplicates: 1 });
    await service.receive({ event: "request", "message-id": "provider-message-1", ts_event: 100 });

    expect(state.delivery.status).toBe(EmailDeliveryStatus.delivered);
    expect(state.delivery.deliveredAt).toEqual(new Date(200_000));
  });

  it("makes a later complaint visible and suppresses the trusted delivery recipient", async () => {
    const state = createWebhookPrisma({
      status: EmailDeliveryStatus.delivered,
      lastEventAt: new Date(200_000),
      lastEventPrecedence: 40
    });
    const service = new EmailWebhookService(state.prisma, { get: jest.fn() } as unknown as ConfigService);

    await service.receive({
      event: "spam",
      "message-id": "provider-message-1",
      ts_event: 300,
      email: "attacker-controlled@example.com"
    });

    expect(state.delivery.status).toBe(EmailDeliveryStatus.complained);
    expect(state.suppressions).toEqual([
      expect.objectContaining({ recipientHash: "trusted-recipient-hash", reason: "complaint" })
    ]);
  });

  it("does not suppress soft bounces and retains unknown message IDs as unmatched", async () => {
    const state = createWebhookPrisma();
    const service = new EmailWebhookService(state.prisma, { get: jest.fn() } as unknown as ConfigService);

    await service.receive({ event: "soft_bounce", "message-id": "provider-message-1", ts_event: 200 });
    await service.receive({ event: "hard_bounce", "message-id": "unknown-message", ts_event: 300 });

    expect(state.suppressions).toHaveLength(0);
    expect(state.inbox.at(-1)?.status).toBe(EmailWebhookProcessingStatus.unmatched);
  });

  it("never applies Brevo lifecycle events to a local simulated delivery", async () => {
    const state = createWebhookPrisma({ provider: EmailProvider.local, status: EmailDeliveryStatus.simulated });
    const service = new EmailWebhookService(state.prisma, { get: jest.fn() } as unknown as ConfigService);

    await service.receive({ event: "delivered", "message-id": "provider-message-1", ts_event: 200 });

    expect(state.delivery.status).toBe(EmailDeliveryStatus.simulated);
    expect(state.inbox[0]?.status).toBe(EmailWebhookProcessingStatus.ignored);
  });
});
