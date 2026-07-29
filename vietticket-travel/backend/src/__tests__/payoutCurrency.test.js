const {
  convertVndAmount,
  getVndPerUnit,
  getExchangeRateEvidence,
  normalizePayoutCurrency,
  parseExchangeRates,
} = require('../utils/payoutCurrency');

describe('payout currency', () => {
  test('normalizes supported ISO currency codes', () => {
    expect(normalizePayoutCurrency(' usd ')).toBe('USD');
    expect(normalizePayoutCurrency('GBP', '')).toBeNull();
  });

  test('parses configured VND-per-unit exchange rates', () => {
    expect(parseExchangeRates('{"USD":26000,"EUR":30000}')).toEqual({
      USD: 26000,
      EUR: 30000,
    });
    expect(getVndPerUnit('VND', '{}')).toBe(1);
    expect(getVndPerUnit('USD', '{"USD":26000}')).toBe(26000);
  });

  test('rejects malformed or unsafe exchange rate configuration', () => {
    expect(() => parseExchangeRates('not-json')).toThrow(/JSON/);
    expect(() => parseExchangeRates('{"USD":0}')).toThrow(/USD/);
    expect(() => parseExchangeRates('{"GBP":32000}')).toThrow(/GBP/);
  });

  test('converts VND ledger amounts using an auditable fixed rate', () => {
    expect(Number(convertVndAmount(260000, 'USD', 26000))).toBe(10);
    expect(Number(convertVndAmount(100000, 'USD', 26000))).toBe(3.85);
    expect(Number(convertVndAmount(100001, 'VND', 1))).toBe(100001);
  });

  test('requires fresh source and effective time evidence for foreign exchange rates', () => {
    const now = new Date('2026-07-29T12:00:00.000Z');
    expect(getExchangeRateEvidence('USD', {
      now,
      source: 'State Bank reference',
      effectiveAt: '2026-07-29T00:00:00.000Z',
      maxAgeHours: 24,
    })).toEqual({
      source: 'State Bank reference',
      effectiveAt: new Date('2026-07-29T00:00:00.000Z'),
    });
    expect(() => getExchangeRateEvidence('USD', {
      now,
      source: 'State Bank reference',
      effectiveAt: '2026-07-20T00:00:00.000Z',
      maxAgeHours: 24,
    })).toThrow(/older than/);
  });
});
