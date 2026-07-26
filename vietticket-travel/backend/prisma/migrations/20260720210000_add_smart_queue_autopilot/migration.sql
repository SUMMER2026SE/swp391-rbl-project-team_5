-- Sprint 2: SmartQueue, customer-confirmed Autopilot proposals and durable live-trip events.
CREATE TYPE "LiveTripProposalType" AS ENUM ('TIME_SHIFT');

CREATE TYPE "LiveTripProposalStatus" AS ENUM (
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
  'SUPERSEDED'
);

CREATE TYPE "SmartQueueStatus" AS ENUM (
  'WAITING',
  'READY',
  'ADMITTED',
  'CANCELLED',
  'EXPIRED'
);

CREATE TYPE "LiveTripEventType" AS ENUM (
  'QUEUE_JOINED',
  'QUEUE_READY',
  'QUEUE_ADMITTED',
  'QUEUE_CANCELLED',
  'QUEUE_EXPIRED',
  'AUTOPILOT_PROPOSED',
  'AUTOPILOT_ACCEPTED',
  'AUTOPILOT_REJECTED',
  'AUTOPILOT_EXPIRED',
  'ITEM_AT_RISK',
  'ITEM_RECOVERED',
  'ITEM_COMPLETED'
);

CREATE TYPE "LiveTripEventSeverity" AS ENUM (
  'INFO',
  'SUCCESS',
  'WARNING',
  'CRITICAL'
);

CREATE TABLE "LiveTripProposal" (
  "id" TEXT NOT NULL,
  "liveTripId" TEXT NOT NULL,
  "liveTripItemId" TEXT NOT NULL,
  "activeKey" TEXT,
  "type" "LiveTripProposalType" NOT NULL,
  "status" "LiveTripProposalStatus" NOT NULL DEFAULT 'PENDING',
  "reasonCode" TEXT NOT NULL,
  "rationale" TEXT NOT NULL,
  "originalStart" TIMESTAMP(3) NOT NULL,
  "originalEnd" TIMESTAMP(3),
  "proposedStart" TIMESTAMP(3) NOT NULL,
  "proposedEnd" TIMESTAMP(3),
  "snapshot" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LiveTripProposal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LiveTripProposal_original_window_check"
    CHECK ("originalEnd" IS NULL OR "originalEnd" > "originalStart"),
  CONSTRAINT "LiveTripProposal_proposed_window_check"
    CHECK ("proposedEnd" IS NULL OR "proposedEnd" > "proposedStart")
);

CREATE TABLE "SmartQueueEntry" (
  "id" TEXT NOT NULL,
  "liveTripId" TEXT NOT NULL,
  "liveTripItemId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "attractionId" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "visitDate" DATE NOT NULL,
  "partySize" INTEGER NOT NULL,
  "status" "SmartQueueStatus" NOT NULL DEFAULT 'WAITING',
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readyAt" TIMESTAMP(3),
  "admittedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SmartQueueEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SmartQueueEntry_partySize_check" CHECK ("partySize" > 0),
  CONSTRAINT "SmartQueueEntry_window_check" CHECK ("expiresAt" > "joinedAt")
);

CREATE TABLE "LiveTripEvent" (
  "id" TEXT NOT NULL,
  "liveTripId" TEXT NOT NULL,
  "liveTripItemId" TEXT,
  "userId" TEXT NOT NULL,
  "type" "LiveTripEventType" NOT NULL,
  "severity" "LiveTripEventSeverity" NOT NULL DEFAULT 'INFO',
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "data" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LiveTripEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LiveTripProposal_activeKey_key" ON "LiveTripProposal"("activeKey");
CREATE INDEX "LiveTripProposal_liveTripId_status_createdAt_idx" ON "LiveTripProposal"("liveTripId", "status", "createdAt");
CREATE INDEX "LiveTripProposal_liveTripItemId_status_idx" ON "LiveTripProposal"("liveTripItemId", "status");
CREATE INDEX "LiveTripProposal_expiresAt_status_idx" ON "LiveTripProposal"("expiresAt", "status");

CREATE UNIQUE INDEX "SmartQueueEntry_liveTripItemId_key" ON "SmartQueueEntry"("liveTripItemId");
CREATE INDEX "SmartQueueEntry_attractionId_visitDate_status_joinedAt_idx" ON "SmartQueueEntry"("attractionId", "visitDate", "status", "joinedAt");
CREATE INDEX "SmartQueueEntry_userId_status_updatedAt_idx" ON "SmartQueueEntry"("userId", "status", "updatedAt");
CREATE INDEX "SmartQueueEntry_bookingId_status_idx" ON "SmartQueueEntry"("bookingId", "status");
CREATE INDEX "SmartQueueEntry_expiresAt_status_idx" ON "SmartQueueEntry"("expiresAt", "status");

CREATE INDEX "LiveTripEvent_liveTripId_createdAt_idx" ON "LiveTripEvent"("liveTripId", "createdAt");
CREATE INDEX "LiveTripEvent_userId_createdAt_idx" ON "LiveTripEvent"("userId", "createdAt");
CREATE INDEX "LiveTripEvent_liveTripItemId_createdAt_idx" ON "LiveTripEvent"("liveTripItemId", "createdAt");

ALTER TABLE "LiveTripProposal"
  ADD CONSTRAINT "LiveTripProposal_liveTripId_fkey"
  FOREIGN KEY ("liveTripId") REFERENCES "LiveTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveTripProposal"
  ADD CONSTRAINT "LiveTripProposal_liveTripItemId_fkey"
  FOREIGN KEY ("liveTripItemId") REFERENCES "LiveTripItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SmartQueueEntry"
  ADD CONSTRAINT "SmartQueueEntry_liveTripId_fkey"
  FOREIGN KEY ("liveTripId") REFERENCES "LiveTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SmartQueueEntry"
  ADD CONSTRAINT "SmartQueueEntry_liveTripItemId_fkey"
  FOREIGN KEY ("liveTripItemId") REFERENCES "LiveTripItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SmartQueueEntry"
  ADD CONSTRAINT "SmartQueueEntry_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SmartQueueEntry"
  ADD CONSTRAINT "SmartQueueEntry_attractionId_fkey"
  FOREIGN KEY ("attractionId") REFERENCES "Attraction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SmartQueueEntry"
  ADD CONSTRAINT "SmartQueueEntry_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveTripEvent"
  ADD CONSTRAINT "LiveTripEvent_liveTripId_fkey"
  FOREIGN KEY ("liveTripId") REFERENCES "LiveTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveTripEvent"
  ADD CONSTRAINT "LiveTripEvent_liveTripItemId_fkey"
  FOREIGN KEY ("liveTripItemId") REFERENCES "LiveTripItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LiveTripEvent"
  ADD CONSTRAINT "LiveTripEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
