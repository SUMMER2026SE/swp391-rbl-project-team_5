const {
  calculateRefundAmount,
  releaseInventory,
  isBeforeRefundCutoff,
  todayInVietnam,
} = require('../utils/refundService');

function bookingWithPolicy(refundPolicy, refundFeeRate = 0) {
  return {
    totalAmount: 100000,
    reservation: {
      ticketProduct: { refundPolicy, refundFeeRate },
    },
  };
}

describe('isBeforeRefundCutoff', () => {
  // 10:00 sáng 15/06/2026 giờ VN = 03:00 UTC cùng ngày.
  const nowVn = new Date('2026-06-15T03:00:00.000Z');

  const bookingWithVisitDate = (date) => ({
    reservation: { date: new Date(`${date}T00:00:00.000Z`) },
  });

  test('cho phép khi ngày tham quan ở tương lai', () => {
    expect(isBeforeRefundCutoff(bookingWithVisitDate('2026-06-16'), nowVn)).toBe(true);
  });

  test('chặn ngay TRONG ngày tham quan (vé đang được sử dụng)', () => {
    expect(isBeforeRefundCutoff(bookingWithVisitDate('2026-06-15'), nowVn)).toBe(false);
  });

  test('chặn sau ngày tham quan', () => {
    expect(isBeforeRefundCutoff(bookingWithVisitDate('2026-06-14'), nowVn)).toBe(false);
  });

  test('dùng ngày theo giờ VN: 19:00 UTC 14/06 đã là ngày 15/06 ở VN', () => {
    const lateUtc = new Date('2026-06-14T19:00:00.000Z'); // 02:00 sáng 15/06 giờ VN
    expect(todayInVietnam(lateUtc)).toBe('2026-06-15');
    expect(isBeforeRefundCutoff(bookingWithVisitDate('2026-06-15'), lateUtc)).toBe(false);
  });

  test('chặn khi booking thiếu ngày tham quan', () => {
    expect(isBeforeRefundCutoff({ reservation: {} }, nowVn)).toBe(false);
  });
});

describe('calculateRefundAmount', () => {
  test('returns the full amount for free cancellation', () => {
    expect(calculateRefundAmount(bookingWithPolicy('FREE_CANCELLATION'))).toEqual({
      refundAmount: 100000,
      feeAmount: 0,
      policyLabel: 'FREE_CANCELLATION',
    });
  });

  test('deducts the configured fee', () => {
    expect(
      calculateRefundAmount(bookingWithPolicy('REFUND_WITH_FEE', 0.1)),
    ).toEqual({
      refundAmount: 90000,
      feeAmount: 10000,
      policyLabel: 'REFUND_WITH_FEE (10% fee)',
    });
  });

  test('returns zero when the ticket is non-refundable', () => {
    expect(calculateRefundAmount(bookingWithPolicy('NON_REFUNDABLE'))).toEqual({
      refundAmount: 0,
      feeAmount: 100000,
      policyLabel: 'NON_REFUNDABLE',
    });
  });
});

describe('releaseInventory', () => {
  test('returns daily and time-slot stock for a confirmed reservation', async () => {
    const tx = {
      dailyStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      attractionDailyStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      timeSlotStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      reservation: { update: jest.fn().mockResolvedValue({}) },
    };
    const booking = {
      reservation: {
        id: 'reservation-1',
        ticketProductId: 'ticket-1',
        timeSlotId: 'slot-1',
        date: new Date('2026-06-10T00:00:00.000Z'),
        quantity: 2,
        status: 'CONFIRMED',
        ticketProduct: { attractionId: 'attraction-1' },
      },
    };

    await releaseInventory(tx, booking);

    expect(tx.dailyStock.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { bookedQuantity: { decrement: 2 } },
      }),
    );
    expect(tx.timeSlotStock.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { bookedQty: { decrement: 2 } },
      }),
    );
    expect(tx.reservation.update).toHaveBeenCalledWith({
      where: { id: 'reservation-1' },
      data: { status: 'CANCELLED' },
    });
  });

  test('does not change stock for a reservation that is not confirmed', async () => {
    const tx = {
      dailyStock: { updateMany: jest.fn() },
      attractionDailyStock: { updateMany: jest.fn() },
      timeSlotStock: { updateMany: jest.fn() },
      reservation: { update: jest.fn() },
    };

    await releaseInventory(tx, {
      reservation: { status: 'CANCELLED' },
    });

    expect(tx.dailyStock.updateMany).not.toHaveBeenCalled();
    expect(tx.reservation.update).not.toHaveBeenCalled();
  });
});
