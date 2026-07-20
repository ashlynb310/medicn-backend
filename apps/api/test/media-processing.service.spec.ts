import { ConfigService } from "@nestjs/config";
import { MediaAssetStatus, MediaPurpose, MediaVariantType } from "@prisma/client";
import type { JobsService } from "../src/jobs/jobs.service";
import type { ImageProcessorService } from "../src/media/image-processor.service";
import { MediaProcessingService } from "../src/media/media-processing.service";
import type { MediaStorage } from "../src/media/media-storage";
import type { PrismaService } from "../src/prisma/prisma.service";

const uploaded = {
  id: "asset_1",
  purpose: MediaPurpose.listing_photo,
  ownerUserId: "host_1",
  listingId: "listing_1",
  ingestBucket: "media-ingest",
  ingestStoragePath: "product-media/listing_photo/host_1/asset_1/photo.jpg",
  claimedContentType: "image/jpeg",
  status: MediaAssetStatus.uploaded,
  processingStartedAt: null,
  displayOrder: 0
};
const processing = { ...uploaded, status: MediaAssetStatus.processing, processingStartedAt: new Date() };

function createService() {
  const transaction = {
    $executeRaw: jest.fn(),
    mediaAsset: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    mediaVariant: { upsert: jest.fn(), updateMany: jest.fn() },
    healthcareVerificationEvidence: { update: jest.fn(), findUnique: jest.fn() },
    healthcareVerification: { update: jest.fn() },
    listingPhoto: { findFirst: jest.fn(), aggregate: jest.fn(), upsert: jest.fn(), updateMany: jest.fn() },
    user: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
    outboxEvent: { create: jest.fn(), findUnique: jest.fn() }
  };
  const prisma = {
    $transaction: jest.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    mediaAsset: { update: jest.fn(), updateMany: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() }
  };
  const jobs = { enqueue: jest.fn().mockResolvedValue({ id: "event_1" }) };
  const processor = { process: jest.fn() };
  const storage: jest.Mocked<MediaStorage> = {
    createSignedUploadUrl: jest.fn(), createSignedDownloadUrl: jest.fn(), exists: jest.fn(), info: jest.fn(),
    download: jest.fn(), upload: jest.fn(), remove: jest.fn(), publicUrl: jest.fn()
  };
  storage.publicUrl.mockImplementation((bucket, path) => `https://cdn/${bucket}/${path}`);
  const service = new MediaProcessingService(
    prisma as unknown as PrismaService,
    new ConfigService({
      MEDIA_MAX_INPUT_BYTES: 5_242_880,
      MEDIA_INGEST_RETENTION_HOURS: 24,
      SUPABASE_LISTING_MEDIA_BUCKET: "listing-photos",
      SUPABASE_PROFILE_MEDIA_BUCKET: "profile-photos"
    }),
    processor as unknown as ImageProcessorService,
    jobs as unknown as JobsService,
    storage
  );
  return { service, prisma, transaction, jobs, processor, storage };
}

