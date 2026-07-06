import { describe, expect, it } from 'vitest'
import {
  AI_BOOKING_QUEUE_KEY,
  buildItineraryQueueBookingUrl,
  completeItineraryQueueItemByBookingId,
  createItineraryBookingQueue,
  extractBookableItineraryItems,
  getItineraryQueueProgress,
  getNextItineraryQueueStep,
  loadItineraryBookingQueue,
  markItineraryQueueItemReserved,
  saveItineraryBookingQueue,
} from './aiItineraryBookingQueue.js'

function makeStorage() {
  const store = new Map()
  return {
    getItem: (key) => store.get(key) || null,
    setItem: (key, value) => store.set(key, String(value)),
  }
}

const samplePlan = {
  clientPlanId: 'plan-1',
  title: 'Đà Nẵng 2 ngày',
  startDate: '2026-07-15',
  days: [
    {
      day: 1,
      visitDate: '2026-07-15',
      activities: [
        {
          attractionId: 'attr-1',
          title: 'Bà Nà Hills',
          ticketItems: [
            {
              ticketId: 'adult-1',
              ticketName: 'Vé người lớn',
              quantity: 2,
              unitPrice: 750000,
              suggestedTimeSlot: { timeSlotId: 'slot-1', startTime: '08:00', endTime: '12:00' },
            },
            {
              ticketId: 'child-1',
              ticketName: 'Vé trẻ em',
              quantity: 1,
              unitPrice: 550000,
            },
          ],
        },
        {
          attractionId: 'attr-2',
          title: 'Điểm chưa có vé',
          ticketItems: [{ ticketName: 'Thiếu id vé', quantity: 1 }],
        },
      ],
    },
  ],
}

describe('AI itinerary booking queue helpers', () => {
  it('extracts only bookable ticket lines from an AI itinerary', () => {
    const items = extractBookableItineraryItems(samplePlan)

    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      attractionId: 'attr-1',
      attractionTitle: 'Bà Nà Hills',
      dayLabel: 'Ngày 1',
      quantity: 2,
      ticketId: 'adult-1',
      timeSlotId: 'slot-1',
      visitDate: '2026-07-15',
    })
    expect(items[1]).toMatchObject({
      quantity: 1,
      ticketId: 'child-1',
    })
  })

  it('creates, saves and reloads a booking queue', () => {
    const storage = makeStorage()
    const queue = createItineraryBookingQueue(samplePlan, {
      now: 1784102400000,
      ownerId: 'user-1',
    })

    expect(queue).toMatchObject({
      id: 'ai-booking-1784102400000',
      ownerId: 'user-1',
      planId: 'plan-1',
      planTitle: 'Đà Nẵng 2 ngày',
      currentIndex: 0,
    })

    saveItineraryBookingQueue(queue, storage)
    expect(storage.getItem(AI_BOOKING_QUEUE_KEY)).toContain('adult-1')
    expect(loadItineraryBookingQueue(storage)).toEqual(queue)
  })

  it('builds a prefilled booking URL for a queue item', () => {
    const queue = createItineraryBookingQueue(samplePlan, { now: 1784102400000 })
    const url = buildItineraryQueueBookingUrl(queue, queue.items[0])

    expect(url).toContain('/attractions/attr-1?bookNow=1&source=ai')
    expect(url).toContain('ticketId=adult-1')
    expect(url).toContain('date=2026-07-15')
    expect(url).toContain('qty=2')
    expect(url).toContain('timeSlotId=slot-1')
    expect(url).toContain('aiQueueId=ai-booking-1784102400000')
  })

  it('tracks reservation, booking and next step progress for sequential checkout', () => {
    const storage = makeStorage()
    const queue = createItineraryBookingQueue(samplePlan, { now: 1784102400000 })
    saveItineraryBookingQueue(queue, storage)

    const reservedQueue = markItineraryQueueItemReserved(
      {
        bookingId: 'booking-1',
        itemId: queue.items[0].id,
        queueId: queue.id,
        reservationId: 'reservation-1',
      },
      storage,
    )

    expect(reservedQueue.items[0]).toMatchObject({
      bookingId: 'booking-1',
      reservationId: 'reservation-1',
      status: 'booking_created',
    })
    expect(getNextItineraryQueueStep(reservedQueue).id).toBe(queue.items[0].id)

    const completedQueue = completeItineraryQueueItemByBookingId('booking-1', storage)
    expect(completedQueue.items[0].status).toBe('completed')
    expect(completedQueue.currentIndex).toBe(1)
    expect(getNextItineraryQueueStep(completedQueue).id).toBe(queue.items[1].id)
    expect(getItineraryQueueProgress(completedQueue)).toMatchObject({
      completed: 1,
      isComplete: false,
      nextIndex: 1,
      remaining: 1,
      total: 2,
    })
  })
})
