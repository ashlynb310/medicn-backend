import { ForbiddenException } from "@nestjs/common";
import {
  HostTransferReversalStatus,
  HostTransferStatus,
  JobExecutionState,
  PaymentStatus,
  UserRole
} from "@prisma/client";
import type { ConfigService } from "@nestjs/config";
import { AdminOperationsService } from "../src/admin/admin-operations.service";
import type { AuthService } from "../src/auth/auth.service";
import type { PrismaService } from "../src/prisma/prisma.service";

const now = new Date("2026-07-19T12:00:00.000Z");
const admin = { id: "admin-1", roles: [UserRole.admin] };
const renter = { id: "renter-1", roles: [UserRole.renter] };

function createService(user: { id: string; roles: UserRole[] } = admin) {
  const prisma = {
    payment: { count: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
    hostTransfer: { count: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
    jobExecution: { count: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
    operationalCommand: { count: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
    outboxEvent: { groupBy: jest.fn(), findFirst: jest.fn() },
    emailWebhookEvent: { count: jest.fn() },
    healthcareVerification: { count: jest.fn() },
    bookingCancellationOperation: { groupBy: jest.fn() },
    workerHeartbeat: { findMany: jest.fn() }
  };
  const auth = { getCurrentUserRecord: jest.fn().mockResolvedValue(user) };
  const config = { get: jest.fn() };
  return {
    prisma,
    service: new AdminOperationsService(
      auth as unknown as AuthService,
      prisma as unknown as PrismaService,
      config as unknown as ConfigService
    )
  };
}

describe("AdminOperationsService inspection", () => {
  it("rejects non-Admins before querying financial records", async () => {
    const { service, prisma } = createService(renter);
    await expect(service.listPayments("token", { page: 1, limit: 20 }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.payment.findMany).not.toHaveBeenCalled();
  });

  it("returns a bounded payment list without provider identifiers or raw failures", async () => {
    const { service, prisma } = createService();
    prisma.payment.count.mockResolvedValue(1);
    prisma.payment.findMany.mockResolvedValue([{
      id: "payment-1",
      bookingId: "booking-1",
      attemptNumber: 1,
      amountCents: 20_000,
      amountRefundedCents: 2_000,
      currency: "USD",
      status: PaymentStatus.partially_refunded,
      active: false,
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
      paidAt: now,
      refundedAt: null,
      providerPaymentIntentId: "pi_secret",
      failureReason: "raw provider response"
    }]);

    const result = await service.listPayments("token", {
      page: 1,
      limit: 20,
      status: PaymentStatus.partially_refunded
    });
    expect(result.data[0]).toEqual({
      id: "payment-1",
      bookingId: "booking-1",
      attemptNumber: 1,
      amountCents: 20_000,
      amountRefundedCents: 2_000,
      currency: "USD",
      status: PaymentStatus.partially_refunded,
      active: false,
      expiresAt: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      paidAt: now.toISOString(),
      refundedAt: null
    });
    expect(JSON.stringify(result)).not.toMatch(/pi_secret|raw provider/);
  });

  it("allowlists provider references only on Admin payment detail", async () => {
    const { service, prisma } = createService();
    prisma.payment.findUnique.mockResolvedValue({
      id: "payment-1",
      bookingId: "booking-1",
      attemptNumber: 1,
      amountCents: 20_000,
      amountRefundedCents: 0,
      currency: "USD",
      status: PaymentStatus.paid,
      active: false,
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
      paidAt: now,
      refundedAt: null,
      providerCheckoutSessionId: "cs_1",
      providerPaymentIntentId: "pi_1",
      providerChargeId: "ch_1",
      failureReason: "cardholder details",
      idempotencyKey: "private-key"
    });
    const result = await service.getPayment("token", "payment-1");
    expect(result.providerReferences).toEqual({
      checkoutSessionId: "cs_1",
      paymentIntentId: "pi_1",
      chargeId: "ch_1"
    });
    expect(JSON.stringify(result)).not.toMatch(/cardholder|private-key/);
  });

  it("labels Stripe Transfer separately from bank payout and omits failure messages", async () => {
    const { service, prisma } = createService();
    prisma.hostTransfer.findUnique.mockResolvedValue({
      id: "transfer-1",
      bookingId: "booking-1",
      paymentId: "payment-1",
      hostId: "host-1",
      grossAmountCents: 20_000,
      platformFeeCents: 2_000,
      hostNetAmountCents: 18_000,
      currency: "USD",
      status: HostTransferStatus.failed,
      reversalStatus: HostTransferReversalStatus.none,
      reversedAmountCents: 0,
      reversalTargetAmountCents: 0,
      eligibleAt: now,
      transferredAt: null,
      failedAt: now,
      createdAt: now,
      updatedAt: now,
      failureCode: "TRANSFER_FAILED",
      failureMessage: "raw stack and provider payload",
      providerTransferId: "tr_1",
      providerConnectedAccountId: "acct_1",
      reversalProviderIds: []
    });
    const result = await service.getHostTransfer("token", "transfer-1");
    expect(result.financialBoundary).toEqual({
      movement: "stripe_transfer_to_connected_balance",
      representsBankPayout: false
    });
    expect(JSON.stringify(result)).not.toMatch(/raw stack|provider payload/);
  });

  it("omits worker identity, raw errors, and provider references from job detail", async () => {
    const { service, prisma } = createService();
    prisma.jobExecution.findUnique.mockResolvedValue({
      id: "execution-1",
      outboxEventId: "outbox-1",
      queueName: "operations",
      jobType: "payment_reconciliation",
      jobId: "job-1",
      aggregateType: "operational_command",
      aggregateId: "command-1",
      attemptNumber: 3,
      state: JobExecutionState.failed,
      retryable: true,
      errorCategory: "provider_timeout",
      errorMessage: "raw response and stack",
      providerRef: "pi_1",
      workerIdentity: "worker-secret",
      startedAt: now,
      completedAt: now,
      createdAt: now,
      updatedAt: now
    });
    const result = await service.getJobExecution("token", "execution-1");
    expect(result).toMatchObject({
      id: "execution-1",
      state: JobExecutionState.failed,
      retryable: true,
      failureCategory: "provider_timeout",
      classification: "retryable_failed"
    });
    expect(JSON.stringify(result)).not.toMatch(/raw response|stack|pi_1|worker-secret/);
  });
});
