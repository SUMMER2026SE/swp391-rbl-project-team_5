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

  test('taxCode là trường không bắt buộc trong KYC', () => {
    expect(validateKyc({
      businessName: 'VietTicket Partner',
      businessLicenseUrl: 'http://localhost/api/upload/documents/user-1-license.pdf',
    })).toBe('');
  });
});
