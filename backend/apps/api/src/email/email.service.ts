import { Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EmailDeliveryStatus, EmailProvider, type Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { JobsService } from "../jobs/jobs.service";
import { OperationalError, classifyOperationalError } from "../jobs/operational-error";
import { PrismaService } from "../prisma/prisma.service";
import { canonicalEmailProviderMessageId } from "./email-message-id";
import {
  SEND_TRANSACTIONAL_EMAIL_JOB,
  type TransactionalEmailPayload
} from "./email.types";
import type { MessagingNotificationEmailPayload } from "../messaging/messaging.types";
import type { BookingCancellationEmailPayload } from "../bookings/booking-cancellation.types";
import type { BookingCompletionEmailPayload } from "../bookings/booking-lifecycle.types";

export interface EmailAdapter {
  send(payload: TransactionalEmailPayload): Promise<EmailSendResult>;
}

export interface EmailSendResult {
  provider: "local" | "brevo";
  messageId: string;
  acceptedAt: Date;
  simulated?: boolean;
}

interface BrevoFetchResponse {
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
}

type BrevoFetchClient = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  }
) => Promise<BrevoFetchResponse>;

export class LocalEmailAdapter implements EmailAdapter {
  async send(): Promise<EmailSendResult> {
    return {
      provider: "local",
      messageId: `local-${randomUUID()}`,
      acceptedAt: new Date(),
      simulated: true
    };
  }
}

export class BrevoEmailAdapter implements EmailAdapter {
  constructor(
    private readonly client: BrevoFetchClient,
    private readonly apiKey: string,
    private readonly from: string,
    private readonly timeoutMs = 5_000
  ) {}

  async send(payload: TransactionalEmailPayload): Promise<EmailSendResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: BrevoFetchResponse;
    try {
      response = await this.client("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          accept: "application/json",
          "api-key": this.apiKey,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          sender: this.toBrevoSender(),
          to: [{ email: payload.to }],
          subject: payload.subject,
          textContent: payload.text,
          tags: [payload.template]
        }),
        signal: controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new OperationalError(
          "brevo_timeout",
          "The email provider request timed out.",
          true,
          { cause: error }
        );
      }
      throw new OperationalError(
        "brevo_network_failed",
        "The email provider could not be reached.",
        true,
        { cause: error }
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw this.httpError(response.status);
    }

    let body: unknown;
    try {
      body = await response.json?.();
    } catch {
      body = undefined;
    }
    const messageId =
      typeof body === "object" && body !== null && "messageId" in body
        ? (body as { messageId?: unknown }).messageId
        : undefined;
    if (typeof messageId !== "string") {
      throw new OperationalError(
        "brevo_response_invalid",
        "The email provider response did not include a valid message ID.",
        true
      );
    }
    const canonicalMessageId = canonicalEmailProviderMessageId(messageId);
    if (canonicalMessageId.length === 0 || canonicalMessageId.length > 255) {
      throw new OperationalError(
        "brevo_response_invalid",
        "The email provider response did not include a valid message ID.",
        true
      );
    }

    return { provider: "brevo", messageId: canonicalMessageId, acceptedAt: new Date() };
  }

  private httpError(status: number) {
    if (status === 429) {
      return new OperationalError(
        "brevo_rate_limited",
        "The email provider rate limited the request.",
        true
      );
    }
    if (status >= 500 || status === 408) {
      return new OperationalError(
        "brevo_unavailable",
        "The email provider is temporarily unavailable.",
        true
      );
    }
    if (status === 401 || status === 403) {
      return new OperationalError(
        "brevo_authentication_failed",
        "The email provider rejected its credentials.",
        false
      );
    }
    return new OperationalError(
      "brevo_request_invalid",
      "The email provider rejected the request configuration.",
      false
    );
  }

  private toBrevoSender() {
    const match = this.from
      .trim()
      .match(/^(.+?)\s*<([^<>\s]+@[^<>\s]+)>$/);

    if (!match) {
      return { email: this.from.trim() };
    }

    const name = match[1]?.trim().replace(/^"|"$/g, "");
    const email = match[2];

    if (!email) {
      return { email: this.from.trim() };
    }

    return {
      email,
      ...(name ? { name } : {})
    };
  }
}

