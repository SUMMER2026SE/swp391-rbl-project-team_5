'use strict';

const MAX_SEARCH_TOKENS = 12;

const ALIAS_REPLACEMENTS = [
  [/\b(?:thanh pho ho chi minh|tp ho chi minh|tp hcm|tphcm|hcm|sai gon)\b/g, 'ho chi minh'],
  [/\b(?:thanh pho ha noi|tp ha noi|hanoi|hn)\b/g, 'ha noi'],
  [/\b(?:thanh pho da nang|tp da nang|danang)\b/g, 'da nang'],
  [/\bhalong\b/g, 'ha long'],
  [/\bnhatrang\b/g, 'nha trang'],
  [/\bphuquoc\b/g, 'phu quoc'],
  [/\bsapa\b/g, 'sa pa'],
];

// Keep query normalization aligned with the PostgreSQL trigger. This makes
// Vietnamese search case/accent insensitive and understands common aliases.
function normalizeAttractionSearch(value) {
  let normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, (character) => (character === 'Đ' ? 'D' : 'd'))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

  for (const [pattern, replacement] of ALIAS_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }

  // Vietnamese users commonly write districts as Q1, Q.1 or Q 1.
  normalized = normalized.replace(/\bq\s*(\d{1,2})\b/g, 'quan $1');

  return normalized.trim().replace(/\s+/g, ' ');
}

function getAttractionSearchTokens(value) {
  const normalized = normalizeAttractionSearch(value);
  if (!normalized) return [];

  const rawTokens = normalized.split(' ');
  const meaningfulTokens = rawTokens.length > 1
    ? rawTokens.filter((token) => !['o', 'tai'].includes(token))
    : rawTokens;

  return [...new Set(meaningfulTokens)].slice(0, MAX_SEARCH_TOKENS);
}

function buildNormalizedContainsConditions(field, value) {
  const tokens = getAttractionSearchTokens(value);
  return tokens.map((token, index) => ({
    // Search documents are padded with spaces by the DB trigger. Requiring a
    // leading boundary prevents "ho" matching the middle of another word;
    // every completed token also gets a trailing boundary. The final token is
    // intentionally a prefix so live search remains useful while typing.
    [field]: { contains: ` ${token}${index === tokens.length - 1 ? '' : ' '}` },
  }));
}

module.exports = {
  buildNormalizedContainsConditions,
  getAttractionSearchTokens,
  normalizeAttractionSearch,
};
