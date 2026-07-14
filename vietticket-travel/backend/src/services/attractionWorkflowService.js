'use strict';

const { Prisma } = require('@prisma/client');
const {
  isValidDate,
  isValidTime,
  validateTicket,
} = require('../utils/partnerValidators');
const { normalizeRefundFeeRate } = require('../utils/refundService');

const REVIEWABLE_STATUSES = ['DRAFT', 'REJECTED'];

function normalizeSnapshotImage(image) {
  return {
    id: String(image.id),
    url: String(image.url || image.imageUrl || ''),
    isPrimary: Boolean(image.isPrimary),
  };
}

function normalizeImages(images = []) {
  const valid = images
    .map(normalizeSnapshotImage)
    .filter((image) => image.id && image.url);

  if (valid.length > 0 && !valid.some((image) => image.isPrimary)) {
    valid[0].isPrimary = true;
  }

  let foundPrimary = false;
  return valid.map((image) => {
    if (!image.isPrimary) return image;
    if (foundPrimary) return { ...image, isPrimary: false };
    foundPrimary = true;
    return image;
  });
}

function buildAttractionSnapshot(attraction) {
  const tickets = (attraction.ticketProducts || [])
    .filter((t) => t.archivedAt == null)
    .map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      description: t.description || '',
      originalPrice: Number(t.originalPrice),
      sellingPrice: Number(t.sellingPrice),
      status: t.status,
      refundPolicy: t.refundPolicy,
      refundFeeRate: normalizeRefundFeeRate(t.refundPolicy, t.refundFeeRate),
      refundCutoffHours: Number(t.refundCutoffHours ?? 24),
    }));

  const timeSlots = (attraction.timeSlots || [])
    .filter((ts) => ts.ticketProductId == null && ts.isActive)
    .map((ts) => ({
      id: ts.id,
      start: ts.startTime,
      end: ts.endTime,
      capacity: ts.maxCapacity,
      isActive: ts.isActive,
    }));

  const specialDates = {};
  for (const sd of attraction.specialDates || []) {
    specialDates[new Date(sd.date).toISOString().slice(0, 10)] = {
      closed: sd.closed,
      capacity: sd.capacity ?? undefined,
    };
  }

  return {
    schemaVersion: 1,
    title: attraction.title || '',
    description: attraction.description || '',
    address: attraction.address || '',
    city: attraction.city || '',
    district: attraction.district || null,
    openTime: attraction.openTime || null,
    closeTime: attraction.closeTime || null,
    latitude: attraction.latitude ?? null,
    longitude: attraction.longitude ?? null,
    requiresManualApproval: Boolean(attraction.requiresManualApproval),
    category: attraction.categories?.[0]?.category
      ? {
          id: attraction.categories[0].category.id,
          name: attraction.categories[0].category.name,
        }
      : null,
    images: normalizeImages(attraction.images || []),
    tickets,
    schedule: {
      openDays: attraction.openDays
        ? String(attraction.openDays)
            .split(',')
            .map((p) => p.trim() === '1')
        : [true, true, true, true, true, true, true],
      defaultCapacity: attraction.defaultCapacity ?? 100,
      timeSlots,
      specialDates,
    },
  };
}

function mergeSnapshot(snapshot, data, category) {
  return {
    ...snapshot,
    ...(data.title !== undefined ? { title: data.title } : {}),
    ...(data.description !== undefined ? { description: data.description } : {}),
    ...(data.address !== undefined ? { address: data.address } : {}),
    ...(data.city !== undefined ? { city: data.city } : {}),
    ...(data.district !== undefined ? { district: data.district } : {}),
    ...(data.openTime !== undefined ? { openTime: data.openTime } : {}),
    ...(data.closeTime !== undefined ? { closeTime: data.closeTime } : {}),
    ...(data.latitude !== undefined ? { latitude: data.latitude } : {}),
    ...(data.longitude !== undefined ? { longitude: data.longitude } : {}),
    ...(data.requiresManualApproval !== undefined
      ? { requiresManualApproval: Boolean(data.requiresManualApproval) }
      : {}),
    ...(category !== undefined
      ? { category: category ? { id: category.id, name: category.name } : null }
      : {}),
  };
}

