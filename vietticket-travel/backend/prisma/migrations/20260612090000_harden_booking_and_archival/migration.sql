ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'NO_SHOW';
ALTER TYPE "RefundStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';

ALTER TABLE "Attraction" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Attraction" ADD COLUMN "minTicketPrice" DECIMAL(12,2);
ALTER TABLE "TicketProduct" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "RefundRequest" ADD COLUMN "processingStartedAt" TIMESTAMP(3);
ALTER TABLE "Category" ADD COLUMN "icon" TEXT;
ALTER TABLE "Category" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Category" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "Attraction_archivedAt_idx" ON "Attraction"("archivedAt");
CREATE INDEX "Attraction_minTicketPrice_idx" ON "Attraction"("minTicketPrice");
CREATE INDEX "TicketProduct_archivedAt_idx" ON "TicketProduct"("archivedAt");

UPDATE "Attraction" a
SET "minTicketPrice" = prices."minPrice"
FROM (
    SELECT "attractionId", MIN("sellingPrice") AS "minPrice"
    FROM "TicketProduct"
    WHERE "status" = 'ACTIVE' AND "archivedAt" IS NULL
    GROUP BY "attractionId"
) prices
WHERE prices."attractionId" = a."id";

CREATE TABLE "NewsletterSubscription" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "subscribedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsletterSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NewsletterSubscription_email_key"
ON "NewsletterSubscription"("email");

CREATE INDEX "NewsletterSubscription_isActive_idx"
ON "NewsletterSubscription"("isActive");

CREATE TABLE "AttractionDailyStock" (
    "id" TEXT NOT NULL,
    "attractionId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "capacity" INTEGER NOT NULL,
    "bookedQty" INTEGER NOT NULL DEFAULT 0,
    "heldQty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AttractionDailyStock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AttractionDailyStock_attractionId_date_key"
ON "AttractionDailyStock"("attractionId", "date");

ALTER TABLE "AttractionDailyStock"
ADD CONSTRAINT "AttractionDailyStock_attractionId_fkey"
FOREIGN KEY ("attractionId") REFERENCES "Attraction"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "AttractionDailyStock"
    ("id", "attractionId", "date", "capacity", "bookedQty", "heldQty")
SELECT
    md5(tp."attractionId" || ds."date"::date::text),
    tp."attractionId",
    ds."date"::date,
    GREATEST(
        a."defaultCapacity",
        SUM(ds."bookedQuantity" + ds."heldQuantity")::integer
    ),
    SUM(ds."bookedQuantity")::integer,
    SUM(ds."heldQuantity")::integer
FROM "DailyStock" ds
JOIN "TicketProduct" tp ON tp."id" = ds."ticketProductId"
JOIN "Attraction" a ON a."id" = tp."attractionId"
GROUP BY tp."attractionId", ds."date"::date, a."defaultCapacity"
ON CONFLICT ("attractionId", "date") DO NOTHING;
