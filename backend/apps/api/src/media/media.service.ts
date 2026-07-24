import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ListingStatus,
  MediaAssetStatus,
  MediaPurpose,
  Prisma,
  UserRole,
  type MediaAsset,
  type User
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { JobsService } from "../jobs/jobs.service";
import { PrismaService } from "../prisma/prisma.service";
import { MEDIA_STORAGE, type MediaStorage } from "./media-storage";
import {
  CLEANUP_MEDIA_ASSET_JOB,
  PROCESS_MEDIA_ASSET_JOB,
  type CreateMediaIntentInput
} from "./media.types";

const INTENT_TTL_MS = 60 * 60 * 1000;
const MAX_OUTSTANDING_INTENTS = 10;

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly jobs: JobsService,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage
  ) {}

  async createIntent(user: User, input: CreateMediaIntentInput) {
    const listing = input.purpose === MediaPurpose.listing_photo
      ? await this.authorizedListing(user, input.listingId)
      : null;
    const assetId = randomUUID();
    const fileName = this.safeFileName(input.fileName);
    const ingestBucket = this.ingestBucket();
    const storagePath = [
      "product-media",
      input.purpose,
      user.id,
      assetId,
      fileName
    ].join("/");
    const expiresAt = new Date(Date.now() + INTENT_TTL_MS);

    const asset = await this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, `media-intent:${user.id}`);
      const outstanding = await transaction.mediaAsset.count({
        where: {
          ownerUserId: user.id,
          purpose: input.purpose,
          ...(listing ? { listingId: listing.id } : {}),
          status: {
            in: [
              MediaAssetStatus.pending_upload,
              MediaAssetStatus.uploaded,
              MediaAssetStatus.processing
            ]
          }
        }
      });
      if (outstanding >= MAX_OUTSTANDING_INTENTS) {
        throw new HttpException({
          code: "MEDIA_UPLOAD_LIMIT_REACHED",
          message: "Too many media uploads are pending.",
          details: {}
        }, HttpStatus.TOO_MANY_REQUESTS);
      }

      const displayOrder = listing
        ? await this.nextDisplayOrder(transaction, listing.id)
        : null;
      return transaction.mediaAsset.create({
        data: {
          id: assetId,
          purpose: input.purpose,
          ownerUserId: user.id,
          listingId: listing?.id ?? null,
          ingestBucket,
          ingestStoragePath: storagePath,
          claimedFileName: input.fileName.trim(),
          claimedContentType: input.contentType,
          displayOrder,
          expiresAt
        }
      });
    });

    const uploadUrl = await this.storage.createSignedUploadUrl(
      asset.ingestBucket,
      asset.ingestStoragePath
    );
    return {
      uploadIntentId: asset.id,
      uploadUrl,
      storagePath: asset.ingestStoragePath,
      expiresAt: asset.expiresAt.toISOString(),
      maxBytes: this.maxInputBytes()
    };
  }

  async completeIntent(user: User, intentId: string) {
    const existing = await this.findAuthorizedAsset(user, intentId);
    if (existing.status !== MediaAssetStatus.pending_upload) {
      return this.getSafeAsset(user, intentId);
    }
    if (existing.expiresAt <= new Date()) {
      await this.rejectExpired(existing.id);
      throw this.validation("MEDIA_UPLOAD_EXPIRED", "The upload intent expired.");
    }
    if (!(await this.storage.exists(existing.ingestBucket, existing.ingestStoragePath))) {
      throw this.validation(
        "MEDIA_UPLOAD_OBJECT_MISSING",
        "The expected uploaded object was not found."
      );
    }
    const info = await this.storage.info(
      existing.ingestBucket,
      existing.ingestStoragePath
    );
    if (info.size > this.maxInputBytes()) {
      await this.rejectOversized(existing.id, info.size);
      throw this.validation(
        "MEDIA_INPUT_TOO_LARGE",
        "The uploaded image exceeds the allowed size."
      );
    }

    await this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, `media-asset:${intentId}`);
      const current = await transaction.mediaAsset.findUniqueOrThrow({
        where: { id: intentId }
      });
      if (current.status !== MediaAssetStatus.pending_upload) return;
      if (current.expiresAt <= new Date()) {
        await transaction.mediaAsset.update({
          where: { id: intentId },
          data: {
            status: MediaAssetStatus.rejected,
            rejectionCode: "UPLOAD_EXPIRED",
            rejectionReason: "The upload intent expired before completion.",
            failedAt: new Date(),
            cleanupRequestedAt: new Date()
          }
        });
        await this.queueCleanup(transaction, intentId);
        return;
      }
      await transaction.mediaAsset.update({
        where: { id: intentId },
        data: {
          status: MediaAssetStatus.uploaded,
          uploadedAt: new Date(),
          originalByteSize: info.size,
          failedAt: null,
          rejectionCode: null,
          rejectionReason: null
        }
      });
      await this.jobs.enqueue(
        PROCESS_MEDIA_ASSET_JOB,
        { assetId: intentId },
        {
          aggregateId: intentId,
          aggregateType: "media_asset",
          client: transaction,
          deduplicationKey: `media-process:${intentId}`,
          maxAttempts: 5
        }
      );
    });
    return this.getSafeAsset(user, intentId);
  }

  getIntent(user: User, intentId: string) {
    return this.getSafeAsset(user, intentId);
  }

  async deleteAsset(user: User, assetId: string) {
    const existing = await this.findAuthorizedAsset(user, assetId);
    if (existing.status === MediaAssetStatus.deleted) {
      return { id: existing.id, status: existing.status };
    }
    await this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, `media-asset:${assetId}`);
      const now = new Date();
      await transaction.mediaAsset.update({
        where: { id: assetId },
        data: {
          status: MediaAssetStatus.deleted,
          deletedAt: now,
          cleanupRequestedAt: now
        }
      });
      await transaction.listingPhoto.updateMany({
        where: { mediaAssetId: assetId, deletedAt: null },
        data: { deletedAt: now }
      });
      await transaction.user.updateMany({
        where: { activeProfileMediaAssetId: assetId },
        data: {
          activeProfileMediaAssetId: null,
          profilePhotoUrl: null
        }
      });
      await this.queueCleanup(transaction, assetId);
    });
    return { id: assetId, status: MediaAssetStatus.deleted };
  }

  async removeActiveProfile(user: User) {
    const fresh = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { activeProfileMediaAssetId: true, profilePhotoUrl: true }
    });
    if (fresh.activeProfileMediaAssetId) {
      return this.deleteAsset(user, fresh.activeProfileMediaAssetId);
    }
    if (fresh.profilePhotoUrl) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { profilePhotoUrl: null }
      });
    }
    return { id: null, status: MediaAssetStatus.deleted };
  }

  async reorderListingPhoto(
    user: User,
    listingId: string,
    photoId: string,
    displayOrder: number
  ) {
    const listing = await this.authorizedListing(user, listingId);
    const photo = await this.prisma.listingPhoto.findFirst({
      where: { id: photoId, listingId: listing.id, deletedAt: null }
    });
    if (!photo) throw this.notFound();
    return this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, `listing-media-order:${listingId}`);
      const conflict = await transaction.listingPhoto.findFirst({
        where: { listingId, displayOrder, deletedAt: null, id: { not: photoId } }
      });
      if (photo.displayOrder === displayOrder) {
        return { id: photo.id, displayOrder: photo.displayOrder };
      }
      if (conflict) {
        const maximum = await transaction.listingPhoto.aggregate({
          where: { listingId },
          _max: { displayOrder: true }
        });
        const temporaryOrder = (maximum._max.displayOrder ?? 0) + 1;
        await transaction.listingPhoto.update({
          where: { id: photoId },
          data: { displayOrder: temporaryOrder }
        });
        await transaction.listingPhoto.update({
          where: { id: conflict.id },
          data: { displayOrder: photo.displayOrder }
        });
      }
      return transaction.listingPhoto.update({
        where: { id: photoId },
        data: { displayOrder },
        select: { id: true, displayOrder: true }
      });
    });
  }

  async deleteListingPhoto(user: User, listingId: string, photoId: string) {
    const listing = await this.authorizedListing(user, listingId);
    const photo = await this.prisma.listingPhoto.findFirst({
      where: { id: photoId, listingId: listing.id, deletedAt: null },
      select: { id: true, mediaAssetId: true }
    });
    if (!photo) throw this.notFound();
    if (photo.mediaAssetId) return this.deleteAsset(user, photo.mediaAssetId);
    await this.prisma.listingPhoto.update({
      where: { id: photo.id },
      data: { deletedAt: new Date() }
    });
    return { id: photo.id, status: MediaAssetStatus.deleted, legacy: true };
  }

  private async getSafeAsset(user: User, id: string) {
    const asset = await this.prisma.mediaAsset.findUnique({
      where: { id },
      include: { variants: { where: { deletedAt: null } } }
    });
    if (!asset) throw this.notFound();
    this.assertAssetAuthority(user, asset);
    return {
      id: asset.id,
      purpose: asset.purpose,
      listingId: asset.listingId,
      status: asset.status,
      expiresAt: asset.expiresAt.toISOString(),
      uploadedAt: asset.uploadedAt?.toISOString() ?? null,
      processedAt: asset.processedAt?.toISOString() ?? null,
      rejectionCode:
        asset.status === MediaAssetStatus.rejected
          ? asset.rejectionCode
          : null,
      variants:
        asset.status === MediaAssetStatus.ready
          ? asset.variants.map((variant) => ({
              type: variant.type,
              url: this.storage.publicUrl(
                variant.storageBucket,
                variant.storagePath
              ),
              width: variant.width,
              height: variant.height,
              contentType: variant.contentType
            }))
          : []
    };
  }

  private async findAuthorizedAsset(user: User, id: string) {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) throw this.notFound();
    this.assertAssetAuthority(user, asset);
    return asset;
  }

  private assertAssetAuthority(user: User, asset: MediaAsset) {
    if (asset.purpose === MediaPurpose.healthcare_credential) {
      throw this.notFound();
    }
    if (user.roles.includes(UserRole.admin) || asset.ownerUserId === user.id) return;
    throw new ForbiddenException({
      code: "FORBIDDEN",
      message: "You do not have permission to manage this media asset.",
      details: {}
    });
  }

  private async authorizedListing(user: User, listingId?: string) {
    if (!listingId) {
      throw this.validation("VALIDATION_ERROR", "listingId is required.");
    }
    const listing = await this.prisma.listing.findFirst({
      where: {
        id: listingId,
        deletedAt: null,
        status: { not: ListingStatus.archived }
      },
      select: { id: true, hostId: true }
    });
    if (!listing) throw this.notFound();
    if (
      !user.roles.includes(UserRole.admin) &&
      (!user.roles.includes(UserRole.host) || listing.hostId !== user.id)
    ) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "You do not have permission to manage this listing's media.",
        details: {}
      });
    }
    return listing;
  }

  private async nextDisplayOrder(
    transaction: Prisma.TransactionClient,
    listingId: string
  ) {
    await this.lock(transaction, `listing-media-order:${listingId}`);
    // Interactive transactions use one pg client. Keep its queries sequential;
    // pg 8.21 deprecates queueing concurrent client.query() calls.
    const photos = await transaction.listingPhoto.aggregate({
      where: { listingId, deletedAt: null },
      _max: { displayOrder: true }
    });
    const assets = await transaction.mediaAsset.aggregate({
      where: {
        listingId,
        status: { not: MediaAssetStatus.deleted }
      },
      _max: { displayOrder: true }
    });
    return Math.max(
      photos._max.displayOrder ?? -1,
      assets._max.displayOrder ?? -1
    ) + 1;
  }

  private async rejectExpired(id: string) {
    await this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, `media-asset:${id}`);
      await transaction.mediaAsset.updateMany({
        where: { id, status: MediaAssetStatus.pending_upload },
        data: {
          status: MediaAssetStatus.rejected,
          rejectionCode: "UPLOAD_EXPIRED",
          rejectionReason: "The upload intent expired before completion.",
          failedAt: new Date(),
          cleanupRequestedAt: new Date()
        }
      });
      await this.queueCleanup(transaction, id);
    });
  }

  private async rejectOversized(id: string, size: number) {
    await this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, `media-asset:${id}`);
      await transaction.mediaAsset.updateMany({
        where: { id, status: MediaAssetStatus.pending_upload },
        data: {
          status: MediaAssetStatus.rejected,
          originalByteSize: size,
          rejectionCode: "INPUT_TOO_LARGE",
          rejectionReason: "The uploaded image exceeds the configured limit.",
          failedAt: new Date(),
          cleanupRequestedAt: new Date()
        }
      });
      await this.queueCleanup(transaction, id);
    });
  }

  private queueCleanup(transaction: Prisma.TransactionClient, assetId: string) {
    return this.jobs.enqueue(
      CLEANUP_MEDIA_ASSET_JOB,
      { assetId },
      {
        aggregateId: assetId,
        aggregateType: "media_asset",
        client: transaction,
        deduplicationKey: `media-cleanup:${assetId}`,
        maxAttempts: 5
      }
    );
  }

  private maxInputBytes() {
    return this.config.get<number>("MEDIA_MAX_INPUT_BYTES") ?? 5_242_880;
  }

  private ingestBucket() {
    return this.config.get<string>("SUPABASE_MEDIA_INGEST_BUCKET") ?? "media-ingest";
  }

  private safeFileName(value: string) {
    const cleaned = value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    return cleaned || "upload";
  }

  private lock(transaction: Prisma.TransactionClient, key: string) {
    return transaction.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`
    );
  }

  private validation(code: string, message: string) {
    return new BadRequestException({ code, message, details: {} });
  }

  private notFound() {
    return new NotFoundException({
      code: "NOT_FOUND",
      message: "Media asset was not found.",
      details: {}
    });
  }
}
