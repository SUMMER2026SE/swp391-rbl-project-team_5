import { describe, expect, it } from 'vitest'
import { getItineraryMapPoints, hasItineraryMapPoint } from './aiItineraryMap.js'

describe('AI itinerary map helpers', () => {
  it('accepts only valid latitude and longitude pairs', () => {
    expect(hasItineraryMapPoint({ latitude: 16.05, longitude: 108.2 })).toBe(true)
    expect(hasItineraryMapPoint({ latitude: 200, longitude: 108.2 })).toBe(false)
    expect(hasItineraryMapPoint({ latitude: 16.05, longitude: null })).toBe(false)
  })

  it('builds route map points from itinerary activities', () => {
    const points = getItineraryMapPoints([
      { attractionId: 'a1', latitude: '16.05', longitude: '108.2', title: 'Bà Nà', suggestedTime: '08:00' },
      { attractionId: 'a2', latitude: '', longitude: '108.3', title: 'Thiếu tọa độ' },
    ])

    expect(points).toEqual([
      {
        id: 'a1',
        position: [16.05, 108.2],
        time: '08:00',
        title: 'Bà Nà',
      },
    ])
  })
})
