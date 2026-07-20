import { BadRequestException, ForbiddenException } from "@nestjs/common";
import {
  AvailabilityStatus,
  BookingStatus,
  CancellationActorType,
  CancellationFinancialDisposition,
  CancellationOperationStatus,
  ListingStatus,
  ListingType,
  PaymentStatus,
  PriceUnit,
  UserRole
} from "@prisma/client";
import type { AuthService } from "../src/auth/auth.service";
import { BookingsService } from "../src/bookings/bookings.service";
import type { IdentityEligibilityService } from "../src/identity/identity-eligibility.service";
import type { EmailService } from "../src/email/email.service";
import { PaymentTransitionService } from "../src/payments/payment-transition.service";
import type { PrismaService } from "../src/prisma/prisma.service";

const now = new Date("2026-07-01T00:00:00.000Z");

const renterUser = {
  id: "renter_user_1",
  supabaseUserId: "supabase-renter-1",
  email: "renter@example.com",
  emailVerifiedAt: now,
  firstName: "Alex",
  lastName: "Renter",
  displayName: "Alex R",
  healthcareRole: null,
  roles: [UserRole.renter],
  healthcareAffiliation: null,
  phoneNumber: null,
  bio: null,
  profilePhotoUrl: null,
  profileComplete: true,
  currentVerificationStatus: "not_started",
  disabledAt: null,
  createdAt: now,
  updatedAt: now
};

const hostUser = {
  ...renterUser,
  id: "host_user_1",
  supabaseUserId: "supabase-host-1",
  email: "host@example.com",
  roles: [UserRole.host]
};

const otherHostUser = {
  ...hostUser,
  id: "host_user_2",
  supabaseUserId: "supabase-host-2",
  email: "other-host@example.com"
};

const adminUser = {
  ...hostUser,
  id: "admin_user_1",
  supabaseUserId: "supabase-admin-1",
  email: "admin@example.com",
  roles: [UserRole.admin]
};

const listingRecord = {
  id: "listing_1",
  hostId: "host_user_1",
  title: "Private room near hospital",
  description: "Clean furnished room.",
  city: "Houston",
  timeZone: "America/Chicago",
  checkoutTime: "11:00",
  address: "123 Main St",
  latitude: null,
  longitude: null,
  priceCents: 8000,
  currency: "USD",
  priceUnit: PriceUnit.day,
  listingType: ListingType.private_room,
  category: null,
  status: ListingStatus.approved,
  stayDurations: [],
  proximityTags: [],
  specialFeatures: [],
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  host: {
    id: "host_user_1",
    email: "host@example.com",
    firstName: "Maya",
    displayName: "Maya H"
  },
  availability: [
    {
      startDate: new Date("2026-07-01T00:00:00.000Z"),
      endDate: new Date("2026-07-31T00:00:00.000Z"),
      status: AvailabilityStatus.available
    }
  ]
};

function bookingRecord(overrides = {}) {
  return {
    id: "booking_1",
    listingId: listingRecord.id,
    renterId: renterUser.id,
    hostId: listingRecord.hostId,
    startDate: new Date("2026-07-10T00:00:00.000Z"),
    endDate: new Date("2026-07-12T00:00:00.000Z"),
    timeZone: listingRecord.timeZone,
    checkoutTime: listingRecord.checkoutTime,
    selectedOption: "daily_short_term",
    additionalRequests: null,
    status: BookingStatus.requested,
    totalAmountCents: 16000,
    currency: "USD",
    createdAt: now,
    updatedAt: now,
    requestExpiresAt: new Date("2026-07-02T00:00:00.000Z"),
    expiredAt: null,
    expirySource: null,
    completedAt: null,
    completionSource: null,
    cancelledAt: null,
    cancellationReason: null,
    listing: {
      id: listingRecord.id,
      title: listingRecord.title,
      priceUnit: listingRecord.priceUnit,
      address: listingRecord.address,
      latitude: 29.7604,
      longitude: -95.3698,
      host: listingRecord.host
    },
    renter: {
      id: renterUser.id,
      email: renterUser.email,
      firstName: renterUser.firstName,
      displayName: renterUser.displayName
    },
    payments: [],
    cancellationOperations: [],
    locationSnapshot: {
      formattedAddress: "123 Main St",
      exactLatitude: 29.7604,
      exactLongitude: -95.3698,
      sourceListingLocationVersion: 1,
      capturedAt: new Date("2026-07-02T00:00:00.000Z")
    },
    ...overrides
  };
}

