import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  MediaAssetStatus,
  MediaPurpose,
  MediaVariantType,
  Prisma
} from "@prisma/client";
import { JobsService } from "../jobs/jobs.service";
import { PrismaService } from "../prisma/prisma.service";
import { ImageProcessorService, MediaRejectedError } from "./image-processor.service";
import { MEDIA_STORAGE, type MediaStorage } from "./media-storage";
import { CLEANUP_MEDIA_ASSET_JOB, type ProcessedVariant } from "./media.types";

const STALE_PROCESSING_MS = 15 * 60 * 1000;

@Injectable()
export class MediaProcessingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly processor: ImageProcessorService,
    private readonly jobs: JobsService,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage
  ) {}

  async process(assetId: string) {
    const asset = await this.claim(assetId);
    if (!asset) return;
    try {
      const input = await this.storage.download(
        asset.ingestBucket,
        asset.ingestStoragePath,
        this.maxInputBytes(asset.purpose)
      );
      const processed = await this.processor.process(
        input,
        asset.purpose,
        asset.claimedContentType
      );
      const bucket = asset.purpose === MediaPurpose.listing_photo
        ? this.listingBucket()
        : asset.purpose === MediaPurpose.healthcare_credential
          ? this.healthcareBucket()
          : this.profileBucket();
      const persisted: Array<ProcessedVariant & {
        storageBucket: string;
        storagePath: string;
      }> = [];
      for (const variant of processed.variants) {
        const storagePath = asset.purpose === MediaPurpose.healthcare_credential
          ? this.healthcareReviewPath(asset, variant.type)
          : `media/${asset.id}/${variant.type}.webp`;
        await this.storage.upload(bucket, storagePath, variant.buffer, variant.contentType);
        persisted.push({ ...variant, storageBucket: bucket, storagePath });
      }

      await this.prisma.$transaction(async (transaction) => {
        await this.lock(transaction, `media-asset:${asset.id}`);
        const current = await transaction.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
        if (current.status === MediaAssetStatus.ready) return;
        if (current.status !== MediaAssetStatus.processing) return;
        for (const variant of persisted) {
          await transaction.mediaVariant.upsert({
            where: { mediaAssetId_type: { mediaAssetId: asset.id, type: variant.type } },
            create: {
              mediaAssetId: asset.id,
              type: variant.type,
              storageBucket: variant.storageBucket,
              storagePath: variant.storagePath,
              width: variant.width,
              height: variant.height,
              byteSize: variant.buffer.length,
              contentType: variant.contentType,
              checksumSha256: variant.checksumSha256
            },
            update: {
              storageBucket: variant.storageBucket,
              storagePath: variant.storagePath,
              width: variant.width,
              height: variant.height,
              byteSize: variant.buffer.length,
              contentType: variant.contentType,
              checksumSha256: variant.checksumSha256,
              deletedAt: null
            }
          });
        }

        if (asset.purpose === MediaPurpose.listing_photo && asset.listingId) {
          const display = persisted.find(({ type }) => type === MediaVariantType.listing_display)!;
          const order = await this.availableOrder(transaction, asset.listingId, asset.displayOrder ?? 0);
          await transaction.listingPhoto.upsert({
            where: { mediaAssetId: asset.id },
            create: {
              listingId: asset.listingId,
              mediaAssetId: asset.id,
              storagePath: display.storagePath,
              fileUrl: this.storage.publicUrl(display.storageBucket, display.storagePath),
              displayOrder: order,
              legacyUnprocessed: false
            },
            update: { deletedAt: null }
          });
        } else if (asset.purpose === MediaPurpose.profile_photo) {
          const display = persisted.find(({ type }) => type === MediaVariantType.profile_medium)!;
          const owner = await transaction.user.findUniqueOrThrow({
            where: { id: asset.ownerUserId },
            select: { activeProfileMediaAssetId: true }
          });
          if (owner.activeProfileMediaAssetId && owner.activeProfileMediaAssetId !== asset.id) {
            const now = new Date();
            await transaction.mediaAsset.updateMany({
              where: { id: owner.activeProfileMediaAssetId, status: { not: MediaAssetStatus.deleted } },
              data: { status: MediaAssetStatus.deleted, deletedAt: now, cleanupRequestedAt: now }
            });
            await this.queueCleanup(transaction, owner.activeProfileMediaAssetId);
          }
          await transaction.user.update({
            where: { id: asset.ownerUserId },
            data: {
              activeProfileMediaAssetId: asset.id,
              profilePhotoUrl: this.storage.publicUrl(display.storageBucket, display.storagePath)
            }
          });
        } else {
          if (!asset.healthcareEvidence) {
            throw new Error("Healthcare media asset is missing its evidence binding.");
          }
          await transaction.healthcareVerificationEvidence.update({
            where: { id: asset.healthcareEvidence.id },
            data: { sanitizedAt: new Date() }
          });
        }

        const processedAt = new Date();
        await transaction.mediaAsset.update({
          where: { id: asset.id },
          data: {
            status: MediaAssetStatus.ready,
            detectedContentType: processed.detectedContentType,
            detectedFormat: processed.detectedFormat,
            originalByteSize: input.length,
            decodedWidth: processed.decodedWidth,
            decodedHeight: processed.decodedHeight,
            checksumSha256: processed.checksumSha256,
            processedAt,
            failedAt: null,
            rejectionCode: null,
            rejectionReason: null
          }
        });
        await this.jobs.enqueue(CLEANUP_MEDIA_ASSET_JOB, { assetId: asset.id }, {
          aggregateId: asset.id,
          aggregateType: "media_asset",
          client: transaction,
          deduplicationKey: `media-ingest-retention:${asset.id}`,
          availableAt: asset.purpose === MediaPurpose.healthcare_credential
            ? processedAt
            : new Date(processedAt.getTime() + this.retentionHours() * 3_600_000),
          maxAttempts: 5
        });
      });
      if (asset.purpose === MediaPurpose.healthcare_credential) {
        await this.removeAndConfirmIngest(asset);
      }
    } catch (error) {
      if (error instanceof MediaRejectedError || (error instanceof Error && error.message === "MEDIA_INPUT_TOO_LARGE")) {
        const rejected = error instanceof MediaRejectedError
          ? error
          : new MediaRejectedError("INPUT_TOO_LARGE", "Image exceeds the byte limit.");
        await this.reject(asset.id, rejected);
        return;
      }
      await this.prisma.mediaAsset.updateMany({
        where: { id: asset.id, status: MediaAssetStatus.processing },
        data: {
          status: MediaAssetStatus.uploaded,
          failedAt: new Date(),
          rejectionCode: "PROCESSING_FAILED",
          rejectionReason: "Media processing failed and may be retried."
        }
      });
      throw error;
    }
  }

  async cleanup(assetId: string) {
    const asset = await this.prisma.mediaAsset.findUnique({
      where: { id: assetId },
      include: { variants: true }
    });
    if (!asset) return;
    const retentionCutoff = new Date(Date.now() - this.retentionHours() * 3_600_000);
    if (
      asset.status === MediaAssetStatus.ready &&
      asset.purpose !== MediaPurpose.healthcare_credential &&
      (!asset.processedAt || asset.processedAt > retentionCutoff)
    ) return;
    const expiredPending = asset.status === MediaAssetStatus.pending_upload && asset.expiresAt <= new Date();
    if (expiredPending) {
      await this.prisma.mediaAsset.update({
        where: { id: asset.id },
        data: {
          status: MediaAssetStatus.rejected,
          rejectionCode: "UPLOAD_EXPIRED",
          rejectionReason: "The upload intent expired before completion.",
          failedAt: new Date()
        }
      });
    }
    const removeDerivatives = expiredPending || asset.status === MediaAssetStatus.deleted || asset.status === MediaAssetStatus.rejected;
    if (!asset.ingestDeletedAt) {
      await this.storage.remove(asset.ingestBucket, [asset.ingestStoragePath]);
      if (await this.storage.exists(asset.ingestBucket, asset.ingestStoragePath)) {
        throw new Error("MEDIA_STORAGE_DELETE_NOT_CONFIRMED");
      }
    }
    if (removeDerivatives) {
      for (const group of this.groupVariantPaths(asset.variants)) {
        await this.storage.remove(group.bucket, group.paths);
      }
    }
    await this.prisma.$transaction(async (transaction) => {
      const now = new Date();
      await transaction.mediaAsset.update({
        where: { id: asset.id },
        data: { ingestDeletedAt: now, cleanupRequestedAt: null }
      });
      if (removeDerivatives) {
        await transaction.mediaVariant.updateMany({
          where: { mediaAssetId: asset.id, deletedAt: null },
          data: { deletedAt: now }
        });
      }
    });
  }

  async recover(limit: number) {
    const stale = new Date(Date.now() - STALE_PROCESSING_MS);
    const assets = await this.prisma.mediaAsset.findMany({
      where: {
        OR: [
          { status: MediaAssetStatus.uploaded },
          { status: MediaAssetStatus.processing, processingStartedAt: { lt: stale } }
        ]
      },
      orderBy: { updatedAt: "asc" },
      take: limit,
      select: { id: true }
    });
    for (const asset of assets) await this.process(asset.id);
    return assets.length;
  }

  async cleanupDue(limit: number) {
    const cutoff = new Date(Date.now() - this.retentionHours() * 3_600_000);
    const assets = await this.prisma.mediaAsset.findMany({
      where: {
        ingestDeletedAt: null,
        OR: [
          { status: { in: [MediaAssetStatus.deleted, MediaAssetStatus.rejected] } },
          { status: MediaAssetStatus.ready, processedAt: { lte: cutoff } },
          { status: MediaAssetStatus.pending_upload, expiresAt: { lte: new Date() } }
        ]
      },
      take: limit,
      select: { id: true }
    });
    for (const asset of assets) await this.cleanup(asset.id);
    return assets.length;
  }

  private async claim(assetId: string) {
    const stale = new Date(Date.now() - STALE_PROCESSING_MS);
    return this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, `media-asset:${assetId}`);
      const asset = await transaction.mediaAsset.findUnique({ where: { id: assetId } });
      if (!asset) return null;
      const claimable = asset.status === MediaAssetStatus.uploaded ||
        (asset.status === MediaAssetStatus.processing && !!asset.processingStartedAt && asset.processingStartedAt < stale);
      if (!claimable) return null;
      return transaction.mediaAsset.update({
        where: { id: asset.id },
        data: {
          status: MediaAssetStatus.processing,
          processingStartedAt: new Date(),
          processingAttempts: { increment: 1 }
        },
        include: { healthcareEvidence: true }
      });
    });
  }

  private async reject(assetId: string, error: MediaRejectedError) {
    await this.prisma.$transaction(async (transaction) => {
      const asset = await transaction.mediaAsset.findUnique({
        where: { id: assetId },
        include: { healthcareEvidence: true }
      });
      await transaction.mediaAsset.updateMany({
        where: { id: assetId, status: MediaAssetStatus.processing },
        data: {
          status: MediaAssetStatus.rejected,
          rejectionCode: error.code,
          rejectionReason: error.message,
          failedAt: new Date(),
          cleanupRequestedAt: new Date()
        }
      });
      if (asset?.healthcareEvidence) {
        await transaction.healthcareVerification.update({
          where: { id: asset.healthcareEvidence.healthcareVerificationId },
          data: { submissionStatus: "processing_failed" }
        });
        await transaction.healthcareVerificationEvidence.update({
          where: { id: asset.healthcareEvidence.id },
          data: { deletionRequestedAt: new Date() }
        });
      }
      await this.queueCleanup(transaction, assetId);
    });
  }

  private async removeAndConfirmIngest(asset: {
    id: string;
    ingestBucket: string;
    ingestStoragePath: string;
  }) {
    await this.storage.remove(asset.ingestBucket, [asset.ingestStoragePath]);
    if (await this.storage.exists(asset.ingestBucket, asset.ingestStoragePath)) {
      throw new Error("MEDIA_STORAGE_DELETE_NOT_CONFIRMED");
    }
    await this.prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { ingestDeletedAt: new Date(), cleanupRequestedAt: null }
    });
  }

  private healthcareReviewPath(
    asset: {
      id: string;
      ownerUserId: string;
      healthcareEvidence: { id: string; healthcareVerificationId: string } | null;
    },
    type: MediaVariantType
  ) {
    if (!asset.healthcareEvidence || type !== MediaVariantType.healthcare_review) {
      throw new Error("Invalid healthcare evidence derivative.");
    }
    return [
      "healthcare-evidence",
      asset.ownerUserId,
      asset.healthcareEvidence.healthcareVerificationId,
      asset.healthcareEvidence.id,
      "review",
      `${asset.id}.webp`
    ].join("/");
  }

  private queueCleanup(transaction: Prisma.TransactionClient, assetId: string) {
    return this.jobs.enqueue(CLEANUP_MEDIA_ASSET_JOB, { assetId }, {
      aggregateId: assetId,
      aggregateType: "media_asset",
      client: transaction,
      deduplicationKey: `media-cleanup:${assetId}`,
      maxAttempts: 5
    });
  }

  private async availableOrder(transaction: Prisma.TransactionClient, listingId: string, preferred: number) {
    const conflict = await transaction.listingPhoto.findFirst({ where: { listingId, displayOrder: preferred } });
    if (!conflict) return preferred;
    const aggregate = await transaction.listingPhoto.aggregate({ where: { listingId }, _max: { displayOrder: true } });
    return (aggregate._max.displayOrder ?? -1) + 1;
  }

  private groupVariantPaths(variants: Array<{ storageBucket: string; storagePath: string }>) {
    const groups = new Map<string, string[]>();
    for (const variant of variants) groups.set(variant.storageBucket, [...(groups.get(variant.storageBucket) ?? []), variant.storagePath]);
    return [...groups.entries()].map(([bucket, paths]) => ({ bucket, paths }));
  }

  private lock(transaction: Prisma.TransactionClient, key: string) {
    return transaction.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  }
  private maxInputBytes(purpose: MediaPurpose) {
    return purpose === MediaPurpose.healthcare_credential
      ? this.config.get<number>("HEALTHCARE_EVIDENCE_MAX_INPUT_BYTES") ?? 10_485_760
      : this.config.get<number>("MEDIA_MAX_INPUT_BYTES") ?? 5_242_880;
  }
  private retentionHours() { return this.config.get<number>("MEDIA_INGEST_RETENTION_HOURS") ?? 24; }
  private listingBucket() { return this.config.get<string>("SUPABASE_LISTING_MEDIA_BUCKET") ?? "listing-photos"; }
  private profileBucket() { return this.config.get<string>("SUPABASE_PROFILE_MEDIA_BUCKET") ?? "profile-photos"; }
  private healthcareBucket() { return this.config.get<string>("SUPABASE_HEALTHCARE_EVIDENCE_BUCKET") ?? "healthcare-credentials"; }
}
