const prisma = require('../config/prisma');

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

async function createAttraction(req, res, next) {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Unauthorized' } });

    const partner = await prisma.partnerProfile.findUnique({ where: { userId } });
    if (!partner) return res.status(403).json({ success: false, error: { code: 'NO_PARTNER_PROFILE', message: 'Partner profile not found' } });
    if (partner.status !== 'APPROVED') return res.status(403).json({ success: false, error: { code: 'PARTNER_NOT_APPROVED', message: 'Tài khoản đối tác chưa được duyệt' } });

    const { title, description, address, city, latitude, longitude, categoryIds, images } = req.body || {};
    if (!title || !description || !address || !city) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'title, description, address, city are required' } });
    }

    const attraction = await prisma.attraction.create({
      data: {
        partnerId: partner.id,
        title,
        description,
        address,
        city,
        latitude: latitude ?? null,
        longitude: longitude ?? null,
        status: 'DRAFT',
      },
    });

    // create images if provided
    if (Array.isArray(images) && images.length) {
      const imgs = images.map((img) => ({ attractionId: attraction.id, imageUrl: img.imageUrl, isPrimary: !!img.isPrimary }));
      await prisma.attractionImage.createMany({ data: imgs });
    }

    // create categories (join table) if provided
    if (Array.isArray(categoryIds) && categoryIds.length) {
      const rows = categoryIds.map((catId) => ({ attractionId: attraction.id, categoryId: catId }));
      // use createMany; ignore failures if categoryId invalid will error
      await prisma.attractionCategory.createMany({ data: rows });
    }

    return res.status(201).json({ success: true, data: { id: attraction.id, title: attraction.title, status: attraction.status, createdAt: attraction.createdAt } });
  } catch (error) {
    return next(error);
  }
}

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

async function searchAttractions(req, res, next) {
  try {
    const page = parsePositiveInteger(req.query.page, DEFAULT_PAGE);
    const limit = parsePositiveInteger(req.query.limit, DEFAULT_LIMIT);
    const skip = (page - 1) * limit;

    const search = String(req.query.search || '').trim();
    const city = String(req.query.city || '').trim();
    const category = String(req.query.category || '').trim();
    const minPrice = req.query.minPrice ? Number(req.query.minPrice) : null;
    const maxPrice = req.query.maxPrice ? Number(req.query.maxPrice) : null;
    const minRating = req.query.minRating ? Number(req.query.minRating) : null;

    const where = { status: 'APPROVED' };

    if (city) where.city = { contains: city, mode: 'insensitive' };

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (minRating) where.averageRating = { gte: minRating };

    if (category) {
      where.categories = { some: { categoryId: category } };
    }

    if (minPrice != null || maxPrice != null) {
      const priceFilter = {};
      if (minPrice != null) priceFilter.gte = minPrice;
      if (maxPrice != null) priceFilter.lte = maxPrice;

      where.ticketProducts = { some: { sellingPrice: priceFilter } };
    }

    const [items, total] = await prisma.$transaction([
      prisma.attraction.findMany({
        where,
        include: {
          images: { where: { isPrimary: true }, take: 1 },
          ticketProducts: { where: { status: 'ACTIVE' }, orderBy: { sellingPrice: 'asc' }, take: 1, select: { sellingPrice: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.attraction.count({ where }),
    ]);

    const mapped = items.map((a) => ({
      id: a.id,
      title: a.title,
      address: a.address,
      city: a.city,
      primaryImage: a.images && a.images[0] ? a.images[0].imageUrl : null,
      averageRating: a.averageRating,
      totalReviews: a.totalReviews,
      minPrice: a.ticketProducts && a.ticketProducts[0] ? a.ticketProducts[0].sellingPrice : null,
    }));

    return res.status(200).json({ success: true, data: { attractions: mapped, pagination: { totalItems: total, totalPages: Math.ceil(total / limit), currentPage: page, limit } } });
  } catch (error) {
    return next(error);
  }
}

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

module.exports = { createAttraction, submitAttraction, searchAttractions, getAttractionDetail };
