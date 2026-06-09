const { buildVnpayUrl, verifyVnpaySignature, formatVnpDate } = require('../utils/vnpay');

const SECRET = 'TESTHASHSECRET';
const VNP_URL = 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';

function parseUrlQuery(url) {
  // Mô phỏng cách Express decode query: '+' -> space, rồi decodeURIComponent.
  const out = {};
  for (const pair of url.split('?')[1].split('&')) {
    const idx = pair.indexOf('=');
    const key = pair.slice(0, idx);
    const value = pair.slice(idx + 1);
    out[key] = decodeURIComponent(value.replace(/\+/g, ' '));
  }
  return out;
}

describe('vnpay util', () => {
  const params = {
    vnp_Version: '2.1.0',
    vnp_Command: 'pay',
    vnp_TmnCode: 'ABC123',
    vnp_Locale: 'vn',
    vnp_CurrCode: 'VND',
    vnp_TxnRef: 'abcdef1234567890',
    vnp_OrderInfo: 'Thanh toan don hang 123', // có dấu cách -> kiểm tra encode +
    vnp_OrderType: 'other',
    vnp_Amount: 12000000,
    vnp_ReturnUrl: 'http://localhost:5000/api/payments/vnpay-return',
    vnp_IpAddr: '127.0.0.1',
    vnp_CreateDate: '20260609120000',
    vnp_ExpireDate: '20260609121000',
  };

  test('buildVnpayUrl tạo URL ký được và verify lại đúng (roundtrip)', () => {
    const url = buildVnpayUrl(params, { vnpUrl: VNP_URL, secret: SECRET });
    expect(url.startsWith(`${VNP_URL}?`)).toBe(true);
    expect(url).toContain('vnp_SecureHash=');

    const parsed = parseUrlQuery(url);
    expect(verifyVnpaySignature(parsed, SECRET)).toBe(true);
  });

  test('verify thất bại khi sai secret', () => {
    const url = buildVnpayUrl(params, { vnpUrl: VNP_URL, secret: SECRET });
    const parsed = parseUrlQuery(url);
    expect(verifyVnpaySignature(parsed, 'WRONG_SECRET')).toBe(false);
  });

  test('verify thất bại khi dữ liệu bị sửa (số tiền)', () => {
    const url = buildVnpayUrl(params, { vnpUrl: VNP_URL, secret: SECRET });
    const parsed = parseUrlQuery(url);
    parsed.vnp_Amount = '1';
    expect(verifyVnpaySignature(parsed, SECRET)).toBe(false);
  });

  test('verify trả false khi thiếu vnp_SecureHash', () => {
    expect(verifyVnpaySignature({ vnp_Amount: '100' }, SECRET)).toBe(false);
  });

  test('formatVnpDate xuất yyyyMMddHHmmss theo GMT+7', () => {
    // 2026-06-09T05:00:00Z -> GMT+7 = 12:00:00 cùng ngày
    const d = new Date('2026-06-09T05:00:00.000Z');
    expect(formatVnpDate(d)).toBe('20260609120000');
  });
});
