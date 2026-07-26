-- A paid booking represents one travel party for one attraction/date.
-- Enforcing this at the database layer prevents duplicate virtual-queue
-- enrolments through two different saved itineraries or concurrent requests.
DROP INDEX IF EXISTS "SmartQueueEntry_bookingId_status_idx";
CREATE UNIQUE INDEX "SmartQueueEntry_bookingId_key"
  ON "SmartQueueEntry"("bookingId");
