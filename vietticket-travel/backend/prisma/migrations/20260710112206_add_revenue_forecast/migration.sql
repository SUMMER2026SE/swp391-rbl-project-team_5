-- CreateEnum
CREATE TYPE "AttractionTier" AS ENUM ('BASIC', 'STANDARD', 'PREMIUM');

-- CreateEnum
CREATE TYPE "ForecastModelVersion" AS ENUM ('V1');

-- AlterTable
ALTER TABLE "Attraction" ADD COLUMN     "tier" "AttractionTier" NOT NULL DEFAULT 'STANDARD';

-- CreateTable
CREATE TABLE "RevenueForecast" (
    "id" TEXT NOT NULL,
    "attractionId" TEXT NOT NULL,
    "forecastDate" DATE NOT NULL,
    "predictedRevenue" DECIMAL(14,2) NOT NULL,
    "rfPrediction" DECIMAL(14,2) NOT NULL,
    "xgbPrediction" DECIMAL(14,2) NOT NULL,
    "confidenceLow" DECIMAL(14,2) NOT NULL,
    "confidenceHigh" DECIMAL(14,2) NOT NULL,
    "predictedBookings" INTEGER,
    "modelVersion" TEXT NOT NULL,
    "usedFallback" BOOLEAN NOT NULL DEFAULT false,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevenueForecast_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RevenueForecast_attractionId_idx" ON "RevenueForecast"("attractionId");

-- CreateIndex
CREATE INDEX "RevenueForecast_forecastDate_idx" ON "RevenueForecast"("forecastDate");

-- CreateIndex
CREATE UNIQUE INDEX "RevenueForecast_attractionId_forecastDate_key" ON "RevenueForecast"("attractionId", "forecastDate");

-- AddForeignKey
ALTER TABLE "RevenueForecast" ADD CONSTRAINT "RevenueForecast_attractionId_fkey" FOREIGN KEY ("attractionId") REFERENCES "Attraction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
