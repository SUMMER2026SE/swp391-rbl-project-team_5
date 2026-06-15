CREATE TYPE "AttractionPublicationStatus" AS ENUM ('PAUSED', 'ACTIVE', 'ARCHIVED');

ALTER TABLE "Attraction"
ADD COLUMN "publicationStatus" "AttractionPublicationStatus" NOT NULL DEFAULT 'PAUSED',
ADD COLUMN "draftData" JSONB,
ADD COLUMN "submittedData" JSONB,
ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "submittedAt" TIMESTAMP(3),
ADD COLUMN "reviewedAt" TIMESTAMP(3),
ADD COLUMN "reviewedById" TEXT,
ADD COLUMN "publishedAt" TIMESTAMP(3);

UPDATE "Attraction"
SET
  "publicationStatus" = CASE
    WHEN "archivedAt" IS NOT NULL THEN 'ARCHIVED'::"AttractionPublicationStatus"
    WHEN "status" = 'APPROVED' THEN 'ACTIVE'::"AttractionPublicationStatus"
    ELSE 'PAUSED'::"AttractionPublicationStatus"
  END,
  "publishedAt" = CASE
    WHEN "status" = 'APPROVED' THEN COALESCE("updatedAt", "createdAt")
    ELSE NULL
  END;

CREATE INDEX "Attraction_publicationStatus_idx"
ON "Attraction"("publicationStatus");
