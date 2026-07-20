import { Injectable } from "@nestjs/common";
import {
  HostTransferReversalStatus,
  HostTransferStatus,
  PaymentStatus
} from "@prisma/client";
import { classifyOperationalError } from "../jobs/operational-error";
import { PrismaService } from "../prisma/prisma.service";
import { PaymentsService } from "./payments.service";

const RECONCILABLE_PAYMENT_STATUSES: PaymentStatus[] = [
  PaymentStatus.pending,
  PaymentStatus.failed,
  PaymentStatus.expired,
  PaymentStatus.paid,
  PaymentStatus.partially_refunded,
  PaymentStatus.disputed
];

interface ReconciliationScope {
  commandId: string;
  targetId: string | null;
  limit: number;
  staleBefore: Date;
}

interface CandidateResult {
  outcome: "reconciled" | "skipped";
  providerCalls: number;
}

@Injectable()
export class FinancialReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService
  ) {}

  async reconcilePayments(scope: ReconciliationScope) {
    const candidates = scope.targetId
      ? [await this.prisma.payment.findUnique({
          where: { id: scope.targetId },
          select: {
            id: true,
            status: true,
            providerPaymentIntentId: true,
            providerCheckoutSessionId: true,
            updatedAt: true
          }
        })].filter((value): value is NonNullable<typeof value> => value !== null)
      : await this.prisma.payment.findMany({
          where: {
            status: {
              in: RECONCILABLE_PAYMENT_STATUSES
            },
            updatedAt: { lte: scope.staleBefore },
            OR: [
              { providerPaymentIntentId: { not: null } },
              { providerCheckoutSessionId: { not: null } }
            ]
          },
          select: {
            id: true,
            status: true,
            providerPaymentIntentId: true,
            providerCheckoutSessionId: true,
            updatedAt: true
          },
          orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
          take: this.limit(scope.limit)
        });

    return this.runCandidates(
      candidates,
      (candidate) =>
        RECONCILABLE_PAYMENT_STATUSES.includes(candidate.status) &&
        (!scope.targetId || candidate.updatedAt <= scope.staleBefore) &&
        Boolean(
          candidate.providerPaymentIntentId || candidate.providerCheckoutSessionId
        ),
      (candidate) =>
        this.payments.reconcilePaymentProviderState(candidate.id, scope.commandId)
    );
  }

  async reconcileHostTransfers(scope: ReconciliationScope) {
    const candidates = scope.targetId
      ? [await this.prisma.hostTransfer.findUnique({
          where: { id: scope.targetId },
          select: { id: true, status: true, reversalStatus: true, updatedAt: true }
        })].filter((value): value is NonNullable<typeof value> => value !== null)
      : await this.prisma.hostTransfer.findMany({
          where: {
            updatedAt: { lte: scope.staleBefore },
            OR: [
              {
                status: {
                  in: [
                    HostTransferStatus.pending,
                    HostTransferStatus.processing,
                    HostTransferStatus.failed
                  ]
                }
              },
              {
                reversalStatus: {
                  in: [
                    HostTransferReversalStatus.pending,
                    HostTransferReversalStatus.processing,
                    HostTransferReversalStatus.partially_reversed,
                    HostTransferReversalStatus.failed
                  ]
                }
              }
            ]
          },
          select: { id: true, status: true, reversalStatus: true, updatedAt: true },
          orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
          take: this.limit(scope.limit)
        });

    return this.runCandidates(
      candidates,
      (candidate) =>
        (!scope.targetId || candidate.updatedAt <= scope.staleBefore) &&
        !(
          candidate.status === HostTransferStatus.transferred &&
          candidate.reversalStatus === HostTransferReversalStatus.reversed
        ),
      (candidate) =>
        this.payments.reconcileHostTransferProviderState(
          candidate.id,
          scope.commandId
        )
    );
  }

  private async runCandidates<T>(
    candidates: T[],
    eligible: (candidate: T) => boolean,
    reconcile: (candidate: T) => Promise<CandidateResult>
  ) {
    let succeeded = 0;
    let skipped = 0;
    let retryableFailures = 0;
    let permanentFailures = 0;
    let providerCalls = 0;
    let lastFailureCategory: string | null = null;

    for (const candidate of candidates) {
      if (!eligible(candidate)) {
        skipped += 1;
        continue;
      }
      try {
        const result = await reconcile(candidate);
        providerCalls += result.providerCalls;
        if (result.outcome === "reconciled") succeeded += 1;
        else skipped += 1;
      } catch (error) {
        const classified = classifyOperationalError(error);
        lastFailureCategory = classified.category;
        if (classified.retryable) retryableFailures += 1;
        else permanentFailures += 1;
      }
    }

    return {
      scanned: candidates.length,
      succeeded,
      skipped,
      retryableFailures,
      permanentFailures,
      providerCalls,
      lastFailureCategory
    };
  }

  private limit(value: number) {
    return Math.min(Math.max(value, 1), 25);
  }
}
