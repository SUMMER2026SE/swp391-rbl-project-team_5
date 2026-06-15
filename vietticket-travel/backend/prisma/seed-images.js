// Download attraction images into public/uploads so the application does not
// depend on third-party hotlinks at runtime.
//
//   node prisma/seed-images.js                 Search Wikipedia and cache images
//   node prisma/seed-images.js --cache-current Cache the URLs currently in DB
//
// The script is idempotent. A database image is replaced only after the new
// file has been downloaded and validated successfully.
require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
const prisma = require('../src/config/prisma');
const { realAttractions } = require('./data/realAttractions');

const UA = 'VietTicketTravel/1.0 (student project; local image cache)';
const BACKEND_URL = (process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5000}`)
  .replace(/\/+$/, '');
const UPLOAD_DIR = path.join(__dirname, '../public/uploads');
const CACHE_CURRENT = process.argv.includes('--cache-current');

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function fetchRetry(url, options = {}, tries = 5) {
  let lastError = null;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (response.status !== 429 && response.status < 500) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    if (attempt < tries) await sleep(1500 * attempt);
  }

  throw lastError || new Error('Image request failed');
}

function cleanQuery(title) {
  return title
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[đĐ]/g, (letter) => (letter === 'đ' ? 'd' : 'D'))
    .replace(/\(.*?\)/g, '')
    .replace(/^(Du thuyen|Cap treo|Khu du lich sinh thai|Khu du lich|Danh thang|Di tich|Cong vien van hoa|Tour)\s+/i, '')
    .trim();
}

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
  const response = await fetchRetry(
    `https://${lang}.wikipedia.org/w/api.php?${params}`,
    { headers: { 'User-Agent': UA } },
  );
  if (!response.ok) return null;

  const data = await response.json();
  const pages = data && data.query && data.query.pages;
  if (!pages) return null;

  const page = Object.values(pages)[0];
  return page && page.thumbnail ? page.thumbnail.source : null;
}

function extensionFor(contentType, sourceUrl) {
  const normalizedType = (contentType || '').split(';')[0].trim().toLowerCase();
  const byType = {
    'image/avif': '.avif',
    'image/gif': '.gif',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
  };
  if (byType[normalizedType]) return byType[normalizedType];

  try {
    const extension = path.extname(new URL(sourceUrl).pathname).toLowerCase();
    if (['.avif', '.gif', '.jpeg', '.jpg', '.png', '.webp'].includes(extension)) {
      return extension === '.jpeg' ? '.jpg' : extension;
    }
  } catch {
    // The content type validation below will reject unsupported responses.
  }
  return '.jpg';
}

function localUploadPath(imageUrl) {
  try {
    const parsed = new URL(imageUrl);
    if (!parsed.pathname.startsWith('/uploads/')) return null;
    return path.join(UPLOAD_DIR, path.basename(parsed.pathname));
  } catch {
    return null;
  }
}

async function removeOlderGeneratedFiles(attractionId, keepPath) {
  const prefix = `attraction-${attractionId}.`;
  const names = await fs.promises.readdir(UPLOAD_DIR);
  await Promise.all(
    names
      .filter((name) => name.startsWith(prefix))
      .map(async (name) => {
        const filePath = path.join(UPLOAD_DIR, name);
        if (path.resolve(filePath) !== path.resolve(keepPath)) {
          await fs.promises.rm(filePath, { force: true });
        }
      }),
  );
}

