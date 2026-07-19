const {
  DEFAULT_MAX_TICKETS_PER_ORDER,
  readMaxTicketsPerOrder,
} = require('../config/bookingPolicy');

describe('bookingPolicy', () => {
  test('mặc định giới hạn 20 vé mỗi đơn', () => {
    expect(readMaxTicketsPerOrder(undefined)).toBe(DEFAULT_MAX_TICKETS_PER_ORDER);
    expect(DEFAULT_MAX_TICKETS_PER_ORDER).toBe(20);
  });

  test('cho phép cấu hình trong hard range', () => {
    expect(readMaxTicketsPerOrder('35')).toBe(35);
  });

  test.each(['0', '101', '1.5', 'not-a-number'])(
    'cấu hình không an toàn %p quay về mặc định',
    (value) => {
      expect(readMaxTicketsPerOrder(value)).toBe(DEFAULT_MAX_TICKETS_PER_ORDER);
    },
  );
});
