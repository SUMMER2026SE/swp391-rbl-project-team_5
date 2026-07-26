'use strict';

const mockPrisma = require('./helpers/mockPrisma');

jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));

const {
  computeEarnedPoints,
  getRedemptionTier,
  awardPointsForBooking,
  reversePointsForBooking,
  redeemPoints,
  getCatalog,
  getRedeemableBalance,
} = require('../services/loyaltyService');

// Tạo mock transaction client với các model điểm/voucher/user.
function makeTx() {
  return {
    user: { findUnique: jest.fn(), update: jest.fn() },
    voucher: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    loyaltyTransaction: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      // Mặc định không có điểm bị khóa; test nào cần sẽ override.
      aggregate: jest.fn().mockResolvedValue({ _sum: { points: 0 } }),
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('computeEarnedPoints', () => {
  test('tích 1 điểm cho mỗi 1.000đ, làm tròn xuống', () => {
    expect(computeEarnedPoints(200000)).toBe(200);
    expect(computeEarnedPoints(199999)).toBe(199);
    expect(computeEarnedPoints(999)).toBe(0);
  });

  test('số tiền không hợp lệ trả về 0', () => {
    expect(computeEarnedPoints(0)).toBe(0);
    expect(computeEarnedPoints(-5000)).toBe(0);
    expect(computeEarnedPoints(null)).toBe(0);
    expect(computeEarnedPoints('abc')).toBe(0);
  });
});

describe('awardPointsForBooking', () => {
  test('cộng điểm và ghi sổ cái khi đơn hợp lệ', async () => {
    const tx = makeTx();
    tx.loyaltyTransaction.findUnique.mockResolvedValue(null);
    tx.user.update.mockResolvedValue({ loyaltyPoints: 200 });
    tx.loyaltyTransaction.create.mockResolvedValue({ id: 'lt-1', points: 200 });

    const result = await awardPointsForBooking(tx, {
      id: 'booking-1',
      userId: 'user-1',
      totalAmount: 200000,
      isForecastTrainingSample: false,
    });

    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user-1' },
      data: { loyaltyPoints: { increment: 200 } },
    }));
    expect(tx.loyaltyTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: 'EARN',
        points: 200,
        balanceAfter: 200,
        bookingId: 'booking-1',
      }),
    }));
    expect(result).toEqual({ id: 'lt-1', points: 200 });
  });

  test('idempotent: đơn đã cộng điểm thì không cộng lần hai', async () => {
    const tx = makeTx();
    tx.loyaltyTransaction.findUnique.mockResolvedValue({ id: 'lt-existing', points: 200 });

    const result = await awardPointsForBooking(tx, {
      id: 'booking-1',
      userId: 'user-1',
      totalAmount: 200000,
      isForecastTrainingSample: false,
    });

    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.loyaltyTransaction.create).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'lt-existing', points: 200 });
  });

  test('bỏ qua dữ liệu giả lập dự báo (isForecastTrainingSample)', async () => {
    const tx = makeTx();
    const result = await awardPointsForBooking(tx, {
      id: 'booking-1',
      userId: 'user-1',
      totalAmount: 200000,
      isForecastTrainingSample: true,
    });
    expect(result).toBeNull();
    expect(tx.loyaltyTransaction.findUnique).not.toHaveBeenCalled();
  });

  test('không cộng khi số điểm bằng 0', async () => {
    const tx = makeTx();
    const result = await awardPointsForBooking(tx, {
      id: 'booking-1',
      userId: 'user-1',
      totalAmount: 500,
      isForecastTrainingSample: false,
    });
    expect(result).toBeNull();
    expect(tx.user.update).not.toHaveBeenCalled();
  });
});

