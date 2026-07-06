-- CreateTable
CREATE TABLE "SavedItinerary" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "criteria" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedItinerary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedItinerary_userId_idx" ON "SavedItinerary"("userId");

-- CreateIndex
CREATE INDEX "SavedItinerary_createdAt_idx" ON "SavedItinerary"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SavedItinerary_userId_planId_key" ON "SavedItinerary"("userId", "planId");

-- AddForeignKey
ALTER TABLE "SavedItinerary" ADD CONSTRAINT "SavedItinerary_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
