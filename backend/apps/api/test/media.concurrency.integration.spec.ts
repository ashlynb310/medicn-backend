import { ConfigService } from "@nestjs/config";
import { MediaAssetStatus, MediaPurpose, MediaVariantType } from "@prisma/client";
import { JobsService } from "../src/jobs/jobs.service";
import type { ImageProcessorService } from "../src/media/image-processor.service";
import { MediaProcessingService } from "../src/media/media-processing.service";
import type { MediaStorage } from "../src/media/media-storage";
import { MediaService } from "../src/media/media.service";
import { PrismaService } from "../src/prisma/prisma.service";

const describeWithDatabase =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? describe : describe.skip;

describeWithDatabase("Media PostgreSQL concurrency", () => {
  const suffix = `${Date.now()}`;
  let prisma: PrismaService;
  let userId: string;
  let assetId: string;
  let media: MediaService;
  let processing: MediaProcessingService;
  const storage: jest.Mocked<MediaStorage> = {
    createSignedUploadUrl: jest.fn(),
    createSignedDownloadUrl: jest.fn(),
    exists: jest.fn().mockResolvedValue(true),
    info: jest.fn().mockResolvedValue({ size: 2048, contentType: "image/jpeg" }),
    download: jest.fn().mockResolvedValue(Buffer.from("private-ingest-object")),
    upload: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    publicUrl: jest.fn((bucket, path) => `https://cdn.example/${bucket}/${path}`)
  };

  beforeAll(async () => {
    if (!process.env.DATABASE_URL || !/^postgres(ql)?:\/\//.test(process.env.DATABASE_URL)) {
      throw new Error("RUN_DATABASE_INTEGRATION_TESTS requires a PostgreSQL DATABASE_URL.");
    }
    prisma = new PrismaService();
    await prisma.$connect();
    const user = await prisma.user.create({
      data: {
        supabaseUserId: `media-integration-${suffix}`,
        email: `media-integration-${suffix}@example.com`,
        emailVerifiedAt: new Date(),
        roles: ["renter"]
      }
    });
    userId = user.id;
    const asset = await prisma.mediaAsset.create({
      data: {
        purpose: MediaPurpose.profile_photo,
        ownerUserId: user.id,
        ingestBucket: "media-ingest",
        ingestStoragePath: `product-media/profile_photo/${user.id}/${suffix}/photo.jpg`,
        claimedFileName: "photo.jpg",
        claimedContentType: "image/jpeg",
        expiresAt: new Date(Date.now() + 60_000)
      }
    });
    assetId = asset.id;
    const config = new ConfigService({
      MEDIA_MAX_INPUT_BYTES: 5_242_880,
      MEDIA_INGEST_RETENTION_HOURS: 24,
      SUPABASE_PROFILE_MEDIA_BUCKET: "profile-photos"
    });
    const jobs = new JobsService(prisma);
    media = new MediaService(prisma, config, jobs, storage);
    const processor = {
      process: jest.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return {
          checksumSha256: "a".repeat(64),
          detectedContentType: "image/jpeg",
          detectedFormat: "jpeg",
          decodedWidth: 600,
          decodedHeight: 600,
          variants: [
            [MediaVariantType.profile_small, 96],
            [MediaVariantType.profile_medium, 256],
            [MediaVariantType.profile_large, 512]
          ].map(([type, size]) => ({
            type,
            buffer: Buffer.from(String(type)),
            width: size,
            height: size,
            contentType: "image/webp" as const,
            checksumSha256: "b".repeat(64)
          }))
        };
      })
    };
    processing = new MediaProcessingService(
      prisma,
      config,
      processor as unknown as ImageProcessorService,
      jobs,
      storage
    );
  });

  afterAll(async () => {
    if (prisma && userId) {
      await prisma.user.update({
        where: { id: userId },
        data: { activeProfileMediaAssetId: null, profilePhotoUrl: null }
      });
      await prisma.mediaVariant.deleteMany({ where: { mediaAssetId: assetId } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: assetId } });
      await prisma.mediaAsset.deleteMany({ where: { id: assetId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await prisma?.$disconnect();
  });

  it("creates one uploaded transition and one stable outbox event under concurrent completion", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const results = await Promise.all([
      media.completeIntent(user, assetId),
      media.completeIntent(user, assetId)
    ]);
    expect(results.every(({ status }) => status === MediaAssetStatus.uploaded)).toBe(true);
    await expect(prisma.outboxEvent.count({
      where: { idempotencyKey: `media-process:${assetId}` }
    })).resolves.toBe(1);
  });

  it("allows only one processing claim and deterministic publication", async () => {
    await Promise.all([processing.process(assetId), processing.process(assetId)]);
    const asset = await prisma.mediaAsset.findUniqueOrThrow({
      where: { id: assetId },
      include: { variants: true }
    });
    expect(asset.status).toBe(MediaAssetStatus.ready);
    expect(asset.processingAttempts).toBe(1);
    expect(asset.variants).toHaveLength(3);
    expect(storage.download).toHaveBeenCalledTimes(1);
    expect(storage.upload).toHaveBeenCalledTimes(3);
  });
});
