-- Phase 5.7B: temporary private healthcare evidence with durable deletion.
-- Existing healthcare rows are preserved and marked as legacy records.

CREATE TYPE "HealthcareAffiliationType" AS ENUM (
  'hospital', 'clinic', 'university', 'medical_school', 'nursing_school', 'other'
);
CREATE TYPE "HealthcareEvidenceCategory" AS ENUM (
  'license', 'student', 'employment', 'other'
);
CREATE TYPE "HealthcareSubmissionStatus" AS ENUM (
  'created', 'uploading', 'processing', 'pending_review', 'approved', 'rejected',
  'withdrawn', 'processing_failed', 'deletion_pending', 'evidence_deleted',
  'deletion_failed'
);
CREATE TYPE "HealthcareDecisionReasonCode" AS ENUM (
  'information_confirmed', 'evidence_unreadable', 'information_mismatch',
  'unsupported_evidence', 'other'
);

ALTER TYPE "AdminTargetType" ADD VALUE IF NOT EXISTS 'healthcare_verification';
ALTER TYPE "AdminTargetType" ADD VALUE IF NOT EXISTS 'healthcare_evidence';
ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'evidence_viewed';
ALTER TYPE "MediaPurpose" ADD VALUE IF NOT EXISTS 'healthcare_credential';
ALTER TYPE "MediaVariantType" ADD VALUE IF NOT EXISTS 'healthcare_review';

ALTER TABLE "HealthcareVerification"
  ADD COLUMN "version" INTEGER,
  ADD COLUMN "claimedRole" "HealthcareRole",
  ADD COLUMN "claimedAffiliationName" VARCHAR(200),
  ADD COLUMN "claimedAffiliationType" "HealthcareAffiliationType",
  ADD COLUMN "evidenceCategory" "HealthcareEvidenceCategory",
  ADD COLUMN "submissionStatus" "HealthcareSubmissionStatus" NOT NULL DEFAULT 'created',
  ADD COLUMN "decisionReasonCode" "HealthcareDecisionReasonCode",
  ADD COLUMN "withdrawnAt" TIMESTAMP(3),
  ADD COLUMN "deletionRequestedAt" TIMESTAMP(3),
  ADD COLUMN "evidenceDeletedAt" TIMESTAMP(3),
  ADD COLUMN "deletionFailedAt" TIMESTAMP(3),
  ADD COLUMN "legacyRecord" BOOLEAN NOT NULL DEFAULT false;

WITH versioned AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "userId"
      ORDER BY "createdAt" ASC, "id" ASC
    )::INTEGER AS version
  FROM "HealthcareVerification"
)
UPDATE "HealthcareVerification" AS verification
SET
  "version" = versioned.version,
  "legacyRecord" = true
FROM versioned
WHERE verification."id" = versioned."id";

WITH ranked_pending AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "userId"
      ORDER BY "createdAt" DESC, "id" DESC
    ) AS pending_rank
  FROM "HealthcareVerification"
  WHERE "status" = 'pending'
)
UPDATE "HealthcareVerification" AS verification
SET "submissionStatus" = CASE
  WHEN verification."status" = 'pending' AND ranked_pending.pending_rank = 1
    THEN 'pending_review'::"HealthcareSubmissionStatus"
  WHEN verification."status" = 'pending'
    THEN 'withdrawn'::"HealthcareSubmissionStatus"
  WHEN verification."status" IN ('approved', 'rejected', 'expired')
    THEN 'evidence_deleted'::"HealthcareSubmissionStatus"
  ELSE 'withdrawn'::"HealthcareSubmissionStatus"
END
FROM ranked_pending
WHERE verification."id" = ranked_pending."id";

UPDATE "HealthcareVerification"
SET "submissionStatus" = CASE
  WHEN "status" IN ('approved', 'rejected', 'expired')
    THEN 'evidence_deleted'::"HealthcareSubmissionStatus"
  ELSE 'withdrawn'::"HealthcareSubmissionStatus"
