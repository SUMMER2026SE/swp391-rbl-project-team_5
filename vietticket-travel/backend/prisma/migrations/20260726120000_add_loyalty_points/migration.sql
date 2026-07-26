-- Loyalty points: ledger sổ cái điểm + số dư trên User + voucher cá nhân (đổi điểm).

-- CreateEnum
CREATE TYPE "VoucherSource" AS ENUM ('PROMOTION', 'LOYALTY');
CREATE TYPE "LoyaltyTransactionType" AS ENUM ('EARN', 'REVERSAL', 'REDEEM', 'ADJUSTMENT');

-- AlterTable: số dư điểm cache trên User
ALTER TABLE "User" ADD COLUMN "loyaltyPoints" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: gắn chủ sở hữu + nguồn gốc cho Voucher
ALTER TABLE "Voucher" ADD COLUMN "userId" TEXT;
ALTER TABLE "Voucher" ADD COLUMN "source" "VoucherSource" NOT NULL DEFAULT 'PROMOTION';

-- CreateTable: sổ cái điểm thưởng
CREATE TABLE "LoyaltyTransaction" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "bookingId" TEXT,
  "voucherId" TEXT,
  "type" "LoyaltyTransactionType" NOT NULL,
  "points" INTEGER NOT NULL,
  "balanceAfter" INTEGER NOT NULL,
  "description" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LoyaltyTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Voucher_userId_idx" ON "Voucher"("userId");
CREATE UNIQUE INDEX "LoyaltyTransaction_bookingId_type_key" ON "LoyaltyTransaction"("bookingId", "type");
CREATE INDEX "LoyaltyTransaction_userId_createdAt_idx" ON "LoyaltyTransaction"("userId", "createdAt");
CREATE INDEX "LoyaltyTransaction_voucherId_idx" ON "LoyaltyTransaction"("voucherId");

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE SET NULL ON UPDATE CASCADE;
