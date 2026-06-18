import { BadRequestException, ForbiddenException } from "@nestjs/common";
import {
  ListingStatus,
  ListingType,
  PriceUnit,
  StayDuration,
  UserRole
} from "@prisma/client";
import type { AuthService } from "../src/auth/auth.service";
import { ListingsService } from "../src/listings/listings.service";
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

const listingRecord = {
  id: "listing_1",
  hostId: hostUser.id,
  title: "Private room near hospital",
  description: "Clean furnished room for medical travelers.",
  city: "Houston",
  address: "123 Main St",
  latitude: null,
  longitude: null,
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

function createService() {
  const prisma = {
    listing: {
      count: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn()
    },
    listingPhoto: {
      create: jest.fn()
    }
  };
  const authService = {
    getCurrentUserRecord: jest.fn()
  };
  const service = new ListingsService(
    prisma as unknown as PrismaService,
    authService as unknown as AuthService
  );

  return { service, prisma, authService };
}

describe("ListingsService", () => {
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
              displayOrder: 0
            },
            {
              type: "local_recommendation",
              label: "Houston Zoo",
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
});
