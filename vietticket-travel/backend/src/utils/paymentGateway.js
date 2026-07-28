'use strict';

const PAYMENT_GATEWAY = Object.freeze({
  VNPAY: 'VNPAY',
  BANK_TRANSFER: 'BANK_TRANSFER',
  RECOVERY_CREDIT: 'RECOVERY_CREDIT',
});

function normalizePaymentGateway(value) {
  return String(value || '').trim().toUpperCase();
}

function isVnpayPayment(payment) {
  return normalizePaymentGateway(payment?.paymentGateway) === PAYMENT_GATEWAY.VNPAY;
}

function isBankTransferPayment(payment) {
  return normalizePaymentGateway(payment?.paymentGateway) === PAYMENT_GATEWAY.BANK_TRANSFER;
}

function isInternalCreditPayment(payment) {
  return normalizePaymentGateway(payment?.paymentGateway) === PAYMENT_GATEWAY.RECOVERY_CREDIT;
}

function isCapturedPayment(payment, { allowInternalCredit = false } = {}) {
  return Boolean(
    payment
    && payment.status === 'SUCCESS'
    && !payment.isDuplicate
    && (allowInternalCredit || !isInternalCreditPayment(payment)),
  );
}

function isRefundableCapturedPayment(payment) {
  return isCapturedPayment(payment)
    && (isVnpayPayment(payment) || isBankTransferPayment(payment));
}

function getRefundMode(payment) {
  if (isVnpayPayment(payment)) return 'VNPAY';
  if (isBankTransferPayment(payment)) return 'MANUAL_BANK_TRANSFER';
  return 'UNSUPPORTED';
}

module.exports = {
  PAYMENT_GATEWAY,
  getRefundMode,
  isBankTransferPayment,
  isCapturedPayment,
  isInternalCreditPayment,
  isRefundableCapturedPayment,
  isVnpayPayment,
  normalizePaymentGateway,
};
