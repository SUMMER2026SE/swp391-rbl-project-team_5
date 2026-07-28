jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
const { Prisma } = require('@prisma/client');
const mockPrisma = require('./helpers/mockPrisma');
const { reserveTickets, checkAvailability } = require('../controllers/ticketController');

const { Decimal } = Prisma;

afterEach(() => jest.clearAllMocks());

// Ngày tham quan động (mai theo giờ VN) để test không phụ thuộc ngày chạy.
const VISIT_DATE = new Date(Date.now() + 7 * 60 * 60 * 1000 + 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);

const attraction = {
  id: 'attr-001',
  status: 'APPROVED',
  publicationStatus: 'ACTIVE',
  publishedAt: new Date('2026-06-01T00:00:00.000Z'),
  archivedAt: null,
  openDays: '1,1,1,1,1,1,1',
  defaultCapacity: 100,
  openTime: '08:00',
  closeTime: '17:00',
  specialDates: [],
  timeSlots: [],
  partner: { status: 'APPROVED', commissionRate: new Decimal('0.2') },
};

function productWithSlots(slots = []) {
  return {
    id: 'tkt-001',
    status: 'ACTIVE',
    archivedAt: null,
    attractionId: attraction.id,
    sellingPrice: new Decimal(125001),
    refundPolicy: 'REFUND_WITH_FEE',
    refundFeeRate: new Decimal('0.15'),
    refundCutoffHours: 48,
    timeSlots: slots,
    attraction,
  };
}

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe('reserveTickets - chống overbooking', () => {
  const mockUser = { id: 'user-001' };

  function makeReq(body = {}) {
    return {
      params: { ticketProductId: 'tkt-001' },
      body: { date: VISIT_DATE, quantity: 2, ...body },
      user: mockUser,
    };
  }

  function makeTx({ daily, attractionStock, product = productWithSlots() }) {
    return {
      ticketProduct: {
        findUnique: jest.fn().mockResolvedValue(product),
      },
      dailyStock: {
        findUnique: jest.fn().mockResolvedValue(daily),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({
          ...daily,
          capacity: data.capacity ?? daily.capacity,
        })),
        create: jest.fn(),
      },
      attractionDailyStock: {
        findUnique: jest.fn().mockResolvedValue(attractionStock),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({
          ...attractionStock,
          capacity: data.capacity ?? attractionStock.capacity,
        })),
        create: jest.fn(),
      },
      timeSlotStock: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      reservation: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'res-001' }),
      },
      // Giá động tắt theo mặc định: không có chính sách nào được lưu.
      dynamicPricingPolicy: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      revenueForecast: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      dynamicPriceAdjustment: {
        create: jest.fn(),
      },
    };
  }

  test('giữ vé trong transaction SERIALIZABLE khi còn đủ sức chứa', async () => {
    const tx = makeTx({
      daily: {
        id: 'daily-1',
        capacity: 100,
        bookedQuantity: 10,
        heldQuantity: 5,
      },
      attractionStock: {
        id: 'attr-stock-1',
        capacity: 100,
        bookedQty: 10,
        heldQty: 5,
      },
    });
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const res = makeRes();
    await reserveTickets(makeReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(tx.attractionDailyStock.update).toHaveBeenCalledWith({
      where: { id: 'attr-stock-1' },
      data: { heldQty: { increment: 2 } },
    });
    expect(tx.reservation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        snapshotUnitPrice: 125001,
        snapshotRefundPolicy: 'REFUND_WITH_FEE',
        snapshotRefundFeeRate: 0.15,
        snapshotRefundCutoffHours: 48,
        snapshotCommissionRate: 0.2,
      }),
    });
    expect(mockPrisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });

  // --- Giá động theo dự báo ---
  // Kho tồn kho được đặt sao cho tín hiệu nhu cầu rơi hẳn về một phía, để bài
  // test kiểm tra đúng đường dẫn quyết định giá chứ không phụ thuộc ngày chạy.
  const PRICING_POLICY = {
    id: 'policy-1',
    attractionId: 'attr-001',
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

  function withPricing(tx, { policy = PRICING_POLICY, predictedTickets = null } = {}) {
    tx.dynamicPricingPolicy.findUnique.mockResolvedValue(policy);
    tx.revenueForecast.findUnique.mockResolvedValue(
      predictedTickets === null
        ? null
        : {
            predictedTickets,
            usedFallback: false,
            observedDays: 30,
            sampleBookings: 100,
            modelVersion: 'test-model-1',
            generatedAt: new Date('2026-07-27T00:00:00.000Z'),
          },
    );
    return tx;
  }

  test('giảm giá và ghi sổ khi dự báo vắng khách', async () => {
    const tx = withPricing(
      makeTx({
        daily: { id: 'daily-quiet', capacity: 100, bookedQuantity: 10, heldQuantity: 5 },
        attractionStock: { id: 'attr-quiet', capacity: 100, bookedQty: 10, heldQty: 5 },
      }),
      { predictedTickets: 10 },
    );
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const res = makeRes();
    await reserveTickets(makeReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    const snapshotPrice = tx.reservation.create.mock.calls[0][0].data.snapshotUnitPrice;
    expect(snapshotPrice).toBeLessThan(125001);
    expect(snapshotPrice % 1000).toBe(0);
    // Giá sàn 80% của 125.001 là 100.001 -> mọi mức giảm phải nằm trên ngưỡng này.
    expect(snapshotPrice).toBeGreaterThanOrEqual(100001);
    expect(tx.dynamicPriceAdjustment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        policyId: 'policy-1',
        reservationId: 'res-001',
        demandLevel: 'QUIET',
        basePrice: 125001,
        finalPrice: snapshotPrice,
        quantity: 2,
        modelVersion: 'test-model-1',
      }),
    });
  });

  test('phụ thu khi kho gần đầy và dự báo tiếp tục đông', async () => {
    const tx = withPricing(
      makeTx({
        daily: { id: 'daily-peak', capacity: 100, bookedQuantity: 80, heldQuantity: 10 },
        attractionStock: { id: 'attr-peak', capacity: 100, bookedQty: 80, heldQty: 10 },
      }),
      { predictedTickets: 95 },
    );
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const res = makeRes();
    await reserveTickets(makeReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    const snapshotPrice = tx.reservation.create.mock.calls[0][0].data.snapshotUnitPrice;
    expect(snapshotPrice).toBeGreaterThan(125001);
    // Giá trần 120% của 125.001 là 150.001.
    expect(snapshotPrice).toBeLessThanOrEqual(150001);
    expect(tx.dynamicPriceAdjustment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ demandLevel: 'PEAK', finalPrice: snapshotPrice }),
    });
  });

  test('chế độ chỉ đề xuất không được đổi giá khách phải trả', async () => {
    const tx = withPricing(
      makeTx({
        daily: { id: 'daily-suggest', capacity: 100, bookedQuantity: 80, heldQuantity: 10 },
        attractionStock: { id: 'attr-suggest', capacity: 100, bookedQty: 80, heldQty: 10 },
      }),
      { policy: { ...PRICING_POLICY, mode: 'SUGGEST_ONLY' }, predictedTickets: 95 },
    );
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const res = makeRes();
    await reserveTickets(makeReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(tx.reservation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ snapshotUnitPrice: 125001 }),
    });
    expect(tx.dynamicPriceAdjustment.create).not.toHaveBeenCalled();
  });

  test('giá động tắt thì không ghi sổ điều chỉnh nào', async () => {
    const tx = withPricing(
      makeTx({
        daily: { id: 'daily-off', capacity: 100, bookedQuantity: 80, heldQuantity: 10 },
        attractionStock: { id: 'attr-off', capacity: 100, bookedQty: 80, heldQty: 10 },
      }),
      { policy: { ...PRICING_POLICY, enabled: false }, predictedTickets: 95 },
    );
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const res = makeRes();
    await reserveTickets(makeReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(tx.reservation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ snapshotUnitPrice: 125001 }),
    });
    expect(tx.dynamicPriceAdjustment.create).not.toHaveBeenCalled();
  });

  test('từ chối giữ chỗ khi giá đã tăng cao hơn mức khách nhìn thấy', async () => {
    const tx = withPricing(
      makeTx({
        daily: { id: 'daily-race', capacity: 100, bookedQuantity: 80, heldQuantity: 10 },
        attractionStock: { id: 'attr-race', capacity: 100, bookedQty: 80, heldQty: 10 },
      }),
      { predictedTickets: 95 },
    );
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const res = makeRes();
    // Khách nhìn thấy giá niêm yết, nhưng nhu cầu đã tăng thành cao điểm.
    await reserveTickets(makeReq({ expectedUnitPrice: 125001 }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'PRICE_CHANGED' }),
      }),
    );
    expect(tx.reservation.create).not.toHaveBeenCalled();
  });

  test('vẫn giữ chỗ khi giá giảm xuống thấp hơn mức khách nhìn thấy', async () => {
    const tx = withPricing(
      makeTx({
        daily: { id: 'daily-cheaper', capacity: 100, bookedQuantity: 10, heldQuantity: 5 },
        attractionStock: { id: 'attr-cheaper', capacity: 100, bookedQty: 10, heldQty: 5 },
      }),
      { predictedTickets: 10 },
    );
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const res = makeRes();
    await reserveTickets(makeReq({ expectedUnitPrice: 125001 }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    const snapshotPrice = tx.reservation.create.mock.calls[0][0].data.snapshotUnitPrice;
    expect(snapshotPrice).toBeLessThan(125001);
  });

  // expectedUnitPrice chỉ là hàng rào "không thu quá mức đã hiển thị". Client
  // gửi giá bịa thấp thì bị từ chối, tuyệt đối không được bán theo giá đó.
  test('giá bịa do client gửi lên không bao giờ trở thành giá bán', async () => {
    const tx = withPricing(
      makeTx({
        daily: { id: 'daily-forged', capacity: 100, bookedQuantity: 0, heldQuantity: 0 },
        attractionStock: { id: 'attr-forged', capacity: 100, bookedQty: 0, heldQty: 0 },
      }),
      { policy: { ...PRICING_POLICY, enabled: false } },
    );
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const res = makeRes();
    await reserveTickets(makeReq({ expectedUnitPrice: 1000 }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(tx.reservation.create).not.toHaveBeenCalled();
  });

  test('không gửi expectedUnitPrice thì luồng giữ chỗ vẫn chạy bình thường', async () => {
    const tx = withPricing(
      makeTx({
        daily: { id: 'daily-noexpect', capacity: 100, bookedQuantity: 80, heldQuantity: 10 },
        attractionStock: { id: 'attr-noexpect', capacity: 100, bookedQty: 80, heldQty: 10 },
      }),
      { predictedTickets: 95 },
    );
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const res = makeRes();
    await reserveTickets(makeReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(tx.reservation.create).toHaveBeenCalled();
  });

  test('giá động không dùng dự báo có độ tin cậy thấp', async () => {
    const tx = makeTx({
      daily: { id: 'daily-lowconf', capacity: 100, bookedQuantity: 10, heldQuantity: 5 },
      attractionStock: { id: 'attr-lowconf', capacity: 100, bookedQty: 10, heldQty: 5 },
    });
    tx.dynamicPricingPolicy.findUnique.mockResolvedValue(PRICING_POLICY);
    tx.revenueForecast.findUnique.mockResolvedValue({
      predictedTickets: 5,
      usedFallback: true, // baseline thống kê, không phải model AI
      observedDays: 60,
      sampleBookings: 500,
      modelVersion: 'historical_baseline',
      generatedAt: new Date('2026-07-27T00:00:00.000Z'),
    });
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const res = makeRes();
    await reserveTickets(makeReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(tx.reservation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ snapshotUnitPrice: 125001 }),
    });
    expect(tx.dynamicPriceAdjustment.create).not.toHaveBeenCalled();
  });

  test('trả 409 khi kho sản phẩm không còn đủ vé', async () => {
    const tx = makeTx({
      daily: {
        id: 'daily-2',
        capacity: 100,
        bookedQuantity: 98,
        heldQuantity: 1,
      },
      attractionStock: {
        id: 'attr-stock-2',
        capacity: 100,
        bookedQty: 98,
        heldQty: 1,
      },
    });
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const res = makeRes();
    await reserveTickets(makeReq({ quantity: 5 }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(409);
  });

  test('không giữ chỗ nếu giá vé live không phải số nguyên VND', async () => {
    const tx = makeTx({
      daily: {
        id: 'daily-invalid-price',
        capacity: 100,
        bookedQuantity: 0,
        heldQuantity: 0,
      },
      attractionStock: {
        id: 'attr-stock-invalid-price',
        capacity: 100,
        bookedQty: 0,
        heldQty: 0,
      },
      product: {
        ...productWithSlots(),
        sellingPrice: new Decimal('125000.5'),
      },
    });
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const res = makeRes();
    await reserveTickets(makeReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(tx.dailyStock.update).not.toHaveBeenCalled();
    expect(tx.reservation.create).not.toHaveBeenCalled();
  });

  test.each([
    [{ quantity: 0 }, 400],
    [{ quantity: 1.5 }, 400],
    [{ quantity: 21 }, 400],
    [{ quantity: Number.MAX_SAFE_INTEGER + 1 }, 400],
    [{ date: 'ngay-sai' }, 400],
    [{ date: '2026-02-31' }, 400],
    [{ date: '2026-02-29' }, 400],
  ])('từ chối dữ liệu không hợp lệ %#', async (body, status) => {
    const res = makeRes();
    await reserveTickets(makeReq(body), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(status);
  });

  test('chặn khi người dùng đã có lượt giữ chỗ trùng lựa chọn', async () => {
    const tx = makeTx({
      daily: { id: 'daily-3', capacity: 100, bookedQuantity: 0, heldQuantity: 0 },
      attractionStock: { id: 'attr-stock-3', capacity: 100, bookedQty: 0, heldQty: 0 },
    });
    tx.reservation.findFirst.mockResolvedValue({ id: 'existing-hold' });
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const res = makeRes();
    await reserveTickets(makeReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(tx.dailyStock.update).not.toHaveBeenCalled();
  });

  test('chặn lượt giữ chỗ thứ tư của cùng người dùng', async () => {
    const tx = makeTx({
      daily: { id: 'daily-4', capacity: 100, bookedQuantity: 0, heldQuantity: 0 },
      attractionStock: { id: 'attr-stock-4', capacity: 100, bookedQty: 0, heldQty: 0 },
    });
    tx.reservation.count.mockResolvedValue(3);
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const res = makeRes();
    await reserveTickets(makeReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(429);
    expect(tx.dailyStock.update).not.toHaveBeenCalled();
  });
});

describe('checkAvailability', () => {
  const slot = {
    id: 'slot-001',
    startTime: '08:00',
    endTime: '11:00',
    maxCapacity: 100,
  };

  beforeEach(() => {
    mockPrisma.ticketProduct.findUnique.mockResolvedValue(productWithSlots([slot]));
    mockPrisma.dailyStock.findUnique.mockResolvedValue(null);
    mockPrisma.attractionDailyStock.findUnique.mockResolvedValue(null);
  });

  test('trả số vé còn lại theo slot, sản phẩm và toàn điểm tham quan', async () => {
    mockPrisma.timeSlotStock.findMany.mockResolvedValue([
      { timeSlotId: slot.id, bookedQty: 30, heldQty: 10 },
    ]);

    const res = makeRes();
    await checkAvailability(
      { params: { ticketProductId: 'tkt-001' }, query: { date: VISIT_DATE } },
      res,
      jest.fn(),
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({ availableTickets: 60 }),
      ]),
    }));
  });

  test('availableTickets không âm', async () => {
    mockPrisma.ticketProduct.findUnique.mockResolvedValue(productWithSlots([
      { ...slot, maxCapacity: 10 },
    ]));
    mockPrisma.timeSlotStock.findMany.mockResolvedValue([
      { timeSlotId: slot.id, bookedQty: 8, heldQty: 5 },
    ]);

    const res = makeRes();
    await checkAvailability(
      { params: { ticketProductId: 'tkt-001' }, query: { date: VISIT_DATE } },
      res,
      jest.fn(),
    );

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({ availableTickets: 0 }),
      ]),
    }));
  });
});
