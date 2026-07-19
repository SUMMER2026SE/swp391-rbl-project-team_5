-- CreateEnum
CREATE TYPE "AttractionTier" AS ENUM ('BUDGET', 'STANDARD', 'PREMIUM', 'LUXURY');

-- AlterTable
ALTER TABLE "Attraction" ADD COLUMN "tier" "AttractionTier" NOT NULL DEFAULT 'STANDARD';

-- CreateTable
CREATE TABLE "RevenueForecast" (
    "id" TEXT NOT NULL,
    "attractionId" TEXT NOT NULL,
    "forecastDate" DATE NOT NULL,
    "predictedRevenue" DECIMAL(14,2) NOT NULL,
    "predictedBookings" INTEGER NOT NULL DEFAULT 0,
    "confidenceLower" DECIMAL(14,2),
    "confidenceUpper" DECIMAL(14,2),
    "actualRevenue" DECIMAL(14,2),
    "modelVersion" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RevenueForecast_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RevenueForecast_attractionId_idx" ON "RevenueForecast"("attractionId");

-- CreateIndex
CREATE INDEX "RevenueForecast_forecastDate_idx" ON "RevenueForecast"("forecastDate");

-- CreateIndex
CREATE UNIQUE INDEX "RevenueForecast_attractionId_forecastDate_modelVersion_key" ON "RevenueForecast"("attractionId", "forecastDate", "modelVersion");

-- AddForeignKey
ALTER TABLE "RevenueForecast" ADD CONSTRAINT "RevenueForecast_attractionId_fkey" FOREIGN KEY ("attractionId") REFERENCES "Attraction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
