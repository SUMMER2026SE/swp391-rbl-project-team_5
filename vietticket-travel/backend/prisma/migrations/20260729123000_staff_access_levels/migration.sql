CREATE TYPE "StaffAccessLevel" AS ENUM ('SCANNER', 'MANAGER');

ALTER TABLE "User" ADD COLUMN "staffAccessLevel" "StaffAccessLevel";

UPDATE "User"
SET "staffAccessLevel" = CASE
  WHEN "employerPartnerId" IS NULL THEN 'MANAGER'::"StaffAccessLevel"
  ELSE 'SCANNER'::"StaffAccessLevel"
END
WHERE "role" = 'STAFF';
