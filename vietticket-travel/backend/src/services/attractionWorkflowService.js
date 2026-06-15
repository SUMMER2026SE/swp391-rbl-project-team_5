'use strict';

const { Prisma } = require('@prisma/client');

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
      refundFeeRate: Number(t.refundFeeRate),
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
    ...(category !== undefined
      ? { category: category ? { id: category.id, name: category.name } : null }
      : {}),
  };
}

function validateSubmissionSnapshot(snapshot) {
  const missing = [];
  const description = String(snapshot.description || '').trim();

  if (!String(snapshot.title || '').trim()) missing.push('tên địa điểm');
  if (description.length < 50) missing.push('mô tả tối thiểu 50 ký tự');
  if (!String(snapshot.address || '').trim()) missing.push('địa chỉ');
  if (!String(snapshot.city || '').trim()) missing.push('tỉnh/thành phố');
  if (!snapshot.category?.id) missing.push('danh mục hợp lệ');
  if (!snapshot.openTime || !snapshot.closeTime) {
    missing.push('giờ mở cửa và đóng cửa');
  } else if (snapshot.openTime >= snapshot.closeTime) {
    missing.push('giờ đóng cửa phải sau giờ mở cửa');
  }
  if (snapshot.latitude == null || snapshot.longitude == null) {
    missing.push('tọa độ bản đồ');
  }
  if (!Array.isArray(snapshot.images) || snapshot.images.length === 0) {
    missing.push('ít nhất một hình ảnh');
  }
  if (!Array.isArray(snapshot.tickets) || snapshot.tickets.length === 0) {
    missing.push('ít nhất một gói vé');
  }
  if (
    !snapshot.schedule?.timeSlots
    || !Array.isArray(snapshot.schedule.timeSlots)
    || snapshot.schedule.timeSlots.length === 0
  ) {
    missing.push('ít nhất một khung giờ hoạt động');
  }

  return missing;
}

function hasPublishedVersion(attraction) {
  return Boolean(attraction.publishedAt);
}

function isPubliclyAvailable(attraction) {
  return (
    attraction?.publicationStatus === 'ACTIVE'
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
        await tx.ticketProduct.update({
          where: { id: ticket.id },
          data: {
            name: ticket.name,
            type: ticket.type,
            description: ticket.description || '',
            originalPrice: ticket.originalPrice,
            sellingPrice: ticket.sellingPrice,
            status: ticket.status,
            refundPolicy: ticket.refundPolicy,
            refundFeeRate: ticket.refundFeeRate,
          },
        });
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
            refundFeeRate: ticket.refundFeeRate || 0,
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
        defaultCapacity: snapshot.schedule.defaultCapacity || 100,
      },
    });

    // Khung giờ hoạt động
    await tx.timeSlot.updateMany({
      where: { attractionId, ticketProductId: null, isActive: true },
      data: { isActive: false },
    });

    if (Array.isArray(snapshot.schedule.timeSlots) && snapshot.schedule.timeSlots.length > 0) {
      await tx.timeSlot.createMany({
        data: snapshot.schedule.timeSlots.map((ts) => ({
          attractionId,
          startTime: ts.start,
          endTime: ts.end,
          maxCapacity: ts.capacity,
          isActive: ts.isActive !== false,
        })),
      });
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
  assertPartnerCanEdit,
  buildAttractionSnapshot,
  clearJsonField,
  hasPublishedVersion,
  isPubliclyAvailable,
  mergeSnapshot,
  normalizeImages,
  resolveActiveCategory,
  validateSubmissionSnapshot,
};
