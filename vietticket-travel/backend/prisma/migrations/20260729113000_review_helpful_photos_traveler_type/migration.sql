ALTER TABLE "Review"
ADD COLUMN "imageUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "travelerType" TEXT;

CREATE TABLE "ReviewHelpfulVote" (
  "reviewId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReviewHelpfulVote_pkey" PRIMARY KEY ("reviewId", "userId"),
  CONSTRAINT "ReviewHelpfulVote_reviewId_fkey"
    FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ReviewHelpfulVote_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ReviewHelpfulVote_userId_idx" ON "ReviewHelpfulVote"("userId");
