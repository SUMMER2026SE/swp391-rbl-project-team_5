jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));

const {
  blendDemandIndex,
  demandToAdjustmentPercent,
  forecastConfidenceOf,
  normalizePolicy,
  occupancyRatio,
  quotePrice,
  roundWithinBounds,
  toPublicQuote,
} = require('../services/dynamicPricingService');

const BASE_POLICY = {
  enabled: true,
  mode: 'AUTO_APPLY',
  highDemandThreshold: 0.75,
  lowDemandThreshold: 0.35,
  maxSurchargePercent: 20,
  maxDiscountPercent: 20,
  priceFloorPercent: 80,
  priceCeilingPercent: 120,
  roundingStep: 1000,
  lookaheadDays: 14,
  minConfidence: 'MEDIUM',
};

function quote(overrides = {}) {
  return quotePrice({
    basePrice: 200000,
    policy: BASE_POLICY,
    realizedRatio: 0.5,
    forecastRatio: 0.5,
    forecastConfidence: 'HIGH',
    leadDays: 5,
    ...overrides,
  });
}

describe('normalizePolicy', () => {
  test('ép ngưỡng vắng xuống dưới ngưỡng đông khi hai vùng chồng lấn', () => {
    const policy = normalizePolicy({ highDemandThreshold: 0.6, lowDemandThreshold: 0.9 });
    expect(policy.lowDemandThreshold).toBeLessThan(policy.highDemandThreshold);
  });

  test('kẹp mọi tham số ngoài biên về khoảng hợp lệ', () => {
    const policy = normalizePolicy({
      maxSurchargePercent: 999,
      maxDiscountPercent: -50,
      priceFloorPercent: 0,
      priceCeilingPercent: 5000,
      lookaheadDays: 900,
      roundingStep: 0,
    });
    expect(policy.maxSurchargePercent).toBe(100);
    expect(policy.maxDiscountPercent).toBe(0);
    expect(policy.priceFloorPercent).toBe(1);
    expect(policy.priceCeilingPercent).toBe(300);
    expect(policy.lookaheadDays).toBe(60);
    expect(policy.roundingStep).toBe(1);
  });

  test('giá trị lạ ở mode và minConfidence rơi về mặc định an toàn', () => {
    const policy = normalizePolicy({ mode: 'HACK', minConfidence: 'ULTRA' });
    expect(policy.mode).toBe('SUGGEST_ONLY');
    expect(policy.minConfidence).toBe('MEDIUM');
  });
});

describe('blendDemandIndex', () => {
  test('còn xa ngày tham quan thì tin dự báo AI', () => {
    const result = blendDemandIndex({
      realizedRatio: 0,
      forecastRatio: 0.9,
      leadDays: 14,
      lookaheadDays: 14,
    });
    expect(result.demandIndex).toBeCloseTo(0.9, 5);
    expect(result.signalSource).toBe('AI_FORECAST');
  });

  test('đúng ngày tham quan thì chỉ tin số vé đã bán', () => {
    const result = blendDemandIndex({
      realizedRatio: 0.2,
      forecastRatio: 0.9,
      leadDays: 0,
      lookaheadDays: 14,
    });
    expect(result.demandIndex).toBeCloseTo(0.2, 5);
    expect(result.signalSource).toBe('REALTIME_OCCUPANCY');
  });

  test('vé đã bán là chặn dưới cứng: dự báo vắng không kéo tụt được nhu cầu thật', () => {
    const result = blendDemandIndex({
      realizedRatio: 0.95,
      forecastRatio: 0.1,
      leadDays: 10,
      lookaheadDays: 14,
    });
    expect(result.demandIndex).toBeCloseTo(0.95, 5);
  });

  test('không có dự báo thì rơi về mức lấp đầy thực tế', () => {
    const result = blendDemandIndex({
      realizedRatio: 0.4,
      forecastRatio: null,
      leadDays: 10,
      lookaheadDays: 14,
    });
    expect(result.demandIndex).toBeCloseTo(0.4, 5);
    expect(result.forecastWeight).toBe(0);
    expect(result.signalSource).toBe('REALTIME_OCCUPANCY');
  });
});

