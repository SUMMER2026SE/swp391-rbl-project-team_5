'use strict';

const VN_OFFSET_MINUTES = 7 * 60;
const MANUAL_APPROVAL_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function toDateKey(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function parseTime(value) {
  const match = String(value || '').match(TIME_PATTERN);
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function vietnamDateTimeToUtc(dateValue, timeValue) {
  const dateKey = toDateKey(dateValue);
  const time = parseTime(timeValue);
  if (!dateKey || !time) return null;

  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(
    year,
    month - 1,
    day,
    time.hour,
    time.minute - VN_OFFSET_MINUTES,
  ));
}

function parseSnapshotSlotLabel(label) {
  const parts = String(label || '').split(/\s*[-\u2013\u2014]\s*/u).map((part) => part.trim());
  if (parts.length < 2) return { startTime: null, endTime: null };
  return {
    startTime: parseTime(parts[0]) ? parts[0] : null,
    endTime: parseTime(parts[parts.length - 1]) ? parts[parts.length - 1] : null,
  };
}

function getActivityWindow({
  date,
  timeSlot = null,
  attraction = null,
  snapshotTimeSlotLabel = null,
} = {}) {
  const snapshotSlot = parseSnapshotSlotLabel(snapshotTimeSlotLabel);
  const startTime = timeSlot?.startTime
    || snapshotSlot.startTime
    || attraction?.openTime
    || '00:00';
  const endTime = timeSlot?.endTime
    || snapshotSlot.endTime
    || attraction?.closeTime
    || '23:59';

  return {
    startsAt: vietnamDateTimeToUtc(date, startTime),
    endsAt: vietnamDateTimeToUtc(date, endTime),
    startTime,
    endTime,
  };
}

function getBookingActivityWindow(booking) {
  const reservation = booking?.reservation || {};
  return getActivityWindow({
    date: booking?.snapshotVisitDate || reservation.date,
    timeSlot: reservation.timeSlot,
    attraction: reservation.ticketProduct?.attraction,
    snapshotTimeSlotLabel: booking?.snapshotTimeSlotLabel,
  });
}

function getManualApprovalDeadline(
  booking,
  timeoutMs = MANUAL_APPROVAL_TIMEOUT_MS,
) {
  const successfulPayments = Array.isArray(booking?.payments)
    ? booking.payments.filter((payment) => payment.status === 'SUCCESS' && !payment.isDuplicate)
    : [];
  const paymentTimes = successfulPayments
    .map((payment) => new Date(payment.paidAt || payment.createdAt).getTime())
    .filter(Number.isFinite);
  if (paymentTimes.length === 0) return null;

  const paymentDeadline = new Date(Math.min(...paymentTimes) + timeoutMs);
  const { startsAt } = getBookingActivityWindow(booking);
  if (!startsAt) return paymentDeadline;
  return startsAt < paymentDeadline ? startsAt : paymentDeadline;
}

function isBookingCutoffPassed({ date, timeSlot, attraction, now = new Date() }) {
  const { startsAt } = getActivityWindow({ date, timeSlot, attraction });
  return !startsAt || now >= startsAt;
}

function getCheckinTimeBlockReason(booking, now = new Date()) {
  const { startsAt, endsAt, startTime, endTime } = getBookingActivityWindow(booking);
  if (!startsAt || !endsAt) return 'Không xác định được thời gian hiệu lực của vé.';
  if (now < startsAt) return `Vé chỉ bắt đầu có hiệu lực từ ${startTime}.`;
  if (now > endsAt) return `Khung giờ sử dụng vé đã kết thúc lúc ${endTime}.`;
  return null;
}

module.exports = {
  MANUAL_APPROVAL_TIMEOUT_MS,
  VN_OFFSET_MINUTES,
  getActivityWindow,
  getBookingActivityWindow,
  getCheckinTimeBlockReason,
  getManualApprovalDeadline,
  isBookingCutoffPassed,
  parseSnapshotSlotLabel,
  parseTime,
  toDateKey,
  vietnamDateTimeToUtc,
};
