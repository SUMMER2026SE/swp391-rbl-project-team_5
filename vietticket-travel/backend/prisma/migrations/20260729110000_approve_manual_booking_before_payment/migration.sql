ALTER TABLE "Booking"
ADD COLUMN "partnerApprovalRequestedAt" TIMESTAMP(3),
ADD COLUMN "partnerApprovalDeadline" TIMESTAMP(3),
ADD COLUMN "partnerApprovedAt" TIMESTAMP(3);

CREATE INDEX "Booking_status_partnerApprovalDeadline_idx"
ON "Booking"("status", "partnerApprovalDeadline");
