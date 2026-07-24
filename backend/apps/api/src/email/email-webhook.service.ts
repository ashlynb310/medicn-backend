import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  EmailDeliveryStatus,
  EmailProvider,
  EmailWebhookEventType,
  EmailWebhookProcessingStatus,
  Prisma,
  RecipientSuppressionReason
} from "@prisma/client";
import { createHash, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { canonicalEmailProviderMessageId } from "./email-message-id";

interface NormalizedBrevoEvent {
  deliveryKey: string;
  providerMessageId: string;
  eventType: EmailWebhookEventType;
  occurredAt: Date;
  payloadDigest: string;
  payload: Prisma.InputJsonObject;
}

const EVENT_TYPES: Record<string, EmailWebhookEventType> = {
  request: EmailWebhookEventType.request,
  sent: EmailWebhookEventType.sent,
  delivered: EmailWebhookEventType.delivered,
  deferred: EmailWebhookEventType.deferred,
  soft_bounce: EmailWebhookEventType.soft_bounce,
  hard_bounce: EmailWebhookEventType.hard_bounce,
  blocked: EmailWebhookEventType.blocked,
  invalid: EmailWebhookEventType.invalid,
  invalid_email: EmailWebhookEventType.invalid,
  spam: EmailWebhookEventType.complaint,
  complaint: EmailWebhookEventType.complaint,
  error: EmailWebhookEventType.error,
  unsubscribed: EmailWebhookEventType.unsubscribed
};

const DELIVERY_STATE: Partial<Record<EmailWebhookEventType, {
  status: EmailDeliveryStatus;
  precedence: number;
  timestampField: string;
}>> = {
  [EmailWebhookEventType.request]: { status: EmailDeliveryStatus.accepted, precedence: 10, timestampField: "acceptedAt" },
  [EmailWebhookEventType.sent]: { status: EmailDeliveryStatus.sent, precedence: 20, timestampField: "sentAt" },
  [EmailWebhookEventType.deferred]: { status: EmailDeliveryStatus.deferred, precedence: 30, timestampField: "deferredAt" },
  [EmailWebhookEventType.soft_bounce]: { status: EmailDeliveryStatus.soft_bounced, precedence: 35, timestampField: "softBouncedAt" },
  [EmailWebhookEventType.delivered]: { status: EmailDeliveryStatus.delivered, precedence: 40, timestampField: "deliveredAt" },
  [EmailWebhookEventType.unsubscribed]: { status: EmailDeliveryStatus.unsubscribed, precedence: 60, timestampField: "unsubscribedAt" },
  [EmailWebhookEventType.error]: { status: EmailDeliveryStatus.failed, precedence: 70, timestampField: "failedAt" },
  [EmailWebhookEventType.hard_bounce]: { status: EmailDeliveryStatus.hard_bounced, precedence: 100, timestampField: "hardBouncedAt" },
  [EmailWebhookEventType.blocked]: { status: EmailDeliveryStatus.blocked, precedence: 100, timestampField: "blockedAt" },
  [EmailWebhookEventType.invalid]: { status: EmailDeliveryStatus.invalid, precedence: 100, timestampField: "invalidAt" },
  [EmailWebhookEventType.complaint]: { status: EmailDeliveryStatus.complained, precedence: 110, timestampField: "complainedAt" }
};

const SUPPRESSION_REASON: Partial<Record<EmailWebhookEventType, RecipientSuppressionReason>> = {
  [EmailWebhookEventType.hard_bounce]: RecipientSuppressionReason.hard_bounce,
  [EmailWebhookEventType.blocked]: RecipientSuppressionReason.blocked,
  [EmailWebhookEventType.invalid]: RecipientSuppressionReason.invalid,
  [EmailWebhookEventType.complaint]: RecipientSuppressionReason.complaint
};

export function assertBrevoWebhookAuthorization(
  authorization: string | undefined,
  expectedToken: string | undefined
) {
  const supplied = authorization?.match(/^Bearer ([^\s]+)$/)?.[1] ?? "";
  const expected = expectedToken ?? "";
  const suppliedDigest = createHash("sha256").update(supplied).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  if (!expected || !supplied || !timingSafeEqual(suppliedDigest, expectedDigest)) {
    throw new UnauthorizedException({
      code: "WEBHOOK_UNAUTHORIZED",
      message: "Webhook authorization failed.",
      details: {}
    });
  }
}

export function normalizeBrevoEvent(input: unknown): NormalizedBrevoEvent {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw invalidWebhook();
  }
  const event = (input as Record<string, unknown>).event;
  const messageId = (input as Record<string, unknown>)["message-id"];
  const tsEvent = (input as Record<string, unknown>).ts_event;
  const tsEpoch = (input as Record<string, unknown>).ts_epoch;
  const ts = (input as Record<string, unknown>).ts;
  if (
    typeof event !== "string" || event.length === 0 || event.length > 50 ||
    typeof messageId !== "string" || messageId.length === 0 || messageId.length > 255
  ) {
    throw invalidWebhook();
  }
  const seconds =
    typeof tsEvent === "number" ? tsEvent :
    typeof tsEpoch === "number" ? (tsEpoch > 10_000_000_000 ? tsEpoch / 1000 : tsEpoch) :
    typeof ts === "number" ? ts : NaN;
  const occurredAt = new Date(seconds * 1000);
  if (!Number.isFinite(seconds) || Number.isNaN(occurredAt.getTime())) {
    throw invalidWebhook();
  }

  const providerMessageId = canonicalEmailProviderMessageId(messageId);
  if (providerMessageId.length === 0 || providerMessageId.length > 255) throw invalidWebhook();
  const eventType = EVENT_TYPES[event] ?? EmailWebhookEventType.unknown;
  const payload: Prisma.InputJsonObject = {
    event,
    messageId: providerMessageId,
    reasonPresent: typeof (input as Record<string, unknown>).reason === "string"
  };
  const canonical = JSON.stringify({ event, messageId: providerMessageId, occurredAt: occurredAt.toISOString() });
  const payloadDigest = createHash("sha256").update(canonical).digest("hex");
  return {
    deliveryKey: payloadDigest,
    providerMessageId,
    eventType,
    occurredAt,
    payloadDigest,
    payload
  };
}

