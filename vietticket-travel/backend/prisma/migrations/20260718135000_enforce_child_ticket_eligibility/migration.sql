ALTER TABLE "TicketProduct"
ADD CONSTRAINT "TicketProduct_child_eligibility_check"
CHECK (
  "type" <> 'CHILD'
  OR "minAgeYears" IS NOT NULL
  OR "maxAgeYears" IS NOT NULL
  OR "minHeightCm" IS NOT NULL
  OR "maxHeightCm" IS NOT NULL
)
NOT VALID;

ALTER TABLE "TicketProduct"
VALIDATE CONSTRAINT "TicketProduct_child_eligibility_check";
