-- CreateEnum
CREATE TYPE "TicketType" AS ENUM ('ADULT', 'CHILD', 'FAMILY', 'GROUP');

-- AlterTable
ALTER TABLE "Attraction" ADD COLUMN     "closeTime" TEXT,
ADD COLUMN     "defaultCapacity" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "district" TEXT,
ADD COLUMN     "openDays" TEXT,
ADD COLUMN     "openTime" TEXT;

-- AlterTable
ALTER TABLE "PartnerProfile" ADD COLUMN     "branchName" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "payoutCurrency" TEXT NOT NULL DEFAULT 'VND',
ADD COLUMN     "swiftCode" TEXT,
ADD COLUMN     "website" TEXT;

-- AlterTable
ALTER TABLE "TicketProduct" ADD COLUMN     "type" "TicketType" NOT NULL DEFAULT 'ADULT';

-- AlterTable
ALTER TABLE "TimeSlot" ADD COLUMN     "attractionId" TEXT,
ALTER COLUMN "ticketProductId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "SpecialDate" (
    "id" TEXT NOT NULL,
    "attractionId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "capacity" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpecialDate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpecialDate_attractionId_date_key" ON "SpecialDate"("attractionId", "date");

-- CreateIndex
CREATE INDEX "TimeSlot_attractionId_idx" ON "TimeSlot"("attractionId");

-- AddForeignKey
ALTER TABLE "TimeSlot" ADD CONSTRAINT "TimeSlot_attractionId_fkey" FOREIGN KEY ("attractionId") REFERENCES "Attraction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialDate" ADD CONSTRAINT "SpecialDate_attractionId_fkey" FOREIGN KEY ("attractionId") REFERENCES "Attraction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
