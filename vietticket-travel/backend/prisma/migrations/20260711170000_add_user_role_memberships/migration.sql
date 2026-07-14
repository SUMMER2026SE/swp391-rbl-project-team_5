-- Keep User.role as the primary UI persona while authorizing through additive roles.
CREATE TABLE "UserRoleMembership" (
    "userId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRoleMembership_pkey" PRIMARY KEY ("userId", "role")
);

CREATE INDEX "UserRoleMembership_role_idx" ON "UserRoleMembership"("role");

ALTER TABLE "UserRoleMembership"
ADD CONSTRAINT "UserRoleMembership_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Every existing account keeps its current role.
INSERT INTO "UserRoleMembership" ("userId", "role")
SELECT "id", "role" FROM "User"
ON CONFLICT ("userId", "role") DO NOTHING;

-- A partner account is still a customer account for personal bookings and tickets.
INSERT INTO "UserRoleMembership" ("userId", "role")
SELECT "id", 'CUSTOMER'::"UserRole" FROM "User" WHERE "role" = 'PARTNER'
ON CONFLICT ("userId", "role") DO NOTHING;
