const { randomUUID } = require('crypto');
const prisma = require('../config/prisma');
const {
  attractionStatusFromClient,
  toAttractionListItem,
  toAttractionDetail,
} = require('../utils/partnerMappers');
const { validateAttraction } = require('../utils/partnerValidators');
const { buildUploadUrl } = require('../middleware/uploadMiddleware');
const { writeAuditLog } = require('../utils/auditLog');
const {
  assertPartnerCanEdit,
  buildAttractionSnapshot,
  hasPublishedVersion,
  mergeSnapshot,
  normalizeImages,
  resolveActiveCategory,
  validateSubmissionSnapshot,
} = require('../services/attractionWorkflowService');
const {
  isAttractionSaleEnabled,
  publicAttractionWhere,
} = require('../services/catalogVisibilityService');

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const attractionInclude = {
  images: true,
  categories: { include: { category: true } },
  ticketProducts: { where: { archivedAt: null } },
  timeSlots: { where: { ticketProductId: null, isActive: true } },
  specialDates: true,
};

const attractionIncludeWithOrderedImages = {
  ...attractionInclude,
  images: { orderBy: { createdAt: 'asc' } },
};

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
  }
  return Boolean(value);
}

// Tìm điểm tham quan và xác minh thuộc về đối tác hiện tại
async function findOwnedAttraction(attractionId, partnerId, include = attractionInclude) {
  const attraction = await prisma.attraction.findUnique({
    where: { id: attractionId },
    include,
  });

  if (!attraction || attraction.archivedAt || attraction.partnerId !== partnerId) {
    return null;
  }

  return attraction;
}

function toImagePayload(image) {
  return {
    id: image.id,
    url: image.url || image.imageUrl,
    isPrimary: Boolean(image.isPrimary),
  };
}

function getWorkingDraft(attraction) {
  const source = attraction.draftData && typeof attraction.draftData === 'object'
    ? attraction.draftData
    : buildAttractionSnapshot(attraction);

  return {
    ...source,
    images: normalizeImages(source.images || []),
  };
}

