-- Student concessions must not be priced as child tickets by the AI estimator.
UPDATE "TicketProduct"
SET "type" = 'STUDENT'
WHERE "type" = 'CHILD'
  AND (
    "name" ILIKE '%sinh viên%'
    OR "name" ILIKE '%học sinh%'
    OR "description" ILIKE '%sinh viên%'
    OR "description" ILIKE '%học sinh%'
  );

-- Convert the documented rules in the curated seed catalog to structured data.
-- Live partner-created CHILD products are required by validation to provide these
-- fields directly and never rely on parsing free-form descriptions.
UPDATE "TicketProduct"
SET
  "minAgeYears" = CASE
    WHEN "description" LIKE '%5–9 tuổi%' THEN 5
    WHEN "description" LIKE '%7–12 tuổi%' THEN 7
    ELSE "minAgeYears"
  END,
  "maxAgeYears" = CASE
    WHEN "description" LIKE '%5–9 tuổi%' THEN 9
    WHEN "description" LIKE '%7–12 tuổi%' THEN 12
    ELSE "maxAgeYears"
  END,
  "minHeightCm" = CASE
    WHEN "description" LIKE '%1m1–1m3%' THEN 110
    WHEN "description" LIKE '%1m–1m4%' THEN 100
    WHEN "description" LIKE '%1m–1m3%' THEN 100
    ELSE "minHeightCm"
  END,
  "maxHeightCm" = CASE
    WHEN "description" LIKE '%1m1–1m3%' THEN 130
    WHEN "description" LIKE '%1m–1m4%' THEN 140
    WHEN "description" LIKE '%1m–1m3%' THEN 130
    WHEN "description" LIKE '%dưới 1m4%' THEN 139
    ELSE "maxHeightCm"
  END,
  "requiresAdult" = CASE
    WHEN "description" ILIKE '%đi kèm người lớn%' THEN TRUE
    ELSE "requiresAdult"
  END
WHERE "type" = 'CHILD';
