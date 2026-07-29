CREATE TYPE "PartnerKycChangeRequestStatus"
AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

CREATE TABLE "PartnerKycChangeRequest" (
  "id" TEXT NOT NULL,
  "partnerId" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "proposedData" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "PartnerKycChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedById" TEXT,
  "reviewNote" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PartnerKycChangeRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PartnerKycChangeRequest_partnerId_fkey"
    FOREIGN KEY ("partnerId") REFERENCES "PartnerProfile"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PartnerKycChangeRequest_requestedById_fkey"
    FOREIGN KEY ("requestedById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PartnerKycChangeRequest_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "PartnerKycChangeRequest_partnerId_status_createdAt_idx"
ON "PartnerKycChangeRequest"("partnerId", "status", "createdAt");
CREATE INDEX "PartnerKycChangeRequest_status_createdAt_idx"
ON "PartnerKycChangeRequest"("status", "createdAt");
CREATE INDEX "PartnerKycChangeRequest_requestedById_idx"
ON "PartnerKycChangeRequest"("requestedById");
CREATE INDEX "PartnerKycChangeRequest_reviewedById_idx"
ON "PartnerKycChangeRequest"("reviewedById");

CREATE UNIQUE INDEX "PartnerKycChangeRequest_one_pending_per_partner"
ON "PartnerKycChangeRequest"("partnerId")
WHERE "status" = 'PENDING';
