import { describe, expect, it } from 'vitest'
import { getTicketEligibilityLabel, getTicketTypeLabel } from './ticketType.js'

describe('ticket type display', () => {
  it('uses the dedicated student label', () => {
    expect(getTicketTypeLabel('STUDENT')).toBe('Vé học sinh / sinh viên')
  })

  it('shows structured child eligibility instead of a generic age hint', () => {
    expect(getTicketEligibilityLabel({
      type: 'CHILD',
      minHeightCm: 100,
      maxHeightCm: 140,
      requiresAdult: true,
    })).toBe('Áp dụng cho khách cao 100-140 cm, phải đi cùng người lớn')
  })

  it('warns when a child ticket has no structured eligibility', () => {
    expect(getTicketEligibilityLabel({ type: 'CHILD' })).toContain(
      'Chưa có điều kiện tuổi/chiều cao',
    )
  })
})
