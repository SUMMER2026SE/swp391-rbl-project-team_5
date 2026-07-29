'use strict';

const { Prisma } = require('@prisma/client');

const SUPPORTED_PAYOUT_CURRENCIES = Object.freeze(['VND', 'USD', 'EUR', 'SGD', 'THB']);
const SUPPORTED_PAYOUT_CURRENCY_SET = new Set(SUPPORTED_PAYOUT_CURRENCIES);

function normalizePayoutCurrency(value, fallback = 'VND') {
  const currency = String(value || fallback).trim().toUpperCase();
  return SUPPORTED_PAYOUT_CURRENCY_SET.has(currency) ? currency : null;
}

function parseExchangeRates(raw = process.env.PAYOUT_EXCHANGE_RATES) {
  if (!raw) return {};

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('PAYOUT_EXCHANGE_RATES must be a valid JSON object.');
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('PAYOUT_EXCHANGE_RATES must be a JSON object.');
  }

  return Object.fromEntries(Object.entries(parsed).map(([key, value]) => {
    const currency = normalizePayoutCurrency(key, '');
    const rate = Number(value);
    if (!currency || currency === 'VND' || !Number.isFinite(rate) || rate <= 0) {
      throw new Error(`Invalid payout exchange rate for ${key}.`);
    }
    return [currency, rate];
  }));
}

function getVndPerUnit(currency, rawRates = process.env.PAYOUT_EXCHANGE_RATES) {
  const normalized = normalizePayoutCurrency(currency);
  if (!normalized) return null;
  if (normalized === 'VND') return 1;
  return parseExchangeRates(rawRates)[normalized] || null;
}

function getExchangeRateEvidence(
  currency,
  {
    now = new Date(),
    source = process.env.PAYOUT_EXCHANGE_RATE_SOURCE,
    effectiveAt = process.env.PAYOUT_EXCHANGE_RATE_EFFECTIVE_AT,
    maxAgeHours = process.env.PAYOUT_EXCHANGE_RATE_MAX_AGE_HOURS,
  } = {},
) {
  const normalized = normalizePayoutCurrency(currency);
  if (!normalized) throw new Error('Unsupported payout currency.');
  if (normalized === 'VND') {
    return {
      source: 'BASE_CURRENCY',
      effectiveAt: now,
    };
  }
  const normalizedSource = String(source || '').trim();
  if (normalizedSource.length < 2 || normalizedSource.length > 120) {
    throw new Error('PAYOUT_EXCHANGE_RATE_SOURCE is required for foreign-currency payouts.');
  }
  const parsedEffectiveAt = new Date(effectiveAt || '');
  if (
    Number.isNaN(parsedEffectiveAt.getTime())
    || parsedEffectiveAt > new Date(now.getTime() + 5 * 60 * 1000)
  ) {
    throw new Error('PAYOUT_EXCHANGE_RATE_EFFECTIVE_AT must be a valid timestamp not in the future.');
  }
  const parsedMaxAge = Number(maxAgeHours || 168);
  const safeMaxAgeHours = Number.isFinite(parsedMaxAge) && parsedMaxAge > 0
    ? Math.min(parsedMaxAge, 24 * 31)
    : 168;
  if (now.getTime() - parsedEffectiveAt.getTime() > safeMaxAgeHours * 60 * 60 * 1000) {
    throw new Error(`Configured exchange rate is older than ${safeMaxAgeHours} hours.`);
  }
  return {
    source: normalizedSource,
    effectiveAt: parsedEffectiveAt,
  };
}

function convertVndAmount(value, currency, vndPerUnit) {
  const normalized = normalizePayoutCurrency(currency);
  if (!normalized || !Number.isFinite(Number(vndPerUnit)) || Number(vndPerUnit) <= 0) {
    throw new Error('A valid payout currency and exchange rate are required.');
  }
  const fractionDigits = normalized === 'VND' ? 0 : 2;
  return new Prisma.Decimal(value || 0)
    .div(new Prisma.Decimal(vndPerUnit))
    .toDecimalPlaces(fractionDigits, Prisma.Decimal.ROUND_HALF_UP);
}

module.exports = {
  SUPPORTED_PAYOUT_CURRENCIES,
  normalizePayoutCurrency,
  parseExchangeRates,
  getVndPerUnit,
  convertVndAmount,
  getExchangeRateEvidence,
};
