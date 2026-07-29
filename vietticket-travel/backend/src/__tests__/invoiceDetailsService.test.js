'use strict';

const {
  normalizeInvoiceDetails,
} = require('../services/invoiceDetailsService');

describe('booking invoice details', () => {
  test('returns null unless the customer explicitly requests an invoice', () => {
    expect(normalizeInvoiceDetails(null)).toBeNull();
    expect(normalizeInvoiceDetails({ requestInvoice: false })).toBeNull();
  });

  test('normalizes and timestamps a valid business e-invoice request', () => {
    const requestedAt = new Date('2026-07-29T12:00:00.000Z');
    expect(normalizeInvoiceDetails({
      requestInvoice: true,
      buyerType: 'business',
      invoiceName: '  Công ty Du lịch Việt  ',
      taxCode: '0123456789-001',
      invoiceAddress: '  1 Nguyễn Huệ, TP.HCM ',
      invoiceEmail: 'FINANCE@EXAMPLE.COM',
    }, { now: requestedAt })).toEqual({
      version: 1,
      requestInvoice: true,
      buyerType: 'BUSINESS',
      invoiceName: 'Công ty Du lịch Việt',
      taxCode: '0123456789-001',
      invoiceAddress: '1 Nguyễn Huệ, TP.HCM',
      invoiceEmail: 'finance@example.com',
      requestedAt: requestedAt.toISOString(),
    });
  });

  test('rejects malformed business tax codes', () => {
    expect(() => normalizeInvoiceDetails({
      requestInvoice: true,
      buyerType: 'BUSINESS',
      invoiceName: 'Công ty A',
      taxCode: 'ABC123',
      invoiceAddress: '1 Nguyễn Huệ, TP.HCM',
      invoiceEmail: 'finance@example.com',
    })).toThrow(/Mã số thuế/);
  });
});
