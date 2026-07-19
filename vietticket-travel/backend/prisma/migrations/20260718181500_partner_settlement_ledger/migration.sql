CREATE TYPE "SettlementStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID', 'CANCELLED');

CREATE TABLE "PartnerSettlement" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "grossAmount" DECIMAL(14,2) NOT NULL,
    "refundAmount" DECIMAL(14,2) NOT NULL DEFAULT 0.0,
    "netAmount" DECIMAL(14,2) NOT NULL,
    "commissionAmount" DECIMAL(14,2) NOT NULL,
    "payableAmount" DECIMAL(14,2) NOT NULL,
    "bookingCount" INTEGER NOT NULL,
    "bankNameSnapshot" TEXT NOT NULL,
    "bankAccountNameSnapshot" TEXT NOT NULL,
    "bankAccountLast4Snapshot" TEXT NOT NULL,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidById" TEXT,
    "paidAt" TIMESTAMP(3),
    "bankReference" TEXT,
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PartnerSettlement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartnerSettlementItem" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "grossAmount" DECIMAL(14,2) NOT NULL,
    "refundAmount" DECIMAL(14,2) NOT NULL DEFAULT 0.0,
    "netAmount" DECIMAL(14,2) NOT NULL,
    "commissionAmount" DECIMAL(14,2) NOT NULL,
    "payableAmount" DECIMAL(14,2) NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PartnerSettlementItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PartnerSettlement_partnerId_periodStart_periodEnd_idx"
ON "PartnerSettlement"("partnerId", "periodStart", "periodEnd");
CREATE UNIQUE INDEX "PartnerSettlement_bankReference_key"
ON "PartnerSettlement"("bankReference");
CREATE INDEX "PartnerSettlement_partnerId_status_idx"
ON "PartnerSettlement"("partnerId", "status");
CREATE INDEX "PartnerSettlement_status_createdAt_idx"
ON "PartnerSettlement"("status", "createdAt");
CREATE INDEX "PartnerSettlement_periodStart_periodEnd_idx"
ON "PartnerSettlement"("periodStart", "periodEnd");
CREATE INDEX "PartnerSettlementItem_settlementId_idx"
ON "PartnerSettlementItem"("settlementId");
CREATE INDEX "PartnerSettlementItem_bookingId_releasedAt_idx"
ON "PartnerSettlementItem"("bookingId", "releasedAt");

-- A booking can belong to at most one non-cancelled settlement. Cancelled
-- settlements retain their immutable evidence rows with releasedAt populated.
CREATE UNIQUE INDEX "PartnerSettlementItem_active_booking_key"
ON "PartnerSettlementItem"("bookingId")
WHERE "releasedAt" IS NULL;

ALTER TABLE "PartnerSettlement"
ADD CONSTRAINT "PartnerSettlement_partnerId_fkey"
FOREIGN KEY ("partnerId") REFERENCES "PartnerProfile"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PartnerSettlementItem"
ADD CONSTRAINT "PartnerSettlementItem_settlementId_fkey"
FOREIGN KEY ("settlementId") REFERENCES "PartnerSettlement"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PartnerSettlementItem"
ADD CONSTRAINT "PartnerSettlementItem_bookingId_fkey"
FOREIGN KEY ("bookingId") REFERENCES "Booking"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
