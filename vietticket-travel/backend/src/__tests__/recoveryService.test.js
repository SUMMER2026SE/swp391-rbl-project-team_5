jest.mock('../config/prisma', () => require('./helpers/mockPrisma'));
jest.mock('../services/availabilityService', () => ({
  getBookableSchedule: jest.fn(),
  getProductCapacity: jest.fn(),
  getSlotCapacity: jest.fn(),
  getTicketAvailabilityBatch: jest.fn(),
}));
jest.mock('../services/mandatoryRefundService', () => ({
  getCapturedPayment: jest.fn((booking) => (
    (booking?.payments || []).find((payment) => (
      payment.status === 'SUCCESS'
      && !payment.isDuplicate
      && /vnpay/i.test(payment.paymentGateway || '')
    )) || null
  )),
  queueRecoveryDifferenceRefund: jest.fn(),
  queueRecoveryFullRefund: jest.fn(),
}));

const { Prisma } = require('@prisma/client');
const prisma = require('./helpers/mockPrisma');
const {
  getTicketAvailabilityBatch,
} = require('../services/availabilityService');
const {
  queueRecoveryFullRefund,
} = require('../services/mandatoryRefundService');
const {
  DEFAULT_RECOVERY_WINDOW_MS,
  MAX_RECOVERY_WINDOW_MS,
  MIN_RECOVERY_WINDOW_MS,
  acceptRecoveryOption,
  buildOriginalSnapshot,
  declineRecoveryCase,
  findEligibleRecoveryOptions,
  getRecoveryCaseDetail,
  normalizeRecoveryWindowMs,
  resolveRecoveryFundingBooking,
  synchronizeLiveTrip,
  serializeRecoveryRefund,
} = require('../services/recoveryService');

function makeContext(overrides = {}) {
  return {
    creditAmount: 500000,
    originalSnapshot: {
      attractionId: 'old-attraction',
      attractionTitle: 'Điểm cũ',
      city: 'Đà Nẵng',
      district: 'Hải Châu',
      latitude: 16.0544,
      longitude: 108.2022,
      environment: 'OUTDOOR',
      ticketType: 'ADULT',
      visitDate: '2026-08-15',
      startTime: '09:00',
      quantity: 2,
      ...overrides,
    },
  };
}

function makeProduct(overrides = {}) {
  return {
    id: 'new-product',
    name: 'Vé người lớn',
    type: 'ADULT',
    description: 'Trải nghiệm thay thế',
    sellingPrice: 200000,
    attraction: {
      id: 'new-attraction',
      title: 'Điểm thay thế',
      address: 'Đà Nẵng',
      city: 'Đà Nẵng',
      district: 'Hải Châu',
      latitude: 16.0644,
      longitude: 108.2122,
      environment: 'OUTDOOR',
      averageRating: 4.7,
      totalReviews: 120,
      images: [{ imageUrl: '/uploads/new.jpg' }],
      ...overrides.attraction,
    },
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key]) => key !== 'attraction'),
    ),
  };
}

