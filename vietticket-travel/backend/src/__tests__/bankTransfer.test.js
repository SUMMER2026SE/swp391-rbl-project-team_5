'use strict';

jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
jest.mock('../controllers/bookingController', () => ({
  confirmReservationAndStock: jest.fn(),
  createTicketInstances: jest.fn(),
}));
jest.mock('../services/loyaltyService', () => ({ awardPointsForBooking: jest.fn() }));
jest.mock('../services/mandatoryRefundService', () => ({
  queueMandatoryRefund: jest.fn(),
}));
jest.mock('../utils/auditLog', () => ({ writeAuditLog: jest.fn() }));

const mockPrisma = require('./helpers/mockPrisma');
const {
  confirmReservationAndStock,
  createTicketInstances,
} = require('../controllers/bookingController');
const { awardPointsForBooking } = require('../services/loyaltyService');
const { queueMandatoryRefund } = require('../services/mandatoryRefundService');
const {
  buildVietQrPayload,
  crc16,
  sanitizeTransferContent,
} = require('../utils/vietqr');
const { buildTransferContent } = require('../utils/bankTransferPolicy');

const BOOKING_ID = 'aaaaaaaa-bbbb-cccc-dddd-1234567890ab';

// Cấu hình ngân hàng giả lập cho test.
const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  queueMandatoryRefund.mockResolvedValue({
    queued: true,
    refundRequest: { id: 'refund-late-payment' },
    refundTransaction: null,
    processingMode: 'MANUAL_BANK_TRANSFER',
  });
  process.env.BANK_BIN = '970436';
  process.env.BANK_ACCOUNT_NUMBER = '1234567890';
  process.env.BANK_ACCOUNT_NAME = 'NGUYEN VAN A';
  process.env.BANK_NAME = 'Vietcombank';
});
afterAll(() => {
  process.env = ORIGINAL_ENV;
});

function makeTx() {
  return {
    booking: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    reservation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    dailyStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    attractionDailyStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    timeSlotStock: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    voucher: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    payment: {
      upsert: jest.fn().mockResolvedValue({
        id: 'payment-bank-transfer',
        amount: 250000,
        paymentGateway: 'BANK_TRANSFER',
        transactionId: `BT-${BOOKING_ID}`,
        status: 'SUCCESS',
        isDuplicate: false,
      }),
    },
  };
}

function bookingFixture(overrides = {}) {
  return {
    id: BOOKING_ID,
    userId: 'user-1',
    status: 'PENDING_PAYMENT',
    paymentMethod: 'bank_transfer',
    payments: [],
    totalAmount: 250000,
    isForecastTrainingSample: false,
    reservation: {
      id: 'res-1',
      status: 'HELD',
      ticketProductId: 'tkt-1',
      timeSlotId: null,
      date: new Date('2026-08-01T00:00:00.000Z'),
      quantity: 2,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      ticketProduct: {
        attractionId: 'attraction-1',
        status: 'ACTIVE',
        archivedAt: null,
        attraction: {
          requiresManualApproval: false,
          publishedAt: new Date('2026-01-01'),
          publicationStatus: 'ACTIVE',
          status: 'APPROVED',
          archivedAt: null,
          partner: { status: 'APPROVED' },
        },
      },
    },
    ...overrides,
  };
}

// ============================================================
describe('VietQR payload', () => {
  test('CRC-16/CCITT-FALSE khớp vector chuẩn', () => {
    expect(crc16('123456789')).toBe('29B1');
  });

  test('payload tự kiểm tra được CRC ở cuối chuỗi', () => {
    const payload = buildVietQrPayload({
      bankBin: '970436',
      accountNumber: '1234567890',
      amount: 250000,
      content: 'VT1234567890AB',
    });
    expect(crc16(payload.slice(0, -4))).toBe(payload.slice(-4));
  });

  test('chứa đúng BIN, số tài khoản, số tiền và nội dung', () => {
    const payload = buildVietQrPayload({
      bankBin: '970436',
      accountNumber: '1234567890',
      amount: 250000,
      content: 'VT1234567890AB',
    });
    expect(payload).toContain('A000000727'); // GUID VietQR
    expect(payload).toContain('QRIBFTTA'); // chuyển tới tài khoản
    expect(payload).toContain('970436');
    expect(payload).toContain('1234567890');
    expect(payload).toContain('5406250000'); // TLV 54: số tiền 250000
    expect(payload).toContain('5303704'); // TLV 53: VND
    expect(payload).toContain('VT1234567890AB');
  });

  test('không có số tiền -> QR tĩnh (initiation 11)', () => {
    const payload = buildVietQrPayload({ bankBin: '970436', accountNumber: '1234567890' });
    expect(payload.startsWith('000201010211')).toBe(true);
  });

  test('có số tiền -> QR động (initiation 12)', () => {
    const payload = buildVietQrPayload({
      bankBin: '970436', accountNumber: '1234567890', amount: 1000,
    });
    expect(payload.startsWith('000201010212')).toBe(true);
  });

  test('từ chối BIN và số tài khoản không hợp lệ', () => {
    expect(() => buildVietQrPayload({ bankBin: '123', accountNumber: '1234567890' })).toThrow(/BIN/u);
    expect(() => buildVietQrPayload({ bankBin: '970436', accountNumber: 'abc' })).toThrow(/tài khoản/u);
  });

  test('nội dung chuyển khoản bỏ dấu tiếng Việt và ký tự đặc biệt', () => {
    expect(sanitizeTransferContent('Thanh toán vé đơn #1')).toBe('Thanh toan ve don 1');
  });

  test('nội dung đối soát sinh từ mã đơn, bỏ dấu gạch', () => {
    expect(buildTransferContent(BOOKING_ID)).toBe('VT1234567890AB');
  });
});

