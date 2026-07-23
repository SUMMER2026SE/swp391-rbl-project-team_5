-- Close the remaining operational gap with real virtual-queue products:
-- enrolment capacity must be finite and controlled by the attraction owner.
ALTER TABLE "SmartQueuePolicy"
  ADD COLUMN "maxActiveParties" INTEGER NOT NULL DEFAULT 100;