describe('VietTicket Rescue option eligibility', () => {
  afterEach(() => jest.clearAllMocks());

  test('returns only live slots with enough inventory and computes the refund difference', async () => {
    const client = {
      ticketProduct: { findMany: jest.fn().mockResolvedValue([makeProduct()]) },
    };
    getTicketAvailabilityBatch.mockResolvedValue(new Map([
      ['new-product', {
        closed: false,
        slots: [
          {
            timeSlotId: 'slot-full',
            startTime: '08:00',
            endTime: '09:00',
            availableTickets: 1,
            bookingClosed: false,
          },
          {
            timeSlotId: 'slot-open',
            startTime: '09:30',
            endTime: '11:30',
            availableTickets: 12,
            bookingClosed: false,
          },
        ],
      }],
    ]));

    const options = await findEligibleRecoveryOptions(client, makeContext());

    expect(options).toHaveLength(1);
    expect(options[0]).toEqual(expect.objectContaining({
      ticketProductId: 'new-product',
      timeSlotId: 'slot-open',
      quantity: 2,
      totalAmount: 400000,
      refundAmount: 100000,
      availableTickets: 12,
      restrictions: {
        minAgeYears: null,
        maxAgeYears: null,
        minHeightCm: null,
        maxHeightCm: null,
        requiresAdult: false,
      },
    }));
    expect(options[0].recommendationReasons).toContain(
      'Giữ phong cách trải nghiệm tương tự',
    );
  });

  test('does not offer a slot with an earlier refund cutoff than the original', async () => {
    const client = {
      ticketProduct: {
        findMany: jest.fn().mockResolvedValue([
          makeProduct({
            refundPolicy: 'FREE_CANCELLATION',
            refundCutoffHours: 2,
            attraction: { openTime: '06:00', closeTime: '18:00' },
          }),
        ]),
      },
    };
    getTicketAvailabilityBatch.mockResolvedValue(new Map([
      ['new-product', {
        closed: false,
        slots: [
          {
            timeSlotId: 'too-early',
            startTime: '07:00',
            endTime: '08:00',
            availableTickets: 10,
            bookingClosed: false,
          },
          {
            timeSlotId: 'safe-slot',
            startTime: '10:00',
            endTime: '11:00',
            availableTickets: 10,
            bookingClosed: false,
          },
        ],
      }],
    ]));

    const options = await findEligibleRecoveryOptions(client, makeContext({
      startTime: '10:00',
      refundPolicy: 'FREE_CANCELLATION',
      refundCutoffHours: 2,
    }));

    expect(options.map((option) => option.timeSlotId)).toEqual(['safe-slot']);
  });

  test('rejects an all-day candidate when the original refund deadline cannot be proven', async () => {
    const client = {
      ticketProduct: {
        findMany: jest.fn().mockResolvedValue([
          makeProduct({
            refundPolicy: 'FREE_CANCELLATION',
            refundCutoffHours: 2,
            attraction: { openTime: null, closeTime: null },
          }),
        ]),
      },
    };
    getTicketAvailabilityBatch.mockResolvedValue(new Map([
      ['new-product', {
        closed: false,
        slots: [{
          timeSlotId: null,
          startTime: null,
          endTime: null,
          availableTickets: 10,
          bookingClosed: false,
        }],
      }],
    ]));

    const options = await findEligibleRecoveryOptions(client, makeContext({
      startTime: '10:00',
      refundPolicy: 'FREE_CANCELLATION',
      refundCutoffHours: 2,
    }));

    expect(options).toEqual([]);
  });

  test('does not claim zero-distance proximity when coordinates are missing', async () => {
    const client = {
      ticketProduct: {
        findMany: jest.fn().mockResolvedValue([
          makeProduct({
            attraction: {
              latitude: null,
              longitude: null,
            },
          }),
        ]),
      },
    };
    getTicketAvailabilityBatch.mockResolvedValue(new Map([
      ['new-product', {
        closed: false,
        slots: [{
          timeSlotId: 'slot-open',
          startTime: '09:30',
          endTime: '11:30',
          availableTickets: 10,
          bookingClosed: false,
        }],
      }],
    ]));

    const options = await findEligibleRecoveryOptions(client, makeContext({
      latitude: null,
      longitude: null,
    }));

    expect(options[0].recommendationReasons.some((reason) => /0\.0 km/.test(reason)))
      .toBe(false);
  });

  test('does not send a more expensive product into the availability pipeline', async () => {
    const client = {
      ticketProduct: {
        findMany: jest.fn().mockResolvedValue([
          makeProduct({ id: 'affordable', sellingPrice: 250000 }),
          makeProduct({ id: 'too-expensive', sellingPrice: 250001 }),
        ]),
      },
    };
    getTicketAvailabilityBatch.mockResolvedValue(new Map());

    await findEligibleRecoveryOptions(client, makeContext());

    expect(getTicketAvailabilityBatch).toHaveBeenCalledWith(
      client,
      ['affordable'],
      expect.any(Date),
      expect.objectContaining({ now: expect.any(Date) }),
    );
  });

  test('queries only same-city, same-ticket-type, public automatic-confirmation inventory', async () => {
    const client = {
      ticketProduct: { findMany: jest.fn().mockResolvedValue([]) },
    };
    getTicketAvailabilityBatch.mockResolvedValue(new Map());

    await findEligibleRecoveryOptions(client, makeContext());

    expect(client.ticketProduct.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: 'ADULT',
          attraction: expect.objectContaining({
            id: { not: 'old-attraction' },
            city: { equals: 'Đà Nẵng', mode: 'insensitive' },
            requiresManualApproval: false,
            publicationStatus: 'ACTIVE',
            operationalStatus: 'ACTIVE',
          }),
        }),
      }),
    );
  });

  test('only checks availability for tickets no stricter than the original restrictions', async () => {
    const client = {
      ticketProduct: {
        findMany: jest.fn().mockResolvedValue([
          makeProduct({
            id: 'same-or-broader',
            minAgeYears: 2,
            maxAgeYears: 70,
            minHeightCm: 90,
            maxHeightCm: 210,
            requiresAdult: false,
          }),
          makeProduct({ id: 'stricter-min-age', minAgeYears: 4 }),
          makeProduct({ id: 'stricter-max-age', maxAgeYears: 64 }),
          makeProduct({ id: 'stricter-min-height', minHeightCm: 101 }),
          makeProduct({ id: 'stricter-max-height', maxHeightCm: 199 }),
          makeProduct({ id: 'new-adult-requirement', requiresAdult: true }),
        ]),
      },
    };
    getTicketAvailabilityBatch.mockResolvedValue(new Map([[
      'same-or-broader',
      {
        closed: false,
        slots: [{
          timeSlotId: 'safe-slot',
          startTime: '09:00',
          endTime: '11:00',
          availableTickets: 10,
          bookingClosed: false,
        }],
      },
    ]]));

    const options = await findEligibleRecoveryOptions(client, makeContext({
      restrictions: {
        minAgeYears: 3,
        maxAgeYears: 65,
        minHeightCm: 100,
        maxHeightCm: 200,
        requiresAdult: false,
      },
    }));

    expect(getTicketAvailabilityBatch).toHaveBeenCalledWith(
      client,
      ['same-or-broader'],
      expect.any(Date),
      expect.objectContaining({ now: expect.any(Date) }),
    );
    expect(options[0].restrictions).toEqual({
      minAgeYears: 2,
      maxAgeYears: 70,
      minHeightCm: 90,
      maxHeightCm: 210,
      requiresAdult: false,
    });
  });

  test('is conservative for legacy snapshots that did not retain restrictions', async () => {
    const client = {
      ticketProduct: {
        findMany: jest.fn().mockResolvedValue([
          makeProduct({ id: 'unrestricted' }),
          makeProduct({ id: 'age-restricted', minAgeYears: 12 }),
          makeProduct({ id: 'adult-required', requiresAdult: true }),
        ]),
      },
    };
    getTicketAvailabilityBatch.mockResolvedValue(new Map());

    await findEligibleRecoveryOptions(client, makeContext());

    expect(getTicketAvailabilityBatch).toHaveBeenCalledWith(
      client,
      ['unrestricted'],
      expect.any(Date),
      expect.objectContaining({ now: expect.any(Date) }),
    );
  });
});

