ALTER TABLE "RevenueForecast"
ADD COLUMN "trainingSource" TEXT NOT NULL DEFAULT 'unknown';

UPDATE "RevenueForecast"
SET "trainingSource" = CASE
  WHEN "usedFallback" = TRUE THEN 'historical_baseline'
  WHEN "modelVersion" LIKE 'demo-%' THEN 'demo_booking_history'
  ELSE 'real_booking_history'
END;
