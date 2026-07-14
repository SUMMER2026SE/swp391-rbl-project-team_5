// ============================================================
// Ánh xạ giữa enum trong cơ sở dữ liệu (Prisma) và giá trị mà
// frontend Partner Portal đang sử dụng. Tập trung tại đây để
// tránh lặp lại trong các controller.
// ============================================================

const { normalizeRefundFeeRate } = require('./refundService');

// --- Trạng thái điểm tham quan ---
// FE chỉ dùng 'active' | 'inactive'; DB dùng AttractionStatus đầy đủ.
function attractionStatusToClient(dbStatus, publicationStatus) {
  if (publicationStatus) {
    return publicationStatus === 'ACTIVE' ? 'active' : 'inactive';
  }
  return dbStatus === 'APPROVED' ? 'active' : 'inactive';
}

function attractionStatusFromClient(clientStatus) {
  return String(clientStatus).toLowerCase() === 'active' ? 'APPROVED' : 'DRAFT';
}

// --- Trạng thái vé ---
function ticketStatusToClient(dbStatus) {
  return dbStatus === 'ACTIVE' ? 'active' : 'inactive';
}

function ticketStatusFromClient(clientStatus) {
  return String(clientStatus).toLowerCase() === 'active' ? 'ACTIVE' : 'INACTIVE';
}

// --- Chính sách hoàn/hủy ---
// FE: 'NONE' | 'PARTIAL' | 'FULL'  <->  DB: RefundPolicyType
const REFUND_TO_DB = {
  NONE: 'NON_REFUNDABLE',
  PARTIAL: 'REFUND_WITH_FEE',
  FULL: 'FREE_CANCELLATION',
};
const REFUND_TO_CLIENT = {
  NON_REFUNDABLE: 'NONE',
  REFUND_WITH_FEE: 'PARTIAL',
  FREE_CANCELLATION: 'FULL',
};

function refundPolicyToClient(dbPolicy) {
  return REFUND_TO_CLIENT[dbPolicy] || 'NONE';
}

function refundPolicyFromClient(clientPolicy) {
  const normalized = String(clientPolicy).toUpperCase();
  if (Object.prototype.hasOwnProperty.call(REFUND_TO_CLIENT, normalized)) {
    return normalized;
  }
  return REFUND_TO_DB[normalized] || 'NON_REFUNDABLE';
}

const TICKET_TYPES = ['ADULT', 'CHILD', 'FAMILY', 'GROUP'];

// --- Chuyển Decimal của Prisma về Number cho JSON ---
function decimalToNumber(value) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

// --- Định dạng "HH:MM - HH:MM" cho cột Giờ mở cửa ---
function formatHours(openTime, closeTime) {
  if (!openTime || !closeTime) return '';
  return `${openTime} - ${closeTime}`;
}

// --- Ảnh đại diện (primary) của điểm tham quan ---
function primaryImageUrl(images = []) {
  if (!Array.isArray(images) || images.length === 0) return null;
  const primary = images.find((img) => img.isPrimary) || images[0];
  return primary ? primary.imageUrl : null;
}

function getWorkingSnapshot(attraction) {
  return attraction.draftData && typeof attraction.draftData === 'object'
    ? attraction.draftData
    : null;
}

function snapshotImages(snapshot) {
  return (snapshot?.images || []).map((image) => ({
    id: image.id,
    imageUrl: image.url || image.imageUrl,
    isPrimary: Boolean(image.isPrimary),
  }));
}

// ============================================================
// Bộ chuyển đổi bản ghi DB -> shape mà từng trang FE mong đợi
// ============================================================

