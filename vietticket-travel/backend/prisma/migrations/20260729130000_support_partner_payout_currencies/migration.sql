ALTER TABLE "PartnerProfile"
DROP CONSTRAINT IF EXISTS "PartnerProfile_payoutCurrency_vnd_check";

ALTER TABLE "PartnerProfile"
ADD CONSTRAINT "PartnerProfile_payoutCurrency_supported_check"
CHECK ("payoutCurrency" IN ('VND', 'USD', 'EUR', 'SGD', 'THB'));

ALTER TABLE "PartnerSettlement"
ADD COLUMN "baseCurrency" TEXT NOT NULL DEFAULT 'VND',
ADD COLUMN "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1.0;
