const {
  MAX_VND_AMOUNT,
  MIN_VNPAY_AMOUNT,
  parseVndInteger,
} = require('../utils/money');

describe('integer VND invariant', () => {
  test('accepts safe positive integer VND within database range', () => {
    expect(parseVndInteger(MIN_VNPAY_AMOUNT)).toBe(5000);
    expect(parseVndInteger(String(MAX_VND_AMOUNT))).toBe(MAX_VND_AMOUNT);
  });

  test.each([1000.5, '10.25', Infinity, Number.MAX_SAFE_INTEGER, MAX_VND_AMOUNT + 1])(
    'rejects unsafe VND amount %p',
    (value) => {
      expect(parseVndInteger(value)).toBeNull();
    },
  );

  test('zero is accepted only for explicitly zero-capable money fields', () => {
    expect(parseVndInteger(0)).toBeNull();
    expect(parseVndInteger(0, { allowZero: true })).toBe(0);
  });
});
