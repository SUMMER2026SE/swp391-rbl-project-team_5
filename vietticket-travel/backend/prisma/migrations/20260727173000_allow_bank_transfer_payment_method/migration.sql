-- Bank transfer is a customer-selectable payment method. Keep the database
-- invariant aligned with the API allow-list and retain the audited internal
-- recovery-credit method used by Rescue.
ALTER TABLE "Booking"
  DROP CONSTRAINT IF EXISTS "Booking_payment_method_chk";

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_payment_method_chk"
  CHECK ("paymentMethod" IN ('vnpay', 'bank_transfer', 'recovery_credit')) NOT VALID;

ALTER TABLE "Booking"
  VALIDATE CONSTRAINT "Booking_payment_method_chk";