async function saveDraftImages(attraction, images) {
  const draft = {
    ...getWorkingDraft(attraction),
    images: normalizeImages(images),
  };

  await prisma.attraction.update({
    where: { id: attraction.id },
    data: {
      draftData: draft,
      status: 'DRAFT',
      rejectionReason: null,
    },
  });

  return draft.images;
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

// Partners may only select categories governed by the platform. They must
// never be able to create taxonomy values implicitly from free-form input.
async function setCategory(tx, attractionId, categoryName) {
  const name = String(categoryName || '').trim();
  if (!name) {
    await tx.attractionCategory.deleteMany({ where: { attractionId } });
    return;
  }

  const category = await resolveActiveCategory(tx, name);
  if (!category) {
    throw httpError(400, 'Danh mục không tồn tại hoặc đã bị ẩn. Vui lòng chọn lại từ danh sách.');
  }

  await tx.attractionCategory.deleteMany({ where: { attractionId } });
  await tx.attractionCategory.create({
    data: { attractionId, categoryId: category.id },
  });
}

async function setCategoriesByIds(tx, attractionId, rawCategoryIds) {
  const categoryIds = [...new Set(
    rawCategoryIds.map((id) => String(id || '').trim()).filter(Boolean),
  )];
  if (categoryIds.length === 0) return;

  const activeCategories = await tx.category.findMany({
    where: { id: { in: categoryIds }, isActive: true },
    select: { id: true },
  });
  if (activeCategories.length !== categoryIds.length) {
    throw httpError(400, 'Có danh mục không tồn tại hoặc đã bị ẩn. Vui lòng tải lại danh sách.');
  }

  await tx.attractionCategory.createMany({
    data: categoryIds.map((categoryId) => ({ attractionId, categoryId })),
    skipDuplicates: true,
  });
}

// GET /api/partners/attractions
async function listAttractions(req, res, next) {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(parsePositiveInt(req.query.limit, DEFAULT_LIMIT), MAX_LIMIT);
    const skip = (page - 1) * limit;

    const where = { partnerId: req.partner.id, archivedAt: null };

    const search = String(req.query.search || '').trim();
    if (search) {
      where.title = { contains: search, mode: 'insensitive' };
    }

    const status = String(req.query.status || '').trim().toUpperCase();
    if (status) {
      if (['DRAFT', 'PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
        where.status = status;
      } else if (status === 'ACTIVE') {
        where.publicationStatus = 'ACTIVE';
      } else if (status === 'INACTIVE') {
        where.publicationStatus = { not: 'ACTIVE' };
      }
    }

    const city = String(req.query.city || '').trim();
    if (city) where.city = city;

    const [items, total] = await prisma.$transaction([
      prisma.attraction.findMany({
        where,
        include: attractionInclude,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.attraction.count({ where }),
    ]);

    return res.json({
      attractions: items.map(toAttractionListItem),
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    });
  } catch (error) {
    next(error);
  }
}

// GET /api/partners/attractions/:id
async function getAttraction(req, res, next) {
  try {
    const attraction = await findOwnedAttraction(req.params.id, req.partner.id);
    if (!attraction) {
      return res.status(404).json({ message: 'Không tìm thấy điểm tham quan.' });
    }
    return res.json({ attraction: toAttractionDetail(attraction) });
  } catch (error) {
    next(error);
  }
}

function buildAttractionData(body) {
  const data = {};
  if (body.name !== undefined) data.title = String(body.name).trim();
  if (body.description !== undefined) data.description = String(body.description || '').trim();
  if (body.address !== undefined) data.address = String(body.address).trim();
  if (body.province !== undefined) data.city = String(body.province).trim();
  if (body.district !== undefined) data.district = String(body.district || '').trim() || null;
  if (body.openTime !== undefined) data.openTime = String(body.openTime || '').trim() || null;
  if (body.closeTime !== undefined) data.closeTime = String(body.closeTime || '').trim() || null;
  if (body.lat !== undefined) {
    data.latitude = body.lat === '' || body.lat == null ? null : Number(body.lat);
  }
  if (body.lng !== undefined) {
    data.longitude = body.lng === '' || body.lng == null ? null : Number(body.lng);
  }
  if (body.requiresManualApproval !== undefined) {
    data.requiresManualApproval = parseBoolean(body.requiresManualApproval);
  }
  if (body.recommendedVisitMinutes !== undefined) {
    data.recommendedVisitMinutes = Number(body.recommendedVisitMinutes);
  }
  if (body.environment !== undefined) {
    data.environment = String(body.environment || '').toUpperCase();
  }
  if (body.isFullDay !== undefined) {
    data.isFullDay = parseBoolean(body.isFullDay);
  }
  if (body.status !== undefined) data.status = attractionStatusFromClient(body.status);
  return data;
}

function normalizeAttractionInput(body = {}) {
  return {
    ...body,
    name: body.name ?? body.title,
    province: body.province ?? body.city,
    lat: body.lat ?? body.latitude,
    lng: body.lng ?? body.longitude,
  };
}

// POST /api/partners/attractions
async function createAttraction(req, res, next) {
  try {
    const input = normalizeAttractionInput(req.body);
    const validationError = validateAttraction(input, { partial: false });
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    const data = buildAttractionData(input);
    // Đối tác không được tự phê duyệt địa điểm khi tạo mới.
    data.status = 'DRAFT';
    if (!data.description) data.description = '';

    const created = await prisma.$transaction(async (tx) => {
      const attraction = await tx.attraction.create({
        data: { ...data, partnerId: req.partner.id },
      });
      if (input.category) {
        await setCategory(tx, attraction.id, input.category);
      } else if (Array.isArray(input.categoryIds) && input.categoryIds.length > 0) {
        await setCategoriesByIds(tx, attraction.id, input.categoryIds);
      }
      if (Array.isArray(input.images) && input.images.length > 0) {
        const images = input.images
          .filter((image) => image && String(image.imageUrl || '').trim())
          .map((image) => ({
            attractionId: attraction.id,
            imageUrl: String(image.imageUrl).trim(),
            isPrimary: Boolean(image.isPrimary),
          }));
        if (images.length > 0) {
          await tx.attractionImage.createMany({ data: images });
        }
      }
      return attraction;
    });

    const full = await prisma.attraction.findUnique({
      where: { id: created.id },
      include: attractionInclude,
    });

    return res.status(201).json({
      success: true,
      data: {
        id: full.id,
        title: full.title,
        status: full.status,
        createdAt: full.createdAt,
      },
      message: 'Tạo điểm tham quan thành công.',
      attraction: toAttractionDetail(full),
    });
  } catch (error) {
    next(error);
  }
}

// PUT /api/partners/attractions/:id
async function updateAttraction(req, res, next) {
  try {
    const existing = await findOwnedAttraction(req.params.id, req.partner.id, attractionInclude);
    if (!existing) {
      return res.status(404).json({ message: 'Không tìm thấy điểm tham quan.' });
    }

    assertPartnerCanEdit(existing);

    const validationError = validateAttraction(req.body, { partial: true });
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    const data = buildAttractionData(req.body);

    if (hasPublishedVersion(existing)) {
      let cat = null;
      if (req.body.category !== undefined) {
        cat = await resolveActiveCategory(prisma, req.body.category);
        if (!cat && req.body.category) {
          return res.status(400).json({
            message: 'Danh mục không tồn tại hoặc đã bị ẩn. Vui lòng chọn lại từ danh sách.',
          });
        }
      }

      const snapshot = existing.draftData || buildAttractionSnapshot(existing);
      const merged = mergeSnapshot(snapshot, data, cat);

      await prisma.attraction.update({
        where: { id: existing.id },
        data: {
          draftData: merged,
          status: 'DRAFT',
          rejectionReason: null,
        },
      });
    } else {
      data.status = 'DRAFT';
      data.rejectionReason = null;

      await prisma.$transaction(async (tx) => {
        await tx.attraction.update({ where: { id: existing.id }, data });
        if (req.body.category !== undefined) {
          await setCategory(tx, existing.id, req.body.category);
        }
      });
    }

    const full = await prisma.attraction.findUnique({
      where: { id: existing.id },
      include: attractionInclude,
    });

    return res.json({
      message: 'Cập nhật điểm tham quan thành công.',
      attraction: toAttractionDetail(full),
    });
  } catch (error) {
    next(error);
  }
}

// DELETE /api/partners/attractions/:id
async function deleteAttraction(req, res, next) {
  try {
    const existing = await findOwnedAttraction(req.params.id, req.partner.id, {});
    if (!existing) {
      return res.status(404).json({ message: 'Không tìm thấy điểm tham quan.' });
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const bookingCount = await prisma.booking.count({
      where: {
        snapshotAttractionId: existing.id,
        snapshotVisitDate: { gte: today },
        status: { in: ['CONFIRMED', 'PENDING_PARTNER'] },
      },
    });

    if (bookingCount > 0) {
      return res.status(409).json({
        message: 'Không thể lưu trữ điểm tham quan vì vẫn còn đơn đặt vé chưa sử dụng trong tương lai.',
      });
    }

    await prisma.attraction.update({
      where: { id: existing.id },
      data: { archivedAt: new Date(), publicationStatus: 'ARCHIVED' },
    });

    return res.json({
      message: 'Đã lưu trữ điểm tham quan. Lịch sử đặt vé và thanh toán được giữ nguyên.',
    });
  } catch (error) {
    next(error);
  }
}

// POST /api/partners/attractions/:id/images — upload nhiều ảnh
async function uploadImages(req, res, next) {
  try {
    const existing = await findOwnedAttraction(req.params.id, req.partner.id, attractionInclude);
    if (!existing) {
      return res.status(404).json({ message: 'Không tìm thấy điểm tham quan.' });
    }

    assertPartnerCanEdit(existing);

    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ message: 'Vui lòng chọn ít nhất một ảnh.' });
    }

    if (hasPublishedVersion(existing)) {
      const draft = getWorkingDraft(existing);
      const hasDraftPrimary = draft.images.some((img) => img.isPrimary);
      const created = files.map((file, index) => ({
        id: `draft-${randomUUID()}`,
        url: buildUploadUrl(req, file.filename),
        isPrimary: !hasDraftPrimary && index === 0,
      }));

      await saveDraftImages(existing, [...draft.images, ...created]);

      return res.status(201).json({
        message: 'Tải ảnh thành công.',
        images: created.map(toImagePayload),
      });
    }

    const hasPrimary = existing.images.some((img) => img.isPrimary);

    const created = await prisma.$transaction(
      files.map((file, index) =>
        prisma.attractionImage.create({
          data: {
            attractionId: existing.id,
            imageUrl: buildUploadUrl(req, file.filename),
            isPrimary: !hasPrimary && index === 0, // ảnh đầu tiên làm ảnh đại diện nếu chưa có
          },
        }),
      ),
    );

    return res.status(201).json({
      message: 'Tải ảnh thành công.',
      images: created.map(toImagePayload),
    });
  } catch (error) {
    next(error);
  }
}

// DELETE /api/partners/attractions/:id/images/:imageId
async function deleteImage(req, res, next) {
  try {
    const attraction = await findOwnedAttraction(
      req.params.id,
      req.partner.id,
      attractionIncludeWithOrderedImages,
    );
    if (!attraction) {
      return res.status(404).json({ message: 'Không tìm thấy điểm tham quan.' });
    }

    assertPartnerCanEdit(attraction);

    if (hasPublishedVersion(attraction)) {
      const draft = getWorkingDraft(attraction);
      const image = draft.images.find((item) => item.id === req.params.imageId);
      if (!image) {
        return res.status(404).json({ message: 'Không tìm thấy ảnh.' });
      }

      const nextImages = draft.images.filter((item) => item.id !== image.id);
      if (image.isPrimary && nextImages.length > 0 && !nextImages.some((item) => item.isPrimary)) {
        nextImages[0] = { ...nextImages[0], isPrimary: true };
      }

      await saveDraftImages(attraction, nextImages);
      return res.json({ message: 'Đã xóa ảnh.' });
    }

    const image = attraction.images.find((item) => item.id === req.params.imageId);
    if (!image) {
      return res.status(404).json({ message: 'Không tìm thấy ảnh.' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.attractionImage.delete({ where: { id: image.id } });
      if (image.isPrimary) {
        const replacement = attraction.images.find((item) => item.id !== image.id);
        if (replacement) {
          await tx.attractionImage.update({
            where: { id: replacement.id },
            data: { isPrimary: true },
          });
        }
      }
    });

    return res.json({ message: 'Đã xóa ảnh.' });
  } catch (error) {
    next(error);
  }
}

// PATCH /api/partners/attractions/:id/images/:imageId/primary
async function setPrimaryImage(req, res, next) {
  try {
    const attraction = await findOwnedAttraction(
      req.params.id,
      req.partner.id,
      attractionInclude,
    );
    if (!attraction) {
      return res.status(404).json({ message: 'Không tìm thấy điểm tham quan.' });
    }

    assertPartnerCanEdit(attraction);

    if (hasPublishedVersion(attraction)) {
      const draft = getWorkingDraft(attraction);
      const image = draft.images.find((item) => item.id === req.params.imageId);
      if (!image) {
        return res.status(404).json({ message: 'Không tìm thấy ảnh.' });
      }

      await saveDraftImages(
        attraction,
        draft.images.map((item) => ({ ...item, isPrimary: item.id === image.id })),
      );
      return res.json({ message: 'Đã cập nhật ảnh đại diện.' });
    }

    const image = attraction.images.find((item) => item.id === req.params.imageId);
    if (!image) {
      return res.status(404).json({ message: 'Không tìm thấy ảnh.' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.attractionImage.updateMany({
        where: { attractionId: attraction.id, isPrimary: true },
        data: { isPrimary: false },
      });
      await tx.attractionImage.update({
        where: { id: image.id },
        data: { isPrimary: true },
      });
    });

    return res.json({ message: 'Đã cập nhật ảnh đại diện.' });
  } catch (error) {
    next(error);
  }
}

// GET /api/partners/categories — danh sách danh mục cho form
async function listCategories(req, res, next) {
  try {
      const categories = await prisma.category.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
      });
    return res.json({ categories: categories.map((c) => ({ id: c.id, name: c.name })) });
  } catch (error) {
    next(error);
  }
}

// POST /api/attractions/:id/submit — gửi duyệt (từ MPhu)
async function submitAttraction(req, res, next) {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Unauthorized' } });

    const partner = await prisma.partnerProfile.findUnique({ where: { userId } });
    if (!partner) return res.status(403).json({ success: false, error: { code: 'NO_PARTNER_PROFILE', message: 'Partner profile not found' } });

    const attractionId = req.params.id;
    const attraction = await prisma.attraction.findUnique({
      where: { id: attractionId },
      include: attractionInclude,
    });
    if (!attraction || attraction.archivedAt) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Attraction not found' } });

    if (attraction.partnerId !== partner.id) return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Không có quyền thao tác trên địa điểm này' } });

    if (!['DRAFT', 'REJECTED'].includes(attraction.status)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_STATUS', message: "Không thể gửi duyệt khi trạng thái hiện tại không phải DRAFT hoặc REJECTED" } });
    }

    const snapshot = attraction.draftData || buildAttractionSnapshot(attraction);
    const missing = validateSubmissionSnapshot(snapshot);
    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INCOMPLETE_ATTRACTION',
          message: `Hồ sơ điểm tham quan thiếu thông tin bắt buộc: ${missing.join(', ')}.`,
        },
      });
    }

    const submittedAt = new Date();
    let updated = null;

    await prisma.$transaction(async (tx) => {
      await tx.attraction.updateMany({
        where: {
          id: attractionId,
          status: { in: ['DRAFT', 'REJECTED'] },
        },
        data: {
          status: 'PENDING',
          revision: { increment: 1 },
          submittedAt,
          submittedData: snapshot,
        },
      });

      updated = await tx.attraction.findUnique({
        where: { id: attractionId },
      });

      await writeAuditLog({
        client: tx,
        req,
        action: 'ATTRACTION_SUBMITTED',
        entityType: 'ATTRACTION',
        entityId: attractionId,
        metadata: { revision: updated?.revision || attraction.revision + 1, snapshot },
      });
    });

    return res.status(200).json({
      success: true,
      data: {
        id: updated ? updated.id : attractionId,
        status: updated ? updated.status : 'PENDING',
      },
    });
  } catch (error) {
    return next(error);
  }
}

