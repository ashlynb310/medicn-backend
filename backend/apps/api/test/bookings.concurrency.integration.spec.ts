import {
  AvailabilityStatus,
  ListingStatus,
  UserRole,
  type User
} from "@prisma/client";
import type { AuthService } from "../src/auth/auth.service";
import { BookingsService } from "../src/bookings/bookings.service";
import type { IdentityEligibilityService } from "../src/identity/identity-eligibility.service";
import type { EmailService } from "../src/email/email.service";
import { PaymentTransitionService } from "../src/payments/payment-transition.service";
import { PrismaService } from "../src/prisma/prisma.service";

const describeWithDatabase =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? describe : describe.skip;

describeWithDatabase("BookingsService PostgreSQL concurrency", () => {
  const suffix = `${Date.now()}`;
  let prisma: PrismaService;
  let prismaInitialized = false;
  let listingId = "";
  let renter: User;
  let service: BookingsService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    prismaInitialized = true;
    const host = await prisma.user.create({
      data: {
        supabaseUserId: `integration-host-${suffix}`,
        email: `integration-host-${suffix}@example.com`,
        emailVerifiedAt: new Date(),
        roles: [UserRole.host]
      }
    });
    renter = await prisma.user.create({
      data: {
        supabaseUserId: `integration-renter-${suffix}`,
        email: `integration-renter-${suffix}@example.com`,
        emailVerifiedAt: new Date(),
        roles: [UserRole.renter]
      }
    });
    const listing = await prisma.listing.create({
      data: {
        hostId: host.id,
        title: "Concurrency test listing",
        description: "Database advisory-lock test fixture.",
        city: "Houston",
        address: "100 Main St, Houston, TX 77002",
        latitude: 29.75,
        longitude: -95.37,
        publicLatitude: 29.753,
        publicLongitude: -95.37,
        priceCents: 10_000,
        priceUnit: "day",
        listingType: "private_room",
        status: ListingStatus.approved,
        location: {
          create: {
            inputAddress: "100 Main St, Houston, TX 77002",
            addressFingerprint: `integration-${suffix}`,
            verifiedFingerprint: `integration-${suffix}`,
            formattedAddress: "100 Main St, Houston, TX 77002",
            providerPlaceId: `integration-place-${suffix}`,
            exactLatitude: 29.75,
            exactLongitude: -95.37,
            geocodeStatus: "verified",
            precision: "rooftop",
            provider: "integration-test",
            addressVersion: 1,
            verifiedAddressVersion: 1,
            geocodedAt: new Date(),
            enrichmentStatus: "not_started"
          }
        },
        availability: {
          create: {
            startDate: new Date("2026-08-01T00:00:00.000Z"),
            endDate: new Date("2026-08-31T00:00:00.000Z"),
            status: AvailabilityStatus.available
          }
        }
      }
    });
    listingId = listing.id;

    const authService = {
      getCurrentUserRecord: jest.fn().mockResolvedValue(renter)
    };
    const emailService = {
      queueTransactionalEmail: jest.fn(
        (payload, options) =>
          options.client.outboxEvent.create({
            data: {
              eventType: "send_transactional_email",
              aggregateType: options.aggregateType,
              aggregateId: options.aggregateId,
              payload,
              idempotencyKey: options.deduplicationKey
            }
          })
      )
    };
    service = new BookingsService(
      prisma,
      authService as unknown as AuthService,
      emailService as unknown as EmailService,
      new PaymentTransitionService(),
      { assertApproved: jest.fn() } as unknown as IdentityEligibilityService
    );
  });

  afterAll(async () => {
    if (prismaInitialized && listingId) {
      const bookings = await prisma.booking.findMany({
        where: { listingId },
        select: { id: true }
      });
      await prisma.outboxEvent.deleteMany({
        where: { aggregateId: { in: bookings.map((booking) => booking.id) } }
      });
      await prisma.booking.deleteMany({ where: { listingId } });
      await prisma.listingAvailability.deleteMany({ where: { listingId } });
      await prisma.listingLocation.deleteMany({ where: { listingId } });
      await prisma.listing.deleteMany({ where: { id: listingId } });
      await prisma.user.deleteMany({
        where: { supabaseUserId: { endsWith: suffix } }
      });
    }
    if (prismaInitialized) {
      await prisma.$disconnect();
    }
  });

  it("allows one overlapping request and rolls back the loser's outbox email", async () => {
    const requests = await Promise.allSettled([
      service.createBooking("renter-token", {
        listingId,
        startDate: "2026-08-10",
        endDate: "2026-08-13",
        selectedOption: "daily_short_term"
      }),
      service.createBooking("renter-token", {
        listingId,
        startDate: "2026-08-11",
        endDate: "2026-08-14",
        selectedOption: "daily_short_term"
      })
    ]);

    const fulfilled = requests.filter((result) => result.status === "fulfilled");
    const rejected = requests.filter((result) => result.status === "rejected");

    if (fulfilled.length !== 1) {
      const reasons = rejected.map((result) =>
        result.status === "rejected" && result.reason instanceof Error
          ? `${result.reason.name}: ${result.reason.message}`
          : String(result.status === "rejected" ? result.reason : "fulfilled")
      );
      throw new Error(
        `Expected exactly one booking request to succeed. Rejections: ${reasons.join(" | ")}`
      );
    }

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const bookings = await prisma.booking.findMany({ where: { listingId } });
    expect(bookings).toHaveLength(1);
    await expect(
      prisma.outboxEvent.count({
        where: { aggregateId: bookings[0]?.id }
      })
    ).resolves.toBe(1);
  });
});
