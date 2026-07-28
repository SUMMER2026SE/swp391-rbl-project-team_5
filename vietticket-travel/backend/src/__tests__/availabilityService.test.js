'use strict';

const {
  buildAvailabilityResult,
  buildScheduleFromProduct,
} = require('../services/availabilityService');

const VISIT_DATE = new Date('2099-08-10T00:00:00.000Z');
const BEFORE_CUTOFF = new Date('2099-08-09T00:00:00.000Z');

function makeProduct(overrides = {}) {
  const attractionOverrides = overrides.attraction || {};
  return {
    id: 'ticket-1',
    status: 'ACTIVE',
    archivedAt: null,
    type: 'ADULT',
    admissionCount: 1,
    timeSlots: [],
    ...overrides,
    attraction: {
      id: 'attraction-1',
      publishedAt: new Date('2099-01-01T00:00:00.000Z'),
      publicationStatus: 'ACTIVE',
      operationalStatus: 'ACTIVE',
      archivedAt: null,
      openDays: '1,1,1,1,1,1,1',
      openTime: '08:00',
      closeTime: '17:00',
      defaultCapacity: 100,
      specialDates: [],
      timeSlots: [],
      partner: { status: 'APPROVED' },
      ...attractionOverrides,
    },
  };
}

describe('availabilityService business invariants', () => {
  test('ngày đóng cửa luôn hết chỗ dù các bảng kho còn số lượng', () => {
    const product = makeProduct({
      attraction: {
        specialDates: [{ closed: true, capacity: 100 }],
      },
    });
    const schedule = buildScheduleFromProduct(product, VISIT_DATE);

    const result = buildAvailabilityResult(
      schedule,
      VISIT_DATE,
      {
        dailyStock: { bookedQuantity: 0, heldQuantity: 0 },
        attractionStock: { bookedQty: 0, heldQty: 0 },
      },
      { now: BEFORE_CUTOFF },
    );

    expect(result.closed).toBe(true);
    expect(result.availableGuests).toBe(0);
    expect(result.availableTickets).toBe(0);
  });

  test('khả dụng lấy mức nhỏ nhất của kho sản phẩm, địa điểm và slot', () => {
    const product = makeProduct({
      timeSlots: [{
        id: 'slot-1',
        startTime: '09:00',
        endTime: '10:00',
        maxCapacity: 30,
      }],
    });
    const schedule = buildScheduleFromProduct(product, VISIT_DATE);

    const result = buildAvailabilityResult(
      schedule,
      VISIT_DATE,
      {
        dailyStock: { bookedQuantity: 4, heldQuantity: 1 },
        attractionStock: { bookedQty: 80, heldQty: 5 },
        slotStocks: [{ timeSlotId: 'slot-1', bookedQty: 8, heldQty: 2 }],
      },
      { now: BEFORE_CUTOFF },
    );

    // product còn 25, địa điểm còn 15, slot còn 20 => chỉ còn 15 khách.
    expect(result.availableGuests).toBe(15);
    expect(result.availableTickets).toBe(15);
  });

  test('gói gia đình quy đổi sức chứa khách thành đúng số gói có thể bán', () => {
    const product = makeProduct({
      type: 'FAMILY',
      admissionCount: 4,
    });
    const schedule = buildScheduleFromProduct(product, VISIT_DATE);

    const result = buildAvailabilityResult(
      schedule,
      VISIT_DATE,
      {
        dailyStock: { bookedQuantity: 88, heldQuantity: 1 },
        attractionStock: { bookedQty: 88, heldQty: 1 },
      },
      { now: BEFORE_CUTOFF },
    );

    expect(result.availableGuests).toBe(11);
    expect(result.availableTickets).toBe(2);
  });

  test('địa điểm hoặc đối tác ngừng vận hành không tạo lịch có thể bán', () => {
    const suspendedAttraction = makeProduct({
      attraction: { operationalStatus: 'SUSPENDED' },
    });
    const suspendedPartner = makeProduct({
      attraction: { partner: { status: 'SUSPENDED' } },
    });

    expect(buildScheduleFromProduct(suspendedAttraction, VISIT_DATE)).toBeNull();
    expect(buildScheduleFromProduct(suspendedPartner, VISIT_DATE)).toBeNull();
  });
});