describe('VietTicket Rescue original snapshot', () => {
  test('uses immutable booking snapshots for customer-facing historical data', () => {
    const booking = {
      id: 'booking-old',
      totalAmount: 450000,
      snapshotAttractionId: 'snap-attraction',
      snapshotAttractionTitle: 'Tên tại lúc mua',
      snapshotAttractionCity: 'Đà Nẵng',
      snapshotTicketName: 'Vé snapshot',
      snapshotTicketType: 'ADULT',
      snapshotVisitDate: new Date('2026-08-15T00:00:00.000Z'),
      snapshotTimeSlotLabel: '09:00 - 11:00',
      snapshotTicketRestrictions: {
        minAgeYears: 12,
        maxAgeYears: 65,
        minHeightCm: 120,
        maxHeightCm: 210,
        requiresAdult: true,
      },
      reservation: {
        date: new Date('2026-08-15T00:00:00.000Z'),
        quantity: 2,
        timeSlot: { startTime: '09:00', endTime: '11:00' },
        ticketProduct: {
          name: 'Tên hiện tại',
          type: 'ADULT',
          minAgeYears: 18,
          maxAgeYears: 60,
          minHeightCm: 140,
          maxHeightCm: 190,
          requiresAdult: false,
          attraction: {
            id: 'current-attraction',
            title: 'Tên hiện tại',
            city: 'Đà Nẵng',
            environment: 'OUTDOOR',
            images: [],
          },
        },
      },
    };

    expect(buildOriginalSnapshot(booking)).toEqual(expect.objectContaining({
      bookingId: 'booking-old',
      attractionId: 'snap-attraction',
      attractionTitle: 'Tên tại lúc mua',
      ticketName: 'Vé snapshot',
      visitDate: '2026-08-15',
      quantity: 2,
      totalAmount: 450000,
      restrictions: {
        minAgeYears: 12,
        maxAgeYears: 65,
        minHeightCm: 120,
        maxHeightCm: 210,
        requiresAdult: true,
      },
    }));
  });
});

