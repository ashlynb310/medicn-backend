import type { ConfigService } from "@nestjs/config";
import {
  BookingStatus,
  ConnectCapabilityStatus,
  HostTransferStatus,
  ListingStatus,
  PaymentStatus,
  StripeAccountApiModel,
  UserRole
} from "@prisma/client";
import type { EmailService } from "../src/email/email.service";
import type { ConnectService } from "../src/payments/connect.service";
import { HostTransfersService } from "../src/payments/host-transfers.service";
import type { IdentityEligibilityService } from "../src/identity/identity-eligibility.service";
import type { StripeService } from "../src/payments/stripe.service";
import { PrismaService } from "../src/prisma/prisma.service";

const describeWithDatabase =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? describe : describe.skip;

describeWithDatabase("HostTransfersService PostgreSQL concurrency", () => {
  const suffix = `${Date.now()}`;
  let prisma: PrismaService;
  let initialized = false;
  let hostId = "";
  let renterId = "";
  let listingId = "";
  let bookingId = "";
  let paymentId = "";
  let connectedAccountId = "";
  let hostTransferId = "";
  let service: HostTransfersService;
  const createHostTransfer = jest.fn();

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is required when RUN_DATABASE_INTEGRATION_TESTS=true."
      );
    }
    prisma = new PrismaService();
    await prisma.$connect();
    initialized = true;

    const host = await prisma.user.create({
      data: {
        supabaseUserId: `transfer-host-${suffix}`,
        email: `transfer-host-${suffix}@example.com`,
        emailVerifiedAt: new Date(),
        roles: [UserRole.host]
      }
    });
    hostId = host.id;
    const renter = await prisma.user.create({
      data: {
        supabaseUserId: `transfer-renter-${suffix}`,
        email: `transfer-renter-${suffix}@example.com`,
        emailVerifiedAt: new Date(),
        roles: [UserRole.renter]
      }
    });
    renterId = renter.id;
    const connected = await prisma.connectedAccount.create({
      data: {
        userId: host.id,
        providerAccountId: `acct_integration_${suffix}`,
        apiModel: StripeAccountApiModel.accounts_v2_recipient,
        country: "US",
        currency: "USD",
        detailsSubmitted: true,
        transfersCapability: ConnectCapabilityStatus.active,
        transfersReady: true,
        payoutsEnabled: true,
        lastSynchronizedAt: new Date()
      }
    });
    connectedAccountId = connected.id;
    const listing = await prisma.listing.create({
      data: {
        hostId: host.id,
        title: "Host transfer concurrency fixture",
        description: "Advisory lock integration test.",
        city: "Houston",
        priceCents: 16_000,
        priceUnit: "day",
        listingType: "private_room",
        status: ListingStatus.approved
      }
    });
    listingId = listing.id;
    const booking = await prisma.booking.create({
      data: {
        listingId: listing.id,
        renterId: renter.id,
        hostId: host.id,
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        endDate: new Date("2026-07-03T00:00:00.000Z"),
        selectedOption: "daily_short_term",
        status: BookingStatus.paid,
        totalAmountCents: 16_000,
        currency: "USD"
      }
    });
    bookingId = booking.id;
    const payment = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        attemptNumber: 1,
        amountCents: 16_000,
        currency: "USD",
        status: PaymentStatus.paid,
        providerPaymentIntentId: `pi_integration_${suffix}`,
        providerChargeId: `ch_integration_${suffix}`,
        paidAt: new Date()
      }
    });
    paymentId = payment.id;
    const transfer = await prisma.hostTransfer.create({
      data: {
        bookingId: booking.id,
        paymentId: payment.id,
        hostId: host.id,
        connectedAccountId: connected.id,
        providerConnectedAccountId: connected.providerAccountId,
        grossAmountCents: 16_000,
        platformFeeCents: 2_000,
        hostNetAmountCents: 14_000,
        currency: "USD",
        transferGroup: `booking_${booking.id}`,
        idempotencyKey: `host-transfer:${booking.id}:${payment.id}`,
        eligibleAt: new Date("2026-07-02T00:00:00.000Z")
      }
    });
    hostTransferId = transfer.id;

    createHostTransfer.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return {
        id: `tr_integration_${suffix}`,
        amount: 14_000,
        currency: "usd",
        destination: connected.providerAccountId
      };
    });
    service = new HostTransfersService(
      prisma,
      {
        createHostTransfer,
        createHostTransferReversal: jest.fn()
      } as unknown as StripeService,
      {
        synchronizeHostAccount: jest.fn().mockResolvedValue(connected),
        marketplaceConfiguration: jest.fn().mockReturnValue({
          platformFeeBps: 1250,
          transferDelayHours: 24
        })
      } as unknown as ConnectService,
      { queueTransactionalEmail: jest.fn() } as unknown as EmailService,
      {
        get: jest.fn().mockReturnValue("payments@example.com")
      } as unknown as ConfigService,
      { assertApproved: jest.fn() } as unknown as IdentityEligibilityService
    );
  });

  afterAll(async () => {
    if (initialized) {
      if (hostTransferId) {
        await prisma.outboxEvent.deleteMany({
          where: { aggregateId: hostTransferId }
        });
        await prisma.hostTransfer.deleteMany({ where: { id: hostTransferId } });
      }
      if (paymentId) await prisma.payment.deleteMany({ where: { id: paymentId } });
      if (bookingId) await prisma.booking.deleteMany({ where: { id: bookingId } });
      if (listingId) await prisma.listing.deleteMany({ where: { id: listingId } });
      if (connectedAccountId) {
        await prisma.connectedAccount.deleteMany({
          where: { id: connectedAccountId }
        });
      }
      await prisma.user.deleteMany({
        where: { id: { in: [hostId, renterId].filter(Boolean) } }
      });
      await prisma.$disconnect();
    }
  });

  it("creates one provider transfer under concurrent release", async () => {
    const results = await Promise.allSettled([
      service.releaseOne(hostTransferId),
      service.releaseOne(hostTransferId)
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(createHostTransfer).toHaveBeenCalledTimes(1);
    await expect(
      prisma.hostTransfer.findUnique({ where: { id: hostTransferId } })
    ).resolves.toMatchObject({
      status: HostTransferStatus.transferred,
      providerTransferId: `tr_integration_${suffix}`
    });
  });
});
