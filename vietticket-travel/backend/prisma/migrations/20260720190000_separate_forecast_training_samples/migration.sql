-- Keep controlled forecast-training history out of operational booking and
-- finance screens while retaining it for the forecasting pipeline.
ALTER TABLE "Booking"
ADD COLUMN "isForecastTrainingSample" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Booking_isForecastTrainingSample_idx"
ON "Booking"("isForecastTrainingSample");
