const { TICKET_TYPES } = require('./partnerMappers');
const { parseVndInteger } = require('./money');

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/; // HH:MM 24h
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/; // YYYY-MM-DD
const VIETNAM_PHONE_REGEX = /^0(3|5|7|8|9)\d{8}$/;
const BANK_ACCOUNT_REGEX = /^\d{6,20}$/;
const SWIFT_CODE_REGEX = /^[A-Z0-9]{8,11}$/i;
const ATTRACTION_ENVIRONMENTS = ['INDOOR', 'OUTDOOR', 'MIXED'];

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

function validateBankDetails(body = {}) {
  if (!isNonEmptyString(body.bankName)) {
    return 'Vui lòng chọn ngân hàng thụ hưởng.';
  }
  if (body.bankName.trim().length > 150) {
    return 'Tên ngân hàng không được vượt quá 150 ký tự.';
  }
  if (!isNonEmptyString(body.branchName)) {
    return 'Vui lòng nhập chi nhánh ngân hàng.';
  }
  if (body.branchName.trim().length > 150) {
    return 'Tên chi nhánh không được vượt quá 150 ký tự.';
  }
  if (!isNonEmptyString(body.bankAccountNumber)) {
    return 'Vui lòng nhập số tài khoản ngân hàng.';
  }
  if (!BANK_ACCOUNT_REGEX.test(String(body.bankAccountNumber).trim())) {
    return 'Số tài khoản ngân hàng phải gồm 6 đến 20 chữ số.';
  }
  if (!isNonEmptyString(body.bankAccountName)) {
    return 'Vui lòng nhập tên chủ tài khoản ngân hàng.';
  }
  if (body.bankAccountName.trim().length > 150) {
    return 'Tên chủ tài khoản không được vượt quá 150 ký tự.';
  }
  if (body.swiftCode && !SWIFT_CODE_REGEX.test(String(body.swiftCode).trim())) {
    return 'Mã SWIFT/BIC phải gồm từ 8 đến 11 ký tự chữ hoặc số.';
  }
  if (body.payoutCurrency && String(body.payoutCurrency).trim().toUpperCase() !== 'VND') {
    return 'Hiện tại hệ thống chỉ hỗ trợ thanh toán đối tác bằng VND.';
  }
  return '';
}