// ============================================================
describe('confirmBankTransfer', () => {
  // require sau khi env đã set để service đọc đúng cấu hình
  const { confirmBankTransfer } = require('../services/bankTransferService');

  function wire(tx) {
    mockPrisma.$transaction.mockImplementation(async (fn) => fn(tx));
  }

  test('xác nhận thành công: chốt kho, phát vé, cộng điểm, ghi nhận thu', async () => {
    const tx = makeTx();
    tx.booking.findUnique.mockResolvedValue(bookingFixture());
    wire(tx);

    const result = await confirmBankTransfer({ bookingId: BOOKING_ID, actorId: 'admin-1' });

    expect(result.bookingStatus).toBe('CONFIRMED');
    expect(confirmReservationAndStock).toHaveBeenCalled();
    expect(createTicketInstances).toHaveBeenCalledWith(tx, BOOKING_ID, 'tkt-1', 2);
    expect(awardPointsForBooking).toHaveBeenCalled();
    // transactionId duy nhất theo đơn -> chống ghi nhận thu trùng
    expect(tx.payment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { transactionId: `BT-${BOOKING_ID}` },
        create: expect.objectContaining({ paymentGateway: 'BANK_TRANSFER', status: 'SUCCESS' }),
      }),
    );
  });

  test('địa điểm cần duyệt tay -> PENDING_PARTNER, chưa phát vé', async () => {
    const booking = bookingFixture();
    booking.reservation.ticketProduct.attraction.requiresManualApproval = true;
    const tx = makeTx();
    tx.booking.findUnique.mockResolvedValue(booking);
    wire(tx);

    const result = await confirmBankTransfer({ bookingId: BOOKING_ID, actorId: 'admin-1' });

    expect(result.bookingStatus).toBe('PENDING_PARTNER');
    expect(createTicketInstances).not.toHaveBeenCalled();
    expect(awardPointsForBooking).not.toHaveBeenCalled();
  });

  test('idempotent: đơn đã xác nhận thì không xử lý lại', async () => {
    const tx = makeTx();
    tx.booking.findUnique.mockResolvedValue(bookingFixture({ status: 'CONFIRMED' }));
    wire(tx);

    const result = await confirmBankTransfer({ bookingId: BOOKING_ID, actorId: 'admin-1' });

    expect(result.alreadyConfirmed).toBe(true);
    expect(confirmReservationAndStock).not.toHaveBeenCalled();
    expect(tx.payment.upsert).not.toHaveBeenCalled();
  });

  test('tiền đến sau khi giữ chỗ hết hạn -> ghi nhận tiền và tự mở hồ sơ hoàn 100%', async () => {
    const tx = makeTx();
    tx.booking.findUnique.mockResolvedValue(
      bookingFixture({
        reservation: { ...bookingFixture().reservation, status: 'EXPIRED' },
      }),
    );
    wire(tx);

    const result = await confirmBankTransfer({ bookingId: BOOKING_ID, actorId: 'admin-1' });

    expect(result).toEqual(expect.objectContaining({
      latePayment: true,
      bookingStatus: 'CANCELLED',
      refundRequestId: 'refund-late-payment',
    }));
    expect(tx.payment.upsert).toHaveBeenCalled();
    expect(queueMandatoryRefund).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        id: BOOKING_ID,
        status: 'CANCELLED',
        refundRequired: true,
      }),
      expect.objectContaining({ type: 'SYSTEM_CANCELLATION' }),
    );
    expect(confirmReservationAndStock).not.toHaveBeenCalled();
  });

  test('tiền đến sau khi đơn đã hủy -> không phát vé và tự mở hồ sơ hoàn', async () => {
    const tx = makeTx();
    tx.booking.findUnique.mockResolvedValue(bookingFixture({ status: 'CANCELLED' }));
    wire(tx);

    const result = await confirmBankTransfer({ bookingId: BOOKING_ID, actorId: 'admin-1' });

    expect(result.latePayment).toBe(true);
    expect(result.bookingStatus).toBe('CANCELLED');
    expect(createTicketInstances).not.toHaveBeenCalled();
    expect(queueMandatoryRefund).toHaveBeenCalled();
  });

  test('xác nhận lặp tiền đến muộn -> idempotent, không mở thêm hồ sơ hoàn', async () => {
    const tx = makeTx();
    tx.booking.findUnique.mockResolvedValue(bookingFixture({
      status: 'CANCELLED',
      payments: [{
        id: 'payment-bank-transfer',
        amount: 250000,
        paymentGateway: 'BANK_TRANSFER',
        transactionId: `BT-${BOOKING_ID}`,
        status: 'SUCCESS',
        isDuplicate: false,
      }],
    }));
    wire(tx);

    const result = await confirmBankTransfer({ bookingId: BOOKING_ID, actorId: 'admin-1' });

    expect(result).toEqual(expect.objectContaining({
      alreadyConfirmed: true,
      latePayment: true,
      bookingStatus: 'CANCELLED',
    }));
    expect(tx.payment.upsert).not.toHaveBeenCalled();
    expect(queueMandatoryRefund).not.toHaveBeenCalled();
  });

  test('đơn thanh toán VNPay -> từ chối xác nhận thủ công', async () => {
    const tx = makeTx();
    tx.booking.findUnique.mockResolvedValue(bookingFixture({ paymentMethod: 'vnpay' }));
    wire(tx);

    await expect(confirmBankTransfer({ bookingId: BOOKING_ID, actorId: 'admin-1' }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('tiền đến khi gói vé đã ngừng bán -> không chốt kho và tự mở hồ sơ hoàn', async () => {
    const booking = bookingFixture();
    booking.voucherId = 'voucher-1';
    booking.reservation.ticketProduct.attraction.partner.status = 'SUSPENDED';
    const tx = makeTx();
    tx.booking.findUnique.mockResolvedValue(booking);
    wire(tx);

    const result = await confirmBankTransfer({ bookingId: BOOKING_ID, actorId: 'admin-1' });

    expect(result.latePayment).toBe(true);
    expect(queueMandatoryRefund).toHaveBeenCalled();
    expect(confirmReservationAndStock).not.toHaveBeenCalled();
    expect(tx.reservation.updateMany).toHaveBeenCalledWith({
      where: { id: 'res-1', status: 'HELD' },
      data: { status: 'CANCELLED' },
    });
    expect(tx.dailyStock.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { heldQuantity: { decrement: 2 } },
    }));
    expect(tx.attractionDailyStock.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { heldQty: { decrement: 2 } },
    }));
    expect(tx.voucher.updateMany).toHaveBeenCalledWith({
      where: { id: 'voucher-1', usedCount: { gt: 0 } },
      data: { usedCount: { decrement: 1 } },
    });
  });

  test('không tìm thấy đơn -> 404', async () => {
    const tx = makeTx();
    tx.booking.findUnique.mockResolvedValue(null);
    wire(tx);

    await expect(confirmBankTransfer({ bookingId: BOOKING_ID, actorId: 'admin-1' }))
      .rejects.toMatchObject({ statusCode: 404 });
  });
});

// ============================================================
describe('chính sách giữ chỗ cho chuyển khoản', () => {
  test('mặc định 60 phút, kẹp trong [15, 720]', () => {
    jest.resetModules();
    const policy = require('../utils/bankTransferPolicy');
    delete process.env.BANK_TRANSFER_HOLD_MINUTES;
    expect(policy.getBankTransferHoldMinutes()).toBe(60);

    process.env.BANK_TRANSFER_HOLD_MINUTES = '5';
    expect(policy.getBankTransferHoldMinutes()).toBe(15);

    process.env.BANK_TRANSFER_HOLD_MINUTES = '99999';
    expect(policy.getBankTransferHoldMinutes()).toBe(720);

    process.env.BANK_TRANSFER_HOLD_MINUTES = '90';
    expect(policy.getBankTransferHoldMinutes()).toBe(90);
    delete process.env.BANK_TRANSFER_HOLD_MINUTES;
  });

  test('hạn giữ chỗ chuyển khoản dài hơn hẳn mặc định 10 phút', () => {
    const policy = require('../utils/bankTransferPolicy');
    expect(policy.getBankTransferHoldMs()).toBeGreaterThan(10 * 60 * 1000);
  });
});
