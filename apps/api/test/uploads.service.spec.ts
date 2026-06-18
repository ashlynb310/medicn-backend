import {
  ForbiddenException,
  InternalServerErrorException
} from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { ListingStatus, UserRole } from "@prisma/client";
import type { AuthService } from "../src/auth/auth.service";
import type { PrismaService } from "../src/prisma/prisma.service";
import { UploadsService } from "../src/uploads/uploads.service";

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

const otherHostUser = {
  ...hostUser,
  id: "host_user_2",
  supabaseUserId: "supabase-host-2",
  email: "other-host@example.com"
};

const listingRecord = {
  id: "listing_1",
  hostId: hostUser.id,
  status: ListingStatus.pending,
  deletedAt: null
};

function createService() {
  const prisma = {
    listing: {
      findFirst: jest.fn()
    }
  };
  const authService = {
    getCurrentUserRecord: jest.fn()
  };
  const config = {
    get: jest.fn((key: string) => {
      if (key === "NEXT_PUBLIC_SUPABASE_URL") {
        return "https://project.supabase.co";
      }

      if (key === "SUPABASE_SECRET_KEY") {
        return "sb_secret_test";
      }

      if (key === "SUPABASE_STORAGE_BUCKET") {
        return "listing-photos";
      }

      return undefined;
    })
  };
  const storageBucket = {
    createSignedUploadUrl: jest.fn()
  };
  const supabase = {
    storage: {
      from: jest.fn(() => storageBucket)
    }
  };
  const service = new UploadsService(
    prisma as unknown as PrismaService,
    authService as unknown as AuthService,
    config as unknown as ConfigService
  );

  (
    service as unknown as {
      supabase: typeof supabase;
    }
  ).supabase = supabase;

  return { service, prisma, authService, supabase, storageBucket };
}

describe("UploadsService", () => {
  it("creates a controlled signed upload URL for a host-owned listing photo", async () => {
    const { service, prisma, authService, supabase, storageBucket } =
      createService();
    authService.getCurrentUserRecord.mockResolvedValue(hostUser);
    prisma.listing.findFirst.mockResolvedValue(listingRecord);
    storageBucket.createSignedUploadUrl.mockResolvedValue({
      data: {
        signedUrl: "https://project.supabase.co/signed-upload",
        path: "listings/listing_1/generated-living-room.jpg"
      },
      error: null
    });

    await expect(
      service.createPresignedUploadUrl("token", {
        purpose: "listing_photo",
        listingId: "listing_1",
        fileName: "living room.jpg",
        contentType: "image/jpeg"
      })
    ).resolves.toMatchObject({
      uploadUrl: "https://project.supabase.co/signed-upload",
      fileUrl: expect.stringContaining(
        "https://project.supabase.co/storage/v1/object/public/listing-photos/listings/listing_1/"
      ),
      storagePath: expect.stringMatching(
        /^listings\/listing_1\/[a-f0-9-]+-living-room\.jpg$/
      )
    });
    expect(supabase.storage.from).toHaveBeenCalledWith("listing-photos");
    expect(storageBucket.createSignedUploadUrl).toHaveBeenCalledWith(
      expect.stringMatching(/^listings\/listing_1\/[a-f0-9-]+-living-room\.jpg$/)
    );
  });

  it("rejects upload URL creation for hosts who do not own the listing", async () => {
    const { service, prisma, authService, storageBucket } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(otherHostUser);
    prisma.listing.findFirst.mockResolvedValue(listingRecord);

    await expect(
      service.createPresignedUploadUrl("token", {
        purpose: "listing_photo",
        listingId: "listing_1",
        fileName: "living-room.jpg",
        contentType: "image/jpeg"
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(storageBucket.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("fails safely when Supabase Storage is not configured", async () => {
    const { service, prisma, authService } = createService();
    authService.getCurrentUserRecord.mockResolvedValue(hostUser);
    prisma.listing.findFirst.mockResolvedValue(listingRecord);
    (
      service as unknown as {
        supabase: null;
      }
    ).supabase = null;

    await expect(
      service.createPresignedUploadUrl("token", {
        purpose: "listing_photo",
        listingId: "listing_1",
        fileName: "living-room.jpg",
        contentType: "image/jpeg"
      })
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
