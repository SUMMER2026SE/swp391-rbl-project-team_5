// ============================================================
// Seed dữ liệu THẬT cho trang khách (điểm tham quan + vé + khung giờ)
//   node prisma/seed-real.js            -> chỉ phương án A (data tay)
//   GOOGLE_API_KEY=... node prisma/seed-real.js  -> A + enrich Google (B)
//
// An toàn & idempotent: chạy lại sẽ bỏ qua điểm đã tạo (theo tên).
// KHÔNG đụng tới prisma/seed.js cũ.
// ============================================================
require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const prisma = require('../src/config/prisma');
const { realAttractions } = require('./data/realAttractions');
const { attractionContent } = require('./data/attractionContent');

const PARTNER_EMAIL = 'partner@vietticket.com';
const PARTNER_PASSWORD = 'Partner@123';

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || '';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';
const UPLOAD_DIR = path.join(__dirname, '../public/uploads');
const MAX_GOOGLE_PHOTOS = 3;

// --- Đảm bảo có một đối tác đã được duyệt để gắn điểm tham quan ---
async function ensurePartner() {
  let user = await prisma.user.findUnique({ where: { email: PARTNER_EMAIL } });
  if (!user) {
    const passwordHash = await bcrypt.hash(PARTNER_PASSWORD, 10);
    user = await prisma.user.create({
      data: {
        email: PARTNER_EMAIL,
        passwordHash,
        fullName: 'Nguyễn Văn Lộc',
        role: 'PARTNER',
        isEmailVerified: true,
        status: 'ACTIVE',
        profile: { create: { phoneNumber: '0901234567' } },
      },
    });
  } else {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { role: 'PARTNER', isEmailVerified: true, status: 'ACTIVE' },
    });
  }

  const partner = await prisma.partnerProfile.upsert({
    where: { userId: user.id },
    update: { status: 'APPROVED' },
    create: {
      userId: user.id,
      businessName: 'VietTicket Content Partner',
      taxCode: '0312345678',
      bankName: 'Vietcombank',
      bankAccountNumber: '0123456789',
      bankAccountName: 'NGUYEN VAN LOC',
      status: 'APPROVED',
    },
  });
  console.log(`✓ Đối tác sẵn sàng: ${PARTNER_EMAIL} (id ${partner.id.slice(0, 8)})`);
  return partner;
}

// --- Tạo 1 điểm tham quan (kèm danh mục, ảnh, vé, khung giờ theo vé) ---
async function createAttraction(partner, a) {
  // Idempotent: đã có điểm trùng tên của đối tác này thì bỏ qua.
  const existing = await prisma.attraction.findFirst({
    where: { partnerId: partner.id, title: a.title },
    select: { id: true },
  });
  if (existing) {
    console.log(`  • Bỏ qua (đã có): ${a.title}`);
    return existing.id;
  }

  const created = await prisma.attraction.create({
    data: {
      partnerId: partner.id,
      title: a.title,
      // Ưu tiên mô tả chi tiết trong attractionContent.js nếu có.
      description: attractionContent[a.title]?.description || a.description,
      address: a.address,
      city: a.city,
      district: a.district || null,
      latitude: a.latitude ?? null,
      longitude: a.longitude ?? null,
      openTime: a.openTime || null,
      closeTime: a.closeTime || null,
      openDays: a.openDays || '1,1,1,1,1,1,1',
      defaultCapacity: a.defaultCapacity || 100,
      status: 'APPROVED', // bắt buộc để hiện ở trang tìm kiếm công khai
      publicationStatus: 'ACTIVE',
      publishedAt: new Date(),
      categories: a.category
        ? {
            create: [
              {
                category: {
                  connectOrCreate: {
                    where: { name: a.category },
                    create: { name: a.category },
                  },
                },
              },
            ],
          }
        : undefined,
      images: a.image
        ? { create: [{ imageUrl: a.image, isPrimary: true }] }
        : undefined,
      ticketProducts: {
        create: a.ticketProducts.map((tp) => ({
          name: tp.name,
          type: tp.type || 'ADULT',
          description: tp.description || '',
          originalPrice: tp.originalPrice,
          sellingPrice: tp.sellingPrice,
          status: 'ACTIVE', // bắt buộc để hiện giá & cho đặt vé
          refundPolicy: tp.refundPolicy || 'NON_REFUNDABLE',
          // Khung giờ GẮN THEO VÉ -> nguồn tính sức chứa của luồng đặt vé.
          timeSlots: {
            create: (tp.timeSlots || []).map((s) => ({
              startTime: s.startTime,
              endTime: s.endTime,
              maxCapacity: s.maxCapacity,
              isActive: true,
            })),
          },
        })),
      },
    },
  });
  console.log(`  ✓ Đã tạo: ${a.title} (${a.ticketProducts.length} loại vé)`);
  return created.id;
}

