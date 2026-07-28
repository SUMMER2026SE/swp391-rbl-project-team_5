-- Keep an auditable link to the booking that owns the captured gateway payment.
-- This lets a replacement booking enter Rescue again without inventing money,
-- refunding twice, or losing the original VNPay transaction.
ALTER TABLE "RecoveryCase"
ADD COLUMN "fundingBookingId" TEXT;

UPDATE "RecoveryCase"
SET "fundingBookingId" = "originalBookingId";

ALTER TABLE "RecoveryCase"
ALTER COLUMN "fundingBookingId" SET NOT NULL;

CREATE INDEX "RecoveryCase_fundingBookingId_idx"
ON "RecoveryCase"("fundingBookingId");

ALTER TABLE "RecoveryCase"
ADD CONSTRAINT "RecoveryCase_fundingBookingId_fkey"
FOREIGN KEY ("fundingBookingId") REFERENCES "Booking"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
