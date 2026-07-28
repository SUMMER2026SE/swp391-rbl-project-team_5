ALTER TABLE "TicketProduct"
ADD COLUMN "admissionCount" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Reservation"
ADD COLUMN "snapshotAdmissionCount" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Booking"
ADD COLUMN "snapshotAdmissionCount" INTEGER NOT NULL DEFAULT 1;

-- Không thể suy luận an toàn quy mô của các gói FAMILY/GROUP cũ từ mô tả tự do.
-- Tạm ngừng bán để đối tác khai báo số khách có cấu trúc trước khi kích hoạt lại.
UPDATE "TicketProduct"
SET "status" = 'INACTIVE'
WHERE "type" IN ('FAMILY', 'GROUP')
  AND "admissionCount" = 1;

ALTER TABLE "TicketProduct"
ADD CONSTRAINT "TicketProduct_admissionCount_check"
CHECK ("admissionCount" BETWEEN 1 AND 50);

ALTER TABLE "Reservation"
ADD CONSTRAINT "Reservation_snapshotAdmissionCount_check"
CHECK ("snapshotAdmissionCount" BETWEEN 1 AND 50);

ALTER TABLE "Booking"
ADD CONSTRAINT "Booking_snapshotAdmissionCount_check"
CHECK ("snapshotAdmissionCount" BETWEEN 1 AND 50);