describe('demandToAdjustmentPercent', () => {
  const policy = normalizePolicy(BASE_POLICY);

  test('vùng trung tính không điều chỉnh', () => {
    expect(demandToAdjustmentPercent(0.5, policy)).toEqual({ percent: 0, demandLevel: 'NORMAL' });
  });

  test('ngay tại ngưỡng mức điều chỉnh bằng 0 nên giá không nhảy bậc', () => {
    expect(demandToAdjustmentPercent(0.75, policy).percent).toBeCloseTo(0, 5);
    expect(demandToAdjustmentPercent(0.35, policy).percent).toBeCloseTo(0, 5);
  });

  test('lấp đầy tuyệt đối đạt phụ thu tối đa', () => {
    const result = demandToAdjustmentPercent(1, policy);
    expect(result.demandLevel).toBe('PEAK');
    expect(result.percent).toBeCloseTo(20, 5);
  });

  test('không ai đặt thì đạt mức giảm tối đa', () => {
    const result = demandToAdjustmentPercent(0, policy);
    expect(result.demandLevel).toBe('QUIET');
    expect(result.percent).toBeCloseTo(-20, 5);
  });

  test('dốc tuyến tính: giữa ngưỡng và biên là một nửa mức tối đa', () => {
    expect(demandToAdjustmentPercent(0.875, policy).percent).toBeCloseTo(10, 5);
    expect(demandToAdjustmentPercent(0.175, policy).percent).toBeCloseTo(-10, 5);
  });
});

describe('roundWithinBounds', () => {
  test('làm tròn về bội số gần nhất', () => {
    expect(roundWithinBounds(123400, 1000, 0, 1_000_000)).toBe(123000);
    expect(roundWithinBounds(123600, 1000, 0, 1_000_000)).toBe(124000);
  });

  test('làm tròn không được vượt trần hoặc thủng sàn', () => {
    expect(roundWithinBounds(119900, 1000, 100000, 120000)).toBe(120000);
    expect(roundWithinBounds(100400, 1000, 100000, 120000)).toBe(100000);
    // Trần 119.500 không chia hết cho 1.000 -> phải lùi xuống 119.000.
    expect(roundWithinBounds(119900, 1000, 100000, 119500)).toBe(119000);
  });
});

