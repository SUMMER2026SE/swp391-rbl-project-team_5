-- Persist model quality and drift diagnostics alongside every prediction so
-- operations can audit why a result was trusted or downgraded.
ALTER TABLE "LivePrediction"
  ADD COLUMN "qualityMetrics" JSONB;
