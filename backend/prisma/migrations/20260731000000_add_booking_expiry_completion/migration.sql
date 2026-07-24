ALTER TYPE "BookingCancellationReason" ADD VALUE 'request_expired';
ALTER TYPE "CancellationOperationReason" ADD VALUE 'request_expired';

CREATE TYPE "BookingLifecycleSource" AS ENUM (
  'operations_scheduler',
  'legacy_backfill'
);

ALTER TABLE "Listing"
ADD COLUMN "checkoutTime" VARCHAR(5) NOT NULL DEFAULT '11:00';

ALTER TABLE "Booking"
ADD COLUMN "checkoutTime" VARCHAR(5),
ADD COLUMN "requestExpiresAt" TIMESTAMP(3),
ADD COLUMN "expiredAt" TIMESTAMP(3),
ADD COLUMN "expirySource" "BookingLifecycleSource",
ADD COLUMN "completedAt" TIMESTAMP(3),
ADD COLUMN "completionSource" "BookingLifecycleSource";

UPDATE "Booking" AS booking
SET "checkoutTime" = listing."checkoutTime"
FROM "Listing" AS listing
WHERE booking."listingId" = listing."id";

UPDATE "Booking"
SET "requestExpiresAt" = "createdAt" + INTERVAL '24 hours';

UPDATE "Booking"
SET
  "completedAt" = "updatedAt",
  "completionSource" = 'legacy_backfill'
WHERE "status" = 'completed';

ALTER TABLE "Booking"
ALTER COLUMN "checkoutTime" SET NOT NULL,
ALTER COLUMN "checkoutTime" SET DEFAULT '11:00',
ALTER COLUMN "requestExpiresAt" SET NOT NULL,
ALTER COLUMN "requestExpiresAt" SET DEFAULT (CURRENT_TIMESTAMP + INTERVAL '24 hours');

ALTER TABLE "Listing"
ADD CONSTRAINT "Listing_checkoutTime_canonical"
CHECK ("checkoutTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

ALTER TABLE "Booking"
ADD CONSTRAINT "Booking_checkoutTime_canonical"
CHECK ("checkoutTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
ADD CONSTRAINT "Booking_expiry_metadata_consistent"
CHECK (
  ("expiredAt" IS NULL AND "expirySource" IS NULL)
  OR
  ("expiredAt" IS NOT NULL AND "expirySource" IS NOT NULL AND "status" = 'cancelled')
),
ADD CONSTRAINT "Booking_completion_metadata_consistent"
CHECK (
  ("completedAt" IS NULL AND "completionSource" IS NULL AND "status" <> 'completed')
  OR
  ("completedAt" IS NOT NULL AND "completionSource" IS NOT NULL AND "status" = 'completed')
);

CREATE INDEX "Booking_status_requestExpiresAt_idx"
ON "Booking"("status", "requestExpiresAt");

CREATE INDEX "Booking_status_endDate_idx"
ON "Booking"("status", "endDate");

DROP TRIGGER "Booking_timeZone_immutable" ON "Booking";

CREATE OR REPLACE FUNCTION prevent_booking_timezone_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."timeZone" IS DISTINCT FROM OLD."timeZone"
     OR NEW."checkoutTime" IS DISTINCT FROM OLD."checkoutTime"
     OR NEW."requestExpiresAt" IS DISTINCT FROM OLD."requestExpiresAt" THEN
    RAISE EXCEPTION 'Booking lifecycle snapshots are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Booking_lifecycle_snapshots_immutable"
BEFORE UPDATE OF "timeZone", "checkoutTime", "requestExpiresAt" ON "Booking"
FOR EACH ROW
EXECUTE FUNCTION prevent_booking_timezone_change();
