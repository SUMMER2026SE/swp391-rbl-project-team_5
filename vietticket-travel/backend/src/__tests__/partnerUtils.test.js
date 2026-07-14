const {
  attractionStatusFromClient,
  refundPolicyFromClient,
} = require('../utils/partnerMappers');
const { validateKyc, validateTicket } = require('../utils/partnerValidators');

describe('partner mappings and validation', () => {
  test('inactive attraction trở về DRAFT, không dùng SUSPENDED', () => {
    expect(attractionStatusFromClient('inactive')).toBe('DRAFT');
  });

  test('refund policy chấp nhận cả format portal và format database', () => {
    expect(validateTicket({ refundPolicy: 'FULL' }, { partial: true })).toBe('');
    expect(validateTicket(
      { refundPolicy: 'FREE_CANCELLATION' },
      { partial: true },
    )).toBe('');
    expect(refundPolicyFromClient('FULL')).toBe('FREE_CANCELLATION');
    expect(refundPolicyFromClient('FREE_CANCELLATION')).toBe('FREE_CANCELLATION');
  });

  test('KYC requires a tax code', () => {
    expect(validateKyc({
      businessName: 'VietTicket Partner',
      businessLicenseUrl: 'http://localhost/api/upload/documents/user-1-license.pdf',
    })).toBe('Vui lòng nhập mã số thuế.');
  });

  test.each(['0312345678', '0312345678123'])(
    'KYC accepts a valid %s tax code',
    (taxCode) => {
      expect(validateKyc({
        businessName: 'VietTicket Partner',
        taxCode,
        businessLicenseUrl: 'http://localhost/api/upload/documents/user-1-license.pdf',
      })).toBe('');
    },
  );

  test.each(['031234567', '03123456789', '0312345678A'])(
    'KYC rejects an invalid %s tax code',
    (taxCode) => {
      expect(validateKyc({
        businessName: 'VietTicket Partner',
        taxCode,
        businessLicenseUrl: 'http://localhost/api/upload/documents/user-1-license.pdf',
      })).toBe('Mã số thuế phải gồm 10 hoặc 13 chữ số.');
    },
  );
});
