-- Party-count capacity alone can overload the gate when several large group
-- bookings become READY together. Enforce a second limit in guest units.
ALTER TABLE "SmartQueuePolicy"
  ADD COLUMN "maxReadyGuests" INTEGER NOT NULL DEFAULT 20;