// GET /api/attractions — tìm kiếm điểm tham quan công khai (từ MPhu)
async function searchAttractions(req, res, next) {
  try {
    const page = parsePositiveInt(req.query.page, DEFAULT_PAGE);
    const limit = Math.min(parsePositiveInt(req.query.limit, DEFAULT_LIMIT), MAX_LIMIT);
    const skip = (page - 1) * limit;

    const search = String(req.query.search || '').trim();
    const city = String(req.query.city || '').trim();
    const category = String(req.query.category || '').trim();
    const minPrice = req.query.minPrice ? Number(req.query.minPrice) : null;
    const maxPrice = req.query.maxPrice ? Number(req.query.maxPrice) : null;
    const minRating = req.query.minRating ? Number(req.query.minRating) : null;
    const sort = String(req.query.sort || '').trim();

    if (
      [minPrice, maxPrice, minRating].some(
        (value) => value != null && (!Number.isFinite(value) || value < 0),
      )
    ) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Bộ lọc số không hợp lệ.' },
      });
    }

    if (minPrice != null && maxPrice != null && minPrice > maxPrice) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Giá tối thiểu không được lớn hơn giá tối đa.' },
      });
    }

    // Chỉ hiển thị địa điểm đang phát hành công khai (ẩn địa điểm đã tạm dừng bán vé).
    const where = publicAttractionWhere();
    const andConditions = [];

    if (city) {
      let citySearchTerm = city;
      if (/tp\.?\s*hcm/i.test(city) || /hồ chí minh/i.test(city)) {
        citySearchTerm = 'Hồ Chí Minh';
      }
      andConditions.push({
        OR: [
          { city: { contains: citySearchTerm, mode: 'insensitive' } },
          { district: { contains: citySearchTerm, mode: 'insensitive' } },
        ]
      });
    }

    if (search) {
      andConditions.push({
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ]
      });
    }

    if (minRating) {
      andConditions.push({ averageRating: { gte: minRating } });
    }

    if (category) {
      andConditions.push({
        categories: {
          some: {
            OR: [
              { categoryId: category },
              { category: { name: { equals: category, mode: 'insensitive' } } },
            ],
          },
        }
      });
    }

    if (minPrice != null || maxPrice != null) {
      const priceFilter = {};
      if (minPrice != null) priceFilter.gte = minPrice;
      if (maxPrice != null) priceFilter.lte = maxPrice;

      andConditions.push({ minTicketPrice: priceFilter });
    }

    if (andConditions.length > 0) {
      where.AND = andConditions;
    }

    // Xử lý sắp xếp và phân trang
    let orderBy = { createdAt: 'desc' }; // mặc định

    if (sort === 'popular') {
      orderBy = { totalReviews: 'desc' };
    } else if (sort === 'rating') {
      orderBy = { averageRating: 'desc' };
    } else if (sort === 'price-asc') {
      orderBy = { minTicketPrice: { sort: 'asc', nulls: 'last' } };
    } else if (sort === 'price-desc') {
      orderBy = { minTicketPrice: { sort: 'desc', nulls: 'last' } };
    }

    const queryIncludes = {
      images: { where: { isPrimary: true }, take: 1 },
      ticketProducts: {
        where: { status: 'ACTIVE', archivedAt: null },
        orderBy: { sellingPrice: 'asc' },
        take: 1,
        select: { sellingPrice: true },
      },
    };

    const [rawItems, total] = await prisma.$transaction([
      prisma.attraction.findMany({
        where,
        include: queryIncludes,
        orderBy,
        skip,
        take: limit,
      }),
      prisma.attraction.count({ where }),
    ]);

    const mapped = rawItems.map((a) => ({
      id: a.id,
      title: a.title,
      address: a.address,
      city: a.city,
      latitude: a.latitude,
      longitude: a.longitude,
      primaryImage: a.images && a.images[0] ? a.images[0].imageUrl : null,
      averageRating: a.averageRating,
      totalReviews: a.totalReviews,
      minPrice: a.minTicketPrice == null ? null : Number(a.minTicketPrice),
    }));

    return res.status(200).json({
      success: true,
      data: {
        attractions: mapped,
        pagination: {
          totalItems: total,
          totalPages: Math.ceil(total / limit),
          currentPage: page,
          limit,
        },
      },
    });
  } catch (error) {
    return next(error);
  }
}

