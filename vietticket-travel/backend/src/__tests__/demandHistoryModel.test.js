const {
  MAX_OCCUPANCY,
  MIN_OCCUPANCY,
  allocateAdmissionsToSlots,
  drawGroupSize,
  drawLeadDays,
  isPublicHoliday,
  isWeekendDateKey,
  occupancyFor,
  paceShareAtLead,
  planDayDemand,
  seededGenerator,
} = require('../../scripts/lib/demandHistoryModel');

const PROFILE = {
  baseOccupancy: 0.44,
  weekendLift: 1.75,
  holidayLift: 2.0,
  summerLift: 1.05,
  trendPercent: 0.18,
};

const SLOTS = [
  { id: 'slot-1', weekdayShare: 0.38, weekendShare: 0.32, capacity: 45 },
  { id: 'slot-2', weekdayShare: 0.62, weekendShare: 0.68, capacity: 45 },
];

const PRODUCTS = [
  { id: 'adult', share: 0.7, ticket: { id: 'adult', sellingPrice: 280000 } },
  { id: 'child', share: 0.3, ticket: { id: 'child', sellingPrice: 180000 } },
];

describe('seededGenerator', () => {
  test('cùng seed cho ra cùng chuỗi số', () => {
    const first = seededGenerator('cruise:2026-06-08');
    const second = seededGenerator('cruise:2026-06-08');
    const a = [first(), first(), first()];
    const b = [second(), second(), second()];
    expect(a).toEqual(b);
  });

  test('seed khác nhau cho chuỗi khác nhau', () => {
    const first = seededGenerator('cruise:2026-06-08');
    const second = seededGenerator('cruise:2026-06-09');
    expect(first()).not.toBe(second());
  });

  test('giá trị luôn nằm trong [0, 1)', () => {
    const random = seededGenerator('kiem-tra-bien');
    for (let index = 0; index < 500; index += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('occupancyFor', () => {
  const call = (dateKey, dayIndex = 0) => occupancyFor({
    profile: PROFILE,
    dateKey,
    dayIndex,
    historyDays: 90,
    random: seededGenerator(`x:${dateKey}`),
  });

  test('cuối tuần đông hơn ngày thường', () => {
    // 2026-06-08 thứ Hai, 2026-06-13 thứ Bảy.
    expect(call('2026-06-13')).toBeGreaterThan(call('2026-06-08'));
  });

  test('ngày lễ tạo đỉnh nhu cầu', () => {
    expect(isPublicHoliday('2026-04-30')).toBe(true);
    expect(call('2026-04-30')).toBeGreaterThan(call('2026-04-29'));
  });

  test('luôn nằm trong biên và không bao giờ vượt sức chứa', () => {
    const extreme = occupancyFor({
      profile: { ...PROFILE, baseOccupancy: 0.9, weekendLift: 3, holidayLift: 3 },
      dateKey: '2026-05-01',
      dayIndex: 89,
      historyDays: 90,
      random: () => 1,
    });
    expect(extreme).toBeLessThanOrEqual(MAX_OCCUPANCY);
    expect(extreme).toBeGreaterThanOrEqual(MIN_OCCUPANCY);
  });

  test('tỷ lệ lấp đầy nằm trong khoảng hợp lý của vận hành thật', () => {
    const values = [];
    for (let day = 0; day < 90; day += 1) {
      const dateKey = new Date(Date.UTC(2026, 4, 1) + day * 86400000).toISOString().slice(0, 10);
      values.push(call(dateKey, day));
    }
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    // Bản cũ sinh ra tỷ lệ ~2%, khiến mọi ngày đều là "vắng khách".
    expect(mean).toBeGreaterThan(0.3);
    expect(mean).toBeLessThan(0.9);
  });
});

describe('allocateAdmissionsToSlots', () => {
  test('chia theo tỷ trọng và tổng bằng số khách yêu cầu', () => {
    const allocation = allocateAdmissionsToSlots(50, SLOTS, false);
    expect(allocation.reduce((sum, value) => sum + value, 0)).toBe(50);
    expect(allocation[1]).toBeGreaterThan(allocation[0]);
  });

  test('không khung giờ nào vượt sức chứa của chính nó', () => {
    const allocation = allocateAdmissionsToSlots(90, SLOTS, true);
    expect(allocation[0]).toBeLessThanOrEqual(45);
    expect(allocation[1]).toBeLessThanOrEqual(45);
  });

  test('vượt tổng sức chứa thì bán hết vé chứ không tràn', () => {
    const allocation = allocateAdmissionsToSlots(500, SLOTS, false);
    expect(allocation).toEqual([45, 45]);
  });

  test('cuối tuần dồn nhiều hơn về suất được ưa chuộng', () => {
    const weekday = allocateAdmissionsToSlots(40, SLOTS, false);
    const weekend = allocateAdmissionsToSlots(40, SLOTS, true);
    expect(weekend[1]).toBeGreaterThan(weekday[1]);
  });
});

describe('nhịp đặt chỗ', () => {
  test('paceShareAtLead giảm dần khi còn xa ngày đi', () => {
    const values = [1, 3, 7, 14, 21].map(paceShareAtLead);
    for (let index = 1; index < values.length; index += 1) {
      expect(values[index]).toBeLessThan(values[index - 1]);
    }
    expect(paceShareAtLead(1)).toBe(1);
    expect(paceShareAtLead(60)).toBe(0);
  });

  test('phân phối lead time khớp với đường cong nhịp đặt chỗ', () => {
    // Hai thứ này phải nhất quán, nếu không đường cong backend học từ lịch sử
    // sẽ không khớp tồn kho mà seed ghi cho các ngày tương lai.
    const random = seededGenerator('lead-distribution');
    const draws = Array.from({ length: 20000 }, () => drawLeadDays(random));
    for (const lead of [3, 7, 14]) {
      const observed = draws.filter((value) => value >= lead).length / draws.length;
      expect(Math.abs(observed - paceShareAtLead(lead))).toBeLessThan(0.03);
    }
  });

  test('lead time luôn ít nhất 1 ngày', () => {
    const random = seededGenerator('lead-min');
    for (let index = 0; index < 500; index += 1) {
      expect(drawLeadDays(random)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('drawGroupSize', () => {
  test('không để lại phần dư lẻ 1-2 khách ở cuối', () => {
    const random = seededGenerator('group');
    expect(drawGroupSize(random, 2)).toBe(2);
    expect(drawGroupSize(random, 1)).toBe(1);
  });
});

describe('planDayDemand', () => {
  const plan = (dateKey, paceRatio = 1) => planDayDemand({
    profile: PROFILE,
    dateKey,
    dayIndex: 45,
    historyDays: 90,
    capacity: 90,
    slots: SLOTS,
    productChoices: PRODUCTS,
    random: seededGenerator(`plan:${dateKey}:${paceRatio}`),
    paceRatio,
  });

  test('tổng số vé của các đơn đúng bằng số khách đã phân bổ', () => {
    const result = plan('2026-06-08');
    const total = result.orders.reduce((sum, order) => sum + order.quantity, 0);
    const allocated = allocateAdmissionsToSlots(result.targetAdmissions, SLOTS, false)
      .reduce((sum, value) => sum + value, 0);
    expect(total).toBe(allocated);
  });

  test('mỗi đơn đều gắn với một khung giờ và một gói vé có thật', () => {
    const result = plan('2026-06-13');
    expect(result.orders.length).toBeGreaterThan(0);
    for (const order of result.orders) {
      expect(SLOTS).toContain(order.slot);
      expect(PRODUCTS).toContain(order.product);
      expect(order.quantity).toBeGreaterThan(0);
    }
  });

  test('paceRatio nhỏ thì số vé đã bán ít hơn hẳn ngày đã trọn vẹn', () => {
    const full = plan('2026-06-13', 1);
    const early = plan('2026-06-13', 0.15);
    expect(early.targetAdmissions).toBeLessThan(full.targetAdmissions * 0.4);
  });

  test('cùng đầu vào cho ra cùng kế hoạch', () => {
    const first = plan('2026-06-10');
    const second = plan('2026-06-10');
    expect(first.orders.map((order) => order.quantity))
      .toEqual(second.orders.map((order) => order.quantity));
  });

  test('nhu cầu dựng sẵn cho ngày tương lai luôn chừa chỗ trống', () => {
    // Bộ seed hạ sức chứa dùng để phân bổ xuống 80% trước khi gọi hàm này, nên
    // dù nhu cầu cuối tuần chạm trần thì khung giờ vẫn còn ~20% chỗ cho booking
    // kịch bản và cho lượt đặt thử ngay tại buổi trình diễn.
    const HEADROOM = 0.8;
    const realSlotCapacity = 45;
    const cappedSlots = SLOTS.map((slot) => ({
      ...slot,
      capacity: Math.floor(realSlotCapacity * HEADROOM),
    }));
    const cappedDayCapacity = Math.floor(90 * HEADROOM);

    let worstSlotFill = 0;
    for (let lead = 1; lead <= 21; lead += 1) {
      const dateKey = new Date(Date.UTC(2026, 6, 30) + lead * 86400000).toISOString().slice(0, 10);
      const result = planDayDemand({
        profile: PROFILE,
        dateKey,
        dayIndex: 89 + lead,
        historyDays: 90,
        capacity: cappedDayCapacity,
        slots: cappedSlots,
        productChoices: PRODUCTS,
        random: seededGenerator(`forward:${dateKey}`),
        paceRatio: paceShareAtLead(lead),
      });

      const perSlot = new Map();
      for (const order of result.orders) {
        perSlot.set(order.slot.id, (perSlot.get(order.slot.id) || 0) + order.quantity);
      }
      for (const sold of perSlot.values()) {
        expect(sold).toBeLessThanOrEqual(Math.floor(realSlotCapacity * HEADROOM));
        worstSlotFill = Math.max(worstSlotFill, sold / realSlotCapacity);
      }
    }
    // Không khung giờ nào vượt 80% sức chứa thật.
    expect(worstSlotFill).toBeLessThanOrEqual(HEADROOM);
  });

  test('nhận diện cuối tuần theo lịch, không theo múi giờ chạy test', () => {
    expect(isWeekendDateKey('2026-06-13')).toBe(true); // thứ Bảy
    expect(isWeekendDateKey('2026-06-15')).toBe(false); // thứ Hai
  });
});
