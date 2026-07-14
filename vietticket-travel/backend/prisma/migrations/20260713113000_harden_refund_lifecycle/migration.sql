-- Make refund requests idempotent per business event while allowing separate
-- duplicate-payment refunds for the same booking.
DO $$ BEGIN
    CREATE TYPE "RefundRequestType" AS ENUM (
        'CUSTOMER_CANCELLATION',
        'PARTNER_CANCELLATION',
        'SYSTEM_CANCELLATION',
        'DUPLICATE_PAYMENT'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "RefundRequest"
    ADD COLUMN IF NOT EXISTS "requestKey" TEXT,
    ADD COLUMN IF NOT EXISTS "type" "RefundRequestType" NOT NULL DEFAULT 'CUSTOMER_CANCELLATION',
    ADD COLUMN IF NOT EXISTS "mandatory" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "originalAmount" DECIMAL(12,2),
    ADD COLUMN IF NOT EXISTS "feeAmount" DECIMAL(12,2) NOT NULL DEFAULT 0.0,
    ADD COLUMN IF NOT EXISTS "policySnapshot" "RefundPolicyType",
    ADD COLUMN IF NOT EXISTS "feeRateSnapshot" DECIMAL(5,2),
    ADD COLUMN IF NOT EXISTS "bookingStatusBeforeRequest" "BookingStatus";

UPDATE "RefundRequest" rr
SET
    "requestKey" = COALESCE(rr."requestKey", 'legacy:' || rr."id"),
    "originalAmount" = COALESCE(
        rr."originalAmount",
        GREATEST(rr."amount", b."totalAmount")
    ),
    "feeAmount" = GREATEST(
        0,
        COALESCE(rr."originalAmount", GREATEST(rr."amount", b."totalAmount")) - rr."amount"
    ),
    "policySnapshot" = COALESCE(rr."policySnapshot", b."snapshotRefundPolicy"),
    "feeRateSnapshot" = COALESCE(rr."feeRateSnapshot", b."snapshotRefundFeeRate"),
    "bookingStatusBeforeRequest" = COALESCE(
        rr."bookingStatusBeforeRequest",
        CASE
            WHEN b."status" IN ('REFUND_REQUESTED', 'REFUNDED') THEN 'CONFIRMED'::"BookingStatus"
            ELSE b."status"
        END
    )
FROM "Booking" b
WHERE b."id" = rr."bookingId";

ALTER TABLE "RefundRequest"
    ALTER COLUMN "requestKey" SET NOT NULL,
    ALTER COLUMN "originalAmount" SET NOT NULL;

DROP INDEX IF EXISTS "RefundRequest_bookingId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "RefundRequest_requestKey_key"
    ON "RefundRequest"("requestKey");
CREATE INDEX IF NOT EXISTS "RefundRequest_bookingId_idx"
    ON "RefundRequest"("bookingId");
CREATE INDEX IF NOT EXISTS "RefundRequest_type_status_idx"
    ON "RefundRequest"("type", "status");

ALTER TABLE "RefundTransaction"
    ADD COLUMN IF NOT EXISTS "gatewayResponseCode" TEXT,
    ADD COLUMN IF NOT EXISTS "gatewayTransactionStatus" TEXT,
    ADD COLUMN IF NOT EXISTS "gatewayTransactionId" TEXT,
    ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "reconciledAt" TIMESTAMP(3);

-- Cancellation conditions are part of the purchased product and must be
-- snapshotted on the booking so partners cannot change old orders retroactively.
ALTER TABLE "TicketProduct"
    ADD COLUMN IF NOT EXISTS "refundCutoffHours" INTEGER NOT NULL DEFAULT 24;
ALTER TABLE "Booking"
    ADD COLUMN IF NOT EXISTS "snapshotRefundCutoffHours" INTEGER NOT NULL DEFAULT 24;

UPDATE "Booking" b
SET "snapshotRefundCutoffHours" = tp."refundCutoffHours"
FROM "Reservation" r
JOIN "TicketProduct" tp ON tp."id" = r."ticketProductId"
WHERE b."reservationId" = r."id";

-- Older records used 0 as an implicit 50% cancellation fee. Persist the
-- effective rate explicitly so UI, snapshots and refund calculations agree.
UPDATE "TicketProduct"
SET "refundFeeRate" = 0.50
WHERE "refundPolicy" = 'REFUND_WITH_FEE'
  AND ("refundFeeRate" <= 0 OR "refundFeeRate" >= 1);
UPDATE "TicketProduct"
SET "refundFeeRate" = 0
WHERE "refundPolicy" <> 'REFUND_WITH_FEE'
  AND "refundFeeRate" <> 0;
UPDATE "Booking"
SET "snapshotRefundFeeRate" = 0.50
WHERE "snapshotRefundPolicy" = 'REFUND_WITH_FEE'
  AND ("snapshotRefundFeeRate" <= 0 OR "snapshotRefundFeeRate" >= 1);
UPDATE "Booking"
SET "snapshotRefundFeeRate" = 0
WHERE "snapshotRefundPolicy" <> 'REFUND_WITH_FEE'
  AND "snapshotRefundFeeRate" <> 0;

ALTER TABLE "RefundRequest"
    DROP CONSTRAINT IF EXISTS "RefundRequest_amount_non_negative_chk";
ALTER TABLE "RefundTransaction"
    DROP CONSTRAINT IF EXISTS "RefundTransaction_amount_non_negative_chk";

ALTER TABLE "RefundRequest"
    ADD CONSTRAINT "RefundRequest_financial_amounts_chk"
    CHECK (
        "originalAmount" > 0
        AND "amount" > 0
        AND "feeAmount" >= 0
        AND "amount" + "feeAmount" <= "originalAmount"
        AND ("feeRateSnapshot" IS NULL OR ("feeRateSnapshot" >= 0 AND "feeRateSnapshot" <= 1))
    ) NOT VALID;
ALTER TABLE "RefundTransaction"
    ADD CONSTRAINT "RefundTransaction_amount_positive_chk"
    CHECK ("amount" > 0) NOT VALID;
ALTER TABLE "TicketProduct"
    ADD CONSTRAINT "TicketProduct_refund_cutoff_hours_chk"
    CHECK ("refundCutoffHours" >= 0 AND "refundCutoffHours" <= 720) NOT VALID;
ALTER TABLE "Booking"
    ADD CONSTRAINT "Booking_refund_cutoff_hours_chk"
    CHECK ("snapshotRefundCutoffHours" >= 0 AND "snapshotRefundCutoffHours" <= 720) NOT VALID;

ALTER TABLE "RefundRequest"
    ADD CONSTRAINT "RefundRequest_mandatory_type_chk"
    CHECK (
        "type" = 'CUSTOMER_CANCELLATION'
        OR "mandatory" = true
    ) NOT VALID;
ALTER TABLE "TicketProduct"
    ADD CONSTRAINT "TicketProduct_refund_fee_policy_chk"
    CHECK (
        ("refundPolicy" = 'REFUND_WITH_FEE' AND "refundFeeRate" > 0 AND "refundFeeRate" < 1)
        OR ("refundPolicy" <> 'REFUND_WITH_FEE' AND "refundFeeRate" = 0)
    ) NOT VALID;
ALTER TABLE "Booking"
    ADD CONSTRAINT "Booking_refund_fee_policy_chk"
    CHECK (
        ("snapshotRefundPolicy" = 'REFUND_WITH_FEE' AND "snapshotRefundFeeRate" > 0 AND "snapshotRefundFeeRate" < 1)
        OR ("snapshotRefundPolicy" <> 'REFUND_WITH_FEE' AND "snapshotRefundFeeRate" = 0)
    ) NOT VALID;

ALTER TABLE "RefundRequest" VALIDATE CONSTRAINT "RefundRequest_financial_amounts_chk";
ALTER TABLE "RefundRequest" VALIDATE CONSTRAINT "RefundRequest_mandatory_type_chk";
ALTER TABLE "RefundTransaction" VALIDATE CONSTRAINT "RefundTransaction_amount_positive_chk";
ALTER TABLE "TicketProduct" VALIDATE CONSTRAINT "TicketProduct_refund_cutoff_hours_chk";
ALTER TABLE "TicketProduct" VALIDATE CONSTRAINT "TicketProduct_refund_fee_policy_chk";
ALTER TABLE "Booking" VALIDATE CONSTRAINT "Booking_refund_cutoff_hours_chk";
ALTER TABLE "Booking" VALIDATE CONSTRAINT "Booking_refund_fee_policy_chk";