describe('VietTicket Rescue recovery window configuration', () => {
  test('falls back for missing and non-numeric values', () => {
    expect(normalizeRecoveryWindowMs(undefined)).toBe(DEFAULT_RECOVERY_WINDOW_MS);
    expect(normalizeRecoveryWindowMs('not-a-duration')).toBe(DEFAULT_RECOVERY_WINDOW_MS);
  });

  test('clamps finite values to a safe positive range', () => {
    expect(normalizeRecoveryWindowMs(-1)).toBe(MIN_RECOVERY_WINDOW_MS);
    expect(normalizeRecoveryWindowMs(MIN_RECOVERY_WINDOW_MS + 1234))
      .toBe(MIN_RECOVERY_WINDOW_MS + 1234);
    expect(normalizeRecoveryWindowMs(MAX_RECOVERY_WINDOW_MS + 1))
      .toBe(MAX_RECOVERY_WINDOW_MS);
  });
});

describe('VietTicket Rescue funding trace', () => {
  test('uses the booking itself when it owns the captured VNPay payment', async () => {
    const booking = {
      id: 'booking-paid',
      payments: [{
        id: 'payment-vnpay',
        status: 'SUCCESS',
        isDuplicate: false,
        paymentGateway: 'VNPAY',
      }],
    };
    const tx = { recoveryCase: { findFirst: jest.fn() } };

    await expect(resolveRecoveryFundingBooking(tx, booking)).resolves.toBe(booking);
    expect(tx.recoveryCase.findFirst).not.toHaveBeenCalled();
  });

  test('traces a cancelled replacement back to the original VNPay booking', async () => {
    const replacement = {
      id: 'booking-replacement',
      userId: 'customer-1',
      payments: [{
        id: 'payment-credit',
        status: 'SUCCESS',
        isDuplicate: false,
        paymentGateway: 'RECOVERY_CREDIT',
      }],
    };
    const fundingBooking = {
      id: 'booking-vnpay-root',
      userId: 'customer-1',
      payments: [{
        id: 'payment-vnpay',
        status: 'SUCCESS',
        isDuplicate: false,
        paymentGateway: 'VNPAY',
      }],
    };
    const tx = {
      recoveryCase: {
        findFirst: jest.fn().mockResolvedValue({ fundingBooking }),
      },
    };

    await expect(resolveRecoveryFundingBooking(tx, replacement))
      .resolves.toBe(fundingBooking);
    expect(tx.recoveryCase.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { replacementBookingId: 'booking-replacement' },
    }));
  });

  test('rejects a chained funding booking owned by another customer', async () => {
    const replacement = {
      id: 'booking-replacement',
      userId: 'customer-1',
      payments: [{
        status: 'SUCCESS',
        isDuplicate: false,
        paymentGateway: 'RECOVERY_CREDIT',
      }],
    };
    const foreignFundingBooking = {
      id: 'booking-vnpay-root',
      userId: 'customer-2',
      payments: [{
        status: 'SUCCESS',
        isDuplicate: false,
        paymentGateway: 'VNPAY',
      }],
    };
    const tx = {
      recoveryCase: {
        findFirst: jest.fn().mockResolvedValue({
          fundingBooking: foreignFundingBooking,
        }),
      },
    };

    await expect(resolveRecoveryFundingBooking(tx, replacement)).resolves.toBeNull();
  });

  test('refuses to invent refundable credit for an unlinked internal payment', async () => {
    const tx = {
      recoveryCase: { findFirst: jest.fn().mockResolvedValue(null) },
    };

    await expect(resolveRecoveryFundingBooking(tx, {
      id: 'orphan-booking',
      payments: [{
        status: 'SUCCESS',
        isDuplicate: false,
        paymentGateway: 'RECOVERY_CREDIT',
      }],
    })).resolves.toBeNull();
  });
});

