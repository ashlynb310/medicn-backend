-- Phase 5.4A: authoritative listing locations, derived nearby data, and immutable check-in snapshots.
CREATE TYPE "LocationGeocodeStatus" AS ENUM ('not_started', 'pending', 'verified', 'ambiguous', 'failed', 'stale');
CREATE TYPE "LocationEnrichmentStatus" AS ENUM ('not_started', 'pending', 'processing', 'ready', 'failed', 'stale');
CREATE TYPE "LocationPrecision" AS ENUM ('rooftop', 'range_interpolated', 'geometric_center', 'approximate', 'unknown');
CREATE TYPE "NearbyPlaceCategory" AS ENUM ('medical', 'pharmacy', 'transit', 'grocery');
CREATE TYPE "MapsTravelMode" AS ENUM ('walking', 'driving');

CREATE TABLE "ListingLocation" (
  "id" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "inputAddress" TEXT,
  "inputPlaceId" TEXT,
  "addressFingerprint" TEXT,
  "verifiedFingerprint" TEXT,
  "formattedAddress" TEXT,
  "providerPlaceId" TEXT,
  "exactLatitude" DECIMAL(10,7),
  "exactLongitude" DECIMAL(10,7),
  "geocodeStatus" "LocationGeocodeStatus" NOT NULL DEFAULT 'not_started',
  "precision" "LocationPrecision",
  "provider" TEXT,
  "addressVersion" INTEGER NOT NULL DEFAULT 1,
  "verifiedAddressVersion" INTEGER,
  "geocodedAt" TIMESTAMP(3),
  "geocodeExpiresAt" TIMESTAMP(3),
  "failureCategory" TEXT,
  "geocodeAttempts" INTEGER NOT NULL DEFAULT 0,
  "enrichmentStatus" "LocationEnrichmentStatus" NOT NULL DEFAULT 'not_started',
  "enrichmentVersion" INTEGER,
  "nearbyEnrichedAt" TIMESTAMP(3),
  "nearbyExpiresAt" TIMESTAMP(3),
  "processingStartedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ListingLocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NearbyPlace" (
  "id" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "listingLocationId" TEXT NOT NULL,
  "addressVersion" INTEGER NOT NULL,
  "providerPlaceId" TEXT NOT NULL,
  "category" "NearbyPlaceCategory" NOT NULL,
  "displayName" TEXT NOT NULL,
  "mapsUrl" TEXT,
  "latitude" DECIMAL(10,7),
  "longitude" DECIMAL(10,7),
  "straightLineDistanceMeters" INTEGER NOT NULL,
  "routeDistanceMeters" INTEGER,
  "routeDurationSeconds" INTEGER,
  "routeMode" "MapsTravelMode",
  "provider" TEXT NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "rank" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NearbyPlace_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BookingLocationSnapshot" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "formattedAddress" TEXT NOT NULL,
  "exactLatitude" DECIMAL(10,7),
  "exactLongitude" DECIMAL(10,7),
  "sourceListingLocationVersion" INTEGER,
  "legacyBackfill" BOOLEAN NOT NULL DEFAULT false,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BookingLocationSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ListingLocation_listingId_key" ON "ListingLocation"("listingId");
CREATE INDEX "ListingLocation_geocodeStatus_updatedAt_idx" ON "ListingLocation"("geocodeStatus", "updatedAt");
CREATE INDEX "ListingLocation_enrichmentStatus_nearbyExpiresAt_idx" ON "ListingLocation"("enrichmentStatus", "nearbyExpiresAt");
CREATE UNIQUE INDEX "NearbyPlace_listingLocationId_addressVersion_category_providerPlaceId_key" ON "NearbyPlace"("listingLocationId", "addressVersion", "category", "providerPlaceId");
CREATE INDEX "NearbyPlace_listingId_category_expiresAt_idx" ON "NearbyPlace"("listingId", "category", "expiresAt");
CREATE INDEX "NearbyPlace_listingLocationId_addressVersion_idx" ON "NearbyPlace"("listingLocationId", "addressVersion");
CREATE UNIQUE INDEX "BookingLocationSnapshot_bookingId_key" ON "BookingLocationSnapshot"("bookingId");

ALTER TABLE "ListingLocation" ADD CONSTRAINT "ListingLocation_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NearbyPlace" ADD CONSTRAINT "NearbyPlace_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NearbyPlace" ADD CONSTRAINT "NearbyPlace_listingLocationId_fkey" FOREIGN KEY ("listingLocationId") REFERENCES "ListingLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BookingLocationSnapshot" ADD CONSTRAINT "BookingLocationSnapshot_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing coordinates predate this verification pipeline. Preserve them, but classify
-- them as stale until explicitly refreshed so approval cannot mistake legacy data for a
-- current provider verification.
INSERT INTO "ListingLocation" (
  "id", "listingId", "inputAddress", "formattedAddress", "exactLatitude",
  "exactLongitude", "geocodeStatus", "addressVersion", "verifiedAddressVersion",
  "provider", "enrichmentStatus", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  l."id",
  l."address",
  l."address",
  l."latitude",
  l."longitude",
  CASE WHEN l."address" IS NULL THEN 'not_started'::"LocationGeocodeStatus" ELSE 'stale'::"LocationGeocodeStatus" END,
  1,
  CASE WHEN l."latitude" IS NOT NULL AND l."longitude" IS NOT NULL THEN 1 ELSE NULL END,
  CASE WHEN l."latitude" IS NOT NULL AND l."longitude" IS NOT NULL THEN 'legacy' ELSE NULL END,
  'stale'::"LocationEnrichmentStatus",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Listing" l;

-- Preserve paid/completed renters' existing access without pretending this was captured
-- at the original payment instant. The legacyBackfill marker makes that provenance explicit.
INSERT INTO "BookingLocationSnapshot" (
  "id", "bookingId", "formattedAddress", "exactLatitude", "exactLongitude",
  "sourceListingLocationVersion", "legacyBackfill", "capturedAt"
)
SELECT
  gen_random_uuid()::text,
  b."id",
  l."address",
  l."latitude",
  l."longitude",
  ll."verifiedAddressVersion",
  true,
  CURRENT_TIMESTAMP
FROM "Booking" b
JOIN "Listing" l ON l."id" = b."listingId"
JOIN "ListingLocation" ll ON ll."listingId" = l."id"
WHERE b."status" IN ('paid', 'completed') AND l."address" IS NOT NULL;
