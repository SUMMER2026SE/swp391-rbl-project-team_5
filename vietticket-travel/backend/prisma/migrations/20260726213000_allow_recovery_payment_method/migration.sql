-- Recovery bookings are funded by the already captured source payment. Keep
-- the legacy VNPay-only invariant while explicitly admitting this internal,
-- audited funding method.
ALTER TABLE "Booking"
  DROP CONSTRAINT IF EXISTS "Booking_payment_method_chk";

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_payment_method_chk"
  CHECK ("paymentMethod" IN ('vnpay', 'recovery_credit')) NOT VALID;

ALTER TABLE "Booking"
  VALIDATE CONSTRAINT "Booking_payment_method_chk";
