jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
jest.mock('../services/recoveryService', () => ({
  CASE_INCLUDE: {},
  acceptRecoveryOption: jest.fn(),
  declineRecoveryCase: jest.fn(),
  getRecoveryCaseDetail: jest.fn(),
  serializeRecoveryCase: jest.fn((recoveryCase, { options } = {}) => ({
    ...recoveryCase,
    ...(options ? { options } : {}),
  })),
  sweepExpiredRecoveryCases: jest.fn(),
}));
jest.mock('../realtime/events', () => ({
  emitBookingStatusUpdated: jest.fn(),
  emitLiveTripUpdated: jest.fn(),
  emitRecoveryCaseEvent: jest.fn(),
}));
jest.mock('../services/ticketEmailService', () => ({
  queueConfirmedTicketEmail: jest.fn(),
}));

const prisma = require('./helpers/mockPrisma');
prisma.recoveryCase = { findUnique: jest.fn() };
const {
  acceptRecoveryOption,
  declineRecoveryCase,
  getRecoveryCaseDetail,
  sweepExpiredRecoveryCases,
} = require('../services/recoveryService');
const {
  emitBookingStatusUpdated,
  emitLiveTripUpdated,
  emitRecoveryCaseEvent,
} = require('../realtime/events');
const {
  queueConfirmedTicketEmail,
} = require('../services/ticketEmailService');
const {
  acceptOption,
  declineCase,
  getRecoveryCase,
} = require('../controllers/recoveryCaseController');

function response() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

describe('recoveryCaseController.getRecoveryCase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sweepExpiredRecoveryCases.mockResolvedValue(0);
  });

  test('emits RECOVERY_CASE_UPDATED and returns the new case after no-option fallback', async () => {
    const recoveryCase = {
      id: 'recovery-case',
      userId: 'customer-1',
      originalBookingId: 'booking-original',
      status: 'REFUND_PENDING',
      refundAmount: 500000,
    };
    getRecoveryCaseDetail.mockResolvedValue({
      recoveryCase,
      options: [],
      transitionedToRefundPending: true,
    });
    const req = {
      params: { id: recoveryCase.id },
      user: { id: recoveryCase.userId },
    };
    const res = response();
    const next = jest.fn();

    await getRecoveryCase(req, res, next);

    expect(getRecoveryCaseDetail).toHaveBeenCalledWith({
      recoveryCaseId: recoveryCase.id,
      userId: recoveryCase.userId,
      req,
    });
    expect(emitRecoveryCaseEvent).toHaveBeenCalledWith({
      customerId: recoveryCase.userId,
      recoveryCaseId: recoveryCase.id,
      eventName: 'RECOVERY_CASE_UPDATED',
      status: 'REFUND_PENDING',
      message: 'Không còn phương án thay thế phù hợp. Hoàn tiền 100% đang được xử lý.',
      originalBookingId: recoveryCase.originalBookingId,
    });
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({
        id: recoveryCase.id,
        status: 'REFUND_PENDING',
        refundAmount: 500000,
        options: [],
      }),
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('does not emit a status update while valid replacement options remain', async () => {
    const recoveryCase = {
      id: 'recovery-case',
      userId: 'customer-1',
      originalBookingId: 'booking-original',
      status: 'OPEN',
    };
    const options = [{ ticketProductId: 'ticket-product' }];
    getRecoveryCaseDetail.mockResolvedValue({
      recoveryCase,
      options,
      transitionedToRefundPending: false,
    });
    const req = {
      params: { id: recoveryCase.id },
      user: { id: recoveryCase.userId },
    };
    const res = response();

    await getRecoveryCase(req, res, jest.fn());

    expect(emitRecoveryCaseEvent).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({
        id: recoveryCase.id,
        status: 'OPEN',
        options,
      }),
    });
  });
});

describe('recoveryCaseController decision replay', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns an accepted decision retry without duplicating email or realtime effects', async () => {
    const result = {
      expired: false,
      replayed: true,
      recoveryCaseId: 'recovery-case',
      originalBookingId: 'booking-original',
      replacementBookingId: 'booking-replacement',
      refundDifference: 0,
      liveTripIds: [],
    };
    acceptRecoveryOption.mockResolvedValue(result);
    const recoveryCase = {
      id: result.recoveryCaseId,
      status: 'REPLACED',
      replacementBookingId: result.replacementBookingId,
    };
    prisma.recoveryCase.findUnique.mockResolvedValue(recoveryCase);
    const req = {
      params: { id: result.recoveryCaseId },
      user: { id: 'customer-1' },
      body: {
        ticketProductId: 'ticket-product',
        timeSlotId: 'slot-1',
        quoteFingerprint: 'A'.repeat(64),
      },
    };
    const res = response();

    await acceptOption(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Phương án này đã được xác nhận trước đó.',
      data: expect.objectContaining({ status: 'REPLACED' }),
    });
    expect(acceptRecoveryOption).toHaveBeenCalledWith(expect.objectContaining({
      quoteFingerprint: 'a'.repeat(64),
    }));
    expect(queueConfirmedTicketEmail).not.toHaveBeenCalled();
    expect(emitBookingStatusUpdated).not.toHaveBeenCalled();
    expect(emitRecoveryCaseEvent).not.toHaveBeenCalled();
    expect(emitLiveTripUpdated).not.toHaveBeenCalled();
  });

  test('returns a decline retry without emitting a duplicate status event', async () => {
    const updated = {
      id: 'recovery-case',
      originalBookingId: 'booking-original',
      status: 'REFUND_PENDING',
      replayed: true,
    };
    declineRecoveryCase.mockResolvedValue(updated);
    prisma.recoveryCase.findUnique.mockResolvedValue(updated);
    const req = {
      params: { id: updated.id },
      user: { id: 'customer-1' },
      body: {},
    };
    const res = response();

    await declineCase(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Yêu cầu hoàn tiền 100% đã được ghi nhận trước đó.',
      data: expect.objectContaining({ status: 'REFUND_PENDING' }),
    });
    expect(emitRecoveryCaseEvent).not.toHaveBeenCalled();
  });
});
