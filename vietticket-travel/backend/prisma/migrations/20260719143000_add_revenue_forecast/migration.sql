-- Revenue forecasts are keyed by attraction and service date. Keeping one
-- current prediction per date prevents dashboard totals from double-counting
-- old model versions after a retrain.
CREATE TABLE "RevenueForecast" (
    "id" TEXT NOT NULL,
    "attractionId" TEXT NOT NULL,
    "forecastDate" DATE NOT NULL,
    "predictedRevenue" DECIMAL(14,2) NOT NULL,
    "predictedTickets" INTEGER NOT NULL DEFAULT 0,
    "confidenceLower" DECIMAL(14,2),
    "confidenceUpper" DECIMAL(14,2),
    "actualRevenue" DECIMAL(14,2),
    "modelVersion" TEXT NOT NULL,
    "usedFallback" BOOLEAN NOT NULL DEFAULT false,
    "historyDays" INTEGER NOT NULL DEFAULT 0,
    "observedDays" INTEGER NOT NULL DEFAULT 0,
    "sampleBookings" INTEGER NOT NULL DEFAULT 0,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RevenueForecast_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RevenueForecast_attractionId_forecastDate_key"
ON "RevenueForecast"("attractionId", "forecastDate");

CREATE INDEX "RevenueForecast_attractionId_idx"
ON "RevenueForecast"("attractionId");

CREATE INDEX "RevenueForecast_forecastDate_idx"
ON "RevenueForecast"("forecastDate");

CREATE INDEX "RevenueForecast_generatedAt_idx"
ON "RevenueForecast"("generatedAt");

ALTER TABLE "RevenueForecast"
ADD CONSTRAINT "RevenueForecast_attractionId_fkey"
FOREIGN KEY ("attractionId") REFERENCES "Attraction"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
