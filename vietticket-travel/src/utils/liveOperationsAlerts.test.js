import { describe, expect, it } from 'vitest'
import { getLiveOperationAlert } from './liveOperationsAlerts.js'

describe('live operations alerts', () => {
  it('maps a queue-ready event to an urgent, navigable customer alert', () => {
    expect(getLiveOperationAlert({
      tripId: 'trip 1',
      itemId: 'item-1',
      reason: 'QUEUE_READY',
    })).toMatchObject({
      reason: 'QUEUE_READY',
      urgent: true,
      toastType: 'success',
      href: '/trip-mode/trip%201',
    })
  })

  it('ignores unknown or unscoped socket events', () => {
    expect(getLiveOperationAlert({ tripId: 'trip-1', reason: 'UNKNOWN' })).toBeNull()
    expect(getLiveOperationAlert({ reason: 'QUEUE_READY' })).toBeNull()
  })

  it.each([
    ['QUEUE_NO_SHOW', 'warning', true],
    ['QUEUE_EXPIRED', 'warning', true],
    ['QUEUE_BOOKING_INVALIDATED', 'error', true],
    ['AUTOPILOT_EXPIRED', 'warning', true],
    ['ITEM_AT_RISK', 'error', true],
  ])('maps terminal/risk event %s to an urgent customer alert', (reason, toastType, urgent) => {
    expect(getLiveOperationAlert({
      tripId: 'trip-1',
      itemId: 'item-1',
      reason,
    })).toMatchObject({
      reason,
      toastType,
      urgent,
      href: '/trip-mode/trip-1',
      tag: `vietticket-live:trip-1:item-1:${reason}`,
    })
  })

  it('keeps non-urgent lifecycle events navigable without escalating them', () => {
    expect(getLiveOperationAlert({
      tripId: 'trip-1',
      reason: 'ITEM_COMPLETED',
    })).toMatchObject({
      reason: 'ITEM_COMPLETED',
      toastType: 'success',
      urgent: false,
      itemId: null,
    })
  })
})
