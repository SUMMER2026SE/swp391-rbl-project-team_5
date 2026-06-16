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
  return DATE_REGEX.test(String(value || '')) && !Number.isNaN(new Date(value).getTime());
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

  if (body.taxCode && !/^\d{10}(\d{3})?$/.test(String(body.taxCode).trim())) {
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

  if (has('openTime') && body.openTime && !isValidTime(body.openTime)) {
    return 'Giờ mở cửa không hợp lệ (định dạng HH:MM).';
  }

  if (has('closeTime') && body.closeTime && !isValidTime(body.closeTime)) {
    return 'Giờ đóng cửa không hợp lệ (định dạng HH:MM).';
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

  // refundFeeRate là PHÂN SỐ trong [0,1] (vd 0.1 = 10%). Chặn giá trị sai đơn vị
  // (vd nhập 10 nghĩa là 10% -> phí 1000% -> khách nhận 0đ).
  if (has('refundFeeRate') && body.refundFeeRate !== null && body.refundFeeRate !== '') {
    const feeRate = Number(body.refundFeeRate);
    if (!Number.isFinite(feeRate) || feeRate < 0 || feeRate > 1) {
      return 'Phí hoàn/hủy phải là tỉ lệ trong khoảng 0 đến 1 (vd 0.1 = 10%).';
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
