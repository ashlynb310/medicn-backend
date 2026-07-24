import {
  AvailabilityStatus,
  BookingStatus,
  InquiryStatus,
  ListingStatus,
  PaymentStatus,
  UserRole,
  type User
} from "@prisma/client";
import type { AuthService } from "../src/auth/auth.service";
import { BookingsService } from "../src/bookings/bookings.service";
import type { EmailService } from "../src/email/email.service";
import type { IdentityEligibilityService } from "../src/identity/identity-eligibility.service";
import type { JobsService } from "../src/jobs/jobs.service";
import { ListingsService } from "../src/listings/listings.service";
import { MessagingRealtimeService } from "../src/messaging/messaging-realtime.service";
import { MessagingService } from "../src/messaging/messaging.service";
import { PaymentTransitionService } from "../src/payments/payment-transition.service";
import { PrismaService } from "../src/prisma/prisma.service";

const describeWithDatabase =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? describe : describe.skip;

describeWithDatabase("listing archive and location PostgreSQL correctness", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const listingIds: string[] = [];
  let prisma: PrismaService;
  let connected = false;
  let host: User;
  let renter: User;
  let listings: ListingsService;
  let bookings: BookingsService;
  let messaging: MessagingService;

  const dateFromNow = (days: number) =>
    new Date(Date.now() + days * 86_400_000);

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    connected = true;
    host = await prisma.user.create({
      data: {
        supabaseUserId: `archive-host-${suffix}`,
        email: `archive-host-${suffix}@example.com`,
        emailVerifiedAt: new Date(),
        roles: [UserRole.host]
      }
    });
    renter = await prisma.user.create({
      data: {
        supabaseUserId: `archive-renter-${suffix}`,
        email: `archive-renter-${suffix}@example.com`,
        emailVerifiedAt: new Date(),
        roles: [UserRole.renter]
      }
    });
    const auth = {
      getCurrentUserRecord: jest.fn(async (token: string) =>
        token === "host-token" ? host : renter
      )
    };
    listings = new ListingsService(
      prisma,
      auth as unknown as AuthService
    );
    bookings = new BookingsService(
      prisma,
      auth as unknown as AuthService,
      { queueTransactionalEmail: jest.fn() } as unknown as EmailService,
      new PaymentTransitionService(),
      { assertApproved: jest.fn() } as unknown as IdentityEligibilityService
    );
    messaging = new MessagingService(
      prisma,
      auth as unknown as AuthService,
      {} as JobsService,
      new MessagingRealtimeService()
    );
  });

  afterAll(async () => {
    if (connected) {
      const inquiries = await prisma.inquiry.findMany({
        where: { listingId: { in: listingIds } },
        select: { id: true }
      });
      const inquiryIds = inquiries.map(({ id }) => id);
      await prisma.outboxEvent.deleteMany({
        where: { aggregateId: { in: inquiryIds } }
      });
      await prisma.message.deleteMany({ where: { inquiryId: { in: inquiryIds } } });
      await prisma.inquiryParticipantState.deleteMany({
        where: { inquiryId: { in: inquiryIds } }
      });
      await prisma.inquiry.deleteMany({ where: { id: { in: inquiryIds } } });
      const storedBookings = await prisma.booking.findMany({
        where: { listingId: { in: listingIds } },
        select: { id: true }
      });
      const bookingIds = storedBookings.map(({ id }) => id);
      await prisma.outboxEvent.deleteMany({
        where: { aggregateId: { in: bookingIds } }
      });
      await prisma.payment.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await prisma.bookingLocationSnapshot.deleteMany({
        where: { bookingId: { in: bookingIds } }
      });
      await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
      await prisma.listingAvailability.deleteMany({
        where: { listingId: { in: listingIds } }
      });
      await prisma.listingLocation.deleteMany({
        where: { listingId: { in: listingIds } }
      });
      await prisma.listing.deleteMany({ where: { id: { in: listingIds } } });
      await prisma.user.deleteMany({ where: { id: { in: [host.id, renter.id] } } });
      await prisma.$disconnect();
    }
  });

  async function createListing(label: string) {
    const start = dateFromNow(2);
    const end = dateFromNow(30);
    const listing = await prisma.listing.create({
      data: {
        hostId: host.id,
        title: `Archive ${label}`,
        description: "Archive correctness integration fixture.",
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
            addressFingerprint: `archive-${label}-${suffix}`,
            verifiedFingerprint: `archive-${label}-${suffix}`,
            formattedAddress: "100 Main St, Houston, TX 77002",
            providerPlaceId: `archive-place-${label}-${suffix}`,
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
          create: { startDate: start, endDate: end, status: AvailabilityStatus.available }
        }
      }
    });
    listingIds.push(listing.id);
    return { listing, start, end };
  }

  it("serializes booking creation and archive so exactly one compatible result commits", async () => {
    const { listing, start, end } = await createListing("race");
    const results = await Promise.allSettled([
      bookings.createBooking("renter-token", {
        listingId: listing.id,
        startDate: dateFromNow(5).toISOString().slice(0, 10),
        endDate: dateFromNow(7).toISOString().slice(0, 10),
        selectedOption: "daily_short_term"
      }),
      listings.deleteListing("host-token", listing.id)
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
    const storedListing = await prisma.listing.findUniqueOrThrow({
      where: { id: listing.id },
      select: { status: true, deletedAt: true }
    });
    const bookingCount = await prisma.booking.count({ where: { listingId: listing.id } });
    if (bookingCount === 1) {
      expect(storedListing).toEqual({ status: ListingStatus.approved, deletedAt: null });
    } else {
      expect(bookingCount).toBe(0);
      expect(storedListing.status).toBe(ListingStatus.archived);
      expect(storedListing.deletedAt).toBeInstanceOf(Date);
    }
    expect(start).toBeInstanceOf(Date);
    expect(end).toBeInstanceOf(Date);
  });

  it("archives without deleting history and blocks later public, booking, and inquiry creation", async () => {
    const { listing } = await createListing("history");
    const booking = await prisma.booking.create({
      data: {
        listingId: listing.id,
        renterId: renter.id,
        hostId: host.id,
        startDate: dateFromNow(-10),
        endDate: dateFromNow(-5),
        selectedOption: "daily_short_term",
        status: BookingStatus.completed,
        completedAt: new Date(),
        completionSource: "legacy_backfill",
        totalAmountCents: 20_000,
        currency: "USD",
        payments: {
          create: {
            attemptNumber: 1,
            amountCents: 20_000,
            amountRefundedCents: 2_000,
            currency: "USD",
            status: PaymentStatus.partially_refunded
          }
        },
        locationSnapshot: {
          create: {
            formattedAddress: "100 Main St, Houston, TX 77002",
            exactLatitude: 29.75,
            exactLongitude: -95.37,
            sourceListingLocationVersion: 1
          }
        }
      }
    });
    const inquiry = await prisma.inquiry.create({
      data: {
        listingId: listing.id,
        renterId: renter.id,
        hostId: host.id,
        status: InquiryStatus.open,
        lastSequence: 1,
        lastMessageAt: new Date(),
        participantStates: {
          create: [
            { userId: renter.id, role: UserRole.renter, lastReadSequence: 1 },
            { userId: host.id, role: UserRole.host }
          ]
        },
        messages: {
          create: {
            sequence: 1,
            senderId: renter.id,
            senderRole: UserRole.renter,
            body: "Is this listing available?"
          }
        }
      }
    });

    await listings.deleteListing("host-token", listing.id);

    await expect(prisma.listing.count({ where: { id: listing.id } })).resolves.toBe(1);
    await expect(prisma.booking.count({ where: { id: booking.id } })).resolves.toBe(1);
    await expect(prisma.payment.count({ where: { bookingId: booking.id } })).resolves.toBe(1);
    await expect(
      prisma.bookingLocationSnapshot.count({ where: { bookingId: booking.id } })
    ).resolves.toBe(1);
    await expect(prisma.inquiry.count({ where: { id: inquiry.id } })).resolves.toBe(1);
    await expect(prisma.message.count({ where: { inquiryId: inquiry.id } })).resolves.toBe(1);

    await expect(listings.getListing(listing.id)).rejects.toMatchObject({
      response: { code: "NOT_FOUND" }
    });
    const search = await listings.searchListings({ page: 1, limit: 20 });
    expect(search.data.map(({ id }) => id)).not.toContain(listing.id);
    await expect(bookings.getBooking("renter-token", booking.id)).resolves.toMatchObject({
      checkInLocation: { address: "100 Main St, Houston, TX 77002" }
    });
    await expect(
      messaging.getInquiry("renter-token", inquiry.id, { afterSequence: 0, limit: 50 })
    ).resolves.toMatchObject({ inquiry: { id: inquiry.id } });
    await expect(
      bookings.createBooking("renter-token", {
        listingId: listing.id,
        startDate: dateFromNow(6).toISOString().slice(0, 10),
        endDate: dateFromNow(8).toISOString().slice(0, 10),
        selectedOption: "daily_short_term"
      })
    ).rejects.toMatchObject({ response: { code: "NOT_FOUND" } });
    await expect(
      messaging.createInquiry("renter-token", listing.id, { message: "New inquiry" })
    ).rejects.toMatchObject({ response: { code: "INQUIRY_NOT_AVAILABLE", details: {} } });
  });

  it("returns only a consistent before-or-after result during atomic refund cancellation", async () => {
    const { listing } = await createListing("location-race");
    const booking = await prisma.booking.create({
      data: {
        listingId: listing.id,
        renterId: renter.id,
        hostId: host.id,
        startDate: dateFromNow(3),
        endDate: dateFromNow(6),
        selectedOption: "daily_short_term",
        status: BookingStatus.paid,
        totalAmountCents: 20_000,
        currency: "USD",
        payments: {
          create: {
            attemptNumber: 1,
            amountCents: 20_000,
            amountRefundedCents: 2_000,
            currency: "USD",
            status: PaymentStatus.partially_refunded
          }
        },
        locationSnapshot: {
          create: {
            formattedAddress: "100 Main St, Houston, TX 77002",
            exactLatitude: 29.75,
            exactLongitude: -95.37,
            sourceListingLocationVersion: 1
          }
        }
      },
      include: { payments: true }
    });
    const payment = booking.payments[0]!;

    const [read] = await Promise.all([
      bookings.getBooking("renter-token", booking.id),
      prisma.$transaction(async (transaction) => {
        await transaction.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.refunded,
            amountRefundedCents: payment.amountCents,
            refundedAt: new Date()
          }
        });
        await transaction.booking.update({
          where: { id: booking.id },
          data: { status: BookingStatus.cancelled, cancelledAt: new Date() }
        });
      })
    ]);

    if (read.status === BookingStatus.paid) {
      expect(read.checkInLocation).toMatchObject({ address: "100 Main St, Houston, TX 77002" });
    } else {
      expect(read.status).toBe(BookingStatus.cancelled);
      expect(read.checkInLocation).toBeNull();
    }
    await expect(bookings.getBooking("renter-token", booking.id)).resolves.toMatchObject({
      status: BookingStatus.cancelled,
      checkInLocation: null
    });
  });
});
