-- Separate content moderation from platform-level operational suspension.
CREATE TYPE "AttractionOperationalStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

ALTER TABLE "Attraction"
ADD COLUMN "operationalStatus" "AttractionOperationalStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "suspensionReason" TEXT,
ADD COLUMN "suspendedAt" TIMESTAMP(3),
ADD COLUMN "suspendedById" TEXT;

-- Existing SUSPENDED rows represented previously-approved, published listings.
-- Preserve their suspension details while restoring the content-review state.
UPDATE "Attraction"
SET
  "operationalStatus" = 'SUSPENDED',
  "suspensionReason" = "rejectionReason",
  "suspendedAt" = COALESCE("reviewedAt", "updatedAt"),
  "suspendedById" = "reviewedById",
  "status" = 'APPROVED',
  "rejectionReason" = NULL
WHERE "status" = 'SUSPENDED';

-- Remove the obsolete operational value from the content-review enum.
ALTER TABLE "Attraction"
ALTER COLUMN "status" DROP DEFAULT;

CREATE TYPE "AttractionStatus_new" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "Attraction"
ALTER COLUMN "status" TYPE "AttractionStatus_new"
USING ("status"::text::"AttractionStatus_new");

DROP TYPE "AttractionStatus";
ALTER TYPE "AttractionStatus_new" RENAME TO "AttractionStatus";

ALTER TABLE "Attraction"
ALTER COLUMN "status" SET DEFAULT 'DRAFT';

CREATE INDEX "Attraction_operationalStatus_idx"
ON "Attraction"("operationalStatus");