describe('VietTicket Rescue Live Trip continuity', () => {
  test('preserves the old queue history and creates a clean replacement item', async () => {
    const now = new Date('2026-08-14T02:00:00.000Z');
    const tx = {
      liveTripItem: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'item-old',
          liveTripId: 'trip-1',
          bookingId: 'booking-old',
          attractionId: 'attraction-old',
          dayIndex: 0,
          orderIndex: 1,
          scheduledStart: new Date('2026-08-15T02:00:00.000Z'),
          scheduledEnd: new Date('2026-08-15T04:00:00.000Z'),
          status: 'AT_RISK',
          snapshot: { title: 'Điểm cũ' },
          smartQueueEntry: {
            id: 'queue-old',
            status: 'WAITING',
          },
        }]),
        create: jest.fn().mockResolvedValue({ id: 'item-replacement' }),
        update: jest.fn().mockResolvedValue({}),
      },
      liveTripProposal: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      smartQueueEntry: {
        update: jest.fn().mockResolvedValue({}),
      },
      liveTripEvent: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    const tripIds = await synchronizeLiveTrip(tx, {
      userId: 'user-1',
      originalBookingId: 'booking-old',
      replacementBookingId: 'booking-new',
      option: {
        attractionId: 'attraction-new',
        attractionTitle: 'Điểm thay thế',
        city: 'Đà Nẵng',
        visitDate: '2026-08-15',
        startTime: '09:30',
        endTime: '11:30',
        timeSlotId: 'slot-new',
      },
      now,
    });

    expect(tripIds).toEqual(['trip-1']);
    expect(tx.smartQueueEntry.update).toHaveBeenCalledWith({
      where: { id: 'queue-old' },
      data: { status: 'CANCELLED', cancelledAt: now },
    });
    expect(tx.liveTripItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        liveTripId: 'trip-1',
        bookingId: 'booking-new',
        attractionId: 'attraction-new',
        dayIndex: 0,
        orderIndex: 1,
        status: 'PLANNED',
        snapshot: expect.objectContaining({
          bookingId: 'booking-new',
          recoveredFromBookingId: 'booking-old',
          recoveredFromLiveTripItemId: 'item-old',
        }),
      }),
    });
    expect(tx.liveTripItem.update).toHaveBeenCalledWith({
      where: { id: 'item-old' },
      data: {
        status: 'SKIPPED',
        snapshot: expect.objectContaining({
          hiddenFromPlan: true,
          recoveredByBookingId: 'booking-new',
          recoveredByLiveTripItemId: 'item-replacement',
        }),
      },
    });
    expect(tx.liveTripProposal.updateMany).toHaveBeenCalledWith({
      where: { liveTripItemId: 'item-old', status: 'PENDING' },
      data: { status: 'SUPERSEDED', activeKey: null, decidedAt: now },
    });
    expect(tx.liveTripEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        liveTripItemId: 'item-replacement',
        type: 'ITEM_RECOVERED',
      }),
    });
  });
});

