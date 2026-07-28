const SINGLE_PERSON_TICKET_TYPES = new Set(['ADULT', 'CHILD', 'STUDENT']);
const PACKAGE_TICKET_TYPES = new Set(['FAMILY', 'GROUP']);
const MAX_ADMISSION_COUNT = 50;

function normalizeTicketType(value) {
  return String(value || 'ADULT').trim().toUpperCase();
}

function parseAdmissionCount(value) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 1 && count <= MAX_ADMISSION_COUNT
    ? count
    : null;
}

function validateAdmissionCount(ticketType, value, { required = true } = {}) {
  const type = normalizeTicketType(ticketType);
  const hasValue = value !== undefined && value !== null && value !== '';

  if (!hasValue && !required) return '';
  if (!hasValue && PACKAGE_TICKET_TYPES.has(type)) {
    return 'Vé gia đình/nhóm phải khai báo số khách được vào trên mỗi gói.';
  }

  const admissionCount = hasValue ? parseAdmissionCount(value) : 1;
  if (admissionCount == null) {
    return `Số khách trên mỗi gói phải là số nguyên từ 1 đến ${MAX_ADMISSION_COUNT}.`;
  }
  if (SINGLE_PERSON_TICKET_TYPES.has(type) && admissionCount !== 1) {
    return 'Vé người lớn, trẻ em và học sinh/sinh viên chỉ được áp dụng cho 1 khách.';
  }
  if (PACKAGE_TICKET_TYPES.has(type) && admissionCount < 2) {
    return 'Vé gia đình/nhóm phải áp dụng cho ít nhất 2 khách.';
  }
  return '';
}

function getProductAdmissionCount(product) {
  const error = validateAdmissionCount(product?.type, product?.admissionCount, {
    required: true,
  });
  if (error) {
    const capacityError = new Error(error);
    capacityError.statusCode = 409;
    capacityError.code = 'INVALID_ADMISSION_COUNT';
    throw capacityError;
  }
  return parseAdmissionCount(product?.admissionCount) || 1;
}

function getSnapshotAdmissionCount(entity) {
  const snapshot = parseAdmissionCount(entity?.snapshotAdmissionCount);
  if (snapshot != null) return snapshot;

  const productCount = parseAdmissionCount(entity?.ticketProduct?.admissionCount);
  return productCount || 1;
}

function getInventoryUnits(reservation) {
  const quantity = Number(reservation?.quantity);
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    const error = new Error('Số lượng gói vé trong giữ chỗ không hợp lệ.');
    error.statusCode = 409;
    error.code = 'INVALID_RESERVATION_QUANTITY';
    throw error;
  }
  return quantity * getSnapshotAdmissionCount(reservation);
}

function toSellableTicketCount(availableGuestUnits, admissionCount) {
  const available = Math.max(0, Math.floor(Number(availableGuestUnits) || 0));
  const perTicket = parseAdmissionCount(admissionCount) || 1;
  return Math.floor(available / perTicket);
}

module.exports = {
  MAX_ADMISSION_COUNT,
  PACKAGE_TICKET_TYPES,
  SINGLE_PERSON_TICKET_TYPES,
  getInventoryUnits,
  getProductAdmissionCount,
  getSnapshotAdmissionCount,
  normalizeTicketType,
  parseAdmissionCount,
  toSellableTicketCount,
  validateAdmissionCount,
};
