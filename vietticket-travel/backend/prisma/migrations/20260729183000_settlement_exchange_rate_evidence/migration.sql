ALTER TABLE "PartnerSettlement"
ADD COLUMN "exchangeRateSource" TEXT NOT NULL DEFAULT 'LEGACY_CONFIG',
ADD COLUMN "exchangeRateEffectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "PartnerSettlement"
SET "exchangeRateEffectiveAt" = "createdAt";