@Injectable()
export class EmailWebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {}

  assertAuthorized(authorization: string | undefined) {
    assertBrevoWebhookAuthorization(
      authorization,
      this.config.get<string>("BREVO_WEBHOOK_BEARER_TOKEN")
    );
  }

  async receive(body: unknown) {
    const rawEvents = Array.isArray(body)
      ? body
      : typeof body === "object" && body !== null && Array.isArray((body as { events?: unknown }).events)
        ? (body as { events: unknown[] }).events
        : [body];
    if (rawEvents.length === 0 || rawEvents.length > 500) throw invalidWebhook();
    const events = rawEvents.map(normalizeBrevoEvent);
    let accepted = 0;
    let duplicates = 0;
    for (const event of events) {
      try {
        const inbox = await this.prisma.emailWebhookEvent.create({ data: event });
        accepted += 1;
        await this.processInbox(inbox.id);
      } catch (error) {
        if (this.isUniqueViolation(error)) {
          duplicates += 1;
          continue;
        }
        throw error;
      }
    }
    return { accepted, duplicates };
  }

  async retryFailed(limit = 100) {
    const inbox = await this.prisma.emailWebhookEvent.findMany({
      where: { status: EmailWebhookProcessingStatus.failed },
      orderBy: { receivedAt: "asc" },
      take: Math.min(Math.max(limit, 1), 500),
      select: { id: true }
    });
    for (const event of inbox) await this.processInbox(event.id);
    return { scanned: inbox.length };
  }

  private async processInbox(id: string) {
    try {
      await this.prisma.$transaction(async (transaction) => {
        const inbox = await transaction.emailWebhookEvent.findUnique({ where: { id } });
        if (!inbox) return;
        const delivery = await transaction.emailDelivery.findUnique({
          where: { providerMessageId: inbox.providerMessageId }
        });
        if (!delivery) {
          await transaction.emailWebhookEvent.update({
            where: { id },
            data: {
              status: EmailWebhookProcessingStatus.unmatched,
              processingAttempts: { increment: 1 },
              processedAt: new Date()
            }
          });
          return;
        }
        if (delivery.provider === EmailProvider.local) {
          await transaction.emailWebhookEvent.update({
            where: { id },
            data: {
              emailDeliveryId: delivery.id,
              status: EmailWebhookProcessingStatus.ignored,
              processingAttempts: { increment: 1 },
              processedAt: new Date()
            }
          });
          return;
        }
        const lifecycle = DELIVERY_STATE[inbox.eventType];
        if (!lifecycle) {
          await transaction.emailWebhookEvent.update({
            where: { id },
            data: {
              emailDeliveryId: delivery.id,
              status: EmailWebhookProcessingStatus.ignored,
              processingAttempts: { increment: 1 },
              processedAt: new Date()
            }
          });
          return;
        }

        const monotonic =
          (!delivery.lastEventAt || inbox.occurredAt >= delivery.lastEventAt) &&
          lifecycle.precedence >= delivery.lastEventPrecedence;
        if (monotonic) {
          await transaction.emailDelivery.update({
            where: { id: delivery.id },
            data: {
              status: lifecycle.status,
              lastEventAt: inbox.occurredAt,
              lastEventPrecedence: lifecycle.precedence,
              [lifecycle.timestampField]: inbox.occurredAt
            }
          });
        }
        const suppressionReason = SUPPRESSION_REASON[inbox.eventType];
        if (monotonic && suppressionReason) {
          await transaction.recipientSuppression.upsert({
            where: { recipientHash: delivery.recipientHash },
            create: {
              recipientHash: delivery.recipientHash,
              reason: suppressionReason,
              providerMessageId: inbox.providerMessageId,
              suppressedAt: inbox.occurredAt
            },
            update: {
              active: true,
              reason: suppressionReason,
              providerMessageId: inbox.providerMessageId,
              suppressedAt: inbox.occurredAt
            }
          });
        }
        await transaction.emailWebhookEvent.update({
          where: { id },
          data: {
            emailDeliveryId: delivery.id,
            status: EmailWebhookProcessingStatus.processed,
            processingAttempts: { increment: 1 },
            processedAt: new Date(),
            errorCategory: null,
            errorMessage: null
          }
        });
      });
    } catch (error) {
      await this.prisma.emailWebhookEvent.update({
        where: { id },
        data: {
          status: EmailWebhookProcessingStatus.failed,
          processingAttempts: { increment: 1 },
          errorCategory: "email_webhook_processing_failed",
          errorMessage: "The delivery event could not be applied."
        }
      });
      throw error;
    }
  }

  private isUniqueViolation(error: unknown) {
    return typeof error === "object" && error !== null && "code" in error &&
      (error as { code?: unknown }).code === "P2002";
  }
}

function invalidWebhook() {
  return new BadRequestException({
    code: "INVALID_WEBHOOK_PAYLOAD",
    message: "The transactional webhook payload is invalid.",
    details: {}
  });
}