// ============================================================
// PHẦN B (TÙY CHỌN): Làm giàu bằng Google Places API
// Chỉ chạy khi có GOOGLE_API_KEY. Lỗi 1 điểm không làm hỏng seed.
// ============================================================
async function googleTextSearch(query) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_API_KEY,
      'X-Goog-FieldMask':
        'places.id,places.location,places.rating,places.userRatingCount,places.photos',
    },
    body: JSON.stringify({ textQuery: query, languageCode: 'vi', maxResultCount: 1 }),
  });
  if (!res.ok) throw new Error(`TextSearch HTTP ${res.status}`);
  const data = await res.json();
  return data.places && data.places[0] ? data.places[0] : null;
}

async function downloadGooglePhoto(photoName, destPath) {
  const url = `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=1024&key=${GOOGLE_API_KEY}`;
  const res = await fetch(url); // tự động theo redirect tới ảnh thật
  if (!res.ok) throw new Error(`Photo HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await fs.promises.writeFile(destPath, buffer);
}

async function enrichWithGoogle(attractionId, a) {
  const place = await googleTextSearch(a.googleQuery || a.title);
  if (!place) {
    console.log(`  • Google: không tìm thấy "${a.title}"`);
    return;
  }

  const data = {};
  if (place.location) {
    data.latitude = place.location.latitude;
    data.longitude = place.location.longitude;
  }
  if (typeof place.rating === 'number') data.averageRating = place.rating;
  if (typeof place.userRatingCount === 'number') data.totalReviews = place.userRatingCount;
  if (Object.keys(data).length > 0) {
    await prisma.attraction.update({ where: { id: attractionId }, data });
  }

  // Tải ảnh thật từ Google -> public/uploads, thay ảnh placeholder.
  const photos = Array.isArray(place.photos) ? place.photos.slice(0, MAX_GOOGLE_PHOTOS) : [];
  const newImages = [];
  for (let i = 0; i < photos.length; i += 1) {
    const filename = `g-${attractionId}-${i}-${Date.now()}.jpg`;
    const destPath = path.join(UPLOAD_DIR, filename);
    try {
      await downloadGooglePhoto(photos[i].name, destPath);
      newImages.push({ imageUrl: `${BACKEND_URL}/uploads/${filename}`, isPrimary: i === 0 });
    } catch (err) {
      console.log(`  • Google: lỗi tải ảnh ${i} của "${a.title}": ${err.message}`);
    }
  }

  if (newImages.length > 0) {
    await prisma.attractionImage.deleteMany({ where: { attractionId } });
    await prisma.attractionImage.createMany({
      data: newImages.map((img) => ({ attractionId, ...img })),
    });
  }

  console.log(`  ✓ Google enrich: ${a.title} (rating ${place.rating ?? 'n/a'}, ${newImages.length} ảnh)`);
}

async function main() {
  try {
    await prisma.$connect();
    console.log('Đang seed dữ liệu THẬT cho trang khách...');

    const partner = await ensurePartner();

    console.log(`\nTạo ${realAttractions.length} điểm tham quan:`);
    const ids = [];
    for (const a of realAttractions) {
      const id = await createAttraction(partner, a);
      ids.push({ id, a });
    }

    if (GOOGLE_API_KEY) {
      console.log('\n[Google] Đang làm giàu dữ liệu (toạ độ, rating, ảnh thật)...');
      if (!fs.existsSync(UPLOAD_DIR)) {
        await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
      }
      for (const { id, a } of ids) {
        try {
          await enrichWithGoogle(id, a);
        } catch (err) {
          console.log(`  • Google: bỏ qua "${a.title}" do lỗi: ${err.message}`);
        }
      }
    }

    console.log('\nĐang tính toán lại minTicketPrice cho tất cả điểm tham quan...');
    await prisma.$executeRawUnsafe(`
      UPDATE "Attraction" a
      SET "minTicketPrice" = (
        SELECT MIN(tp."sellingPrice")
        FROM "TicketProduct" tp
        WHERE tp."attractionId" = a."id"
          AND tp."status" = 'ACTIVE'
          AND tp."archivedAt" IS NULL
      );
    `);

    console.log('\n==================================================');
    console.log('SEED DỮ LIỆU THẬT THÀNH CÔNG!');
    console.log(`Tổng số điểm tham quan của đối tác: ${
      await prisma.attraction.count({ where: { partnerId: partner.id } })
    }`);
    console.log('==================================================');
  } catch (error) {
    console.error('Seed thất bại:', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
