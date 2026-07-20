import { ServiceUnavailableException } from "@nestjs/common";
import {
  IdentityProvider,
  IdentityVerificationStatus,
  IdentityWebhookProcessingStatus,
  Prisma
} from "@prisma/client";
import type { AuthService } from "../src/auth/auth.service";
import type { EmailService } from "../src/email/email.service";
import { IdentityService } from "../src/identity/identity.service";
import type { VeriffIdentityProvider } from "../src/identity/veriff.provider";
import type { PrismaService } from "../src/prisma/prisma.service";

const now = new Date("2026-07-19T12:00:00.000Z");

function verification(
  status: IdentityVerificationStatus = IdentityVerificationStatus.created
) {
  return {
    id: "identity-1",
    userId: "user-1",
    provider: IdentityProvider.veriff,
    providerSessionId: "provider-session-1",
    providerHostedUrl: "https://magic.veriff.me/provider-session-1",
    vendorData: "opaque-binding",
    providerAttemptId: null,
    status,
    providerStatus: status,
    providerCode: null,
    reasonCode: null,
    reasonCategory: null,
    submittedAt: null,
    decidedAt: null,
    expiresAt: null,
    lastProviderUpdateAt: null,
    supersededAt: null,
    supersededById: null,
    createdAt: now,
    updatedAt: now
  };
}

function createService(current: ReturnType<typeof verification> | null) {
  const identityVerification = {
    findFirst: jest.fn().mockResolvedValue(current),
    findUnique: jest.fn(),
    create: jest.fn().mockImplementation(({ data }) => ({
      ...verification(),
      ...data
    })),
    update: jest.fn()
  };
  const identityWebhookEvent = {
    create: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn()
  };
  const transaction = {
    identityVerification,
    identityWebhookEvent,
    user: { update: jest.fn() },
    $executeRaw: jest.fn()
  };
  const prisma = {
    ...transaction,
    $transaction: jest.fn(async (callback) => callback(transaction))
  };
  const auth = {
    getCurrentUserRecord: jest.fn().mockResolvedValue({
      id: "user-1",
      email: "user@example.com"
    })
  };
  const provider = {
    callbackUrl: jest.fn().mockReturnValue("https://api.example.com/callback"),
    createSession: jest.fn().mockResolvedValue({
      providerSessionId: "provider-session-2",
      hostedUrl: "https://magic.veriff.me/provider-session-2",
      providerStatus: "created",
      expiresAt: null
    }),
    verifyAndNormalizeWebhook: jest.fn()
  };
  const email = { queueTransactionalEmail: jest.fn() };
  const service = new IdentityService(
    prisma as unknown as PrismaService,
    auth as unknown as AuthService,
    provider as unknown as VeriffIdentityProvider,
    email as unknown as EmailService
  );
  return { service, prisma, transaction, provider, email, identityVerification, identityWebhookEvent };
}

