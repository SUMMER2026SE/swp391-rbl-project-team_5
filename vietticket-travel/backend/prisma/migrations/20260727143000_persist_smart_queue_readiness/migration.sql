-- Existing enabled policies were created before SmartQueue became an explicit
-- operational opt-in. They remain stored for audit, but are intentionally
-- ineffective until the partner confirms the gate flow again.
ALTER TABLE "SmartQueuePolicy"
  ADD COLUMN "operationalReadinessConfirmedAt" TIMESTAMP(3);
