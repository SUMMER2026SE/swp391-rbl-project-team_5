ALTER TABLE "Attraction"
ADD CONSTRAINT "Attraction_full_day_duration_check"
CHECK (NOT "isFullDay" OR "recommendedVisitMinutes" >= 360)
NOT VALID;

ALTER TABLE "Attraction"
VALIDATE CONSTRAINT "Attraction_full_day_duration_check";
