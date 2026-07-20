CREATE TYPE "IdentityProvider" AS ENUM ('veriff');
CREATE TYPE "IdentityVerificationStatus" AS ENUM ('not_started', 'created', 'submitted', 'review', 'resubmission_requested', 'approved', 'declined', 'expired', 'abandoned');
CREATE TYPE "IdentityWebhookKind" AS ENUM ('event', 'decision');
CREATE TYPE "IdentityWebhookProcessingStatus" AS ENUM ('received', 'processing', 'processed', 'failed', 'ignored');

CREATE TABLE "IdentityVerification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "IdentityProvider" NOT NULL DEFAULT 'veriff',
    "providerSessionId" TEXT NOT NULL,
    "providerHostedUrl" TEXT,
    "vendorData" TEXT NOT NULL,
    "providerAttemptId" TEXT,
    "status" "IdentityVerificationStatus" NOT NULL DEFAULT 'created',
    "providerStatus" TEXT,
    "providerCode" TEXT,
    "reasonCode" TEXT,
    "reasonCategory" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "lastProviderUpdateAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "supersededById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IdentityVerification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IdentityWebhookEvent" (
    "id" TEXT NOT NULL,
    "deliveryKey" TEXT NOT NULL,
    "provider" "IdentityProvider" NOT NULL DEFAULT 'veriff',
    "kind" "IdentityWebhookKind" NOT NULL,
    "identityVerificationId" TEXT,
    "providerSessionId" TEXT,
    "providerAttemptId" TEXT,
    "providerStatus" TEXT,
    "providerCode" TEXT,
    "providerOccurredAt" TIMESTAMP(3),
    "payloadDigest" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "IdentityWebhookProcessingStatus" NOT NULL DEFAULT 'received',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "processingAttempts" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "IdentityWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- Preserve every legacy Veriff-backed row before removing provider fields from
-- the healthcare credential table. The newest session is current per user.
WITH legacy AS (
  SELECT
    hv.*,
    lead(hv."id") OVER (
      PARTITION BY hv."userId"
      ORDER BY hv."createdAt", hv."id"
    ) AS "newerId",
    row_number() OVER (
      PARTITION BY hv."userId"
      ORDER BY hv."createdAt" DESC, hv."id" DESC
    ) AS "newestRank"
  FROM "HealthcareVerification" hv
  WHERE hv."veriffSessionId" IS NOT NULL
)
INSERT INTO "IdentityVerification" (
  "id", "userId", "provider", "providerSessionId", "vendorData",
  "status", "providerStatus", "submittedAt", "decidedAt", "expiresAt",
  "lastProviderUpdateAt", "supersededAt", "supersededById", "createdAt", "updatedAt"
)
SELECT
  "id",
  "userId",
  'veriff'::"IdentityProvider",
  "veriffSessionId",
  'legacy_' || replace("id", '-', ''),
  CASE "status"
    WHEN 'pending' THEN 'submitted'::"IdentityVerificationStatus"
    WHEN 'approved' THEN 'approved'::"IdentityVerificationStatus"
    WHEN 'rejected' THEN 'declined'::"IdentityVerificationStatus"
    WHEN 'expired' THEN 'expired'::"IdentityVerificationStatus"
    ELSE 'created'::"IdentityVerificationStatus"
  END,
  CASE WHEN "veriffStatus" IN ('created', 'submitted', 'review', 'resubmission_requested', 'approved', 'declined', 'expired', 'abandoned') THEN "veriffStatus" ELSE NULL END,
  "submittedAt",
  "reviewedAt",
  "expiresAt",
  COALESCE("reviewedAt", "submittedAt", "updatedAt"),
  CASE WHEN "newestRank" = 1 THEN NULL ELSE "updatedAt" END,
  "newerId",
  "createdAt",
  "updatedAt"
FROM legacy;

CREATE UNIQUE INDEX "IdentityVerification_providerSessionId_key" ON "IdentityVerification"("providerSessionId");
CREATE UNIQUE INDEX "IdentityVerification_vendorData_key" ON "IdentityVerification"("vendorData");
CREATE INDEX "IdentityVerification_userId_status_idx" ON "IdentityVerification"("userId", "status");
CREATE INDEX "IdentityVerification_userId_supersededAt_idx" ON "IdentityVerification"("userId", "supersededAt");
CREATE UNIQUE INDEX "IdentityVerification_one_current_per_user" ON "IdentityVerification"("userId") WHERE "supersededAt" IS NULL;
CREATE UNIQUE INDEX "IdentityWebhookEvent_deliveryKey_key" ON "IdentityWebhookEvent"("deliveryKey");
CREATE INDEX "IdentityWebhookEvent_status_receivedAt_idx" ON "IdentityWebhookEvent"("status", "receivedAt");
CREATE INDEX "IdentityWebhookEvent_providerSessionId_idx" ON "IdentityWebhookEvent"("providerSessionId");

ALTER TABLE "IdentityVerification" ADD CONSTRAINT "IdentityVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IdentityVerification" ADD CONSTRAINT "IdentityVerification_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "IdentityVerification"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "IdentityWebhookEvent" ADD CONSTRAINT "IdentityWebhookEvent_identityVerificationId_fkey" FOREIGN KEY ("identityVerificationId") REFERENCES "IdentityVerification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP INDEX IF EXISTS "HealthcareVerification_veriffSessionId_key";
ALTER TABLE "HealthcareVerification" DROP COLUMN "veriffSessionId", DROP COLUMN "veriffStatus";