describe('VietTicket Rescue detail fallback', () => {
  const now = new Date('2026-08-15T01:00:00.000Z');

  function makeOpenCase(overrides = {}) {
    return {
      id: 'recovery-case',
      userId: 'customer-1',
      originalBookingId: 'booking-original',
      fundingBookingId: 'booking-original',
      replacementBookingId: null,
      status: 'OPEN',
      trigger: 'PARTNER_CANCELLATION',
      reason: 'Đối tác hủy hoạt động',
      creditAmount: 500000,
      refundAmount: 0,
      version: 4,
      expiresAt: new Date('2026-08-15T02:00:00.000Z'),
      originalSnapshot: makeContext().originalSnapshot,
      originalBooking: { id: 'booking-original' },
      fundingBooking: {
        id: 'booking-original',
        userId: 'customer-1',
        totalAmount: 500000,
        status: 'CANCELLED',
        payments: [{
          id: 'payment-vnpay',
          amount: 500000,
          status: 'SUCCESS',
          isDuplicate: false,
          paymentGateway: 'VNPAY',
        }],
      },
      replacementBooking: null,
      ...overrides,
    };
  }

  function makeTransaction(openCase, {
    claimedCount = 1,
    updatedCase = null,
  } = {}) {
    const pendingCase = updatedCase || {
      ...openCase,
      status: 'REFUND_PENDING',
      refundAmount: openCase.creditAmount,
      completedAt: now,
      version: openCase.version + 2,
    };
    return {
      recoveryCase: {
        findUnique: jest.fn().mockResolvedValue(openCase),
        updateMany: jest.fn().mockResolvedValue({ count: claimedCount }),
        update: jest.fn().mockResolvedValue(pendingCase),
      },
      ticketProduct: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      booking: {
        update: jest.fn().mockResolvedValue({}),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-log' }),
      },
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    getTicketAvailabilityBatch.mockResolvedValue(new Map());
    queueRecoveryFullRefund.mockResolvedValue({
      refundRequest: { id: 'refund-request' },
      refundTransaction: { id: 'refund-transaction' },
    });
  });

  test('keeps an OPEN case when live inventory temporarily has no valid option', async () => {
    const openCase = makeOpenCase();
    const tx = makeTransaction(openCase);
    prisma.$transaction.mockImplementation(async (callback) => callback(tx));

    const result = await getRecoveryCaseDetail({
      recoveryCaseId: openCase.id,
      userId: openCase.userId,
      now,
      req: { user: { id: openCase.userId } },
    });

    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    expect(tx.recoveryCase.updateMany).not.toHaveBeenCalled();
    expect(queueRecoveryFullRefund).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      options: [],
      transitionedToRefundPending: false,
      optionsUnavailable: true,
      recoveryCase: expect.objectContaining({
        id: openCase.id,
        status: 'OPEN',
      }),
    }));
  });

  test('queues a full refund after the Rescue window has actually expired', async () => {
    const openCase = makeOpenCase({
      expiresAt: new Date('2026-08-15T00:30:00.000Z'),
    });
    const tx = makeTransaction(openCase);
    prisma.$transaction.mockImplementation(async (callback) => callback(tx));

    const result = await getRecoveryCaseDetail({
      recoveryCaseId: openCase.id,
      userId: openCase.userId,
      now,
      req: { user: { id: openCase.userId } },
    });

    expect(tx.recoveryCase.updateMany).toHaveBeenCalledWith({
      where: {
        id: openCase.id,
        userId: openCase.userId,
        status: 'OPEN',
        version: openCase.version,
      },
      data: { version: { increment: 1 } },
    });
    expect(queueRecoveryFullRefund).toHaveBeenCalledWith(
      tx,
      openCase.fundingBooking,
      expect.objectContaining({
        recoveryCaseId: openCase.id,
        targetBookingId: openCase.originalBookingId,
        amount: 500000,
        type: 'PARTNER_CANCELLATION',
        now,
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: openCase.userId,
        action: 'RECOVERY_NO_OPTIONS_REFUND_QUEUED',
        entityType: 'RecoveryCase',
        entityId: openCase.id,
      }),
    });
    expect(result).toEqual(expect.objectContaining({
      options: [],
      transitionedToRefundPending: true,
      recoveryCase: expect.objectContaining({
        id: openCase.id,
        status: 'REFUND_PENDING',
        refundAmount: 500000,
      }),
    }));
  });

  test('does not inspect or mutate a case owned by another customer', async () => {
    const openCase = makeOpenCase();
    const tx = makeTransaction(openCase);
    prisma.$transaction.mockImplementation(async (callback) => callback(tx));

    await expect(getRecoveryCaseDetail({
      recoveryCaseId: openCase.id,
      userId: 'customer-intruder',
      now,
    })).rejects.toMatchObject({
      statusCode: 404,
      code: 'RECOVERY_NOT_FOUND',
    });

    expect(tx.recoveryCase.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: openCase.id, userId: 'customer-intruder' },
    }));
    expect(tx.ticketProduct.findMany).not.toHaveBeenCalled();
    expect(tx.recoveryCase.updateMany).not.toHaveBeenCalled();
    expect(queueRecoveryFullRefund).not.toHaveBeenCalled();
  });

  test('never queues a refund after losing the version claim to accept or decline', async () => {
    const openCase = makeOpenCase({
      expiresAt: new Date('2026-08-15T00:30:00.000Z'),
    });
    const tx = makeTransaction(openCase, { claimedCount: 0 });
    prisma.$transaction.mockImplementation(async (callback) => callback(tx));

    await expect(getRecoveryCaseDetail({
      recoveryCaseId: openCase.id,
      userId: openCase.userId,
      now,
    })).rejects.toMatchObject({
      statusCode: 409,
      code: 'RECOVERY_STATE_CHANGED',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(queueRecoveryFullRefund).not.toHaveBeenCalled();
    expect(tx.recoveryCase.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('VietTicket Rescue decision replay safety', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns the existing replacement for the exact same accept retry', async () => {
    const recoveryCase = {
      id: 'recovery-case',
      userId: 'customer-1',
      originalBookingId: 'booking-original',
      replacementBookingId: 'booking-replacement',
      status: 'REPLACED',
      refundAmount: 100000,
      selectedOptionSnapshot: {
        ticketProductId: 'ticket-product',
        timeSlotId: 'slot-1',
      },
    };
    const tx = {
      recoveryCase: { findUnique: jest.fn().mockResolvedValue(recoveryCase) },
      reservation: { create: jest.fn() },
      booking: { create: jest.fn() },
      payment: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementation(async (callback) => callback(tx));

    await expect(acceptRecoveryOption({
      recoveryCaseId: recoveryCase.id,
      userId: recoveryCase.userId,
      ticketProductId: 'ticket-product',
      timeSlotId: 'slot-1',
    })).resolves.toEqual({
      expired: false,
      replayed: true,
      recoveryCaseId: recoveryCase.id,
      originalBookingId: recoveryCase.originalBookingId,
      replacementBookingId: recoveryCase.replacementBookingId,
      refundDifference: 100000,
      liveTripIds: [],
    });

    expect(tx.reservation.create).not.toHaveBeenCalled();
    expect(tx.booking.create).not.toHaveBeenCalled();
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  test('rejects a different accept choice after a case was decided', async () => {
    const recoveryCase = {
      id: 'recovery-case',
      userId: 'customer-1',
      originalBookingId: 'booking-original',
      replacementBookingId: 'booking-replacement',
      status: 'REPLACED',
      selectedOptionSnapshot: {
        ticketProductId: 'ticket-product',
        timeSlotId: 'slot-1',
      },
    };
    const tx = {
      recoveryCase: { findUnique: jest.fn().mockResolvedValue(recoveryCase) },
    };
    prisma.$transaction.mockImplementation(async (callback) => callback(tx));

    await expect(acceptRecoveryOption({
      recoveryCaseId: recoveryCase.id,
      userId: recoveryCase.userId,
      ticketProductId: 'another-ticket',
      timeSlotId: null,
    })).rejects.toMatchObject({
      statusCode: 409,
      code: 'RECOVERY_ALREADY_DECIDED',
    });
  });

  test('returns the existing refund decision for a repeated decline', async () => {
    const recoveryCase = {
      id: 'recovery-case',
      userId: 'customer-1',
      originalBookingId: 'booking-original',
      status: 'REFUND_PENDING',
      declinedAt: new Date('2026-07-28T10:00:00.000Z'),
    };
    const tx = {
      recoveryCase: {
        findUnique: jest.fn().mockResolvedValue(recoveryCase),
        updateMany: jest.fn(),
      },
    };
    prisma.$transaction.mockImplementation(async (callback) => callback(tx));

    await expect(declineRecoveryCase({
      recoveryCaseId: recoveryCase.id,
      userId: recoveryCase.userId,
    })).resolves.toEqual({ ...recoveryCase, replayed: true });

    expect(tx.recoveryCase.updateMany).not.toHaveBeenCalled();
    expect(queueRecoveryFullRefund).not.toHaveBeenCalled();
  });
});

describe('VietTicket Rescue refund progress', () => {
  test('exposes only operational status fields for the matching refund', () => {
    const recoveryCase = {
      id: 'recovery-case',
      fundingBooking: {
        refundRequests: [
          {
            id: 'other-refund',
            requestKey: 'recovery-full:another-case',
            status: 'APPROVED',
            amount: 10000,
            refundTransactions: [],
          },
          {
            id: 'refund-request',
            requestKey: 'recovery-full:recovery-case',
            status: 'PROCESSING',
            amount: 500000,
            createdAt: new Date('2026-07-28T09:00:00.000Z'),
            processingStartedAt: new Date('2026-07-28T09:01:00.000Z'),
            processedAt: null,
            refundTransactions: [{
              id: 'refund-transaction',
              status: 'NEEDS_RECONCILIATION',
              gatewayResponseCode: '94',
              submittedAt: new Date('2026-07-28T09:02:00.000Z'),
              reconciledAt: null,
              processedAt: null,
            }],
          },
        ],
      },
    };

    expect(serializeRecoveryRefund(recoveryCase)).toEqual({
      requestId: 'refund-request',
      type: 'FULL',
      status: 'PROCESSING',
      amount: 500000,
      requestedAt: new Date('2026-07-28T09:00:00.000Z'),
      processingStartedAt: new Date('2026-07-28T09:01:00.000Z'),
      processedAt: null,
      transaction: {
        id: 'refund-transaction',
        status: 'NEEDS_RECONCILIATION',
        gatewayResponseCode: '94',
        submittedAt: new Date('2026-07-28T09:02:00.000Z'),
        reconciledAt: null,
        processedAt: null,
      },
    });
  });
});
