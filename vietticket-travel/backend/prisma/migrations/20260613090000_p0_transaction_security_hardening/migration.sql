-- P0 hardening: immutable booking snapshots, durable refunds, staff scoped check-in,
-- revocable sessions, audit log, worker locking and database-level integrity guards.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "AuthSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");
CREATE INDEX IF NOT EXISTS "AuthSession_userId_idx" ON "AuthSession"("userId");
CREATE INDEX IF NOT EXISTS "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");
CREATE INDEX IF NOT EXISTS "AuthSession_revokedAt_idx" ON "AuthSession"("revokedAt");
ALTER TABLE "AuthSession"
    ADD CONSTRAINT "AuthSession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "paymentDeadline" TIMESTAMP(3);
ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "paymentAttemptCount" INTEGER NOT NULL DEFAULT 0;
UPDATE "Reservation" SET "paymentDeadline" = COALESCE("paymentDeadline", "expiresAt");
CREATE INDEX IF NOT EXISTS "Reservation_status_expiresAt_idx" ON "Reservation"("status", "expiresAt");
CREATE INDEX IF NOT EXISTS "Reservation_userId_createdAt_idx" ON "Reservation"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "Reservation_ticketProductId_date_idx" ON "Reservation"("ticketProductId", "date");

CREATE TABLE IF NOT EXISTS "StaffAttractionAssignment" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "attractionId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "StaffAttractionAssignment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "StaffAttractionAssignment_staffId_attractionId_key"
    ON "StaffAttractionAssignment"("staffId", "attractionId");
CREATE INDEX IF NOT EXISTS "StaffAttractionAssignment_staffId_revokedAt_idx"
    ON "StaffAttractionAssignment"("staffId", "revokedAt");
CREATE INDEX IF NOT EXISTS "StaffAttractionAssignment_attractionId_revokedAt_idx"
    ON "StaffAttractionAssignment"("attractionId", "revokedAt");
