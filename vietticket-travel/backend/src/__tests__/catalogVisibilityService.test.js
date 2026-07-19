'use strict';

const {
  isAttractionSaleEnabled,
  isTicketProductSaleEnabled,
  publicAttractionWhere,
} = require('../services/catalogVisibilityService');

function activeAttraction(overrides = {}) {
  return {
    publishedAt: new Date('2026-06-01T00:00:00.000Z'),
    publicationStatus: 'ACTIVE',
    status: 'APPROVED',
    archivedAt: null,
    partner: { status: 'APPROVED' },
    ...overrides,
  };
}

describe('catalog visibility', () => {
  test('public filter always requires an approved partner', () => {
    expect(publicAttractionWhere({ city: 'Da Nang' })).toEqual(expect.objectContaining({
      city: 'Da Nang',
      partner: { status: 'APPROVED' },
      publicationStatus: 'ACTIVE',
      archivedAt: null,
    }));
  });

  test('extra conditions cannot override mandatory visibility guards', () => {
    expect(publicAttractionWhere({
      publicationStatus: 'PAUSED',
      partner: { status: 'SUSPENDED' },
    })).toEqual(expect.objectContaining({
      publicationStatus: 'ACTIVE',
      partner: { status: 'APPROVED' },
    }));
  });

  test('suspended partner disables attraction and ticket sales', () => {
    const attraction = activeAttraction({ partner: { status: 'SUSPENDED' } });
    expect(isAttractionSaleEnabled(attraction)).toBe(false);
    expect(isTicketProductSaleEnabled({
      status: 'ACTIVE',
      archivedAt: null,
      attraction,
    })).toBe(false);
  });
});
