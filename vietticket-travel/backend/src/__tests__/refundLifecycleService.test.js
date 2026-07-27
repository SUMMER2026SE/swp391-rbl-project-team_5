'use strict';

jest.mock('../utils/refundService', () => ({
  releaseInventory: jest.fn(),
}));

const {
  REFUND_GATEWAY_OUTCOME,
  assertRefundCanBeSubmitted,
  classifyVnpayReconciliationResult,
  classifyVnpayRefundResult,
  finalizeSuccessfulRefund,
  getRefundProcessingEligibility,
  getPaymentRefundBalance,
} = require('../services/refundLifecycleService');
const { releaseInventory } = require('../utils/refundService');

describe('refund processing eligibility', () => {
  test('blocks legacy payments that cannot be safely refunded through VNPay', () => {
    expect(getRefundProcessingEligibility({
      id: 'payment-1',
      transactionId: 'txn-1',
      rawResponse: {},
    })).toEqual(expect.objectContaining({
      canApprove: false,
      mode: 'BLOCKED',
    }));
  });

  test('allows a complete VNPay payment', () => {
    expect(getRefundProcessingEligibility({
      id: 'payment-1',
      transactionId: 'txn-1',
      rawResponse: {
        vnp_TransactionNo: '14000001',
        vnp_CreateDate: '20260720103000',
      },
    })).toEqual({ canApprove: true, mode: 'VNPAY', blockReason: null });
  });

  test('allows only the explicit non-production operational fixture to use the local adapter', () => {
    expect(getRefundProcessingEligibility({
      id: 'a3658042-595f-4c3d-a6c1-38fc6ac97192',
      transactionId: 'VNPAY01K8X4C2',
      rawResponse: { source: 'operational_fixture_v2' },
    })).toEqual({ canApprove: true, mode: 'LOCAL_DEMO', blockReason: null });
  });
});

describe('classifyVnpayRefundResult', () => {
  test.each([
    [{ responseCode: '00', transactionStatus: '00' }, REFUND_GATEWAY_OUTCOME.SUCCESS],
    [{ responseCode: '00', transactionStatus: '05' }, REFUND_GATEWAY_OUTCOME.PENDING_RECONCILIATION],
    [{ responseCode: '00', transactionStatus: '06' }, REFUND_GATEWAY_OUTCOME.PENDING_RECONCILIATION],
    [{ responseCode: '94', transactionStatus: '05' }, REFUND_GATEWAY_OUTCOME.PENDING_RECONCILIATION],
    [{ responseCode: '99', transactionStatus: '' }, REFUND_GATEWAY_OUTCOME.PENDING_RECONCILIATION],
    [{ responseCode: '00', transactionStatus: '09' }, REFUND_GATEWAY_OUTCOME.FAILED],
    [{ responseCode: '95', transactionStatus: '' }, REFUND_GATEWAY_OUTCOME.FAILED],
  ])('phân loại %# đúng state machine', (result, expected) => {
    expect(classifyVnpayRefundResult(result)).toBe(expected);
  });
});

describe('classifyVnpayReconciliationResult', () => {
  const transaction = { transactionType: '03', amount: 90000 };

  test('chỉ thành công khi type, amount và status đều khớp', () => {
    expect(classifyVnpayReconciliationResult({
      responseCode: '00',
      transactionStatus: '00',
      transactionType: '03',
      amount: 90000,
    }, transaction)).toBe(REFUND_GATEWAY_OUTCOME.SUCCESS);
  });

  test.each([
    { transactionType: '02', amount: 90000 },
    { transactionType: '03', amount: 100000 },
    { transactionType: '01', amount: 100000 },
  ])('không xác nhận nhầm giao dịch khác: %o', (result) => {
    expect(classifyVnpayReconciliationResult({
      responseCode: '00',
      transactionStatus: '00',
      ...result,
    }, transaction)).toBe(REFUND_GATEWAY_OUTCOME.PENDING_RECONCILIATION);
  });
});

