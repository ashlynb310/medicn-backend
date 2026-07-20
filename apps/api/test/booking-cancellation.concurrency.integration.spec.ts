import {
  BookingStatus,
  CancellationFinancialDisposition,
  CancellationOperationStatus,
  HostTransferReversalStatus,
  HostTransferStatus,
  ListingStatus,
  PaymentStatus,
  UserRole,
  type User
} from "@prisma/client";
import type { AuthService } from "../src/auth/auth.service";
import { BookingsService } from "../src/bookings/bookings.service";
import type { EmailService } from "../src/email/email.service";
import type { IdentityEligibilityService } from "../src/identity/identity-eligibility.service";
import { JobsService } from "../src/jobs/jobs.service";
import { BookingCancellationsService } from "../src/payments/booking-cancellations.service";
import { PaymentTransitionService } from "../src/payments/payment-transition.service";
import type { StripeService } from "../src/payments/stripe.service";
import { PrismaService } from "../src/prisma/prisma.service";

const describeWithDatabase =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? describe : describe.skip;

describeWithDatabase("booking cancellation PostgreSQL correctness", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const bookingIds: string[] = [];
  const listingIds: string[] = [];
  let prisma: PrismaService;
  let renter: User;
  let host: User;
  let admin: User;
  let service: BookingCancellationsService;
  let bookingsService: BookingsService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    [renter, host, admin] = await Promise.all([
      prisma.user.create({
        data: {
          supabaseUserId: `cancel-renter-${suffix}`,
          email: `cancel-renter-${suffix}@example.com`,
          emailVerifiedAt: new Date(),
          roles: [UserRole.renter]
        }
      }),
      prisma.user.create({
        data: {
          supabaseUserId: `cancel-host-${suffix}`,
          email: `cancel-host-${suffix}@example.com`,
          emailVerifiedAt: new Date(),
          roles: [UserRole.host]
        }
      }),
      prisma.user.create({
        data: {
          supabaseUserId: `cancel-admin-${suffix}`,
          email: `cancel-admin-${suffix}@example.com`,
          emailVerifiedAt: new Date(),
          roles: [UserRole.admin]
        }
      })
    ]);
    const auth = {
      getCurrentUserRecord: jest.fn(async (token: string) => {
        if (token === "host-token") return host;
        if (token === "admin-token") return admin;
        return renter;
      })
    };
    service = new BookingCancellationsService(
      prisma,
      auth as unknown as AuthService,
      new JobsService(prisma),
      {
        expireCheckoutSession: jest.fn(),
        createFullRefund: jest.fn()
      } as unknown as StripeService
    );
    bookingsService = new BookingsService(
      prisma,
      auth as unknown as AuthService,
      {
        queueTransactionalEmail: jest.fn().mockResolvedValue(undefined)
      } as unknown as EmailService,
      new PaymentTransitionService(),
      {} as IdentityEligibilityService
    );
  });

  afterAll(async () => {
    const operations = await prisma.bookingCancellationOperation.findMany({
      where: { bookingId: { in: bookingIds } },
      select: { id: true }
    });
    const operationIds = operations.map(({ id }) => id);
    await prisma.outboxEvent.deleteMany({
      where: {
        OR: [
          { aggregateType: "booking_cancellation", aggregateId: { in: operationIds } },
          { aggregateType: "booking", aggregateId: { in: bookingIds } }
        ]
      }
    });
    await prisma.bookingCancellationOperation.deleteMany({
      where: { bookingId: { in: bookingIds } }
    });
    await prisma.hostTransfer.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.payment.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.bookingLocationSnapshot.deleteMany({
      where: { bookingId: { in: bookingIds } }
    });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.listing.deleteMany({ where: { id: { in: listingIds } } });
    await prisma.connectedAccount.deleteMany({ where: { userId: host.id } });
    await prisma.user.deleteMany({ where: { id: { in: [renter.id, host.id, admin.id] } } });
    await prisma.$disconnect();
  });

  async function createBooking(
    status: BookingStatus,
    payment?: { status: PaymentStatus; refunded?: number }
  ) {
    const listing = await prisma.listing.create({
      data: {
        hostId: host.id,
        title: `Cancellation fixture ${bookingIds.length + 1}`,
        description: "Cancellation integration fixture.",
        city: "Houston",
        address: "100 Main St, Houston, TX 77002",
        priceCents: 8_000,
        priceUnit: "day",
        listingType: "private_room",
        status: ListingStatus.approved
      }
    });
    listingIds.push(listing.id);
    const booking = await prisma.booking.create({
      data: {
        listingId: listing.id,
        renterId: renter.id,
        hostId: host.id,
        startDate: new Date(Date.now() + 14 * 86_400_000),
        endDate: new Date(Date.now() + 16 * 86_400_000),
        selectedOption: "daily_short_term",
        status,
        totalAmountCents: 16_000,
        currency: "USD",
        ...(payment
          ? {
              payments: {
                create: {
                  attemptNumber: 1,
                  amountCents: 16_000,
                  amountRefundedCents: payment.refunded ?? 0,
                  currency: "USD",
                  status: payment.status,
                  active: payment.status === PaymentStatus.pending,
                  providerCheckoutSessionId: `cs_${suffix}_${bookingIds.length}`,
                  providerPaymentIntentId:
                    payment.status === PaymentStatus.pending
                      ? null
                      : `pi_${suffix}_${bookingIds.length}`
                }
              }
            }
          : {})
      },
      include: { payments: true }
    });
    bookingIds.push(booking.id);
    return booking;
  }

  it("deduplicates concurrent immediate cancellation requests in PostgreSQL", async () => {
    const booking = await createBooking(BookingStatus.requested);
    const results = await Promise.all([
      service.cancelBooking("renter-token", booking.id, "same-key", {
        reason: "plans_changed"
      }),
      service.cancelBooking("renter-token", booking.id, "same-key", {
        reason: "plans_changed"
      })
    ]);

    expect(results[0].cancellation.id).toBe(results[1].cancellation.id);
    await expect(
      prisma.bookingCancellationOperation.count({ where: { bookingId: booking.id } })
    ).resolves.toBe(1);
    await expect(prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }))
      .resolves.toMatchObject({ status: BookingStatus.cancelled });
  });

  it("serializes Host acceptance against Renter cancellation without reviving the booking", async () => {
    const booking = await createBooking(BookingStatus.requested);
    const results = await Promise.allSettled([
      bookingsService.decideBooking("host-token", booking.id, {
        status: "accepted"
      }),
      service.cancelBooking("renter-token", booking.id, "accept-cancel-race", {
        reason: "plans_changed"
      })
    ]);

    expect(results[1]).toMatchObject({ status: "fulfilled" });
    await expect(prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }))
      .resolves.toMatchObject({ status: BookingStatus.cancelled });
    await expect(
      prisma.bookingCancellationOperation.count({ where: { bookingId: booking.id } })
    ).resolves.toBe(1);
  });

  it("keeps inventory blocked when unsettled cancellation races into payment settlement, then completes only after refund confirmation", async () => {
    const booking = await createBooking(BookingStatus.payment_pending, {
      status: PaymentStatus.pending
    });
    const payment = booking.payments[0]!;
    const requested = await service.cancelBooking(
      "renter-token",
      booking.id,
      "pending-key",
      { reason: "booking_no_longer_needed" }
    );
    expect(requested).toMatchObject({
      bookingStatus: BookingStatus.payment_pending,
      cancellation: {
        status: CancellationOperationStatus.checkout_expiry_pending,
        financialDisposition: CancellationFinancialDisposition.checkout_expiry_pending
      }
    });

    await prisma.$transaction(async (transaction) => {
      await transaction.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.paid,
          active: false,
          providerPaymentIntentId: `pi_settled_${suffix}`,
          paidAt: new Date()
        }
      });
      await service.reconcilePaymentSettled(transaction, booking.id, payment.id);
    });

    await expect(prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }))
      .resolves.toMatchObject({ status: BookingStatus.payment_pending, cancelledAt: null });
    await expect(
      prisma.bookingCancellationOperation.findFirstOrThrow({
        where: { bookingId: booking.id },
        orderBy: { version: "desc" }
      })
    ).resolves.toMatchObject({
      status: CancellationOperationStatus.refund_pending,
      financialDisposition: CancellationFinancialDisposition.full_refund_pending,
      active: true,
      effectiveAt: null
    });

    const confirmedAt = new Date();
    await prisma.$transaction(async (transaction) => {
      await transaction.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.refunded,
          amountRefundedCents: 16_000,
          refundedAt: confirmedAt
        }
      });
      await transaction.booking.update({
        where: { id: booking.id },
        data: {
          status: BookingStatus.cancelled,
          cancellationReason: "renter_cancelled",
          cancelledAt: confirmedAt
        }
      });
      await service.reconcileCancellationEffective(transaction, {
        bookingId: booking.id,
        paymentId: payment.id,
        reason: "full_refund",
        effectiveAt: confirmedAt
      });
    });
    await expect(
      prisma.bookingCancellationOperation.findFirstOrThrow({
        where: { bookingId: booking.id },
        orderBy: { version: "desc" }
      })
    ).resolves.toMatchObject({
      status: CancellationOperationStatus.completed,
      financialDisposition: CancellationFinancialDisposition.financially_complete,
      active: false,
      effectiveAt: confirmedAt
    });

    const payloads = await prisma.outboxEvent.findMany({
      where: { aggregateType: "booking_cancellation" },
      select: { aggregateId: true, payload: true }
    });
    const relevant = payloads.filter(({ aggregateId }) =>
      aggregateId === requested.cancellation.id
    );
    expect(relevant.length).toBeGreaterThan(0);
    for (const event of relevant) {
      expect(JSON.stringify(event.payload)).not.toMatch(
        /@|100 Main|providerPaymentIntent|amountCents|refundAmount/
      );
    }
  });

  it("blocks paid Renter self-service and leaves paid Host cancellation pending refund confirmation", async () => {
    const booking = await createBooking(BookingStatus.paid, {
      status: PaymentStatus.paid
    });

    await expect(
      service.cancelBooking("renter-token", booking.id, "renter-paid", {
        reason: "plans_changed"
      })
    ).rejects.toMatchObject({
      response: { code: "PAID_CANCELLATION_POLICY_UNAVAILABLE", details: {} }
    });
    const hostResult = await service.cancelBooking(
      "host-token",
      booking.id,
      "host-paid",
      { reason: "property_unavailable" }
    );
    expect(hostResult).toMatchObject({
      bookingStatus: BookingStatus.paid,
      cancellation: {
        status: CancellationOperationStatus.refund_pending,
        financialDisposition: CancellationFinancialDisposition.full_refund_pending,
        effectiveAt: null
      }
    });
    await expect(prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }))
      .resolves.toMatchObject({ status: BookingStatus.paid, cancelledAt: null });
  });

  it("keeps financial completion pending until a transferred Host amount is fully reversed", async () => {
    const booking = await createBooking(BookingStatus.paid, {
      status: PaymentStatus.paid
    });
    const payment = booking.payments[0]!;
    const account = await prisma.connectedAccount.upsert({
      where: { userId: host.id },
      create: {
        userId: host.id,
        providerAccountId: `acct_cancel_${suffix}`,
        detailsSubmitted: true,
        transfersCapability: "active",
        transfersReady: true,
        lastSynchronizedAt: new Date()
      },
      update: {}
    });
    const transfer = await prisma.hostTransfer.create({
      data: {
        bookingId: booking.id,
        paymentId: payment.id,
        hostId: host.id,
        connectedAccountId: account.id,
        providerConnectedAccountId: account.providerAccountId,
        grossAmountCents: 16_000,
        platformFeeCents: 2_000,
        hostNetAmountCents: 14_000,
        currency: "USD",
        transferGroup: `cancel_transfer_${booking.id}`,
        status: HostTransferStatus.transferred,
        providerTransferId: `tr_cancel_${suffix}`,
        idempotencyKey: `host-transfer:${booking.id}:${payment.id}`,
        eligibleAt: new Date(Date.now() - 86_400_000),
        transferredAt: new Date()
      }
    });
    const requested = await service.cancelBooking(
      "host-token",
      booking.id,
      "host-transfer-cancel",
      { reason: "property_unavailable" }
    );
    const confirmedAt = new Date();
    await prisma.$transaction(async (transaction) => {
      await transaction.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.refunded,
          amountRefundedCents: 16_000,
          refundedAt: confirmedAt
        }
      });
      await transaction.booking.update({
        where: { id: booking.id },
        data: {
          status: BookingStatus.cancelled,
          cancellationReason: "host_cancelled",
          cancelledAt: confirmedAt
        }
      });
      await transaction.hostTransfer.update({
        where: { id: transfer.id },
        data: {
          reversalTargetAmountCents: 14_000,
          reversalStatus: HostTransferReversalStatus.pending
        }
      });
      await service.reconcileCancellationEffective(transaction, {
        bookingId: booking.id,
        paymentId: payment.id,
        reason: "full_refund",
        effectiveAt: confirmedAt
      });
    });
    await expect(
      prisma.bookingCancellationOperation.findUniqueOrThrow({
        where: { id: requested.cancellation.id }
      })
    ).resolves.toMatchObject({
      status: CancellationOperationStatus.transfer_reversal_pending,
      financialDisposition: CancellationFinancialDisposition.transfer_reversal_pending,
      active: true,
      effectiveAt: confirmedAt
    });

    await prisma.$transaction(async (transaction) => {
      await transaction.hostTransfer.update({
        where: { id: transfer.id },
        data: {
          reversedAmountCents: 14_000,
          reversalStatus: HostTransferReversalStatus.reversed
        }
      });
      await service.reconcileTransferReversal(transaction, booking.id, new Date());
    });
    await expect(
      prisma.bookingCancellationOperation.findUniqueOrThrow({
        where: { id: requested.cancellation.id }
      })
    ).resolves.toMatchObject({
      status: CancellationOperationStatus.completed,
      financialDisposition: CancellationFinancialDisposition.financially_complete,
      active: false
    });
  });

  it("enforces one active paid cancellation under concurrent Host/Admin requests", async () => {
    const booking = await createBooking(BookingStatus.paid, {
      status: PaymentStatus.paid
    });
    const results = await Promise.allSettled([
      service.cancelBooking("host-token", booking.id, "host-race", {
        reason: "property_unavailable"
      }),
      service.cancelBooking("admin-token", booking.id, "admin-race", {
        reason: "support_resolution"
      })
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
    const rejected = results.find(({ status }) => status === "rejected");
    expect(rejected).toMatchObject({
      reason: { response: { code: "CANCELLATION_ALREADY_IN_PROGRESS", details: {} } }
    });
    await expect(
      prisma.bookingCancellationOperation.count({
        where: { bookingId: booking.id, active: true }
      })
    ).resolves.toBe(1);
  });
});
