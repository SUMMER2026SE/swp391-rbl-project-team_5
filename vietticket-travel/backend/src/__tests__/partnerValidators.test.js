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
  const license = 'http://localhost/api/upload/documents/user-1-license.pdf';
  const validKyc = {
    businessName: 'Cty A',
    businessLicenseUrl: license,
    taxCode: '0102030405',
    registrationDate: '2020-01-15',
    representativeName: 'Nguyen Van A',
    representativePhone: '0901234567',
    businessAddress: '1 Nguyen Hue, HCM',
    bankName: 'Vietcombank',
    branchName: 'HCM',
    bankAccountNumber: '0123456789',
    bankAccountName: 'NGUYEN VAN A',
    payoutCurrency: 'VND',
    kycConsentAccepted: true,
  };

  test('✅ Hợp lệ khi có tên doanh nghiệp, mã số thuế và giấy phép', () => {
    expect(validateKyc(validKyc)).toBe('');
  });
  test('❌ Thiếu businessName', () => {
    expect(validateKyc({})).not.toBe('');
  });
  test('❌ businessName quá dài (>150)', () => {
    expect(validateKyc({ businessName: 'a'.repeat(151), businessLicenseUrl: license })).not.toBe('');
  });
  test('❌ taxCode sai định dạng', () => {
    expect(validateKyc({ businessName: 'A', businessLicenseUrl: license, taxCode: '123' })).not.toBe('');
  });
  test('❌ taxCode là thông tin bắt buộc', () => {
    expect(validateKyc({ businessName: 'A', businessLicenseUrl: license })).toBe('Vui lòng nhập mã số thuế.');
  });
  test('✅ taxCode 10 hoặc 13 chữ số', () => {
    expect(validateKyc({ ...validKyc, taxCode: '0102030405' })).toBe('');
    expect(validateKyc({ ...validKyc, taxCode: '0102030405123' })).toBe('');
  });
  test('❌ bankAccountNumber sai định dạng', () => {
    expect(validateKyc({ ...validKyc, bankAccountNumber: '12a' })).not.toBe('');
  });
  test('rejects a missing legal representative or explicit KYC consent', () => {
    expect(validateKyc({ ...validKyc, representativeName: '' })).not.toBe('');
    expect(validateKyc({ ...validKyc, kycConsentAccepted: false })).not.toBe('');
  });
  test('rejects a future registration date', () => {
    expect(validateKyc({ ...validKyc, registrationDate: '2999-01-01' })).not.toBe('');
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
  test('validates professional visit metadata', () => {
    expect(validateAttraction({
      ...valid,
      recommendedVisitMinutes: 240,
      environment: 'OUTDOOR',
      isFullDay: false,
    })).toBe('');
    expect(validateAttraction({ ...valid, recommendedVisitMinutes: 10 })).not.toBe('');
    expect(validateAttraction({ ...valid, environment: 'UNKNOWN' })).not.toBe('');
    expect(validateAttraction({
      ...valid,
      recommendedVisitMinutes: 150,
      isFullDay: true,
    }, { partial: false })).toContain('ít nhất 360 phút');
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
  test('rejects fractional or non-finite VND prices', () => {
    expect(validateTicket({ ...valid, sellingPrice: 120000.5 })).not.toBe('');
    expect(validateTicket({ ...valid, sellingPrice: Number.POSITIVE_INFINITY })).not.toBe('');
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
  test('requires structured age or height rules for child tickets', () => {
    expect(validateTicket({ ...valid, type: 'CHILD' }, { partial: false })).toContain('tuổi hoặc chiều cao');
    expect(validateTicket({
      ...valid,
      type: 'CHILD',
      minAgeYears: 3,
      maxAgeYears: 11,
      maxHeightCm: 140,
      requiresAdult: true,
    }, { partial: false })).toBe('');
    expect(validateTicket({
      ...valid,
      type: 'CHILD',
      minAgeYears: 12,
      maxAgeYears: 3,
    }, { partial: false })).not.toBe('');
  });
});
