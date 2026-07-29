'use strict';

function maskPublicName(value) {
  const parts = String(value || '')
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
  if (parts.length === 0) return 'Khách hàng';
  return parts
    .map((part) => (
      part.length <= 1
        ? `${part[0] || ''}*`
        : `${part[0]}${'*'.repeat(Math.min(3, part.length - 1))}`
    ))
    .join(' ');
}

module.exports = { maskPublicName };
