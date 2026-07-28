-- Capture the payout owner at checkout so historical financial attribution
-- cannot drift when an attraction is reassigned to another partner.
ALTER TABLE "Booking"
  ADD COLUMN "snapshotPartnerId" TEXT,
  ADD COLUMN "snapshotPartnerName" TEXT;

-- Best-effort backfill for legacy bookings. New bookings are populated by the
-- checkout/recovery write paths; this keeps existing rows on the same
-- immutable-at-deploy policy instead of leaving them dependent on a future
-- attraction reassignment.
UPDATE "Booking" AS b
SET
  "snapshotPartnerId" = a."partnerId",
  "snapshotPartnerName" = p."businessName"
FROM "Reservation" AS r
JOIN "TicketProduct" AS tp ON tp."id" = r."ticketProductId"
JOIN "Attraction" AS a ON a."id" = tp."attractionId"
LEFT JOIN "PartnerProfile" AS p ON p."id" = a."partnerId"
WHERE b."reservationId" = r."id"
  AND b."snapshotPartnerId" IS NULL;