describe('refund balance', () => {
  const payment = { id: 'payment-1', amount: 100000 };

  test('trừ các khoản đã hoàn thành của request khác', () => {
    expect(getPaymentRefundBalance({
      payment,
      currentRefundRequestId: 'refund-current',
      transactions: [{
        paymentId: 'payment-1',
        refundRequestId: 'refund-old',
        amount: 30000,
        status: 'SUCCESS',
      }],
    })).toEqual(expect.objectContaining({
      capturedAmount: 100000,
      successfulAmount: 30000,
      availableAmount: 70000,
    }));
  });

  test('chặn gửi mới khi payment có giao dịch chưa rõ kết quả', () => {
    expect(() => assertRefundCanBeSubmitted({
      refundRequest: { id: 'refund-current', amount: 50000 },
      payment,
      transactions: [{
        id: 'transaction-old',
        paymentId: 'payment-1',
        refundRequestId: 'refund-old',
        amount: 50000,
        status: 'NEEDS_RECONCILIATION',
      }],
    })).toThrow(/đối soát/i);
  });

  test('chặn tổng tiền hoàn vượt số dư còn lại', () => {
    expect(() => assertRefundCanBeSubmitted({
      refundRequest: { id: 'refund-current', amount: 80000 },
      payment,
      transactions: [{
        paymentId: 'payment-1',
        refundRequestId: 'refund-old',
        amount: 30000,
        status: 'SUCCESS',
      }],
    })).toThrow(/vượt quá số dư/i);
  });
});