// --- Hồ sơ KYC đối tác ---
function validateKyc(body = {}) {
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

  if (!isValidDate(body.registrationDate)) {
    return 'Ngày đăng ký kinh doanh không hợp lệ.';
  }
  const registrationDate = new Date(`${body.registrationDate}T00:00:00.000Z`);
  const now = new Date();
  const todayUtc = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  ));
  if (registrationDate > todayUtc || registrationDate < new Date('1900-01-01T00:00:00.000Z')) {
    return 'Ngày đăng ký kinh doanh phải nằm trong khoảng từ năm 1900 đến hôm nay.';
  }

  if (!isNonEmptyString(body.representativeName)) {
    return 'Vui lòng nhập tên người đại diện pháp luật.';
  }
  if (body.representativeName.trim().length > 150) {
    return 'Tên người đại diện không được vượt quá 150 ký tự.';
  }

  if (!VIETNAM_PHONE_REGEX.test(String(body.representativePhone || '').trim())) {
    return 'Số điện thoại người đại diện không đúng định dạng Việt Nam.';
  }

  if (!isNonEmptyString(body.businessAddress)) {
    return 'Vui lòng nhập địa chỉ trụ sở chính.';
  }
  if (body.businessAddress.trim().length > 500) {
    return 'Địa chỉ trụ sở chính không được vượt quá 500 ký tự.';
  }

  const bankError = validateBankDetails(body);
  if (bankError) return bankError;

  if (body.kycConsentAccepted !== true && body.consentAccepted !== true) {
    return 'Bạn phải đồng ý với điều khoản dịch vụ và chính sách bảo mật.';
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

  if (has('recommendedVisitMinutes')) {
    const minutes = Number(body.recommendedVisitMinutes);
    if (!Number.isInteger(minutes) || minutes < 30 || minutes > 720) {
      return 'Thời lượng tham quan đề xuất phải là số phút nguyên từ 30 đến 720.';
    }
  }

  if (
    has('environment')
    && !ATTRACTION_ENVIRONMENTS.includes(String(body.environment || '').toUpperCase())
  ) {
    return 'Môi trường trải nghiệm không hợp lệ.';
  }

  if (
    has('isFullDay')
    && ![true, false, 'true', 'false', 1, 0, '1', '0'].includes(body.isFullDay)
  ) {
    return 'Giá trị trải nghiệm cả ngày không hợp lệ.';
  }

  const fullDayValue = has('isFullDay')
    ? [true, 'true', 1, '1'].includes(body.isFullDay)
    : false;
  const visitMinutes = has('recommendedVisitMinutes')
    ? Number(body.recommendedVisitMinutes)
    : (!partial ? 150 : null);
  if (fullDayValue && visitMinutes != null && visitMinutes < 360) {
    return 'Trải nghiệm cả ngày phải có thời lượng tham quan đề xuất ít nhất 360 phút.';
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
    if (parseVndInteger(original) === null) {
      return 'Giá gốc phải là số nguyên VND hợp lệ lớn hơn 0.';
    }
  }

  if ((!partial || has('sellingPrice'))) {
    if (parseVndInteger(selling) === null) {
      return 'Giá bán phải là số nguyên VND hợp lệ lớn hơn 0.';
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

  const validateOptionalInteger = (field, min, max, label) => {
    if (!has(field) || body[field] === '' || body[field] == null) return '';
    const value = Number(body[field]);
    return Number.isInteger(value) && value >= min && value <= max
      ? ''
      : `${label} phải là số nguyên từ ${min} đến ${max}.`;
  };
  const eligibilityErrors = [
    validateOptionalInteger('minAgeYears', 0, 120, 'Tuổi tối thiểu'),
    validateOptionalInteger('maxAgeYears', 0, 120, 'Tuổi tối đa'),
    validateOptionalInteger('minHeightCm', 30, 250, 'Chiều cao tối thiểu'),
    validateOptionalInteger('maxHeightCm', 30, 250, 'Chiều cao tối đa'),
  ].filter(Boolean);
  if (eligibilityErrors.length > 0) return eligibilityErrors[0];

  const minAge = body.minAgeYears === '' || body.minAgeYears == null
    ? null
    : Number(body.minAgeYears);
  const maxAge = body.maxAgeYears === '' || body.maxAgeYears == null
    ? null
    : Number(body.maxAgeYears);
  if (minAge != null && maxAge != null && minAge > maxAge) {
    return 'Tuổi tối thiểu không được lớn hơn tuổi tối đa.';
  }

  const minHeight = body.minHeightCm === '' || body.minHeightCm == null
    ? null
    : Number(body.minHeightCm);
  const maxHeight = body.maxHeightCm === '' || body.maxHeightCm == null
    ? null
    : Number(body.maxHeightCm);
  if (minHeight != null && maxHeight != null && minHeight > maxHeight) {
    return 'Chiều cao tối thiểu không được lớn hơn chiều cao tối đa.';
  }

  const ticketType = String(body.type || '').toUpperCase();
  if (
    ticketType === 'CHILD'
    && minAge == null
    && maxAge == null
    && minHeight == null
    && maxHeight == null
  ) {
    return 'Vé trẻ em phải có ít nhất một điều kiện tuổi hoặc chiều cao có cấu trúc.';
  }

  return '';
}

module.exports = {
  isNonEmptyString,
  isValidTime,
  isValidDate,
  validateBankDetails,
  validateKyc,
  validateAttraction,
  validateTicket,
};
