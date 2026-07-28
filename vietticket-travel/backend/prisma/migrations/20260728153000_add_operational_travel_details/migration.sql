ALTER TABLE "Attraction"
  ADD COLUMN "meetingPoint" TEXT,
  ADD COLUMN "checkInInstructions" TEXT,
  ADD COLUMN "accessibilityInfo" TEXT,
  ADD COLUMN "whatToBring" JSONB;

ALTER TABLE "TicketProduct"
  ADD COLUMN "inclusions" JSONB,
  ADD COLUMN "exclusions" JSONB;

ALTER TABLE "Booking"
  ADD COLUMN "snapshotMeetingPoint" TEXT,
  ADD COLUMN "snapshotCheckInInstructions" TEXT,
  ADD COLUMN "snapshotAccessibilityInfo" TEXT,
  ADD COLUMN "snapshotWhatToBring" JSONB,
  ADD COLUMN "snapshotInclusions" JSONB,
  ADD COLUMN "snapshotExclusions" JSONB;

ALTER TABLE "Attraction"
  ADD CONSTRAINT "Attraction_whatToBring_is_array"
  CHECK ("whatToBring" IS NULL OR jsonb_typeof("whatToBring") = 'array');

ALTER TABLE "TicketProduct"
  ADD CONSTRAINT "TicketProduct_inclusions_is_array"
  CHECK ("inclusions" IS NULL OR jsonb_typeof("inclusions") = 'array'),
  ADD CONSTRAINT "TicketProduct_exclusions_is_array"
  CHECK ("exclusions" IS NULL OR jsonb_typeof("exclusions") = 'array');

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_snapshotWhatToBring_is_array"
  CHECK ("snapshotWhatToBring" IS NULL OR jsonb_typeof("snapshotWhatToBring") = 'array'),
  ADD CONSTRAINT "Booking_snapshotInclusions_is_array"
  CHECK ("snapshotInclusions" IS NULL OR jsonb_typeof("snapshotInclusions") = 'array'),
  ADD CONSTRAINT "Booking_snapshotExclusions_is_array"
  CHECK ("snapshotExclusions" IS NULL OR jsonb_typeof("snapshotExclusions") = 'array');
