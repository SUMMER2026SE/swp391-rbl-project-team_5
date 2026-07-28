-- Make promotion funding explicit and preserve every historical booking under
-- the old behavior (the partner bore the whole discount).

CREATE TYPE "VoucherFundingSource" AS ENUM ('PLATFORM', 'PARTNER', 'SHARED');

ALTER TABLE "Voucher"
  ADD COLUMN "fundingSource" "VoucherFundingSource" NOT NULL DEFAULT 'PARTNER',
  ADD COLUMN "platformFundingPercent" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Booking"
  ADD COLUMN "voucherFundingSourceSnapshot" "VoucherFundingSource",
  ADD COLUMN "voucherPlatformFundingPercentSnapshot" INTEGER,
  ADD COLUMN "platformDiscountAmountSnapshot" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "partnerDiscountAmountSnapshot" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "commissionBaseAmountSnapshot" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "platformNetRevenueSnapshot" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Existing vouchers/bookings used the old partner-funded formula. Backfill
-- immutable snapshots so reports and settlements never reinterpret history.
UPDATE "Booking"
SET
  "voucherFundingSourceSnapshot" = CASE
    WHEN "voucherId" IS NULL THEN NULL
    ELSE 'PARTNER'::"VoucherFundingSource"
  END,
  "voucherPlatformFundingPercentSnapshot" = CASE
    WHEN "voucherId" IS NULL THEN NULL
    ELSE 0
  END,
  "platformDiscountAmountSnapshot" = 0,
  "partnerDiscountAmountSnapshot" = "discountAmount",
  "commissionBaseAmountSnapshot" = "totalAmount",
  "platformNetRevenueSnapshot" = "commissionAmountSnapshot";

ALTER TABLE "Voucher"
  ADD CONSTRAINT "Voucher_funding_check"
  CHECK (
    ("fundingSource" = 'PLATFORM' AND "platformFundingPercent" = 100)
    OR ("fundingSource" = 'PARTNER' AND "platformFundingPercent" = 0)
    OR (
      "fundingSource" = 'SHARED'
      AND "platformFundingPercent" BETWEEN 1 AND 99
    )
  );

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_discount_allocation_check"
  CHECK (
    "discountAmount" >= 0
    AND "platformDiscountAmountSnapshot" >= 0
    AND "partnerDiscountAmountSnapshot" >= 0
    AND "platformDiscountAmountSnapshot" + "partnerDiscountAmountSnapshot" = "discountAmount"
  ),
  ADD CONSTRAINT "Booking_commission_allocation_check"
  CHECK (
    "commissionBaseAmountSnapshot" = "subtotalAmount" - "partnerDiscountAmountSnapshot"
    AND "commissionAmountSnapshot" >= 0
    AND "partnerNetAmountSnapshot" = "commissionBaseAmountSnapshot" - "commissionAmountSnapshot"
    AND "platformNetRevenueSnapshot" = "commissionAmountSnapshot" - "platformDiscountAmountSnapshot"
  ),
  ADD CONSTRAINT "Booking_voucher_funding_snapshot_check"
  CHECK (
    (
      "voucherId" IS NULL
      AND "voucherFundingSourceSnapshot" IS NULL
      AND "voucherPlatformFundingPercentSnapshot" IS NULL
    )
    OR (
      "voucherId" IS NOT NULL
      AND "voucherFundingSourceSnapshot" IS NOT NULL
      AND "voucherPlatformFundingPercentSnapshot" BETWEEN 0 AND 100
    )
  );
