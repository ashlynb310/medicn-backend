CREATE TYPE "CancellationActorType" AS ENUM (
  'renter',
  'host',
  'admin',
  'system'
);

CREATE TYPE "CancellationOperationReason" AS ENUM (
  'plans_changed',
  'booking_no_longer_needed',
  'property_unavailable',
  'cannot_accommodate',
  'safety_issue',
  'support_resolution',
  'fraud_risk',
  'provider_failure',
  'other',
  'payment_expired',
  'payment_failed',
  'full_refund',
  'payment_disputed'
);

CREATE TYPE "CancellationOperationStatus" AS ENUM (
  'requested',
  'checkout_expiry_pending',
  'refund_pending',
  'refund_confirmed',
  'transfer_reversal_pending',
  'completed',
  'failed_retryable',
  'failed_permanent'
);

CREATE TYPE "CancellationFinancialDisposition" AS ENUM (
  'no_payment_collected',
  'checkout_expiry_pending',
  'full_refund_pending',
  'full_refund_confirmed',
  'transfer_reversal_pending',
  'financially_complete'
);

CREATE TABLE "BookingCancellationOperation" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "bookingId" TEXT NOT NULL,
  "paymentId" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "actorType" "CancellationActorType" NOT NULL,
  "actorUserId" TEXT,
  "reason" "CancellationOperationReason" NOT NULL,
  "status" "CancellationOperationStatus" NOT NULL DEFAULT 'requested',
  "financialDisposition" "CancellationFinancialDisposition" NOT NULL,
  "idempotencyKey" VARCHAR(200) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "providerOperationRef" VARCHAR(255),
  "failureCode" VARCHAR(100),
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BookingCancellationOperation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BookingCancellationOperation_bookingId_version_key"
  ON "BookingCancellationOperation"("bookingId", "version");
CREATE UNIQUE INDEX "BookingCancellationOperation_bookingId_idempotencyKey_key"
  ON "BookingCancellationOperation"("bookingId", "idempotencyKey");
CREATE UNIQUE INDEX "BookingCancellationOperation_one_active_per_booking"
  ON "BookingCancellationOperation"("bookingId") WHERE "active" = true;
CREATE INDEX "BookingCancellationOperation_bookingId_active_idx"
  ON "BookingCancellationOperation"("bookingId", "active");
CREATE INDEX "BookingCancellationOperation_paymentId_idx"
  ON "BookingCancellationOperation"("paymentId");
CREATE INDEX "BookingCancellationOperation_status_updatedAt_idx"
  ON "BookingCancellationOperation"("status", "updatedAt");
CREATE INDEX "BookingCancellationOperation_actorUserId_idx"
  ON "BookingCancellationOperation"("actorUserId");

ALTER TABLE "BookingCancellationOperation"
  ADD CONSTRAINT "BookingCancellationOperation_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BookingCancellationOperation"
  ADD CONSTRAINT "BookingCancellationOperation_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BookingCancellationOperation"
  ADD CONSTRAINT "BookingCancellationOperation_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "BookingCancellationOperation" (
  "bookingId",
  "version",
  "actorType",
  "reason",
  "status",
  "financialDisposition",
  "idempotencyKey",
  "active",
  "requestedAt",
  "effectiveAt",
  "updatedAt"
)
SELECT
  b."id",
  1,
  'system'::"CancellationActorType",
  CASE b."cancellationReason"
    WHEN 'payment_expired' THEN 'payment_expired'::"CancellationOperationReason"
    WHEN 'payment_failed' THEN 'payment_failed'::"CancellationOperationReason"
    WHEN 'full_refund' THEN 'full_refund'::"CancellationOperationReason"
    WHEN 'payment_disputed' THEN 'payment_disputed'::"CancellationOperationReason"
    WHEN 'host_cancelled' THEN 'property_unavailable'::"CancellationOperationReason"
    WHEN 'admin_cancelled' THEN 'support_resolution'::"CancellationOperationReason"
    ELSE 'other'::"CancellationOperationReason"
  END,
  'completed'::"CancellationOperationStatus",
  'financially_complete'::"CancellationFinancialDisposition",
  'legacy-cancelled:' || b."id"::text,
  false,
  COALESCE(b."cancelledAt", b."updatedAt"),
  COALESCE(b."cancelledAt", b."updatedAt"),
  CURRENT_TIMESTAMP
FROM "Booking" b
WHERE b."status" = 'cancelled'
ON CONFLICT ("bookingId", "version") DO NOTHING;
