-- Voucher validity, funding ownership and redemption ledger.
ALTER TABLE "Voucher"
ADD COLUMN "startDate" TIMESTAMP(3),
ADD COLUMN "maxUsesPerUser" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "fundingPartnerId" TEXT,
ADD COLUMN "applicablePartnerId" TEXT,
ADD COLUMN "applicableAttractionId" TEXT,
ADD COLUMN "applicableTicketProductId" TEXT;

UPDATE "Voucher"
SET "startDate" = "createdAt"
WHERE "startDate" IS NULL;

ALTER TABLE "Voucher"
ALTER COLUMN "startDate" SET NOT NULL,
ALTER COLUMN "startDate" SET DEFAULT CURRENT_TIMESTAMP;

-- Legacy partner/shared promotions did not identify the funding partner. They
-- are converted to platform-funded rather than silently charging an unrelated
-- supplier after this migration.
UPDATE "Voucher"
SET "fundingSource" = 'PLATFORM',
    "platformFundingPercent" = 100
WHERE "source" = 'PROMOTION'
  AND "fundingSource" IN ('PARTNER', 'SHARED')
  AND "fundingPartnerId" IS NULL;

CREATE TYPE "VoucherRedemptionStatus" AS ENUM ('ACTIVE', 'RELEASED');

CREATE TABLE "VoucherRedemption" (
  "id" TEXT NOT NULL,
  "voucherId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "status" "VoucherRedemptionStatus" NOT NULL DEFAULT 'ACTIVE',
  "releasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VoucherRedemption_pkey" PRIMARY KEY ("id")
);

INSERT INTO "VoucherRedemption" (
  "id",
  "voucherId",
  "userId",
  "bookingId",
  "status",
  "releasedAt",
  "createdAt",
  "updatedAt"
)
SELECT
  md5(random()::text || clock_timestamp()::text || b."id"),
  b."voucherId",
  b."userId",
  b."id",
  CASE
    WHEN b."status" IN ('CANCELLED', 'REFUNDED') THEN 'RELEASED'::"VoucherRedemptionStatus"
    ELSE 'ACTIVE'::"VoucherRedemptionStatus"
  END,
  CASE
    WHEN b."status" IN ('CANCELLED', 'REFUNDED') THEN COALESCE(b."cancelledAt", b."updatedAt")
    ELSE NULL
  END,
  b."createdAt",
  b."updatedAt"
FROM "Booking" b
WHERE b."voucherId" IS NOT NULL;

CREATE UNIQUE INDEX "VoucherRedemption_bookingId_key"
ON "VoucherRedemption"("bookingId");

CREATE INDEX "VoucherRedemption_voucherId_userId_status_idx"
ON "VoucherRedemption"("voucherId", "userId", "status");

CREATE INDEX "VoucherRedemption_userId_status_idx"
ON "VoucherRedemption"("userId", "status");

CREATE INDEX "Voucher_fundingPartnerId_idx" ON "Voucher"("fundingPartnerId");
CREATE INDEX "Voucher_applicablePartnerId_idx" ON "Voucher"("applicablePartnerId");
CREATE INDEX "Voucher_applicableAttractionId_idx" ON "Voucher"("applicableAttractionId");
CREATE INDEX "Voucher_applicableTicketProductId_idx" ON "Voucher"("applicableTicketProductId");

ALTER TABLE "Voucher"
ADD CONSTRAINT "Voucher_fundingPartnerId_fkey"
FOREIGN KEY ("fundingPartnerId") REFERENCES "PartnerProfile"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Voucher"
ADD CONSTRAINT "Voucher_applicablePartnerId_fkey"
FOREIGN KEY ("applicablePartnerId") REFERENCES "PartnerProfile"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Voucher"
ADD CONSTRAINT "Voucher_applicableAttractionId_fkey"
FOREIGN KEY ("applicableAttractionId") REFERENCES "Attraction"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Voucher"
ADD CONSTRAINT "Voucher_applicableTicketProductId_fkey"
FOREIGN KEY ("applicableTicketProductId") REFERENCES "TicketProduct"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VoucherRedemption"
ADD CONSTRAINT "VoucherRedemption_voucherId_fkey"
FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VoucherRedemption"
ADD CONSTRAINT "VoucherRedemption_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VoucherRedemption"
ADD CONSTRAINT "VoucherRedemption_bookingId_fkey"
FOREIGN KEY ("bookingId") REFERENCES "Booking"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Voucher"
ADD CONSTRAINT "Voucher_maxUsesPerUser_check"
CHECK ("maxUsesPerUser" BETWEEN 1 AND 100);

ALTER TABLE "Voucher"
ADD CONSTRAINT "Voucher_date_window_check"
CHECK ("startDate" < "expiryDate");

ALTER TABLE "Voucher"
ADD CONSTRAINT "Voucher_scope_hierarchy_check"
CHECK (
  "applicableTicketProductId" IS NULL
  OR "applicableAttractionId" IS NOT NULL
);