export function createEmailAdapter(
  config: Pick<ConfigService, "get">,
  client: BrevoFetchClient = fetch
): EmailAdapter {
  const apiKey = config.get<string>("BREVO_API_KEY");
  const from = config.get<string>("TRANSACTIONAL_EMAIL_FROM");
  const provider = config.get<string>("EMAIL_PROVIDER") ?? "local";

  if (provider === "brevo") {
    if (!apiKey || !from) {
      throw new OperationalError(
        "email_provider_configuration_invalid",
        "Brevo email configuration is incomplete.",
        false
      );
    }
    return new BrevoEmailAdapter(
      client,
      apiKey,
      from,
      config.get<number>("EMAIL_PROVIDER_TIMEOUT_MS") ?? 5_000
    );
  }

  return new LocalEmailAdapter();
}

@Injectable()
export class EmailService {
  private readonly adapter: EmailAdapter;

  constructor(
    private readonly jobs: JobsService,
    private readonly config: ConfigService,
    @Optional() private readonly prisma?: PrismaService
  ) {
    this.adapter = createEmailAdapter(config);
  }

  queueTransactionalEmail(
    payload: TransactionalEmailPayload,
    options: {
      aggregateId?: string;
      aggregateType?: string;
      client?: Prisma.TransactionClient;
      deduplicationKey?: string;
    } = {}
  ) {
    return this.jobs.enqueue(SEND_TRANSACTIONAL_EMAIL_JOB, payload, {
      aggregateId: options.aggregateId ?? options.deduplicationKey ?? payload.to,
      aggregateType: options.aggregateType ?? "email",
      client: options.client,
      deduplicationKey: options.deduplicationKey,
      maxAttempts: 3
    });
  }

  async sendMessagingNotificationNow(
    payload: MessagingNotificationEmailPayload,
    context: { outboxEventId: string }
  ) {
    const prisma = this.prisma;
    if (!prisma) {
      throw new OperationalError(
        "messaging_notification_invalid",
        "The messaging notification recipient could not be resolved.",
        false
      );
    }
    const message = await prisma.message.findFirst({
      where: {
        id: payload.messageId,
        inquiryId: payload.inquiryId,
        inquiry: {
          OR: [
            { renterId: payload.recipientUserId },
            { hostId: payload.recipientUserId }
          ]
        }
      },
      select: {
        inquiry: {
          select: {
            listing: { select: { title: true } }
          }
        }
      }
    });
    const recipient = await prisma.user.findUnique({
      where: { id: payload.recipientUserId },
      select: { email: true }
    });
    if (!message || !recipient) {
      throw new OperationalError(
        "messaging_notification_invalid",
        "The messaging notification recipient could not be resolved.",
        false
      );
    }

    return this.sendNow(
      {
        to: recipient.email,
        template: "inquiry_new_message",
        subject: `New MediCN message about ${message.inquiry.listing.title}`,
        text: "You have a new message in MediCN. Sign in to read it.",
        metadata: {
          inquiryId: payload.inquiryId,
          messageId: payload.messageId
        }
      },
      context
    );
  }

  async sendBookingCancellationNow(
    payload: BookingCancellationEmailPayload,
    context: { outboxEventId: string }
  ) {
    const prisma = this.prisma;
    if (!prisma) {
      throw new OperationalError(
        "booking_cancellation_notification_invalid",
        "The cancellation notification could not be resolved.",
        false
      );
    }
    const operation = await prisma.bookingCancellationOperation.findFirst({
      where: {
        id: payload.cancellationOperationId,
        booking: {
          OR: [
            { renterId: payload.recipientUserId },
            { hostId: payload.recipientUserId }
          ]
        }
      },
      select: { booking: { select: { listing: { select: { title: true } } } } }
    });
    const recipient = await prisma.user.findUnique({
      where: { id: payload.recipientUserId },
      select: { email: true }
    });
    if (!operation || !recipient) {
      throw new OperationalError(
        "booking_cancellation_notification_invalid",
        "The cancellation notification could not be resolved.",
        false
      );
    }
    const copy = payload.template === "booking_cancelled_no_payment"
      ? {
          subject: `Booking cancelled for ${operation.booking.listing.title}`,
          text: "The booking was cancelled. No payment was collected."
        }
      : payload.template === "booking_cancelled_refunded"
      ? {
          subject: `Booking cancellation completed for ${operation.booking.listing.title}`,
          text: "The booking cancellation completed after the full refund was confirmed."
        }
      : payload.template === "booking_cancelled_financial_event"
      ? {
          subject: `Booking cancelled for ${operation.booking.listing.title}`,
          text: "The booking was cancelled after its payment state was confirmed."
        }
      : {
          subject: `Booking cancellation requested for ${operation.booking.listing.title}`,
          text: "A booking cancellation was requested. Financial processing is still pending."
        };
    return this.sendNow(
      {
        to: recipient.email,
        template: payload.template,
        ...copy,
        metadata: { cancellationOperationId: payload.cancellationOperationId }
      },
      context
    );
  }

