'use strict';

const {
  getRefundMode,
  isCapturedPayment,
  isRefundableCapturedPayment,
  isVnpayPayment,
} = require('../utils/paymentGateway');
const {
  getCapturedPayment,
  queueMandatoryRefund,
} = require('../services/mandatoryRefundService');

function payment(overrides = {}) {
  return {
    id: 'payment-1',
    amount: 200000,
    status: 'SUCCESS',
    isDuplicate: false,
    paymentGateway: 'VNPAY',
    ...overrides,
  };
}

describe('payment gateway classification', () => {
  test('accepts only the exact VNPay gateway identifier', () => {
    expect(isVnpayPayment(payment())).toBe(true);
    expect(isVnpayPayment(payment({ paymentGateway: 'NOT_VNPAY_FAKE' }))).toBe(false);
  });

  test('does not count Rescue credit as newly captured cash', () => {
    const recoveryCredit = payment({ paymentGateway: 'RECOVERY_CREDIT' });
    expect(isCapturedPayment(recoveryCredit)).toBe(false);
    expect(isCapturedPayment(recoveryCredit, { allowInternalCredit: true })).toBe(true);
    expect(isRefundableCapturedPayment(recoveryCredit)).toBe(false);
    expect(getCapturedPayment({ payments: [recoveryCredit] })).toBeNull();
  });

  test('supports source-method refunds for VNPay and bank transfer only', () => {
    expect(getRefundMode(payment())).toBe('VNPAY');
    expect(getRefundMode(payment({ paymentGateway: 'BANK_TRANSFER' })))
      .toBe('MANUAL_BANK_TRANSFER');
    expect(getRefundMode(payment({ paymentGateway: 'CASH' }))).toBe('UNSUPPORTED');
  });
});

describe('mandatory refund queue', () => {
  test('bank transfer stays pending for verified manual payout and creates no VNPay job', async () => {
    const bankPayment = payment({
      paymentGateway: 'BANK_TRANSFER',
      transactionId: 'BT-booking-1',
    });
    const refundRequest = { id: 'refund-1', status: 'PENDING' };
    const tx = {
      refundRequest: { upsert: jest.fn().mockResolvedValue(refundRequest) },
      refundTransaction: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
    };

    const result = await queueMandatoryRefund(tx, {
      id: 'booking-1',
      userId: 'user-1',
      status: 'CANCELLED',
      totalAmount: 200000,
      snapshotRefundPolicy: 'FREE_CANCELLATION',
      payments: [bankPayment],
    }, {
      type: 'SYSTEM_CANCELLATION',
      reason: 'Không thể phát vé.',
      now: new Date('2026-07-27T10:00:00.000Z'),
    });

    expect(result).toEqual({
      queued: true,
      refundRequest,
      refundTransaction: null,
      processingMode: 'MANUAL_BANK_TRANSFER',
    });
    expect(tx.refundRequest.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        amount: 200000,
        mandatory: true,
        status: 'PENDING',
        processingStartedAt: null,
      }),
    }));
    expect(tx.refundTransaction.findFirst).not.toHaveBeenCalled();
    expect(tx.refundTransaction.create).not.toHaveBeenCalled();
  });
});