function validateSubmissionSnapshot(snapshot) {
  const missing = [];
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return ['dữ liệu phiên bản gửi duyệt không hợp lệ'];
  }

  const description = String(snapshot.description || '').trim();
  const title = String(snapshot.title || '').trim();

  if (!title) missing.push('tên địa điểm');
  else if (title.length > 200) missing.push('tên địa điểm không quá 200 ký tự');
  if (description.length < 50) missing.push('mô tả tối thiểu 50 ký tự');
  else if (description.length > 5000) missing.push('mô tả không quá 5000 ký tự');
  if (!String(snapshot.address || '').trim()) missing.push('địa chỉ');
  if (!String(snapshot.city || '').trim()) missing.push('tỉnh/thành phố');
  if (!snapshot.category?.id) missing.push('danh mục hợp lệ');
  if (!isValidTime(snapshot.openTime) || !isValidTime(snapshot.closeTime)) {
    missing.push('giờ mở cửa và đóng cửa');
  } else if (snapshot.openTime >= snapshot.closeTime) {
    missing.push('giờ đóng cửa phải sau giờ mở cửa');
  }
  const latitude = Number(snapshot.latitude);
  const longitude = Number(snapshot.longitude);
  if (
    snapshot.latitude == null
    || snapshot.longitude == null
    || !Number.isFinite(latitude)
    || !Number.isFinite(longitude)
    || latitude < -90
    || latitude > 90
    || longitude < -180
    || longitude > 180
  ) {
    missing.push('tọa độ bản đồ');
  }
  if (
    !Array.isArray(snapshot.images)
    || snapshot.images.length === 0
    || snapshot.images.some((image) => !String(image?.url || image?.imageUrl || '').trim())
  ) {
    missing.push('ít nhất một hình ảnh');
  }

  if (!Array.isArray(snapshot.tickets) || snapshot.tickets.length === 0) {
    missing.push('ít nhất một gói vé');
  } else {
    const persistedTicketIds = new Set();
    const normalizedNames = new Set();
    let activeTicketCount = 0;
    snapshot.tickets.forEach((ticket, index) => {
      const ticketError = validateTicket(ticket || {}, { partial: false });
      if (ticketError) missing.push(`gói vé ${index + 1}: ${ticketError}`);

      if (!['ACTIVE', 'INACTIVE'].includes(String(ticket?.status || 'ACTIVE').toUpperCase())) {
        missing.push(`gói vé ${index + 1}: trạng thái không hợp lệ`);
      }
      if (String(ticket?.status || 'ACTIVE').toUpperCase() === 'ACTIVE') {
        activeTicketCount += 1;
      }

      const nameKey = String(ticket?.name || '').trim().toLocaleLowerCase('vi');
      if (nameKey && normalizedNames.has(nameKey)) {
        missing.push(`gói vé ${index + 1}: tên gói vé bị trùng`);
      }
      if (nameKey) normalizedNames.add(nameKey);

      const ticketId = String(ticket?.id || '');
      if (ticketId && !ticketId.startsWith('draft-')) {
        if (persistedTicketIds.has(ticketId)) {
          missing.push(`gói vé ${index + 1}: mã gói vé bị trùng`);
        }
        persistedTicketIds.add(ticketId);
      }
    });
    if (activeTicketCount === 0) missing.push('ít nhất một gói vé đang hoạt động');
  }

  const schedule = snapshot.schedule;
  const slots = schedule?.timeSlots;
  if (!schedule || !Array.isArray(slots) || slots.length === 0) {
    missing.push('ít nhất một khung giờ hoạt động');
  } else {
    const defaultCapacity = Number(schedule.defaultCapacity);
    if (!Number.isInteger(defaultCapacity) || defaultCapacity < 1) {
      missing.push('sức chứa mặc định phải là số nguyên dương');
    }
    if (
      !Array.isArray(schedule.openDays)
      || schedule.openDays.length !== 7
      || schedule.openDays.some((day) => typeof day !== 'boolean')
      || !schedule.openDays.some(Boolean)
    ) {
      missing.push('lịch mở cửa phải có đúng 7 ngày và ít nhất một ngày hoạt động');
    }

    const activeSlots = [];
    slots.forEach((slot, index) => {
      const start = slot?.start;
      const end = slot?.end;
      const capacity = Number(slot?.capacity);
      if (!isValidTime(start) || !isValidTime(end) || start >= end) {
        missing.push(`khung giờ ${index + 1}: thời gian không hợp lệ`);
      }
      if (!Number.isInteger(capacity) || capacity < 1) {
        missing.push(`khung giờ ${index + 1}: sức chứa phải là số nguyên dương`);
      }
      if (slot?.isActive !== false) activeSlots.push({ start, end, capacity, index });
    });
    if (activeSlots.length === 0) missing.push('ít nhất một khung giờ đang hoạt động');

    activeSlots.sort((a, b) => String(a.start).localeCompare(String(b.start)));
    for (let index = 1; index < activeSlots.length; index += 1) {
      if (String(activeSlots[index].start) < String(activeSlots[index - 1].end)) {
        missing.push('các khung giờ hoạt động không được chồng lấn');
        break;
      }
    }
    const totalSlotCapacity = activeSlots.reduce((sum, slot) => sum + slot.capacity, 0);
    if (Number.isInteger(defaultCapacity) && totalSlotCapacity > defaultCapacity) {
      missing.push('tổng sức chứa khung giờ không được vượt sức chứa mặc định');
    }

    const specialDates = schedule.specialDates || {};
    if (typeof specialDates !== 'object' || Array.isArray(specialDates)) {
      missing.push('cấu hình ngày đặc biệt không hợp lệ');
    } else {
      for (const [dateKey, value] of Object.entries(specialDates)) {
        if (!isValidDate(dateKey) || !value || typeof value !== 'object' || Array.isArray(value)) {
          missing.push(`ngày đặc biệt ${dateKey} không hợp lệ`);
          continue;
        }
        if (value.capacity !== undefined && value.capacity !== null && value.capacity !== '') {
          const capacity = Number(value.capacity);
          if (!Number.isInteger(capacity) || capacity < 0) {
            missing.push(`sức chứa ngày đặc biệt ${dateKey} không hợp lệ`);
          } else if (!value.closed && totalSlotCapacity > capacity) {
            missing.push(`sức chứa khung giờ vượt sức chứa ngày đặc biệt ${dateKey}`);
          }
        }
      }
    }
  }

  return [...new Set(missing)];
}

