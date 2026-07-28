ALTER TABLE "Reservation"
ADD COLUMN "snapshotTicketRestrictions" JSONB;

ALTER TABLE "Booking"
ADD COLUMN "snapshotTicketRestrictions" JSONB;