END
WHERE "status" <> 'pending';

ALTER TABLE "HealthcareVerification"
  ALTER COLUMN "version" SET NOT NULL,
  ALTER COLUMN "version" SET DEFAULT 1;

ALTER TABLE "HealthcareVerification"
  ADD CONSTRAINT "HealthcareVerification_version_positive" CHECK ("version" > 0),
  ADD CONSTRAINT "HealthcareVerification_claim_length" CHECK (
    "claimedAffiliationName" IS NULL OR char_length("claimedAffiliationName") BETWEEN 1 AND 200
  ),
  ADD CONSTRAINT "HealthcareVerification_note_length" CHECK (
    "adminReviewNote" IS NULL OR char_length("adminReviewNote") <= 1000
  ),
  ADD CONSTRAINT "HealthcareVerification_new_claim_complete" CHECK (
    "legacyRecord" OR (
      "claimedRole" IS NOT NULL AND
      "claimedAffiliationName" IS NOT NULL AND
      "claimedAffiliationType" IS NOT NULL AND
      "evidenceCategory" IS NOT NULL
    )
  );

CREATE UNIQUE INDEX "HealthcareVerification_userId_version_key"
  ON "HealthcareVerification"("userId", "version");
CREATE UNIQUE INDEX "HealthcareVerification_one_active_submission_key"
  ON "HealthcareVerification"("userId")
  WHERE "submissionStatus" IN ('created', 'uploading', 'processing', 'pending_review');
CREATE INDEX "HealthcareVerification_submissionStatus_submittedAt_idx"
  ON "HealthcareVerification"("submissionStatus", "submittedAt");
CREATE INDEX "HealthcareVerification_claimedRole_submissionStatus_idx"
  ON "HealthcareVerification"("claimedRole", "submissionStatus");
CREATE INDEX "HealthcareVerification_evidenceCategory_submissionStatus_idx"
  ON "HealthcareVerification"("evidenceCategory", "submissionStatus");
CREATE INDEX "HealthcareVerification_reviewedByAdminId_reviewedAt_idx"
  ON "HealthcareVerification"("reviewedByAdminId", "reviewedAt");

CREATE TABLE "HealthcareVerificationEvidence" (
  "id" TEXT NOT NULL,
  "healthcareVerificationId" TEXT NOT NULL,
  "mediaAssetId" TEXT NOT NULL,
  "sanitizedAt" TIMESTAMP(3),
  "lastAccessedAt" TIMESTAMP(3),
  "accessCount" INTEGER NOT NULL DEFAULT 0,
  "deletionRequestedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "deletionFailedAt" TIMESTAMP(3),
  "deletionAttempts" INTEGER NOT NULL DEFAULT 0,
  "lastDeletionErrorCode" VARCHAR(100),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HealthcareVerificationEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HealthcareVerificationEvidence_access_nonnegative" CHECK ("accessCount" >= 0),
  CONSTRAINT "HealthcareVerificationEvidence_deletion_attempts_nonnegative" CHECK ("deletionAttempts" >= 0)
);

CREATE UNIQUE INDEX "HealthcareVerificationEvidence_mediaAssetId_key"
  ON "HealthcareVerificationEvidence"("mediaAssetId");
CREATE INDEX "HealthcareVerificationEvidence_healthcareVerificationId_deletedAt_idx"
  ON "HealthcareVerificationEvidence"("healthcareVerificationId", "deletedAt");
CREATE INDEX "HealthcareVerificationEvidence_deletionRequestedAt_deletedAt_deletionFailedAt_idx"
  ON "HealthcareVerificationEvidence"("deletionRequestedAt", "deletedAt", "deletionFailedAt");

ALTER TABLE "HealthcareVerificationEvidence"
  ADD CONSTRAINT "HealthcareVerificationEvidence_healthcareVerificationId_fkey"
  FOREIGN KEY ("healthcareVerificationId") REFERENCES "HealthcareVerification"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "HealthcareVerificationEvidence_mediaAssetId_fkey"
  FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
