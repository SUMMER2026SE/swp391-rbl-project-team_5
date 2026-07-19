-- Preserve financial terms per booking and record cancellation provenance.
ALTER TABLE "Booking"
ADD COLUMN IF NOT EXISTS "commissionRateSnapshot" DECIMAL(5,2) NOT NULL DEFAULT 0.10,
ADD COLUMN IF NOT EXISTS "commissionAmountSnapshot" DECIMAL(12,2) NOT NULL DEFAULT 0.0,
ADD COLUMN IF NOT EXISTS "partnerNetAmountSnapshot" DECIMAL(12,2) NOT NULL DEFAULT 0.0,
ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "cancellationReason" TEXT,
ADD COLUMN IF NOT EXISTS "cancellationSource" TEXT;

-- Historical bookings predate commission snapshots. The platform default at that
-- time was 10%, so backfill deterministic values instead of applying future rate changes.
UPDATE "Booking"
SET
  "commissionRateSnapshot" = 0.10,
  "commissionAmountSnapshot" = ROUND("totalAmount" * 0.10, 2),
  "partnerNetAmountSnapshot" = "totalAmount" - ROUND("totalAmount" * 0.10, 2)
WHERE "commissionAmountSnapshot" = 0.0
  AND "partnerNetAmountSnapshot" = 0.0;

CREATE INDEX IF NOT EXISTS "Booking_cancelledAt_idx" ON "Booking"("cancelledAt");
