ALTER TYPE "OutboxEventStatus" ADD VALUE IF NOT EXISTS 'publishing' AFTER 'pending';

CREATE TYPE "JobExecutionState" AS ENUM ('running', 'succeeded', 'failed');
CREATE TYPE "EmailProvider" AS ENUM ('local', 'brevo');
CREATE TYPE "EmailDeliveryStatus" AS ENUM (
  'pending', 'simulated', 'accepted', 'sent', 'delivered', 'deferred',
  'soft_bounced', 'hard_bounced', 'blocked', 'invalid', 'complained',
  'unsubscribed', 'suppressed', 'failed'
);
CREATE TYPE "EmailWebhookEventType" AS ENUM (
  'request', 'sent', 'delivered', 'deferred', 'soft_bounce', 'hard_bounce',
  'blocked', 'invalid', 'complaint', 'error', 'unsubscribed', 'unknown'
);
CREATE TYPE "EmailWebhookProcessingStatus" AS ENUM (
  'received', 'processed', 'failed', 'ignored', 'unmatched'
);
CREATE TYPE "RecipientSuppressionReason" AS ENUM (
  'hard_bounce', 'blocked', 'invalid', 'complaint'
);
CREATE TYPE "WorkerProcessType" AS ENUM (
  'outbox', 'email', 'media', 'maps', 'operations'
);

ALTER TABLE "OutboxEvent"
  ADD COLUMN "errorCategory" TEXT,
  ADD COLUMN "claimedAt" TIMESTAMP(3),
  ADD COLUMN "claimExpiresAt" TIMESTAMP(3),
  ADD COLUMN "claimedBy" TEXT;

CREATE TABLE "JobExecution" (
  "id" TEXT NOT NULL,
  "outboxEventId" TEXT,
  "queueName" TEXT NOT NULL,
  "jobType" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "aggregateType" TEXT,
  "aggregateId" TEXT,
  "attemptNumber" INTEGER NOT NULL,
  "state" "JobExecutionState" NOT NULL DEFAULT 'running',
  "workerIdentity" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "retryable" BOOLEAN,
  "errorCategory" TEXT,
  "errorMessage" TEXT,
  "providerRef" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobExecution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailDelivery" (
  "id" TEXT NOT NULL,
  "outboxEventId" TEXT NOT NULL,
  "recipient" TEXT NOT NULL,
  "recipientHash" TEXT NOT NULL,
  "template" TEXT NOT NULL,
  "provider" "EmailProvider" NOT NULL,
  "providerMessageId" TEXT,
  "status" "EmailDeliveryStatus" NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "acceptedAt" TIMESTAMP(3), "sentAt" TIMESTAMP(3), "deliveredAt" TIMESTAMP(3),
  "deferredAt" TIMESTAMP(3), "softBouncedAt" TIMESTAMP(3), "hardBouncedAt" TIMESTAMP(3),
  "blockedAt" TIMESTAMP(3), "invalidAt" TIMESTAMP(3), "complainedAt" TIMESTAMP(3),
  "unsubscribedAt" TIMESTAMP(3), "suppressedAt" TIMESTAMP(3), "failedAt" TIMESTAMP(3),
  "lastEventAt" TIMESTAMP(3),
  "lastEventPrecedence" INTEGER NOT NULL DEFAULT 0,
  "errorCategory" TEXT, "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailDelivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailWebhookEvent" (
  "id" TEXT NOT NULL,
  "deliveryKey" TEXT NOT NULL,
  "emailDeliveryId" TEXT,
  "providerMessageId" TEXT NOT NULL,
  "eventType" "EmailWebhookEventType" NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "payloadDigest" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "EmailWebhookProcessingStatus" NOT NULL DEFAULT 'received',
  "processingAttempts" INTEGER NOT NULL DEFAULT 0,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "errorCategory" TEXT, "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecipientSuppression" (
  "id" TEXT NOT NULL,
  "recipientHash" TEXT NOT NULL,
  "reason" "RecipientSuppressionReason" NOT NULL,
  "providerMessageId" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "suppressedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecipientSuppression_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkerHeartbeat" (
  "id" TEXT NOT NULL,
  "processType" "WorkerProcessType" NOT NULL,
  "instanceId" TEXT NOT NULL,
  "processStartedAt" TIMESTAMP(3) NOT NULL,
  "lastHeartbeatAt" TIMESTAMP(3) NOT NULL,
  "version" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JobExecution_queueName_jobId_attemptNumber_key" ON "JobExecution"("queueName", "jobId", "attemptNumber");
CREATE INDEX "JobExecution_state_startedAt_idx" ON "JobExecution"("state", "startedAt");
CREATE INDEX "JobExecution_outboxEventId_idx" ON "JobExecution"("outboxEventId");
CREATE INDEX "JobExecution_queueName_state_updatedAt_idx" ON "JobExecution"("queueName", "state", "updatedAt");
CREATE UNIQUE INDEX "EmailDelivery_outboxEventId_key" ON "EmailDelivery"("outboxEventId");
CREATE UNIQUE INDEX "EmailDelivery_providerMessageId_key" ON "EmailDelivery"("providerMessageId");
CREATE INDEX "EmailDelivery_status_updatedAt_idx" ON "EmailDelivery"("status", "updatedAt");
CREATE INDEX "EmailDelivery_recipientHash_status_idx" ON "EmailDelivery"("recipientHash", "status");
CREATE UNIQUE INDEX "EmailWebhookEvent_deliveryKey_key" ON "EmailWebhookEvent"("deliveryKey");
CREATE INDEX "EmailWebhookEvent_status_receivedAt_idx" ON "EmailWebhookEvent"("status", "receivedAt");
CREATE INDEX "EmailWebhookEvent_providerMessageId_occurredAt_idx" ON "EmailWebhookEvent"("providerMessageId", "occurredAt");
CREATE UNIQUE INDEX "RecipientSuppression_recipientHash_key" ON "RecipientSuppression"("recipientHash");
CREATE INDEX "RecipientSuppression_active_reason_idx" ON "RecipientSuppression"("active", "reason");
CREATE UNIQUE INDEX "WorkerHeartbeat_processType_instanceId_key" ON "WorkerHeartbeat"("processType", "instanceId");
CREATE INDEX "WorkerHeartbeat_processType_lastHeartbeatAt_idx" ON "WorkerHeartbeat"("processType", "lastHeartbeatAt");
CREATE INDEX "OutboxEvent_status_claimExpiresAt_idx" ON "OutboxEvent"("status", "claimExpiresAt");

ALTER TABLE "JobExecution" ADD CONSTRAINT "JobExecution_outboxEventId_fkey"
  FOREIGN KEY ("outboxEventId") REFERENCES "OutboxEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_outboxEventId_fkey"
  FOREIGN KEY ("outboxEventId") REFERENCES "OutboxEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmailWebhookEvent" ADD CONSTRAINT "EmailWebhookEvent_emailDeliveryId_fkey"
  FOREIGN KEY ("emailDeliveryId") REFERENCES "EmailDelivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;
