import { BadRequestException, ForbiddenException } from "@nestjs/common";
import {
  AdminActionType,
  AdminTargetType,
  ListingStatus,
  ListingType,
  PriceUnit,
  UserRole
} from "@prisma/client";
import type { AuthService } from "../src/auth/auth.service";
import { AdminService } from "../src/admin/admin.service";
import type { IdentityEligibilityService } from "../src/identity/identity-eligibility.service";
import type { PrismaService } from "../src/prisma/prisma.service";

const now = new Date("2026-07-10T00:00:00.000Z");

const adminUser = {
  id: "admin_user_1",
  supabaseUserId: "supabase-admin-1",
  email: "admin@example.com",
  emailVerifiedAt: now,
  firstName: "Avery",
  lastName: "Admin",
  displayName: "Avery A",
  healthcareRole: null,
  roles: [UserRole.admin],
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
  ...adminUser,
  id: "renter_user_1",
  supabaseUserId: "supabase-renter-1",
  email: "renter@example.com",
  roles: [UserRole.renter]
};

const pendingListing = {
  id: "listing_1",
  hostId: "host_user_1",
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
  status: ListingStatus.pending,
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
    lastName: "Host",
    displayName: "Maya H"
  },
  photos: []
};

function createService() {
  const prisma = {
    listing: {
      count: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn()
    },
    adminAction: {
      create: jest.fn()
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ emailVerifiedAt: now })
    },
    $executeRaw: jest.fn()
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
  const identityEligibility = { assertApproved: jest.fn() };
  const service = new AdminService(
    prismaWithTransaction as unknown as PrismaService,
    authService as unknown as AuthService,
    identityEligibility as unknown as IdentityEligibilityService
  );

  return { service, prisma, transaction, authService, identityEligibility };
}

describe("AdminService", () => {
  it("stops Admin operations when the shared auth boundary disables the Admin", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockRejectedValue(
      new ForbiddenException({
        code: "ACCOUNT_DISABLED",
        message: "This MediCN account is disabled.",
        details: {}
      })
    );

    await expect(service.listListings("token", {})).rejects.toMatchObject({
      response: { code: "ACCOUNT_DISABLED" }
    });
    expect(prisma.listing.findMany).not.toHaveBeenCalled();
  });

  it("blocks approval until the current address version is verified", async () => {
    const { service, prisma, authService, identityEligibility } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(adminUser);
    prisma.listing.findFirst.mockResolvedValue({
      ...pendingListing,
      location: {
        geocodeStatus: "failed",
        addressVersion: 2,
        verifiedAddressVersion: 1
      }
    });
    identityEligibility.assertApproved.mockResolvedValue(undefined);

    await expect(
      service.moderateListing("token", pendingListing.id, { status: "approved" })
    ).rejects.toMatchObject({ response: { code: "LISTING_LOCATION_NOT_READY" } });
    expect(prisma.listing.updateMany).not.toHaveBeenCalled();
  });

  it("blocks listing approval when the Host identity is not approved", async () => {
    const { service, prisma, authService, identityEligibility } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(adminUser);
    prisma.listing.findFirst.mockResolvedValue(pendingListing);
    identityEligibility.assertApproved.mockRejectedValue(
      new ForbiddenException({ code: "IDENTITY_VERIFICATION_PENDING" })
    );
    await expect(
      service.moderateListing("token", pendingListing.id, { status: "approved" })
    ).rejects.toMatchObject({ response: { code: "IDENTITY_VERIFICATION_PENDING" } });
    expect(prisma.listing.updateMany).not.toHaveBeenCalled();
  });

  it("lists pending listings for an administrator", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(adminUser);
    prisma.listing.count.mockResolvedValue(1);
    prisma.listing.findMany.mockResolvedValue([pendingListing]);

    await expect(service.listListings("token", {})).resolves.toMatchObject({
      data: [
        {
          id: "listing_1",
          status: "pending",
          host: {
            email: "host@example.com"
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
          status: ListingStatus.pending,
          deletedAt: null
        }
      })
    );
  });

  it("rejects listing moderation from a non-admin user", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(renterUser);

    await expect(service.listListings("token", {})).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(prisma.listing.findMany).not.toHaveBeenCalled();
  });

  it("approves a pending listing and records an audit action", async () => {
    const { service, prisma, authService, identityEligibility } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(adminUser);
    prisma.listing.findFirst.mockResolvedValue(pendingListing);
    prisma.listing.updateMany.mockResolvedValue({ count: 1 });
    prisma.listing.findUnique.mockResolvedValue({
      ...pendingListing,
      status: ListingStatus.approved
    });
    prisma.adminAction.create.mockResolvedValue({ id: "action_1" });

    await expect(
      service.moderateListing("token", "listing_1", {
        status: "approved",
        note: "Listing details reviewed."
      })
    ).resolves.toMatchObject({
      id: "listing_1",
      status: "approved"
    });

    expect(prisma.listing.updateMany).toHaveBeenCalledWith({
      where: {
        id: "listing_1",
        status: ListingStatus.pending,
        deletedAt: null
      },
      data: {
        status: ListingStatus.approved
      }
    });
    expect(identityEligibility.assertApproved).toHaveBeenCalledWith(
      pendingListing.hostId,
      prisma
    );
    expect(prisma.adminAction.create).toHaveBeenCalledWith({
      data: {
        adminId: adminUser.id,
        targetType: AdminTargetType.listing,
        targetId: "listing_1",
        action: AdminActionType.approve,
        note: "Listing details reviewed."
      }
    });
  });

  it("rejects approval when the Host email is unverified without side effects", async () => {
    const { service, prisma, authService, identityEligibility } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(adminUser);
    prisma.listing.findFirst.mockResolvedValue(pendingListing);
    prisma.user.findUnique.mockResolvedValue({ emailVerifiedAt: null });

    await expect(
      service.moderateListing("token", pendingListing.id, { status: "approved" })
    ).rejects.toMatchObject({ response: { code: "EMAIL_NOT_VERIFIED" } });
    expect(identityEligibility.assertApproved).not.toHaveBeenCalled();
    expect(prisma.listing.updateMany).not.toHaveBeenCalled();
    expect(prisma.adminAction.create).not.toHaveBeenCalled();
  });

  it("still permits rejection when the Host email is unverified", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(adminUser);
    prisma.listing.findFirst.mockResolvedValue(pendingListing);
    prisma.user.findUnique.mockResolvedValue({ emailVerifiedAt: null });
    prisma.listing.updateMany.mockResolvedValue({ count: 1 });
    prisma.adminAction.create.mockResolvedValue({ id: "action_1" });
    prisma.listing.findUnique.mockResolvedValue({
      ...pendingListing,
      status: ListingStatus.rejected
    });

    await expect(
      service.moderateListing("token", pendingListing.id, { status: "rejected" })
    ).resolves.toMatchObject({ status: ListingStatus.rejected });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("does not allow a listing to be moderated twice", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(adminUser);
    prisma.listing.findFirst.mockResolvedValue({
      ...pendingListing,
      status: ListingStatus.approved
    });

    await expect(
      service.moderateListing("token", "listing_1", { status: "rejected" })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.listing.updateMany).not.toHaveBeenCalled();
    expect(prisma.adminAction.create).not.toHaveBeenCalled();
  });
});