describe("IdentityService", () => {
  it("authenticates and reuses an active session without another provider call", async () => {
    const { service, provider } = createService(verification());
    await expect(service.createOrReuseSession("token")).resolves.toEqual({
      verificationUrl: "https://magic.veriff.me/provider-session-1",
      sessionId: "identity-1",
      status: "created",
      expiresAt: null
    });
    expect(provider.createSession).not.toHaveBeenCalled();
  });

  it("reuses the existing provider URL for resubmission_requested", async () => {
    const { service, provider } = createService(
      verification(IdentityVerificationStatus.resubmission_requested)
    );
    await service.createOrReuseSession("token");
    expect(provider.createSession).not.toHaveBeenCalled();
  });

  it.each([
    IdentityVerificationStatus.declined,
    IdentityVerificationStatus.expired,
    IdentityVerificationStatus.abandoned
  ])("supersedes %s and creates one retry session", async (status) => {
    const { service, provider, identityVerification } = createService(
      verification(status)
    );
    await expect(service.createOrReuseSession("token")).resolves.toMatchObject({
      verificationUrl: "https://magic.veriff.me/provider-session-2",
      status: "created"
    });
    expect(provider.createSession).toHaveBeenCalledTimes(1);
    expect(identityVerification.update).toHaveBeenCalledTimes(2);
    expect(identityVerification.create).toHaveBeenCalledTimes(1);
  });

  it("does not persist a session when provider configuration is missing", async () => {
    const { service, provider, identityVerification } = createService(null);
    provider.createSession.mockRejectedValue(
      new ServiceUnavailableException({ code: "VERIFF_NOT_CONFIGURED" })
    );
    await expect(service.createOrReuseSession("token")).rejects.toMatchObject({
      response: { code: "VERIFF_NOT_CONFIGURED" }
    });
    expect(identityVerification.create).not.toHaveBeenCalled();
  });

  it("returns only allowlisted current-status guidance", async () => {
    const { service } = createService(
      verification(IdentityVerificationStatus.declined)
    );
    const result = await service.getCurrent("token");
    expect(result).toEqual({
      status: "declined",
      provider: "veriff",
      submittedAt: null,
      decidedAt: null,
      expiresAt: null,
      canRetry: true,
      actionRequired: "retry"
    });
    expect(result).not.toHaveProperty("providerSessionId");
    expect(result).not.toHaveProperty("vendorData");
  });

  it("deduplicates the same normalized webhook delivery", async () => {
    const { service, provider, identityWebhookEvent, transaction } = createService(null);
    provider.verifyAndNormalizeWebhook.mockReturnValue({
      sessionId: "provider-session-1",
      attemptId: "attempt-1",
      vendorData: "opaque-binding",
      endUserId: "opaque-binding",
      providerStatus: "submitted",
      providerCode: "7002",
      reasonCode: null,
      reasonCategory: null,
      occurredAt: null,
      normalizedStatus: IdentityVerificationStatus.submitted,
      payload: {
        sessionId: "provider-session-1",
        attemptId: "attempt-1",
        vendorData: "opaque-binding",
        endUserId: "opaque-binding",
        providerStatus: "submitted",
        providerCode: "7002",
        reasonCode: null,
        reasonCategory: null,
        occurredAt: null
      }
    });
    identityWebhookEvent.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("duplicate", {
        code: "P2002",
        clientVersion: "7.8.0"
      })
    );
    identityWebhookEvent.findUniqueOrThrow.mockResolvedValue({
      id: "inbox-1",
      status: IdentityWebhookProcessingStatus.processed
    });
    await expect(
      service.handleWebhook("event", Buffer.from("{}"), "key", "signature")
    ).resolves.toEqual({
      received: true,
      duplicate: true,
      processingStatus: "processed"
    });
    expect(identityWebhookEvent.updateMany).not.toHaveBeenCalled();
    expect(transaction.user.update).not.toHaveBeenCalled();
  });

  it("ignores concurrent processing claims already owned by another delivery", async () => {
    const { service, provider, identityWebhookEvent } = createService(null);
    provider.verifyAndNormalizeWebhook.mockReturnValue({
      sessionId: "provider-session-1",
      attemptId: null,
      vendorData: "opaque-binding",
      endUserId: null,
      providerStatus: "submitted",
      providerCode: "7002",
      reasonCode: null,
      reasonCategory: null,
      occurredAt: null,
      normalizedStatus: IdentityVerificationStatus.submitted,
      payload: { sessionId: "provider-session-1", providerStatus: "submitted" }
    });
    identityWebhookEvent.create.mockResolvedValue({
      id: "inbox-1",
      status: IdentityWebhookProcessingStatus.received
    });
    identityWebhookEvent.updateMany.mockResolvedValue({ count: 0 });
    identityWebhookEvent.findUniqueOrThrow.mockResolvedValue({
      id: "inbox-1",
      status: IdentityWebhookProcessingStatus.processing
    });
    await expect(
      service.handleWebhook("event", Buffer.from("{}"), "key", "signature")
    ).resolves.toMatchObject({ processingStatus: "processing" });
  });

  it("fails a signed webhook whose vendor binding does not match the session", async () => {
    const { service, provider, identityWebhookEvent, identityVerification } = createService(null);
    const payload = {
      sessionId: "provider-session-1",
      attemptId: "attempt-1",
      vendorData: "wrong-binding",
      endUserId: null,
      providerStatus: "submitted",
      providerCode: "7002",
      reasonCode: null,
      reasonCategory: null,
      occurredAt: null
    };
    provider.verifyAndNormalizeWebhook.mockReturnValue({
      ...payload,
      normalizedStatus: IdentityVerificationStatus.submitted,
      payload
    });
    identityWebhookEvent.create.mockResolvedValue({ id: "inbox-1", status: "received" });
    identityWebhookEvent.updateMany.mockResolvedValue({ count: 1 });
    identityWebhookEvent.findUniqueOrThrow.mockResolvedValue({
      id: "inbox-1",
      kind: "event",
      payload,
      providerOccurredAt: null
    });
    identityVerification.findUnique.mockResolvedValue({
      ...verification(),
      user: { email: "user@example.com" }
    });

    await expect(
      service.handleWebhook("event", Buffer.from("{}"), "key", "signature")
    ).resolves.toMatchObject({ processingStatus: "failed" });
    expect(identityVerification.update).not.toHaveBeenCalled();
    expect(identityWebhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) })
    );
  });

  it("updates submitted status and writes email to the durable outbox boundary", async () => {
    const { service, provider, identityWebhookEvent, identityVerification, email, transaction } = createService(null);
    const payload = {
      sessionId: "provider-session-1",
      attemptId: "attempt-1",
      vendorData: "opaque-binding",
      endUserId: "opaque-binding",
      providerStatus: "submitted",
      providerCode: "7002",
      reasonCode: null,
      reasonCategory: null,
      occurredAt: null
    };
    provider.verifyAndNormalizeWebhook.mockReturnValue({
      ...payload,
      normalizedStatus: IdentityVerificationStatus.submitted,
      occurredAt: null,
      payload
    });
    identityWebhookEvent.create.mockResolvedValue({ id: "inbox-1", status: "received" });
    identityWebhookEvent.updateMany.mockResolvedValue({ count: 1 });
    identityWebhookEvent.findUniqueOrThrow.mockResolvedValue({
      id: "inbox-1",
      kind: "event",
      payload,
      providerOccurredAt: null
    });
    identityVerification.findUnique.mockResolvedValue({
      ...verification(),
      user: { email: "user@example.com" }
    });
    identityVerification.update.mockResolvedValue({});
    identityWebhookEvent.update.mockResolvedValue({});

    await expect(
      service.handleWebhook("event", Buffer.from("{}"), "key", "signature")
    ).resolves.toMatchObject({ processingStatus: "processed" });
    expect(identityVerification.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "submitted" }) })
    );
    expect(email.queueTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({ template: "identity_verification_submitted" }),
      expect.objectContaining({ client: expect.anything() })
    );
    expect(transaction.user.update).not.toHaveBeenCalled();
  });

  it.each([
    IdentityVerificationStatus.approved,
    IdentityVerificationStatus.declined,
    IdentityVerificationStatus.resubmission_requested,
    IdentityVerificationStatus.expired
  ])("does not alter healthcare compatibility state for identity status %s", async (status) => {
    const { service, provider, identityWebhookEvent, identityVerification, transaction } = createService(null);
    const payload = {
      sessionId: "provider-session-1",
      attemptId: "attempt-1",
      vendorData: "opaque-binding",
      endUserId: "opaque-binding",
      providerStatus: status,
      providerCode: "9001",
      reasonCode: null,
      reasonCategory: null,
      occurredAt: null
    };
    provider.verifyAndNormalizeWebhook.mockReturnValue({
      ...payload,
      normalizedStatus: status,
      payload
    });
    identityWebhookEvent.create.mockResolvedValue({ id: "inbox-1", status: "received" });
    identityWebhookEvent.updateMany.mockResolvedValue({ count: 1 });
    identityWebhookEvent.findUniqueOrThrow.mockResolvedValue({
      id: "inbox-1",
      kind: "decision",
      payload,
      providerOccurredAt: null
    });
    identityVerification.findUnique.mockResolvedValue({
      ...verification(IdentityVerificationStatus.review),
      user: { email: "user@example.com" }
    });
    identityVerification.update.mockResolvedValue({});
    identityWebhookEvent.update.mockResolvedValue({});

    await expect(
      service.handleWebhook("decision", Buffer.from("{}"), "key", "signature")
    ).resolves.toMatchObject({ processingStatus: "processed" });
    expect(identityVerification.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status }) })
    );
    expect(transaction.user.update).not.toHaveBeenCalled();
  });

  it("never downgrades approved and rejects out-of-order submitted states", () => {
    const { service } = createService(null);
    const transitions = service as unknown as {
      allowedTransition(current: IdentityVerificationStatus, next: IdentityVerificationStatus): boolean;
    };
    expect(
      transitions.allowedTransition(
        IdentityVerificationStatus.approved,
        IdentityVerificationStatus.declined
      )
    ).toBe(false);
    expect(
      transitions.allowedTransition(
        IdentityVerificationStatus.review,
        IdentityVerificationStatus.submitted
      )
    ).toBe(false);
  });

  it("ignores an out-of-order identity event without touching healthcare compatibility state", async () => {
    const { service, provider, identityWebhookEvent, identityVerification, transaction } = createService(null);
    const payload = {
      sessionId: "provider-session-1",
      attemptId: "attempt-2",
      vendorData: "opaque-binding",
      endUserId: "opaque-binding",
      providerStatus: "submitted",
      providerCode: "7002",
      reasonCode: null,
      reasonCategory: null,
      occurredAt: null
    };
    provider.verifyAndNormalizeWebhook.mockReturnValue({
      ...payload,
      normalizedStatus: IdentityVerificationStatus.submitted,
      payload
    });
    identityWebhookEvent.create.mockResolvedValue({ id: "inbox-2", status: "received" });
    identityWebhookEvent.updateMany.mockResolvedValue({ count: 1 });
    identityWebhookEvent.findUniqueOrThrow.mockResolvedValue({
      id: "inbox-2",
      kind: "event",
      payload,
      providerOccurredAt: null
    });
    identityVerification.findUnique.mockResolvedValue({
      ...verification(IdentityVerificationStatus.approved),
      user: { email: "user@example.com" }
    });
    identityWebhookEvent.update.mockResolvedValue({});

    await expect(
      service.handleWebhook("event", Buffer.from("{}"), "key", "signature")
    ).resolves.toMatchObject({ processingStatus: "ignored" });
    expect(identityVerification.update).not.toHaveBeenCalled();
    expect(transaction.user.update).not.toHaveBeenCalled();
  });
});
