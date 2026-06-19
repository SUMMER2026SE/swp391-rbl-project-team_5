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

const CITY_ALIASES = [
  { aliases: ['da nang', 'danang'], terms: ['Đà Nẵng'] },
  { aliases: ['ha noi', 'hanoi'], terms: ['Hà Nội'] },
  { aliases: ['ho chi minh', 'tp ho chi minh', 'tphcm', 'hcm', 'sai gon', 'saigon'], terms: ['Hồ Chí Minh', 'TP. Hồ Chí Minh'] },
  { aliases: ['ninh binh'], terms: ['Ninh Bình'] },
  { aliases: ['kien giang', 'phu quoc'], terms: ['Kiên Giang'] },
  { aliases: ['quang nam', 'hoi an'], terms: ['Quảng Nam'] },
  { aliases: ['lam dong', 'da lat', 'dalat'], terms: ['Lâm Đồng'] },
  { aliases: ['quang ninh', 'ha long', 'halong'], terms: ['Quảng Ninh'] },
  { aliases: ['hue', 'thua thien hue'], terms: ['Thừa Thiên Huế'] },
  { aliases: ['binh dinh', 'quy nhon'], terms: ['Bình Định'] },
  { aliases: ['khanh hoa', 'nha trang'], terms: ['Khánh Hòa'] },
  { aliases: ['lao cai', 'sapa', 'sa pa'], terms: ['Lào Cai'] },
  { aliases: ['an giang'], terms: ['An Giang'] },
  { aliases: ['quang binh'], terms: ['Quảng Bình'] },
  { aliases: ['dong nai'], terms: ['Đồng Nai'] },
  { aliases: ['tay ninh'], terms: ['Tây Ninh'] },
  { aliases: ['hai phong'], terms: ['Hải Phòng'] },
  { aliases: ['ha giang'], terms: ['Hà Giang'] },
  { aliases: ['can tho'], terms: ['Cần Thơ'] },
  { aliases: ['phu yen'], terms: ['Phú Yên'] },
  { aliases: ['ca mau'], terms: ['Cà Mau'] },
  { aliases: ['cao bang'], terms: ['Cao Bằng'] },
  { aliases: ['vung tau', 'ba ria vung tau'], terms: ['Bà Rịa - Vũng Tàu'] },
  { aliases: ['binh thuan', 'phan thiet'], terms: ['Bình Thuận'] },
];

const CATEGORY_ALIASES = [
  {
    aliases: ['nature', 'sightseeing', 'thien nhien', 'canh quan', 'ngam canh', 'bien', 'nui'],
    terms: ['Nature & Sightseeing'],
  },
  {
    aliases: ['culture', 'cultural', 'van hoa', 'lich su', 'di tich', 'truyen thong'],
    terms: ['Cultural Experience'],
  },
  {
    aliases: ['museum', 'bao tang'],
    terms: ['Museum'],
  },
  {
    aliases: ['adventure', 'mao hiem', 'phieu luu'],
    terms: ['Adventure'],
  },
  {
    aliases: ['theme park', 'resort', 'amusement', 'cong vien', 'giai tri', 'khu vui choi'],
    terms: ['Theme Park & Resort', 'Amusement Park'],
  },
];

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function expandCityTerms(city) {
  const raw = String(city || '').trim();
  if (!raw) return [];

  const normalized = normalizeSearchText(raw);
  const mappedTerms = CITY_ALIASES
    .filter((entry) => entry.aliases.some((alias) => normalized === alias || normalized.includes(alias)))
    .flatMap((entry) => entry.terms);

  return unique([raw, ...mappedTerms]);
}

function expandCategoryTerms(category) {
  const raw = String(category || '').trim();
  if (!raw) return [];

  const normalized = normalizeSearchText(raw);
  const rawTerms = raw
    .split(/[,;/|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const mappedTerms = CATEGORY_ALIASES
    .filter((entry) => entry.aliases.some((alias) => normalized.includes(alias)))
    .flatMap((entry) => entry.terms);

  return unique([...rawTerms, ...mappedTerms]);
}

function buildCatalogWhere({ city, category, includeCategory = true }) {
  const cityTerms = expandCityTerms(city);
  const categoryTerms = includeCategory ? expandCategoryTerms(category) : [];

  return {
    publishedAt: { not: null },
    publicationStatus: 'ACTIVE',
    archivedAt: null,
    status: { not: 'SUSPENDED' },
    ticketProducts: {
      some: { status: 'ACTIVE', archivedAt: null },
    },
    ...(cityTerms.length
      ? { OR: cityTerms.map((term) => ({ city: { contains: term, mode: 'insensitive' } })) }
      : {}),
    ...(categoryTerms.length
      ? {
          categories: {
            some: {
              OR: categoryTerms.map((term) => ({
                category: { name: { contains: term, mode: 'insensitive' } },
              })),
            },
          },
        }
      : {}),
  };
}

async function findCatalog({ city, category, limit, includeCategory = true }) {
  const where = buildCatalogWhere({ city, category, includeCategory });

  return prisma.attraction.findMany({
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
      openDays: true,
      latitude: true,
      longitude: true,
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
}

/**
 * Lấy danh sách attraction đang ACTIVE kèm vé, rút gọn field
 * để đưa vào prompt LLM.
 *
 * @param {{ city?: string, category?: string, limit?: number }} [filters]
 * @returns {Promise<Array<object>>}
 */
async function getCatalogSummary(filters = {}) {
  const { city, category, limit = 60 } = filters;

  let attractions = await findCatalog({ city, category, limit, includeCategory: Boolean(category) });
  if (category && attractions.length === 0) {
    attractions = await findCatalog({ city, category, limit, includeCategory: false });
  }

  return attractions.map((a) => ({
    id: a.id,
    title: a.title,
    description: shorten(a.description, 220),
    city: a.city,
    district: a.district,
    openTime: a.openTime,
    closeTime: a.closeTime,
    openDays: a.openDays,
    latitude: a.latitude ?? null,
    longitude: a.longitude ?? null,
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
