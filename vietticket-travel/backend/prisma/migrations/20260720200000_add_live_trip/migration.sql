-- Sprint 1: materialized live-trip plan for indexed operational queries.
CREATE TYPE "LiveTripStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

CREATE TYPE "LiveTripItemStatus" AS ENUM (
  'PLANNED',
  'AT_RISK',
  'REVISION_PROPOSED',
  'UPDATED',
  'COMPLETED',
  'SKIPPED'
);

CREATE TABLE "LiveTrip" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "savedItineraryId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "startDate" DATE NOT NULL,
  "endDate" DATE NOT NULL,
  "status" "LiveTripStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LiveTrip_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LiveTripItem" (
  "id" TEXT NOT NULL,
  "liveTripId" TEXT NOT NULL,
  "attractionId" TEXT,
  "bookingId" TEXT,
  "dayIndex" INTEGER NOT NULL,
  "orderIndex" INTEGER NOT NULL,
  "scheduledStart" TIMESTAMP(3) NOT NULL,
  "scheduledEnd" TIMESTAMP(3),
  "status" "LiveTripItemStatus" NOT NULL DEFAULT 'PLANNED',
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LiveTripItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LiveTrip_savedItineraryId_key" ON "LiveTrip"("savedItineraryId");
CREATE INDEX "LiveTrip_userId_status_idx" ON "LiveTrip"("userId", "status");
CREATE INDEX "LiveTrip_startDate_endDate_status_idx" ON "LiveTrip"("startDate", "endDate", "status");
CREATE INDEX "LiveTripItem_liveTripId_dayIndex_orderIndex_idx" ON "LiveTripItem"("liveTripId", "dayIndex", "orderIndex");
CREATE INDEX "LiveTripItem_attractionId_scheduledStart_idx" ON "LiveTripItem"("attractionId", "scheduledStart");
CREATE INDEX "LiveTripItem_bookingId_idx" ON "LiveTripItem"("bookingId");

ALTER TABLE "LiveTrip"
  ADD CONSTRAINT "LiveTrip_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveTrip"
  ADD CONSTRAINT "LiveTrip_savedItineraryId_fkey"
  FOREIGN KEY ("savedItineraryId") REFERENCES "SavedItinerary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveTripItem"
  ADD CONSTRAINT "LiveTripItem_liveTripId_fkey"
  FOREIGN KEY ("liveTripId") REFERENCES "LiveTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveTripItem"
  ADD CONSTRAINT "LiveTripItem_attractionId_fkey"
  FOREIGN KEY ("attractionId") REFERENCES "Attraction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LiveTripItem"
  ADD CONSTRAINT "LiveTripItem_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
