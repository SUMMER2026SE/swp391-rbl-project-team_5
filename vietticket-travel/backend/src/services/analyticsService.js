const VALID_PERIODS = new Set(['week', 'month', 'year']);
const DAY_MS = 24 * 60 * 60 * 1000;

const vietnamPartsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function getVietnamParts(date = new Date()) {
  const parts = Object.fromEntries(
    vietnamPartsFormatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return { year: parts.year, month: parts.month, day: parts.day };
}

function vietnamMidnight(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day, -7));
}

function normalizePeriod(value) {
  return VALID_PERIODS.has(value) ? value : 'month';
}

function getPeriodStart(period, now = new Date()) {
  const normalized = normalizePeriod(period);
  const { year, month, day } = getVietnamParts(now);
  if (normalized === 'year') return vietnamMidnight(year, 1, 1);
  if (normalized === 'month') return vietnamMidnight(year, month, 1);
  return new Date(vietnamMidnight(year, month, day).getTime() - 6 * DAY_MS);
}

function bucketKey(date, period) {
  const { year, month, day } = getVietnamParts(date);
  return period === 'year'
    ? `${year}-${String(month).padStart(2, '0')}`
    : `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function buildEmptyTimeline(period, now = new Date()) {
  const normalized = normalizePeriod(period);
  const { year, month, day } = getVietnamParts(now);

  if (normalized === 'year') {
    return Array.from({ length: 12 }, (_, index) => ({
      key: `${year}-${String(index + 1).padStart(2, '0')}`,
      label: `T${index + 1}`,
      revenue: 0,
      bookings: 0,
    }));
  }

  if (normalized === 'month') {
    return Array.from({ length: day }, (_, index) => ({
      key: `${year}-${String(month).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`,
      label: String(index + 1),
      revenue: 0,
      bookings: 0,
    }));
  }

  const start = getPeriodStart('week', now);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start.getTime() + index * DAY_MS);
    const parts = getVietnamParts(date);
    return {
      key: bucketKey(date, 'week'),
      label: `${parts.day}/${parts.month}`,
      revenue: 0,
      bookings: 0,
    };
  });
}

function buildTimeline(rows, period, getRevenue, now = new Date()) {
  const normalized = normalizePeriod(period);
  const timeline = buildEmptyTimeline(normalized, now);
  const byKey = new Map(timeline.map((item) => [item.key, item]));

  for (const row of rows) {
    const item = byKey.get(bucketKey(new Date(row.createdAt), normalized));
    if (!item) continue;
    item.revenue += Number(getRevenue(row) || 0);
    item.bookings += 1;
  }

  return timeline.map((item) => ({
    label: item.label,
    revenue: item.revenue,
    bookings: item.bookings,
  }));
}

module.exports = {
  buildTimeline,
  getPeriodStart,
  normalizePeriod,
};