describe('quotePrice - hàng rào an toàn', () => {
  test('chính sách tắt thì giữ nguyên giá niêm yết', () => {
    const result = quote({ policy: { ...BASE_POLICY, enabled: false }, realizedRatio: 1 });
    expect(result.applied).toBe(false);
    expect(result.finalPrice).toBe(200000);
    expect(result.reason).toMatch(/chưa bật giá động/i);
  });

  test('ngày tham quan vượt tầm dự báo thì không đụng vào giá', () => {
    const result = quote({ leadDays: 30, realizedRatio: 1 });
    expect(result.applied).toBe(false);
    expect(result.finalPrice).toBe(200000);
    expect(result.reason).toMatch(/vượt tầm dự báo/i);
  });

  test('dự báo dưới ngưỡng tin cậy thì không đụng vào giá', () => {
    const result = quote({ forecastConfidence: 'LOW', realizedRatio: 0.05 });
    expect(result.applied).toBe(false);
    expect(result.finalPrice).toBe(200000);
    expect(result.reason).toMatch(/tin cậy/i);
  });

  test('không có dự báo nhưng đã tới ngày tham quan thì vẫn dùng vé đã bán', () => {
    const result = quote({ forecastRatio: null, forecastConfidence: 'LOW', leadDays: 0, realizedRatio: 1 });
    expect(result.applied).toBe(true);
    expect(result.signalSource).toBe('REALTIME_OCCUPANCY');
    expect(result.finalPrice).toBeGreaterThan(200000);
  });

  test('giá không bao giờ vượt trần dù biên phụ thu được đặt rất cao', () => {
    const result = quote({
      policy: { ...BASE_POLICY, maxSurchargePercent: 100, priceCeilingPercent: 110 },
      realizedRatio: 1,
      forecastRatio: 1,
    });
    expect(result.finalPrice).toBeLessThanOrEqual(220000);
    expect(result.finalPrice).toBe(220000);
  });

  test('giá không bao giờ thủng sàn dù biên giảm được đặt rất sâu', () => {
    const result = quote({
      policy: { ...BASE_POLICY, maxDiscountPercent: 90, priceFloorPercent: 90 },
      realizedRatio: 0,
      forecastRatio: 0,
      leadDays: 0,
      forecastConfidence: 'HIGH',
    });
    expect(result.finalPrice).toBe(180000);
  });

  test('chế độ chỉ đề xuất: khách trả giá niêm yết, đối tác vẫn thấy con số đề xuất', () => {
    const result = quote({
      policy: { ...BASE_POLICY, mode: 'SUGGEST_ONLY' },
      realizedRatio: 1,
      forecastRatio: 1,
    });
    expect(result.applied).toBe(false);
    expect(result.finalPrice).toBe(200000);
    expect(result.adjustmentPercent).toBe(0);
    expect(result.suggestedPrice).toBeGreaterThan(200000);
    expect(result.suggestedPercent).toBeGreaterThan(0);
  });

  test('phụ thu khi dự báo đông và ghi rõ lý do', () => {
    const result = quote({ realizedRatio: 0.2, forecastRatio: 1, leadDays: 14 });
    expect(result.applied).toBe(true);
    expect(result.demandLevel).toBe('PEAK');
    expect(result.finalPrice).toBe(240000);
    expect(result.adjustmentPercent).toBe(20);
    expect(result.reason).toMatch(/cao điểm/i);
  });

  test('giảm giá khi dự báo vắng và ghi rõ lý do', () => {
    const result = quote({ realizedRatio: 0, forecastRatio: 0, leadDays: 14 });
    expect(result.applied).toBe(true);
    expect(result.demandLevel).toBe('QUIET');
    expect(result.finalPrice).toBe(160000);
    expect(result.adjustmentPercent).toBe(-20);
    expect(result.reason).toMatch(/giờ vắng/i);
  });

  test('adjustmentPercent phản ánh giá sau làm tròn, không phải phần trăm lý thuyết', () => {
    const result = quote({
      basePrice: 123456,
      realizedRatio: 0.2,
      forecastRatio: 1,
      leadDays: 14,
    });
    const expected = Number((((result.finalPrice - 123456) / 123456) * 100).toFixed(2));
    expect(result.adjustmentPercent).toBe(expected);
    expect(result.finalPrice % 1000).toBe(0);
  });

  test('giá niêm yết không phải số nguyên VND thì bỏ qua giá động', () => {
    const result = quote({ basePrice: 199999.5, realizedRatio: 1 });
    expect(result.applied).toBe(false);
  });

  test('ngày tham quan trong quá khứ không sinh báo giá', () => {
    const result = quote({ leadDays: -1, realizedRatio: 1 });
    expect(result.applied).toBe(false);
    expect(result.reason).toMatch(/không hợp lệ/i);
  });

  // --- Bất biến về hướng điều chỉnh ---
  // Với gói vé rẻ hơn cả bước làm tròn, các phép kẹp/làm tròn từng đẩy giá đi
  // ngược hướng quyết định (quyết định giảm nhưng giá lại tăng 25%).
  test('quyết định giảm giá không bao giờ làm giá tăng', () => {
    const result = quote({
      basePrice: 800,
      policy: { ...BASE_POLICY, roundingStep: 1000 },
      realizedRatio: 0,
      forecastRatio: 0,
      leadDays: 0,
    });
    expect(result.finalPrice).toBeLessThanOrEqual(800);
  });

  test('quyết định phụ thu không bao giờ làm giá giảm', () => {
    const result = quote({
      basePrice: 800,
      policy: { ...BASE_POLICY, roundingStep: 1000 },
      realizedRatio: 1,
      forecastRatio: 1,
      leadDays: 0,
    });
    expect(result.finalPrice).toBeGreaterThanOrEqual(800);
  });

  test('làm tròn không được vượt biên điều chỉnh mà đối tác đã đặt', () => {
    const result = quote({
      basePrice: 5000,
      policy: { ...BASE_POLICY, maxSurchargePercent: 15, roundingStep: 1000 },
      realizedRatio: 1,
      forecastRatio: 1,
      leadDays: 0,
    });
    expect(result.adjustmentPercent).toBeLessThanOrEqual(15);
  });

  // Giá thấp hơn hạn mức VNPay tạo ra lượt giữ chỗ không thể lên đơn:
  // createBooking chặn ở MIN_VNPAY_AMOUNT sau khi vé đã bị giữ.
  test('giá sau khi giảm không bao giờ rơi xuống dưới hạn mức thanh toán', () => {
    [5000, 5500, 6000, 9000].forEach((basePrice) => {
      const result = quote({
        basePrice,
        policy: { ...BASE_POLICY, maxDiscountPercent: 90, priceFloorPercent: 10 },
        realizedRatio: 0,
        forecastRatio: 0,
        leadDays: 0,
      });
      expect(result.finalPrice).toBeGreaterThanOrEqual(5000);
    });
  });

  test('gói vé vốn rẻ hơn hạn mức thanh toán vẫn không bị đẩy giá lên', () => {
    const result = quote({
      basePrice: 3000,
      policy: { ...BASE_POLICY, roundingStep: 1 },
      realizedRatio: 0,
      forecastRatio: 0,
      leadDays: 0,
    });
    expect(result.finalPrice).toBeLessThanOrEqual(3000);
  });

  test('làm tròn nuốt trọn mức điều chỉnh thì coi như không đổi giá', () => {
    const result = quote({
      policy: { ...BASE_POLICY, roundingStep: 100000, maxSurchargePercent: 5 },
      realizedRatio: 0.2,
      forecastRatio: 0.8,
      leadDays: 14,
    });
    expect(result.finalPrice).toBe(200000);
    expect(result.applied).toBe(false);
  });
});

