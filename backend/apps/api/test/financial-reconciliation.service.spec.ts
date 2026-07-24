import {
  HostTransferReversalStatus,
  HostTransferStatus,
  PaymentStatus
} from "@prisma/client";
import { OperationalError } from "../src/jobs/operational-error";
import { FinancialReconciliationService } from "../src/payments/financial-reconciliation.service";
import type { PaymentsService } from "../src/payments/payments.service";
import type { PrismaService } from "../src/prisma/prisma.service";

function createService() {
  const prisma = {
    payment: { findUnique: jest.fn(), findMany: jest.fn() },
    hostTransfer: { findUnique: jest.fn(), findMany: jest.fn() }
  };
  const payments = {
    reconcilePaymentProviderState: jest.fn(),
    reconcileHostTransferProviderState: jest.fn()
  };
  return {
    prisma,
    payments,
    service: new FinancialReconciliationService(
      prisma as unknown as PrismaService,
      payments as unknown as PaymentsService
    )
  };
}

describe("FinancialReconciliationService", () => {
  it("skips a terminal refunded payment without a provider call", async () => {
    const { service, prisma, payments } = createService();
    prisma.payment.findUnique.mockResolvedValue({
      id: "payment-1",
      status: PaymentStatus.refunded,
      providerPaymentIntentId: "pi_1",
      providerCheckoutSessionId: null
    });
    await expect(service.reconcilePayments({
      commandId: "command-1",
      targetId: "payment-1",
      limit: 1,
      staleBefore: new Date()
    })).resolves.toEqual({
      scanned: 1,
      succeeded: 0,
      skipped: 1,
      retryableFailures: 0,
      permanentFailures: 0,
      providerCalls: 0,
      lastFailureCategory: null
    });
    expect(payments.reconcilePaymentProviderState).not.toHaveBeenCalled();
  });

  it("selects only stale non-terminal payment candidates with a hard limit", async () => {
    const { service, prisma, payments } = createService();
    prisma.payment.findMany.mockResolvedValue([{
      id: "payment-1",
      status: PaymentStatus.pending,
      providerPaymentIntentId: "pi_1",
      providerCheckoutSessionId: null
    }]);
    payments.reconcilePaymentProviderState.mockResolvedValue({
      outcome: "reconciled",
      providerCalls: 1
    });
    const staleBefore = new Date("2026-07-19T11:00:00.000Z");
    await expect(service.reconcilePayments({
      commandId: "command-1",
      targetId: null,
      limit: 500,
      staleBefore
    })).resolves.toMatchObject({ scanned: 1, succeeded: 1, providerCalls: 1 });
    expect(prisma.payment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { in: expect.not.arrayContaining([PaymentStatus.refunded]) },
        updatedAt: { lte: staleBefore }
      }),
      take: 25
    }));
  });

  it("does not call the provider for an explicitly requested fresh record", async () => {
    const { service, prisma, payments } = createService();
    prisma.payment.findUnique.mockResolvedValue({
      id: "payment-fresh",
      status: PaymentStatus.pending,
      providerPaymentIntentId: "pi_fresh",
      providerCheckoutSessionId: null,
      updatedAt: new Date("2026-07-19T12:00:00.000Z")
    });
    await expect(
      service.reconcilePayments({
        commandId: "command-1",
        targetId: "payment-fresh",
        limit: 1,
        staleBefore: new Date("2026-07-19T11:00:00.000Z")
      })
    ).resolves.toMatchObject({ scanned: 1, skipped: 1, providerCalls: 0 });
    expect(payments.reconcilePaymentProviderState).not.toHaveBeenCalled();
  });

  it("classifies retryable and permanent provider failures without raw errors", async () => {
    const { service, prisma, payments } = createService();
    prisma.payment.findMany.mockResolvedValue([
      {
        id: "payment-1",
        status: PaymentStatus.pending,
        providerPaymentIntentId: "pi_1",
        providerCheckoutSessionId: null
      },
      {
        id: "payment-2",
        status: PaymentStatus.paid,
        providerPaymentIntentId: "pi_2",
        providerCheckoutSessionId: null
      }
    ]);
    payments.reconcilePaymentProviderState
      .mockRejectedValueOnce(new OperationalError(
        "stripe_rate_limited",
        "Stripe reconciliation is temporarily unavailable.",
        true
      ))
      .mockRejectedValueOnce(new OperationalError(
        "stripe_resource_missing",
        "The configured Stripe object was not found.",
        false
      ));
    await expect(service.reconcilePayments({
      commandId: "command-1",
      targetId: null,
      limit: 2,
      staleBefore: new Date()
    })).resolves.toMatchObject({
      retryableFailures: 1,
      permanentFailures: 1,
      lastFailureCategory: "stripe_resource_missing"
    });
  });

  it("skips terminal transfer reversal state and reconciles eligible transfer state", async () => {
    const { service, prisma, payments } = createService();
    prisma.hostTransfer.findMany.mockResolvedValue([
      {
        id: "transfer-terminal",
        status: HostTransferStatus.transferred,
        reversalStatus: HostTransferReversalStatus.reversed
      },
      {
        id: "transfer-stale",
        status: HostTransferStatus.failed,
        reversalStatus: HostTransferReversalStatus.failed
      }
    ]);
    payments.reconcileHostTransferProviderState.mockResolvedValue({
      outcome: "reconciled",
      providerCalls: 1
    });
    await expect(service.reconcileHostTransfers({
      commandId: "command-1",
      targetId: null,
      limit: 10,
      staleBefore: new Date()
    })).resolves.toMatchObject({ scanned: 2, succeeded: 1, skipped: 1 });
  });
});
