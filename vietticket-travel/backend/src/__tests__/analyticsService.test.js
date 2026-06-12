const {
  buildTimeline,
  getPeriodStart,
  normalizePeriod,
} = require('../services/analyticsService');

describe('analyticsService', () => {
  it('normalizes unsupported periods', () => {
    expect(normalizePeriod('quarter')).toBe('month');
  });

  it('builds a seven-day report and aggregates revenue', () => {
    const now = new Date('2026-06-12T12:00:00.000Z');
    const rows = [
      { createdAt: new Date('2026-06-12T03:00:00.000Z'), amount: 100 },
      { createdAt: new Date('2026-06-12T08:00:00.000Z'), amount: 250 },
    ];

    const timeline = buildTimeline(rows, 'week', (row) => row.amount, now);

    expect(timeline).toHaveLength(7);
    expect(timeline.at(-1)).toEqual(
      expect.objectContaining({ label: '12/6', revenue: 350, bookings: 2 }),
    );
  });

  it('uses the first day of the year in Vietnam for yearly reports', () => {
    expect(getPeriodStart('year', new Date('2026-06-12T00:00:00.000Z')).toISOString())
      .toBe('2025-12-31T17:00:00.000Z');
  });
});
