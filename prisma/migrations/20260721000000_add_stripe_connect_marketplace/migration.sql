-- CreateEnum
CREATE TYPE "StripeAccountApiModel" AS ENUM ('accounts_v2_recipient');

-- CreateEnum
CREATE TYPE "ConnectCapabilityStatus" AS ENUM ('pending', 'active', 'restricted', 'unsupported');

-- CreateEnum
CREATE TYPE "HostTransferStatus" AS ENUM ('pending', 'processing', 'transferred', 'failed', 'blocked');

-- CreateEnum
CREATE TYPE "HostTransferReversalStatus" AS ENUM ('none', 'pending', 'processing', 'partially_reversed', 'reversed', 'failed');

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "providerChargeId" TEXT;

-- CreateTable
CREATE TABLE "ConnectedAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "apiModel" "StripeAccountApiModel" NOT NULL DEFAULT 'accounts_v2_recipient',
    "country" TEXT,
    "currency" TEXT,
    "detailsSubmitted" BOOLEAN NOT NULL DEFAULT false,
    "transfersCapability" "ConnectCapabilityStatus" NOT NULL DEFAULT 'pending',
    "transfersReady" BOOLEAN NOT NULL DEFAULT false,
    "payoutsEnabled" BOOLEAN,
    "requirementsCurrentlyDue" JSONB NOT NULL DEFAULT '[]',
    "requirementsPastDue" JSONB NOT NULL DEFAULT '[]',
    "lastSynchronizedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectedAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostTransfer" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "connectedAccountId" TEXT NOT NULL,
    "providerConnectedAccountId" TEXT NOT NULL,
    "grossAmountCents" INTEGER NOT NULL,
    "platformFeeCents" INTEGER NOT NULL,
    "hostNetAmountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "transferGroup" TEXT NOT NULL,
    "status" "HostTransferStatus" NOT NULL DEFAULT 'pending',
    "providerTransferId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "eligibleAt" TIMESTAMP(3) NOT NULL,
    "transferredAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "reversedAmountCents" INTEGER NOT NULL DEFAULT 0,
    "reversalTargetAmountCents" INTEGER NOT NULL DEFAULT 0,
    "reversalStatus" "HostTransferReversalStatus" NOT NULL DEFAULT 'none',
    "reversalProviderIds" JSONB NOT NULL DEFAULT '[]',
    "reversalIdempotencyKey" TEXT,
    "reversalFailedAt" TIMESTAMP(3),
    "reversalFailureCode" TEXT,
    "reversalFailureMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HostTransfer_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "HostTransfer_amounts_check" CHECK (
      "grossAmountCents" > 0 AND
      "platformFeeCents" >= 0 AND
      "hostNetAmountCents" >= 0 AND
      "platformFeeCents" + "hostNetAmountCents" = "grossAmountCents" AND
      "reversedAmountCents" >= 0 AND
      "reversalTargetAmountCents" >= "reversedAmountCents" AND
      "reversalTargetAmountCents" <= "hostNetAmountCents"
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerChargeId_key" ON "Payment"("providerChargeId");
CREATE UNIQUE INDEX "ConnectedAccount_userId_key" ON "ConnectedAccount"("userId");
CREATE UNIQUE INDEX "ConnectedAccount_providerAccountId_key" ON "ConnectedAccount"("providerAccountId");
CREATE INDEX "ConnectedAccount_transfersReady_idx" ON "ConnectedAccount"("transfersReady");
CREATE UNIQUE INDEX "HostTransfer_bookingId_key" ON "HostTransfer"("bookingId");
CREATE UNIQUE INDEX "HostTransfer_paymentId_key" ON "HostTransfer"("paymentId");
CREATE UNIQUE INDEX "HostTransfer_transferGroup_key" ON "HostTransfer"("transferGroup");
CREATE UNIQUE INDEX "HostTransfer_providerTransferId_key" ON "HostTransfer"("providerTransferId");
CREATE UNIQUE INDEX "HostTransfer_idempotencyKey_key" ON "HostTransfer"("idempotencyKey");
CREATE UNIQUE INDEX "HostTransfer_bookingId_paymentId_key" ON "HostTransfer"("bookingId", "paymentId");
CREATE INDEX "HostTransfer_status_eligibleAt_idx" ON "HostTransfer"("status", "eligibleAt");
CREATE INDEX "HostTransfer_reversalStatus_updatedAt_idx" ON "HostTransfer"("reversalStatus", "updatedAt");
CREATE INDEX "HostTransfer_hostId_idx" ON "HostTransfer"("hostId");

-- AddForeignKey
ALTER TABLE "ConnectedAccount" ADD CONSTRAINT "ConnectedAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HostTransfer" ADD CONSTRAINT "HostTransfer_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HostTransfer" ADD CONSTRAINT "HostTransfer_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HostTransfer" ADD CONSTRAINT "HostTransfer_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HostTransfer" ADD CONSTRAINT "HostTransfer_connectedAccountId_fkey" FOREIGN KEY ("connectedAccountId") REFERENCES "ConnectedAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
