-- Add missing legal-representative and consent evidence without rewriting or
-- deleting any existing partner profile. Legacy rows remain readable and can
-- be completed on their next KYC resubmission.
ALTER TABLE "User"
  ADD COLUMN "termsAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "termsVersion" TEXT,
  ADD COLUMN "privacyVersion" TEXT,
  ADD COLUMN "consentIpAddress" TEXT;

ALTER TABLE "User"
  ADD CONSTRAINT "User_termsConsent_evidence_chk"
  CHECK (
    "termsAcceptedAt" IS NULL
    OR (
      NULLIF(BTRIM("termsVersion"), '') IS NOT NULL
      AND NULLIF(BTRIM("privacyVersion"), '') IS NOT NULL
    )
  ) NOT VALID;

ALTER TABLE "User"
  VALIDATE CONSTRAINT "User_termsConsent_evidence_chk";

ALTER TABLE "PartnerProfile"
  ADD COLUMN "registrationDate" DATE,
  ADD COLUMN "representativeName" TEXT,
  ADD COLUMN "representativePhone" TEXT,
  ADD COLUMN "businessAddress" TEXT,
  ADD COLUMN "kycConsentAccepted" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "kycConsentVersion" TEXT,
  ADD COLUMN "kycConsentAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "kycConsentIpAddress" TEXT;

ALTER TABLE "PartnerProfile"
  ADD CONSTRAINT "PartnerProfile_representativePhone_format_chk"
  CHECK (
    "representativePhone" IS NULL
    OR "representativePhone" ~ '^0(3|5|7|8|9)[0-9]{8}$'
  ) NOT VALID;

ALTER TABLE "PartnerProfile"
  VALIDATE CONSTRAINT "PartnerProfile_representativePhone_format_chk";

ALTER TABLE "PartnerProfile"
  ADD CONSTRAINT "PartnerProfile_kycConsent_evidence_chk"
  CHECK (
    (
      "kycConsentAccepted" = FALSE
      AND "kycConsentAcceptedAt" IS NULL
    )
    OR
    (
      "kycConsentAccepted" = TRUE
      AND "kycConsentAcceptedAt" IS NOT NULL
      AND NULLIF(BTRIM("kycConsentVersion"), '') IS NOT NULL
    )
  ) NOT VALID;

ALTER TABLE "PartnerProfile"
  VALIDATE CONSTRAINT "PartnerProfile_kycConsent_evidence_chk";

-- Freeze the commercial terms visible when inventory is held. The columns
-- remain nullable so pre-existing reservations keep using the controller's
-- legacy live-data fallback instead of being silently interpreted as zero.
ALTER TABLE "Reservation"
  ADD COLUMN "snapshotUnitPrice" DECIMAL(12,2),
  ADD COLUMN "snapshotRefundPolicy" "RefundPolicyType",
  ADD COLUMN "snapshotRefundFeeRate" DECIMAL(5,2),
  ADD COLUMN "snapshotRefundCutoffHours" INTEGER,
  ADD COLUMN "snapshotCommissionRate" DECIMAL(5,2);
