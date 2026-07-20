CREATE TYPE "BookingCancellationReason" AS ENUM (
  'payment_expired',
  'payment_failed',
  'full_refund',
  'payment_disputed',
  'renter_cancelled',
  'host_cancelled',
  'admin_cancelled'
);

CREATE TYPE "StripeWebhookProcessingStatus" AS ENUM (
  'received',
  'processing',
  'processed',
  'failed',
  'ignored'
);

ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'expired';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'partially_refunded';

ALTER TABLE "Booking"
ADD COLUMN "cancellationReason" "BookingCancellationReason";

ALTER TABLE "Payment"
ADD COLUMN "attemptNumber" INTEGER,
ADD COLUMN "idempotencyKey" TEXT,
ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "expiresAt" TIMESTAMP(3),
ADD COLUMN "amountRefundedCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "failureReason" TEXT,
ADD COLUMN "lastProviderEventId" TEXT,
ADD COLUMN "lastProviderEventCreatedAt" TIMESTAMP(3);

WITH numbered_attempts AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (PARTITION BY "bookingId" ORDER BY "createdAt", "id") AS "attemptNumber"
  FROM "Payment"
)
UPDATE "Payment" AS payment
SET "attemptNumber" = numbered_attempts."attemptNumber"
FROM numbered_attempts
WHERE payment."id" = numbered_attempts."id";

ALTER TABLE "Payment"
ALTER COLUMN "attemptNumber" SET NOT NULL;

CREATE UNIQUE INDEX "Payment_idempotencyKey_key"
ON "Payment"("idempotencyKey");

CREATE UNIQUE INDEX "Payment_bookingId_attemptNumber_key"
ON "Payment"("bookingId", "attemptNumber");

CREATE UNIQUE INDEX "Payment_one_active_pending_attempt_per_booking"
ON "Payment"("bookingId")
WHERE "active" = true AND "status" = 'pending';

ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_attemptNumber_positive" CHECK ("attemptNumber" > 0),
ADD CONSTRAINT "Payment_refund_amount_valid" CHECK (
  "amountRefundedCents" >= 0 AND "amountRefundedCents" <= "amountCents"
);

CREATE TABLE "StripeWebhookEvent" (
  "id" TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "providerObjectId" TEXT,
  "status" "StripeWebhookProcessingStatus" NOT NULL DEFAULT 'received',
  "payload" JSONB NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "processingAttempts" INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StripeWebhookEvent_providerEventId_key"
ON "StripeWebhookEvent"("providerEventId");

CREATE INDEX "StripeWebhookEvent_status_receivedAt_idx"
ON "StripeWebhookEvent"("status", "receivedAt");
