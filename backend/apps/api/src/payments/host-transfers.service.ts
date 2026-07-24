import {
  ConflictException,
  Injectable,
  UnprocessableEntityException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  BookingStatus,
  HostTransferReversalStatus,
  HostTransferStatus,
  PaymentStatus,
  Prisma
} from "@prisma/client";
import { EmailService } from "../email/email.service";
import { IdentityEligibilityService } from "../identity/identity-eligibility.service";
import { PrismaService } from "../prisma/prisma.service";
import { ConnectService } from "./connect.service";
import { StripeService } from "./stripe.service";

const transferInclude = {
  booking: {
    include: {
      cancellationOperations: { where: { active: true }, take: 1 }
    }
  },
  payment: true,
  connectedAccount: true
} satisfies Prisma.HostTransferInclude;

@Injectable()
export class HostTransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    private readonly connectService: ConnectService,
    private readonly emailService: EmailService,
    private readonly config: ConfigService,
    private readonly identityEligibility: IdentityEligibilityService
  ) {}

  async releaseEligibleHostTransfers(limit = 100) {
    this.connectService.marketplaceConfiguration();
    const boundedLimit = Math.min(Math.max(limit, 1), 500);
    const reversals = await this.recoverTransferReversals(boundedLimit);
    const candidates = await this.prisma.hostTransfer.findMany({
      where: {
        status: {
          in: [
            HostTransferStatus.pending,
            HostTransferStatus.processing,
            HostTransferStatus.failed
          ]
        },
        eligibleAt: { lte: new Date() },
        providerTransferId: null
      },
      orderBy: { eligibleAt: "asc" },
      select: { id: true },
      take: boundedLimit
    });
    let transferred = 0;
    let ineligible = 0;
    let failed = 0;

    for (const candidate of candidates) {
      try {
        await this.releaseOne(candidate.id);
        transferred += 1;
      } catch (error) {
        const code = this.errorCode(error);
        if (
          code === "TRANSFER_NOT_ELIGIBLE" ||
          code === "TRANSFER_ALREADY_RELEASED" ||
          code?.startsWith("IDENTITY_VERIFICATION_")
        ) {
          ineligible += 1;
        } else {
          failed += 1;
        }
      }
    }

    return {
      scanned: candidates.length,
      transferred,
      ineligible,
      failed,
      reversals
    };
  }

  async releaseOne(hostTransferId: string) {
    try {
      const candidate = await this.prisma.hostTransfer.findUnique({
        where: { id: hostTransferId },
        select: { hostId: true }
      });
      if (!candidate) {
        throw this.notEligible("Host transfer was not found.");
      }
      await this.identityEligibility.assertApproved(candidate.hostId);
      await this.connectService.synchronizeHostAccount(candidate.hostId);
      return await this.prisma.$transaction(async (transaction) => {
        await this.lockTransfer(transaction, hostTransferId);
        const record = await transaction.hostTransfer.findUnique({
          where: { id: hostTransferId },
          include: transferInclude
        });
        if (!record) {
          throw this.notEligible("Host transfer was not found.");
        }
        await transaction.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`identity-user:${record.hostId}`}, 0))`
        );
        await this.identityEligibility.assertApproved(record.hostId, transaction);
        if (
          record.status === HostTransferStatus.transferred ||
          record.providerTransferId
        ) {
          throw new ConflictException({
            code: "TRANSFER_ALREADY_RELEASED",
            message: "The Host transfer was already created.",
            details: {}
          });
        }
        this.assertEligible(record);

        await transaction.hostTransfer.update({
          where: { id: record.id },
          data: {
            status: HostTransferStatus.processing,
            failureCode: null,
            failureMessage: null
          }
        });
        const providerTransfer = await this.stripeService.createHostTransfer({
          amountCents: record.hostNetAmountCents,
          currency: record.currency,
          destination: record.providerConnectedAccountId,
          sourceChargeId: record.payment.providerChargeId!,
          transferGroup: record.transferGroup,
          bookingId: record.bookingId,
          hostTransferId: record.id,
          idempotencyKey: record.idempotencyKey
        });
        if (
          providerTransfer.amount !== record.hostNetAmountCents ||
          providerTransfer.currency.toUpperCase() !==
            record.currency.toUpperCase() ||
          !providerTransfer.destination ||
          this.providerId(providerTransfer.destination) !==
            record.providerConnectedAccountId
        ) {
          throw new Error("Stripe Transfer did not match the durable snapshot.");
        }

        return transaction.hostTransfer.update({
          where: { id: record.id },
          data: {
            status: HostTransferStatus.transferred,
            providerTransferId: providerTransfer.id,
            transferredAt: record.transferredAt ?? new Date(),
            failedAt: null,
            failureCode: null,
            failureMessage: null
          }
        });
      });
    } catch (error) {
      const code = this.errorCode(error);
      if (
        code !== "TRANSFER_NOT_ELIGIBLE" &&
        code !== "TRANSFER_ALREADY_RELEASED" &&
        !code?.startsWith("IDENTITY_VERIFICATION_")
      ) {
        await this.recordTransferFailure(hostTransferId, error);
      }
      throw error;
    }
  }

  async recoverTransferReversals(limit = 100) {
    const candidates = await this.prisma.hostTransfer.findMany({
      where: {
        reversalStatus: {
          in: [
            HostTransferReversalStatus.pending,
            HostTransferReversalStatus.processing,
            HostTransferReversalStatus.failed
          ]
        },
        providerTransferId: { not: null },
        reversalTargetAmountCents: { gt: 0 }
      },
      orderBy: { updatedAt: "asc" },
      select: { id: true },
      take: Math.min(Math.max(limit, 1), 500)
    });
    let reversed = 0;
    let failed = 0;
    for (const candidate of candidates) {
      try {
        await this.reverseOne(candidate.id);
        reversed += 1;
      } catch {
        failed += 1;
      }
    }
    return { scanned: candidates.length, reversed, failed };
  }

  async reverseOne(hostTransferId: string) {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await this.lockTransfer(transaction, hostTransferId);
        const record = await transaction.hostTransfer.findUnique({
          where: { id: hostTransferId }
        });
        if (
          !record?.providerTransferId ||
          record.reversalTargetAmountCents <= record.reversedAmountCents
        ) {
          throw this.notEligible("No Host transfer reversal is pending.");
        }
        const amount =
          record.reversalTargetAmountCents - record.reversedAmountCents;
        const idempotencyKey = `host-transfer-reversal:${record.id}:${record.reversalTargetAmountCents}`;
        await transaction.hostTransfer.update({
          where: { id: record.id },
          data: {
            reversalStatus: HostTransferReversalStatus.processing,
            reversalIdempotencyKey: idempotencyKey,
            reversalFailureCode: null,
            reversalFailureMessage: null
          }
        });
        const reversal = await this.stripeService.createHostTransferReversal({
          transferId: record.providerTransferId,
          amountCents: amount,
          bookingId: record.bookingId,
          hostTransferId: record.id,
          idempotencyKey
        });
        if (
          reversal.amount !== amount ||
          this.providerId(reversal.transfer) !== record.providerTransferId
        ) {
          throw new Error("Stripe Transfer Reversal did not match the durable target.");
        }
        const reversedAmountCents = record.reversedAmountCents + amount;
        const ids = this.providerIds(record.reversalProviderIds);
        if (!ids.includes(reversal.id)) ids.push(reversal.id);

        return transaction.hostTransfer.update({
          where: { id: record.id },
          data: {
            reversedAmountCents,
            reversalStatus:
              reversedAmountCents >= record.hostNetAmountCents
                ? HostTransferReversalStatus.reversed
                : HostTransferReversalStatus.partially_reversed,
            reversalProviderIds: ids,
            reversalFailedAt: null,
            reversalFailureCode: null,
            reversalFailureMessage: null
          }
        });
      });
    } catch (error) {
      if (this.errorCode(error) !== "TRANSFER_NOT_ELIGIBLE") {
        await this.recordReversalFailure(hostTransferId, error);
      }
      throw error;
    }
  }

  private assertEligible(record: Prisma.HostTransferGetPayload<{
    include: typeof transferInclude;
  }>) {
    if (
      (record.booking.status !== BookingStatus.paid &&
        record.booking.status !== BookingStatus.completed) ||
      record.booking.cancelledAt ||
      record.booking.cancellationOperations.length > 0 ||
      record.payment.status !== PaymentStatus.paid ||
      record.payment.amountRefundedCents !== 0 ||
      !record.payment.providerChargeId ||
      !record.connectedAccount.transfersReady ||
      record.eligibleAt > new Date()
    ) {
      throw this.notEligible("The Host transfer eligibility rules are not met.");
    }
  }

  private async recordTransferFailure(id: string, error: unknown) {
    await this.prisma.$transaction(async (transaction) => {
      await this.lockTransfer(transaction, id);
      const updated = await transaction.hostTransfer.updateMany({
        where: {
          id,
          providerTransferId: null,
          status: { not: HostTransferStatus.transferred }
        },
        data: {
          status: HostTransferStatus.failed,
          failedAt: new Date(),
          failureCode: "TRANSFER_FAILED",
          failureMessage: this.safeError(error)
        }
      });
      if (updated.count === 1) {
        await this.queueOperationsEmail(
          transaction,
          id,
          "host_transfer_failed_admin",
          "Host transfer requires retry",
          `Host transfer ${id} failed and remains recoverable.`,
          `host-transfer-failed:${id}`
        );
      }
    });
  }

  private async recordReversalFailure(id: string, error: unknown) {
    await this.prisma.$transaction(async (transaction) => {
      await this.lockTransfer(transaction, id);
      const updated = await transaction.hostTransfer.updateMany({
        where: {
          id,
          reversalTargetAmountCents: { gt: 0 },
          reversalStatus: { not: HostTransferReversalStatus.reversed }
        },
        data: {
          reversalStatus: HostTransferReversalStatus.failed,
          reversalFailedAt: new Date(),
          reversalFailureCode: "TRANSFER_FAILED",
          reversalFailureMessage: this.safeError(error)
        }
      });
      if (updated.count === 1) {
        await this.queueOperationsEmail(
          transaction,
          id,
          "host_transfer_reversal_failed_admin",
          "Host transfer reversal requires retry",
          `Host transfer reversal ${id} failed and remains recoverable.`,
          `host-transfer-reversal-failed:${id}`
        );
      }
    });
  }

  private queueOperationsEmail(
    transaction: Prisma.TransactionClient,
    id: string,
    template:
      | "host_transfer_failed_admin"
      | "host_transfer_reversal_failed_admin",
    subject: string,
    text: string,
    deduplicationKey: string
  ) {
    const to = this.config.get<string>("PAYMENTS_OPERATIONS_EMAIL");
    if (!to) return Promise.resolve();
    return this.emailService.queueTransactionalEmail(
      { to, template, subject, text, metadata: { hostTransferId: id } },
      {
        aggregateId: id,
        aggregateType: "host_transfer",
        client: transaction,
        deduplicationKey
      }
    );
  }

  private lockTransfer(transaction: Prisma.TransactionClient, id: string) {
    return transaction.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`host-transfer:${id}`}, 0))`
    );
  }

  private providerId(value: string | { id: string }) {
    return typeof value === "string" ? value : value.id;
  }

  private providerIds(value: Prisma.JsonValue) {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  }

  private errorCode(error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "getResponse" in error &&
      typeof error.getResponse === "function"
    ) {
      const response = error.getResponse();
      if (typeof response === "object" && response !== null && "code" in response) {
        return String(response.code);
      }
    }
    return null;
  }

  private safeError(error: unknown) {
    return error instanceof Error ? error.message.slice(0, 500) : "Unknown error";
  }

  private notEligible(message: string) {
    return new UnprocessableEntityException({
      code: "TRANSFER_NOT_ELIGIBLE",
      message,
      details: {}
    });
  }
}
