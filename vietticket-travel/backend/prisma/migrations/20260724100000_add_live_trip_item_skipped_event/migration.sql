-- Marking a past unbooked itinerary item as skipped is an auditable state transition.
ALTER TYPE "LiveTripEventType" ADD VALUE IF NOT EXISTS 'ITEM_SKIPPED';
