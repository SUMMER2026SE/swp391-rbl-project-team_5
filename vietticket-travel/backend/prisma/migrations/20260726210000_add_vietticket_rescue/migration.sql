-- VietTicket Rescue: customer-consented replacement after an operational cancellation.
CREATE TYPE "RecoveryCaseStatus" AS ENUM ('OPEN', 'REPLACED', 'REFUND_PENDING', 'REFUNDED');
CREATE TYPE "RecoveryTrigger" AS ENUM ('PARTNER_CANCELLATION', 'SYSTEM_CANCELLATION');

CREATE TABLE "RecoveryCase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "originalBookingId" TEXT NOT NULL,
    "replacementBookingId" TEXT,
    "status" "RecoveryCaseStatus" NOT NULL DEFAULT 'OPEN',
    "trigger" "RecoveryTrigger" NOT NULL,
    "reason" TEXT NOT NULL,
    "creditAmount" DECIMAL(12,2) NOT NULL,
    "replacementAmount" DECIMAL(12,2),
    "refundAmount" DECIMAL(12,2) NOT NULL DEFAULT 0.0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "originalSnapshot" JSONB NOT NULL,
    "selectedOptionSnapshot" JSONB,
    "acceptedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecoveryCase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecoveryCase_originalBookingId_key"
ON "RecoveryCase"("originalBookingId");

CREATE UNIQUE INDEX "RecoveryCase_replacementBookingId_key"
ON "RecoveryCase"("replacementBookingId");

CREATE INDEX "RecoveryCase_userId_status_createdAt_idx"
ON "RecoveryCase"("userId", "status", "createdAt");

CREATE INDEX "RecoveryCase_status_expiresAt_idx"
ON "RecoveryCase"("status", "expiresAt");

ALTER TABLE "RecoveryCase"
ADD CONSTRAINT "RecoveryCase_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RecoveryCase"
ADD CONSTRAINT "RecoveryCase_originalBookingId_fkey"
FOREIGN KEY ("originalBookingId") REFERENCES "Booking"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RecoveryCase"
ADD CONSTRAINT "RecoveryCase_replacementBookingId_fkey"
FOREIGN KEY ("replacementBookingId") REFERENCES "Booking"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
