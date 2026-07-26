-- Sprint 2.5–5: auditable SmartQueue operations, live predictions and
-- constrained Autopilot simulations. All additions are backwards compatible
-- with the Sprint 1–2 customer flow.

ALTER TYPE "SmartQueueStatus" ADD VALUE IF NOT EXISTS 'NO_SHOW';
ALTER TYPE "LiveTripEventType" ADD VALUE IF NOT EXISTS 'QUEUE_CALLED';
ALTER TYPE "LiveTripEventType" ADD VALUE IF NOT EXISTS 'QUEUE_NO_SHOW';
ALTER TYPE "LiveTripEventType" ADD VALUE IF NOT EXISTS 'QUEUE_PAUSED';
ALTER TYPE "LiveTripEventType" ADD VALUE IF NOT EXISTS 'QUEUE_RESUMED';

CREATE TYPE "SmartQueueMode" AS ENUM ('AUTO', 'STAFF_CONTROLLED');

ALTER TABLE "SmartQueueEntry"
  ADD COLUMN "readyExpiresAt" TIMESTAMP(3),
  ADD COLUMN "calledAt" TIMESTAMP(3),
  ADD COLUMN "noShowAt" TIMESTAMP(3),
  ADD COLUMN "calledById" TEXT;

CREATE TABLE "SmartQueuePolicy" (
  "id" TEXT NOT NULL,
  "attractionId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "mode" "SmartQueueMode" NOT NULL DEFAULT 'AUTO',
  "openBeforeMinutes" INTEGER NOT NULL DEFAULT 120,
  "readyGraceMinutes" INTEGER NOT NULL DEFAULT 10,
  "maxReadyParties" INTEGER NOT NULL DEFAULT 3,
  "fallbackThroughput15m" INTEGER NOT NULL DEFAULT 8,
  "snapshotIntervalMinutes" INTEGER NOT NULL DEFAULT 15,
  "pausedAt" TIMESTAMP(3),
  "pausedById" TEXT,
  "pauseReason" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SmartQueuePolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ArrivalObservation" (
  "id" TEXT NOT NULL,
  "observationKey" TEXT NOT NULL,
  "attractionId" TEXT NOT NULL,
  "bucketStart" TIMESTAMP(3) NOT NULL,
  "bucketMinutes" INTEGER NOT NULL DEFAULT 15,
  "capacity" INTEGER NOT NULL DEFAULT 0,
  "bookedGuests" INTEGER NOT NULL DEFAULT 0,
  "heldGuests" INTEGER NOT NULL DEFAULT 0,
  "queueGuests" INTEGER NOT NULL DEFAULT 0,
  "checkinsLast15Minutes" INTEGER NOT NULL DEFAULT 0,
  "showRate" DOUBLE PRECISION NOT NULL DEFAULT 0.9,
  "pressureScore" INTEGER NOT NULL DEFAULT 0,
  "weatherCode" TEXT,
  "calendarFeatures" JSONB,
  "actualArrivalsNext15m" INTEGER,
  "dataSource" TEXT NOT NULL DEFAULT 'LIVE_OPERATIONAL',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "evaluatedAt" TIMESTAMP(3),
  CONSTRAINT "ArrivalObservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LivePrediction" (
  "id" TEXT NOT NULL,
  "attractionId" TEXT NOT NULL,
  "observationId" TEXT,
  "predictionType" TEXT NOT NULL,
  "horizonMinutes" INTEGER NOT NULL DEFAULT 15,
  "predictedP50" DOUBLE PRECISION NOT NULL,
  "predictedP90" DOUBLE PRECISION NOT NULL,
  "confidence" TEXT NOT NULL DEFAULT 'LOW',
  "modelVersion" TEXT NOT NULL,
  "trainingSource" TEXT NOT NULL DEFAULT 'unknown',
  "usedFallback" BOOLEAN NOT NULL DEFAULT false,
  "featureContributions" JSONB,
  "actualValue" DOUBLE PRECISION,
  "predictedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "evaluatedAt" TIMESTAMP(3),
  CONSTRAINT "LivePrediction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutopilotSimulation" (
  "id" TEXT NOT NULL,
  "liveTripId" TEXT NOT NULL,
  "algorithmVersion" TEXT NOT NULL,
  "baselineScore" DOUBLE PRECISION NOT NULL,
  "optimizedScore" DOUBLE PRECISION NOT NULL,
  "predictedMinutesSaved" INTEGER NOT NULL DEFAULT 0,
  "protectedBookingCount" INTEGER NOT NULL DEFAULT 0,
  "proposalCount" INTEGER NOT NULL DEFAULT 0,
  "constraints" JSONB NOT NULL,
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutopilotSimulation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SmartQueuePolicy_attractionId_key" ON "SmartQueuePolicy"("attractionId");
CREATE INDEX "SmartQueuePolicy_enabled_pausedAt_idx" ON "SmartQueuePolicy"("enabled", "pausedAt");
CREATE UNIQUE INDEX "ArrivalObservation_observationKey_key" ON "ArrivalObservation"("observationKey");
CREATE INDEX "ArrivalObservation_attractionId_bucketStart_idx" ON "ArrivalObservation"("attractionId", "bucketStart");
CREATE INDEX "ArrivalObservation_dataSource_actualArrivalsNext15m_idx" ON "ArrivalObservation"("dataSource", "actualArrivalsNext15m");
CREATE INDEX "LivePrediction_attractionId_predictionType_predictedAt_idx" ON "LivePrediction"("attractionId", "predictionType", "predictedAt");
CREATE INDEX "LivePrediction_modelVersion_predictedAt_idx" ON "LivePrediction"("modelVersion", "predictedAt");
CREATE INDEX "AutopilotSimulation_liveTripId_createdAt_idx" ON "AutopilotSimulation"("liveTripId", "createdAt");
CREATE INDEX "SmartQueueEntry_calledById_idx" ON "SmartQueueEntry"("calledById");

ALTER TABLE "SmartQueueEntry"
  ADD CONSTRAINT "SmartQueueEntry_calledById_fkey"
  FOREIGN KEY ("calledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SmartQueuePolicy"
  ADD CONSTRAINT "SmartQueuePolicy_attractionId_fkey"
  FOREIGN KEY ("attractionId") REFERENCES "Attraction"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "SmartQueuePolicy_pausedById_fkey"
  FOREIGN KEY ("pausedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "SmartQueuePolicy_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ArrivalObservation"
  ADD CONSTRAINT "ArrivalObservation_attractionId_fkey"
  FOREIGN KEY ("attractionId") REFERENCES "Attraction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LivePrediction"
  ADD CONSTRAINT "LivePrediction_attractionId_fkey"
  FOREIGN KEY ("attractionId") REFERENCES "Attraction"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LivePrediction_observationId_fkey"
  FOREIGN KEY ("observationId") REFERENCES "ArrivalObservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AutopilotSimulation"
  ADD CONSTRAINT "AutopilotSimulation_liveTripId_fkey"
  FOREIGN KEY ("liveTripId") REFERENCES "LiveTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
