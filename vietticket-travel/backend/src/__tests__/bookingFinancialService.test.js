'use strict';

const {
  calculateBookingFinancials,
  normalizeVoucherFunding,
} = require('../services/bookingFinancialService');

function asStrings(result) {
  return Object.fromEntries(
    Object.entries(result).map(([key, value]) => [
      key,
      value && typeof value.toFixed === 'function' ? value.toFixed(0) : value,
    ]),
  );
}

describe('booking financial allocation', () => {
  test('voucher do nền tảng tài trợ không làm giảm tiền đối tác', () => {
    const result = asStrings(calculateBookingFinancials({
      subtotalAmount: 1_000_000,
      discountAmount: 100_000,
      commissionRate: 0.1,
      voucher: {
        fundingSource: 'PLATFORM',
        platformFundingPercent: 100,
      },
    }));

    expect(result).toEqual(expect.objectContaining({
      totalAmount: '900000',
      platformDiscountAmountSnapshot: '100000',
      partnerDiscountAmountSnapshot: '0',
      commissionBaseAmountSnapshot: '1000000',
      commissionAmountSnapshot: '100000',
      partnerNetAmountSnapshot: '900000',
      platformNetRevenueSnapshot: '0',
    }));
  });

  test('voucher do đối tác tài trợ giữ đúng công thức lịch sử', () => {
    const result = asStrings(calculateBookingFinancials({
      subtotalAmount: 1_000_000,
      discountAmount: 100_000,
      commissionRate: 0.1,
      voucher: {
        fundingSource: 'PARTNER',
        platformFundingPercent: 0,
      },
    }));

    expect(result).toEqual(expect.objectContaining({
      totalAmount: '900000',
      platformDiscountAmountSnapshot: '0',
      partnerDiscountAmountSnapshot: '100000',
      commissionBaseAmountSnapshot: '900000',
      commissionAmountSnapshot: '90000',
      partnerNetAmountSnapshot: '810000',
      platformNetRevenueSnapshot: '90000',
    }));
  });

  test('voucher đồng tài trợ luôn phân bổ đủ toàn bộ số tiền giảm', () => {
    const result = calculateBookingFinancials({
      subtotalAmount: 999_999,
      discountAmount: 99_999,
      commissionRate: 0.15,
      voucher: {
        fundingSource: 'SHARED',
        platformFundingPercent: 35,
      },
    });

    expect(
      result.platformDiscountAmountSnapshot
        .plus(result.partnerDiscountAmountSnapshot)
        .toFixed(0),
    ).toBe('99999');
  });

  test.each([
    [{ fundingSource: 'PLATFORM', platformFundingPercent: 99 }],
    [{ fundingSource: 'PARTNER', platformFundingPercent: 1 }],
    [{ fundingSource: 'SHARED', platformFundingPercent: 0 }],
    [{ fundingSource: 'SHARED', platformFundingPercent: 100 }],
    [{ fundingSource: 'UNKNOWN', platformFundingPercent: 0 }],
  ])('từ chối cấu hình tài trợ mâu thuẫn %#', (voucher) => {
    expect(() => normalizeVoucherFunding(voucher)).toThrow(
      /tài trợ voucher|nguồn tài trợ/i,
    );
  });
});
