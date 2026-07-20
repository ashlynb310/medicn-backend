CREATE TYPE "OperationalCommandType" AS ENUM (
  'job_requeue',
  'payment_reconciliation',
  'host_transfer_reconciliation'
);

CREATE TYPE "OperationalCommandSource" AS ENUM ('admin_api', 'cli');

CREATE TYPE "OperationalCommandStatus" AS ENUM (
  'queued',
  'running',
  'succeeded',
  'partially_succeeded',
  'failed_retryable',
  'failed_permanent'
);

CREATE TABLE "OperationalCommand" (
  "id" TEXT NOT NULL,
  "commandType" "OperationalCommandType" NOT NULL,
  "source" "OperationalCommandSource" NOT NULL,
  "idempotencyKey" VARCHAR(200) NOT NULL,
  "requestedById" TEXT,
  "targetId" TEXT,
  "reason" VARCHAR(500) NOT NULL,
  "status" "OperationalCommandStatus" NOT NULL DEFAULT 'queued',
  "batchLimit" INTEGER,
  "staleBefore" TIMESTAMP(3),
  "scannedCount" INTEGER NOT NULL DEFAULT 0,
  "succeededCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "retryableFailureCount" INTEGER NOT NULL DEFAULT 0,
  "permanentFailureCount" INTEGER NOT NULL DEFAULT 0,
  "providerCallCount" INTEGER NOT NULL DEFAULT 0,
  "resultCode" VARCHAR(100),
  "lastFailureCategory" VARCHAR(100),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OperationalCommand_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OperationalCommand_counts_nonnegative" CHECK (
    "scannedCount" >= 0
    AND "succeededCount" >= 0
    AND "skippedCount" >= 0
    AND "retryableFailureCount" >= 0
    AND "permanentFailureCount" >= 0
    AND "providerCallCount" >= 0
  ),
  CONSTRAINT "OperationalCommand_batch_limit_bounded" CHECK (
    "batchLimit" IS NULL OR ("batchLimit" BETWEEN 1 AND 25)
  ),
  CONSTRAINT "OperationalCommand_requester_required" CHECK (
    ("source" = 'admin_api' AND "requestedById" IS NOT NULL)
    OR ("source" = 'cli' AND "requestedById" IS NULL)
  )
);

CREATE UNIQUE INDEX "OperationalCommand_idempotencyKey_key"
ON "OperationalCommand"("idempotencyKey");

CREATE INDEX "OperationalCommand_commandType_status_createdAt_idx"
ON "OperationalCommand"("commandType", "status", "createdAt");

CREATE INDEX "OperationalCommand_targetId_createdAt_idx"
ON "OperationalCommand"("targetId", "createdAt");

CREATE INDEX "OperationalCommand_requestedById_createdAt_idx"
ON "OperationalCommand"("requestedById", "createdAt");

ALTER TABLE "OperationalCommand"
ADD CONSTRAINT "OperationalCommand_requestedById_fkey"
FOREIGN KEY ("requestedById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
