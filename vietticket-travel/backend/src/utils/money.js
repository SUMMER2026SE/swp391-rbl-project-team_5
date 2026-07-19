'use strict';

// PostgreSQL Decimal(12, 2) can store at most 9,999,999,999.99. VietTicket
// deliberately treats VND as an integer business currency, so the integer cap
// below is also safe to convert to a JavaScript Number.
const MAX_VND_AMOUNT = 9_999_999_999;
const MIN_VNPAY_AMOUNT = 5_000;

function parseVndInteger(value, { allowZero = false, max = MAX_VND_AMOUNT } = {}) {
  const amount = Number(value);
  const minimum = allowZero ? 0 : 1;
  if (
    !Number.isSafeInteger(amount)
    || amount < minimum
    || amount > max
  ) {
    return null;
  }
  return amount;
}

function isVndInteger(value, options) {
  return parseVndInteger(value, options) !== null;
}

module.exports = {
  MAX_VND_AMOUNT,
  MIN_VNPAY_AMOUNT,
  isVndInteger,
  parseVndInteger,
};
