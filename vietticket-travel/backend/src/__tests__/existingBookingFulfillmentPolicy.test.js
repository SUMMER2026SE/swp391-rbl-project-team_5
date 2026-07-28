'use strict';

const {
  evaluateExistingBookingFulfillment,
} = require('../services/existingBookingFulfillmentPolicy');

function makeProduct(overrides = {}) {
  return {
    status: 'ACTIVE',
    archivedAt: null,
    ...overrides,
    attraction: {
      operationalStatus: 'ACTIVE',
      publicationStatus: 'ACTIVE',
      archivedAt: null,
      partner: { status: 'APPROVED' },
      ...(overrides.attraction || {}),
    },
  };
}

describe('existing paid booking fulfillment policy', () => {
  test.each([
    { status: 'INACTIVE' },
    { archivedAt: new Date('2099-01-01T00:00:00.000Z') },
    { attraction: { publicationStatus: 'PAUSED' } },
    { attraction: { publicationStatus: 'ARCHIVED', archivedAt: new Date() } },
  ])('catalog lifecycle does not cancel a paid booking: %#', (overrides) => {
    expect(evaluateExistingBookingFulfillment(makeProduct(overrides))).toEqual({
      allowed: true,
      code: 'FULFILLMENT_ALLOWED',
    });
  });

  test('operational suspension blocks ticket issuance', () => {
    const decision = evaluateExistingBookingFulfillment(makeProduct({
      attraction: { operationalStatus: 'SUSPENDED' },
    }));

    expect(decision).toEqual(expect.objectContaining({
      allowed: false,
      code: 'ATTRACTION_NOT_OPERATIONAL',
      cancellationSource: 'SYSTEM_ATTRACTION_SUSPENSION',
    }));
  });

  test('partner suspension blocks ticket issuance', () => {
    const decision = evaluateExistingBookingFulfillment(makeProduct({
      attraction: { partner: { status: 'SUSPENDED' } },
    }));

    expect(decision).toEqual(expect.objectContaining({
      allowed: false,
      code: 'PARTNER_NOT_OPERATIONAL',
      cancellationSource: 'SYSTEM_PARTNER_SUSPENSION',
    }));
  });
});
