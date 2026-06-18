-- Staff thuộc đối tác: mỗi nhân viên (role = STAFF) thuộc về đúng một PartnerProfile.
-- Chỉ thêm cột/khoá ngoại cho User; không đụng tới các bảng khác.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "employerPartnerId" TEXT;

-- CreateIndex
CREATE INDEX "User_employerPartnerId_idx" ON "User"("employerPartnerId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_employerPartnerId_fkey" FOREIGN KEY ("employerPartnerId") REFERENCES "PartnerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
