const prisma = require('../config/prisma');

const favoriteAttractionInclude = {
  attraction: {
    include: {
      images: {
        where: { isPrimary: true },
        take: 1,
      },
      ticketProducts: {
        where: { status: 'ACTIVE' },
        orderBy: { sellingPrice: 'asc' },
        take: 1,
        select: { sellingPrice: true },
      },
    },
  },
};

function mapFavorite(favorite) {
  const attraction = favorite.attraction;

  return {
    attractionId: favorite.attractionId,
    createdAt: favorite.createdAt,
    attraction: {
      id: attraction.id,
      title: attraction.title,
      address: attraction.address,
      city: attraction.city,
      primaryImage: attraction.images[0]?.imageUrl || null,
      averageRating: attraction.averageRating,
      totalReviews: attraction.totalReviews,
      minPrice: attraction.ticketProducts[0]?.sellingPrice || null,
    },
  };
}

async function listFavorites(req, res, next) {
  try {
    const favorites = await prisma.favoriteAttraction.findMany({
      where: {
        userId: req.user.id,
        attraction: {
          publicationStatus: 'ACTIVE',
          status: { not: 'SUSPENDED' },
          archivedAt: null,
        },
      },
      include: favoriteAttractionInclude,
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({
      success: true,
      data: {
        favorites: favorites.map(mapFavorite),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function toggleFavorite(req, res, next) {
  try {
    const userId = req.user.id;
    const attractionId = req.params.id;

    const attraction = await prisma.attraction.findUnique({
      where: { id: attractionId },
      select: {
        id: true,
        status: true,
        publicationStatus: true,
        archivedAt: true,
      },
    });

    if (
      !attraction
      || attraction.archivedAt
      || attraction.publicationStatus !== 'ACTIVE'
      || attraction.status === 'SUSPENDED'
    ) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'ATTRACTION_NOT_FOUND',
          message: 'Không tìm thấy địa điểm đang hoạt động.',
        },
      });
    }

    const key = {
      userId_attractionId: { userId, attractionId },
    };
    const existing = await prisma.favoriteAttraction.findUnique({ where: key });

    if (existing) {
      await prisma.favoriteAttraction.delete({ where: key });

      return res.status(200).json({
        success: true,
        data: { attractionId, isFavorite: false },
        message: 'Đã bỏ địa điểm khỏi danh sách yêu thích.',
      });
    }

    await prisma.favoriteAttraction.create({
      data: { userId, attractionId },
    });

    return res.status(200).json({
      success: true,
      data: { attractionId, isFavorite: true },
      message: 'Đã lưu địa điểm vào danh sách yêu thích.',
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listFavorites,
  toggleFavorite,
};
