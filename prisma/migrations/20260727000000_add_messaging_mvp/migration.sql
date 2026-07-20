-- Phase 5.7A: durable inquiry state, stable message order, and audit support.
-- Message.readAt and Inquiry.status='archived' remain legacy compatibility
-- fields; neither is authoritative after this migration.

ALTER TYPE "AdminTargetType" ADD VALUE IF NOT EXISTS 'inquiry';
ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'message_sent';

ALTER TABLE "Inquiry"
  ADD COLUMN "lastSequence" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastMessageAt" TIMESTAMP(3),
  ADD COLUMN "closedById" TEXT;

ALTER TABLE "Message"
  ADD COLUMN "sequence" INTEGER,
  ADD COLUMN "senderRole" "UserRole";

WITH ordered_messages AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "inquiryId"
      ORDER BY "createdAt" ASC, "id" ASC
    )::INTEGER AS sequence
  FROM "Message"
)
UPDATE "Message" AS message
SET "sequence" = ordered_messages.sequence
FROM ordered_messages
WHERE message."id" = ordered_messages."id";

UPDATE "Message" AS message
SET "senderRole" = CASE
  WHEN message."senderId" = inquiry."renterId" THEN 'renter'::"UserRole"
  WHEN message."senderId" = inquiry."hostId" THEN 'host'::"UserRole"
  ELSE 'admin'::"UserRole"
END
FROM "Inquiry" AS inquiry
WHERE inquiry."id" = message."inquiryId";

ALTER TABLE "Message"
  ALTER COLUMN "sequence" SET NOT NULL,
  ALTER COLUMN "senderRole" SET NOT NULL;

ALTER TABLE "Message"
  ADD CONSTRAINT "Message_sequence_positive" CHECK ("sequence" > 0);
ALTER TABLE "Inquiry"
  ADD CONSTRAINT "Inquiry_lastSequence_nonnegative" CHECK ("lastSequence" >= 0);

UPDATE "Inquiry" AS inquiry
SET
  "lastSequence" = aggregate."lastSequence",
  "lastMessageAt" = aggregate."lastMessageAt"
FROM (
  SELECT
    "inquiryId",
    MAX("sequence") AS "lastSequence",
    MAX("createdAt") AS "lastMessageAt"
  FROM "Message"
  GROUP BY "inquiryId"
) AS aggregate
WHERE inquiry."id" = aggregate."inquiryId";

CREATE TABLE "InquiryParticipantState" (
  "id" TEXT NOT NULL,
  "inquiryId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "UserRole" NOT NULL,
  "lastReadSequence" INTEGER NOT NULL DEFAULT 0,
  "lastReadAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InquiryParticipantState_pkey" PRIMARY KEY ("id")
);

INSERT INTO "InquiryParticipantState" (
  "id", "inquiryId", "userId", "role", "lastReadSequence",
  "lastReadAt", "archivedAt", "createdAt", "updatedAt"
)
SELECT DISTINCT ON (inquiry."id", participant."userId")
  gen_random_uuid()::TEXT,
  inquiry."id",
  participant."userId",
  participant."role"::"UserRole",
  0,
  NULL,
  CASE WHEN inquiry."status" = 'archived' THEN inquiry."updatedAt" ELSE NULL END,
  inquiry."createdAt",
  inquiry."updatedAt"
FROM "Inquiry" AS inquiry
CROSS JOIN LATERAL (
  VALUES
    (inquiry."renterId", 'renter'),
    (inquiry."hostId", 'host')
) AS participant("userId", "role")
ORDER BY inquiry."id", participant."userId", participant."role"
ON CONFLICT DO NOTHING;

-- A legacy global archive is converted to user-local archive state.
UPDATE "Inquiry"
SET "status" = 'open'
WHERE "status" = 'archived' AND "closedAt" IS NULL;

UPDATE "Inquiry"
SET "closedAt" = "updatedAt"
WHERE "status" = 'closed' AND "closedAt" IS NULL;

UPDATE "Inquiry"
SET "status" = 'closed'
WHERE "closedAt" IS NOT NULL AND "status" <> 'closed';

CREATE UNIQUE INDEX "Message_inquiryId_sequence_key"
  ON "Message"("inquiryId", "sequence");
CREATE INDEX "Message_inquiryId_createdAt_idx"
  ON "Message"("inquiryId", "createdAt");
DROP INDEX IF EXISTS "Message_inquiryId_idx";

CREATE UNIQUE INDEX "InquiryParticipantState_inquiryId_userId_key"
  ON "InquiryParticipantState"("inquiryId", "userId");
CREATE INDEX "InquiryParticipantState_userId_archivedAt_idx"
  ON "InquiryParticipantState"("userId", "archivedAt");
CREATE INDEX "InquiryParticipantState_inquiryId_userId_lastReadSequence_idx"
  ON "InquiryParticipantState"("inquiryId", "userId", "lastReadSequence");
ALTER TABLE "InquiryParticipantState"
  ADD CONSTRAINT "InquiryParticipantState_lastReadSequence_nonnegative"
  CHECK ("lastReadSequence" >= 0);

DROP INDEX IF EXISTS "Inquiry_renterId_idx";
DROP INDEX IF EXISTS "Inquiry_hostId_idx";
CREATE INDEX "Inquiry_renterId_closedAt_lastMessageAt_idx"
  ON "Inquiry"("renterId", "closedAt", "lastMessageAt");
CREATE INDEX "Inquiry_hostId_closedAt_lastMessageAt_idx"
  ON "Inquiry"("hostId", "closedAt", "lastMessageAt");

-- PostgreSQL, not an application pre-check, is the concurrency boundary.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Inquiry"
    WHERE "closedAt" IS NULL
    GROUP BY "listingId", "renterId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Phase 5.7A migration requires duplicate open renter/listing inquiries to be resolved first';
  END IF;
END $$;

CREATE UNIQUE INDEX "Inquiry_one_open_per_renter_listing_key"
  ON "Inquiry"("listingId", "renterId")
  WHERE "closedAt" IS NULL;

ALTER TABLE "Inquiry"
  ADD CONSTRAINT "Inquiry_closedById_fkey"
  FOREIGN KEY ("closedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InquiryParticipantState"
  ADD CONSTRAINT "InquiryParticipantState_inquiryId_fkey"
  FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InquiryParticipantState"
  ADD CONSTRAINT "InquiryParticipantState_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
