const {
  getAttractionSearchTokens,
  normalizeAttractionSearch,
} = require('../utils/attractionSearch');

describe('attraction search normalization', () => {
  test.each([
    ['Hồ Chí Minh', 'ho chi minh'],
    ['ho chi minh', 'ho chi minh'],
    ['TP.HCM', 'ho chi minh'],
    ['HCM', 'ho chi minh'],
    ['Sài Gòn', 'ho chi minh'],
    ['Hà Nội', 'ha noi'],
    ['HaNoi', 'ha noi'],
    ['Đà Nẵng', 'da nang'],
    ['Q.1', 'quan 1'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeAttractionSearch(input)).toBe(expected);
  });

  test('searches meaningful words across fields and ignores order/accents', () => {
    expect(getAttractionSearchTokens('Bảo tàng tại Q.1, TP.HCM')).toEqual([
      'bao',
      'tang',
      'quan',
      '1',
      'ho',
      'chi',
      'minh',
    ]);
  });

  test('deduplicates tokens and caps pathological queries', () => {
    const tokens = getAttractionSearchTokens(
      'ho ho ho chi minh a b c d e f g h i j k l m n o p',
    );
    expect(tokens).toHaveLength(12);
    expect(tokens.filter((token) => token === 'ho')).toHaveLength(1);
  });
});
