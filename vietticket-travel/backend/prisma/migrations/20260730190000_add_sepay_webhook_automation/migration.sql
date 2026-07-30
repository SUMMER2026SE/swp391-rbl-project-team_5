CREATE TABLE "BankTransferWebhookEvent" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RECEIVED',
  "bookingId" TEXT,
  "externalReference" TEXT,
  "accountNumber" TEXT,
  "transferAmount" DECIMAL(12,2),
  "transferContent" TEXT,
  "transferredAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "payload" JSONB NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "processingStartedAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BankTransferWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BankTransferWebhookEvent_provider_providerEventId_key"
ON "BankTransferWebhookEvent"("provider", "providerEventId");

CREATE INDEX "BankTransferWebhookEvent_bookingId_idx"
ON "BankTransferWebhookEvent"("bookingId");

CREATE INDEX "BankTransferWebhookEvent_status_createdAt_idx"
ON "BankTransferWebhookEvent"("status", "createdAt");

ALTER TABLE "BankTransferWebhookEvent"
ADD CONSTRAINT "BankTransferWebhookEvent_bookingId_fkey"
FOREIGN KEY ("bookingId") REFERENCES "Booking"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