function createService() {
  const prisma = {
    $executeRaw: jest.fn(),
    listing: {
      findFirst: jest.fn()
    },
    booking: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn()
    }
  };
  const transaction = jest.fn(
    async (
      callback: (transactionClient: typeof prisma) => Promise<unknown>
    ) => callback(prisma)
  );
  const prismaWithTransaction = {
    ...prisma,
    $transaction: transaction
  };
  const authService = {
    getCurrentUserRecord: jest.fn()
  };
  const emailService = {
    queueTransactionalEmail: jest.fn()
  };
  const identityEligibility = { assertApproved: jest.fn() };
  const service = new BookingsService(
    prismaWithTransaction as unknown as PrismaService,
    authService as unknown as AuthService,
    emailService as unknown as EmailService,
    new PaymentTransitionService(),
    identityEligibility as unknown as IdentityEligibilityService
  );

  return { service, prisma, transaction, authService, emailService, identityEligibility };
}

describe("BookingsService", () => {
  it("returns the immutable payment-time location snapshot after the listing changes", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(renterUser);
    prisma.booking.findUnique.mockResolvedValue(bookingRecord({
      status: BookingStatus.paid,
      payments: [{ status: PaymentStatus.paid }],
      listing: {
        ...bookingRecord().listing,
        address: "999 Changed St",
        latitude: 1,
        longitude: 2
      },
      locationSnapshot: {
        formattedAddress: "123 Main St",
        exactLatitude: 29.7604,
        exactLongitude: -95.3698,
        sourceListingLocationVersion: 4,
        capturedAt: new Date("2026-07-02T00:00:00.000Z")
      }
    }));

    await expect(service.getBooking("token", "booking_1")).resolves.toMatchObject({
      checkInLocation: {
        address: "123 Main St",
        latitude: 29.7604,
        longitude: -95.3698,
        sourceListingLocationVersion: 4,
        capturedAt: "2026-07-02T00:00:00.000Z"
      }
    });
  });

  it("blocks booking creation when renter identity is not approved", async () => {
    const { service, prisma, authService, identityEligibility } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(renterUser);
    identityEligibility.assertApproved.mockRejectedValue(
      new ForbiddenException({ code: "IDENTITY_VERIFICATION_REQUIRED" })
    );
    await expect(
      service.createBooking("token", {
        listingId: listingRecord.id,
        startDate: "2026-07-10",
        endDate: "2026-07-12",
        selectedOption: "daily_short_term"
      })
    ).rejects.toMatchObject({ response: { code: "IDENTITY_VERIFICATION_REQUIRED" } });
    expect(prisma.booking.create).not.toHaveBeenCalled();
  });

  it("creates a booking request with backend-calculated total and queues host email", async () => {
    const { service, prisma, authService, emailService, identityEligibility } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(renterUser);
    prisma.listing.findFirst.mockResolvedValue(listingRecord);
    prisma.booking.findFirst.mockResolvedValue(null);
    prisma.booking.create.mockResolvedValue(bookingRecord());

    await expect(
      service.createBooking("token", {
        listingId: listingRecord.id,
        startDate: "2026-07-10",
        endDate: "2026-07-12",
        selectedOption: "daily_short_term"
      })
    ).resolves.toMatchObject({
      id: "booking_1",
      totalAmountCents: 16000,
      status: "requested"
    });

    expect(prisma.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          renterId: renterUser.id,
          hostId: listingRecord.hostId,
          timeZone: listingRecord.timeZone,
          checkoutTime: listingRecord.checkoutTime,
          totalAmountCents: 16000
        })
      })
    );
    expect(emailService.queueTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "host@example.com",
        template: "booking_requested_host"
      }),
      expect.objectContaining({
        aggregateId: "booking_1",
        aggregateType: "booking",
        deduplicationKey: "booking-requested:booking_1:host"
      })
    );
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    expect(identityEligibility.assertApproved).toHaveBeenCalledWith(
      renterUser.id,
      prisma
    );
    await expect(
      service.createBooking("token", {
        listingId: listingRecord.id,
        startDate: "2026-07-10",
        endDate: "2026-07-12",
        selectedOption: "daily_short_term"
      })
    ).resolves.toMatchObject({
      timeZone: "America/Chicago",
      checkoutTime: "11:00",
      requestExpiresAt: "2026-07-02T00:00:00.000Z",
      expiredAt: null,
      completedAt: null
    });
  });

  it("rejects unverified renters before creating a booking", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue({
      ...renterUser,
      emailVerifiedAt: null
    });

    await expect(
      service.createBooking("token", {
        listingId: listingRecord.id,
        startDate: "2026-07-10",
        endDate: "2026-07-12",
        selectedOption: "daily_short_term"
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.listing.findFirst).not.toHaveBeenCalled();
  });

  it("rejects conflicting booking dates", async () => {
    const { service, prisma, authService, emailService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(renterUser);
    prisma.listing.findFirst.mockResolvedValue(listingRecord);
    prisma.booking.findFirst.mockResolvedValue({ id: "booking_existing" });

    await expect(
      service.createBooking("token", {
        listingId: listingRecord.id,
        startDate: "2026-07-10",
        endDate: "2026-07-12",
        selectedOption: "daily_short_term"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.booking.create).not.toHaveBeenCalled();
    expect(emailService.queueTransactionalEmail).not.toHaveBeenCalled();
  });

  it("serializes concurrent overlapping requests so only one creates a booking", async () => {
    const { service, prisma, transaction, authService, emailService } =
      createService();
    authService.getCurrentUserRecord.mockResolvedValue(renterUser);
    prisma.listing.findFirst.mockResolvedValue(listingRecord);

    let transactionTail = Promise.resolve();
    transaction.mockImplementation(
      (callback: (transactionClient: typeof prisma) => Promise<unknown>) => {
        const result = transactionTail.then(() => callback(prisma));
        transactionTail = result.then(
          () => undefined,
          () => undefined
        );
        return result;
      }
    );
    let bookingCreated = false;
    prisma.booking.findFirst.mockImplementation(() =>
      Promise.resolve(bookingCreated ? { id: "booking_1" } : null)
    );
    prisma.booking.create.mockImplementation(() => {
      bookingCreated = true;
      return Promise.resolve(bookingRecord());
    });

    const results = await Promise.allSettled([
      service.createBooking("token", {
        listingId: listingRecord.id,
        startDate: "2026-07-10",
        endDate: "2026-07-12",
        selectedOption: "daily_short_term"
      }),
      service.createBooking("token", {
        listingId: listingRecord.id,
        startDate: "2026-07-11",
        endDate: "2026-07-13",
        selectedOption: "daily_short_term"
      })
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(prisma.booking.create).toHaveBeenCalledTimes(1);
    expect(emailService.queueTransactionalEmail).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(4);
  });

  it("allows non-overlapping requests while preserving overlap boundaries", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(renterUser);
    prisma.listing.findFirst.mockResolvedValue(listingRecord);
    prisma.booking.findFirst.mockResolvedValue(null);
    prisma.booking.create
      .mockResolvedValueOnce(bookingRecord())
      .mockResolvedValueOnce(
        bookingRecord({
          id: "booking_2",
          startDate: new Date("2026-07-12T00:00:00.000Z"),
          endDate: new Date("2026-07-14T00:00:00.000Z")
        })
      );

    await expect(
      service.createBooking("token", {
        listingId: listingRecord.id,
        startDate: "2026-07-10",
        endDate: "2026-07-12",
        selectedOption: "daily_short_term"
      })
    ).resolves.toMatchObject({ id: "booking_1" });
    await expect(
      service.createBooking("token", {
        listingId: listingRecord.id,
        startDate: "2026-07-12",
        endDate: "2026-07-14",
        selectedOption: "daily_short_term"
      })
    ).resolves.toMatchObject({ id: "booking_2" });
  });

  it("allows the booking host to accept a requested booking and queues the renter email", async () => {
    const { service, prisma, authService, emailService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(hostUser);
    prisma.booking.findUnique
      .mockResolvedValueOnce(bookingRecord())
      .mockResolvedValueOnce(bookingRecord())
      .mockResolvedValueOnce(bookingRecord({ status: BookingStatus.accepted }));
    prisma.booking.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.decideBooking("token", "booking_1", { status: "accepted" })
    ).resolves.toMatchObject({
      id: "booking_1",
      status: "accepted"
    });

    expect(prisma.booking.updateMany).toHaveBeenCalledWith({
      where: {
        id: "booking_1",
        status: BookingStatus.requested
      },
      data: {
        status: BookingStatus.accepted
      }
    });
    expect(emailService.queueTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: renterUser.email,
        template: "booking_accepted_renter"
      }),
      expect.objectContaining({
        aggregateId: "booking_1",
        aggregateType: "booking",
        deduplicationKey: "booking-accepted:booking_1:renter"
      })
    );
  });

  it("allows the booking host to reject a requested booking", async () => {
    const { service, prisma, authService, emailService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(hostUser);
    prisma.booking.findUnique
      .mockResolvedValueOnce(bookingRecord())
      .mockResolvedValueOnce(bookingRecord())
      .mockResolvedValueOnce(bookingRecord({ status: BookingStatus.rejected }));
    prisma.booking.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.decideBooking("token", "booking_1", { status: "rejected" })
    ).resolves.toMatchObject({
      id: "booking_1",
      status: "rejected"
    });

    expect(emailService.queueTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: renterUser.email,
        template: "booking_rejected_renter"
      }),
      expect.objectContaining({
        deduplicationKey: "booking-rejected:booking_1:renter"
      })
    );
  });

  it("returns opaque NOT_FOUND for booking decisions by an unrelated host", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(otherHostUser);
    prisma.booking.findUnique.mockResolvedValue(bookingRecord());

    await expect(
      service.decideBooking("token", "booking_1", { status: "accepted" })
    ).rejects.toMatchObject({ response: { code: "NOT_FOUND", details: {} } });
    expect(prisma.booking.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a second decision after a booking is no longer requested", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(hostUser);
    prisma.booking.findUnique.mockResolvedValue(
      bookingRecord({ status: BookingStatus.accepted })
    );

    await expect(
      service.decideBooking("token", "booking_1", { status: "rejected" })
    ).rejects.toMatchObject({
      response: {
        code: "BOOKING_STATUS_NOT_ALLOWED"
      }
    });
    expect(prisma.booking.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    BookingStatus.requested,
    BookingStatus.accepted,
    BookingStatus.payment_pending
  ])("hides check-in location from the renter while status is %s", async (status) => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(renterUser);
    prisma.booking.findUnique.mockResolvedValue(
      bookingRecord({
        status,
        payments: [{ status: PaymentStatus.paid }]
      })
    );

    const response = await service.getBooking("token", "booking_1");

    expect(response).toMatchObject({ checkInLocation: null });
    expect(response.listing).not.toHaveProperty("address");
    expect(response.listing).not.toHaveProperty("latitude");
    expect(response.listing).not.toHaveProperty("longitude");
  });

  it.each([BookingStatus.paid, BookingStatus.completed])(
    "returns check-in location to the renter for %s with a currently paid payment",
    async (status) => {
      const { service, prisma, authService } = createService();
      authService.getCurrentUserRecord.mockResolvedValue(renterUser);
      prisma.booking.findUnique.mockResolvedValue(
        bookingRecord({
          status,
          payments: [{ status: PaymentStatus.paid }]
        })
      );

      await expect(service.getBooking("token", "booking_1")).resolves.toMatchObject({
        checkInLocation: {
          address: "123 Main St",
          latitude: 29.7604,
          longitude: -95.3698
        }
      });
    }
  );

  it("returns check-in location for an active partially refunded booking", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(renterUser);
    prisma.booking.findUnique.mockResolvedValue(
      bookingRecord({
        status: BookingStatus.paid,
        payments: [{
          status: PaymentStatus.partially_refunded,
          attemptNumber: 2,
          amountCents: 16_000,
          amountRefundedCents: 2_000
        }]
      })
    );

    await expect(service.getBooking("token", "booking_1")).resolves.toMatchObject({
      checkInLocation: { address: "123 Main St" }
    });
    expect(prisma.booking.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          payments: expect.objectContaining({
            orderBy: { attemptNumber: "desc" },
            take: 1
          })
        })
      })
    );
  });

  it("revokes renter location immediately while a cancellation is financially pending", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(renterUser);
    prisma.booking.findUnique.mockResolvedValue(
      bookingRecord({
        status: BookingStatus.paid,
        payments: [{
          status: PaymentStatus.paid,
          attemptNumber: 1,
          amountCents: 16_000,
          amountRefundedCents: 0
        }],
        cancellationOperations: [{
          id: "cancel_1",
          actorType: CancellationActorType.host,
          reason: "property_unavailable",
          status: CancellationOperationStatus.refund_pending,
          financialDisposition: CancellationFinancialDisposition.full_refund_pending,
          requestedAt: now,
          effectiveAt: null,
          active: true,
          providerOperationRef: "re_should_not_leak",
          failureCode: "should_not_leak"
        }]
      })
    );

    const result = await service.getBooking("token", "booking_1");

    expect(result).toMatchObject({
      checkInLocation: null,
      cancellation: {
        id: "cancel_1",
        actorType: CancellationActorType.host,
        reason: "property_unavailable",
        status: CancellationOperationStatus.refund_pending,
        financialDisposition: CancellationFinancialDisposition.full_refund_pending,
        requestedAt: now.toISOString(),
        effectiveAt: null
      }
    });
    expect(result.cancellation).not.toHaveProperty("providerOperationRef");
    expect(result.cancellation).not.toHaveProperty("failureCode");
  });

  it.each([PaymentStatus.refunded, PaymentStatus.disputed])(
    "hides check-in location when the current payment is %s",
    async (paymentStatus) => {
      const { service, prisma, authService } = createService();
      authService.getCurrentUserRecord.mockResolvedValue(renterUser);
      prisma.booking.findUnique.mockResolvedValue(
        bookingRecord({
          status: BookingStatus.paid,
          payments: [{ status: paymentStatus }]
        })
      );

      await expect(service.getBooking("token", "booking_1")).resolves.toMatchObject({
        checkInLocation: null
      });
    }
  );

  it("revokes location when cumulative partial refunds reach the full amount", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(renterUser);
    prisma.booking.findUnique.mockResolvedValue(
      bookingRecord({
        status: BookingStatus.paid,
        payments: [{
          status: PaymentStatus.partially_refunded,
          attemptNumber: 2,
          amountCents: 16_000,
          amountRefundedCents: 16_000
        }]
      })
    );

    await expect(service.getBooking("token", "booking_1")).resolves.toMatchObject({
      checkInLocation: null
    });
  });

  it("does not let an older paid attempt override the current refunded attempt", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(renterUser);
    prisma.booking.findUnique.mockResolvedValue(
      bookingRecord({
        status: BookingStatus.paid,
        payments: [
          {
            status: PaymentStatus.refunded,
            attemptNumber: 2,
            amountCents: 16_000,
            amountRefundedCents: 16_000
          },
          {
            status: PaymentStatus.paid,
            attemptNumber: 1,
            amountCents: 16_000,
            amountRefundedCents: 0
          }
        ]
      })
    );

    await expect(service.getBooking("token", "booking_1")).resolves.toMatchObject({
      checkInLocation: null
    });
  });

  it("requires an immutable snapshot for renter location access", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(renterUser);
    prisma.booking.findUnique.mockResolvedValue(
      bookingRecord({
        status: BookingStatus.paid,
        payments: [{ status: PaymentStatus.paid }],
        locationSnapshot: null
      })
    );

    await expect(service.getBooking("token", "booking_1")).resolves.toMatchObject({
      checkInLocation: null
    });
  });

  it("rejects anonymous booking detail before loading private state", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockRejectedValue(
      new ForbiddenException({ code: "UNAUTHORIZED", details: {} })
    );

    await expect(service.getBooking("", "booking_1")).rejects.toMatchObject({
      response: { code: "UNAUTHORIZED" }
    });
    expect(prisma.booking.findUnique).not.toHaveBeenCalled();
  });

  it("hides check-in location when any associated payment is refunded or disputed", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(renterUser);
    prisma.booking.findUnique.mockResolvedValue(
      bookingRecord({
        status: BookingStatus.paid,
        payments: [
          { status: PaymentStatus.disputed },
          { status: PaymentStatus.paid }
        ]
      })
    );

    await expect(service.getBooking("token", "booking_1")).resolves.toMatchObject({
      checkInLocation: null
    });
  });

  it("does not include check-in location in booking list responses", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(renterUser);
    prisma.booking.findMany.mockResolvedValue([
      bookingRecord({
        status: BookingStatus.paid,
        payments: [{ status: PaymentStatus.paid }]
      })
    ]);

    const response = await service.listBookings("token");

    expect(response.data[0]).not.toHaveProperty("checkInLocation");
  });

  it("rejects an unbounded booking date range before transactional work", async () => {
    const { service, transaction, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(renterUser);

    await expect(
      service.createBooking("token", {
        listingId: "11111111-1111-4111-8111-111111111111",
        startDate: "2026-01-01",
        endDate: "2027-01-03",
        selectedOption: "entire stay"
      })
    ).rejects.toMatchObject({
      response: { code: "BOOKING_DATE_RANGE_TOO_LARGE" }
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("hides check-in location from a renter after cancellation", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(renterUser);
    prisma.booking.findUnique.mockResolvedValue(
      bookingRecord({
        status: BookingStatus.cancelled,
        cancellationReason: "payment_expired",
        cancelledAt: now,
        payments: [{ status: PaymentStatus.partially_refunded }]
      })
    );

    await expect(service.getBooking("token", "booking_1")).resolves.toMatchObject({
      cancellationReason: "payment_expired",
      cancelledAt: now.toISOString(),
      checkInLocation: null
    });
  });

  it.each([hostUser, adminUser])(
    "returns check-in location to an authorized host or admin",
    async (currentUser) => {
      const { service, prisma, authService } = createService();
      authService.getCurrentUserRecord.mockResolvedValue(currentUser);
      prisma.booking.findUnique.mockResolvedValue(bookingRecord());

      await expect(service.getBooking("token", "booking_1")).resolves.toMatchObject({
        checkInLocation: {
          address: "123 Main St",
          latitude: 29.7604,
          longitude: -95.3698
        }
      });
    }
  );

  it("returns opaque NOT_FOUND to an unrelated authenticated booking reader", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(otherHostUser);
    prisma.booking.findUnique.mockResolvedValue(bookingRecord());

    await expect(service.getBooking("token", "booking_1")).rejects.toMatchObject({
      response: { code: "NOT_FOUND", details: {} }
    });
  });
});
