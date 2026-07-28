const {
  getInventoryUnits,
  getProductAdmissionCount,
  getSnapshotAdmissionCount,
  toSellableTicketCount,
  validateAdmissionCount,
} = require('../utils/ticketCapacity');

describe('ticketCapacity', () => {
  test('vé cá nhân luôn đại diện đúng một khách', () => {
    expect(validateAdmissionCount('ADULT', 1)).toBe('');
    expect(validateAdmissionCount('CHILD', 2)).toMatch(/chỉ được áp dụng cho 1 khách/i);
  });

  test('vé FAMILY/GROUP bắt buộc có ít nhất hai khách trên mỗi gói', () => {
    expect(validateAdmissionCount('FAMILY', undefined)).toMatch(/phải khai báo/i);
    expect(validateAdmissionCount('GROUP', 1)).toMatch(/ít nhất 2 khách/i);
    expect(validateAdmissionCount('FAMILY', 4)).toBe('');
  });

  test('không bán sản phẩm gói có cấu hình sức chứa cũ hoặc sai', () => {
    expect(() => getProductAdmissionCount({ type: 'FAMILY', admissionCount: 1 }))
      .toThrow(/ít nhất 2 khách/i);
    expect(getProductAdmissionCount({ type: 'GROUP', admissionCount: 12 })).toBe(12);
  });

  test('snapshot giữ nguyên số khách dù cấu hình sản phẩm thay đổi', () => {
    const reservation = {
      quantity: 2,
      snapshotAdmissionCount: 4,
      ticketProduct: { admissionCount: 6 },
    };
    expect(getSnapshotAdmissionCount(reservation)).toBe(4);
    expect(getInventoryUnits(reservation)).toBe(8);
  });

  test('quy đổi sức chứa khách thành số gói có thể bán và không bán lẻ gói', () => {
    expect(toSellableTicketCount(11, 4)).toBe(2);
    expect(toSellableTicketCount(3, 4)).toBe(0);
  });
});
