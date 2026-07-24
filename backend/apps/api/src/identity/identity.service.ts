import { Injectable } from "@nestjs/common";
import {
  IdentityVerificationStatus,
  IdentityWebhookProcessingStatus,
  Prisma
} from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { AuthService } from "../auth/auth.service";
import { EmailService } from "../email/email.service";
import { PrismaService } from "../prisma/prisma.service";
import type { NormalizedIdentityWebhook } from "./identity-provider";
import { VeriffIdentityProvider } from "./veriff.provider";

const REUSABLE = new Set<IdentityVerificationStatus>([
  IdentityVerificationStatus.created,
  IdentityVerificationStatus.submitted,
  IdentityVerificationStatus.review,
  IdentityVerificationStatus.resubmission_requested
]);
const RETRYABLE = new Set<IdentityVerificationStatus>([
  IdentityVerificationStatus.declined,
  IdentityVerificationStatus.expired,
  IdentityVerificationStatus.abandoned
]);

@Injectable()
export class IdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly provider: VeriffIdentityProvider,
    private readonly emailService: EmailService
  ) {}

  async createOrReuseSession(token: string) {
    const user = await this.authService.getCurrentUserRecord(token);
    return this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, `identity-session:${user.id}`);
      await this.lock(transaction, `identity-user:${user.id}`);
      const current = await transaction.identityVerification.findFirst({
        where: { userId: user.id, supersededAt: null }
      });

      if (current && (REUSABLE.has(current.status) || current.status === IdentityVerificationStatus.approved)) {
        return this.toSessionDto(current);
      }

      if (current && !RETRYABLE.has(current.status)) {
        return this.toSessionDto(current);
      }

      const id = randomUUID();
      const vendorData = randomUUID();
      const created = await this.provider.createSession({
        vendorData,
        endUserId: vendorData,
        callbackUrl: this.provider.callbackUrl()
      });
      const now = new Date();

      if (current) {
        await transaction.identityVerification.update({
          where: { id: current.id },
          data: { supersededAt: now }
        });
      }

      const verification = await transaction.identityVerification.create({
        data: {
          id,
          userId: user.id,
          providerSessionId: created.providerSessionId,
          providerHostedUrl: created.hostedUrl,
          vendorData,
          status: IdentityVerificationStatus.created,
          providerStatus:
            created.providerStatus === "created" ? created.providerStatus : null,
          expiresAt: created.expiresAt
        }
      });

      if (current) {
        await transaction.identityVerification.update({
          where: { id: current.id },
          data: { supersededById: verification.id }
        });
      }
      return this.toSessionDto(verification);
    });
  }

  async getCurrent(token: string) {
    const user = await this.authService.getCurrentUserRecord(token);
    const current = await this.prisma.identityVerification.findFirst({
      where: { userId: user.id, supersededAt: null }
    });
    return this.toSummary(current);
  }

  async handleWebhook(
    kind: "event" | "decision",
    rawBody: Buffer,
    authClient: string | undefined,
    signature: string | undefined
  ) {
    const event = this.provider.verifyAndNormalizeWebhook(
      kind,
      rawBody,
      authClient,
      signature
    );
    const digest = createHash("sha256").update(rawBody).digest("hex");
    const deliveryKey = `${kind}:${digest}`;
    const inbox = await this.persistInbox(kind, deliveryKey, digest, event);
    if (inbox.duplicate) {
      return {
        received: true,
        duplicate: true,
        processingStatus: inbox.status
      };
    }
    const status = await this.processInbox(inbox.id);
    return { received: true, duplicate: false, processingStatus: status };
  }

  async retryFailedWebhookEvents(limit = 25) {
    await this.prisma.identityWebhookEvent.updateMany({
      where: {
        status: IdentityWebhookProcessingStatus.processing,
        receivedAt: { lte: new Date(Date.now() - 5 * 60_000) }
      },
      data: {
        status: IdentityWebhookProcessingStatus.failed,
        lastError: "Recovered a stale webhook processing claim."
      }
    });
    const events = await this.prisma.identityWebhookEvent.findMany({
      where: {
        status: {
          in: [
            IdentityWebhookProcessingStatus.received,
            IdentityWebhookProcessingStatus.failed
          ]
        }
      },
      orderBy: { receivedAt: "asc" },
      take: Math.min(Math.max(limit, 1), 100),
      select: { id: true }
    });
    let processed = 0;
    let failed = 0;
    for (const event of events) {
      const status = await this.processInbox(event.id, true);
      if (
        status === IdentityWebhookProcessingStatus.processed ||
        status === IdentityWebhookProcessingStatus.ignored
      ) processed += 1;
      else failed += 1;
    }
    return { total: events.length, processed, failed };
  }

  private async persistInbox(
    kind: "event" | "decision",
    deliveryKey: string,
    digest: string,
    event: NormalizedIdentityWebhook
  ) {
    try {
      const created = await this.prisma.identityWebhookEvent.create({
        data: {
          deliveryKey,
          kind,
          providerSessionId: event.sessionId,
          providerAttemptId: event.attemptId,
          providerStatus: event.providerStatus,
          providerCode: event.providerCode,
          providerOccurredAt: event.occurredAt,
          payloadDigest: digest,
          payload: event.payload
        }
      });
      return { id: created.id, status: created.status, duplicate: false };
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      const existing = await this.prisma.identityWebhookEvent.findUniqueOrThrow({
        where: { deliveryKey }
      });
      return { id: existing.id, status: existing.status, duplicate: true };
    }
  }

  private async processInbox(id: string, retry = false) {
    const claimed = await this.prisma.identityWebhookEvent.updateMany({
      where: {
        id,
        status: retry
          ? { in: [IdentityWebhookProcessingStatus.received, IdentityWebhookProcessingStatus.failed] }
          : IdentityWebhookProcessingStatus.received
      },
      data: {
        status: IdentityWebhookProcessingStatus.processing,
        processingAttempts: { increment: 1 },
        lastError: null
      }
    });
    if (claimed.count !== 1) {
      return (
        await this.prisma.identityWebhookEvent.findUniqueOrThrow({ where: { id } })
      ).status;
    }

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const inbox = await transaction.identityWebhookEvent.findUniqueOrThrow({
          where: { id }
        });
        const payload = inbox.payload as Record<string, unknown>;
        const sessionId = this.string(payload.sessionId);
        if (!sessionId) throw new Error("Webhook session binding is missing.");
        await this.lock(transaction, `identity-webhook:${sessionId}`);
        const verification = await transaction.identityVerification.findUnique({
          where: { providerSessionId: sessionId },
          include: { user: { select: { email: true } } }
        });
        if (!verification) throw new Error("Webhook session is not recognized.");
        await this.lock(transaction, `identity-user:${verification.userId}`);
        const vendorData = this.string(payload.vendorData);
        const endUserId = this.string(payload.endUserId);
        if (
          (!vendorData && !endUserId) ||
          (vendorData !== null && vendorData !== verification.vendorData) ||
          (endUserId !== null && endUserId !== verification.vendorData)
        ) {
          throw new Error("Webhook identity binding did not match the session.");
        }

        const next = this.normalizedStatus(payload.providerStatus, inbox.kind);
        const stale = Boolean(
          inbox.kind === "decision" &&
            inbox.providerOccurredAt &&
            verification.lastProviderUpdateAt &&
            inbox.providerOccurredAt < verification.lastProviderUpdateAt
        );
        const transition = !stale && next
          ? this.allowedTransition(verification.status, next)
          : false;
        const finalStatus = transition ? next! : verification.status;

        if (transition) {
          const now = inbox.providerOccurredAt ?? new Date();
          await transaction.identityVerification.update({
            where: { id: verification.id },
            data: {
              status: finalStatus,
              providerStatus: this.allowlistedProviderStatus(
                this.string(payload.providerStatus)
              ),
              providerCode: this.string(payload.providerCode),
              providerAttemptId: this.string(payload.attemptId),
              reasonCode: this.string(payload.reasonCode),
              reasonCategory: this.string(payload.reasonCategory),
              submittedAt:
                finalStatus === IdentityVerificationStatus.submitted
                  ? verification.submittedAt ?? now
                  : verification.submittedAt ?? this.date(payload.submittedAt),
              decidedAt:
                inbox.kind === "decision" ? now : verification.decidedAt,
              expiresAt:
                finalStatus === IdentityVerificationStatus.expired
                  ? now
                  : verification.expiresAt,
              lastProviderUpdateAt:
                inbox.kind === "decision"
                  ? now
                  : verification.lastProviderUpdateAt
            }
          });
          await this.queueStatusEmail(
            transaction,
            verification.user.email,
            verification.id,
            finalStatus
          );
        }

        const inboxStatus = transition || !next || stale
          ? IdentityWebhookProcessingStatus.processed
          : IdentityWebhookProcessingStatus.ignored;
        await transaction.identityWebhookEvent.update({
          where: { id },
          data: {
            identityVerificationId: verification.id,
            status: inboxStatus,
            processedAt: new Date()
          }
        });
        return inboxStatus;
      });
    } catch (error) {
      await this.prisma.identityWebhookEvent.update({
        where: { id },
        data: {
          status: IdentityWebhookProcessingStatus.failed,
          lastError: this.safeError(error)
        }
      });
      return IdentityWebhookProcessingStatus.failed;
    }
  }

  private normalizedStatus(
    providerStatus: unknown,
    kind: "event" | "decision"
  ) {
    const status = this.string(providerStatus);
    if (kind === "event") {
      if (status === "submitted") return IdentityVerificationStatus.submitted;
      if (status === "started") return IdentityVerificationStatus.created;
      return null;
    }
    if (
      status &&
      ["approved", "declined", "resubmission_requested", "review", "expired", "abandoned"].includes(status)
    ) {
      return IdentityVerificationStatus[
        status as keyof typeof IdentityVerificationStatus
      ];
    }
    return null;
  }

  private allowedTransition(
    current: IdentityVerificationStatus,
    next: IdentityVerificationStatus
  ) {
    if (current === next) return false;
    if (current === IdentityVerificationStatus.approved) return false;
    if (next === IdentityVerificationStatus.created) return false;
    if (next === IdentityVerificationStatus.submitted) {
      return current === IdentityVerificationStatus.created;
    }
    if (
      current === IdentityVerificationStatus.declined ||
      current === IdentityVerificationStatus.expired ||
      current === IdentityVerificationStatus.abandoned
    ) {
      return next === IdentityVerificationStatus.approved;
    }
    return true;
  }

  private queueStatusEmail(
    transaction: Prisma.TransactionClient,
    to: string,
    verificationId: string,
    status: IdentityVerificationStatus
  ) {
    const content = {
      submitted: ["identity_verification_submitted", "Identity verification submitted", "Your identity verification was submitted for review."],
      approved: ["identity_verification_approved", "Identity verification approved", "Your identity verification was approved."],
      declined: ["identity_verification_declined", "Identity verification needs another attempt", "Your identity verification was declined. You may start a new attempt."],
      resubmission_requested: ["identity_verification_resubmission", "Identity verification needs resubmission", "Open your existing verification session to resubmit."],
      expired: ["identity_verification_expired", "Identity verification expired", "Your identity verification expired. You may start a new attempt."]
    } as const;
    const selected = content[status as keyof typeof content];
    if (!selected) return Promise.resolve();
    return this.emailService.queueTransactionalEmail(
      {
        to,
        template: selected[0],
        subject: selected[1],
        text: selected[2],
        metadata: { verificationId, status }
      },
      {
        aggregateId: verificationId,
        aggregateType: "identity_verification",
        client: transaction,
        deduplicationKey: `identity:${verificationId}:${status}`
      }
    );
  }

  toSummary(current: {
    status: IdentityVerificationStatus;
    provider: string;
    submittedAt: Date | null;
    decidedAt: Date | null;
    expiresAt: Date | null;
  } | null) {
    const status = current?.status ?? IdentityVerificationStatus.not_started;
    return {
      status,
      provider: current?.provider ?? "veriff",
      submittedAt: current?.submittedAt?.toISOString() ?? null,
      decidedAt: current?.decidedAt?.toISOString() ?? null,
      expiresAt: current?.expiresAt?.toISOString() ?? null,
      canRetry: RETRYABLE.has(status) || status === IdentityVerificationStatus.not_started,
      actionRequired: this.actionRequired(status)
    };
  }

  private toSessionDto(verification: {
    id: string;
    providerHostedUrl: string | null;
    status: IdentityVerificationStatus;
    expiresAt: Date | null;
  }) {
    return {
      verificationUrl:
        verification.status === IdentityVerificationStatus.approved
          ? null
          : verification.providerHostedUrl,
      sessionId: verification.id,
      status: verification.status,
      expiresAt: verification.expiresAt?.toISOString() ?? null
    };
  }

  private actionRequired(status: IdentityVerificationStatus) {
    if (status === IdentityVerificationStatus.not_started) return "start";
    if (status === IdentityVerificationStatus.created) return "continue";
    if (status === IdentityVerificationStatus.resubmission_requested) return "resubmit";
    if (status === IdentityVerificationStatus.approved) return "none";
    if (RETRYABLE.has(status)) return "retry";
    return "wait";
  }

  private lock(transaction: Prisma.TransactionClient, key: string) {
    return transaction.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`
    );
  }

  private allowlistedProviderStatus(status: string | null) {
    return status && ["created", "submitted", "review", "resubmission_requested", "approved", "declined", "expired", "abandoned"].includes(status)
      ? status
      : null;
  }

  private string(value: unknown) {
    return typeof value === "string" && value.length > 0 ? value : null;
  }

  private date(value: unknown) {
    if (typeof value !== "string") return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private safeError(error: unknown) {
    return (error instanceof Error ? error.message : "Webhook processing failed.").slice(0, 500);
  }

  private isUniqueViolation(error: unknown) {
    return (
      (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") ||
      (typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002")
    );
  }
}
