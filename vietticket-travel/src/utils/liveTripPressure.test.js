import { describe, expect, it } from 'vitest'
import { selectLiveTripPressure } from './liveTripPressure.js'

describe('selectLiveTripPressure', () => {
  const pressure = {
    summary: {
      capacity: 90,
      bookedQty: 39,
      availableTickets: 51,
      score: 27,
      level: 'QUIET',
      waitingGuests: 0,
    },
    slots: [
      {
        timeSlotId: 'slot-1630',
        startTime: '16:30',
        endTime: '18:00',
        capacity: 45,
        bookedQty: 39,
        availableTickets: 6,
        score: 70,
        level: 'BUSY',
        waitingGuests: 0,
      },
      {
        timeSlotId: 'slot-1830',
        startTime: '18:30',
        endTime: '20:00',
        capacity: 45,
        bookedQty: 0,
        availableTickets: 45,
        score: 0,
        level: 'QUIET',
        waitingGuests: 0,
      },
    ],
  }

  it('uses the activity time slot instead of contradictory day-level metrics', () => {
    const result = selectLiveTripPressure(pressure, {
      scheduledStart: '2026-07-24T09:30:00.000Z',
      snapshot: { timeSlotId: 'slot-1630' },
    })

    expect(result).toMatchObject({
      basis: 'TIME_SLOT',
      metrics: {
        bookedQty: 39,
        availableTickets: 6,
        score: 70,
        level: 'BUSY',
      },
      slot: { timeSlotId: 'slot-1630' },
    })
  })

  it('falls back to day metrics when the itinerary has no matching slot', () => {
    const result = selectLiveTripPressure(pressure, {
      scheduledStart: '2026-07-24T03:00:00.000Z',
      snapshot: {},
    })

    expect(result).toMatchObject({
      basis: 'DAY',
      metrics: { score: 27, level: 'QUIET' },
      slot: null,
    })
  })
})
