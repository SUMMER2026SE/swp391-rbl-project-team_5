-- VietTicket currently prices, captures, refunds and settles exclusively in VND.
-- Normalize any legacy/demo profile before enforcing the invariant at database level.
UPDATE "PartnerProfile"
SET "payoutCurrency" = 'VND'
WHERE "payoutCurrency" IS DISTINCT FROM 'VND';

ALTER TABLE "PartnerProfile"
ADD CONSTRAINT "PartnerProfile_payoutCurrency_vnd_check"
CHECK ("payoutCurrency" = 'VND');
