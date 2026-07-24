ALTER TABLE "Listing"
ADD COLUMN "timeZone" VARCHAR(64) NOT NULL DEFAULT 'UTC';

ALTER TABLE "Booking"
ADD COLUMN "timeZone" VARCHAR(64);

UPDATE "Booking" AS booking
SET "timeZone" = listing."timeZone"
FROM "Listing" AS listing
WHERE booking."listingId" = listing."id";

ALTER TABLE "Booking"
ALTER COLUMN "timeZone" SET NOT NULL,
ALTER COLUMN "timeZone" SET DEFAULT 'UTC';

ALTER TABLE "ListingAvailability"
ALTER COLUMN "startDate" TYPE DATE USING "startDate"::date,
ALTER COLUMN "endDate" TYPE DATE USING "endDate"::date;

ALTER TABLE "Booking"
ALTER COLUMN "startDate" TYPE DATE USING "startDate"::date,
ALTER COLUMN "endDate" TYPE DATE USING "endDate"::date;

ALTER TABLE "ListingAvailability"
ADD CONSTRAINT "ListingAvailability_valid_half_open_range"
CHECK ("startDate" < "endDate");

ALTER TABLE "Booking"
ADD CONSTRAINT "Booking_valid_half_open_range"
CHECK ("startDate" < "endDate");

CREATE INDEX "ListingAvailability_listingId_status_startDate_endDate_idx"
ON "ListingAvailability"("listingId", "status", "startDate", "endDate");

CREATE INDEX "Booking_listingId_status_startDate_endDate_idx"
ON "Booking"("listingId", "status", "startDate", "endDate");

CREATE FUNCTION prevent_booking_timezone_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."timeZone" IS DISTINCT FROM OLD."timeZone" THEN
    RAISE EXCEPTION 'Booking timeZone is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Booking_timeZone_immutable"
BEFORE UPDATE OF "timeZone" ON "Booking"
FOR EACH ROW
EXECUTE FUNCTION prevent_booking_timezone_change();
