-- Giá động theo dự báo: chính sách cấu hình bởi đối tác + sổ cái mọi lần AI tác động vào giá.

-- CreateEnum
CREATE TYPE "DynamicPricingMode" AS ENUM ('SUGGEST_ONLY', 'AUTO_APPLY');
CREATE TYPE "DemandLevel" AS ENUM ('QUIET', 'NORMAL', 'PEAK');
CREATE TYPE "DemandSignalSource" AS ENUM ('NONE', 'REALTIME_OCCUPANCY', 'AI_FORECAST', 'BLENDED');
CREATE TYPE "DemandConfidence" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateTable: chính sách giá động của từng điểm tham quan
CREATE TABLE "DynamicPricingPolicy" (
  "id" TEXT NOT NULL,
  "attractionId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "mode" "DynamicPricingMode" NOT NULL DEFAULT 'SUGGEST_ONLY',
  "highDemandThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.75,
  "lowDemandThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.35,
  "maxSurchargePercent" INTEGER NOT NULL DEFAULT 15,
  "maxDiscountPercent" INTEGER NOT NULL DEFAULT 15,
  "priceFloorPercent" INTEGER NOT NULL DEFAULT 80,
  "priceCeilingPercent" INTEGER NOT NULL DEFAULT 120,
  "roundingStep" INTEGER NOT NULL DEFAULT 1000,
  "lookaheadDays" INTEGER NOT NULL DEFAULT 14,
  "minConfidence" "DemandConfidence" NOT NULL DEFAULT 'MEDIUM',
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DynamicPricingPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable: sổ cái các lượt giữ chỗ đã bị điều chỉnh giá
CREATE TABLE "DynamicPriceAdjustment" (
  "id" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "attractionId" TEXT NOT NULL,
  "ticketProductId" TEXT NOT NULL,
  "reservationId" TEXT NOT NULL,
  "timeSlotId" TEXT,
  "visitDate" DATE NOT NULL,
  "basePrice" DECIMAL(12,2) NOT NULL,
  "finalPrice" DECIMAL(12,2) NOT NULL,
  "adjustmentPercent" DECIMAL(6,2) NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "demandLevel" "DemandLevel" NOT NULL,
  "demandIndex" DOUBLE PRECISION NOT NULL,
  "forecastRatio" DOUBLE PRECISION,
  "realizedRatio" DOUBLE PRECISION NOT NULL,
  "signalSource" "DemandSignalSource" NOT NULL,
  "confidence" "DemandConfidence" NOT NULL,
  "leadTimeDays" INTEGER NOT NULL,
  "modelVersion" TEXT,
  "forecastGeneratedAt" TIMESTAMP(3),
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DynamicPriceAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DynamicPricingPolicy_attractionId_key" ON "DynamicPricingPolicy"("attractionId");
CREATE INDEX "DynamicPricingPolicy_enabled_mode_idx" ON "DynamicPricingPolicy"("enabled", "mode");
CREATE UNIQUE INDEX "DynamicPriceAdjustment_reservationId_key" ON "DynamicPriceAdjustment"("reservationId");
CREATE INDEX "DynamicPriceAdjustment_attractionId_visitDate_idx" ON "DynamicPriceAdjustment"("attractionId", "visitDate");
CREATE INDEX "DynamicPriceAdjustment_attractionId_createdAt_idx" ON "DynamicPriceAdjustment"("attractionId", "createdAt");
CREATE INDEX "DynamicPriceAdjustment_demandLevel_idx" ON "DynamicPriceAdjustment"("demandLevel");

-- AddForeignKey
ALTER TABLE "DynamicPricingPolicy" ADD CONSTRAINT "DynamicPricingPolicy_attractionId_fkey" FOREIGN KEY ("attractionId") REFERENCES "Attraction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DynamicPricingPolicy" ADD CONSTRAINT "DynamicPricingPolicy_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DynamicPriceAdjustment" ADD CONSTRAINT "DynamicPriceAdjustment_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "DynamicPricingPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DynamicPriceAdjustment" ADD CONSTRAINT "DynamicPriceAdjustment_attractionId_fkey" FOREIGN KEY ("attractionId") REFERENCES "Attraction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DynamicPriceAdjustment" ADD CONSTRAINT "DynamicPriceAdjustment_ticketProductId_fkey" FOREIGN KEY ("ticketProductId") REFERENCES "TicketProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DynamicPriceAdjustment" ADD CONSTRAINT "DynamicPriceAdjustment_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hàng rào ở tầng CSDL: ngưỡng nhu cầu và biên điều chỉnh phải hợp lệ dù API bị bỏ qua.
ALTER TABLE "DynamicPricingPolicy" ADD CONSTRAINT "DynamicPricingPolicy_thresholds_check"
  CHECK ("lowDemandThreshold" >= 0 AND "lowDemandThreshold" < "highDemandThreshold" AND "highDemandThreshold" <= 1);
ALTER TABLE "DynamicPricingPolicy" ADD CONSTRAINT "DynamicPricingPolicy_bounds_check"
  CHECK (
    "maxSurchargePercent" >= 0 AND "maxSurchargePercent" <= 100
    AND "maxDiscountPercent" >= 0 AND "maxDiscountPercent" <= 100
    AND "priceFloorPercent" >= 1 AND "priceFloorPercent" <= 100
    AND "priceCeilingPercent" >= 100 AND "priceCeilingPercent" <= 300
    AND "roundingStep" >= 1
    AND "lookaheadDays" >= 1 AND "lookaheadDays" <= 60
  );