async function downloadImage(sourceUrl, attractionId) {
  const response = await fetchRetry(sourceUrl, {
    headers: {
      Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.8,*/*;q=0.2',
      'User-Agent': UA,
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('image/')) {
    throw new Error(`Expected an image, received "${contentType || 'unknown'}"`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 512) throw new Error(`Image is too small (${buffer.length} bytes)`);

  const extension = extensionFor(contentType, response.url || sourceUrl);
  const filename = `attraction-${attractionId}${extension}`;
  const destination = path.join(UPLOAD_DIR, filename);
  const temporary = path.join(
    UPLOAD_DIR,
    `.tmp-${attractionId}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );

  await fs.promises.writeFile(temporary, buffer);
  try {
    await fs.promises.rm(destination, { force: true });
    await fs.promises.rename(temporary, destination);
    await removeOlderGeneratedFiles(attractionId, destination);
  } catch (error) {
    await fs.promises.rm(temporary, { force: true });
    throw error;
  }

  return `${BACKEND_URL}/uploads/${filename}`;
}

async function replaceImage(record, imageUrl) {
  const retained = record.images[0];
  if (!retained) {
    await prisma.attractionImage.create({
      data: { attractionId: record.id, imageUrl, isPrimary: true },
    });
    return;
  }

  await prisma.$transaction([
    prisma.attractionImage.update({
      where: { id: retained.id },
      data: { imageUrl, isPrimary: true },
    }),
    prisma.attractionImage.deleteMany({
      where: { attractionId: record.id, id: { not: retained.id } },
    }),
  ]);
}

async function findRecord(title) {
  return prisma.attraction.findFirst({
    where: { title },
    select: {
      id: true,
      images: {
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        select: { id: true, imageUrl: true, isPrimary: true },
      },
    },
  });
}

async function cacheCurrentImage(record, fallbackUrl) {
  const currentUrl = record.images[0] && record.images[0].imageUrl;
  const localPath = currentUrl ? localUploadPath(currentUrl) : null;
  if (localPath && fs.existsSync(localPath)) {
    const normalizedUrl = `${BACKEND_URL}/uploads/${path.basename(localPath)}`;
    if (currentUrl !== normalizedUrl) await replaceImage(record, normalizedUrl);
    return { cached: true, reused: true };
  }

  const candidates = [...new Set([currentUrl, fallbackUrl].filter(Boolean))];
  let lastError = null;
  for (const candidate of candidates) {
    try {
      const localUrl = await downloadImage(candidate, record.id);
      await replaceImage(record, localUrl);
      return { cached: true, reused: false };
    } catch (error) {
      lastError = error;
    }
  }

  return { cached: false, error: lastError || new Error('No image URL available') };
}

async function searchAndCacheImage(record, attraction) {
  let remoteUrl = null;
  try {
    remoteUrl =
      (await wikiImage(cleanQuery(attraction.title), 'vi')) ||
      (await wikiImage(attraction.googleQuery || attraction.title, 'en')) ||
      (await wikiImage(cleanQuery(attraction.title), 'en'));
  } catch (error) {
    console.log(`  Wikipedia lookup failed for "${attraction.title}": ${error.message}`);
  }

  if (!remoteUrl) {
    if (record.images.length > 0) return { cached: false, preserved: true };
    return cacheCurrentImage(record, attraction.image);
  }

  try {
    const localUrl = await downloadImage(remoteUrl, record.id);
    await replaceImage(record, localUrl);
    return { cached: true, reused: false };
  } catch (error) {
    return { cached: false, preserved: record.images.length > 0, error };
  }
}

async function main() {
  let cached = 0;
  let reused = 0;
  let preserved = 0;
  let failed = 0;

  try {
    await prisma.$connect();
    await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
    console.log(
      CACHE_CURRENT
        ? `Caching current images for ${realAttractions.length} attractions...`
        : `Searching and caching images for ${realAttractions.length} attractions...`,
    );

    for (const attraction of realAttractions) {
      await sleep(CACHE_CURRENT ? 900 : 650);
      const record = await findRecord(attraction.title);
      if (!record) {
        failed += 1;
        console.log(`  MISSING DB RECORD: ${attraction.title}`);
        continue;
      }

      const result = CACHE_CURRENT
        ? await cacheCurrentImage(record, attraction.image)
        : await searchAndCacheImage(record, attraction);

      if (result.cached) {
        cached += 1;
        if (result.reused) reused += 1;
        console.log(`  OK: ${attraction.title}${result.reused ? ' (already local)' : ''}`);
      } else if (result.preserved) {
        preserved += 1;
        console.log(`  PRESERVED: ${attraction.title}${result.error ? ` (${result.error.message})` : ''}`);
      } else {
        failed += 1;
        console.log(`  FAILED: ${attraction.title} (${result.error.message})`);
      }
    }

    console.log('');
    console.log(`Done: ${cached} cached (${reused} reused), ${preserved} preserved, ${failed} failed.`);
    if (failed > 0) process.exitCode = 1;
  } catch (error) {
    console.error('Image seed failed:', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
