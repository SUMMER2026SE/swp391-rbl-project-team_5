'use strict';

jest.mock('../utils/refundService', () => ({
  releaseInventory: jest.fn(),
}));

const {
  REFUND_GATEWAY_OUTCOME,
  assertRefundCanBeSubmitted,
  classifyVnpayReconciliationResult,
  classifyVnpayRefundResult,
  getRefundProcessingEligibility,
  getPaymentRefundBalance,
} = require('../services/refundLifecycleService');

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

  test('allows only the explicit local defense fixture to use the demo adapter', () => {
    expect(getRefundProcessingEligibility({
      id: 'defense-demo-v1-payment-refund-approve',
      transactionId: 'DEFENSEDEMO-refund-approve',
      rawResponse: { source: 'defense_demo_fixture' },
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
