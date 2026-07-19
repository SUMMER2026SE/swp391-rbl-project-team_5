UPDATE "TicketProduct"
SET
  "minAgeYears" = 3,
  "maxAgeYears" = 11,
  "requiresAdult" = TRUE
WHERE "type" = 'CHILD'
  AND "description" LIKE '%3–11 tuổi%'
  AND "minAgeYears" IS NULL
  AND "maxAgeYears" IS NULL;
