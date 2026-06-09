-- AlterEnum
ALTER TYPE "BookingStatus" ADD VALUE 'PENDING_PARTNER';

-- AlterTable
ALTER TABLE "Attraction" ADD COLUMN     "requiresManualApproval" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "refundRequired" BOOLEAN NOT NULL DEFAULT false;