describe('reversePointsForBooking', () => {
  test('thu hồi đúng số điểm đã cộng', async () => {
    const tx = makeTx();
    tx.loyaltyTransaction.findUnique
      .mockResolvedValueOnce({ userId: 'user-1', points: 200 }) // EARN
      .mockResolvedValueOnce(null); // REVERSAL chưa có
    tx.user.update.mockResolvedValue({ loyaltyPoints: -50 });
    tx.loyaltyTransaction.create.mockResolvedValue({ id: 'lt-rev', points: -200 });
    tx.voucher.findMany.mockResolvedValue([]); // không có voucher chưa dùng để thu hồi

    const result = await reversePointsForBooking(tx, { id: 'booking-1' });

    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { loyaltyPoints: { decrement: 200 } },
    }));
    expect(tx.loyaltyTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'REVERSAL', points: -200, balanceAfter: -50 }),
    }));
    expect(result).toEqual({ id: 'lt-rev', points: -200 });
  });

  test('số dư âm sau thu hồi -> tự thu hồi voucher loyalty chưa dùng để bù', async () => {
    const tx = makeTx();
    // EARN 200, chưa REVERSAL. Sau khi trừ, số dư = -200 (khách đã đổi hết điểm).
    tx.loyaltyTransaction.findUnique
      .mockResolvedValueOnce({ userId: 'user-1', points: 200 })
      .mockResolvedValueOnce(null);
    tx.user.update
      .mockResolvedValueOnce({ loyaltyPoints: -200 }) // sau REVERSAL
      .mockResolvedValueOnce({ loyaltyPoints: 0 }); // sau khi hoàn điểm voucher
    tx.loyaltyTransaction.create.mockResolvedValue({ id: 'lt-rev' });
    // Một voucher loyalty chưa dùng, đổi tốn 200 điểm.
    tx.voucher.findMany.mockResolvedValue([{ id: 'v-1', code: 'LTXXXX', usedCount: 0, isActive: true }]);
    tx.loyaltyTransaction.findFirst.mockResolvedValue({ points: -200 });

    await reversePointsForBooking(tx, { id: 'booking-1' });

    // Voucher bị vô hiệu hóa.
    expect(tx.voucher.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'v-1' },
      data: { isActive: false },
    }));
    // Hoàn lại 200 điểm cho khách.
    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { loyaltyPoints: { increment: 200 } },
    }));
    // Ghi sổ ADJUSTMENT đưa số dư về 0.
    expect(tx.loyaltyTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'ADJUSTMENT', points: 200, balanceAfter: 0, voucherId: 'v-1' }),
    }));
  });

  test('không thu hồi voucher nếu số dư vẫn dương sau thu hồi', async () => {
    const tx = makeTx();
    tx.loyaltyTransaction.findUnique
      .mockResolvedValueOnce({ userId: 'user-1', points: 200 })
      .mockResolvedValueOnce(null);
    tx.user.update.mockResolvedValue({ loyaltyPoints: 300 }); // vẫn dương
    tx.loyaltyTransaction.create.mockResolvedValue({ id: 'lt-rev' });

    await reversePointsForBooking(tx, { id: 'booking-1' });

    expect(tx.voucher.findMany).not.toHaveBeenCalled();
    expect(tx.voucher.update).not.toHaveBeenCalled();
  });

  test('không làm gì nếu đơn chưa từng cộng điểm', async () => {
    const tx = makeTx();
    tx.loyaltyTransaction.findUnique.mockResolvedValueOnce(null);
    const result = await reversePointsForBooking(tx, { id: 'booking-1' });
    expect(result).toBeNull();
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  test('idempotent: đã thu hồi rồi thì thôi', async () => {
    const tx = makeTx();
    tx.loyaltyTransaction.findUnique
      .mockResolvedValueOnce({ userId: 'user-1', points: 200 }) // EARN
      .mockResolvedValueOnce({ id: 'lt-rev-existing', points: -200 }); // REVERSAL đã có
    const result = await reversePointsForBooking(tx, { id: 'booking-1' });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'lt-rev-existing', points: -200 });
  });
});