function hasPublishedVersion(attraction) {
  return Boolean(attraction.publishedAt);
}

function isPubliclyAvailable(attraction) {
  return (
    attraction?.publicationStatus === 'ACTIVE'
    && Boolean(attraction.publishedAt)
    && !attraction.archivedAt
    && attraction.status !== 'SUSPENDED'
  );
}

function assertPartnerCanEdit(attraction) {
  if (attraction.status === 'PENDING') {
    const error = new Error('Địa điểm đang chờ duyệt. Vui lòng chờ admin xử lý trước khi chỉnh sửa.');
    error.statusCode = 409;
    throw error;
  }
  if (attraction.status === 'SUSPENDED') {
    const error = new Error('Địa điểm đang bị đình chỉ và không thể chỉnh sửa.');
    error.statusCode = 403;
    throw error;
  }
}

function proposedDayCapacity(snapshot, dateValue) {
  const schedule = snapshot.schedule || {};
  const date = new Date(dateValue);
  const dateKey = date.toISOString().slice(0, 10);
  const specialDate = schedule.specialDates?.[dateKey];
  if (specialDate) {
    if (specialDate.closed) return 0;
    return Number(specialDate.capacity ?? schedule.defaultCapacity ?? 0);
  }
  const mondayFirstIndex = (date.getUTCDay() + 6) % 7;
  if (!schedule.openDays?.[mondayFirstIndex]) return 0;
  return Number(schedule.defaultCapacity ?? 0);
}

function vietnamBusinessDate(now = new Date()) {
  const key = new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return new Date(`${key}T00:00:00.000Z`);
}

function activeSnapshotSlots(snapshot) {
  return (snapshot.schedule?.timeSlots || []).filter((slot) => slot.isActive !== false);
}

async function assertFutureTimeSlotCapacity(tx, attractionId, snapshot, now = new Date()) {
  if (!snapshot.schedule) return new Set();
  const stocks = await tx.timeSlotStock.findMany({
    where: {
      date: { gte: vietnamBusinessDate(now) },
      timeSlot: { attractionId, ticketProductId: null },
    },
    select: {
      timeSlotId: true,
      date: true,
      bookedQty: true,
      heldQty: true,
      timeSlot: { select: { startTime: true, endTime: true } },
    },
  });
  const proposedSlots = activeSnapshotSlots(snapshot);
  const committedSlotIds = new Set();
  const commitments = new Map();

  for (const stock of stocks) {
    const committed = Number(stock.bookedQty || 0) + Number(stock.heldQty || 0);
    if (committed <= 0) continue;
    committedSlotIds.add(stock.timeSlotId);
    const dateKey = new Date(stock.date).toISOString().slice(0, 10);
    const key = `${dateKey}|${stock.timeSlot.startTime}|${stock.timeSlot.endTime}`;
    commitments.set(key, (commitments.get(key) || 0) + committed);
  }

  for (const [key, committed] of commitments) {
    const [dateKey, startTime, endTime] = key.split('|');
    const proposed = proposedSlots.find(
      (slot) => slot.start === startTime && slot.end === endTime,
    );
    if (!proposed) {
      const error = new Error(
        `Kh\u00f4ng th\u1ec3 x\u00f3a ho\u1eb7c \u0111\u1ed5i khung gi\u1edd ${startTime}-${endTime} ng\u00e0y ${dateKey} v\u00ec \u0111\u00e3 c\u00f3 ${committed} v\u00e9 \u0111\u01b0\u1ee3c b\u00e1n ho\u1eb7c gi\u1eef ch\u1ed7.`,
      );
      error.statusCode = 409;
      throw error;
    }
    if (committed > Number(proposed.capacity || 0)) {
      const error = new Error(
        `Kh\u00f4ng th\u1ec3 gi\u1ea3m s\u1ee9c ch\u1ee9a khung gi\u1edd ${startTime}-${endTime} ng\u00e0y ${dateKey} xu\u1ed1ng ${proposed.capacity} v\u00ec \u0111\u00e3 c\u00f3 ${committed} v\u00e9 \u0111\u01b0\u1ee3c b\u00e1n ho\u1eb7c gi\u1eef ch\u1ed7.`,
      );
      error.statusCode = 409;
      throw error;
    }
  }

  return committedSlotIds;
}

