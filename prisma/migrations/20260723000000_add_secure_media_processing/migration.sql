CREATE TYPE "MediaPurpose" AS ENUM ('listing_photo', 'profile_photo');
CREATE TYPE "MediaAssetStatus" AS ENUM ('pending_upload', 'uploaded', 'processing', 'ready', 'rejected', 'deleted');
CREATE TYPE "MediaVariantType" AS ENUM ('listing_thumbnail', 'listing_display', 'profile_small', 'profile_medium', 'profile_large');

CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "purpose" "MediaPurpose" NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "listingId" TEXT,
    "ingestBucket" TEXT NOT NULL,
    "ingestStoragePath" TEXT NOT NULL,
    "status" "MediaAssetStatus" NOT NULL DEFAULT 'pending_upload',
    "claimedFileName" TEXT NOT NULL,
    "claimedContentType" TEXT NOT NULL,
    "detectedContentType" TEXT,
    "detectedFormat" TEXT,
    "originalByteSize" INTEGER,
    "decodedWidth" INTEGER,
    "decodedHeight" INTEGER,
    "checksumSha256" TEXT,
    "rejectionCode" TEXT,
    "rejectionReason" TEXT,
    "processingAttempts" INTEGER NOT NULL DEFAULT 0,
    "displayOrder" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "uploadedAt" TIMESTAMP(3),
    "processingStartedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "cleanupRequestedAt" TIMESTAMP(3),
    "ingestDeletedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MediaAsset_purpose_listing_check" CHECK (
      ("purpose" = 'listing_photo' AND "listingId" IS NOT NULL) OR
      ("purpose" = 'profile_photo' AND "listingId" IS NULL)
    ),
    CONSTRAINT "MediaAsset_positive_dimensions_check" CHECK (
      ("decodedWidth" IS NULL OR "decodedWidth" > 0) AND
      ("decodedHeight" IS NULL OR "decodedHeight" > 0) AND
      ("originalByteSize" IS NULL OR "originalByteSize" >= 0)
    )
);

CREATE TABLE "MediaVariant" (
    "id" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "type" "MediaVariantType" NOT NULL,
    "storageBucket" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "contentType" TEXT NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MediaVariant_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MediaVariant_positive_values_check" CHECK (
      "width" > 0 AND "height" > 0 AND "byteSize" > 0
    )
);

ALTER TABLE "User" ADD COLUMN "activeProfileMediaAssetId" TEXT;
ALTER TABLE "ListingPhoto"
  ADD COLUMN "mediaAssetId" TEXT,
  ADD COLUMN "legacyUnprocessed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Existing public objects were never decoded and re-encoded by MediCN. Keep
-- every row and label it honestly instead of treating it as sanitized media.
UPDATE "ListingPhoto" SET "legacyUnprocessed" = true;

CREATE UNIQUE INDEX "User_activeProfileMediaAssetId_key" ON "User"("activeProfileMediaAssetId");
CREATE UNIQUE INDEX "ListingPhoto_mediaAssetId_key" ON "ListingPhoto"("mediaAssetId");
CREATE UNIQUE INDEX "MediaAsset_ingestStoragePath_key" ON "MediaAsset"("ingestStoragePath");
CREATE INDEX "MediaAsset_ownerUserId_purpose_status_idx" ON "MediaAsset"("ownerUserId", "purpose", "status");
CREATE INDEX "MediaAsset_listingId_status_displayOrder_idx" ON "MediaAsset"("listingId", "status", "displayOrder");
CREATE INDEX "MediaAsset_status_expiresAt_idx" ON "MediaAsset"("status", "expiresAt");
CREATE INDEX "MediaAsset_status_processingStartedAt_idx" ON "MediaAsset"("status", "processingStartedAt");
CREATE UNIQUE INDEX "MediaVariant_storagePath_key" ON "MediaVariant"("storagePath");
CREATE UNIQUE INDEX "MediaVariant_mediaAssetId_type_key" ON "MediaVariant"("mediaAssetId", "type");
CREATE INDEX "MediaVariant_mediaAssetId_deletedAt_idx" ON "MediaVariant"("mediaAssetId", "deletedAt");

ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MediaVariant" ADD CONSTRAINT "MediaVariant_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ListingPhoto" ADD CONSTRAINT "ListingPhoto_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_activeProfileMediaAssetId_fkey" FOREIGN KEY ("activeProfileMediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
