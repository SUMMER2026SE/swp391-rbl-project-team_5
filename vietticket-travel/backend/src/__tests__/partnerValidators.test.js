const {
  isNonEmptyString,
  isValidTime,
  isValidDate,
  validateKyc,
  validateAttraction,
  validateTicket,
} = require('../utils/partnerValidators');

describe('helpers cơ bản', () => {
  test('isNonEmptyString', () => {
    expect(isNonEmptyString('a')).toBe(true);
    expect(isNonEmptyString('   ')).toBe(false);
    expect(isNonEmptyString('')).toBe(false);
    expect(isNonEmptyString(123)).toBe(false);
  });

  test('isValidTime (HH:MM 24h)', () => {
    expect(isValidTime('08:00')).toBe(true);
    expect(isValidTime('23:59')).toBe(true);
    expect(isValidTime('24:00')).toBe(false);
    expect(isValidTime('8:00')).toBe(false);
    expect(isValidTime('aa:bb')).toBe(false);
  });

  test('isValidDate (YYYY-MM-DD)', () => {
    expect(isValidDate('2026-06-15')).toBe(true);
    expect(isValidDate('2026-13-40')).toBe(false);
    expect(isValidDate('15-06-2026')).toBe(false);
  });
});

describe('validateKyc', () => {
  test('✅ Hợp lệ chỉ cần businessName', () => {
    expect(validateKyc({ businessName: 'Cty A' })).toBe('');
  });
  test('❌ Thiếu businessName', () => {
    expect(validateKyc({})).not.toBe('');
  });
  test('❌ businessName quá dài (>150)', () => {
    expect(validateKyc({ businessName: 'a'.repeat(151) })).not.toBe('');
  });
  test('❌ taxCode sai định dạng', () => {
    expect(validateKyc({ businessName: 'A', taxCode: '123' })).not.toBe('');
  });
  test('✅ taxCode 10 hoặc 13 chữ số', () => {
    expect(validateKyc({ businessName: 'A', taxCode: '0102030405' })).toBe('');
    expect(validateKyc({ businessName: 'A', taxCode: '0102030405123' })).toBe('');
  });
  test('❌ bankAccountNumber sai định dạng', () => {
    expect(validateKyc({ businessName: 'A', bankAccountNumber: '12a' })).not.toBe('');
  });
});

describe('validateAttraction', () => {
  const valid = { name: 'Suối Tiên', address: '120 Xa lộ', province: 'TP. HCM' };

  test('✅ Hợp lệ đầy đủ', () => {
    expect(validateAttraction(valid, { partial: false })).toBe('');
  });
  test('❌ Thiếu name', () => {
    expect(validateAttraction({ address: 'x', province: 'y' }, { partial: false })).not.toBe('');
  });
  test('❌ lat ngoài [-90, 90]', () => {
    expect(validateAttraction({ ...valid, lat: 200 })).not.toBe('');
  });
  test('❌ lng ngoài [-180, 180]', () => {
    expect(validateAttraction({ ...valid, lng: 999 })).not.toBe('');
  });
  test('❌ openTime sai định dạng', () => {
    expect(validateAttraction({ ...valid, openTime: '99:99' })).not.toBe('');
  });
  test('✅ partial: chỉ validate field có mặt', () => {
    expect(validateAttraction({ name: 'X' }, { partial: true })).toBe('');
  });
});

describe('validateTicket', () => {
  const valid = { name: 'Vé', originalPrice: 150000, sellingPrice: 120000 };

  test('✅ Hợp lệ', () => {
    expect(validateTicket(valid, { partial: false })).toBe('');
  });
  test('❌ Thiếu tên', () => {
    expect(validateTicket({ originalPrice: 100, sellingPrice: 50 }, { partial: false })).not.toBe('');
  });
  test('❌ originalPrice <= 0', () => {
    expect(validateTicket({ name: 'Vé', originalPrice: 0, sellingPrice: 0 })).not.toBe('');
  });
  test('❌ sellingPrice > originalPrice', () => {
    expect(validateTicket({ name: 'Vé', originalPrice: 100, sellingPrice: 200 })).not.toBe('');
  });
  test('❌ type không hợp lệ', () => {
    expect(validateTicket({ ...valid, type: 'VIP' })).not.toBe('');
  });
  test('✅ refundPolicy chấp nhận cả format portal lẫn DB', () => {
    expect(validateTicket({ refundPolicy: 'FULL' }, { partial: true })).toBe('');
    expect(validateTicket({ refundPolicy: 'FREE_CANCELLATION' }, { partial: true })).toBe('');
  });
  test('❌ refundPolicy sai', () => {
    expect(validateTicket({ refundPolicy: 'XXX' }, { partial: true })).not.toBe('');
  });
});