async function planFutureAttractionStockSync(tx, attractionId, snapshot, now = new Date()) {
  if (!snapshot.schedule) return [];
  const today = vietnamBusinessDate(now);
  const stocks = await tx.attractionDailyStock.findMany({
    where: { attractionId, date: { gte: today } },
    select: { id: true, date: true, bookedQty: true, heldQty: true },
  });

  return stocks.map((stock) => {
    const capacity = proposedDayCapacity(snapshot, stock.date);
    const committed = Number(stock.bookedQty || 0) + Number(stock.heldQty || 0);
    if (committed > capacity) {
      const error = new Error(
        `Không thể giảm sức chứa ngày ${new Date(stock.date).toISOString().slice(0, 10)} xuống ${capacity} vì đã có ${committed} vé được bán hoặc giữ chỗ.`,
      );
      error.statusCode = 409;
      throw error;
    }
    return { id: stock.id, capacity };
  });
}

async function resolveActiveCategory(client, categoryName) {
  const name = String(categoryName || '').trim();
  if (!name) return null;

  return client.category.findFirst({
    where: {
      name: { equals: name, mode: 'insensitive' },
      isActive: true,
    },
  });
}

async function applyApprovedSnapshot(tx, attractionId, snapshot) {
  const stockSyncPlan = await planFutureAttractionStockSync(tx, attractionId, snapshot);
  const committedSlotIds = await assertFutureTimeSlotCapacity(tx, attractionId, snapshot);
  await tx.attraction.update({
    where: { id: attractionId },
    data: {
      title: snapshot.title,
      description: snapshot.description || '',
      address: snapshot.address,
      city: snapshot.city,
      district: snapshot.district || null,
      openTime: snapshot.openTime || null,
      closeTime: snapshot.closeTime || null,
      latitude: snapshot.latitude ?? null,
      longitude: snapshot.longitude ?? null,
      ...(snapshot.requiresManualApproval !== undefined
        ? { requiresManualApproval: Boolean(snapshot.requiresManualApproval) }
        : {}),
    },
  });

  await tx.attractionCategory.deleteMany({ where: { attractionId } });
  if (snapshot.category?.id) {
    await tx.attractionCategory.create({
      data: { attractionId, categoryId: snapshot.category.id },
    });
  }

  await tx.attractionImage.deleteMany({ where: { attractionId } });
  const images = normalizeImages(snapshot.images);
  if (images.length > 0) {
    await tx.attractionImage.createMany({
      data: images.map((image) => ({
        attractionId,
        imageUrl: image.url,
        isPrimary: image.isPrimary,
      })),
    });
  }

  // --- Đồng bộ Vé ---
  if (Array.isArray(snapshot.tickets)) {
    const snapshotTicketIds = snapshot.tickets
      .map((t) => t.id)
      .filter((id) => id && !id.startsWith('draft-'));

    // Soft delete tickets not in snapshot
    await tx.ticketProduct.updateMany({
      where: {
        attractionId,
        id: { notIn: snapshotTicketIds },
        archivedAt: null,
      },
      data: { archivedAt: new Date(), status: 'INACTIVE' },
    });

    // Create / Update tickets
    for (const ticket of snapshot.tickets) {
      if (ticket.id && !ticket.id.startsWith('draft-')) {
        const updated = await tx.ticketProduct.updateMany({
          where: { id: ticket.id, attractionId, archivedAt: null },
          data: {
            name: ticket.name,
            type: ticket.type,
            description: ticket.description || '',
            originalPrice: ticket.originalPrice,
            sellingPrice: ticket.sellingPrice,
            status: ticket.status,
            refundPolicy: ticket.refundPolicy,
            refundFeeRate: normalizeRefundFeeRate(
              ticket.refundPolicy,
              ticket.refundFeeRate,
            ),
            refundCutoffHours: ticket.refundCutoffHours ?? 24,
          },
        });
        if (updated.count !== 1) {
          const error = new Error(`Gói vé ${ticket.id} không thuộc địa điểm đang được duyệt.`);
          error.statusCode = 409;
          throw error;
        }
      } else {
        await tx.ticketProduct.create({
          data: {
            attractionId,
            name: ticket.name,
            type: ticket.type,
            description: ticket.description || '',
            originalPrice: ticket.originalPrice,
            sellingPrice: ticket.sellingPrice,
            status: ticket.status || 'ACTIVE',
            refundPolicy: ticket.refundPolicy || 'NON_REFUNDABLE',
            refundFeeRate: normalizeRefundFeeRate(
              ticket.refundPolicy || 'NON_REFUNDABLE',
              ticket.refundFeeRate,
            ),
            refundCutoffHours: ticket.refundCutoffHours ?? 24,
          },
        });
      }
    }
  }

  // --- Đồng bộ Lịch ---
  if (snapshot.schedule) {
    const csvOpenDays = Array.isArray(snapshot.schedule.openDays)
      ? snapshot.schedule.openDays.map((v) => (v ? '1' : '0')).join(',')
      : '1,1,1,1,1,1,1';

    await tx.attraction.update({
      where: { id: attractionId },
      data: {
        openDays: csvOpenDays,
        defaultCapacity: snapshot.schedule.defaultCapacity ?? 100,
      },
    });

    for (const stock of stockSyncPlan) {
      await tx.attractionDailyStock.update({
        where: { id: stock.id },
        data: { capacity: stock.capacity },
      });
    }

    // Khung giờ hoạt động
    const existingSlots = await tx.timeSlot.findMany({
      where: { attractionId, ticketProductId: null },
      select: { id: true, startTime: true, endTime: true, isActive: true },
    });
    const selectedSlotIds = [];
    const slotsToCreate = [];
    for (const slot of activeSnapshotSlots(snapshot)) {
      const candidates = existingSlots.filter(
        (item) => item.startTime === slot.start && item.endTime === slot.end,
      );
      const selected = candidates.find((item) => committedSlotIds.has(item.id))
        || candidates.find((item) => item.isActive)
        || candidates[0];
      if (selected) {
        selectedSlotIds.push(selected.id);
        await tx.timeSlot.updateMany({
          where: { id: selected.id, attractionId, ticketProductId: null },
          data: { maxCapacity: Number(slot.capacity), isActive: true },
        });
      } else {
        slotsToCreate.push({
          attractionId,
          startTime: slot.start,
          endTime: slot.end,
          maxCapacity: Number(slot.capacity),
          isActive: true,
        });
      }
    }
    await tx.timeSlot.updateMany({
      where: {
        attractionId,
        ticketProductId: null,
        id: { notIn: selectedSlotIds },
        isActive: true,
      },
      data: { isActive: false },
    });
    if (slotsToCreate.length > 0) {
      await tx.timeSlot.createMany({ data: slotsToCreate });
    }

    // Ngày đặc biệt
    await tx.specialDate.deleteMany({ where: { attractionId } });
    if (snapshot.schedule.specialDates) {
      const sdEntries = Object.entries(snapshot.schedule.specialDates);
      if (sdEntries.length > 0) {
        await tx.specialDate.createMany({
          data: sdEntries.map(([dateKey, value]) => ({
            attractionId,
            date: new Date(dateKey),
            closed: Boolean(value.closed),
            capacity: value.capacity ?? null,
          })),
        });
      }
    }
  }
}

function clearJsonField() {
  return Prisma.DbNull;
}

module.exports = {
  REVIEWABLE_STATUSES,
  applyApprovedSnapshot,
  assertFutureTimeSlotCapacity,
  assertPartnerCanEdit,
  buildAttractionSnapshot,
  clearJsonField,
  hasPublishedVersion,
  isPubliclyAvailable,
  mergeSnapshot,
  normalizeImages,
  planFutureAttractionStockSync,
  proposedDayCapacity,
  resolveActiveCategory,
  validateSubmissionSnapshot,
};
