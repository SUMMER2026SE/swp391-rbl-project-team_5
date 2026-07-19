/*
  Warnings:

  - The values [BASIC] on the enum `AttractionTier` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `confidenceHigh` on the `RevenueForecast` table. All the data in the column will be lost.
  - You are about to drop the column `confidenceLow` on the `RevenueForecast` table. All the data in the column will be lost.
  - You are about to drop the column `rfPrediction` on the `RevenueForecast` table. All the data in the column will be lost.
  - You are about to drop the column `usedFallback` on the `RevenueForecast` table. All the data in the column will be lost.
  - You are about to drop the column `xgbPrediction` on the `RevenueForecast` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[attractionId,forecastDate,modelVersion]` on the table `RevenueForecast` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `updatedAt` to the `RevenueForecast` table without a default value. This is not possible if the table is not empty.
  - Made the column `predictedBookings` on table `RevenueForecast` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "AttractionTier_new" AS ENUM ('BUDGET', 'STANDARD', 'PREMIUM', 'LUXURY');
ALTER TABLE "public"."Attraction" ALTER COLUMN "tier" DROP DEFAULT;
ALTER TABLE "Attraction" ALTER COLUMN "tier" TYPE "AttractionTier_new" USING ("tier"::text::"AttractionTier_new");
ALTER TYPE "AttractionTier" RENAME TO "AttractionTier_old";
ALTER TYPE "AttractionTier_new" RENAME TO "AttractionTier";
DROP TYPE "public"."AttractionTier_old";
ALTER TABLE "Attraction" ALTER COLUMN "tier" SET DEFAULT 'STANDARD';
COMMIT;

-- DropIndex
DROP INDEX "RevenueForecast_attractionId_forecastDate_key";

-- AlterTable
ALTER TABLE "RevenueForecast" DROP COLUMN "confidenceHigh",
DROP COLUMN "confidenceLow",
DROP COLUMN "rfPrediction",
DROP COLUMN "usedFallback",
DROP COLUMN "xgbPrediction",
ADD COLUMN     "actualRevenue" DECIMAL(14,2),
ADD COLUMN     "confidenceLower" DECIMAL(14,2),
ADD COLUMN     "confidenceUpper" DECIMAL(14,2),
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "predictedBookings" SET NOT NULL,
ALTER COLUMN "predictedBookings" SET DEFAULT 0;

-- DropEnum
DROP TYPE "ForecastModelVersion";

-- CreateIndex
CREATE UNIQUE INDEX "RevenueForecast_attractionId_forecastDate_modelVersion_key" ON "RevenueForecast"("attractionId", "forecastDate", "modelVersion");
