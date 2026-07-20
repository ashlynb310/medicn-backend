import { NotFoundException } from "@nestjs/common";
import {
  BookingStatus,
  HostTransferReversalStatus,
  HostTransferStatus,
  PaymentStatus,
  UserRole
} from "@prisma/client";
import type { AuthService } from "../src/auth/auth.service";
import { PaymentOperationsService } from "../src/payments/payment-operations.service";
import type { PrismaService } from "../src/prisma/prisma.service";

const now = new Date("2026-07-19T12:00:00.000Z");

function createService(user: { id: string; roles: UserRole[] }) {
  const prisma = { booking: { findUnique: jest.fn() } };
  const auth = { getCurrentUserRecord: jest.fn().mockResolvedValue(user) };
  return {
    prisma,
    service: new PaymentOperationsService(
      prisma as unknown as PrismaService,
      auth as unknown as AuthService
    )
  };
}

const booking = {
  id: "booking-1",
  renterId: "renter-1",
  hostId: "host-1",
  status: BookingStatus.paid,
  totalAmountCents: 20_000,
  currency: "USD",
  payments: [{
    id: "payment-1",
    attemptNumber: 1,
    status: PaymentStatus.partially_refunded,
    amountCents: 20_000,
    amountRefundedCents: 2_000,
    currency: "USD",
    active: false,
    expiresAt: null,
    paidAt: now,
    refundedAt: null,
    createdAt: now,
    updatedAt: now,
    providerPaymentIntentId: "pi_private",
    failureReason: "private failure"
  }],
  hostTransfer: {
    status: HostTransferStatus.transferred,
    reversalStatus: HostTransferReversalStatus.partially_reversed,
    grossAmountCents: 20_000,
    platformFeeCents: 2_000,
    hostNetAmountCents: 18_000,
    reversedAmountCents: 1_800,
    reversalTargetAmountCents: 1_800,
    currency: "USD",
    eligibleAt: now,
    transferredAt: now,
    providerTransferId: "tr_private",
    providerConnectedAccountId: "acct_private",
    failureMessage: "private transfer failure"
  }
};

describe("PaymentOperationsService participant summary", () => {
  it.each([
    ["renter", { id: "renter-1", roles: [UserRole.renter] }],
    ["host", { id: "host-1", roles: [UserRole.host] }],
    ["admin", { id: "admin-1", roles: [UserRole.admin] }]
  ])("allows the booking %s", async (_label, user) => {
    const { service, prisma } = createService(user);
    prisma.booking.findUnique.mockResolvedValue(booking);
    const result = await service.getBookingPaymentSummary("token", booking.id);
    expect(result).toMatchObject({
      bookingId: booking.id,
      bookingStatus: BookingStatus.paid,
      payments: [{ status: PaymentStatus.partially_refunded }],
      transfer: {
        status: HostTransferStatus.transferred,
        representsBankPayout: false
      }
    });
    expect(JSON.stringify(result)).not.toMatch(
      /pi_private|tr_private|acct_private|private failure|providerConnected/
    );
  });

  it("returns opaque NOT_FOUND to an unrelated authenticated user", async () => {
    const { service, prisma } = createService({
      id: "other-1",
      roles: [UserRole.renter]
    });
    prisma.booking.findUnique.mockResolvedValue(booking);
    await expect(service.getBookingPaymentSummary("token", booking.id))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});
