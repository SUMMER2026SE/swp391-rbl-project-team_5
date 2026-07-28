ALTER TABLE "Booking"
  ADD COLUMN "itineraryId" TEXT,
  ADD COLUMN "itineraryVersion" INTEGER,
  ADD COLUMN "itineraryItemId" TEXT;

ALTER TABLE "PartyRoom"
  ADD COLUMN "bookingStartedAt" TIMESTAMP(3),
  ADD COLUMN "bookingVersion" INTEGER;

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_itineraryId_fkey"
  FOREIGN KEY ("itineraryId") REFERENCES "SavedItinerary"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Booking_itineraryId_itineraryVersion_idx"
  ON "Booking"("itineraryId", "itineraryVersion");

CREATE INDEX "Booking_itineraryItemId_idx"
  ON "Booking"("itineraryItemId");