describe("MediaProcessingService", () => {
  it("uses deterministic derivative paths and publishes only after every upload succeeds", async () => {
    const { service, transaction, processor, storage } = createService();
    transaction.mediaAsset.findUnique.mockResolvedValue(uploaded);
    transaction.mediaAsset.update.mockResolvedValue(processing);
    transaction.mediaAsset.findUniqueOrThrow.mockResolvedValue(processing);
    transaction.listingPhoto.findFirst.mockResolvedValue(null);
    storage.download.mockResolvedValue(Buffer.from("jpeg"));
    processor.process.mockResolvedValue({
      checksumSha256: "a".repeat(64), detectedContentType: "image/jpeg", detectedFormat: "jpeg",
      decodedWidth: 800, decodedHeight: 600,
      variants: [
        { type: MediaVariantType.listing_thumbnail, buffer: Buffer.from("thumb"), width: 480, height: 360, contentType: "image/webp", checksumSha256: "b".repeat(64) },
        { type: MediaVariantType.listing_display, buffer: Buffer.from("display"), width: 800, height: 600, contentType: "image/webp", checksumSha256: "c".repeat(64) }
      ]
    });

    await service.process("asset_1");
    expect(storage.download).toHaveBeenCalledWith("media-ingest", uploaded.ingestStoragePath, 5_242_880);
    expect(storage.upload.mock.calls.map(([bucket, path]) => [bucket, path])).toEqual([
      ["listing-photos", "media/asset_1/listing_thumbnail.webp"],
      ["listing-photos", "media/asset_1/listing_display.webp"]
    ]);
    expect(transaction.listingPhoto.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        mediaAssetId: "asset_1",
        fileUrl: "https://cdn/listing-photos/media/asset_1/listing_display.webp",
        legacyUnprocessed: false
      })
    }));
    expect(transaction.mediaAsset.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: MediaAssetStatus.ready })
    }));
  });

  it("returns transient worker failures to uploaded for a durable retry", async () => {
    const { service, prisma, transaction, processor, storage } = createService();
    transaction.mediaAsset.findUnique.mockResolvedValue(uploaded);
    transaction.mediaAsset.update.mockResolvedValue(processing);
    storage.download.mockResolvedValue(Buffer.from("jpeg"));
    processor.process.mockRejectedValue(new Error("decoder process crashed"));
    await expect(service.process("asset_1")).rejects.toThrow("decoder process crashed");
    expect(prisma.mediaAsset.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "asset_1", status: MediaAssetStatus.processing },
      data: expect.objectContaining({ status: MediaAssetStatus.uploaded, rejectionCode: "PROCESSING_FAILED" })
    }));
  });

  it("keeps a healthcare derivative private and removes the original immediately", async () => {
    const { service, transaction, processor, storage } = createService();
    const healthcareAsset = {
      ...uploaded,
      purpose: MediaPurpose.healthcare_credential,
      ownerUserId: "user_1",
      listingId: null,
      ingestBucket: "healthcare-credentials",
      ingestStoragePath: "healthcare-evidence/user_1/verification_1/evidence_1/original/asset_1/file.jpg",
      healthcareEvidence: {
        id: "evidence_1",
        healthcareVerificationId: "verification_1"
      }
    };
    const claimed = {
      ...healthcareAsset,
      status: MediaAssetStatus.processing,
      processingStartedAt: new Date()
    };
    transaction.mediaAsset.findUnique.mockResolvedValue(healthcareAsset);
    transaction.mediaAsset.update.mockResolvedValue(claimed);
    transaction.mediaAsset.findUniqueOrThrow.mockResolvedValue(claimed);
    storage.download.mockResolvedValue(Buffer.from("private credential"));
    storage.exists.mockResolvedValue(false);
    processor.process.mockResolvedValue({
      checksumSha256: "a".repeat(64),
      detectedContentType: "image/jpeg",
      detectedFormat: "jpeg",
      decodedWidth: 1200,
      decodedHeight: 800,
      variants: [{
        type: MediaVariantType.healthcare_review,
        buffer: Buffer.from("sanitized"),
        width: 1200,
        height: 800,
        contentType: "image/webp",
        checksumSha256: "b".repeat(64)
      }]
    });

    await service.process("asset_1");

    expect(storage.upload).toHaveBeenCalledWith(
      "healthcare-credentials",
      "healthcare-evidence/user_1/verification_1/evidence_1/review/asset_1.webp",
      expect.any(Buffer),
      "image/webp"
    );
    expect(storage.publicUrl).not.toHaveBeenCalled();
    expect(storage.remove).toHaveBeenCalledWith("healthcare-credentials", [
      healthcareAsset.ingestStoragePath
    ]);
    expect(transaction.healthcareVerificationEvidence.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "evidence_1" },
        data: expect.objectContaining({ sanitizedAt: expect.any(Date) })
      })
    );
  });
});