describe('redeemPoints', () => {
  function wireTransaction(tx) {
    mockPrisma.$transaction.mockImplementation(async (fn) => fn(tx));
  }

  test('đổi điểm thành công tạo voucher cá nhân và trừ điểm', async () => {
    const tx = makeTx();
    tx.user.findUnique.mockResolvedValue({ loyaltyPoints: 1000 });
    tx.voucher.findUnique.mockResolvedValue(null); // mã không trùng
    tx.voucher.create.mockResolvedValue({
      id: 'v-1', code: 'LTABCDEFGH', discountValue: 50000, minSpend: 200000, expiryDate: new Date(),
    });
    tx.user.update.mockResolvedValue({ loyaltyPoints: 0 });
    tx.loyaltyTransaction.create.mockResolvedValue({ id: 'lt-redeem' });
    wireTransaction(tx);

    const result = await redeemPoints({ userId: 'user-1', tierId: 'LT_50K' });

    expect(tx.voucher.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        source: 'LOYALTY',
        userId: 'user-1',
        usageLimit: 1,
        discountType: 'FIXED',
        discountValue: 50000,
      }),
    }));
    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { loyaltyPoints: { decrement: 1000 } },
    }));
    expect(result.balance).toBe(0);
  });

  test('từ chối khi không đủ điểm', async () => {
    const tx = makeTx();
    tx.user.findUnique.mockResolvedValue({ loyaltyPoints: 100 });
    wireTransaction(tx);

    await expect(redeemPoints({ userId: 'user-1', tierId: 'LT_50K' }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(tx.voucher.create).not.toHaveBeenCalled();
  });

  test('từ chối khi đủ điểm GỘP nhưng điểm bị KHÓA (đơn chưa hoàn tất chuyến đi)', async () => {
    const tx = makeTx();
    // Có 1000 điểm nhưng 1000 đều từ đơn CONFIRMED (chưa giữ chắc) -> khóa hết.
    tx.user.findUnique.mockResolvedValue({ loyaltyPoints: 1000 });
    tx.loyaltyTransaction.aggregate.mockResolvedValue({ _sum: { points: 1000 } });
    wireTransaction(tx);

    await expect(redeemPoints({ userId: 'user-1', tierId: 'LT_50K' }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(tx.voucher.create).not.toHaveBeenCalled();
  });

  test('cho đổi phần điểm khả dụng dù còn điểm bị khóa', async () => {
    const tx = makeTx();
    // 1200 điểm, khóa 400 -> khả dụng 800, đủ cho gói 500 điểm (LT_25K).
    tx.user.findUnique.mockResolvedValue({ loyaltyPoints: 1200 });
    tx.loyaltyTransaction.aggregate.mockResolvedValue({ _sum: { points: 400 } });
    tx.voucher.findUnique.mockResolvedValue(null);
    tx.voucher.create.mockResolvedValue({ id: 'v-2', code: 'LTZZZZ', discountValue: 25000, minSpend: 100000, expiryDate: new Date() });
    tx.user.update.mockResolvedValue({ loyaltyPoints: 700 });
    tx.loyaltyTransaction.create.mockResolvedValue({ id: 'lt-redeem2' });
    wireTransaction(tx);

    const result = await redeemPoints({ userId: 'user-1', tierId: 'LT_25K' });
    expect(tx.voucher.create).toHaveBeenCalled();
    expect(result.balance).toBe(700);
  });

  test('từ chối gói đổi điểm không hợp lệ', async () => {
    await expect(redeemPoints({ userId: 'user-1', tierId: 'KHONG_TON_TAI' }))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('getCatalog', () => {
  test('gắn cờ affordable theo số dư', () => {
    const catalog = getCatalog(600);
    const byId = Object.fromEntries(catalog.map((t) => [t.id, t.affordable]));
    expect(byId.LT_10K).toBe(true); // 200 điểm
    expect(byId.LT_25K).toBe(true); // 500 điểm
    expect(byId.LT_50K).toBe(false); // 1000 điểm
  });
});

describe('getRedeemableBalance', () => {
  test('điểm khả dụng = số dư - điểm bị khóa', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ loyaltyPoints: 1000 });
    mockPrisma.loyaltyTransaction.aggregate.mockResolvedValue({ _sum: { points: 300 } });

    const result = await getRedeemableBalance('user-1', mockPrisma);
    expect(result).toEqual({ balance: 1000, locked: 300, redeemable: 700 });
  });

  test('kẹp điểm khóa không vượt số dư (biên)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ loyaltyPoints: 100 });
    mockPrisma.loyaltyTransaction.aggregate.mockResolvedValue({ _sum: { points: 500 } });

    const result = await getRedeemableBalance('user-1', mockPrisma);
    expect(result).toEqual({ balance: 100, locked: 100, redeemable: 0 });
  });

  test('không có điểm khóa -> khả dụng = số dư', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ loyaltyPoints: 250 });
    mockPrisma.loyaltyTransaction.aggregate.mockResolvedValue({ _sum: { points: null } });

    const result = await getRedeemableBalance('user-1', mockPrisma);
    expect(result).toEqual({ balance: 250, locked: 0, redeemable: 250 });
  });
});

describe('getRedemptionTier', () => {
  test('trả về tier đúng theo id', () => {
    expect(getRedemptionTier('LT_50K')).toMatchObject({ pointsCost: 1000, discountValue: 50000 });
    expect(getRedemptionTier('nope')).toBeNull();
  });
});
