-- Phase 5.9B evidence-backed indexes. The pre-migration seeded EXPLAIN audit
-- showed sequential scans plus top-N sorts on these bounded HTTP list paths.

CREATE INDEX "Listing_status_city_createdAt_id_idx"
  ON "Listing"("status", "city", "createdAt" DESC, "id" DESC);

CREATE INDEX "Listing_status_city_priceCents_id_idx"
  ON "Listing"("status", "city", "priceCents", "id");

CREATE INDEX "Inquiry_renterId_closedAt_lastMessageAt_id_idx"
  ON "Inquiry"("renterId", "closedAt", "lastMessageAt" DESC, "id" DESC);

CREATE INDEX "Inquiry_hostId_closedAt_lastMessageAt_id_idx"
  ON "Inquiry"("hostId", "closedAt", "lastMessageAt" DESC, "id" DESC);

CREATE INDEX "Booking_renterId_createdAt_id_idx"
  ON "Booking"("renterId", "createdAt" DESC, "id" DESC);

CREATE INDEX "Booking_hostId_createdAt_id_idx"
  ON "Booking"("hostId", "createdAt" DESC, "id" DESC);

CREATE INDEX "Payment_status_createdAt_id_idx"
  ON "Payment"("status", "createdAt" DESC, "id" DESC);

CREATE INDEX "HostTransfer_status_createdAt_id_idx"
  ON "HostTransfer"("status", "createdAt" DESC, "id" DESC);

CREATE INDEX "JobExecution_queueName_state_createdAt_id_idx"
  ON "JobExecution"("queueName", "state", "createdAt" DESC, "id" DESC);
