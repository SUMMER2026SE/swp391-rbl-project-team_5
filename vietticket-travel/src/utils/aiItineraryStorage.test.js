import { describe, expect, it } from 'vitest'
import {
  buildItineraryShareText,
  createItinerarySnapshot,
  getItineraryFeedback,
  loadSavedItineraries,
  removeItinerarySnapshot,
  saveItineraryFeedback,
  saveItinerarySnapshot,
} from './aiItineraryStorage.js'

function makeStorage() {
  const data = new Map()
  return {
    getItem: (key) => data.get(key) || null,
    setItem: (key, value) => data.set(key, value),
  }
}

describe('ai itinerary storage helpers', () => {
  it('creates and saves itinerary snapshots without duplicating ids', () => {
    const storage = makeStorage()
    const snapshot = createItinerarySnapshot(
      { clientPlanId: 'plan-1', title: 'Đà Nẵng 2 ngày' },
      { city: 'Đà Nẵng', ownerId: 'user-1' },
      Date.UTC(2026, 6, 1),
    )

    expect(snapshot).toMatchObject({
      id: 'plan-1',
      ownerId: 'user-1',
      title: 'Đà Nẵng 2 ngày',
      criteria: { city: 'Đà Nẵng', ownerId: 'user-1' },
    })

    saveItinerarySnapshot(snapshot, storage)
    saveItinerarySnapshot({ ...snapshot, title: 'Bản mới' }, storage)

    expect(loadSavedItineraries(storage)).toHaveLength(1)
    expect(loadSavedItineraries(storage)[0].title).toBe('Bản mới')
  })

  it('stores one feedback value per itinerary', () => {
    const storage = makeStorage()

    saveItineraryFeedback('plan-1', 'up', storage)
    saveItineraryFeedback('plan-1', 'down', storage)

    expect(getItineraryFeedback('plan-1', storage)).toBe('down')
  })

  it('removes a saved itinerary by id', () => {
    const storage = makeStorage()

    saveItinerarySnapshot({ id: 'plan-1', title: 'Plan 1' }, storage)
    saveItinerarySnapshot({ id: 'plan-2', title: 'Plan 2' }, storage)

    const remaining = removeItinerarySnapshot('plan-1', storage)

    expect(remaining).toHaveLength(1)
    expect(loadSavedItineraries(storage)[0].id).toBe('plan-2')
  })

  it('builds compact share text from day activities', () => {
    const text = buildItineraryShareText({
      title: 'Hành trình mẫu',
      days: [
        {
          day: 1,
          title: 'Ngày đầu',
          activities: [{ suggestedTime: '09:00', title: 'Bà Nà Hills' }],
        },
      ],
    })

    expect(text).toContain('Hành trình mẫu')
    expect(text).toContain('09:00: Bà Nà Hills')
    expect(text).toContain('VietTicket Travel')
  })
})