describe('VietTicket Rescue refund finalization', () => {
  afterEach(() => jest.clearAllMocks());

  function makeTx(refundRequest) {
    return {
      refundRequest: {
        findUnique: jest.fn().mockResolvedValue(refundRequest),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockResolvedValue({ ...refundRequest, status: 'APPROVED' }),
      },
      refundTransaction: { update: jest.fn().mockResolvedValue({}) },
      booking: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      ticketInstance: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      recoveryCase: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'case-1',
          originalBookingId: refundRequest.booking.id,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
  }

  test('a difference refund does not mislabel the source booking as fully refunded', async () => {
    const refundRequest = {
      id: 'refund-difference',
      requestKey: 'recovery-difference:case-1',
      type: 'PARTNER_CANCELLATION',
      status: 'PROCESSING',
      booking: {
        id: 'booking-old',
        status: 'CANCELLED',
        ticketInstances: [{ id: 'ticket-old', status: 'EXPIRED' }],
        reservation: { status: 'CANCELLED', ticketProduct: {} },
      },
    };
    const tx = makeTx(refundRequest);

    await finalizeSuccessfulRefund(tx, {
      refundRequestId: refundRequest.id,
      refundTransactionId: 'transaction-1',
    });

    expect(releaseInventory).not.toHaveBeenCalled();
    expect(tx.ticketInstance.updateMany).not.toHaveBeenCalled();
    expect(tx.booking.update).toHaveBeenCalledWith({
      where: { id: 'booking-old' },
      data: { refundRequired: false },
    });
    expect(tx.recoveryCase.updateMany).not.toHaveBeenCalled();
  });

  test('a customer cancellation refunds and releases the Rescue replacement', async () => {
    const refundRequest = {
      id: 'refund-recovery-customer',
      requestKey: 'recovery-customer:booking-replacement',
      targetBookingId: 'booking-replacement',
      type: 'CUSTOMER_CANCELLATION',
      status: 'PROCESSING',
      amount: 27000,
      booking: {
        id: 'booking-vnpay-root',
        status: 'CANCELLED',
        ticketInstances: [{ id: 'ticket-root', status: 'EXPIRED' }],
        reservation: { status: 'CANCELLED', ticketProduct: {} },
      },
    };
    const replacement = {
      id: 'booking-replacement',
      status: 'REFUND_REQUESTED',
      ticketInstances: [{ id: 'ticket-replacement', status: 'VALID' }],
      reservation: {
        id: 'reservation-replacement',
        status: 'CONFIRMED',
        ticketProduct: { attractionId: 'attraction-replacement' },
      },
    };
    const tx = makeTx(refundRequest);
    tx.booking.findUnique.mockResolvedValue(replacement);

    await finalizeSuccessfulRefund(tx, {
      refundRequestId: refundRequest.id,
      refundTransactionId: 'transaction-recovery-customer',
    });

    expect(releaseInventory).toHaveBeenCalledWith(tx, replacement);
    expect(tx.booking.update).toHaveBeenCalledWith({
      where: { id: 'booking-replacement' },
      data: { status: 'REFUNDED', refundRequired: false },
    });
    expect(tx.booking.update).toHaveBeenCalledWith({
      where: { id: 'booking-vnpay-root' },
      data: { status: 'REFUNDED', refundRequired: false },
    });
  });

  test('a full Rescue refund closes the RecoveryCase after gateway success', async () => {
    const refundRequest = {
      id: 'refund-full',
      requestKey: 'recovery-full:case-1',
      type: 'PARTNER_CANCELLATION',
      status: 'PROCESSING',
      amount: 500000,
      booking: {
        id: 'booking-old',
        status: 'CANCELLED',
        ticketInstances: [{ id: 'ticket-old', status: 'EXPIRED' }],
        payments: [{
          id: 'payment-old',
          amount: 500000,
          status: 'SUCCESS',
          isDuplicate: false,
          paymentGateway: 'VNPAY',
        }],
        refundTransactions: [],
        reservation: { status: 'CANCELLED', ticketProduct: {} },
      },
    };
    const tx = makeTx(refundRequest);

    await finalizeSuccessfulRefund(tx, {
      refundRequestId: refundRequest.id,
      refundTransactionId: 'transaction-1',
      now: new Date('2026-07-26T12:00:00.000Z'),
    });

    expect(tx.recoveryCase.updateMany).toHaveBeenCalledWith({
      where: { id: 'case-1', status: 'REFUND_PENDING' },
      data: {
        status: 'REFUNDED',
        completedAt: new Date('2026-07-26T12:00:00.000Z'),
        version: { increment: 1 },
      },
    });
    expect(tx.booking.update).toHaveBeenCalledWith({
      where: { id: 'booking-old' },
      data: { status: 'REFUNDED', refundRequired: false },
    });
  });

  test('a repeated Rescue cancellation closes only its replacement while older money is pending', async () => {
    const refundRequest = {
      id: 'refund-current-value',
      requestKey: 'recovery-full:case-repeat',
      type: 'PARTNER_CANCELLATION',
      status: 'PROCESSING',
      amount: 30000,
      booking: {
        id: 'booking-vnpay-root',
        status: 'CANCELLED',
        ticketInstances: [{ id: 'ticket-root', status: 'EXPIRED' }],
        payments: [{
          id: 'payment-root',
          amount: 520000,
          status: 'SUCCESS',
          isDuplicate: false,
          paymentGateway: 'VNPAY',
        }],
        refundTransactions: [],
        reservation: { status: 'CANCELLED', ticketProduct: {} },
      },
    };
    const tx = makeTx(refundRequest);
    tx.refundRequest.count.mockResolvedValue(1);
    tx.recoveryCase.findUnique.mockResolvedValue({
      id: 'case-repeat',
      originalBookingId: 'booking-replacement',
    });
    tx.booking.findUnique.mockResolvedValue({
      id: 'booking-replacement',
      status: 'CANCELLED',
      ticketInstances: [{ id: 'ticket-replacement', status: 'EXPIRED' }],
    });

    await finalizeSuccessfulRefund(tx, {
      refundRequestId: refundRequest.id,
      refundTransactionId: 'transaction-current-value',
    });

    expect(tx.booking.update).toHaveBeenCalledWith({
      where: { id: 'booking-replacement' },
      data: { status: 'REFUNDED', refundRequired: false },
    });
    expect(tx.booking.update).toHaveBeenCalledWith({
      where: { id: 'booking-vnpay-root' },
      data: { refundRequired: true },
    });
    expect(tx.recoveryCase.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'case-repeat', status: 'REFUND_PENDING' },
    }));
  });

  test('marks the VNPay root fully refunded when chain refunds reach the captured amount', async () => {
    const refundRequest = {
      id: 'refund-final-value',
      requestKey: 'recovery-full:case-final',
      type: 'PARTNER_CANCELLATION',
      status: 'PROCESSING',
      amount: 30000,
      booking: {
        id: 'booking-vnpay-root',
        status: 'CANCELLED',
        ticketInstances: [{ id: 'ticket-root', status: 'EXPIRED' }],
        payments: [{
          id: 'payment-root',
          amount: 520000,
          status: 'SUCCESS',
          isDuplicate: false,
          paymentGateway: 'VNPAY',
        }],
        refundTransactions: [{
          paymentId: 'payment-root',
          amount: 490000,
          status: 'SUCCESS',
        }],
        reservation: { status: 'CANCELLED', ticketProduct: {} },
      },
    };
    const tx = makeTx(refundRequest);
    tx.recoveryCase.findUnique.mockResolvedValue({
      id: 'case-final',
      originalBookingId: 'booking-replacement',
    });
    tx.booking.findUnique.mockResolvedValue({
      id: 'booking-replacement',
      status: 'CANCELLED',
      ticketInstances: [{ id: 'ticket-replacement', status: 'EXPIRED' }],
    });

    await finalizeSuccessfulRefund(tx, {
      refundRequestId: refundRequest.id,
      refundTransactionId: 'transaction-final-value',
    });

    expect(tx.booking.update).toHaveBeenCalledWith({
      where: { id: 'booking-vnpay-root' },
      data: { status: 'REFUNDED', refundRequired: false },
    });
    expect(tx.ticketInstance.updateMany).toHaveBeenCalledWith({
      where: {
        bookingId: 'booking-vnpay-root',
        status: { in: ['VALID', 'EXPIRED'] },
      },
      data: { status: 'REFUNDED' },
    });
  });

  test('finalizes an immediate fallback refund even when no RecoveryCase was created', async () => {
    const refundRequest = {
      id: 'refund-no-option',
      requestKey: 'recovery-full-booking:booking-replacement',
      type: 'PARTNER_CANCELLATION',
      status: 'PROCESSING',
      amount: 30000,
      booking: {
        id: 'booking-vnpay-root',
        status: 'CANCELLED',
        ticketInstances: [{ id: 'ticket-root', status: 'EXPIRED' }],
        payments: [{
          id: 'payment-root',
          amount: 520000,
          status: 'SUCCESS',
          isDuplicate: false,
          paymentGateway: 'VNPAY',
        }],
        refundTransactions: [{
          paymentId: 'payment-root',
          amount: 490000,
          status: 'SUCCESS',
        }],
        reservation: { status: 'CANCELLED', ticketProduct: {} },
      },
    };
    const tx = makeTx(refundRequest);
    tx.booking.findUnique.mockResolvedValue({
      id: 'booking-replacement',
      status: 'CANCELLED',
      ticketInstances: [{ id: 'ticket-replacement', status: 'EXPIRED' }],
    });

    await finalizeSuccessfulRefund(tx, {
      refundRequestId: refundRequest.id,
      refundTransactionId: 'transaction-no-option',
    });

    expect(tx.recoveryCase.findUnique).not.toHaveBeenCalled();
    expect(tx.recoveryCase.updateMany).not.toHaveBeenCalled();
    expect(tx.booking.update).toHaveBeenCalledWith({
      where: { id: 'booking-replacement' },
      data: { status: 'REFUNDED', refundRequired: false },
    });
    expect(tx.booking.update).toHaveBeenCalledWith({
      where: { id: 'booking-vnpay-root' },
      data: { status: 'REFUNDED', refundRequired: false },
    });
  });
});
