-- CreateTable
CREATE TABLE "ListingUploadIntent" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingUploadIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ListingUploadIntent_storagePath_key" ON "ListingUploadIntent"("storagePath");

-- CreateIndex
CREATE INDEX "ListingUploadIntent_listingId_consumedAt_expiresAt_idx" ON "ListingUploadIntent"("listingId", "consumedAt", "expiresAt");

-- AddForeignKey
ALTER TABLE "ListingUploadIntent" ADD CONSTRAINT "ListingUploadIntent_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
