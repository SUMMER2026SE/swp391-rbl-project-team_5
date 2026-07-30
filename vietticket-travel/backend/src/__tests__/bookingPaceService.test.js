jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));

const {
  MIN_USABLE_PACE,
  buildCurveFromReservations,
  leadDaysBetween,
  paceAtLead,
} = require('../services/bookingPaceService');
const { blendDemandIndex, quotePrice } = require('../services/dynamicPricingService');

const DAY_MS = 24 * 60 * 60 * 1000;

function dateOnly(dateKey) {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

function addDays(dateKey, days) {
  return new Date(dateOnly(dateKey).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Sinh đơn cho `days` ngày tham quan; mỗi ngày có một đơn ở mỗi mốc lead trong
 * `leadPattern`, nên tỷ lệ tích lũy tại mốc L tính được bằng tay.
 */
function buildReservations({ days = 30, leadPattern = [1, 2, 3, 5, 10] } = {}) {
  const rows = [];
  for (let index = 0; index < days; index += 1) {
    const visitDateKey = addDays('2026-06-01', -(index + 1));
    for (const lead of leadPattern) {
      rows.push({
        date: dateOnly(visitDateKey),
        // Đặt lúc 10:00 giờ VN của ngày cách ngày đi `lead` ngày.
        createdAt: new Date(dateOnly(addDays(visitDateKey, -lead)).getTime() + 3 * 60 * 60 * 1000),
        quantity: 1,
        snapshotAdmissionCount: 1,
      });
    }
  }
  return rows;
}

describe('leadDaysBetween', () => {
  test('đếm theo ngày lịch giờ VN, không theo số giờ chênh lệch', () => {
    // Đặt lúc 23:00 giờ VN ngày 05/06 (16:00 UTC) cho chuyến ngày 06/06.
    const createdAt = new Date('2026-06-05T16:00:00.000Z');
    expect(leadDaysBetween(dateOnly('2026-06-06'), createdAt)).toBe(1);
  });

  test('đơn đặt sau ngày tham quan không tạo ra lead âm', () => {
    expect(leadDaysBetween(dateOnly('2026-06-01'), new Date('2026-06-09T03:00:00.000Z'))).toBe(0);
  });
});

describe('buildCurveFromReservations', () => {
  test('đường cong là tỷ lệ tích lũy và không tăng khi lùi xa ngày đi', () => {
    const curve = buildCurveFromReservations(buildReservations());

    expect(curve.learned).toBe(true);
    expect(curve.curve[0]).toBe(1);
    // 5 đơn/ngày với lead 1,2,3,5,10: ở mốc 3 ngày đã có 3 đơn (lead >= 3).
    expect(curve.curve[3]).toBeCloseTo(3 / 5, 5);
    expect(curve.curve[5]).toBeCloseTo(2 / 5, 5);
    expect(curve.curve[10]).toBeCloseTo(1 / 5, 5);
    expect(curve.curve[11]).toBe(0);

    for (let lead = 1; lead < 30; lead += 1) {
      expect(curve.curve[lead]).toBeLessThanOrEqual(curve.curve[lead - 1]);
    }
  });

  test('chưa đủ số ngày quan sát thì không dựng đường cong', () => {
    const curve = buildCurveFromReservations(buildReservations({ days: 5 }));
    expect(curve.learned).toBe(false);
    expect(curve.reason).toMatch(/Chưa đủ ngày lịch sử/);
  });

  test('một ngày bán gấp nhiều lần không kéo lệch hình dạng đường cong', () => {
    const rows = buildReservations();
    // Một ngày lễ: thêm 200 vé đặt sát ngày đi.
    rows.push({
      date: dateOnly('2026-05-20'),
      createdAt: new Date(dateOnly('2026-05-19').getTime() + 3 * 60 * 60 * 1000),
      quantity: 200,
      snapshotAdmissionCount: 1,
    });

    const curve = buildCurveFromReservations(rows);
    // Trung bình theo ngày nên mốc 3 ngày vẫn quanh 60%, không bị kéo về 0.
    expect(curve.curve[3]).toBeGreaterThan(0.5);
  });

  test('số chỗ tính theo suất vé, không theo số đơn', () => {
    const rows = buildReservations({ days: 25, leadPattern: [2] }).map((row, index) => (
      index % 2 === 0
        ? { ...row, quantity: 1, snapshotAdmissionCount: 4 } // gói gia đình
        : row
    ));
    const curve = buildCurveFromReservations(rows);
    expect(curve.learned).toBe(true);
    expect(curve.curve[2]).toBeCloseTo(1, 5);
  });
});

describe('paceAtLead', () => {
  const curve = buildCurveFromReservations(buildReservations());

  test('trả null khi đường cong chưa học được', () => {
    expect(paceAtLead({ learned: false, curve: [] }, 3)).toBeNull();
  });

  test('trả null khi tỷ lệ quá nhỏ để làm mẫu số', () => {
    // Ở mốc 11 ngày chưa ai đặt -> chia cho số này sẽ ra kết quả vô nghĩa.
    expect(paceAtLead(curve, 11)).toBeNull();
    expect(paceAtLead(curve, 3)).toBeGreaterThan(MIN_USABLE_PACE);
  });
});

describe('blendDemandIndex với đường cong đặt chỗ', () => {
  test('quy tồn kho hiện tại về tỷ lệ lấp đầy cuối dự kiến', () => {
    // Còn 2 ngày, thường lúc này đã bán 70%; hiện đã bán 63% -> dự kiến 90%.
    const result = blendDemandIndex({
      realizedRatio: 0.63,
      forecastRatio: 0.9,
      leadDays: 2,
      lookaheadDays: 14,
      paceShare: 0.7,
    });

    expect(result.projectedRatio).toBeCloseTo(0.9, 3);
    expect(result.demandIndex).toBeCloseTo(0.9, 3);
    expect(result.paceShare).toBe(0.7);
  });

  test('sát ngày đi, tồn kho thật quyết định thay vì dự báo', () => {
    const result = blendDemandIndex({
      realizedRatio: 0.35,
      forecastRatio: 0.95,
      leadDays: 1,
      lookaheadDays: 14,
      paceShare: 0.98,
    });

    // pace 98% nghĩa là gần như không còn đơn nào nữa: 35% là con số cuối cùng.
    expect(result.demandIndex).toBeLessThan(0.45);
    expect(result.signalSource).toBe('REALTIME_OCCUPANCY');
  });

  test('heuristic cũ làm loãng dự báo ở giữa kỳ, đường cong thì không', () => {
    const shared = { realizedRatio: 0.2, forecastRatio: 0.88, leadDays: 7, lookaheadDays: 14 };

    const heuristic = blendDemandIndex(shared);
    const withPace = blendDemandIndex({ ...shared, paceShare: 0.26 });

    // Cùng một dự báo 88%: cách cũ trả về ~54% (vùng trung tính, không làm gì),
    // cách mới nhận ra 20% đã bán ở mốc 26% nhịp bán là rất nhanh.
    expect(heuristic.demandIndex).toBeLessThan(0.6);
    expect(withPace.demandIndex).toBeGreaterThan(0.75);
  });

  test('không có đường cong thì giữ nguyên hành vi cũ', () => {
    const withoutPace = blendDemandIndex({
      realizedRatio: 0.2, forecastRatio: 0.8, leadDays: 7, lookaheadDays: 14,
    });
    const withNullPace = blendDemandIndex({
      realizedRatio: 0.2, forecastRatio: 0.8, leadDays: 7, lookaheadDays: 14, paceShare: null,
    });

    expect(withNullPace.demandIndex).toBe(withoutPace.demandIndex);
    expect(withNullPace.paceShare).toBeNull();
  });

  test('bất biến demandIndex >= realizedRatio vẫn đúng ở nhánh đường cong', () => {
    const result = blendDemandIndex({
      realizedRatio: 0.92,
      forecastRatio: 0.05,
      leadDays: 6,
      lookaheadDays: 14,
      paceShare: 0.3,
    });
    expect(result.demandIndex).toBeGreaterThanOrEqual(0.92);
  });
});

describe('quotePrice với đường cong đặt chỗ', () => {
  const POLICY = {
    enabled: true,
    mode: 'AUTO_APPLY',
    highDemandThreshold: 0.75,
    lowDemandThreshold: 0.35,
    maxSurchargePercent: 15,
    maxDiscountPercent: 15,
    priceFloorPercent: 80,
    priceCeilingPercent: 120,
    roundingStep: 1000,
    lookaheadDays: 14,
    minConfidence: 'MEDIUM',
  };

  test('ngày sắp kín không còn bị giảm giá vì tồn kho chưa đầy', () => {
    const base = {
      basePrice: 280000,
      policy: POLICY,
      realizedRatio: 0.24,
      forecastRatio: 0.92,
      forecastConfidence: 'HIGH',
      leadDays: 5,
    };

    const withoutPace = quotePrice(base);
    const withPace = quotePrice({ ...base, paceShare: 0.28 });

    // Cách cũ: 0.92×(5/14) + 0.24×(9/14) = 0.48 -> trung tính, không làm gì.
    expect(withoutPace.demandLevel).toBe('NORMAL');
    // Cách mới: 24% đã bán ở mốc nhịp 28% -> dự kiến gần kín -> phụ thu.
    expect(withPace.demandLevel).toBe('PEAK');
    expect(withPace.finalPrice).toBeGreaterThan(280000);
    expect(withPace.paceShare).toBe(0.28);
  });

  test('bán chậm hơn nhịp thường lệ thì mới thực sự là giờ vắng', () => {
    const quote = quotePrice({
      basePrice: 280000,
      policy: POLICY,
      realizedRatio: 0.05,
      forecastRatio: 0.4,
      forecastConfidence: 'HIGH',
      leadDays: 3,
      paceShare: 0.55,
    });

    // 5% đã bán trong khi bình thường đã 55% -> dự kiến chỉ ~9%.
    expect(quote.demandLevel).toBe('QUIET');
    expect(quote.finalPrice).toBeLessThan(280000);
  });
});
