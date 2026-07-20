import { Injectable, NotFoundException } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class PaymentOperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService
  ) {}

  async getBookingPaymentSummary(
    token: string,
    bookingId: string
  ) {
    const user = await this.auth.getCurrentUserRecord(token);
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        renterId: true,
        hostId: true,
        status: true,
        totalAmountCents: true,
        currency: true,
        payments: {
          orderBy: { attemptNumber: "asc" },
          select: {
            id: true,
            attemptNumber: true,
            status: true,
            amountCents: true,
            amountRefundedCents: true,
            currency: true,
            active: true,
            expiresAt: true,
            paidAt: true,
            refundedAt: true,
            createdAt: true,
            updatedAt: true
          }
        },
        hostTransfer: {
          select: {
            status: true,
            reversalStatus: true,
            grossAmountCents: true,
            platformFeeCents: true,
            hostNetAmountCents: true,
            reversedAmountCents: true,
            reversalTargetAmountCents: true,
            currency: true,
            eligibleAt: true,
            transferredAt: true
          }
        }
      }
    });
    if (
      !booking ||
      (!user.roles.includes(UserRole.admin) &&
        booking.renterId !== user.id &&
        booking.hostId !== user.id)
    ) {
      throw this.notFound();
    }

    return {
      bookingId: booking.id,
      bookingStatus: booking.status,
      totalAmountCents: booking.totalAmountCents,
      currency: booking.currency,
      payments: booking.payments.map((payment) => ({
        id: payment.id,
        attemptNumber: payment.attemptNumber,
        status: payment.status,
        amountCents: payment.amountCents,
        amountRefundedCents: payment.amountRefundedCents,
        currency: payment.currency,
        active: payment.active,
        expiresAt: payment.expiresAt?.toISOString() ?? null,
        paidAt: payment.paidAt?.toISOString() ?? null,
        refundedAt: payment.refundedAt?.toISOString() ?? null,
        createdAt: payment.createdAt.toISOString(),
        updatedAt: payment.updatedAt.toISOString()
      })),
      transfer: booking.hostTransfer
        ? {
            status: booking.hostTransfer.status,
            reversalStatus: booking.hostTransfer.reversalStatus,
            grossAmountCents: booking.hostTransfer.grossAmountCents,
            platformFeeCents: booking.hostTransfer.platformFeeCents,
            hostNetAmountCents: booking.hostTransfer.hostNetAmountCents,
            reversedAmountCents: booking.hostTransfer.reversedAmountCents,
            reversalTargetAmountCents:
              booking.hostTransfer.reversalTargetAmountCents,
            currency: booking.hostTransfer.currency,
            eligibleAt: booking.hostTransfer.eligibleAt.toISOString(),
            transferredAt:
              booking.hostTransfer.transferredAt?.toISOString() ?? null,
            movement: "stripe_transfer_to_connected_balance" as const,
            representsBankPayout: false as const
          }
        : null
    };
  }

  private notFound() {
    return new NotFoundException({
      code: "NOT_FOUND",
      message: "The requested booking was not found.",
      details: {}
    });
  }
}
