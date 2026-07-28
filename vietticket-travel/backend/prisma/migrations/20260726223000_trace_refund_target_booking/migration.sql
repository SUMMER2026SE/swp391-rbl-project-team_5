-- A refund may be charged against the VNPay funding booking while applying
-- operationally to a later Rescue replacement booking.
ALTER TABLE "RefundRequest"
ADD COLUMN "targetBookingId" TEXT;

CREATE INDEX "RefundRequest_targetBookingId_idx"
ON "RefundRequest"("targetBookingId");

ALTER TABLE "RefundRequest"
ADD CONSTRAINT "RefundRequest_targetBookingId_fkey"
FOREIGN KEY ("targetBookingId") REFERENCES "Booking"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