// GET /api/attractions/map-points — toàn bộ điểm có toạ độ (cho bản đồ)
async function getMapPoints(req, res, next) {
  try {
    const items = await prisma.attraction.findMany({
      where: publicAttractionWhere({
        latitude: { not: null },
        longitude: { not: null },
      }),
      select: {
        id: true,
        title: true,
        city: true,
        latitude: true,
        longitude: true,
        images: { where: { isPrimary: true }, take: 1, select: { imageUrl: true } },
        ticketProducts: {
          where: { status: 'ACTIVE', archivedAt: null },
          orderBy: { sellingPrice: 'asc' },
          take: 1,
          select: { sellingPrice: true },
        },
      },
    });

    const points = items.map((a) => ({
      id: a.id,
      title: a.title,
      city: a.city,
      latitude: a.latitude,
      longitude: a.longitude,
      primaryImage: a.images[0] ? a.images[0].imageUrl : null,
      minPrice: a.ticketProducts[0] ? a.ticketProducts[0].sellingPrice : null,
    }));

    return res.status(200).json({ success: true, data: { points, total: points.length } });
  } catch (error) {
    return next(error);
  }
}

// GET /api/attractions/:id — chi tiết điểm tham quan công khai (từ MPhu)
async function getAttractionDetail(req, res, next) {
  try {
    const id = req.params.id;
    const attraction = await prisma.attraction.findUnique({
      where: { id },
      include: {
        partner: { select: { status: true } },
        images: true,
        categories: { include: { category: true } },
      ticketProducts: { where: { status: 'ACTIVE', archivedAt: null } },
      },
    });

    if (
      !attraction
      || !isAttractionSaleEnabled(attraction)
    ) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Attraction not found' } });
    }

    const categories = (attraction.categories || []).map((c) => ({ id: c.category.id, name: c.category.name }));
    const ticketProducts = (attraction.ticketProducts || []).map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      description: t.description,
      originalPrice: t.originalPrice,
      sellingPrice: t.sellingPrice,
      refundPolicy: t.refundPolicy,
      refundFeeRate: t.refundFeeRate,
      refundCutoffHours: t.refundCutoffHours ?? 24,
      minAgeYears: t.minAgeYears,
      maxAgeYears: t.maxAgeYears,
      minHeightCm: t.minHeightCm,
      maxHeightCm: t.maxHeightCm,
      requiresAdult: t.requiresAdult,
    }));

    const result = {
      id: attraction.id,
      title: attraction.title,
      description: attraction.description,
      address: attraction.address,
      city: attraction.city,
      latitude: attraction.latitude,
      longitude: attraction.longitude,
      images: attraction.images,
      categories,
      ticketProducts,
      averageRating: attraction.averageRating,
      totalReviews: attraction.totalReviews,
      createdAt: attraction.createdAt,
      requiresManualApproval: attraction.requiresManualApproval,
      recommendedVisitMinutes: attraction.recommendedVisitMinutes,
      environment: attraction.environment,
      isFullDay: attraction.isFullDay,
    };

    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
}

