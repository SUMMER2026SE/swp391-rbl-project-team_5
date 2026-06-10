const prisma = require('../config/prisma');
const {
  attractionStatusFromClient,
  toAttractionListItem,
  toAttractionDetail,
} = require('../utils/partnerMappers');
const { validateAttraction } = require('../utils/partnerValidators');
const { buildUploadUrl } = require('../middleware/uploadMiddleware');

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const attractionInclude = {
  images: true,
  categories: { include: { category: true } },
};

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
}

// Tìm điểm tham quan và xác minh thuộc về đối tác hiện tại
async function findOwnedAttraction(attractionId, partnerId, include = attractionInclude) {
  const attraction = await prisma.attraction.findUnique({
    where: { id: attractionId },
    include,
  });

  if (!attraction || attraction.partnerId !== partnerId) {
    return null;
  }

  return attraction;
}

// Gắn 1 category (theo tên) cho điểm tham quan: upsert Category rồi nối
async function setCategory(tx, attractionId, categoryName) {
  const name = String(categoryName || '').trim();
  if (!name) return;

  const category = await tx.category.upsert({
    where: { name },
    update: {},
    create: { name },
  });

  await tx.attractionCategory.deleteMany({ where: { attractionId } });
  await tx.attractionCategory.create({
    data: { attractionId, categoryId: category.id },
  });
}

// GET /api/partners/attractions
async function listAttractions(req, res, next) {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(parsePositiveInt(req.query.limit, DEFAULT_LIMIT), MAX_LIMIT);
    const skip = (page - 1) * limit;

    const where = { partnerId: req.partner.id };

    const search = String(req.query.search || '').trim();
    if (search) {
      where.title = { contains: search, mode: 'insensitive' };
    }

    const status = String(req.query.status || '').trim().toLowerCase();
    if (status === 'active') where.status = 'APPROVED';
    else if (status === 'inactive') where.status = { not: 'APPROVED' };

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
        await tx.attractionCategory.createMany({
          data: [...new Set(input.categoryIds)].map((categoryId) => ({
            attractionId: attraction.id,
            categoryId,
          })),
          skipDuplicates: true,
        });
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
    const existing = await findOwnedAttraction(req.params.id, req.partner.id, {});
    if (!existing) {
      return res.status(404).json({ message: 'Không tìm thấy điểm tham quan.' });
    }

    const validationError = validateAttraction(req.body, { partial: true });
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    const data = buildAttractionData(req.body);
    if (data.status === 'APPROVED' && existing.status !== 'APPROVED') {
      return res.status(400).json({
        message: 'Địa điểm phải được gửi duyệt và được admin phê duyệt trước khi hoạt động.',
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.attraction.update({ where: { id: existing.id }, data });
      if (req.body.category !== undefined) {
        await setCategory(tx, existing.id, req.body.category);
      }
    });

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

    // onDelete: Cascade trong schema sẽ tự xóa vé, ảnh, khung giờ liên quan
    await prisma.attraction.delete({ where: { id: existing.id } });

    return res.json({ message: 'Đã xóa điểm tham quan.' });
  } catch (error) {
    next(error);
  }
}

// POST /api/partners/attractions/:id/images — upload nhiều ảnh
async function uploadImages(req, res, next) {
  try {
    const existing = await findOwnedAttraction(req.params.id, req.partner.id, { images: true });
    if (!existing) {
      return res.status(404).json({ message: 'Không tìm thấy điểm tham quan.' });
    }

    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ message: 'Vui lòng chọn ít nhất một ảnh.' });
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
      images: created.map((img) => ({ id: img.id, url: img.imageUrl, isPrimary: img.isPrimary })),
    });
  } catch (error) {
    next(error);
  }
}

// GET /api/partners/categories — danh sách danh mục cho form
async function listCategories(req, res, next) {
  try {
    const categories = await prisma.category.findMany({ orderBy: { name: 'asc' } });
    return res.json({ categories: categories.map((c) => ({ id: c.id, name: c.name })) });
  } catch (error) {
    next(error);
  }
}

