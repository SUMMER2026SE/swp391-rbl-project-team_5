const {
  applyApprovedSnapshot,
  assertFutureTimeSlotCapacity,
  buildAttractionSnapshot,
  mergeSnapshot,
  planFutureAttractionStockSync,
  validateSubmissionSnapshot,
} = require('../services/attractionWorkflowService');

function validSnapshot() {
  return {
    title: 'Khu vui chơi mẫu',
    description: 'Mô tả đầy đủ về khu vui chơi, dịch vụ và những trải nghiệm dành cho khách tham quan.',
    address: '1 Đường Mẫu',
    city: 'TP. Hồ Chí Minh',
    openTime: '08:00',
    closeTime: '17:00',
    latitude: 10.7,
    longitude: 106.7,
    category: { id: 'category-1', name: 'Vui chơi' },
    images: [{ id: 'image-1', url: '/uploads/image.jpg', isPrimary: true }],
    tickets: [{
      id: 'draft-ticket-1',
      name: 'Vé người lớn',
      type: 'ADULT',
      originalPrice: 120000,
      sellingPrice: 100000,
      status: 'ACTIVE',
      refundPolicy: 'FREE_CANCELLATION',
      refundFeeRate: 0,
    }],
    schedule: {
      openDays: [true, true, true, true, true, true, false],
      defaultCapacity: 100,
      timeSlots: [
        { id: 'slot-1', start: '08:00', end: '11:00', capacity: 40, isActive: true },
        { id: 'slot-2', start: '13:00', end: '17:00', capacity: 60, isActive: true },
      ],
      specialDates: {},
    },
  };
}

test('chấp nhận snapshot đầy đủ và hợp lệ', () => {
  expect(validateSubmissionSnapshot(validSnapshot())).toEqual([]);
});

test('chặn giá vé sai, slot chồng lấn và tổng sức chứa vượt giới hạn', () => {
  const snapshot = validSnapshot();
  snapshot.tickets[0].sellingPrice = 130000;
  snapshot.schedule.defaultCapacity = 50;
  snapshot.schedule.timeSlots[1].start = '10:00';

  const errors = validateSubmissionSnapshot(snapshot);
  expect(errors).toEqual(expect.arrayContaining([
    expect.stringContaining('Giá bán không được lớn hơn giá gốc'),
    'các khung giờ hoạt động không được chồng lấn',
    'tổng sức chứa khung giờ không được vượt sức chứa mặc định',
  ]));
});

test('chặn snapshot không có vé/slot hoạt động và ngày đặc biệt không tồn tại', () => {
  const snapshot = validSnapshot();
  snapshot.tickets[0].status = 'INACTIVE';
  snapshot.schedule.timeSlots.forEach((slot) => { slot.isActive = false; });
  snapshot.schedule.specialDates['2026-02-31'] = { closed: true };

  expect(validateSubmissionSnapshot(snapshot)).toEqual(expect.arrayContaining([
    'ít nhất một gói vé đang hoạt động',
    'ít nhất một khung giờ đang hoạt động',
    'ngày đặc biệt 2026-02-31 không hợp lệ',
  ]));
});

test('cờ duyệt thủ công được lưu trong snapshot và merge draft', () => {
  const snapshot = buildAttractionSnapshot({
    requiresManualApproval: false,
    ticketProducts: [],
    timeSlots: [],
    specialDates: [],
    images: [],
    categories: [],
  });
  expect(snapshot.requiresManualApproval).toBe(false);
  expect(mergeSnapshot(snapshot, { requiresManualApproval: true })).toEqual(
    expect.objectContaining({ requiresManualApproval: true }),
  );
});

test('không áp dụng ticket ID thuộc địa điểm khác', async () => {
  const snapshot = validSnapshot();
  snapshot.tickets[0].id = 'ticket-of-another-attraction';
  const tx = {
    attractionDailyStock: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
    timeSlotStock: { findMany: jest.fn().mockResolvedValue([]) },
    attraction: { update: jest.fn().mockResolvedValue({}) },
    attractionCategory: {
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({}),
    },
    attractionImage: {
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    ticketProduct: {
      updateMany: jest.fn()
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 0 }),
      create: jest.fn(),
    },
  };

  await expect(applyApprovedSnapshot(tx, 'attraction-1', snapshot)).rejects.toThrow(
    'không thuộc địa điểm đang được duyệt',
  );
  expect(tx.ticketProduct.create).not.toHaveBeenCalled();
});

test('blocks a future capacity reduction below sold and held inventory', async () => {
  const snapshot = validSnapshot();
  snapshot.schedule.defaultCapacity = 50;
  const tx = {
    attractionDailyStock: {
      findMany: jest.fn().mockResolvedValue([{
        id: 'stock-1',
        date: new Date('2027-01-05T00:00:00.000Z'),
        bookedQty: 45,
        heldQty: 10,
      }]),
    },
  };

  await expect(planFutureAttractionStockSync(
    tx,
    'attraction-1',
    snapshot,
    new Date('2027-01-01T00:00:00.000Z'),
  )).rejects.toMatchObject({ statusCode: 409 });
});

test('blocks removing a future time slot that already has sold inventory', async () => {
  const snapshot = validSnapshot();
  snapshot.schedule.timeSlots = snapshot.schedule.timeSlots.filter(
    (slot) => slot.id !== 'slot-1',
  );
  const tx = {
    timeSlotStock: {
      findMany: jest.fn().mockResolvedValue([{
        timeSlotId: 'slot-1',
        date: new Date('2027-01-05T00:00:00.000Z'),
        bookedQty: 10,
        heldQty: 2,
        timeSlot: { startTime: '08:00', endTime: '11:00' },
      }]),
    },
  };

  await expect(assertFutureTimeSlotCapacity(
    tx,
    'attraction-1',
    snapshot,
    new Date('2027-01-01T00:00:00.000Z'),
  )).rejects.toMatchObject({ statusCode: 409 });
});
