const {
  calculateRefundAmount,
  getRefundDeadline,
  getRefundEligibility,
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

  const bookingWithVisitDate = (date, refundCutoffHours = 24) => ({
    reservation: {
      date: new Date(`${date}T00:00:00.000Z`),
      timeSlot: { startTime: '10:00', endTime: '12:00' },
      ticketProduct: { refundCutoffHours },
    },
  });

  test('cho phép khi còn sớm hơn deadline hoàn tiền', () => {
    expect(isBeforeRefundCutoff(bookingWithVisitDate('2026-06-17'), nowVn)).toBe(true);
  });

  test('chặn đúng tại deadline 24 giờ trước hoạt động', () => {
    const booking = bookingWithVisitDate('2026-06-16');
    expect(getRefundDeadline(booking)).toEqual(nowVn);
    expect(isBeforeRefundCutoff(booking, nowVn)).toBe(false);
  });

  test('cho phép ngay trước deadline', () => {
    const booking = bookingWithVisitDate('2026-06-16');
    expect(isBeforeRefundCutoff(
      booking,
      new Date(nowVn.getTime() - 1),
    )).toBe(true);
  });

  test('chặn trong ngày tham quan', () => {
    expect(isBeforeRefundCutoff(bookingWithVisitDate('2026-06-15'), nowVn)).toBe(false);
  });

  test('chặn sau ngày tham quan', () => {
    expect(isBeforeRefundCutoff(bookingWithVisitDate('2026-06-14'), nowVn)).toBe(false);
  });

  test('todayInVietnam dùng đúng ngày theo giờ VN', () => {
    const lateUtc = new Date('2026-06-14T19:00:00.000Z'); // 02:00 sáng 15/06 giờ VN
    expect(todayInVietnam(lateUtc)).toBe('2026-06-15');
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

  test('uses a default fee when partial refund has no configured rate', () => {
    expect(calculateRefundAmount(bookingWithPolicy('REFUND_WITH_FEE'))).toEqual({
      refundAmount: 50000,
      feeAmount: 50000,
      policyLabel: 'REFUND_WITH_FEE (50% fee)',
    });
  });

  test('supports snapshot refund policy without loading ticket product', () => {
    expect(calculateRefundAmount({
      totalAmount: 100000,
      snapshotRefundPolicy: 'REFUND_WITH_FEE',
    })).toEqual({
      refundAmount: 50000,
      feeAmount: 50000,
      policyLabel: 'REFUND_WITH_FEE (50% fee)',
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

describe('getRefundEligibility', () => {
  function eligibleBooking(overrides = {}) {
    return {
      status: 'CONFIRMED',
      totalAmount: 100000,
      snapshotRefundPolicy: 'FREE_CANCELLATION',
      snapshotRefundFeeRate: 0,
      snapshotRefundCutoffHours: 24,
      reservation: {
        date: new Date('2026-06-20T00:00:00.000Z'),
        timeSlot: { startTime: '10:00', endTime: '12:00' },
        ticketProduct: { refundPolicy: 'FREE_CANCELLATION' },
      },
      payments: [{
        status: 'SUCCESS',
        isDuplicate: false,
        paymentGateway: 'VNPAY',
      }],
      ticketInstances: [{ status: 'VALID' }],
      refundRequests: [],
      ...overrides,
    };
  }

  const now = new Date('2026-06-18T00:00:00.000Z');

  test('cho phép booking hợp lệ trước deadline', () => {
    expect(getRefundEligibility(eligibleBooking(), now)).toEqual(
      expect.objectContaining({ refundable: true, refundAmount: 100000 }),
    );
  });

  test('chặn booking đã có vé check-in', () => {
    const booking = eligibleBooking({ ticketInstances: [{ status: 'USED' }] });
    expect(getRefundEligibility(booking, now)).toEqual(expect.objectContaining({
      refundable: false,
      notRefundableReason: expect.stringMatching(/đã có vé được sử dụng/i),
    }));
  });

  test('chặn payment không thuộc gateway hỗ trợ hoàn về phương thức gốc', () => {
    const booking = eligibleBooking({
      payments: [{ status: 'SUCCESS', isDuplicate: false, paymentGateway: 'CASH' }],
    });
    expect(getRefundEligibility(booking, now)).toEqual(expect.objectContaining({
      refundable: false,
      notRefundableReason: expect.stringMatching(/VNPay/i),
    }));
  });

  test('chặn nếu đã có customer cancellation, không nhầm với duplicate payment', () => {
    const duplicateOnly = eligibleBooking({
      refundRequests: [{ type: 'DUPLICATE_PAYMENT', status: 'PROCESSING' }],
    });
    expect(getRefundEligibility(duplicateOnly, now).refundable).toBe(true);

    const withCustomerRequest = eligibleBooking({
      refundRequests: [{ type: 'CUSTOMER_CANCELLATION', status: 'REJECTED' }],
    });
    expect(getRefundEligibility(withCustomerRequest, now).refundable).toBe(false);
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
