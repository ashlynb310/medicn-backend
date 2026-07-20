-- Extend the existing MediaAsset ownership check for private healthcare evidence.
ALTER TABLE "MediaAsset"
  DROP CONSTRAINT "MediaAsset_purpose_listing_check";

ALTER TABLE "MediaAsset"
  ADD CONSTRAINT "MediaAsset_purpose_listing_check" CHECK (
    ("purpose" = 'listing_photo' AND "listingId" IS NOT NULL) OR
    ("purpose" IN ('profile_photo', 'healthcare_credential') AND "listingId" IS NULL)
  );
