const { TICKET_TYPES } = require('./partnerMappers');

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/; // HH:MM 24h
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/; // YYYY-MM-DD

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidTime(value) {
  return TIME_REGEX.test(String(value || ''));
}

function isValidDate(value) {
  const dateKey = String(value || '');
  if (!DATE_REGEX.test(dateKey)) return false;
  const parsed = new Date(`${dateKey}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === dateKey;
}

// --- Hồ sơ KYC đối tác ---
function validateKyc(body) {
  if (!isNonEmptyString(body.businessName)) {
    return 'Vui lòng nhập tên doanh nghiệp / điểm tham quan.';
  }

  if (body.businessName.trim().length > 150) {
    return 'Tên doanh nghiệp không được vượt quá 150 ký tự.';
  }

  if (!isNonEmptyString(body.businessLicenseUrl)) {
    return 'Vui lòng tải lên giấy phép kinh doanh.';
  }

  if (!isNonEmptyString(body.taxCode)) {
    return 'Vui lòng nhập mã số thuế.';
  }

  if (!/^\d{10}(\d{3})?$/.test(String(body.taxCode).trim())) {
    return 'Mã số thuế phải gồm 10 hoặc 13 chữ số.';
  }

  if (body.bankAccountNumber && !/^\d{6,20}$/.test(String(body.bankAccountNumber).trim())) {
    return 'Số tài khoản ngân hàng phải gồm 6 đến 20 chữ số.';
  }

  return '';
}

// --- Điểm tham quan ---
function validateAttraction(body, { partial = false } = {}) {
  const has = (field) => body[field] !== undefined;

  if ((!partial || has('name')) && !isNonEmptyString(body.name)) {
    return 'Vui lòng nhập tên điểm tham quan.';
  }

  if ((!partial || has('address')) && !isNonEmptyString(body.address)) {
    return 'Vui lòng nhập địa chỉ.';
  }

  if ((!partial || has('province')) && !isNonEmptyString(body.province)) {
    return 'Vui lòng chọn tỉnh/thành phố.';
  }

  if (has('name') && String(body.name || '').trim().length > 200) {
    return 'Tên địa điểm không được vượt quá 200 ký tự.';
  }

  if (has('description') && String(body.description || '').trim().length > 5000) {
    return 'Mô tả không được vượt quá 5000 ký tự.';
  }

  if (has('openTime') && body.openTime && !isValidTime(body.openTime)) {
    return 'Giờ mở cửa không hợp lệ (định dạng HH:MM).';
  }

  if (has('closeTime') && body.closeTime && !isValidTime(body.closeTime)) {
    return 'Giờ đóng cửa không hợp lệ (định dạng HH:MM).';
  }

  if (body.openTime && body.closeTime && body.openTime >= body.closeTime) {
    return 'Giờ đóng cửa phải sau giờ mở cửa.';
  }

  if (has('lat') && body.lat !== '' && body.lat != null) {
    const lat = Number(body.lat);
    if (Number.isNaN(lat) || lat < -90 || lat > 90) {
      return 'Vĩ độ (latitude) không hợp lệ.';
    }
  }

  if (has('lng') && body.lng !== '' && body.lng != null) {
    const lng = Number(body.lng);
    if (Number.isNaN(lng) || lng < -180 || lng > 180) {
      return 'Kinh độ (longitude) không hợp lệ.';
    }
  }

  return '';
}

// --- Vé ---
function validateTicket(body, { partial = false } = {}) {
  const has = (field) => body[field] !== undefined;

  if ((!partial || has('name')) && !isNonEmptyString(body.name)) {
    return 'Vui lòng nhập tên gói vé.';
  }

  if (has('type') && !TICKET_TYPES.includes(String(body.type).toUpperCase())) {
    return 'Loại vé không hợp lệ.';
  }

  const original = Number(body.originalPrice);
  const selling = Number(body.sellingPrice);

  if ((!partial || has('originalPrice'))) {
    if (Number.isNaN(original) || original <= 0) {
      return 'Giá gốc phải lớn hơn 0.';
    }
  }

  if ((!partial || has('sellingPrice'))) {
    if (Number.isNaN(selling) || selling <= 0) {
      return 'Giá bán phải lớn hơn 0.';
    }
  }

  // Khi cả hai giá đều có mặt, giá bán không được vượt giá gốc
  if (!Number.isNaN(original) && !Number.isNaN(selling) && selling > original) {
    return 'Giá bán không được lớn hơn giá gốc.';
  }

  if (has('refundPolicy')) {
    const policy = String(body.refundPolicy).toUpperCase();
    const validPolicies = [
      'NONE',
      'PARTIAL',
      'FULL',
      'NON_REFUNDABLE',
      'FREE_CANCELLATION',
      'REFUND_WITH_FEE',
    ];
    if (!validPolicies.includes(policy)) {
      return 'Chính sách hoàn/hủy không hợp lệ.';
    }
  }

  const normalizedPolicy = has('refundPolicy')
    ? String(body.refundPolicy).toUpperCase()
    : null;
  const isPartialRefund = ['PARTIAL', 'REFUND_WITH_FEE'].includes(normalizedPolicy);

  if (isPartialRefund && (!has('refundFeeRate') || body.refundFeeRate === '')) {
    return 'Vui lòng nhập phí hoàn/hủy cho chính sách hoàn một phần.';
  }

  // refundFeeRate là phân số (vd 0.1 = 10%). Với hoàn một phần, 0% và 100%
  // phải dùng chính sách hoàn toàn phần hoặc không hoàn để tránh diễn giải mơ hồ.
  if (has('refundFeeRate') && body.refundFeeRate !== null && body.refundFeeRate !== '') {
    const feeRate = Number(body.refundFeeRate);
    if (!Number.isFinite(feeRate) || feeRate < 0 || feeRate > 1) {
      return 'Phí hoàn/hủy phải là tỉ lệ trong khoảng 0 đến 1 (vd 0.1 = 10%).';
    }
    if (isPartialRefund && (feeRate <= 0 || feeRate >= 1)) {
      return 'Phí hoàn/hủy một phần phải lớn hơn 0 và nhỏ hơn 1 (từ 1% đến 99%).';
    }
  }

  if (has('refundCutoffHours')) {
    const cutoffHours = Number(body.refundCutoffHours);
    if (!Number.isInteger(cutoffHours) || cutoffHours < 0 || cutoffHours > 720) {
      return 'Thời hạn hủy phải là số giờ nguyên từ 0 đến 720.';
    }
  }

  return '';
}

module.exports = {
  isNonEmptyString,
  isValidTime,
  isValidDate,
  validateKyc,
  validateAttraction,
  validateTicket,
};
