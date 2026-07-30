jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));

const prisma = require('./helpers/mockPrisma');
const {
  getSlotDemandShares,
  resetSlotDemandCache,
  shareForSlot,
} = require('../services/slotDemandService');
const { resetBookingPaceCache } = require('../services/bookingPaceService');
const {
  forecastRatioForSlot,
  quoteSchedule,
} = require('../services/dynamicPricingService');

// quoteSchedule cố ý đọc lịch sử bằng client thường (không phải client giao
// dịch), nên các lớp học từ lịch sử được nạp qua prisma mock ở cấp module.
const ORIGINAL_AUTO_APPLY = process.env.DYNAMIC_PRICING_AUTO_APPLY_ALLOWED;

const SUNSET = 'slot-sunset';
const AFTERNOON = 'slot-afternoon';
const ATTRACTION_ID = 'attraction-cruise';

const DAY_MS = 24 * 60 * 60 * 1000;
// Thứ Hai 01/06/2026 giờ VN — mọi mốc thời gian trong file suy ra từ đây để
// test không phụ thuộc ngày chạy.
const NOW = new Date('2026-06-01T03:00:00.000Z');

function dateOnly(dateKey) {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

function addDays(dateKey, days) {
  return new Date(dateOnly(dateKey).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Lịch sử tồn kho theo khung giờ: mỗi ngày có hai dòng, tỷ trọng suất hoàng
 * hôn cao hơn và giãn thêm vào cuối tuần — đúng quy luật mà seed dựng ra.
 */
function buildHistoryRows({
  days = 84,
  weekdaySunsetShare = 0.62,
  weekendSunsetShare = 0.7,
  dailyTotal = 60,
} = {}) {
  const rows = [];
  const endKey = addDays('2026-06-01', -1);
  for (let index = 0; index < days; index += 1) {
    const dateKey = addDays(endKey, -index);
    const weekday = dateOnly(dateKey).getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    const share = weekend ? weekendSunsetShare : weekdaySunsetShare;
    rows.push(
      { timeSlotId: SUNSET, date: dateOnly(dateKey), bookedQty: Math.round(dailyTotal * share) },
      { timeSlotId: AFTERNOON, date: dateOnly(dateKey), bookedQty: Math.round(dailyTotal * (1 - share)) },
    );
  }
  return rows;
}

// Client tối giản cho các test gọi thẳng slotDemandService.
function historyClient(historyRows) {
  return {
    timeSlotStock: { findMany: jest.fn(async () => historyRows) },
  };
}

function clientWith(historyRows, todayStocks = []) {
  // Lịch sử đi qua prisma mock (client thường), tồn kho của ngày đang xét đi
  // qua client được truyền vào — đúng như đường đi thật trong giao dịch.
  prisma.timeSlotStock.findMany.mockImplementation(async () => historyRows);
  return {
    timeSlotStock: { findMany: jest.fn(async () => todayStocks) },
    dailyStock: { findUnique: jest.fn(async () => null) },
    attractionDailyStock: { findUnique: jest.fn(async () => null) },
    revenueForecast: { findUnique: jest.fn(async () => null) },
    dynamicPricingPolicy: { findUnique: jest.fn(async () => null) },
  };
}

beforeEach(() => {
  resetSlotDemandCache();
  resetBookingPaceCache();
  jest.clearAllMocks();
  // Mặc định chưa có đường cong đặt chỗ: các test về khung giờ tập trung vào
  // phần phân bổ theo suất, không lẫn với phần quy đổi theo nhịp bán.
  prisma.reservation.findMany.mockResolvedValue([]);
  process.env.DYNAMIC_PRICING_AUTO_APPLY_ALLOWED = 'true';
});

afterAll(() => {
  if (ORIGINAL_AUTO_APPLY === undefined) {
    delete process.env.DYNAMIC_PRICING_AUTO_APPLY_ALLOWED;
  } else {
    process.env.DYNAMIC_PRICING_AUTO_APPLY_ALLOWED = ORIGINAL_AUTO_APPLY;
  }
});

describe('getSlotDemandShares', () => {
  test('một khung giờ duy nhất thì tỷ trọng là 100% và không cần lịch sử', async () => {
    const client = historyClient([]);
    const result = await getSlotDemandShares(client, {
      attractionId: ATTRACTION_ID,
      slotIds: [SUNSET],
      now: NOW,
    });

    expect(result.learned).toBe(true);
    // Phải phân biệt với "học được từ dữ liệu": không có ngày mẫu nào cả, nên
    // giao diện không được nói "đã học từ 0 ngày thường và 0 ngày cuối tuần".
    expect(result.singleSlot).toBe(true);
    expect(result.bySlotId.get(SUNSET)).toEqual({ weekdayShare: 1, weekendShare: 1 });
    expect(client.timeSlotStock.findMany).not.toHaveBeenCalled();
  });

  test('nhiều khung giờ học được thì không bị đánh dấu là lịch một khung', async () => {
    const client = historyClient(buildHistoryRows());
    const result = await getSlotDemandShares(client, {
      attractionId: ATTRACTION_ID,
      slotIds: [SUNSET, AFTERNOON],
      now: NOW,
    });

    expect(result.singleSlot).toBeUndefined();
    expect(result.weekdaySampleDays).toBeGreaterThan(0);
  });

  test('học đúng tỷ trọng và tách riêng ngày thường với cuối tuần', async () => {
    const client = historyClient(buildHistoryRows());
    const result = await getSlotDemandShares(client, {
      attractionId: ATTRACTION_ID,
      slotIds: [SUNSET, AFTERNOON],
      now: NOW,
    });

    expect(result.learned).toBe(true);
    const sunset = result.bySlotId.get(SUNSET);
    expect(sunset.weekdayShare).toBeCloseTo(0.62, 2);
    expect(sunset.weekendShare).toBeCloseTo(0.7, 2);
    // Cuối tuần suất hoàng hôn phải chiếm phần lớn hơn ngày thường.
    expect(sunset.weekendShare).toBeGreaterThan(sunset.weekdayShare);
  });

  test('tổng tỷ trọng của mọi khung giờ luôn bằng 1', async () => {
    const client = historyClient(buildHistoryRows());
    const result = await getSlotDemandShares(client, {
      attractionId: ATTRACTION_ID,
      slotIds: [SUNSET, AFTERNOON],
      now: NOW,
    });

    const weekdayTotal = [...result.bySlotId.values()]
      .reduce((sum, entry) => sum + entry.weekdayShare, 0);
    const weekendTotal = [...result.bySlotId.values()]
      .reduce((sum, entry) => sum + entry.weekendShare, 0);
    expect(weekdayTotal).toBeCloseTo(1, 6);
    expect(weekendTotal).toBeCloseTo(1, 6);
  });

  test('không đủ lịch sử thì trả learned=false kèm lý do, không bịa phân bố đều', async () => {
    const client = historyClient(buildHistoryRows({ days: 5 }));
    const result = await getSlotDemandShares(client, {
      attractionId: ATTRACTION_ID,
      slotIds: [SUNSET, AFTERNOON],
      now: NOW,
    });

    expect(result.learned).toBe(false);
    expect(result.reason).toMatch(/Chưa đủ lịch sử/);
  });

  test('một ngày lễ đông đột biến không được chi phối tỷ trọng cả kỳ', async () => {
    const rows = buildHistoryRows();
    // Ngày gần nhất bán gấp 20 lần và lệch hẳn về suất chiều.
    const spikeDate = dateOnly(addDays('2026-06-01', -1));
    const spiked = rows.map((row) => (
      row.date.getTime() === spikeDate.getTime()
        ? { ...row, bookedQty: row.timeSlotId === AFTERNOON ? 1200 : 40 }
        : row
    ));

    const client = historyClient(spiked);
    const result = await getSlotDemandShares(client, {
      attractionId: ATTRACTION_ID,
      slotIds: [SUNSET, AFTERNOON],
      now: NOW,
    });

    // Trung bình theo từng ngày nên đỉnh đơn lẻ chỉ là 1 quan sát trong ~60.
    expect(result.bySlotId.get(SUNSET).weekdayShare).toBeGreaterThan(0.55);
  });

  test('shareForSlot chọn đúng tỷ trọng theo ngày trong tuần', async () => {
    const client = historyClient(buildHistoryRows());
    const shares = await getSlotDemandShares(client, {
      attractionId: ATTRACTION_ID,
      slotIds: [SUNSET, AFTERNOON],
      now: NOW,
    });

    // 2026-06-06 là thứ Bảy, 2026-06-08 là thứ Hai.
    expect(shareForSlot(shares, SUNSET, '2026-06-06')).toBeCloseTo(0.7, 2);
    expect(shareForSlot(shares, SUNSET, '2026-06-08')).toBeCloseTo(0.62, 2);
  });
});

describe('forecastRatioForSlot', () => {
  test('mẫu số là sức chứa của chính khung giờ, không phải sức chứa ngày', () => {
    // 60 vé dự báo cho cả ngày, suất này chiếm 65%, sức chứa suất là 45.
    expect(forecastRatioForSlot({ predictedTickets: 60, share: 0.65, slotCapacity: 45 }))
      .toBeCloseTo(0.8667, 4);
    // Cùng con số đó mà chia cho sức chứa ngày (90) chỉ ra 43% — đúng lý do
    // phải phân bổ trước khi so sánh.
    expect(forecastRatioForSlot({ predictedTickets: 60, share: 0.65, slotCapacity: 90 }))
      .toBeCloseTo(0.4333, 4);
  });

  test('trả null khi thiếu dữ liệu thay vì trả 0 (0 nghĩa là vắng khách)', () => {
    expect(forecastRatioForSlot({ predictedTickets: null, share: 0.5, slotCapacity: 45 })).toBeNull();
    expect(forecastRatioForSlot({ predictedTickets: 60, share: 0.5, slotCapacity: 0 })).toBeNull();
  });

  test('không bao giờ vượt quá 1 dù dự báo lớn hơn sức chứa', () => {
    expect(forecastRatioForSlot({ predictedTickets: 500, share: 1, slotCapacity: 45 })).toBe(1);
  });
});

describe('quoteSchedule — giá khác nhau giữa các khung giờ trong cùng một ngày', () => {
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

  const schedule = {
    product: { id: 'ticket-cruise', sellingPrice: 280000 },
    attraction: { id: ATTRACTION_ID },
    specialDate: null,
    isClosed: false,
    dayCapacity: 90,
    slots: [
      { id: AFTERNOON, startTime: '16:30', endTime: '18:00', maxCapacity: 45 },
      { id: SUNSET, startTime: '18:30', endTime: '20:00', maxCapacity: 45 },
    ],
    slotSource: 'attraction',
  };

  function withForecast(client, predictedTickets) {
    client.revenueForecast.findUnique = jest.fn(async () => ({
      predictedTickets,
      usedFallback: false,
      observedDays: 84,
      sampleBookings: 900,
      modelVersion: 'test-model',
      generatedAt: NOW,
    }));
    return client;
  }

  test('cùng một dự báo ngày cho ra hai mức giá khác nhau cho hai suất', async () => {
    const client = withForecast(clientWith(buildHistoryRows()), 60);
    const quotes = await quoteSchedule(client, {
      schedule,
      date: dateOnly('2026-06-14'), // Chủ nhật, còn 13 ngày
      now: NOW,
      policy: POLICY,
    });

    const sunset = quotes.byTimeSlotId.get(SUNSET);
    const afternoon = quotes.byTimeSlotId.get(AFTERNOON);

    expect(quotes.slotDemand.learned).toBe(true);
    expect(sunset.forecastBasis).toBe('SLOT');
    expect(afternoon.forecastBasis).toBe('SLOT');
    // Chủ nhật: 60 × 0.70 / 45 = 0.93 cho suất hoàng hôn, 60 × 0.30 / 45 = 0.40
    // cho suất chiều -> một suất cao điểm, một suất trung tính.
    expect(sunset.demandLevel).toBe('PEAK');
    expect(afternoon.demandLevel).toBe('NORMAL');
    expect(sunset.finalPrice).toBeGreaterThan(afternoon.finalPrice);
    expect(sunset.reason).toMatch(/phân bổ riêng cho khung giờ này/);
  });

  test('chưa học được tỷ trọng thì quay về tín hiệu cấp ngày và nói rõ', async () => {
    // 90 vé trên sức chứa ngày 90 -> tín hiệu đủ mạnh để hệ thống đổi giá,
    // nhờ đó câu giải trình được sinh ra và kiểm tra được.
    const client = withForecast(clientWith(buildHistoryRows({ days: 4 })), 90);
    const quotes = await quoteSchedule(client, {
      schedule,
      date: dateOnly('2026-06-14'),
      now: NOW,
      policy: POLICY,
    });

    const sunset = quotes.byTimeSlotId.get(SUNSET);
    expect(quotes.slotDemand.learned).toBe(false);
    expect(sunset.forecastBasis).toBe('DAY');
    expect(sunset.slotShare).toBeNull();
    expect(sunset.reason).toMatch(/dự báo ở mức cả ngày/);
    // Không có tỷ trọng thì hai suất phải nhận cùng một tín hiệu dự báo.
    expect(sunset.forecastRatio).toBe(quotes.byTimeSlotId.get(AFTERNOON).forecastRatio);
  });

  test('suất đã bán gần hết vẫn phụ thu dù dự báo cho suất đó là vắng', async () => {
    const client = withForecast(
      clientWith(
        buildHistoryRows(),
        // Suất chiều đã bán 43/45 chỗ cho ngày đang xét.
        [{ timeSlotId: AFTERNOON, bookedQty: 43, heldQty: 0 }],
      ),
      20, // dự báo cả ngày chỉ 20 vé -> suất chiều lẽ ra là "vắng"
    );
    const quotes = await quoteSchedule(client, {
      schedule,
      date: dateOnly('2026-06-14'),
      now: NOW,
      policy: POLICY,
    });

    const afternoon = quotes.byTimeSlotId.get(AFTERNOON);
    expect(afternoon.demandLevel).toBe('PEAK');
    expect(afternoon.finalPrice).toBeGreaterThan(280000);
  });

  test('hai gói vé có lịch riêng thì tỷ trọng được chuẩn hoá trong từng lịch', async () => {
    // Gộp chung 4 khung giờ của hai gói vé độc lập sẽ cho mỗi suất ~25% thay vì
    // ~50%, làm tín hiệu dự báo theo khung giờ bị chia đôi.
    const { previewPricing } = require('../services/dynamicPricingService');
    const OTHER_A = 'slot-other-a';
    const OTHER_B = 'slot-other-b';

    const rowsFor = (ids, shareFirst) => {
      const rows = [];
      const endKey = addDays('2026-06-01', -1);
      for (let index = 0; index < 84; index += 1) {
        const dateKey = addDays(endKey, -index);
        rows.push(
          { timeSlotId: ids[0], date: dateOnly(dateKey), bookedQty: Math.round(60 * shareFirst) },
          { timeSlotId: ids[1], date: dateOnly(dateKey), bookedQty: Math.round(60 * (1 - shareFirst)) },
        );
      }
      return rows;
    };

    // prisma mock trả lịch sử theo đúng tập khung giờ được hỏi.
    prisma.timeSlotStock.findMany.mockImplementation(async ({ where }) => {
      const asked = where.timeSlotId.in;
      if (asked.includes(SUNSET)) return rowsFor([AFTERNOON, SUNSET], 0.38);
      return rowsFor([OTHER_A, OTHER_B], 0.5);
    });
    prisma.attractionDailyStock.findMany.mockResolvedValue([]);
    prisma.dailyStock.findMany.mockResolvedValue([]);
    prisma.revenueForecast.findMany.mockResolvedValue([{
      forecastDate: dateOnly('2026-06-13'),
      predictedTickets: 60,
      usedFallback: false,
      observedDays: 84,
      sampleBookings: 900,
      modelVersion: 'test-model',
      generatedAt: NOW,
    }]);
    prisma.dynamicPricingPolicy.findUnique.mockResolvedValue(POLICY);
    prisma.ticketProduct.findMany.mockResolvedValue([
      {
        id: 'product-cruise',
        name: 'Vé du thuyền',
        sellingPrice: 280000,
        createdAt: new Date('2026-01-01'),
        // Gói này có lịch riêng.
        timeSlots: [
          { id: AFTERNOON, startTime: '16:30', endTime: '18:00', maxCapacity: 45, isActive: true },
          { id: SUNSET, startTime: '18:30', endTime: '20:00', maxCapacity: 45, isActive: true },
        ],
        attraction: {
          id: ATTRACTION_ID,
          defaultCapacity: 90,
          openDays: '1,1,1,1,1,1,1',
          specialDates: [],
          publishedAt: new Date('2026-01-01'),
          publicationStatus: 'ACTIVE',
          operationalStatus: 'ACTIVE',
          archivedAt: null,
          partner: { status: 'APPROVED', commissionRate: 0.1 },
          timeSlots: [
            { id: OTHER_A, startTime: '09:00', endTime: '11:00', maxCapacity: 45, isActive: true },
            { id: OTHER_B, startTime: '14:00', endTime: '16:00', maxCapacity: 45, isActive: true },
          ],
        },
        status: 'ACTIVE',
        archivedAt: null,
      },
    ]);

    const preview = await previewPricing({
      attractionId: ATTRACTION_ID,
      days: 1,
      now: new Date('2026-06-13T03:00:00.000Z'),
      client: prisma,
    });

    // Cờ này phải sống sót qua bước chọn lọc field ở payload trả về, nếu không
    // giao diện lại rơi về câu "đã học từ 0 ngày".
    expect(preview.slotDemand.singleSlot).toBe(false);

    const slots = preview.products[0].days[0].slots;
    const shares = slots.map((slot) => slot.slotShare);
    // Hai suất của chính gói vé này, tổng phải bằng 1 — không bị pha loãng bởi
    // hai suất của lịch cấp điểm tham quan.
    expect(shares.every((value) => value !== null)).toBe(true);
    expect(shares.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 2);
  });

  test('không có dự báo thì không gọi tới lớp tỷ trọng khung giờ', async () => {
    const client = clientWith(buildHistoryRows());
    const quotes = await quoteSchedule(client, {
      schedule,
      date: dateOnly('2026-06-14'),
      now: NOW,
      policy: POLICY,
    });

    expect(quotes.slotDemand).toBeNull();
    expect(quotes.byTimeSlotId.get(SUNSET).forecastBasis).toBe('DAY');
  });
});
