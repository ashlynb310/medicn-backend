ALTER TABLE "HealthcareVerification"
ADD COLUMN "legacyIdentitySource" BOOLEAN NOT NULL DEFAULT false;

-- Records copied by 20260722000000 retained the HealthcareVerification id in
-- IdentityVerification. Mark that exact provenance without deleting history.
-- provenance-backfill:start
UPDATE "HealthcareVerification" AS healthcare
SET "legacyIdentitySource" = true
WHERE EXISTS (
  SELECT 1
  FROM "IdentityVerification" AS identity
  WHERE identity."id" = healthcare."id"
    AND identity."provider" = 'veriff'::"IdentityProvider"
);
-- provenance-backfill:end

-- The deprecated User cache is healthcare-only. Recalculate every user from
-- the newest genuine healthcare credential, or not_started when none exists.
-- healthcare-status-backfill:start
UPDATE "User" AS app_user
SET "currentVerificationStatus" = COALESCE(
  (
    SELECT healthcare."status"
    FROM "HealthcareVerification" AS healthcare
    WHERE healthcare."userId" = app_user."id"
      AND healthcare."legacyIdentitySource" = false
    ORDER BY healthcare."createdAt" DESC, healthcare."id" DESC
    LIMIT 1
  ),
  'not_started'::"VerificationStatus"
);
-- healthcare-status-backfill:end