ALTER TABLE "StaffAttractionAssignment"
    ADD CONSTRAINT "StaffAttractionAssignment_staffId_fkey"
    FOREIGN KEY ("staffId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffAttractionAssignment"
    ADD CONSTRAINT "StaffAttractionAssignment_attractionId_fkey"
    FOREIGN KEY ("attractionId") REFERENCES "Attraction"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffAttractionAssignment"
    ADD CONSTRAINT "StaffAttractionAssignment_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AttractionImage" ADD COLUMN IF NOT EXISTS "__migration_tmp" BOOLEAN;
ALTER TABLE "AttractionImage" DROP COLUMN IF EXISTS "__migration_tmp";
CREATE INDEX IF NOT EXISTS "AttractionImage_attractionId_idx" ON "AttractionImage"("attractionId");
WITH ranked_primary AS (
    SELECT "id", ROW_NUMBER() OVER (PARTITION BY "attractionId" ORDER BY "createdAt" ASC, "id" ASC) AS rn
    FROM "AttractionImage"
    WHERE "isPrimary" = true
)
UPDATE "AttractionImage" ai
SET "isPrimary" = false
FROM ranked_primary rp
WHERE ai."id" = rp."id" AND rp.rn > 1;
CREATE UNIQUE INDEX IF NOT EXISTS "AttractionImage_one_primary_per_attraction"
    ON "AttractionImage"("attractionId")
    WHERE "isPrimary" = true;

CREATE INDEX IF NOT EXISTS "DailyStock_date_idx" ON "DailyStock"("date");
CREATE INDEX IF NOT EXISTS "AttractionDailyStock_date_idx" ON "AttractionDailyStock"("date");
CREATE INDEX IF NOT EXISTS "TimeSlotStock_date_idx" ON "TimeSlotStock"("date");
CREATE INDEX IF NOT EXISTS "Review_userId_idx" ON "Review"("userId");
CREATE INDEX IF NOT EXISTS "Review_attractionId_isHidden_createdAt_idx"
    ON "Review"("attractionId", "isHidden", "createdAt");

ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "snapshotAttractionId" TEXT;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "snapshotAttractionTitle" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "snapshotAttractionAddress" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "snapshotAttractionCity" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "snapshotAttractionDistrict" TEXT;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "snapshotAttractionImage" TEXT;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "snapshotTicketName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "snapshotTicketType" "TicketType" NOT NULL DEFAULT 'ADULT';
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "snapshotTicketDescription" TEXT;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "snapshotUnitPrice" DECIMAL(12,2) NOT NULL DEFAULT 0.0;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "snapshotRefundPolicy" "RefundPolicyType" NOT NULL DEFAULT 'NON_REFUNDABLE';
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "snapshotRefundFeeRate" DECIMAL(5,2) NOT NULL DEFAULT 0.0;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "snapshotVisitDate" DATE;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "snapshotTimeSlotLabel" TEXT;

UPDATE "Booking" b
SET
    "snapshotAttractionId" = COALESCE(b."snapshotAttractionId", a."id"),
    "snapshotAttractionTitle" = COALESCE(NULLIF(b."snapshotAttractionTitle", ''), a."title", ''),
    "snapshotAttractionAddress" = COALESCE(NULLIF(b."snapshotAttractionAddress", ''), a."address", ''),
    "snapshotAttractionCity" = COALESCE(NULLIF(b."snapshotAttractionCity", ''), a."city", ''),
    "snapshotAttractionDistrict" = COALESCE(b."snapshotAttractionDistrict", a."district"),
    "snapshotAttractionImage" = COALESCE(
        b."snapshotAttractionImage",
        (
            SELECT ai."imageUrl"
            FROM "AttractionImage" ai
            WHERE ai."attractionId" = a."id"
            ORDER BY ai."isPrimary" DESC, ai."createdAt" ASC
            LIMIT 1
        )
    ),
    "snapshotTicketName" = COALESCE(NULLIF(b."snapshotTicketName", ''), tp."name", ''),
    "snapshotTicketType" = COALESCE(b."snapshotTicketType", tp."type"),
    "snapshotTicketDescription" = COALESCE(b."snapshotTicketDescription", tp."description"),
    "snapshotUnitPrice" = CASE WHEN b."snapshotUnitPrice" = 0 THEN tp."sellingPrice" ELSE b."snapshotUnitPrice" END,
    "snapshotRefundPolicy" = COALESCE(b."snapshotRefundPolicy", tp."refundPolicy"),
    "snapshotRefundFeeRate" = CASE WHEN b."snapshotRefundFeeRate" = 0 THEN tp."refundFeeRate" ELSE b."snapshotRefundFeeRate" END,
    "snapshotVisitDate" = COALESCE(b."snapshotVisitDate", r."date"),
    "snapshotTimeSlotLabel" = COALESCE(
        b."snapshotTimeSlotLabel",
        CASE
            WHEN ts."id" IS NULL THEN NULL
            ELSE ts."startTime" || ' - ' || ts."endTime"
        END
    )
FROM "Reservation" r
JOIN "TicketProduct" tp ON tp."id" = r."ticketProductId"
JOIN "Attraction" a ON a."id" = tp."attractionId"
LEFT JOIN "TimeSlot" ts ON ts."id" = r."timeSlotId"
WHERE b."reservationId" = r."id";

CREATE INDEX IF NOT EXISTS "Booking_snapshotAttractionId_idx" ON "Booking"("snapshotAttractionId");
CREATE INDEX IF NOT EXISTS "Booking_snapshotVisitDate_idx" ON "Booking"("snapshotVisitDate");

ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMP(3);
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "failureReason" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "isDuplicate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "duplicateOfPaymentId" TEXT;
CREATE INDEX IF NOT EXISTS "Payment_expiresAt_idx" ON "Payment"("expiresAt");
CREATE INDEX IF NOT EXISTS "Payment_isDuplicate_idx" ON "Payment"("isDuplicate");
ALTER TABLE "Payment"
    ADD CONSTRAINT "Payment_duplicateOfPaymentId_fkey"
    FOREIGN KEY ("duplicateOfPaymentId") REFERENCES "Payment"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TicketInstance" ADD COLUMN IF NOT EXISTS "checkedInAt" TIMESTAMP(3);
ALTER TABLE "TicketInstance" ADD COLUMN IF NOT EXISTS "checkedInById" TEXT;
CREATE INDEX IF NOT EXISTS "TicketInstance_checkedInById_idx" ON "TicketInstance"("checkedInById");
CREATE INDEX IF NOT EXISTS "TicketInstance_checkedInAt_idx" ON "TicketInstance"("checkedInAt");
ALTER TABLE "TicketInstance"
    ADD CONSTRAINT "TicketInstance_checkedInById_fkey"
    FOREIGN KEY ("checkedInById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

DO $$ BEGIN
    CREATE TYPE "RefundTransactionStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'NEEDS_RECONCILIATION');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "RefundTransaction" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "paymentId" TEXT,
    "refundRequestId" TEXT,
    "gateway" TEXT NOT NULL DEFAULT 'VNPAY',
    "gatewayRequestId" TEXT NOT NULL,
    "transactionType" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "RefundTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "rawRequest" JSONB,
    "rawResponse" JSONB,
    "processedById" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RefundTransaction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RefundTransaction_gatewayRequestId_key"
    ON "RefundTransaction"("gatewayRequestId");
CREATE INDEX IF NOT EXISTS "RefundTransaction_bookingId_idx" ON "RefundTransaction"("bookingId");
CREATE INDEX IF NOT EXISTS "RefundTransaction_paymentId_idx" ON "RefundTransaction"("paymentId");
CREATE INDEX IF NOT EXISTS "RefundTransaction_refundRequestId_idx" ON "RefundTransaction"("refundRequestId");
CREATE INDEX IF NOT EXISTS "RefundTransaction_status_idx" ON "RefundTransaction"("status");
ALTER TABLE "RefundTransaction"
    ADD CONSTRAINT "RefundTransaction_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "Booking"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RefundTransaction"
    ADD CONSTRAINT "RefundTransaction_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "Payment"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RefundTransaction"
    ADD CONSTRAINT "RefundTransaction_refundRequestId_fkey"
    FOREIGN KEY ("refundRequestId") REFERENCES "RefundRequest"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "ScheduledJobLock" (
    "jobName" TEXT NOT NULL,
    "lockedBy" TEXT,
    "lockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScheduledJobLock_pkey" PRIMARY KEY ("jobName")
);

CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AuditLog_actorId_idx" ON "AuditLog"("actorId");
CREATE INDEX IF NOT EXISTS "AuditLog_action_idx" ON "AuditLog"("action");
CREATE INDEX IF NOT EXISTS "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
ALTER TABLE "AuditLog"
    ADD CONSTRAINT "AuditLog_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Reservation_quantity_positive_chk') THEN
        ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_quantity_positive_chk"
            CHECK ("quantity" > 0 AND "paymentAttemptCount" >= 0) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DailyStock_non_negative_capacity_chk') THEN
        ALTER TABLE "DailyStock" ADD CONSTRAINT "DailyStock_non_negative_capacity_chk"
            CHECK ("capacity" >= 0 AND "bookedQuantity" >= 0 AND "heldQuantity" >= 0 AND ("bookedQuantity" + "heldQuantity") <= "capacity") NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AttractionDailyStock_non_negative_capacity_chk') THEN
        ALTER TABLE "AttractionDailyStock" ADD CONSTRAINT "AttractionDailyStock_non_negative_capacity_chk"
            CHECK ("capacity" >= 0 AND "bookedQty" >= 0 AND "heldQty" >= 0 AND ("bookedQty" + "heldQty") <= "capacity") NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TimeSlotStock_non_negative_chk') THEN
        ALTER TABLE "TimeSlotStock" ADD CONSTRAINT "TimeSlotStock_non_negative_chk"
            CHECK ("bookedQty" >= 0 AND "heldQty" >= 0) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Booking_amounts_non_negative_chk') THEN
        ALTER TABLE "Booking" ADD CONSTRAINT "Booking_amounts_non_negative_chk"
            CHECK ("subtotalAmount" >= 0 AND "discountAmount" >= 0 AND "totalAmount" >= 0 AND "snapshotUnitPrice" >= 0 AND "snapshotRefundFeeRate" >= 0 AND "snapshotRefundFeeRate" <= 1) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Payment_amount_non_negative_chk') THEN
        ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_non_negative_chk"
            CHECK ("amount" >= 0) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RefundRequest_amount_non_negative_chk') THEN
        ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_amount_non_negative_chk"
            CHECK ("amount" >= 0) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RefundTransaction_amount_non_negative_chk') THEN
        ALTER TABLE "RefundTransaction" ADD CONSTRAINT "RefundTransaction_amount_non_negative_chk"
            CHECK ("amount" >= 0) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TicketProduct_price_policy_chk') THEN
        ALTER TABLE "TicketProduct" ADD CONSTRAINT "TicketProduct_price_policy_chk"
            CHECK ("originalPrice" >= 0 AND "sellingPrice" >= 0 AND "refundFeeRate" >= 0 AND "refundFeeRate" <= 1) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TimeSlot_capacity_non_negative_chk') THEN
        ALTER TABLE "TimeSlot" ADD CONSTRAINT "TimeSlot_capacity_non_negative_chk"
            CHECK ("maxCapacity" >= 0) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Attraction_capacity_non_negative_chk') THEN
        ALTER TABLE "Attraction" ADD CONSTRAINT "Attraction_capacity_non_negative_chk"
            CHECK ("defaultCapacity" >= 0) NOT VALID;
    END IF;
END $$;
