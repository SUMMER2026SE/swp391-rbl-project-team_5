CREATE TYPE "SupportPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

ALTER TABLE "SupportTicket"
ADD COLUMN "priority" "SupportPriority" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN "assignedToId" TEXT,
ADD COLUMN "assignedAt" TIMESTAMP(3),
ADD COLUMN "firstRespondedAt" TIMESTAMP(3),
ADD COLUMN "resolvedAt" TIMESTAMP(3),
ADD COLUMN "resolutionCode" TEXT,
ADD COLUMN "resolutionNote" TEXT;

ALTER TABLE "SupportTicket"
ADD CONSTRAINT "SupportTicket_assignedToId_fkey"
FOREIGN KEY ("assignedToId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "SupportTicket_priority_status_createdAt_idx"
ON "SupportTicket"("priority", "status", "createdAt");

CREATE INDEX "SupportTicket_assignedToId_status_idx"
ON "SupportTicket"("assignedToId", "status");

ALTER TABLE "Review"
ADD COLUMN "moderationReason" TEXT,
ADD COLUMN "moderatedAt" TIMESTAMP(3),
ADD COLUMN "moderatedById" TEXT;
