CREATE TYPE "QuestionStatus" AS ENUM ('PUBLISHED', 'HIDDEN');

ALTER TABLE "AttractionQuestion"
ADD COLUMN "status" "QuestionStatus" NOT NULL DEFAULT 'PUBLISHED',
ADD COLUMN "reportCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "moderationReason" TEXT,
ADD COLUMN "moderatedAt" TIMESTAMP(3);

DROP INDEX IF EXISTS "AttractionQuestion_attractionId_createdAt_idx";
CREATE INDEX "AttractionQuestion_attractionId_status_createdAt_idx"
ON "AttractionQuestion"("attractionId", "status", "createdAt");

CREATE TABLE "AttractionQuestionReport" (
  "questionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttractionQuestionReport_pkey" PRIMARY KEY ("questionId", "userId"),
  CONSTRAINT "AttractionQuestionReport_questionId_fkey"
    FOREIGN KEY ("questionId") REFERENCES "AttractionQuestion"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AttractionQuestionReport_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AttractionQuestionReport_userId_idx"
ON "AttractionQuestionReport"("userId");
