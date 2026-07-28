CREATE TABLE "NotificationOutbox" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationOutbox_dedupeKey_key"
ON "NotificationOutbox"("dedupeKey");

CREATE INDEX "NotificationOutbox_status_nextAttemptAt_idx"
ON "NotificationOutbox"("status", "nextAttemptAt");

CREATE INDEX "NotificationOutbox_topic_aggregateId_idx"
ON "NotificationOutbox"("topic", "aggregateId");
