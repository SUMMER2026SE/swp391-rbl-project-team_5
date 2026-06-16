'use strict';

// ============================================================
// aiCatalogService.js
// ------------------------------------------------------------
// Lấy & định dạng dữ liệu attraction/ticket từ DB thành dạng
// gọn nhẹ (chỉ các trường cần thiết) để đưa vào prompt LLM.
//
// Lý do tách riêng: prompt LLM có giới hạn token, nên không thể
// đưa toàn bộ object Prisma (quá nhiều field không cần thiết).
// ============================================================

const prisma = require('../config/prisma');

/**
 * Lấy danh sách attraction đang ACTIVE kèm vé, rút gọn field
 * để đưa vào prompt LLM.
 *
 * @param {{ city?: string, category?: string, limit?: number }} [filters]
 * @returns {Promise<Array<object>>}
 */
async function getCatalogSummary(filters = {}) {
  const { city, category, limit = 60 } = filters;

  const where = {
    publishedAt: { not: null },
    publicationStatus: 'ACTIVE',
    archivedAt: null,
    status: { not: 'SUSPENDED' },
    ticketProducts: {
      some: { status: 'ACTIVE', archivedAt: null },
    },
    ...(city ? { city: { contains: city, mode: 'insensitive' } } : {}),
    ...(category
      ? { categories: { some: { category: { name: { contains: category, mode: 'insensitive' } } } } }
      : {}),
  };

  const attractions = await prisma.attraction.findMany({
    where,
    take: limit,
    orderBy: { averageRating: 'desc' },
    select: {
      id: true,
      title: true,
      description: true,
      city: true,
      district: true,
      openTime: true,
      closeTime: true,
      averageRating: true,
      totalReviews: true,
      minTicketPrice: true,
      categories: {
        select: { category: { select: { name: true } } },
      },
      ticketProducts: {
        where: { status: 'ACTIVE', archivedAt: null },
        select: {
          id: true,
          name: true,
          type: true,
          sellingPrice: true,
          refundPolicy: true,
        },
      },
    },
  });

  return attractions.map((a) => ({
    id: a.id,
    title: a.title,
    description: shorten(a.description, 220),
    city: a.city,
    district: a.district,
    openTime: a.openTime,
    closeTime: a.closeTime,
    rating: a.averageRating,
    totalReviews: a.totalReviews,
    minPrice: a.minTicketPrice ? Number(a.minTicketPrice) : null,
    categories: a.categories.map((c) => c.category.name),
    tickets: a.ticketProducts.map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      price: Number(t.sellingPrice),
      refundPolicy: t.refundPolicy,
    })),
  }));
}

function shorten(text, maxLen) {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen).trim()}…`;
}

module.exports = {
  getCatalogSummary,
};
