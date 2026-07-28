-- SmartQueue controls a real customer return flow at the attraction gate.
-- A missing policy must never opt a partner into an operational promise.
ALTER TABLE "SmartQueuePolicy"
  ALTER COLUMN "enabled" SET DEFAULT false;
