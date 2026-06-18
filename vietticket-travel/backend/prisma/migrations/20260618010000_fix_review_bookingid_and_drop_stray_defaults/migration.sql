-- Vá schema drift giữa prisma/schema.prisma và DB Supabase thật.
-- schema.prisma đã được sửa tay nhưng chưa có migration tương ứng:
--   1. Review.bookingId (nullable, unique, FK -> Booking) bị thiếu trong DB
--      => mọi truy vấn tạo/đọc Review.bookingId fail trên DB thật (reviewController.createReview).
--      An toàn: bảng Review có 0 dòng, cột thêm mới là nullable => unique index không thể trùng.
--   2. Category/RefundTransaction/ScheduledJobLock.updatedAt còn DEFAULT thừa trong DB
--      nhưng schema không khai báo (Prisma quản updatedAt qua @updatedAt ở tầng ứng dụng).

-- AlterTable
ALTER TABLE "Category" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "RefundTransaction" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ScheduledJobLock" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "bookingId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Review_bookingId_key" ON "Review"("bookingId");

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
