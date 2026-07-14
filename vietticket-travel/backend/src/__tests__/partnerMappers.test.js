const {
  attractionStatusToClient,
  attractionStatusFromClient,
  ticketStatusToClient,
  ticketStatusFromClient,
  refundPolicyToClient,
  refundPolicyFromClient,
  decimalToNumber,
  formatHours,
  primaryImageUrl,
  toAttractionListItem,
  toAttractionDetail,
  toTicket,
  toTimeSlot,
} = require('../utils/partnerMappers');

describe('chuyển đổi trạng thái', () => {
  test('attractionStatusToClient', () => {
    expect(attractionStatusToClient('APPROVED')).toBe('active');
    expect(attractionStatusToClient('DRAFT')).toBe('inactive');
    expect(attractionStatusToClient('PENDING')).toBe('inactive');
  });
  test('attractionStatusFromClient (inactive -> DRAFT, không dùng SUSPENDED)', () => {
    expect(attractionStatusFromClient('active')).toBe('APPROVED');
    expect(attractionStatusFromClient('inactive')).toBe('DRAFT');
  });
  test('ticketStatus', () => {
    expect(ticketStatusToClient('ACTIVE')).toBe('active');
    expect(ticketStatusToClient('INACTIVE')).toBe('inactive');
    expect(ticketStatusFromClient('active')).toBe('ACTIVE');
    expect(ticketStatusFromClient('inactive')).toBe('INACTIVE');
  });
});

describe('refundPolicy mapping', () => {
  test('toClient', () => {
    expect(refundPolicyToClient('NON_REFUNDABLE')).toBe('NONE');
    expect(refundPolicyToClient('REFUND_WITH_FEE')).toBe('PARTIAL');
    expect(refundPolicyToClient('FREE_CANCELLATION')).toBe('FULL');
    expect(refundPolicyToClient('UNKNOWN')).toBe('NONE');
  });
  test('fromClient chấp nhận cả 2 format', () => {
    expect(refundPolicyFromClient('NONE')).toBe('NON_REFUNDABLE');
    expect(refundPolicyFromClient('PARTIAL')).toBe('REFUND_WITH_FEE');
    expect(refundPolicyFromClient('FULL')).toBe('FREE_CANCELLATION');
    expect(refundPolicyFromClient('FREE_CANCELLATION')).toBe('FREE_CANCELLATION');
    expect(refundPolicyFromClient('rác')).toBe('NON_REFUNDABLE');
  });
});

describe('tiện ích', () => {
  test('decimalToNumber', () => {
    expect(decimalToNumber(null)).toBe(0);
    expect(decimalToNumber(undefined)).toBe(0);
    expect(decimalToNumber('120000')).toBe(120000);
  });
  test('formatHours', () => {
    expect(formatHours('08:00', '17:00')).toBe('08:00 - 17:00');
    expect(formatHours('', '')).toBe('');
  });
  test('primaryImageUrl ưu tiên ảnh isPrimary', () => {
    expect(primaryImageUrl([])).toBeNull();
    expect(primaryImageUrl([{ imageUrl: 'a', isPrimary: false }, { imageUrl: 'b', isPrimary: true }])).toBe('b');
    expect(primaryImageUrl([{ imageUrl: 'a', isPrimary: false }])).toBe('a');
  });
});

describe('bộ chuyển đổi bản ghi', () => {
  test('toAttractionListItem', () => {
    const item = toAttractionListItem({
      id: 'attr-001', title: 'Suối Tiên', city: 'TP. HCM', district: 'Thủ Đức',
      openTime: '08:00', closeTime: '17:00', status: 'APPROVED',
      categories: [{ category: { name: 'Công viên' } }],
      images: [{ imageUrl: 'http://h/a.jpg', isPrimary: true }],
    });
    expect(item).toEqual(expect.objectContaining({
      id: 'attr-001', name: 'Suối Tiên', category: 'Công viên',
      hours: '08:00 - 17:00', status: 'active', image: 'http://h/a.jpg',
    }));
  });

  test('toAttractionDetail', () => {
    const detail = toAttractionDetail({
      id: 'attr-001', title: 'Suối Tiên', description: 'desc', city: 'TP. HCM',
      address: '120 Xa lộ', latitude: 10.86, longitude: 106.8, status: 'DRAFT',
      categories: [{ category: { name: 'Công viên' } }],
      images: [{ id: 'img-1', imageUrl: 'http://h/a.jpg', isPrimary: true }],
    });
    expect(detail).toEqual(expect.objectContaining({
      id: 'attr-001', name: 'Suối Tiên', province: 'TP. HCM',
      lat: '10.86', lng: '106.8', status: 'inactive', category: 'Công viên',
    }));
    expect(detail.images[0]).toEqual({ id: 'img-1', url: 'http://h/a.jpg', isPrimary: true });
  });

  test('toTicket', () => {
    const t = toTicket({
      id: 'tkt-001', name: 'Vé', type: 'ADULT', description: 'desc',
      originalPrice: '150000', sellingPrice: '120000',
      refundPolicy: 'FREE_CANCELLATION', status: 'ACTIVE',
    });
    expect(t).toEqual({
      id: 'tkt-001', name: 'Vé', type: 'ADULT', description: 'desc',
      originalPrice: 150000,
      sellingPrice: 120000,
      refundPolicy: 'FULL',
      refundFeeRate: 0,
      refundCutoffHours: 24,
      status: 'active',
    });
  });

  test('toTimeSlot', () => {
    expect(toTimeSlot({ id: 's-1', startTime: '08:00', endTime: '11:00', maxCapacity: 100, isActive: true }))
      .toEqual({ id: 's-1', start: '08:00', end: '11:00', capacity: 100, isActive: true });
  });
});
