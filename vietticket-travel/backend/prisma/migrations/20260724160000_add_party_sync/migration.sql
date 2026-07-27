CREATE TYPE "PartyRoomStatus" AS ENUM ('OPEN', 'FINALIZED', 'CLOSED', 'EXPIRED');
CREATE TYPE "PartyMemberRole" AS ENUM ('HOST', 'GUEST');
CREATE TYPE "PartyVoteValue" AS ENUM ('LIKE', 'LOVE', 'VETO');

CREATE TABLE "PartyRoom" (
    "id" TEXT NOT NULL,
    "hostUserId" TEXT NOT NULL,
    "savedItineraryId" TEXT,
    "title" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "dayCount" INTEGER NOT NULL,
    "adults" INTEGER NOT NULL,
    "children" INTEGER NOT NULL,
    "totalBudget" DECIMAL(14,2) NOT NULL,
    "pace" TEXT NOT NULL DEFAULT 'normal',
    "maxMembers" INTEGER NOT NULL DEFAULT 10,
    "inviteTokenHash" VARCHAR(64) NOT NULL,
    "inviteExpiresAt" TIMESTAMP(3) NOT NULL,
    "status" "PartyRoomStatus" NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 1,
    "finalizedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PartyRoom_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartyMember" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT,
    "role" "PartyMemberRole" NOT NULL DEFAULT 'GUEST',
    "displayName" TEXT NOT NULL,
    "displayNameNormalized" TEXT NOT NULL,
    "avatarKey" TEXT NOT NULL DEFAULT 'teal',
    "budgetCap" DECIMAL(14,2),
    "preferences" JSONB,
    "sessionTokenHash" VARCHAR(64),
    "sessionExpiresAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PartyMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartyCandidate" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "attractionId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PartyCandidate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartyVote" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "value" "PartyVoteValue" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PartyVote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartyDecision" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "inputVersion" INTEGER NOT NULL,
    "algorithmVersion" TEXT NOT NULL,
    "consensusScore" DECIMAL(5,2) NOT NULL,
    "averageSatisfaction" DECIMAL(5,2) NOT NULL,
    "minimumSatisfaction" DECIMAL(5,2) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "metrics" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PartyDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PartyRoom_savedItineraryId_key" ON "PartyRoom"("savedItineraryId");
CREATE UNIQUE INDEX "PartyRoom_inviteTokenHash_key" ON "PartyRoom"("inviteTokenHash");
CREATE INDEX "PartyRoom_hostUserId_status_updatedAt_idx" ON "PartyRoom"("hostUserId", "status", "updatedAt");
CREATE INDEX "PartyRoom_status_inviteExpiresAt_idx" ON "PartyRoom"("status", "inviteExpiresAt");

CREATE UNIQUE INDEX "PartyMember_sessionTokenHash_key" ON "PartyMember"("sessionTokenHash");
CREATE UNIQUE INDEX "PartyMember_roomId_userId_key" ON "PartyMember"("roomId", "userId");
CREATE UNIQUE INDEX "PartyMember_roomId_displayNameNormalized_key" ON "PartyMember"("roomId", "displayNameNormalized");
CREATE INDEX "PartyMember_roomId_removedAt_joinedAt_idx" ON "PartyMember"("roomId", "removedAt", "joinedAt");
CREATE INDEX "PartyMember_sessionExpiresAt_idx" ON "PartyMember"("sessionExpiresAt");

CREATE UNIQUE INDEX "PartyCandidate_roomId_attractionId_key" ON "PartyCandidate"("roomId", "attractionId");
CREATE INDEX "PartyCandidate_roomId_position_idx" ON "PartyCandidate"("roomId", "position");
CREATE INDEX "PartyCandidate_attractionId_idx" ON "PartyCandidate"("attractionId");

CREATE UNIQUE INDEX "PartyVote_memberId_candidateId_key" ON "PartyVote"("memberId", "candidateId");
CREATE INDEX "PartyVote_candidateId_value_idx" ON "PartyVote"("candidateId", "value");
CREATE INDEX "PartyDecision_roomId_createdAt_idx" ON "PartyDecision"("roomId", "createdAt");

ALTER TABLE "PartyRoom"
ADD CONSTRAINT "PartyRoom_hostUserId_fkey"
FOREIGN KEY ("hostUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PartyRoom"
ADD CONSTRAINT "PartyRoom_savedItineraryId_fkey"
FOREIGN KEY ("savedItineraryId") REFERENCES "SavedItinerary"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PartyMember"
ADD CONSTRAINT "PartyMember_roomId_fkey"
FOREIGN KEY ("roomId") REFERENCES "PartyRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PartyMember"
ADD CONSTRAINT "PartyMember_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PartyCandidate"
ADD CONSTRAINT "PartyCandidate_roomId_fkey"
FOREIGN KEY ("roomId") REFERENCES "PartyRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PartyCandidate"
ADD CONSTRAINT "PartyCandidate_attractionId_fkey"
FOREIGN KEY ("attractionId") REFERENCES "Attraction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PartyVote"
ADD CONSTRAINT "PartyVote_memberId_fkey"
FOREIGN KEY ("memberId") REFERENCES "PartyMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PartyVote"
ADD CONSTRAINT "PartyVote_candidateId_fkey"
FOREIGN KEY ("candidateId") REFERENCES "PartyCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PartyDecision"
ADD CONSTRAINT "PartyDecision_roomId_fkey"
FOREIGN KEY ("roomId") REFERENCES "PartyRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
