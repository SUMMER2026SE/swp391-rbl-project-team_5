'use strict';

const DEFAULT_MAX_TICKETS_PER_ORDER = 20;
const HARD_MAX_TICKETS_PER_ORDER = 100;
const DEFAULT_APPROVED_VNPAY_WINDOW_MINUTES = 60;
const DEFAULT_MANUAL_APPROVAL_MIN_LEAD_MINUTES = 180;

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

function boundedMinutes(value, fallback, min, max) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback;
}

function getApprovedVnpayWindowMs(
  value = process.env.APPROVED_VNPAY_WINDOW_MINUTES,
) {
  return boundedMinutes(
    value,
    DEFAULT_APPROVED_VNPAY_WINDOW_MINUTES,
    15,
    24 * 60,
  ) * 60 * 1000;
}

function getManualApprovalMinLeadMs(
  value = process.env.MANUAL_APPROVAL_MIN_LEAD_MINUTES,
) {
  return boundedMinutes(
    value,
    DEFAULT_MANUAL_APPROVAL_MIN_LEAD_MINUTES,
    30,
    7 * 24 * 60,
  ) * 60 * 1000;
}
const CUSTOMER_BOOKING_CHANGE_POLICY = Object.freeze({
  cancellationScope: 'WHOLE_BOOKING',
  partialCancellationSupported: false,
  visitDateChangeSupported: false,
  timeSlotChangeSupported: false,
  ticketProductChangeSupported: false,
  recoveryReplacementIsOperationalException: true,
});

module.exports = {
  CUSTOMER_BOOKING_CHANGE_POLICY,
  DEFAULT_APPROVED_VNPAY_WINDOW_MINUTES,
  DEFAULT_MANUAL_APPROVAL_MIN_LEAD_MINUTES,
  DEFAULT_MAX_TICKETS_PER_ORDER,
  HARD_MAX_TICKETS_PER_ORDER,
  MAX_TICKETS_PER_ORDER,
  getApprovedVnpayWindowMs,
  getManualApprovalMinLeadMs,
  readMaxTicketsPerOrder,
};
