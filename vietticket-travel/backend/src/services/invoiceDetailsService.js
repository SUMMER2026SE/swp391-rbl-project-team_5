'use strict';

const { isValidEmail } = require('../utils/validators');

const TAX_CODE_PATTERN = /^\d{10}(?:-\d{3})?$/;

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = 'INVALID_INVOICE_DETAILS';
  return error;
}

function cleanText(value, maxLength, label) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (!text || text.length > maxLength) {
    throw validationError(`${label} là bắt buộc và không được vượt quá ${maxLength} ký tự.`);
  }
  return text;
}

function normalizeInvoiceDetails(input, {
  fallbackEmail = '',
  now = new Date(),
} = {}) {
  if (!input || input.requestInvoice !== true) return null;

  const buyerType = String(input.buyerType || '').trim().toUpperCase();
  if (!['PERSONAL', 'BUSINESS'].includes(buyerType)) {
    throw validationError('Loại người mua trên hóa đơn không hợp lệ.');
  }
  const invoiceName = cleanText(
    input.invoiceName,
    200,
    buyerType === 'BUSINESS' ? 'Tên doanh nghiệp' : 'Tên người mua',
  );
  const invoiceAddress = cleanText(input.invoiceAddress, 500, 'Địa chỉ hóa đơn');
  const invoiceEmail = String(input.invoiceEmail || fallbackEmail || '').trim().toLowerCase();
  if (!isValidEmail(invoiceEmail)) {
    throw validationError('Email nhận hóa đơn không hợp lệ.');
  }

  const taxCode = String(input.taxCode || '').trim();
  if (buyerType === 'BUSINESS' && !TAX_CODE_PATTERN.test(taxCode)) {
    throw validationError('Mã số thuế doanh nghiệp phải gồm 10 chữ số hoặc dạng 10 chữ số-3 chữ số.');
  }
  if (buyerType === 'PERSONAL' && taxCode && !TAX_CODE_PATTERN.test(taxCode)) {
    throw validationError('Mã số thuế cá nhân không hợp lệ.');
  }

  return {
    version: 1,
    requestInvoice: true,
    buyerType,
    invoiceName,
    taxCode: taxCode || null,
    invoiceAddress,
    invoiceEmail,
    requestedAt: now.toISOString(),
  };
}

module.exports = {
  TAX_CODE_PATTERN,
  normalizeInvoiceDetails,
};
