'use strict';

/**
 * Catalog lifecycle and service fulfillment are deliberately different:
 * pausing sales, hiding a listing, or archiving a product must not invalidate
 * tickets already paid for. Only an operational/compliance stop blocks a
 * pending paid booking from becoming a usable ticket.
 */
function evaluateExistingBookingFulfillment(ticketProduct) {
  const attraction = ticketProduct?.attraction;
  if (!attraction) {
    return {
      allowed: false,
      code: 'FULFILLMENT_DATA_MISSING',
      cancellationSource: 'SYSTEM_FULFILLMENT_GUARD',
      reason: 'Không thể xác minh trạng thái vận hành của dịch vụ.',
    };
  }

  if (attraction.partner?.status !== 'APPROVED') {
    return {
      allowed: false,
      code: 'PARTNER_NOT_OPERATIONAL',
      cancellationSource: 'SYSTEM_PARTNER_SUSPENSION',
      reason: 'Nhà cung cấp hiện không còn đủ điều kiện vận hành dịch vụ.',
    };
  }

  if (attraction.operationalStatus !== 'ACTIVE') {
    return {
      allowed: false,
      code: 'ATTRACTION_NOT_OPERATIONAL',
      cancellationSource: 'SYSTEM_ATTRACTION_SUSPENSION',
      reason: 'Địa điểm hiện tạm ngừng vận hành và không thể tiếp nhận khách.',
    };
  }

  return { allowed: true, code: 'FULFILLMENT_ALLOWED' };
}

module.exports = {
  evaluateExistingBookingFulfillment,
};
