'use strict';

const { canonicalizeCity, formatLocation } = require('../utils/location');

describe('location utility', () => {
  test.each(['Hồ Chí Minh', 'TP. Hồ Chí Minh', 'TP.HCM', 'Ho Chi Minh City', 'Sài Gòn'])(
    'normalizes %s to the canonical city name',
    (city) => {
      expect(canonicalizeCity(city)).toBe('Thành phố Hồ Chí Minh');
    },
  );

  test('removes duplicated district and city fragments', () => {
    expect(formatLocation({
      address: '65 Lý Tự Trọng, Quận 1',
      district: 'Quận 1',
      city: 'TP. Hồ Chí Minh',
      country: 'Việt Nam',
    })).toBe('65 Lý Tự Trọng, Quận 1, Thành phố Hồ Chí Minh, Việt Nam');
  });
});
