ALTER TABLE "Listing"
ADD COLUMN "publicLatitude" DECIMAL(10, 7),
ADD COLUMN "publicLongitude" DECIMAL(10, 7),
ADD COLUMN "publicRadiusMeters" INTEGER NOT NULL DEFAULT 500;
