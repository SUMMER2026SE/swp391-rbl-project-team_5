'use strict';

function formatBookingReference(value) {
  const id = String(value || '').trim();
  return id ? `VT-${id.slice(-12).toUpperCase()}` : '—';
}

module.exports = { formatBookingReference };
