'use strict';

const { Prisma } = require('@prisma/client');
const { parseVndInteger } = require('../utils/money');

const { Decimal } = Prisma;
const FUNDING_SOURCES = new Set(['PLATFORM', 'PARTNER', 'SHARED']);

function financialError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function asVndDecimal(value, fieldName, { allowZero = true } = {}) {
  const parsed = parseVndInteger(value, { allowZero });
  if (parsed === null) {
    throw financialError(`${fieldName} phải là số nguyên VND hợp lệ.`);
  }
  return new Decimal(parsed);
}

function normalizeVoucherFunding(voucher) {
  if (!voucher) {
    return {
      fundingSource: null,
      platformFundingPercent: null,
    };
  }

  const fundingSource = String(voucher.fundingSource || 'PARTNER').toUpperCase();
  if (!FUNDING_SOURCES.has(fundingSource)) {
    throw financialError('Nguồn tài trợ voucher không hợp lệ.');
  }

  const defaultPercent = fundingSource === 'PLATFORM' ? 100 : 0;
  const platformFundingPercent = Number(
    voucher.platformFundingPercent ?? defaultPercent,
  );
  if (
    !Number.isSafeInteger(platformFundingPercent)
    || platformFundingPercent < 0
    || platformFundingPercent > 100
    || (fundingSource === 'PLATFORM' && platformFundingPercent !== 100)
    || (fundingSource === 'PARTNER' && platformFundingPercent !== 0)
    || (
      fundingSource === 'SHARED'
      && (platformFundingPercent < 1 || platformFundingPercent > 99)
    )
  ) {
    throw financialError('Tỷ lệ tài trợ voucher không khớp với nguồn tài trợ.');
  }

  return { fundingSource, platformFundingPercent };
}

function calculateBookingFinancials({
  subtotalAmount,
  discountAmount,
  commissionRate,
  voucher = null,
}) {
  const subtotal = asVndDecimal(subtotalAmount, 'Tạm tính', { allowZero: false });
  const discount = asVndDecimal(discountAmount, 'Giảm giá');
  if (discount.greaterThan(subtotal)) {
    throw financialError('Giảm giá không được vượt quá tạm tính.');
  }

  const rate = Number(commissionRate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw financialError('Tỷ lệ hoa hồng phải nằm trong khoảng từ 0 đến 1.');
  }

  const funding = normalizeVoucherFunding(voucher);
  const platformDiscountAmount = voucher
    ? discount
        .mul(funding.platformFundingPercent)
        .div(100)
        .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    : new Decimal(0);
  const partnerDiscountAmount = discount.minus(platformDiscountAmount);
  const commissionBaseAmount = subtotal.minus(partnerDiscountAmount);
  const commissionAmount = commissionBaseAmount
    .mul(rate)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const partnerNetAmount = commissionBaseAmount.minus(commissionAmount);
  const platformNetRevenue = commissionAmount.minus(platformDiscountAmount);

  return {
    totalAmount: subtotal.minus(discount),
    voucherFundingSourceSnapshot: funding.fundingSource,
    voucherPlatformFundingPercentSnapshot: funding.platformFundingPercent,
    platformDiscountAmountSnapshot: platformDiscountAmount,
    partnerDiscountAmountSnapshot: partnerDiscountAmount,
    commissionBaseAmountSnapshot: commissionBaseAmount,
    commissionAmountSnapshot: commissionAmount,
    partnerNetAmountSnapshot: partnerNetAmount,
    platformNetRevenueSnapshot: platformNetRevenue,
  };
}

module.exports = {
  calculateBookingFinancials,
  normalizeVoucherFunding,
};
