const crypto = require('crypto');
const querystring = require('querystring');

// Sắp xếp tham số theo alphabet + encode giá trị theo đúng mẫu chính thức của VNPay.
// Lưu ý: encode value rồi đổi %20 -> '+' để khớp cách VNPay tính chữ ký.
function sortObject(obj) {
  const sorted = {};
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined && obj[k] !== null && obj[k] !== '')
    .map((k) => encodeURIComponent(k))
    .sort();
  for (const key of keys) {
    sorted[key] = encodeURIComponent(String(obj[key])).replace(/%20/g, '+');
  }
  return sorted;
}

// Định dạng yyyyMMddHHmmss theo giờ Việt Nam (GMT+7).
function formatVnpDate(date) {
  const d = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
}

// Tạo URL thanh toán đã ký HMAC-SHA512.
function buildVnpayUrl(params, { vnpUrl, secret }) {
  const sorted = sortObject(params);
  const signData = querystring.stringify(sorted, '&', '=', { encodeURIComponent: (s) => s });
  const signed = crypto
    .createHmac('sha512', secret)
    .update(Buffer.from(signData, 'utf-8'))
    .digest('hex');
  sorted.vnp_SecureHash = signed;
  return `${vnpUrl}?${querystring.stringify(sorted, '&', '=', { encodeURIComponent: (s) => s })}`;
}

// Xác thực chữ ký từ query VNPay gửi về (IPN/Return).
function verifyVnpaySignature(query, secret) {
  const params = { ...query };
  const secureHash = params.vnp_SecureHash;
  delete params.vnp_SecureHash;
  delete params.vnp_SecureHashType;
  if (!secureHash) return false;

  const sorted = sortObject(params);
  const signData = querystring.stringify(sorted, '&', '=', { encodeURIComponent: (s) => s });
  const signed = crypto
    .createHmac('sha512', secret)
    .update(Buffer.from(signData, 'utf-8'))
    .digest('hex');
  return secureHash === signed;
}

module.exports = {
  sortObject,
  formatVnpDate,
  buildVnpayUrl,
  verifyVnpaySignature,
};