describe('occupancyRatio', () => {
  test('sức chứa bằng 0 được coi là đã đầy để không bao giờ giảm giá nhầm', () => {
    expect(occupancyRatio(0, 0)).toBe(1);
  });

  test('kẹp trong khoảng 0..1 kể cả khi overbooking', () => {
    expect(occupancyRatio(150, 100)).toBe(1);
    expect(occupancyRatio(-5, 100)).toBe(0);
  });
});

describe('forecastConfidenceOf', () => {
  test('baseline fallback luôn là độ tin cậy thấp', () => {
    expect(forecastConfidenceOf({ usedFallback: true, observedDays: 90, sampleBookings: 500 }))
      .toBe('LOW');
  });

  test('model AI với nền dữ liệu dày là độ tin cậy cao', () => {
    expect(forecastConfidenceOf({ usedFallback: false, observedDays: 30, sampleBookings: 100 }))
      .toBe('HIGH');
  });

  test('model AI với nền dữ liệu mỏng chỉ đạt trung bình', () => {
    expect(forecastConfidenceOf({ usedFallback: false, observedDays: 10, sampleBookings: 20 }))
      .toBe('MEDIUM');
  });

  test('không có dòng dự báo nào là độ tin cậy thấp', () => {
    expect(forecastConfidenceOf(null)).toBe('LOW');
  });
});

describe('toPublicQuote', () => {
  test('không lộ tham số chính sách của đối tác ra phía khách', () => {
    const result = toPublicQuote(quote({ realizedRatio: 0.2, forecastRatio: 1, leadDays: 14 }));
    expect(Object.keys(result).sort()).toEqual(
      ['adjustmentPercent', 'basePrice', 'demandLevel', 'label', 'reason', 'unitPrice'],
    );
  });

  test('báo giá không được áp dụng thì không trả gì cho khách', () => {
    expect(toPublicQuote(quote({ realizedRatio: 0.5 }))).toBeNull();
    expect(toPublicQuote(null)).toBeNull();
  });
});
