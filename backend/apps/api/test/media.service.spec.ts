import { ConfigService } from "@nestjs/config";
import { MediaAssetStatus, MediaPurpose, UserRole, type User } from "@prisma/client";
import type { JobsService } from "../src/jobs/jobs.service";
import type { MediaStorage } from "../src/media/media-storage";
import { MediaService } from "../src/media/media.service";
import type { PrismaService } from "../src/prisma/prisma.service";

const user = { id: "user_1", roles: [UserRole.host] } as User;
const future = new Date("2099-01-01T00:00:00.000Z");

function asset(status: MediaAssetStatus) {
  return {
    id: "asset_1",
    ownerUserId: user.id,
    purpose: MediaPurpose.profile_photo,
    listingId: null,
    ingestBucket: "media-ingest",
    ingestStoragePath: "product-media/profile_photo/user_1/asset_1/photo.jpg",
    status,
    expiresAt: future,
    uploadedAt: status === MediaAssetStatus.pending_upload ? null : new Date(),
    processedAt: null,
    rejectionCode: null,
    variants: []
  };
}

function createService() {
  const transaction = {
    $executeRaw: jest.fn(),
    mediaAsset: {
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn()
    },
    outboxEvent: { create: jest.fn(), findUnique: jest.fn() }
  };
  const prisma = {
    mediaAsset: { findUnique: jest.fn(), updateMany: jest.fn() },
    listing: { findFirst: jest.fn() },
    $transaction: jest.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction))
  };
  const jobs = { enqueue: jest.fn().mockResolvedValue({ id: "outbox_1" }) };
  const storage: jest.Mocked<MediaStorage> = {
    createSignedUploadUrl: jest.fn(),
    createSignedDownloadUrl: jest.fn(),
    exists: jest.fn(),
    info: jest.fn(),
    download: jest.fn(),
    upload: jest.fn(),
    remove: jest.fn(),
    publicUrl: jest.fn()
  };
  const service = new MediaService(
    prisma as unknown as PrismaService,
    new ConfigService({ MEDIA_MAX_INPUT_BYTES: 5_242_880 }),
    jobs as unknown as JobsService,
    storage
  );
  return { service, prisma, transaction, jobs, storage };
}

describe("MediaService", () => {
  it("atomically completes an intent and writes one stable processing outbox event", async () => {
    const { service, prisma, transaction, jobs, storage } = createService();
    prisma.mediaAsset.findUnique
      .mockResolvedValueOnce(asset(MediaAssetStatus.pending_upload))
      .mockResolvedValueOnce(asset(MediaAssetStatus.uploaded));
    transaction.mediaAsset.findUniqueOrThrow.mockResolvedValue(asset(MediaAssetStatus.pending_upload));
    storage.exists.mockResolvedValue(true);
    storage.info.mockResolvedValue({ size: 1200, contentType: "image/jpeg" });

    await expect(service.completeIntent(user, "asset_1")).resolves.toMatchObject({
      id: "asset_1",
      status: MediaAssetStatus.uploaded
    });
    expect(transaction.mediaAsset.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "asset_1" },
      data: expect.objectContaining({ status: MediaAssetStatus.uploaded, originalByteSize: 1200 })
    }));
    expect(jobs.enqueue).toHaveBeenCalledWith(
      "process_media_asset",
      { assetId: "asset_1" },
      expect.objectContaining({ deduplicationKey: "media-process:asset_1" })
    );
  });

  it("makes repeated completion idempotent without rechecking storage", async () => {
    const { service, prisma, jobs, storage } = createService();
    prisma.mediaAsset.findUnique.mockResolvedValue(asset(MediaAssetStatus.uploaded));
    await expect(service.completeIntent(user, "asset_1")).resolves.toMatchObject({
      status: MediaAssetStatus.uploaded
    });
    expect(storage.exists).not.toHaveBeenCalled();
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it("does not reveal another user's asset state", async () => {
    const { service, prisma } = createService();
    prisma.mediaAsset.findUnique.mockResolvedValue({
      ...asset(MediaAssetStatus.processing),
      ownerUserId: "other_user"
    });
    await expect(service.getIntent(user, "asset_1")).rejects.toMatchObject({
      response: { code: "FORBIDDEN" }
    });
  });

  it("does not expose healthcare evidence through generic media endpoints", async () => {
    const { service, prisma, storage } = createService();
    prisma.mediaAsset.findUnique.mockResolvedValue({
      ...asset(MediaAssetStatus.ready),
      purpose: MediaPurpose.healthcare_credential,
      variants: [{
        type: "healthcare_review",
        storageBucket: "healthcare-credentials",
        storagePath: "private/review.webp",
        width: 800,
        height: 600,
        contentType: "image/webp"
      }]
    });

    await expect(service.getIntent(user, "asset_1")).rejects.toMatchObject({
      response: { code: "NOT_FOUND" }
    });
    expect(storage.publicUrl).not.toHaveBeenCalled();
  });

  it("rejects listing upload intents for a host who does not own the listing", async () => {
    const { service, prisma, storage } = createService();
    prisma.listing.findFirst.mockResolvedValue({ id: "listing_1", hostId: "other_host" });
    await expect(service.createIntent(user, {
      purpose: MediaPurpose.listing_photo,
      listingId: "listing_1",
      fileName: "room.jpg",
      contentType: "image/jpeg"
    })).rejects.toMatchObject({ response: { code: "FORBIDDEN" } });
    expect(storage.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects and schedules cleanup for an expired completion", async () => {
    const { service, prisma, transaction, jobs, storage } = createService();
    prisma.mediaAsset.findUnique.mockResolvedValue({
      ...asset(MediaAssetStatus.pending_upload),
      expiresAt: new Date("2000-01-01T00:00:00.000Z")
    });
    await expect(service.completeIntent(user, "asset_1")).rejects.toMatchObject({
      response: { code: "MEDIA_UPLOAD_EXPIRED" }
    });
    expect(transaction.mediaAsset.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: MediaAssetStatus.rejected, rejectionCode: "UPLOAD_EXPIRED" })
    }));
    expect(jobs.enqueue).toHaveBeenCalledWith(
      "cleanup_media_asset",
      { assetId: "asset_1" },
      expect.objectContaining({ deduplicationKey: "media-cleanup:asset_1" })
    );
    expect(storage.exists).not.toHaveBeenCalled();
  });
});