// PATCH /api/partners/attractions/:id/publication — bật/tắt bán vé điểm tham quan
async function setPublicationStatus(req, res, next) {
  try {
    const attraction = await findOwnedAttraction(req.params.id, req.partner.id, {});
    if (!attraction) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy điểm tham quan.' } });
    }

    if (!attraction.publishedAt) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATE', message: 'Điểm tham quan chưa từng được phê duyệt.' },
      });
    }

    if (attraction.operationalStatus === 'SUSPENDED') {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Điểm tham quan đang bị đình chỉ.' },
      });
    }

    const { publicationStatus } = req.body || {};
    if (!['ACTIVE', 'PAUSED'].includes(publicationStatus)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Trạng thái phát hành không hợp lệ. Chỉ chấp nhận ACTIVE hoặc PAUSED.' },
      });
    }

    await prisma.attraction.update({
      where: { id: attraction.id },
      data: { publicationStatus },
    });

    return res.json({
      success: true,
      message: publicationStatus === 'ACTIVE' ? 'Đã kích hoạt hoạt động điểm bán vé.' : 'Đã tạm dừng bán vé điểm tham quan.',
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listAttractions,
  getAttraction,
  createAttraction,
  updateAttraction,
  deleteAttraction,
  setPublicationStatus,
  uploadImages,
  deleteImage,
  setPrimaryImage,
  listCategories,
  findOwnedAttraction,
  // Public routes (từ MPhu)
  submitAttraction,
  searchAttractions,
  getAttractionDetail,
  getMapPoints,
};

