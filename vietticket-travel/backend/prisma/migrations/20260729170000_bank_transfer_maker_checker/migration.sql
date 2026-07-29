CREATE TYPE "BankTransferReconciliationStatus" AS ENUM ('MATCHED', 'APPROVED');

CREATE TABLE "BankTransferReconciliation" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "externalReference" TEXT NOT NULL,
  "receivedAmount" DECIMAL(12,2) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL,
  "payerName" TEXT,
  "evidenceNote" TEXT,
  "status" "BankTransferReconciliationStatus" NOT NULL DEFAULT 'MATCHED',
  "matchedById" TEXT NOT NULL,
  "matchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BankTransferReconciliation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BankTransferReconciliation_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "Booking"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BankTransferReconciliation_matchedById_fkey"
    FOREIGN KEY ("matchedById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BankTransferReconciliation_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "BankTransferReconciliation_bookingId_key"
ON "BankTransferReconciliation"("bookingId");
CREATE UNIQUE INDEX "BankTransferReconciliation_externalReference_key"
ON "BankTransferReconciliation"("externalReference");
CREATE INDEX "BankTransferReconciliation_status_matchedAt_idx"
ON "BankTransferReconciliation"("status", "matchedAt");
CREATE INDEX "BankTransferReconciliation_matchedById_idx"
ON "BankTransferReconciliation"("matchedById");
CREATE INDEX "BankTransferReconciliation_approvedById_idx"
ON "BankTransferReconciliation"("approvedById");