// Dạng dòng trong bảng danh sách (PartnerAttractionsPage)
function toAttractionListItem(attraction) {
  const draft = getWorkingSnapshot(attraction);
  const images = draft ? snapshotImages(draft) : attraction.images;
  return {
    id: attraction.id,
    name: draft?.title ?? attraction.title,
    category: draft?.category?.name || attraction.categories?.[0]?.category?.name || '',
    city: draft?.city ?? attraction.city,
    district: draft?.district ?? attraction.district ?? '',
    hours: formatHours(
      draft?.openTime ?? attraction.openTime,
      draft?.closeTime ?? attraction.closeTime,
    ),
    status: attractionStatusToClient(attraction.status, attraction.publicationStatus),
    dbStatus: attraction.status,
    publicationStatus: attraction.publicationStatus || (
      attraction.status === 'APPROVED' ? 'ACTIVE' : 'PAUSED'
    ),
    requiresManualApproval: Boolean(
      draft?.requiresManualApproval ?? attraction.requiresManualApproval,
    ),
    hasPublishedVersion: Boolean(attraction.publishedAt),
    hasUnpublishedChanges: Boolean(draft),
    submittedAt: attraction.submittedAt || null,
    reviewedAt: attraction.reviewedAt || null,
    rejectionReason: attraction.rejectionReason || null,
    image: primaryImageUrl(images),
  };
}

// Dạng chi tiết để load vào form (PartnerEditAttractionPage)
function toAttractionDetail(attraction) {
  const draft = getWorkingSnapshot(attraction);
  const images = draft ? snapshotImages(draft) : attraction.images;
  return {
    id: attraction.id,
    name: draft?.title ?? attraction.title,
    description: draft?.description ?? attraction.description ?? '',
    openTime: draft?.openTime ?? attraction.openTime ?? '',
    closeTime: draft?.closeTime ?? attraction.closeTime ?? '',
    province: draft?.city ?? attraction.city,
    district: draft?.district ?? attraction.district ?? '',
    address: draft?.address ?? attraction.address,
    lat: (draft?.latitude ?? attraction.latitude) != null
      ? String(draft?.latitude ?? attraction.latitude)
      : '',
    lng: (draft?.longitude ?? attraction.longitude) != null
      ? String(draft?.longitude ?? attraction.longitude)
      : '',
    status: attractionStatusToClient(attraction.status, attraction.publicationStatus),
    dbStatus: attraction.status,
    publicationStatus: attraction.publicationStatus || (
      attraction.status === 'APPROVED' ? 'ACTIVE' : 'PAUSED'
    ),
    requiresManualApproval: Boolean(
      draft?.requiresManualApproval ?? attraction.requiresManualApproval,
    ),
    hasPublishedVersion: Boolean(attraction.publishedAt),
    hasUnpublishedChanges: Boolean(draft),
    submittedAt: attraction.submittedAt || null,
    reviewedAt: attraction.reviewedAt || null,
    rejectionReason: attraction.rejectionReason || null,
    category: draft?.category?.name || attraction.categories?.[0]?.category?.name || '',
    images: (images || []).map((img) => ({
      id: img.id,
      url: img.imageUrl,
      isPrimary: img.isPrimary,
    })),
  };
}

// Dạng vé cho danh sách + form (PartnerTicketsPage / PartnerTicketFormPage)
function toTicket(ticket) {
  return {
    id: ticket.id,
    name: ticket.name,
    type: ticket.type,
    description: ticket.description || '',
    originalPrice: decimalToNumber(ticket.originalPrice),
    sellingPrice: decimalToNumber(ticket.sellingPrice),
    refundPolicy: refundPolicyToClient(ticket.refundPolicy),
    refundFeeRate: normalizeRefundFeeRate(
      ticket.refundPolicy,
      decimalToNumber(ticket.refundFeeRate),
    ),
    refundCutoffHours: Number(ticket.refundCutoffHours ?? 24),
    status: ticketStatusToClient(ticket.status),
  };
}

// Khung giờ (PartnerSchedulePage)
function toTimeSlot(slot) {
  return {
    id: slot.id,
    start: slot.startTime,
    end: slot.endTime,
    capacity: slot.maxCapacity,
    isActive: slot.isActive,
  };
}

module.exports = {
  TICKET_TYPES,
  attractionStatusToClient,
  attractionStatusFromClient,
  ticketStatusToClient,
  ticketStatusFromClient,
  refundPolicyToClient,
  refundPolicyFromClient,
  decimalToNumber,
  formatHours,
  primaryImageUrl,
  toAttractionListItem,
  toAttractionDetail,
  toTicket,
  toTimeSlot,
};
