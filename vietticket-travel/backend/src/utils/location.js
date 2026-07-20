'use strict';

function comparable(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(thanh pho|tp\.?|city)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function canonicalizeCity(value) {
  const raw = String(value || '').trim();
  const key = comparable(raw);
  if (['ho chi minh', 'hcm', 'sai gon'].includes(key)) return 'Thành phố Hồ Chí Minh';
  return raw;
}

function formatLocation({ address, district, city, country = '' } = {}) {
  const parts = [];
  [address, district, canonicalizeCity(city), country].forEach((value) => {
    const part = String(value || '').trim();
    const key = comparable(part);
    if (!part || !key) return;
    const isDuplicate = parts.some((existing) => {
      const existingKey = comparable(existing);
      return existingKey === key || existingKey.includes(key) || key.includes(existingKey);
    });
    if (!isDuplicate) parts.push(part);
  });
  return parts.join(', ');
}

module.exports = { canonicalizeCity, formatLocation };
