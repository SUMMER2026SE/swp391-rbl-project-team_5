import { describe, expect, it } from 'vitest'
import {
  buildJourneyOverview,
  getUpcomingBookings,
  isLiveTripOperable,
} from './journeyCenter.js'

const NOW = new Date('2026-07-27T02:00:00.000Z')

describe('journeyCenter', () => {
  it('prioritizes an open Rescue case over payment and Live Trip actions', () => {
    const overview = buildJourneyOverview({
      now: NOW,
      bookings: [{
        id: 'booking-1',
        reservationId: 'reservation-1',
        status: 'unpaid',
        visitDate: '2026-07-29',
        expiresAt: '2026-07-27T03:00:00.000Z',
      }],
      liveTrips: [{
        id: 'trip-1',
        status: 'ACTIVE',
        startDate: '2026-07-27',
        endDate: '2026-07-28',
      }],
      recoveryCases: [{ id: 'recovery-1', status: 'OPEN' }],
    })

    expect(overview.nextAction.href).toBe('/rescue/recovery-1')
    expect(overview.nextAction.tone).toBe('critical')
    expect(overview.counts.actionRequired).toBe(2)
  })

  it('prioritizes a READY SmartQueue signal for an operable trip', () => {
    const overview = buildJourneyOverview({
      now: NOW,
      liveTrips: [{
        id: 'trip-1',
        status: 'ACTIVE',
        startDate: '2026-07-27',
        endDate: '2026-07-27',
        items: [{ id: 'item-1', smartQueue: { status: 'READY' } }],
      }],
    })

    expect(overview.nextAction.href).toBe('/trip-mode/trip-1')
    expect(overview.nextAction.title).toContain('Đã đến lượt')
  })

  it('ranks a READY signal globally when an earlier trip only has a proposal', () => {
    const overview = buildJourneyOverview({
      now: NOW,
      liveTrips: [
        {
          id: 'trip-proposal',
          status: 'ACTIVE',
          startDate: '2026-07-27',
          endDate: '2026-07-28',
          proposals: [{ id: 'proposal-1', status: 'PENDING' }],
        },
        {
          id: 'trip-ready',
          status: 'ACTIVE',
          startDate: '2026-07-27',
          endDate: '2026-07-28',
          items: [{ id: 'item-ready', smartQueue: { status: 'READY' } }],
        },
      ],
    })

    expect(overview.nextAction.href).toBe('/trip-mode/trip-ready')
    expect(overview.nextAction.tone).toBe('success')
  })

  it('chooses the most urgent READY trip by its return-window deadline', () => {
    const overview = buildJourneyOverview({
      now: NOW,
      liveTrips: [
        {
          id: 'trip-later',
          status: 'ACTIVE',
          startDate: '2026-07-27',
          endDate: '2026-07-28',
          items: [{
            id: 'item-later',
            smartQueue: {
              status: 'READY',
              readyExpiresAt: '2026-07-27T05:00:00.000Z',
            },
          }],
        },
        {
          id: 'trip-sooner',
          status: 'ACTIVE',
          startDate: '2026-07-27',
          endDate: '2026-07-28',
          items: [{
            id: 'item-sooner',
            smartQueue: {
              status: 'READY',
              readyExpiresAt: '2026-07-27T03:00:00.000Z',
            },
          }],
        },
      ],
    })

    expect(overview.nextAction.href).toBe('/trip-mode/trip-sooner')
  })

  it('does not surface expired proposals or queue windows as actionable signals', () => {
    const overview = buildJourneyOverview({
      now: NOW,
      liveTrips: [{
        id: 'trip-expired',
        status: 'ACTIVE',
        startDate: '2026-07-27',
        endDate: '2026-07-28',
        proposals: [{
          id: 'proposal-expired',
          status: 'PENDING',
          expiresAt: '2026-07-27T01:59:00.000Z',
        }],
        items: [{
          id: 'item-expired',
          smartQueue: {
            status: 'READY',
            readyExpiresAt: '2026-07-27T01:59:00.000Z',
          },
        }],
      }],
    })

    expect(overview.nextAction.title).toBe('Theo dõi hành trình theo thời gian thực')
    expect(overview.nextAction.tone).toBe('live')
    expect(overview.counts.actionRequired).toBe(0)
  })

  it('does not resurrect an at-risk activity after its scheduled window ended', () => {
    const overview = buildJourneyOverview({
      now: NOW,
      liveTrips: [{
        id: 'trip-finished-risk',
        status: 'ACTIVE',
        startDate: '2026-07-27',
        endDate: '2026-07-28',
        items: [{
          id: 'item-finished-risk',
          status: 'AT_RISK',
          scheduledEnd: '2026-07-27T01:59:00.000Z',
        }],
      }],
    })

    expect(overview.nextAction.title).toBe('Theo dõi hành trình theo thời gian thực')
    expect(overview.counts.actionRequired).toBe(0)
  })

  it('keeps actionable signals from a fourth or later active trip', () => {
    const plainTrip = (id) => ({
      id,
      status: 'ACTIVE',
      startDate: '2026-07-27',
      endDate: '2026-07-28',
      items: [],
    })
    const overview = buildJourneyOverview({
      now: NOW,
      liveTrips: [
        plainTrip('trip-1'),
        plainTrip('trip-2'),
        plainTrip('trip-3'),
        {
          ...plainTrip('trip-4'),
          items: [{ id: 'item-ready', smartQueue: { status: 'READY' } }],
        },
      ],
    })

    expect(overview.nextAction.href).toBe('/trip-mode/trip-4')
  })

  it('does not expose a past ACTIVE trip as operable', () => {
    expect(isLiveTripOperable({
      status: 'ACTIVE',
      startDate: '2026-07-24',
      endDate: '2026-07-24',
    }, NOW)).toBe(false)
  })

  it('sorts non-terminal future bookings by visit date', () => {
    const result = getUpcomingBookings([
      { id: 'late', status: 'confirmed', visitDate: '2026-08-01' },
      { id: 'past', status: 'confirmed', visitDate: '2026-07-20' },
      { id: 'early', status: 'pending_partner', visitDate: '2026-07-28' },
      { id: 'done', status: 'completed', visitDate: '2026-07-29' },
    ], NOW)

    expect(result.map((booking) => booking.id)).toEqual(['early', 'late'])
  })
})