  async sendBookingCompletionNow(
    payload: BookingCompletionEmailPayload,
    context: { outboxEventId: string }
  ) {
    const prisma = this.prisma;
    if (!prisma) {
      throw new OperationalError(
        "booking_completion_notification_invalid",
        "The completion notification could not be resolved.",
        false
      );
    }
    const booking = await prisma.booking.findFirst({
      where: {
        id: payload.bookingId,
        status: "completed",
        OR: [
          { renterId: payload.recipientUserId },
          { hostId: payload.recipientUserId }
        ]
      },
      select: { listing: { select: { title: true } } }
    });
    const recipient = await prisma.user.findUnique({
      where: { id: payload.recipientUserId },
      select: { email: true }
    });
    if (!booking || !recipient) {
      throw new OperationalError(
        "booking_completion_notification_invalid",
        "The completion notification could not be resolved.",
        false
      );
    }
    return this.sendNow(
      {
        to: recipient.email,
        template: "booking_completed",
        subject: `Booking completed for ${booking.listing.title}`,
        text: "The stay has ended and the booking is now completed.",
        metadata: { bookingId: payload.bookingId }
      },
      context
    );
  }

  async sendNow(
    payload: TransactionalEmailPayload,
    context?: { outboxEventId: string }
  ) {
    if (!context || !this.prisma) return this.adapter.send(payload);

    const recipient = payload.to.trim().toLowerCase();
    const recipientHash = createHash("sha256").update(recipient).digest("hex");
    const provider =
      (this.config.get<string>("EMAIL_PROVIDER") ?? "local") === "brevo"
        ? EmailProvider.brevo
        : EmailProvider.local;
    const delivery = await this.prisma.emailDelivery.upsert({
      where: { outboxEventId: context.outboxEventId },
      create: {
        outboxEventId: context.outboxEventId,
        recipient,
        recipientHash,
        template: payload.template,
        provider
      },
      update: { recipient, recipientHash, template: payload.template, provider }
    });

    const suppression = await this.prisma.recipientSuppression.findFirst({
      where: { recipientHash, active: true },
      select: { id: true }
    });
    if (suppression) {
      await this.prisma.emailDelivery.update({
        where: { id: delivery.id },
        data: {
          attempts: { increment: 1 },
          status: EmailDeliveryStatus.suppressed,
          suppressedAt: new Date(),
          errorCategory: "recipient_suppressed",
          errorMessage: "The recipient is suppressed after a permanent delivery event."
        }
      });
      return {
        provider: provider === EmailProvider.brevo ? "brevo" as const : "local" as const,
        messageId: "suppressed",
        acceptedAt: new Date(),
        simulated: provider === EmailProvider.local,
        suppressed: true
      };
    }

    try {
      const result = await this.adapter.send(payload);
      await this.prisma.emailDelivery.update({
        where: { id: delivery.id },
        data: {
          attempts: { increment: 1 },
          providerMessageId: result.messageId,
          status: result.simulated
            ? EmailDeliveryStatus.simulated
            : EmailDeliveryStatus.accepted,
          acceptedAt: result.acceptedAt,
          errorCategory: null,
          errorMessage: null
        }
      });
      return result;
    } catch (error) {
      const classified = classifyOperationalError(error);
      await this.prisma.emailDelivery.update({
        where: { id: delivery.id },
        data: {
          attempts: { increment: 1 },
          status: EmailDeliveryStatus.failed,
          failedAt: new Date(),
          errorCategory: classified.category,
          errorMessage: classified.message
        }
      });
      throw error;
    }
  }
}
