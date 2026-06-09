// Gán ảnh đúng (từ Wikimedia Commons) cho các điểm mà seed-images.js bỏ sót.
// Chạy: node prisma/fix-images.js
require('dotenv').config({ quiet: true });
const prisma = require('../src/config/prisma');

const UA = 'VietTicketTravel/1.0 (student project)';

// Danh sách cần vá: [tên điểm trong DB, từ khoá tìm ảnh trên Commons]
const FIXES = [
  ['Kỳ Co - Eo Gió', 'Eo Gió Nhơn Lý'],
  ['VinWonders Nha Trang', 'Vinpearl Cable Car Hon Tre Nha Trang'],
];

async function commonsFirstImage(query) {
  const p = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrnamespace: '6',
    gsrsearch: query,
    gsrlimit: '5',
    prop: 'imageinfo',
    iiprop: 'url|mime',
    iiurlwidth: '1024',
    format: 'json',
    origin: '*',
  });
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${p}`, {
    headers: { 'User-Agent': UA },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const pages = Object.values((data.query && data.query.pages) || {});
  const img = pages.find(
    (o) => o.imageinfo && o.imageinfo[0] && o.imageinfo[0].mime === 'image/jpeg' && o.imageinfo[0].thumburl,
  );
  return img ? img.imageinfo[0].thumburl : null;
}

async function main() {
  try {
    await prisma.$connect();
    for (const [title, query] of FIXES) {
      const rec = await prisma.attraction.findFirst({ where: { title }, select: { id: true } });
      if (!rec) {
        console.log('Không thấy điểm:', title);
        continue;
      }
      const url = await commonsFirstImage(query);
      if (!url) {
        console.log('Không tìm được ảnh:', title);
        continue;
      }
      await prisma.attractionImage.deleteMany({ where: { attractionId: rec.id } });
      await prisma.attractionImage.create({
        data: { attractionId: rec.id, imageUrl: url, isPrimary: true },
      });
      console.log('OK:', title, '->', url.slice(0, 90));
      await new Promise((r) => { setTimeout(r, 700); });
    }
  } catch (e) {
    console.error('Loi:', e.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