// POST /api/attractions — tạo điểm tham quan (public-partner flow từ MPhu)
async function submitAttraction(req, res, next) {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Unauthorized' } });

    const partner = await prisma.partnerProfile.findUnique({ where: { userId } });
    if (!partner) return res.status(403).json({ success: false, error: { code: 'NO_PARTNER_PROFILE', message: 'Partner profile not found' } });

    const attractionId = req.params.id;
    const attraction = await prisma.attraction.findUnique({ where: { id: attractionId } });
    if (!attraction) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Attraction not found' } });

    if (attraction.partnerId !== partner.id) return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Không có quyền thao tác trên địa điểm này' } });

    if (!['DRAFT', 'REJECTED'].includes(attraction.status)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_STATUS', message: "Không thể gửi duyệt khi trạng thái hiện tại không phải DRAFT hoặc REJECTED" } });
    }

    const updated = await prisma.attraction.update({ where: { id: attractionId }, data: { status: 'PENDING' } });

    return res.status(200).json({ success: true, data: { id: updated.id, status: updated.status } });
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

    const where = { status: 'APPROVED' };
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

      andConditions.push({
        ticketProducts: { some: { status: 'ACTIVE', sellingPrice: priceFilter } }
      });
    }

    if (andConditions.length > 0) {
      where.AND = andConditions;
    }

    // Xử lý sắp xếp và phân trang
    const isPriceSort = sort === 'price-asc' || sort === 'price-desc';
    let orderBy = { createdAt: 'desc' }; // mặc định

    if (sort === 'popular') {
      orderBy = { totalReviews: 'desc' };
    } else if (sort === 'rating') {
      orderBy = { averageRating: 'desc' };
    }

    const queryIncludes = {
      images: { where: { isPrimary: true }, take: 1 },
      ticketProducts: { where: { status: 'ACTIVE' }, orderBy: { sellingPrice: 'asc' }, take: 1, select: { sellingPrice: true } },
    };

    let rawItems = [];
    let total = 0;

    if (isPriceSort) {
      // Đối với sắp xếp theo giá, chúng ta lấy tất cả kết quả phù hợp và sắp xếp trên bộ nhớ (JS memory)
      const allItems = await prisma.attraction.findMany({
        where,
        include: queryIncludes,
      });

      // Gắn giá trị minPrice để sort
      const itemsWithPrice = allItems.map((item) => {
        const minVal = item.ticketProducts && item.ticketProducts[0] ? Number(item.ticketProducts[0].sellingPrice) : null;
        return { ...item, minVal };
      });

      // Thực hiện sort
      itemsWithPrice.sort((a, b) => {
        const priceA = a.minVal;
        const priceB = b.minVal;

        if (priceA === null && priceB === null) return 0;
        if (priceA === null) return 1; // Giá trị null được xếp xuống cuối
        if (priceB === null) return -1;

        return sort === 'price-asc' ? priceA - priceB : priceB - priceA;
      });

      total = itemsWithPrice.length;
      rawItems = itemsWithPrice.slice(skip, skip + limit);
    } else {
      // Phân trang bằng CSDL thông thường
      const [dbItems, dbCount] = await prisma.$transaction([
        prisma.attraction.findMany({
          where,
          include: queryIncludes,
          orderBy,
          skip,
          take: limit,
        }),
        prisma.attraction.count({ where }),
      ]);
      rawItems = dbItems;
      total = dbCount;
    }

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
      minPrice: a.ticketProducts && a.ticketProducts[0] ? Number(a.ticketProducts[0].sellingPrice) : null,
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
      where: {
        status: 'APPROVED',
        latitude: { not: null },
        longitude: { not: null },
      },
      select: {
        id: true,
        title: true,
        city: true,
        latitude: true,
        longitude: true,
        images: { where: { isPrimary: true }, take: 1, select: { imageUrl: true } },
        ticketProducts: {
          where: { status: 'ACTIVE' },
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
        images: true,
        categories: { include: { category: true } },
        ticketProducts: { where: { status: 'ACTIVE' } },
      },
    });

    if (!attraction || attraction.status !== 'APPROVED') {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Attraction not found' } });
    }

    const categories = (attraction.categories || []).map((c) => ({ id: c.category.id, name: c.category.name }));
    const ticketProducts = (attraction.ticketProducts || []).map((t) => ({ id: t.id, name: t.name, description: t.description, originalPrice: t.originalPrice, sellingPrice: t.sellingPrice, refundPolicy: t.refundPolicy }));

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
    };

    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listAttractions,
  getAttraction,
  createAttraction,
  updateAttraction,
  deleteAttraction,
  uploadImages,
  listCategories,
  findOwnedAttraction,
  // Public routes (từ MPhu)
  submitAttraction,
  searchAttractions,
  getAttractionDetail,
  getMapPoints,
};

