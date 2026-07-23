import { describe, expect, it } from 'vitest'
import {
  getPartnerAttractionLabel,
  getPartnerAttractionRows,
} from './partnerSmartQueue.js'

describe('partner SmartQueue helpers', () => {
  it('reads the partner attraction-list contract', () => {
    const attractions = [{ id: 'attraction-1', name: 'Bảo tàng', city: 'Hồ Chí Minh' }]

    expect(getPartnerAttractionRows({ attractions })).toEqual(attractions)
  })

  it('keeps compatibility with wrapped list responses', () => {
    const attractions = [{ id: 'attraction-1' }]

    expect(getPartnerAttractionRows({ data: attractions })).toEqual(attractions)
    expect(getPartnerAttractionRows({ attractions: null })).toEqual([])
  })

  it('uses the partner API name field and includes the city', () => {
    expect(getPartnerAttractionLabel({ name: 'Bảo tàng', city: 'Hồ Chí Minh' }))
      .toBe('Bảo tàng · Hồ Chí Minh')
    expect(getPartnerAttractionLabel({ title: 'Tên cũ' })).toBe('Tên cũ')
  })
})
