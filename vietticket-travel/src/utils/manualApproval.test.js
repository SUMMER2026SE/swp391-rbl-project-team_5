import { describe, expect, it } from 'vitest'
import {
  formatManualApprovalDeadline,
  getManualApprovalTiming,
} from './manualApproval.js'

describe('manual approval timing', () => {
  it('formats backend deadlines in Vietnam time', () => {
    expect(formatManualApprovalDeadline('2026-07-28T05:30:00.000Z')).toContain('12:30')
  })

  it('uses the exact backend deadline and detects overdue bookings', () => {
    const booking = {
      manualApproval: { approvalDeadline: '2026-07-28T05:30:00.000Z' },
    }

    expect(getManualApprovalTiming(
      booking,
      new Date('2026-07-28T05:00:00.000Z'),
    )).toMatchObject({
      isOverdue: false,
      remainingMs: 30 * 60 * 1000,
    })
    expect(getManualApprovalTiming(
      booking,
      new Date('2026-07-28T05:30:00.000Z'),
    ).isOverdue).toBe(true)
  })
})
