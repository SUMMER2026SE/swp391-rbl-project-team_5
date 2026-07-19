CREATE TYPE "AttractionEnvironment" AS ENUM ('INDOOR', 'OUTDOOR', 'MIXED');

ALTER TABLE "Attraction"
ADD COLUMN "recommendedVisitMinutes" INTEGER NOT NULL DEFAULT 150,
ADD COLUMN "environment" "AttractionEnvironment" NOT NULL DEFAULT 'MIXED',
ADD COLUMN "isFullDay" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "TicketProduct"
ADD COLUMN "minAgeYears" INTEGER,
ADD COLUMN "maxAgeYears" INTEGER,
ADD COLUMN "minHeightCm" INTEGER,
ADD COLUMN "maxHeightCm" INTEGER,
ADD COLUMN "requiresAdult" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "Attraction"
ADD CONSTRAINT "Attraction_recommendedVisitMinutes_check"
CHECK ("recommendedVisitMinutes" BETWEEN 30 AND 720);

ALTER TABLE "TicketProduct"
ADD CONSTRAINT "TicketProduct_age_range_check"
CHECK (
  ("minAgeYears" IS NULL OR "minAgeYears" BETWEEN 0 AND 120)
  AND ("maxAgeYears" IS NULL OR "maxAgeYears" BETWEEN 0 AND 120)
  AND ("minAgeYears" IS NULL OR "maxAgeYears" IS NULL OR "minAgeYears" <= "maxAgeYears")
);

ALTER TABLE "TicketProduct"
ADD CONSTRAINT "TicketProduct_height_range_check"
CHECK (
  ("minHeightCm" IS NULL OR "minHeightCm" BETWEEN 30 AND 250)
  AND ("maxHeightCm" IS NULL OR "maxHeightCm" BETWEEN 30 AND 250)
  AND ("minHeightCm" IS NULL OR "maxHeightCm" IS NULL OR "minHeightCm" <= "maxHeightCm")
);

-- Backfill conservative visit durations and environments from the catalog category.
-- Partner-entered values remain editable after this migration.
UPDATE "Attraction" a
SET
  "recommendedVisitMinutes" = CASE
    WHEN c."name" IN ('Theme Park & Resort', 'Amusement Park') THEN 420
    WHEN c."name" = 'Adventure' THEN 300
    WHEN c."name" = 'Nature & Sightseeing' THEN 240
    WHEN c."name" = 'Museum' THEN 120
    ELSE 150
  END,
  "environment" = CASE
    WHEN c."name" = 'Museum' THEN 'INDOOR'::"AttractionEnvironment"
    WHEN c."name" IN ('Nature & Sightseeing', 'Adventure') THEN 'OUTDOOR'::"AttractionEnvironment"
    ELSE 'MIXED'::"AttractionEnvironment"
  END,
  "isFullDay" = c."name" IN ('Theme Park & Resort', 'Amusement Park')
FROM "AttractionCategory" ac
JOIN "Category" c ON c."id" = ac."categoryId"
WHERE ac."attractionId" = a."id";
