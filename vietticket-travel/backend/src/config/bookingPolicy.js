'use strict';

const DEFAULT_MAX_TICKETS_PER_ORDER = 20;
const HARD_MAX_TICKETS_PER_ORDER = 100;

function readMaxTicketsPerOrder(value = process.env.MAX_TICKETS_PER_ORDER) {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_MAX_TICKETS_PER_ORDER;
  }
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed)
    || parsed < 1
    || parsed > HARD_MAX_TICKETS_PER_ORDER
  ) {
    return DEFAULT_MAX_TICKETS_PER_ORDER;
  }
  return parsed;
}

const MAX_TICKETS_PER_ORDER = readMaxTicketsPerOrder();

module.exports = {
  DEFAULT_MAX_TICKETS_PER_ORDER,
  HARD_MAX_TICKETS_PER_ORDER,
  MAX_TICKETS_PER_ORDER,
  readMaxTicketsPerOrder,
};
