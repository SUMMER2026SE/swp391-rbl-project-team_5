-- Normalize legal identifiers before enforcing one partner profile per tax code.
UPDATE "PartnerProfile"
SET "taxCode" = BTRIM("taxCode")
WHERE "taxCode" IS NOT NULL;

-- These two records are known demo companies that were accidentally created with
-- the same sample tax code. Do not rewrite arbitrary production identifiers.
UPDATE "PartnerProfile" p
SET "taxCode" = '0312345682'
FROM "User" u
WHERE p."userId" = u."id"
  AND u."email" = 'demo.partner.mekong@vietticket.com'
  AND p."taxCode" = '0312345679'
  AND NOT EXISTS (
    SELECT 1
    FROM "PartnerProfile" other
    WHERE other."taxCode" = '0312345682'
      AND other."id" <> p."id"
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "PartnerProfile"
    WHERE "taxCode" IS NULL
       OR "taxCode" !~ '^[0-9]{10}([0-9]{3})?$'
  ) THEN
    RAISE EXCEPTION 'PartnerProfile contains a missing or invalid taxCode';
  END IF;

  IF EXISTS (
    SELECT "taxCode"
    FROM "PartnerProfile"
    GROUP BY "taxCode"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'PartnerProfile contains duplicate taxCode values';
  END IF;
END $$;

ALTER TABLE "PartnerProfile"
  ALTER COLUMN "taxCode" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "PartnerProfile_taxCode_key"
  ON "PartnerProfile"("taxCode");

ALTER TABLE "PartnerProfile"
  DROP CONSTRAINT IF EXISTS "PartnerProfile_taxCode_format_chk";
ALTER TABLE "PartnerProfile"
  ADD CONSTRAINT "PartnerProfile_taxCode_format_chk"
  CHECK ("taxCode" ~ '^[0-9]{10}([0-9]{3})?$') NOT VALID;
ALTER TABLE "PartnerProfile"
  VALIDATE CONSTRAINT "PartnerProfile_taxCode_format_chk";

-- A captured legacy VNPay booking can be normalized safely from its payment ledger.
UPDATE "Booking" b
SET "paymentMethod" = 'vnpay'
WHERE b."paymentMethod" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "Payment" p
    WHERE p."bookingId" = b."id"
      AND p."status" = 'SUCCESS'
      AND p."isDuplicate" = false
      AND LOWER(p."paymentGateway") = 'vnpay'
  );

-- Remaining null-method bookings are legacy demo rows without a captured payment.
-- Delete the owning reservation so all dependent booking records are removed by FK cascade.
DELETE FROM "Reservation" r
USING "Booking" b
WHERE b."reservationId" = r."id"
  AND b."paymentMethod" IS NULL;

-- Rebuild stock counters from the surviving reservation ledger. This prevents deleted
-- demo rows from leaving phantom booked quantities behind.
UPDATE "DailyStock"
SET "heldQuantity" = 0, "bookedQuantity" = 0;

WITH stock AS (
  SELECT
    r."ticketProductId",
    r."date",
    COALESCE(SUM(r."quantity") FILTER (WHERE r."status" = 'HELD'), 0)::INTEGER AS held,
    COALESCE(SUM(r."quantity") FILTER (WHERE r."status" = 'CONFIRMED'), 0)::INTEGER AS booked
  FROM "Reservation" r
  GROUP BY r."ticketProductId", r."date"
)
UPDATE "DailyStock" ds
SET "heldQuantity" = stock.held,
    "bookedQuantity" = stock.booked
FROM stock
WHERE ds."ticketProductId" = stock."ticketProductId"
  AND ds."date" = stock."date";

UPDATE "AttractionDailyStock"
SET "heldQty" = 0, "bookedQty" = 0;

WITH stock AS (
  SELECT
    tp."attractionId",
    r."date",
    COALESCE(SUM(r."quantity") FILTER (WHERE r."status" = 'HELD'), 0)::INTEGER AS held,
    COALESCE(SUM(r."quantity") FILTER (WHERE r."status" = 'CONFIRMED'), 0)::INTEGER AS booked
  FROM "Reservation" r
  JOIN "TicketProduct" tp ON tp."id" = r."ticketProductId"
  GROUP BY tp."attractionId", r."date"
)
UPDATE "AttractionDailyStock" ads
SET "heldQty" = stock.held,
    "bookedQty" = stock.booked
FROM stock
WHERE ads."attractionId" = stock."attractionId"
  AND ads."date" = stock."date";

UPDATE "TimeSlotStock"
SET "heldQty" = 0, "bookedQty" = 0;

WITH stock AS (
  SELECT
    r."timeSlotId",
    r."date",
    COALESCE(SUM(r."quantity") FILTER (WHERE r."status" = 'HELD'), 0)::INTEGER AS held,
    COALESCE(SUM(r."quantity") FILTER (WHERE r."status" = 'CONFIRMED'), 0)::INTEGER AS booked
  FROM "Reservation" r
  WHERE r."timeSlotId" IS NOT NULL
  GROUP BY r."timeSlotId", r."date"
)
UPDATE "TimeSlotStock" tss
SET "heldQty" = stock.held,
    "bookedQty" = stock.booked
FROM stock
WHERE tss."timeSlotId" = stock."timeSlotId"
  AND tss."date" = stock."date";

UPDATE "Booking"
SET "paymentMethod" = LOWER(BTRIM("paymentMethod"))
WHERE "paymentMethod" IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Booking"
    WHERE "paymentMethod" IS NULL OR "paymentMethod" <> 'vnpay'
  ) THEN
    RAISE EXCEPTION 'Booking contains an unsupported paymentMethod';
  END IF;
END $$;

ALTER TABLE "Booking"
  ALTER COLUMN "paymentMethod" SET DEFAULT 'vnpay',
  ALTER COLUMN "paymentMethod" SET NOT NULL;

ALTER TABLE "Booking"
  DROP CONSTRAINT IF EXISTS "Booking_payment_method_chk";
ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_payment_method_chk"
  CHECK ("paymentMethod" = 'vnpay') NOT VALID;
ALTER TABLE "Booking"
  VALIDATE CONSTRAINT "Booking_payment_method_chk";
