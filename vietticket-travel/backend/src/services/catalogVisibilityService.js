'use strict';

function publicAttractionWhere(extra = {}) {
  return {
    ...extra,
    publishedAt: { not: null },
    publicationStatus: 'ACTIVE',
    operationalStatus: 'ACTIVE',
    archivedAt: null,
    partner: { status: 'APPROVED' },
  };
}

function isAttractionSaleEnabled(attraction) {
  return Boolean(
    attraction
    && attraction.publishedAt
    && attraction.publicationStatus === 'ACTIVE'
    && attraction.operationalStatus !== 'SUSPENDED'
    && !attraction.archivedAt
    && attraction.partner?.status === 'APPROVED',
  );
}

function isTicketProductSaleEnabled(ticketProduct) {
  return Boolean(
    ticketProduct
    && ticketProduct.status === 'ACTIVE'
    && !ticketProduct.archivedAt
    && isAttractionSaleEnabled(ticketProduct.attraction),
  );
}

module.exports = {
  isAttractionSaleEnabled,
  isTicketProductSaleEnabled,
  publicAttractionWhere,
};
