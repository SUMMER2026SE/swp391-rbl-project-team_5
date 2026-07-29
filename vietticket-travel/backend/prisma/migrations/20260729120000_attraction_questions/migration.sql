CREATE TABLE "AttractionQuestion" (
  "id" TEXT NOT NULL,
  "attractionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "answer" TEXT,
  "answeredById" TEXT,
  "answeredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AttractionQuestion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AttractionQuestion_attractionId_fkey"
    FOREIGN KEY ("attractionId") REFERENCES "Attraction"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AttractionQuestion_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AttractionQuestion_answeredById_fkey"
    FOREIGN KEY ("answeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "AttractionQuestion_attractionId_createdAt_idx"
ON "AttractionQuestion"("attractionId", "createdAt");
CREATE INDEX "AttractionQuestion_answeredById_idx"
ON "AttractionQuestion"("answeredById");
