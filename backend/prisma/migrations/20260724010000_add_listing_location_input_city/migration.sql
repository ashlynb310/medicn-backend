ALTER TABLE "ListingLocation" ADD COLUMN "inputCity" TEXT;

UPDATE "ListingLocation" ll
SET "inputCity" = l."city"
FROM "Listing" l
WHERE l."id" = ll."listingId";
