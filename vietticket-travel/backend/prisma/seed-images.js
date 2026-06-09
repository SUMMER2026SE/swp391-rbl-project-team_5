// ============================================================
// Lấy ẢNH THẬT cho các điểm tham quan từ Wikipedia (miễn phí, không cần key).
//   node prisma/seed-images.js
//
// Với mỗi điểm: tìm trang Wikipedia phù hợp (ưu tiên tiếng Việt, fallback
// tiếng Anh), tải ảnh đại diện về public/uploads và đặt làm ảnh primary.
// Idempotent: chạy lại sẽ thay ảnh mới nhất. Điểm nào không tìm được ảnh
// thì GIỮ NGUYÊN ảnh cũ (không xoá).
// ============================================================
require('dotenv').config({ quiet: true });

const prisma = require('../src/config/prisma');
const { realAttractions } = require('./data/realAttractions');

const UA = 'VietTicketTravel/1.0 (student project)';

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// Gọi fetch có thử lại khi bị 429 (rate limit) hoặc lỗi 5xx, backoff tăng dần.
async function fetchRetry(url, options = {}, tries = 5) {
  for (let i = 0; i < tries; i += 1) {
    const res = await fetch(url, options);
    if (res.status === 429 || res.status >= 500) {
      await sleep(1500 * (i + 1));
      continue;
    }
    return res;
  }
  return null;
}

// Bỏ phần trong ngoặc và các tiền tố dịch vụ để tìm đúng trang Wikipedia.
function cleanQuery(title) {
  return title
    .replace(/\(.*?\)/g, '')
    .replace(/^(Du thuyền|Cáp treo|Khu du lịch sinh thái|Khu du lịch|Danh thắng|Di tích|Công viên văn hóa|Tour)\s+/i, '')
    .trim();
}

// Tìm ảnh đại diện (thumbnail ~1024px) của trang khớp nhất.
async function wikiImage(query, lang) {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrlimit: '1',
    prop: 'pageimages',
    piprop: 'thumbnail',
    pithumbsize: '1024',
    format: 'json',
    origin: '*',
  });
  const url = `https://${lang}.wikipedia.org/w/api.php?${params}`;
  const res = await fetchRetry(url, { headers: { 'User-Agent': UA } });
  if (!res || !res.ok) return null;
  const data = await res.json();
  const pages = data && data.query && data.query.pages;
  if (!pages) return null;
  const page = Object.values(pages)[0];
  return page && page.thumbnail ? page.thumbnail.source : null;
}

async function main() {
  let ok = 0;
  let miss = 0;
  try {
    await prisma.$connect();
    console.log(`Lấy ảnh thật từ Wikipedia cho ${realAttractions.length} điểm...\n`);

    for (const a of realAttractions) {
      await sleep(600); // nhẹ tay với Wikipedia (tránh 429)
      const record = await prisma.attraction.findFirst({
        where: { title: a.title },
        select: { id: true },
      });
      if (!record) {
        console.log(`  • Không có trong DB: ${a.title}`);
        continue;
      }

      // Thử lần lượt: vi(cleaned) -> en(googleQuery) -> en(cleaned)
      let imageUrl = null;
      try {
        imageUrl =
          (await wikiImage(cleanQuery(a.title), 'vi')) ||
          (await wikiImage(a.googleQuery || a.title, 'en')) ||
          (await wikiImage(cleanQuery(a.title), 'en'));
      } catch (err) {
        console.log(`  • Lỗi tra Wikipedia "${a.title}": ${err.message}`);
      }

      if (!imageUrl) {
        miss += 1;
        console.log(`  ✗ Không tìm thấy ảnh: ${a.title}`);
        continue;
      }

      // Lưu thẳng URL ảnh Wikipedia (hotlink) — trình duyệt tải khi hiển thị,
      // tránh tải hàng loạt phía server gây 429.
      await prisma.attractionImage.deleteMany({ where: { attractionId: record.id } });
      await prisma.attractionImage.create({
        data: { attractionId: record.id, imageUrl, isPrimary: true },
      });
      ok += 1;
      console.log(`  ✓ ${a.title}`);
    }

    console.log('\n==================================================');
    console.log(`XONG: ${ok} ảnh thật, ${miss} điểm không tìm được (giữ ảnh cũ).`);
    console.log('==================================================');
  } catch (error) {
    console.error('Lỗi:', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
