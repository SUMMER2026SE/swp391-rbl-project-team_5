// ============================================================
// Làm giàu nội dung điểm tham quan ĐÃ CÓ trong DB:
//   - Thay mô tả ngắn bằng mô tả chi tiết (data/attractionContent.js)
//   - Thay ảnh placeholder bằng 10-12 ảnh thật từ Wikimedia Commons
//     (lưu URL trực tiếp -> cả nhóm dùng chung DB đều xem được,
//      không phụ thuộc file trên máy ai).
//
//   node prisma/enrich-content.js            -> chạy thật
//   node prisma/enrich-content.js --dry      -> chỉ xem trước, không ghi DB
//
// Idempotent: chạy lại sẽ ghi đè mô tả + bộ ảnh theo dữ liệu mới nhất.
// ============================================================
require('dotenv').config({ quiet: true });

const prisma = require('../src/config/prisma');
const { attractionContent } = require('./data/attractionContent');

const DRY_RUN = process.argv.includes('--dry');
const TARGET_IMAGES = 10; // tối thiểu mong muốn
const MAX_IMAGES = 12; // trần mỗi điểm
const THUMB_WIDTH = 1280;

// Wikimedia yêu cầu User-Agent định danh rõ ràng.
const COMMONS_HEADERS = {
  'User-Agent': 'VietTicketSeed/1.0 (student project; contact: dev@vietticket.local)',
};

// Loại ảnh không phải "ảnh chụp địa điểm" (bản đồ, logo, sơ đồ...),
// tài liệu lưu trữ/thư tịch, biểu đồ và một số nguồn rác nước ngoài
// hay lọt lưới khi tìm kiếm mờ trên Commons.
const JUNK_NAME =
  /map|logo|flag|coat[_ ]of[_ ]arms|locator|diagram|plan\b|seal|emblem|banner|icon|screenshot|infographic|capacity|generation|chart|thumbnail|luu tru|ban tau|but phe|tan luat|tang san|tuyen cao|kham thien|hoang de|nha may det|diep ca|goethe|prokudin|e coli|sacrament|\binstitut\b|mumlava/i;

// Chuẩn hóa tên file để so khớp JUNK_NAME kể cả khi có dấu tiếng Việt
// và dấu gạch dưới (ví dụ "Bản_tấu", "Lưu_trữ").
const normName = (s) =>
  (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[_-]/g, ' ')
    .toLowerCase();

async function searchCommonsImages(query) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: '6',
    gsrlimit: '20',
    prop: 'imageinfo',
    iiprop: 'url|mime|size',
    iiurlwidth: String(THUMB_WIDTH),
  });
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
    headers: COMMONS_HEADERS,
  });
  if (!res.ok) throw new Error(`Commons HTTP ${res.status}`);
  const data = await res.json();
  const pages = data?.query?.pages || {};
  // Giữ thứ tự liên quan của kết quả tìm kiếm.
  return Object.values(pages)
    .sort((a, b) => (a.index || 0) - (b.index || 0))
    .map((p) => {
      const info = Array.isArray(p.imageinfo) ? p.imageinfo[0] : null;
      if (!info) return null;
      return {
        title: p.title || '',
        url: info.thumburl || info.url,
        mime: info.mime,
        width: info.width,
        height: info.height,
      };
    })
    .filter(Boolean);
}

function isUsable(img) {
  if (!img.url) return false;
  if (!/^image\/(jpeg|png)$/.test(img.mime || '')) return false;
  if ((img.width || 0) < 800 || (img.height || 0) < 500) return false;
  const ratio = img.width / img.height;
  if (ratio < 0.5 || ratio > 2.6) return false; // bỏ ảnh panorama quá dẹt / quá dọc
  if (JUNK_NAME.test(normName(img.title))) return false;
  return true;
}

async function collectImages(queries) {
  const seen = new Set();
  const picked = [];
  for (const q of queries) {
    if (picked.length >= MAX_IMAGES) break;
    let results;
    try {
      results = await searchCommonsImages(q);
    } catch (err) {
      console.log(`    • Lỗi query "${q}": ${err.message}`);
      continue;
    }
    for (const img of results) {
      if (picked.length >= MAX_IMAGES) break;
      if (!isUsable(img) || seen.has(img.url)) continue;
      seen.add(img.url);
      picked.push(img.url);
    }
    // Đủ mục tiêu thì không cần query dự phòng nữa.
    if (picked.length >= TARGET_IMAGES) break;
  }
  return picked;
}

async function main() {
  const titles = Object.keys(attractionContent);
  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Làm giàu nội dung cho ${titles.length} điểm tham quan...\n`);

  const short = []; // điểm có ít hơn TARGET_IMAGES ảnh
  const missing = []; // điểm không tìm thấy trong DB
  let ok = 0;

  try {
    await prisma.$connect();

    for (const title of titles) {
      const content = attractionContent[title];
      const attraction = await prisma.attraction.findFirst({
        where: { title },
        select: { id: true },
      });
      if (!attraction) {
        missing.push(title);
        console.log(`✗ Không có trong DB: ${title}`);
        continue;
      }

      const imageUrls = await collectImages(content.imageQueries);
      const flag = imageUrls.length >= TARGET_IMAGES ? '✓' : '⚠';
      console.log(`${flag} ${title}: ${imageUrls.length} ảnh`);
      if (imageUrls.length < TARGET_IMAGES) short.push(`${title} (${imageUrls.length})`);

      if (DRY_RUN) continue;

      await prisma.attraction.update({
        where: { id: attraction.id },
        data: { description: content.description },
      });

      // Chỉ thay bộ ảnh khi tìm được ảnh — không bao giờ để điểm trắng ảnh.
      if (imageUrls.length > 0) {
        await prisma.$transaction([
          prisma.attractionImage.deleteMany({ where: { attractionId: attraction.id } }),
          prisma.attractionImage.createMany({
            data: imageUrls.map((url, i) => ({
              attractionId: attraction.id,
              imageUrl: url,
              isPrimary: i === 0,
            })),
          }),
        ]);
      }
      ok += 1;
    }

    console.log('\n==================================================');
    console.log(`Hoàn tất: cập nhật ${ok}/${titles.length} điểm.`);
    if (short.length) {
      console.log(`\nDưới ${TARGET_IMAGES} ảnh (cần bổ sung query hoặc upload tay):`);
      short.forEach((s) => console.log(`  - ${s}`));
    }
    if (missing.length) {
      console.log(`\nChưa có trong DB (chạy "npm run db:seed:real" trước):`);
      missing.forEach((m) => console.log(`  - ${m}`));
    }
    console.log('==================================================');
  } catch (error) {
    console.error('Enrich thất bại:', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
