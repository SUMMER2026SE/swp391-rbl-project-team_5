const prisma = require('../config/prisma');
const {
  attractionStatusFromClient,
  toAttractionListItem,
  toAttractionDetail,
} = require('../utils/partnerMappers');
const { validateAttraction } = require('../utils/partnerValidators');
const { buildUploadUrl } = require('../middleware/uploadMiddleware');

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

// POST /api/partners/attractions
async function createAttraction(req, res, next) {
  try {
    const validationError = validateAttraction(req.body, { partial: false });
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    const data = buildAttractionData(req.body);
    // Mặc định hiển thị ngay khi tạo (Module 2 chưa có cổng duyệt của admin)
    if (!data.status) data.status = 'APPROVED';
    if (!data.description) data.description = '';

    const created = await prisma.$transaction(async (tx) => {
      const attraction = await tx.attraction.create({
        data: { ...data, partnerId: req.partner.id },
      });
      if (req.body.category) {
        await setCategory(tx, attraction.id, req.body.category);
      }
      return attraction;
    });

    const full = await prisma.attraction.findUnique({
      where: { id: created.id },
      include: attractionInclude,
    });

    return res.status(201).json({
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

module.exports = {
  listAttractions,
  getAttraction,
  createAttraction,
  updateAttraction,
  deleteAttraction,
  uploadImages,
  listCategories,
  findOwnedAttraction,
};
