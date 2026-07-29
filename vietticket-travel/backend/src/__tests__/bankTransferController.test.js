'use strict';

jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
jest.mock('../services/bankTransferService', () => ({
  BANK_TRANSFER_METHOD: 'bank_transfer',
  buildTransferInstruction: jest.fn(),
  confirmBankTransfer: jest.fn(),
  isBankTransferAvailable: jest.fn(() => true),
  listPendingBankTransfers: jest.fn(),
}));
jest.mock('../realtime/events', () => ({
  queueNewBookingNotification: jest.fn(),
  emitBookingStatusUpdated: jest.fn(),
}));
jest.mock('../services/ticketEmailService', () => ({
  queueConfirmedTicketEmail: jest.fn(),
}));
jest.mock('../utils/auditLog', () => ({
  writeAuditLog: jest.fn().mockResolvedValue({}),
}));

const prisma = require('./helpers/mockPrisma');
const {
  confirmBankTransfer,
} = require('../services/bankTransferService');
const {
  confirmBankTransferPayment,
} = require('../controllers/bankTransferController');

function createRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

function request(body, userId = 'admin-maker') {
  return {
    params: { bookingId: 'booking-bank-1' },
    body,
    user: { id: userId, role: 'ADMIN' },
    headers: {},
    ip: '127.0.0.1',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('bank transfer maker-checker control', () => {
  test('maker only records immutable bank evidence and does not issue a ticket', async () => {
    prisma.bankTransferReconciliation.findUnique.mockResolvedValue(null);
    prisma.booking.findUnique.mockResolvedValue({
      id: 'booking-bank-1',
      paymentMethod: 'bank_transfer',
      totalAmount: 250000,
      isForecastTrainingSample: false,
    });
    const created = {
      id: 'reconciliation-1',
      bookingId: 'booking-bank-1',
      status: 'MATCHED',
    };
    const tx = {
      bankTransferReconciliation: {
        create: jest.fn().mockResolvedValue(created),
      },
    };
    prisma.$transaction.mockImplementation((callback) => callback(tx));

    const res = createRes();
    await confirmBankTransferPayment(request({
      externalReference: 'FT123456789',
      receivedAmount: 250000,
      receivedAt: '2026-07-29T07:00:00.000Z',
      payerName: 'NGUYEN VAN A',
      note: 'Khớp sao kê ngân hàng',
    }), res, jest.fn());

    expect(tx.bankTransferReconciliation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bookingId: 'booking-bank-1',
        externalReference: 'FT123456789',
        receivedAmount: 250000,
        matchedById: 'admin-maker',
        status: 'MATCHED',
      }),
    });
    expect(confirmBankTransfer).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ awaitingSecondApproval: true }),
    }));
  });

  test('does not let the maker approve their own reconciliation', async () => {
    prisma.bankTransferReconciliation.findUnique.mockResolvedValue({
      id: 'reconciliation-1',
      bookingId: 'booking-bank-1',
      status: 'MATCHED',
      matchedById: 'admin-maker',
    });

    const res = createRes();
    await confirmBankTransferPayment(request({}, 'admin-maker'), res, jest.fn());

    expect(confirmBankTransfer).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'MAKER_CHECKER_SEPARATION_REQUIRED',
    }));
  });

  test('a different checker can approve and issue the ticket', async () => {
    prisma.bankTransferReconciliation.findUnique.mockResolvedValue({
      id: 'reconciliation-1',
      bookingId: 'booking-bank-1',
      status: 'MATCHED',
      matchedById: 'admin-maker',
      externalReference: 'FT123456789',
      receivedAmount: 250000,
      receivedAt: new Date('2026-07-29T07:00:00.000Z'),
      payerName: 'NGUYEN VAN A',
      evidenceNote: 'Khớp sao kê',
    });
    confirmBankTransfer.mockResolvedValue({
      alreadyConfirmed: false,
      latePayment: false,
      bookingStatus: 'CONFIRMED',
      booking: { id: 'booking-bank-1', userId: 'customer-1' },
    });
    prisma.bankTransferReconciliation.updateMany.mockResolvedValue({ count: 1 });

    const res = createRes();
    await confirmBankTransferPayment(
      request({ note: 'Đã kiểm tra độc lập' }, 'admin-checker'),
      res,
      jest.fn(),
    );

    expect(confirmBankTransfer).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 'booking-bank-1',
      actorId: 'admin-checker',
      evidence: expect.objectContaining({
        externalReference: 'FT123456789',
        receivedAmount: 250000,
      }),
    }));
    expect(prisma.bankTransferReconciliation.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'reconciliation-1',
        status: 'MATCHED',
        matchedById: { not: 'admin-checker' },
      },
      data: {
        status: 'APPROVED',
        approvedById: 'admin-checker',
        approvedAt: expect.any(Date),
      },
    });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ bookingStatus: 'CONFIRMED' }),
    }));
  });

  test('does not record a mismatched amount as valid evidence', async () => {
    prisma.bankTransferReconciliation.findUnique.mockResolvedValue(null);
    prisma.booking.findUnique.mockResolvedValue({
      id: 'booking-bank-1',
      paymentMethod: 'bank_transfer',
      totalAmount: 250000,
      isForecastTrainingSample: false,
    });

    const res = createRes();
    await confirmBankTransferPayment(request({
      externalReference: 'FT123456789',
      receivedAmount: 249000,
      receivedAt: '2026-07-29T07:00:00.000Z',
    }), res, jest.fn());

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'BANK_TRANSFER_AMOUNT_MISMATCH',
    }));
  });
});
