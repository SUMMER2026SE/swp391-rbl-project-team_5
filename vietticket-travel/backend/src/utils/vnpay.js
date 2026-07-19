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
  // So sánh hằng-thời-gian để tránh rò rỉ theo thời gian khi xác thực chữ ký.
  const a = Buffer.from(String(secureHash).toLowerCase(), 'utf-8');
  const b = Buffer.from(signed, 'utf-8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// --- Hoàn tiền (refund) ---
// API refund ký theo chuỗi nối '|' theo ĐÚNG thứ tự field dưới đây (KHÁC luồng pay
// vốn ký theo querystring đã sort). Sai thứ tự -> VNPay trả mã 97 (chữ ký sai).
const REFUND_SIGN_FIELDS = [
  'vnp_RequestId',
  'vnp_Version',
  'vnp_Command',
  'vnp_TmnCode',
  'vnp_TransactionType',
  'vnp_TxnRef',
  'vnp_Amount',
  'vnp_TransactionNo',
  'vnp_TransactionDate',
  'vnp_CreateBy',
  'vnp_CreateDate',
  'vnp_IpAddr',
  'vnp_OrderInfo',
];

const QUERY_SIGN_FIELDS = [
  'vnp_RequestId',
  'vnp_Version',
  'vnp_Command',
  'vnp_TmnCode',
  'vnp_TxnRef',
  'vnp_TransactionDate',
  'vnp_CreateDate',
  'vnp_IpAddr',
  'vnp_OrderInfo',
];

const REFUND_RESPONSE_SIGN_FIELDS = [
  'vnp_ResponseId',
  'vnp_Command',
  'vnp_ResponseCode',
  'vnp_Message',
  'vnp_TmnCode',
  'vnp_TxnRef',
  'vnp_Amount',
  'vnp_BankCode',
  'vnp_PayDate',
  'vnp_TransactionNo',
  'vnp_TransactionType',
  'vnp_TransactionStatus',
  'vnp_OrderInfo',
];

const QUERY_RESPONSE_SIGN_FIELDS = [
  ...REFUND_RESPONSE_SIGN_FIELDS,
  'vnp_PromotionCode',
  'vnp_PromotionAmount',
];

function signPipeData(params, secret, fields) {
  const data = fields.map((key) => params[key] ?? '').join('|');
  return crypto
    .createHmac('sha512', secret)
    .update(Buffer.from(data, 'utf-8'))
    .digest('hex');
}

function createVnpRequestId() {
  return crypto.randomUUID().replaceAll('-', '');
}

function signRefundData(params, secret) {
  return signPipeData(params, secret, REFUND_SIGN_FIELDS);
}

function signQueryData(params, secret) {
  return signPipeData(params, secret, QUERY_SIGN_FIELDS);
}

function verifyApiResponseSignature(params, secret, fields) {
  const secureHash = String(params?.vnp_SecureHash || '').toLowerCase();
  if (!secureHash) return false;
  const signed = signPipeData(params, secret, fields);
  const actual = Buffer.from(secureHash, 'utf-8');
  const expected = Buffer.from(signed, 'utf-8');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function verifyRefundResponseSignature(params, secret) {
  return verifyApiResponseSignature(params, secret, REFUND_RESPONSE_SIGN_FIELDS);
}

function verifyQueryResponseSignature(params, secret) {
  return verifyApiResponseSignature(params, secret, QUERY_RESPONSE_SIGN_FIELDS);
}

module.exports = {
  sortObject,
  formatVnpDate,
  createVnpRequestId,
  buildVnpayUrl,
  verifyVnpaySignature,
  signRefundData,
  signQueryData,
  verifyRefundResponseSignature,
  verifyQueryResponseSignature,
  REFUND_SIGN_FIELDS,
  QUERY_SIGN_FIELDS,
  REFUND_RESPONSE_SIGN_FIELDS,
  QUERY_RESPONSE_SIGN_FIELDS,
};
