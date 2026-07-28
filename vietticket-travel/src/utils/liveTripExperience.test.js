import { describe, expect, it } from 'vitest'
import {
  formatMinuteOfDay,
  getLiveTripCommandState,
  getLiveTripProgress,
  getSimulationPresentation,
  hasOpenTripActivityWindow,
} from './liveTripExperience.js'

const NOW = new Date('2026-07-28T03:00:00.000Z')

describe('live trip experience', () => {
  it('prioritizes a READY SmartQueue over an Autopilot proposal', () => {
    const command = getLiveTripCommandState({
      items: [
        {
          id: 'proposal-item',
          snapshot: { title: 'Bảo tàng' },
          scheduledStart: '2026-07-28T05:00:00.000Z',
        },
        {
          id: 'ready-item',
          bookingId: 'booking-1',
          snapshot: { title: 'Du thuyền' },
          scheduledStart: '2026-07-28T03:15:00.000Z',
          smartQueue: {
            status: 'READY',
            readyExpiresAt: '2026-07-28T03:10:00.000Z',
            policy: { paused: false },
          },
        },
      ],
      proposals: [{
        id: 'proposal-1',
        liveTripItemId: 'proposal-item',
        status: 'PENDING',
        expiresAt: '2026-07-28T04:00:00.000Z',
      }],
    }, NOW)

    expect(command.kind).toBe('QUEUE_READY')
    expect(command.item.id).toBe('ready-item')
    expect(command.primaryHref).toContain('/tickets/booking-1')
  })

  it('freezes the visible countdown while a READY queue is paused', () => {
    const command = getLiveTripCommandState({
      items: [{
        id: 'ready-item',
        scheduledStart: '2026-07-28T03:15:00.000Z',
        smartQueue: {
          status: 'READY',
          readyExpiresAt: '2026-07-28T03:10:00.000Z',
          policy: { paused: true },
        },
      }],
    }, NOW)

    expect(command.kind).toBe('QUEUE_READY_PAUSED')
    expect(command.targetAt).toBeNull()
    expect(command.description).toMatch(/countdown/i)
  })

  it('never presents stale queue data as actionable after the trip closes', () => {
    const command = getLiveTripCommandState({
      items: [{
        id: 'item-closed',
        smartQueue: {
          status: 'READY',
          readyExpiresAt: '2099-03-10T09:00:00.000Z',
        },
      }],
      proposals: [{ id: 'proposal-closed', status: 'PENDING' }],
    }, new Date('2099-03-10T08:00:00.000Z'), { interactive: false })

    expect(command.kind).toBe('COMPLETE')
    expect(command.primaryHref).toBe('/journey')
  })

  it('ignores an expired pending proposal when choosing the next action', () => {
    const command = getLiveTripCommandState({
      items: [{
        id: 'future-item',
        scheduledStart: '2026-07-28T05:00:00.000Z',
      }],
      proposals: [{
        id: 'expired-proposal',
        liveTripItemId: 'future-item',
        status: 'PENDING',
        expiresAt: '2026-07-28T02:59:59.000Z',
      }],
    }, NOW)

    expect(command.kind).toBe('UPCOMING')
  })

  it('ignores an expired READY window instead of telling the guest to rush to the gate', () => {
    const command = getLiveTripCommandState({
      items: [{
        id: 'expired-ready',
        scheduledStart: '2026-07-28T05:00:00.000Z',
        smartQueue: {
          status: 'READY',
          readyExpiresAt: '2026-07-28T02:59:59.000Z',
        },
      }],
    }, NOW)

    expect(command.kind).toBe('UPCOMING')
    expect(command.title).not.toMatch(/đã gọi lượt/i)
  })

  it('does not keep a completed time window in the urgent command state', () => {
    const command = getLiveTripCommandState({
      items: [{
        id: 'finished-risk',
        status: 'AT_RISK',
        scheduledStart: '2026-07-28T01:00:00.000Z',
        scheduledEnd: '2026-07-28T02:00:00.000Z',
      }],
    }, NOW)

    expect(command.kind).toBe('COMPLETE')
  })

  it('locks trip actions once every activity is terminal or past its window', () => {
    expect(hasOpenTripActivityWindow({
      items: [
        { status: 'COMPLETED', scheduledEnd: '2026-07-28T04:00:00.000Z' },
        { status: 'PLANNED', scheduledEnd: '2026-07-28T02:00:00.000Z' },
      ],
    }, NOW)).toBe(false)
  })

  it('keeps trip actions available when a future activity remains', () => {
    expect(hasOpenTripActivityWindow({
      items: [
        { status: 'SKIPPED', scheduledEnd: '2026-07-28T04:00:00.000Z' },
        { status: 'PLANNED', scheduledEnd: '2026-07-29T02:00:00.000Z' },
      ],
    }, NOW)).toBe(true)
  })

  it('reports honest progress using only terminal activity states', () => {
    expect(getLiveTripProgress({
      items: [
        { status: 'COMPLETED' },
        { status: 'SKIPPED' },
        { status: 'AT_RISK' },
        { status: 'PLANNED' },
      ],
    })).toEqual({ completed: 2, total: 4, percent: 50 })
  })

  it('does not turn a missing queue ETA into a fabricated zero-minute promise', () => {
    const command = getLiveTripCommandState({
      items: [{
        id: 'waiting-item',
        smartQueue: {
          status: 'WAITING',
          estimatedWaitMinutes: null,
          guestsAhead: 4,
        },
      }],
    }, NOW)

    expect(command.kind).toBe('QUEUE_WAITING')
    expect(command.description).not.toMatch(/0 phút/)
    expect(command.description).toMatch(/đang đo/i)
  })

  it('recognizes optimizer fallback instead of presenting it as a success', () => {
    const presentation = getSimulationPresentation({
      algorithm_version: 'optimizer_unavailable_v1',
      baseline_score: 0,
      optimized_score: 0,
      proposals: [],
      constraints: { reason: 'ML_SERVICE_UNAVAILABLE', travel_buffer_minutes: 30 },
    })

    expect(presentation.fallback).toBe(true)
    expect(presentation.metricsAvailable).toBe(false)
    expect(presentation.failureReason).toBe('ML_SERVICE_UNAVAILABLE')
    expect(presentation.safeguards).toContain('Đệm di chuyển 30 phút')
  })

  it('sanitizes non-finite optimizer scores before presenting evidence', () => {
    const presentation = getSimulationPresentation({
      baseline_score: 'not-a-number',
      optimized_score: Number.POSITIVE_INFINITY,
      proposals: [],
      constraints: {},
    })

    expect(presentation.baseline).toBe(0)
    expect(presentation.optimized).toBe(0)
    expect(presentation.improvement).toBe(0)
    expect(presentation.metricsAvailable).toBe(false)
  })

  it('flags a regressing optimizer result instead of presenting it as an improvement', () => {
    const presentation = getSimulationPresentation({
      algorithm_version: 'constrained_local_search_v2',
      baseline_score: 80,
      optimized_score: 60,
      proposals: [{ item_id: 'item-1' }],
      constraints: {},
    })

    expect(presentation.hasRegression).toBe(true)
    expect(presentation.improvement).toBe(-20)
  })

  it('formats optimizer minute offsets without accepting invalid values', () => {
    expect(formatMinuteOfDay(495)).toBe('08:15')
    expect(formatMinuteOfDay(-1)).toBe('—')
  })
})
