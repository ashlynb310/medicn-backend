import { BadRequestException, ForbiddenException } from "@nestjs/common";
import {
  BookingStatus,
  ListingStatus,
  ListingType,
  PriceUnit,
  StayDuration,
  UserRole
} from "@prisma/client";
import type { AuthService } from "../src/auth/auth.service";
import { ListingsService } from "../src/listings/listings.service";
import type { MapsService } from "../src/maps/maps.service";
import type { PrismaService } from "../src/prisma/prisma.service";

const now = new Date("2026-06-17T00:00:00.000Z");

const hostUser = {
  id: "host_user_1",
  supabaseUserId: "supabase-host-1",
  email: "host@example.com",
  emailVerifiedAt: now,
  firstName: "Maya",
  lastName: "Host",
  displayName: "Maya H",
  healthcareRole: null,
  roles: [UserRole.host],
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

const renterUser = {
  ...hostUser,
  id: "renter_user_1",
  supabaseUserId: "supabase-renter-1",
  email: "renter@example.com",
  roles: [UserRole.renter]
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
  hostId: hostUser.id,
  title: "Private room near hospital",
  description: "Clean furnished room for medical travelers.",
  city: "Houston",
  timeZone: "America/Chicago",
  checkoutTime: "11:00",
  address: "123 Main St",
  latitude: 29.7604,
  longitude: -95.3698,
  publicLatitude: 29.763,
  publicLongitude: -95.3688,
  publicRadiusMeters: 500,
  priceCents: 8000,
  currency: "USD",
  priceUnit: PriceUnit.day,
  listingType: ListingType.private_room,
  category: null,
  status: ListingStatus.approved,
  stayDurations: [StayDuration.short_term],
  proximityTags: [],
  specialFeatures: [],
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  host: {
    id: hostUser.id,
    firstName: hostUser.firstName,
    lastName: hostUser.lastName,
    displayName: hostUser.displayName,
    bio: hostUser.bio,
    profilePhotoUrl: hostUser.profilePhotoUrl
  },
  photos: [],
  availability: [],
  places: []
};

function createService(mapsService?: Partial<MapsService>) {
  const prisma = {
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    listing: {
      count: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn()
    },
    booking: {
      findFirst: jest.fn()
    },
    listingPhoto: {
      aggregate: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn()
    },
    listingUploadIntent: {
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
  const service = new ListingsService(
    prismaWithTransaction as unknown as PrismaService,
    authService as unknown as AuthService,
    mapsService as MapsService | undefined
  );

  return { service, prisma, authService, transaction };
}

describe("ListingsService", () => {
  it("stops a protected listing workflow when the shared auth boundary disables the caller", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockRejectedValue(
      new ForbiddenException({
        code: "ACCOUNT_DISABLED",
        message: "This MediCN account is disabled.",
        details: {}
      })
    );

    await expect(
      service.listMyListings("token", { page: 1, limit: 20 })
    ).rejects.toMatchObject({ response: { code: "ACCOUNT_DISABLED" } });
    expect(prisma.listing.findMany).not.toHaveBeenCalled();
  });

  it("searches only active approved listings with filters and pagination", async () => {
    const { service, prisma } = createService();
    prisma.listing.count.mockResolvedValue(1);
    prisma.listing.findMany.mockResolvedValue([listingRecord]);

    const response = await service.searchListings({
      city: "Houston",
      listingType: "private_room",
      stayDuration: "short_term",
      minPrice: 50,
      maxPrice: 100,
      sort: "price_asc",
      page: 1,
      limit: 20
    });

    expect(response).toMatchObject({
      data: [
        {
          id: "listing_1",
          title: "Private room near hospital",
          city: "Houston",
          priceCents: 8000,
          currency: "USD",
          status: "approved"
        }
      ],
      meta: {
        page: 1,
        limit: 20,
        total: 1
      },
      error: null
    });
    expect(response.data[0]).not.toHaveProperty("price");
    expect(response.data[0]).not.toHaveProperty("address");
    expect(response.data[0]).not.toHaveProperty("latitude");
    expect(response.data[0]).not.toHaveProperty("longitude");
    expect(response.data[0]).toMatchObject({
      publicLocation: {
        city: "Houston",
        latitude: 29.763,
        longitude: -95.3688,
        radiusMeters: 500,
        precision: "approximate"
      },
      exactLocation: null
    });

    expect(prisma.listing.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        status: ListingStatus.approved,
        deletedAt: null,
        city: { contains: "Houston", mode: "insensitive" },
        listingType: ListingType.private_room,
        stayDurations: { has: StayDuration.short_term },
        priceCents: {
          gte: 5000,
          lte: 10000
        }
      })
    });
    expect(prisma.listing.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 20,
        orderBy: { priceCents: "asc" }
      })
    );
  });

  it("exposes checkoutTime only in owner detail and persists an explicit update", async () => {
    const { service, prisma, authService } = createService();
    prisma.listing.findFirst.mockResolvedValue(listingRecord);
    await expect(service.getListing(listingRecord.id)).resolves.not.toHaveProperty(
      "checkoutTime"
    );

    authService.getCurrentUserRecord.mockResolvedValue(hostUser);
    prisma.listing.findFirst.mockResolvedValue(listingRecord);
    prisma.listing.update.mockResolvedValue({
      ...listingRecord,
      checkoutTime: "05:30"
    });
    await expect(
      service.updateListing("token", listingRecord.id, { checkoutTime: "05:30" })
    ).resolves.toMatchObject({ checkoutTime: "05:30" });
    expect(prisma.listing.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { checkoutTime: "05:30" } })
    );
  });

  it("uses only public location fields for text and map-bound searches", async () => {
    const { service, prisma } = createService();
    prisma.listing.count.mockResolvedValue(0);
    prisma.listing.findMany.mockResolvedValue([]);

    await service.searchListings({
      location: "Houston",
      bounds: "30,-95,29,-96",
      page: 1,
      limit: 20
    });

    const where = prisma.listing.count.mock.calls[0][0].where;
    expect(JSON.stringify(where)).not.toContain("address");
    expect(where.AND).toEqual(
      expect.arrayContaining([
        {
          publicLatitude: { gte: 29, lte: 30 },
          publicLongitude: { gte: -96, lte: -95 }
        }
      ])
    );
  });

  it("lists the authenticated host's non-deleted listings, including pending listings", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(hostUser);
    prisma.listing.count.mockResolvedValue(1);
    prisma.listing.findMany.mockResolvedValue([
      {
        ...listingRecord,
        status: ListingStatus.pending
      }
    ]);

    await expect(
      service.listMyListings("token", { page: 1, limit: 20 })
    ).resolves.toMatchObject({
      data: [
        {
          id: "listing_1",
          status: "pending",
          exactLocation: {
            address: "123 Main St",
            latitude: 29.7604,
            longitude: -95.3698
          }
        }
      ],
      meta: {
        page: 1,
        limit: 20,
        total: 1
      },
      error: null
    });

    expect(prisma.listing.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          hostId: hostUser.id,
          deletedAt: null
        },
        skip: 0,
        take: 20,
        orderBy: { createdAt: "desc" }
      })
    );
  });

  it("creates a pending listing for an authenticated host", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(hostUser);
    prisma.listing.create.mockResolvedValue({
      id: "listing_1",
      status: ListingStatus.pending
    });

    await expect(
      service.createListing("token", {
        title: "  Private room near hospital  ",
        description: "Clean furnished room.",
        city: " Houston ",
        timeZone: "America/Chicago",
        address: "123 Main St",
        priceCents: 8000,
        priceUnit: "day",
        listingType: "private_room",
        stayDurations: ["short_term"],
        neighborhoodPerks: ["Houston Methodist Hospital"],
        localRecommendations: ["Houston Zoo"],
        availability: [
          {
            startDate: "2026-07-01",
            endDate: "2026-09-30"
          }
        ]
      })
    ).resolves.toEqual({
      id: "listing_1",
      status: "pending"
    });

    expect(prisma.listing.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        hostId: hostUser.id,
        title: "Private room near hospital",
        city: "Houston",
        priceCents: 8000,
        priceUnit: PriceUnit.day,
        listingType: ListingType.private_room,
        status: ListingStatus.pending,
        availability: {
          create: [
            {
              startDate: new Date("2026-07-01"),
              endDate: new Date("2026-09-30"),
              status: "available"
            }
          ]
        },
        places: {
          create: [
            {
              type: "neighborhood_perk",
              label: "Houston Methodist Hospital",
              googlePlaceId: null,
              mapsUrl:
                "https://www.google.com/maps/search/?api=1&query=Houston%20Methodist%20Hospital%2C%20Houston",
              displayOrder: 0
            },
            {
              type: "local_recommendation",
              label: "Houston Zoo",
              googlePlaceId: null,
              mapsUrl:
                "https://www.google.com/maps/search/?api=1&query=Houston%20Zoo%2C%20Houston",
              displayOrder: 0
            }
          ]
        }
      }),
      select: {
        id: true,
        status: true
      }
    });
  });

  it("rejects listing creation by users without the host role", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(renterUser);

    await expect(
      service.createListing("token", {
        title: "Private room near hospital",
        description: "Clean furnished room.",
        city: "Houston",
        timeZone: "America/Chicago",
        priceCents: 8000,
        priceUnit: "day",
        listingType: "private_room"
      })
    ).rejects.toMatchObject({
      response: {
        code: "FORBIDDEN"
      }
    });
    expect(prisma.listing.create).not.toHaveBeenCalled();
  });

  it("rejects a non-canonical listing timezone with a stable error", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(hostUser);
    await expect(
      service.createListing("token", {
        title: "Private room",
        description: "Clean furnished room.",
        city: "Houston",
        timeZone: "CST",
        address: "123 Main St",
        priceCents: 8000,
        priceUnit: "day",
        listingType: "private_room"
      })
    ).rejects.toMatchObject({
      response: { code: "LISTING_TIMEZONE_INVALID", details: {} }
    });
    expect(prisma.listing.create).not.toHaveBeenCalled();
  });

  it("requires existing clients to use the booking-safe dedicated calendar endpoints", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(hostUser);
    prisma.listing.findFirst.mockResolvedValue(listingRecord);
    await expect(
      service.updateListing("token", listingRecord.id, {
        availability: [
          { startDate: "2027-01-01", endDate: "2027-01-10" }
        ]
      })
    ).rejects.toMatchObject({
      response: { code: "AVAILABILITY_DEDICATED_ENDPOINT_REQUIRED", details: {} }
    });
    expect(prisma.listing.update).not.toHaveBeenCalled();
  });

  it("rejects updates from a host who does not own the listing", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(otherHostUser);
    prisma.listing.findFirst.mockResolvedValue(listingRecord);

    await expect(
      service.updateListing("token", "listing_1", {
        title: "Updated title"
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.listing.update).not.toHaveBeenCalled();
  });

  it("archives a listing instead of hard deleting it", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(hostUser);
    prisma.listing.findFirst.mockResolvedValue(listingRecord);
    prisma.$queryRaw.mockResolvedValue([{ now: new Date("2026-07-19T12:00:00.000Z") }]);
    prisma.booking.findFirst.mockResolvedValue(null);
    prisma.listing.update.mockResolvedValue({
      id: "listing_1",
      status: ListingStatus.archived,
      deletedAt: now
    });

    await expect(service.deleteListing("token", "listing_1")).resolves.toEqual({
      id: "listing_1",
      status: "archived",
      deletedAt: now.toISOString()
    });
    expect(prisma.listing.update).toHaveBeenCalledWith({
      where: { id: "listing_1" },
      data: {
        status: ListingStatus.archived,
        deletedAt: expect.any(Date)
      },
      select: {
        id: true,
        status: true,
        deletedAt: true
      }
    });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.booking.findFirst).toHaveBeenCalledWith({
      where: {
        listingId: "listing_1",
        status: {
          in: [
            BookingStatus.requested,
            BookingStatus.accepted,
            BookingStatus.payment_pending,
            BookingStatus.paid
          ]
        },
        endDate: { gt: new Date("2026-07-19T12:00:00.000Z") }
      },
      select: { id: true }
    });
  });

  it.each([
    BookingStatus.requested,
    BookingStatus.accepted,
    BookingStatus.payment_pending,
    BookingStatus.paid
  ])("blocks archive for a future %s booking with private-safe details", async (status) => {
    const { service, prisma, authService } = createService();
    const databaseNow = new Date("2026-07-19T12:00:00.000Z");
    authService.getCurrentUserRecord.mockResolvedValue(hostUser);
    prisma.listing.findFirst.mockResolvedValue(listingRecord);
    prisma.$queryRaw.mockResolvedValue([{ now: databaseNow }]);
    prisma.booking.findFirst.mockImplementation(({ where }) =>
      where.status.in.includes(status) && new Date("2026-07-20T00:00:00.000Z") > where.endDate.gt
        ? Promise.resolve({ id: "private-booking-id" })
        : Promise.resolve(null)
    );

    await expect(service.deleteListing("token", "listing_1")).rejects.toMatchObject({
      response: {
        code: "LISTING_ARCHIVE_BLOCKED_BY_ACTIVE_BOOKINGS",
        details: {}
      }
    });
    expect(prisma.listing.update).not.toHaveBeenCalled();
  });

  it.each([
    BookingStatus.rejected,
    BookingStatus.cancelled,
    BookingStatus.completed
  ])("allows archive when only a future %s booking exists", async (status) => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(hostUser);
    prisma.listing.findFirst.mockResolvedValue(listingRecord);
    prisma.$queryRaw.mockResolvedValue([{ now: new Date("2026-07-19T12:00:00.000Z") }]);
    prisma.booking.findFirst.mockImplementation(({ where }) =>
      where.status.in.includes(status) ? Promise.resolve({ id: "booking_1" }) : Promise.resolve(null)
    );
    prisma.listing.update.mockResolvedValue({
      id: "listing_1",
      status: ListingStatus.archived,
      deletedAt: now
    });

    await expect(service.deleteListing("token", "listing_1")).resolves.toMatchObject({
      status: ListingStatus.archived
    });
  });

  it("allows archive when an active-status booking has already ended", async () => {
    const { service, prisma, authService } = createService();
    const databaseNow = new Date("2026-07-19T12:00:00.000Z");
    authService.getCurrentUserRecord.mockResolvedValue(hostUser);
    prisma.listing.findFirst.mockResolvedValue(listingRecord);
    prisma.$queryRaw.mockResolvedValue([{ now: databaseNow }]);
    prisma.booking.findFirst.mockImplementation(({ where }) =>
      new Date("2026-07-19T11:59:59.000Z") > where.endDate.gt
        ? Promise.resolve({ id: "booking_1" })
        : Promise.resolve(null)
    );
    prisma.listing.update.mockResolvedValue({
      id: "listing_1",
      status: ListingStatus.archived,
      deletedAt: now
    });

    await expect(service.deleteListing("token", "listing_1")).resolves.toMatchObject({
      status: ListingStatus.archived
    });
  });

  it("applies the same active-booking rule to Admin callers", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(adminUser);
    prisma.listing.findFirst.mockResolvedValue(listingRecord);
    prisma.$queryRaw.mockResolvedValue([{ now: new Date("2026-07-19T12:00:00.000Z") }]);
    prisma.booking.findFirst.mockResolvedValue({ id: "private-booking-id" });

    await expect(service.deleteListing("token", "listing_1")).rejects.toMatchObject({
      response: { code: "LISTING_ARCHIVE_BLOCKED_BY_ACTIVE_BOOKINGS", details: {} }
    });
  });

  it("rejects a non-owner Host after the locked listing reload", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(otherHostUser);
    prisma.listing.findFirst.mockResolvedValue(listingRecord);

    await expect(service.deleteListing("token", "listing_1")).rejects.toMatchObject({
      response: { code: "FORBIDDEN", details: {} }
    });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.booking.findFirst).not.toHaveBeenCalled();
    expect(prisma.listing.update).not.toHaveBeenCalled();
  });

  it("rejects a disabled Host before acquiring the listing lock", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockRejectedValue(
      new ForbiddenException({
        code: "ACCOUNT_DISABLED",
        message: "This MediCN account is disabled.",
        details: {}
      })
    );

    await expect(service.deleteListing("token", "listing_1")).rejects.toMatchObject({
      response: { code: "ACCOUNT_DISABLED" }
    });
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.listing.update).not.toHaveBeenCalled();
  });

  it("rejects arbitrary listing photo storage paths", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(hostUser);
    prisma.listing.findFirst.mockResolvedValue(listingRecord);

    await expect(
      service.addListingPhoto("token", "listing_1", {
        storagePath: "https://cdn.example.com/unsafe.jpg",
        displayOrder: 1
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.listingPhoto.create).not.toHaveBeenCalled();
  });

  it("rejects a storage path that was not issued by the upload service", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(hostUser);
    prisma.listing.findFirst.mockResolvedValue(listingRecord);
    prisma.listingUploadIntent.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.addListingPhoto("token", "listing_1", {
        storagePath: "listings/listing_1/unissued-photo.jpg",
        displayOrder: 1
      })
    ).rejects.toMatchObject({
      response: {
        code: "MEDIA_PROCESSING_REQUIRED"
      }
    });
    expect(prisma.listingPhoto.create).not.toHaveBeenCalled();
  });

  it("rejects legacy issued paths because only the processor may publish", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(hostUser);
    prisma.listing.findFirst.mockResolvedValue(listingRecord);
    prisma.listingUploadIntent.updateMany.mockResolvedValue({ count: 1 });
    prisma.listingPhoto.aggregate.mockResolvedValue({
      _max: {
        displayOrder: 2
      }
    });
    prisma.listingPhoto.create.mockResolvedValue({
      id: "photo_3",
      storagePath: "listings/listing_1/issued-photo.jpg",
      fileUrl: "https://storage.example.com/issued-photo.jpg",
      displayOrder: 3
    });

    await expect(
      service.addListingPhoto("token", "listing_1", {
        storagePath: "listings/listing_1/issued-photo.jpg"
      })
    ).rejects.toMatchObject({
      response: {
        code: "MEDIA_PROCESSING_REQUIRED"
      }
    });
    expect(prisma.listingUploadIntent.updateMany).not.toHaveBeenCalled();
    expect(prisma.listingPhoto.create).not.toHaveBeenCalled();
  });

  it("rejects a duplicate requested photo display order without consuming the upload intent", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(hostUser);
    prisma.listing.findFirst.mockResolvedValue(listingRecord);
    prisma.listingPhoto.findFirst.mockResolvedValue({ id: "photo_1" });

    await expect(
      service.addListingPhoto("token", "listing_1", {
        storagePath: "listings/listing_1/issued-photo.jpg",
        displayOrder: 0
      })
    ).rejects.toMatchObject({
      response: {
        code: "MEDIA_PROCESSING_REQUIRED"
      }
    });
    expect(prisma.listingUploadIntent.updateMany).not.toHaveBeenCalled();
    expect(prisma.listingPhoto.create).not.toHaveBeenCalled();
  });

  it("does not expose internal storage paths in public listing details", async () => {
    const { service, prisma } = createService();
    prisma.listing.findFirst.mockResolvedValue({
      ...listingRecord,
      photos: [
        {
          id: "photo_1",
          storagePath: "listings/listing_1/private-photo.jpg",
          fileUrl: "https://storage.example.com/public-photo.jpg",
          displayOrder: 0
        }
      ]
    });

    const response = await service.getListing("listing_1");

    expect(response.photos[0]).toEqual({
      id: "photo_1",
      fileUrl: "https://storage.example.com/public-photo.jpg",
      displayOrder: 0,
      source: "processed"
    });
    expect(prisma.listing.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        photos: expect.objectContaining({
          where: {
            deletedAt: null,
            OR: [
              { legacyUnprocessed: true },
              { mediaAsset: { status: "ready" } }
            ]
          }
        })
      })
    }));
  });

  it("does not expose the address or exact coordinates in anonymous listing details", async () => {
    const { service, prisma } = createService();
    prisma.listing.findFirst.mockResolvedValue(listingRecord);

    const response = await service.getListing("listing_1");

    expect(response).not.toHaveProperty("address");
    expect(response).not.toHaveProperty("latitude");
    expect(response).not.toHaveProperty("longitude");
    expect(response.exactLocation).toBeNull();
    expect(response.publicLocation).toEqual({
      city: "Houston",
      latitude: 29.763,
      longitude: -95.3688,
      radiusMeters: 500,
      precision: "approximate"
    });
  });

  it("rebuilds public place URLs without a listing origin and omits address-like places", async () => {
    const { service, prisma } = createService();
    prisma.listing.findFirst.mockResolvedValue({
      ...listingRecord,
      places: [
        {
          id: "place_1",
          listingId: listingRecord.id,
          type: "neighborhood_perk",
          label: "Houston Methodist Hospital",
          googlePlaceId: "hospital_place_id",
          mapsUrl:
            "https://www.google.com/maps/dir/?api=1&origin=29.7604,-95.3698&destination=Hospital",
          displayOrder: 0,
          createdAt: now
        },
        {
          id: "place_2",
          listingId: listingRecord.id,
          type: "local_recommendation",
          label: "123 Main St",
          googlePlaceId: "listing_place_id",
          mapsUrl: "https://www.google.com/maps/search/?api=1&query=123+Main+St",
          displayOrder: 1,
          createdAt: now
        }
      ]
    });

    const response = await service.getListing("listing_1");

    expect(response.places).toHaveLength(1);
    const place = response.places[0];
    expect(place).toBeDefined();
    if (!place) {
      throw new Error("Expected a safe public place.");
    }
    expect(place).toMatchObject({
      id: "place_1",
      label: "Houston Methodist Hospital",
      googlePlaceId: "hospital_place_id"
    });
    const mapsUrl = new URL(place.mapsUrl);
    expect(mapsUrl.pathname).toBe("/maps/search/");
    expect(mapsUrl.searchParams.has("origin")).toBe(false);
    expect(place.mapsUrl).not.toContain("29.7604");
    expect(place.mapsUrl).not.toContain("123+Main+St");
  });

  it("returns exact location only to the listing owner or an admin", async () => {
    const { service, prisma, authService } = createService();
    prisma.listing.findFirst.mockResolvedValue(listingRecord);

    authService.getCurrentUserRecord.mockResolvedValue(renterUser);
    await expect(service.getListing("listing_1", "renter-token")).resolves.toMatchObject({
      exactLocation: null
    });

    authService.getCurrentUserRecord.mockResolvedValue(hostUser);
    await expect(service.getListing("listing_1", "host-token")).resolves.toMatchObject({
      exactLocation: {
        address: "123 Main St",
        latitude: 29.7604,
        longitude: -95.3698
      }
    });

    authService.getCurrentUserRecord.mockResolvedValue(adminUser);
    await expect(service.getListing("listing_1", "admin-token")).resolves.toMatchObject({
      exactLocation: {
        address: "123 Main St",
        latitude: 29.7604,
        longitude: -95.3698
      }
    });
  });

  it("returns a stable approximate location that differs from the exact location", async () => {
    const { service, prisma } = createService();
    prisma.listing.findFirst.mockResolvedValue(listingRecord);

    const first = await service.getListing("listing_1");
    const second = await service.getListing("listing_1");

    expect(first.publicLocation).toEqual(second.publicLocation);
    expect(first.publicLocation.latitude).not.toBe(Number(listingRecord.latitude));
    expect(first.publicLocation.longitude).not.toBe(Number(listingRecord.longitude));
  });

  it("re-geocodes an updated address and regenerates its public location", async () => {
    const mapsService = {
      geocodeAddress: jest.fn().mockResolvedValue({
        latitude: 29.75,
        longitude: -95.35
      })
    };
    const { service, prisma, authService } = createService(mapsService);
    authService.getCurrentUserRecord.mockResolvedValue(hostUser);
    prisma.listing.findFirst.mockResolvedValue(listingRecord);
    prisma.listing.update.mockImplementation(({ data }) =>
      Promise.resolve({
        ...listingRecord,
        address: data.address,
        latitude: data.latitude,
        longitude: data.longitude,
        publicLatitude: data.publicLatitude,
        publicLongitude: data.publicLongitude,
        publicRadiusMeters: data.publicRadiusMeters
      })
    );

    const response = await service.updateListing("token", "listing_1", {
      address: "456 New Address"
    });

    expect(mapsService.geocodeAddress).toHaveBeenCalledWith(
      "456 New Address, Houston"
    );
    expect(response.exactLocation).toEqual({
      address: "456 New Address",
      latitude: 29.75,
      longitude: -95.35
    });
    expect([
      response.publicLocation.latitude,
      response.publicLocation.longitude
    ]).not.toEqual([29.75, -95.35]);
    expect(response.publicLocation).not.toEqual({
      city: "Houston",
      timeZone: "America/Chicago",
      latitude: listingRecord.publicLatitude,
      longitude: listingRecord.publicLongitude,
      radiusMeters: 500,
      precision: "approximate"
    });
  });

  it("preserves an updated address but clears map coordinates when geocoding fails", async () => {
    const mapsService = {
      geocodeAddress: jest.fn().mockResolvedValue(null)
    };
    const { service, prisma, authService } = createService(mapsService);
    authService.getCurrentUserRecord.mockResolvedValue(hostUser);
    prisma.listing.findFirst.mockResolvedValue(listingRecord);
    prisma.listing.update.mockImplementation(({ data }) =>
      Promise.resolve({
        ...listingRecord,
        address: data.address,
        latitude: data.latitude,
        longitude: data.longitude,
        publicLatitude: data.publicLatitude,
        publicLongitude: data.publicLongitude,
        publicRadiusMeters: data.publicRadiusMeters
      })
    );

    const response = await service.updateListing("token", "listing_1", {
      address: "Unresolved Address"
    });

    expect(response.exactLocation).toEqual({
      address: "Unresolved Address",
      latitude: null,
      longitude: null
    });
    expect(response.publicLocation).toMatchObject({
      latitude: null,
      longitude: null
    });
  });

  it("ignores host-supplied coordinates and stores only server geocoding", async () => {
    const mapsService = {
      geocodeAddress: jest.fn().mockResolvedValue({
        latitude: 29.71,
        longitude: -95.41
      }),
      resolvePlace: jest.fn()
    };
    const { service, prisma, authService } = createService(mapsService);
    authService.getCurrentUserRecord.mockResolvedValue(hostUser);
    prisma.listing.create.mockResolvedValue({
      id: "listing_1",
      status: ListingStatus.pending
    });

    await service.createListing("token", {
      title: "Private room",
      description: "Clean furnished room.",
      city: "Houston",
      timeZone: "America/Chicago",
      address: "123 Main St",
      latitude: 1,
      longitude: 2,
      priceCents: 8000,
      priceUnit: "day",
      listingType: "private_room"
    });

    expect(prisma.listing.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          latitude: 29.71,
          longitude: -95.41,
          publicLatitude: expect.any(Number),
          publicLongitude: expect.any(Number),
          publicRadiusMeters: 500
        })
      })
    );
    const data = prisma.listing.create.mock.calls[0][0].data;
    expect([data.publicLatitude, data.publicLongitude]).not.toEqual([
      data.latitude,
      data.longitude
    ]);
    const latitudeMeters = (data.publicLatitude - data.latitude) * 111_320;
    const longitudeMeters =
      (data.publicLongitude - data.longitude) *
      111_320 *
      Math.cos((data.latitude * Math.PI) / 180);
    expect(Math.hypot(latitudeMeters, longitudeMeters)).toBeLessThanOrEqual(
      data.publicRadiusMeters
    );
  });

  it("allows a host to retrieve their own pending listing but hides it from other users", async () => {
    const { service, prisma, authService } = createService();
    const pendingListing = {
      ...listingRecord,
      status: ListingStatus.pending
    };

    authService.getCurrentUserRecord.mockResolvedValue(hostUser);
    prisma.listing.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(pendingListing);

    await expect(service.getListing("listing_1", "token")).resolves.toMatchObject({
      id: "listing_1",
      status: "pending"
    });

    authService.getCurrentUserRecord.mockResolvedValue(otherHostUser);
    prisma.listing.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(pendingListing);

    await expect(service.getListing("listing_1", "other-token")).rejects.toMatchObject({
      response: {
        code: "NOT_FOUND"
      }
    });
  });
});
