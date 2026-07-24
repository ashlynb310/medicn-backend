import {
  AvailabilityStatus,
  BookingStatus,
  ListingStatus,
  UserRole,
  type User
} from "@prisma/client";
import type { AuthService } from "../src/auth/auth.service";
import { BookingsService } from "../src/bookings/bookings.service";
import type { EmailService } from "../src/email/email.service";
import type { IdentityEligibilityService } from "../src/identity/identity-eligibility.service";
import { ListingAvailabilityService } from "../src/listings/listing-availability.service";
import { ListingsService } from "../src/listings/listings.service";
import { PaymentTransitionService } from "../src/payments/payment-transition.service";
import { PrismaService } from "../src/prisma/prisma.service";

const describeWithDatabase =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? describe : describe.skip;

describeWithDatabase("local availability PostgreSQL correctness", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const listingIds: string[] = [];
  let prisma: PrismaService;
  let host: User;
  let otherHost: User;
  let renter: User;
  let availability: ListingAvailabilityService;
  let bookings: BookingsService;
  let listings: ListingsService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    [host, otherHost, renter] = await Promise.all([
      prisma.user.create({
        data: {
          supabaseUserId: `availability-host-${suffix}`,
          email: `availability-host-${suffix}@example.com`,
          emailVerifiedAt: new Date(),
          roles: [UserRole.host]
        }
      }),
      prisma.user.create({
        data: {
          supabaseUserId: `availability-other-${suffix}`,
          email: `availability-other-${suffix}@example.com`,
          emailVerifiedAt: new Date(),
          roles: [UserRole.host]
        }
      }),
      prisma.user.create({
        data: {
          supabaseUserId: `availability-renter-${suffix}`,
          email: `availability-renter-${suffix}@example.com`,
          emailVerifiedAt: new Date(),
          roles: [UserRole.renter]
        }
      })
    ]);
    const auth = {
      getCurrentUserRecord: jest.fn(async (token: string) => {
        if (token === "host-token") return host;
        if (token === "other-host-token") return otherHost;
        return renter;
      })
    };
    availability = new ListingAvailabilityService(
      prisma,
      auth as unknown as AuthService
    );
    listings = new ListingsService(prisma, auth as unknown as AuthService);
    bookings = new BookingsService(
      prisma,
      auth as unknown as AuthService,
      {
        queueTransactionalEmail: jest.fn().mockResolvedValue(undefined)
      } as unknown as EmailService,
      new PaymentTransitionService(),
      {
        assertApproved: jest.fn().mockResolvedValue(undefined)
      } as unknown as IdentityEligibilityService
    );
  });

  afterAll(async () => {
    await prisma.bookingCancellationOperation.deleteMany({
      where: { booking: { listingId: { in: listingIds } } }
    });
    await prisma.payment.deleteMany({ where: { booking: { listingId: { in: listingIds } } } });
    await prisma.booking.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.listingAvailability.deleteMany({
      where: { listingId: { in: listingIds } }
    });
    await prisma.listingLocation.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.listing.deleteMany({ where: { id: { in: listingIds } } });
    await prisma.user.deleteMany({
      where: { id: { in: [host.id, otherHost.id, renter.id] } }
    });
    await prisma.$disconnect();
  });

  async function createListing(timeZone = "America/Chicago") {
    const listing = await prisma.listing.create({
      data: {
        hostId: host.id,
        title: `Availability fixture ${listingIds.length + 1}`,
        description: "Availability integration fixture.",
        city: "Chicago",
        address: "100 Main St, Chicago, IL 60601",
        priceCents: 9_000,
        priceUnit: "day",
        listingType: "private_room",
        status: ListingStatus.approved,
        timeZone,
        location: {
          create: {
            inputAddress: "100 Main St, Chicago, IL 60601",
            inputCity: "Chicago",
            addressFingerprint: `availability-${suffix}-${listingIds.length}`,
            verifiedFingerprint: `availability-${suffix}-${listingIds.length}`,
            formattedAddress: "100 Main St, Chicago, IL 60601",
            providerPlaceId: `place-${suffix}-${listingIds.length}`,
            geocodeStatus: "verified",
            addressVersion: 1,
            verifiedAddressVersion: 1,
            enrichmentStatus: "ready"
          }
        }
      }
    });
    listingIds.push(listing.id);
    return listing;
  }

  async function createBooking(
    listingId: string,
    status: BookingStatus,
    startDate: string,
    endDate: string
  ) {
    return prisma.booking.create({
      data: {
        listingId,
        renterId: renter.id,
        hostId: host.id,
        startDate: new Date(`${startDate}T00:00:00.000Z`),
        endDate: new Date(`${endDate}T00:00:00.000Z`),
        timeZone: "America/Chicago",
        selectedOption: "daily_short_term",
        status,
        ...(status === BookingStatus.completed
          ? { completedAt: new Date(), completionSource: "legacy_backfill" as const }
          : {}),
        totalAmountCents: 9_000,
        currency: "USD"
      }
    });
  }

  it("enforces ownership and keeps the public projection free of reservation identity", async () => {
    const listing = await createListing();
    await availability.createWindow("host-token", listing.id, {
      startDate: "2027-03-01",
      endDate: "2027-03-20",
      status: "available"
    });
    await availability.createWindow("host-token", listing.id, {
      startDate: "2027-03-05",
      endDate: "2027-03-06",
      status: "blocked"
    });
    await createBooking(
      listing.id,
      BookingStatus.requested,
      "2027-03-10",
      "2027-03-12"
    );

    await expect(
      availability.listWindows("other-host-token", listing.id, {})
    ).rejects.toMatchObject({ response: { code: "NOT_FOUND", details: {} } });
    const publicCalendar = await availability.getPublicCalendar(listing.id, {
      startDate: "2027-03-01",
      endDate: "2027-03-20"
    });
    expect(publicCalendar.unavailable).toEqual([
      { startDate: "2027-03-05", endDate: "2027-03-06" },
      { startDate: "2027-03-10", endDate: "2027-03-12" }
    ]);
    expect(JSON.stringify(publicCalendar)).not.toMatch(
      /bookingId|renterId|@example|100 Main|payment|message/
    );
  });

  it("projects only the four reserving states and treats completed as historical", async () => {
    const listing = await createListing();
    const fixtures: Array<[BookingStatus, string, string]> = [
      [BookingStatus.requested, "2027-04-01", "2027-04-02"],
      [BookingStatus.accepted, "2027-04-03", "2027-04-04"],
      [BookingStatus.payment_pending, "2027-04-05", "2027-04-06"],
      [BookingStatus.paid, "2027-04-07", "2027-04-08"],
      [BookingStatus.rejected, "2027-04-09", "2027-04-10"],
      [BookingStatus.cancelled, "2027-04-11", "2027-04-12"],
      [BookingStatus.completed, "2027-04-13", "2027-04-14"]
    ];
    for (const [status, startDate, endDate] of fixtures) {
      await createBooking(listing.id, status, startDate, endDate);
    }
    const calendar = await availability.getHostCalendar("host-token", listing.id, {
      startDate: "2027-04-01",
      endDate: "2027-04-15"
    });
    expect(calendar.reservations).toEqual([
      { startDate: "2027-04-01", endDate: "2027-04-02", status: "reserved" },
      { startDate: "2027-04-03", endDate: "2027-04-04", status: "reserved" },
      { startDate: "2027-04-05", endDate: "2027-04-06", status: "reserved" },
      { startDate: "2027-04-07", endDate: "2027-04-08", status: "reserved" }
    ]);
  });

  it("prevents blocked or narrowed availability from invalidating a protected booking", async () => {
    const listing = await createListing();
    const window = await availability.createWindow("host-token", listing.id, {
      startDate: "2027-05-01",
      endDate: "2027-06-01",
      status: "available"
    });
    await createBooking(
      listing.id,
      BookingStatus.accepted,
      "2027-05-10",
      "2027-05-15"
    );
    await expect(
      availability.createWindow("host-token", listing.id, {
        startDate: "2027-05-12",
        endDate: "2027-05-13",
        status: "blocked"
      })
    ).rejects.toMatchObject({
      response: { code: "AVAILABILITY_CONFLICTS_WITH_RESERVATION" }
    });
    await expect(
      availability.updateWindow("host-token", listing.id, window.id, {
        endDate: "2027-05-12"
      })
    ).rejects.toMatchObject({
      response: { code: "AVAILABILITY_CONFLICTS_WITH_RESERVATION" }
    });
  });

  it("uses half-open boundaries and snapshots a DST-observing listing timezone", async () => {
    const listing = await createListing("America/New_York");
    await availability.createWindow("host-token", listing.id, {
      startDate: "2027-03-01",
      endDate: "2027-03-14",
      status: "available"
    });
    await availability.createWindow("host-token", listing.id, {
      startDate: "2027-03-14",
      endDate: "2027-03-15",
      status: "blocked"
    });
    const result = await bookings.createBooking("renter-token", {
      listingId: listing.id,
      startDate: "2027-03-12",
      endDate: "2027-03-14",
      selectedOption: "daily_short_term"
    });
    expect(result).toMatchObject({
      startDate: "2027-03-12",
      endDate: "2027-03-14",
      timeZone: "America/New_York"
    });
    await prisma.listing.update({
      where: { id: listing.id },
      data: { timeZone: "America/Chicago" }
    });
    await expect(prisma.booking.findUniqueOrThrow({ where: { id: result.id } }))
      .resolves.toMatchObject({ timeZone: "America/New_York" });
    await expect(
      prisma.booking.update({
        where: { id: result.id },
        data: { timeZone: "UTC" }
      })
    ).rejects.toThrow("Booking lifecycle snapshots are immutable");
  });

  it("serializes a booking request against a conflicting blocked-window write", async () => {
    const listing = await createListing();
    const results = await Promise.allSettled([
      bookings.createBooking("renter-token", {
        listingId: listing.id,
        startDate: "2027-07-10",
        endDate: "2027-07-12",
        selectedOption: "daily_short_term"
      }),
      availability.createWindow("host-token", listing.id, {
        startDate: "2027-07-10",
        endDate: "2027-07-12",
        status: "blocked"
      })
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
    const [bookingCount, blockedCount] = await Promise.all([
      prisma.booking.count({ where: { listingId: listing.id } }),
      prisma.listingAvailability.count({
        where: { listingId: listing.id, status: AvailabilityStatus.blocked }
      })
    ]);
    expect(bookingCount + blockedCount).toBe(1);
  });

  it("makes public date search honor adjacent availability, blocks, and reservation release", async () => {
    const listing = await createListing();
    await availability.createWindow("host-token", listing.id, {
      startDate: "2027-08-01",
      endDate: "2027-08-05",
      status: "available"
    });
    await availability.createWindow("host-token", listing.id, {
      startDate: "2027-08-05",
      endDate: "2027-08-10",
      status: "available"
    });
    const adjacentResult = await listings.searchListings({
      startDate: "2027-08-02",
      endDate: "2027-08-08"
    });
    expect(adjacentResult.data.map(({ id }) => id)).toContain(listing.id);

    const booking = await createBooking(
      listing.id,
      BookingStatus.requested,
      "2027-08-03",
      "2027-08-04"
    );
    const reservedResult = await listings.searchListings({
      startDate: "2027-08-03",
      endDate: "2027-08-04"
    });
    expect(reservedResult.data.map(({ id }) => id)).not.toContain(listing.id);
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: BookingStatus.cancelled }
    });
    const releasedResult = await listings.searchListings({
      startDate: "2027-08-03",
      endDate: "2027-08-04"
    });
    expect(releasedResult.data.map(({ id }) => id)).toContain(listing.id);

    await availability.createWindow("host-token", listing.id, {
      startDate: "2027-08-07",
      endDate: "2027-08-09",
      status: "blocked"
    });
    const blockedResult = await listings.searchListings({
      startDate: "2027-08-07",
      endDate: "2027-08-08"
    });
    expect(blockedResult.data.map(({ id }) => id)).not.toContain(listing.id);
  });
});
