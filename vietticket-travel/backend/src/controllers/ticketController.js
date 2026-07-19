const prisma = require('../config/prisma');
const { Prisma } = require('@prisma/client');
const { randomUUID } = require('crypto');
const {
  ticketStatusFromClient,
  refundPolicyFromClient,
  toTicket,
} = require('../utils/partnerMappers');
const { isValidTime, validateTicket } = require('../utils/partnerValidators');
const { findOwnedAttraction } = require('./attractionController');
const { normalizeRefundFeeRate, todayInVietnam } = require('../utils/refundService');
const {
  getBookableSchedule,
  getProductCapacity,
  getSlotCapacity,
} = require('../services/availabilityService');
const { refreshAttractionMinPrice } = require('../services/catalogService');
const {
  assertPartnerCanEdit,
  hasPublishedVersion,
  buildAttractionSnapshot,
} = require('../services/attractionWorkflowService');
const { writeAuditLog } = require('../utils/auditLog');
const { isBookingCutoffPassed } = require('../utils/activityTime');
const { MAX_TICKETS_PER_ORDER } = require('../config/bookingPolicy');
const { parseVndInteger } = require('../utils/money');

const attractionInclude = {
  images: true,
  categories: { include: { category: true } },
  ticketProducts: { where: { archivedAt: null } },
  timeSlots: { where: { ticketProductId: null, isActive: true } },
  specialDates: true,
};

const HOLD_DURATION_MS = 10 * 60 * 1000;
const MAX_ACTIVE_HOLDS_PER_USER = 3;

// Tìm vé và xác minh thuộc về đối tác hiện tại (qua điểm tham quan)
async function findOwnedTicket(ticketId, partnerId) {
  const ticket = await prisma.ticketProduct.findUnique({
    where: { id: ticketId },
    include: {
      attraction: {
        select: { id: true, partnerId: true, status: true, archivedAt: true, publishedAt: true, draftData: true },
      },
    },
  });

  if (!ticket || ticket.archivedAt || ticket.attraction.partnerId !== partnerId) {
    return null;
  }

  return ticket;
}

function buildTicketData(body) {
  const data = {};
  if (body.name !== undefined) data.name = String(body.name).trim();
  if (body.type !== undefined) data.type = String(body.type).toUpperCase();
  if (body.description !== undefined) data.description = String(body.description || '').trim();
  if (body.originalPrice !== undefined) data.originalPrice = Number(body.originalPrice);
  if (body.sellingPrice !== undefined) data.sellingPrice = Number(body.sellingPrice);
  if (body.status !== undefined) data.status = ticketStatusFromClient(body.status);
  if (body.refundPolicy !== undefined) data.refundPolicy = refundPolicyFromClient(body.refundPolicy);
  if (body.refundFeeRate !== undefined) data.refundFeeRate = Number(body.refundFeeRate);
  if (body.refundCutoffHours !== undefined) data.refundCutoffHours = Number(body.refundCutoffHours);
  for (const field of ['minAgeYears', 'maxAgeYears', 'minHeightCm', 'maxHeightCm']) {
    if (body[field] !== undefined) {
      data[field] = body[field] === '' || body[field] == null ? null : Number(body[field]);
    }
  }
  if (body.requiresAdult !== undefined) {
    data.requiresAdult = [true, 1, '1', 'true'].includes(body.requiresAdult);
  }
  return data;
}

// GET /api/partners/attractions/:id/tickets
async function listTickets(req, res, next) {
  try {
    const attraction = await findOwnedAttraction(req.params.id, req.partner.id, {});
    if (!attraction) {
      return res.status(404).json({ message: 'Không tìm thấy điểm tham quan.' });
    }

    if (hasPublishedVersion(attraction)) {
      const draft = attraction.draftData || buildAttractionSnapshot(attraction);
      const tickets = draft.tickets || [];
      return res.json({
        attraction: { id: attraction.id, name: attraction.title },
        tickets: tickets.map(toTicket),
      });
    }

    const tickets = await prisma.ticketProduct.findMany({
      where: { attractionId: attraction.id, archivedAt: null },
      orderBy: { createdAt: 'asc' },
    });

    return res.json({
      attraction: { id: attraction.id, name: attraction.title },
      tickets: tickets.map(toTicket),
    });
  } catch (error) {
    next(error);
  }
}

// POST /api/partners/attractions/:id/tickets
async function createTicket(req, res, next) {
  try {
    const attraction = await findOwnedAttraction(req.params.id, req.partner.id, {});
    if (!attraction) {
      return res.status(404).json({ message: 'Không tìm thấy điểm tham quan.' });
    }

    assertPartnerCanEdit(attraction);

    const validationError = validateTicket(req.body, { partial: false });
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    const data = buildTicketData(req.body);
    if (!data.type) data.type = 'ADULT';
    if (!data.status) data.status = 'ACTIVE';
    if (!data.refundPolicy) data.refundPolicy = 'NON_REFUNDABLE';
    data.refundFeeRate = normalizeRefundFeeRate(data.refundPolicy, data.refundFeeRate);
    if (data.refundCutoffHours === undefined) data.refundCutoffHours = 24;
    if (!data.description) data.description = '';

    if (hasPublishedVersion(attraction)) {
      const draft = attraction.draftData || buildAttractionSnapshot(attraction);
      const tickets = draft.tickets || [];
      const ticketId = `draft-${randomUUID()}`;
      const newTicket = {
        id: ticketId,
        name: data.name,
        type: data.type,
        description: data.description,
        originalPrice: data.originalPrice,
        sellingPrice: data.sellingPrice,
        status: data.status,
        refundPolicy: data.refundPolicy,
        refundFeeRate: data.refundFeeRate,
        refundCutoffHours: data.refundCutoffHours,
        minAgeYears: data.minAgeYears ?? null,
        maxAgeYears: data.maxAgeYears ?? null,
        minHeightCm: data.minHeightCm ?? null,
        maxHeightCm: data.maxHeightCm ?? null,
        requiresAdult: Boolean(data.requiresAdult),
      };
      tickets.push(newTicket);
      draft.tickets = tickets;

      await prisma.attraction.update({
        where: { id: attraction.id },
        data: { draftData: draft, status: 'DRAFT', rejectionReason: null },
      });

      await writeAuditLog({
        req,
        action: 'ATTRACTION_TICKET_CREATED',
        entityType: 'ATTRACTION',
        entityId: attraction.id,
        metadata: { ticketId, isDraft: true },
      });

      return res.status(201).json({
        message: 'Tạo gói vé thành công.',
        ticket: toTicket(newTicket),
      });
    }

    const ticket = await prisma.ticketProduct.create({
      data: { ...data, attractionId: attraction.id },
    });
    await refreshAttractionMinPrice(prisma, attraction.id);
    await writeAuditLog({
      req,
      action: 'ATTRACTION_TICKET_CREATED',
      entityType: 'ATTRACTION',
      entityId: attraction.id,
      metadata: { ticketId: ticket.id },
    });

    return res.status(201).json({
      message: 'Tạo gói vé thành công.',
      ticket: toTicket(ticket),
    });
  } catch (error) {
    next(error);
  }
}

// GET /api/partners/tickets/:ticketId
async function getTicket(req, res, next) {
  try {
    const ticketId = req.params.ticketId;
    if (ticketId.startsWith('draft-')) {
      const attractions = await prisma.attraction.findMany({
        where: { partnerId: req.partner.id, archivedAt: null },
      });
      for (const a of attractions) {
        const draft = a.draftData;
        if (draft && Array.isArray(draft.tickets)) {
          const t = draft.tickets.find((tk) => tk.id === ticketId);
          if (t) return res.json({ ticket: toTicket(t) });
        }
      }
      return res.status(404).json({ message: 'Không tìm thấy gói vé.' });
    }

    const ticket = await findOwnedTicket(ticketId, req.partner.id);
    if (!ticket) {
      return res.status(404).json({ message: 'Không tìm thấy gói vé.' });
    }

    if (hasPublishedVersion(ticket.attraction)) {
      const draft = ticket.attraction.draftData || buildAttractionSnapshot(ticket.attraction);
      const t = (draft.tickets || []).find((tk) => tk.id === ticketId);
      if (t) return res.json({ ticket: toTicket(t) });
    }

    return res.json({ ticket: toTicket(ticket) });
  } catch (error) {
    next(error);
  }
}

// PUT /api/partners/tickets/:ticketId
async function updateTicket(req, res, next) {
  try {
    const ticketId = req.params.ticketId;
    const validationError = validateTicket(req.body, { partial: true });
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    if (ticketId.startsWith('draft-')) {
      const attractions = await prisma.attraction.findMany({
        where: { partnerId: req.partner.id, archivedAt: null },
      });
      let attraction = null;
      let draft = null;
      let ticketIndex = -1;
      for (const a of attractions) {
        const d = a.draftData;
        if (d && Array.isArray(d.tickets)) {
          const idx = d.tickets.findIndex((tk) => tk.id === ticketId);
          if (idx !== -1) {
            attraction = a;
            draft = d;
            ticketIndex = idx;
            break;
          }
        }
      }
      if (!attraction) {
        return res.status(404).json({ message: 'Không tìm thấy gói vé.' });
      }

      assertPartnerCanEdit(attraction);

      const current = draft.tickets[ticketIndex];
      const original = req.body.originalPrice !== undefined ? Number(req.body.originalPrice) : current.originalPrice;
      const selling = req.body.sellingPrice !== undefined ? Number(req.body.sellingPrice) : current.sellingPrice;
      if (selling > original) {
        return res.status(400).json({ message: 'Giá bán không được lớn hơn giá gốc.' });
      }

      const nextRefundPolicy = req.body.refundPolicy !== undefined
        ? refundPolicyFromClient(req.body.refundPolicy)
        : current.refundPolicy;
      const nextRefundFeeRate = normalizeRefundFeeRate(
        nextRefundPolicy,
        req.body.refundFeeRate !== undefined ? req.body.refundFeeRate : current.refundFeeRate,
      );
      const nextRefundCutoffHours = req.body.refundCutoffHours !== undefined
        ? Number(req.body.refundCutoffHours)
        : Number(current.refundCutoffHours ?? 24);

      const updatedTicket = {
        ...current,
        name: req.body.name !== undefined ? String(req.body.name).trim() : current.name,
        type: req.body.type !== undefined ? String(req.body.type).toUpperCase() : current.type,
        description: req.body.description !== undefined ? String(req.body.description || '').trim() : current.description,
        originalPrice: original,
        sellingPrice: selling,
        status: req.body.status !== undefined ? ticketStatusFromClient(req.body.status) : current.status,
        refundPolicy: nextRefundPolicy,
        refundFeeRate: nextRefundFeeRate,
        refundCutoffHours: nextRefundCutoffHours,
        minAgeYears: req.body.minAgeYears !== undefined
          ? (req.body.minAgeYears === '' || req.body.minAgeYears == null ? null : Number(req.body.minAgeYears))
          : current.minAgeYears ?? null,
        maxAgeYears: req.body.maxAgeYears !== undefined
          ? (req.body.maxAgeYears === '' || req.body.maxAgeYears == null ? null : Number(req.body.maxAgeYears))
          : current.maxAgeYears ?? null,
        minHeightCm: req.body.minHeightCm !== undefined
          ? (req.body.minHeightCm === '' || req.body.minHeightCm == null ? null : Number(req.body.minHeightCm))
          : current.minHeightCm ?? null,
        maxHeightCm: req.body.maxHeightCm !== undefined
          ? (req.body.maxHeightCm === '' || req.body.maxHeightCm == null ? null : Number(req.body.maxHeightCm))
          : current.maxHeightCm ?? null,
        requiresAdult: req.body.requiresAdult !== undefined
          ? [true, 1, '1', 'true'].includes(req.body.requiresAdult)
          : Boolean(current.requiresAdult),
      };

      draft.tickets[ticketIndex] = updatedTicket;
      await prisma.attraction.update({
        where: { id: attraction.id },
        data: { draftData: draft, status: 'DRAFT', rejectionReason: null },
      });

      await writeAuditLog({
        req,
        action: 'ATTRACTION_TICKET_UPDATED',
        entityType: 'ATTRACTION',
        entityId: attraction.id,
        metadata: { ticketId, isDraft: true },
      });

      return res.json({
        message: 'Cập nhật gói vé thành công.',
        ticket: toTicket(updatedTicket),
      });
    }

    const existing = await findOwnedTicket(ticketId, req.partner.id);
    if (!existing) {
      return res.status(404).json({ message: 'Không tìm thấy gói vé.' });
    }

    assertPartnerCanEdit(existing.attraction);

    const original = req.body.originalPrice !== undefined ? Number(req.body.originalPrice) : Number(existing.originalPrice);
    const selling = req.body.sellingPrice !== undefined ? Number(req.body.sellingPrice) : Number(existing.sellingPrice);
    if (selling > original) {
      return res.status(400).json({ message: 'Giá bán không được lớn hơn giá gốc.' });
    }

    if (hasPublishedVersion(existing.attraction)) {
      const draft = existing.attraction.draftData || buildAttractionSnapshot(existing.attraction);
      const tickets = draft.tickets || [];
      const idx = tickets.findIndex((tk) => tk.id === ticketId);
      const current = idx !== -1 ? tickets[idx] : {
        id: existing.id,
        name: existing.name,
        type: existing.type,
        description: existing.description || '',
        originalPrice: Number(existing.originalPrice),
        sellingPrice: Number(existing.sellingPrice),
        status: existing.status,
        refundPolicy: existing.refundPolicy,
        refundFeeRate: Number(existing.refundFeeRate),
        refundCutoffHours: Number(existing.refundCutoffHours ?? 24),
        minAgeYears: existing.minAgeYears,
        maxAgeYears: existing.maxAgeYears,
        minHeightCm: existing.minHeightCm,
        maxHeightCm: existing.maxHeightCm,
        requiresAdult: Boolean(existing.requiresAdult),
      };

      const nextRefundPolicy = req.body.refundPolicy !== undefined
        ? refundPolicyFromClient(req.body.refundPolicy)
        : current.refundPolicy;
      const nextRefundFeeRate = normalizeRefundFeeRate(
        nextRefundPolicy,
        req.body.refundFeeRate !== undefined ? req.body.refundFeeRate : current.refundFeeRate,
      );
      const nextRefundCutoffHours = req.body.refundCutoffHours !== undefined
        ? Number(req.body.refundCutoffHours)
        : Number(current.refundCutoffHours ?? 24);

      const updatedTicket = {
        ...current,
        name: req.body.name !== undefined ? String(req.body.name).trim() : current.name,
        type: req.body.type !== undefined ? String(req.body.type).toUpperCase() : current.type,
        description: req.body.description !== undefined ? String(req.body.description || '').trim() : current.description,
        originalPrice: original,
        sellingPrice: selling,
        status: req.body.status !== undefined ? ticketStatusFromClient(req.body.status) : current.status,
        refundPolicy: nextRefundPolicy,
        refundFeeRate: nextRefundFeeRate,
        refundCutoffHours: nextRefundCutoffHours,
        minAgeYears: req.body.minAgeYears !== undefined
          ? (req.body.minAgeYears === '' || req.body.minAgeYears == null ? null : Number(req.body.minAgeYears))
          : current.minAgeYears ?? null,
        maxAgeYears: req.body.maxAgeYears !== undefined
          ? (req.body.maxAgeYears === '' || req.body.maxAgeYears == null ? null : Number(req.body.maxAgeYears))
          : current.maxAgeYears ?? null,
        minHeightCm: req.body.minHeightCm !== undefined
          ? (req.body.minHeightCm === '' || req.body.minHeightCm == null ? null : Number(req.body.minHeightCm))
          : current.minHeightCm ?? null,
        maxHeightCm: req.body.maxHeightCm !== undefined
          ? (req.body.maxHeightCm === '' || req.body.maxHeightCm == null ? null : Number(req.body.maxHeightCm))
          : current.maxHeightCm ?? null,
        requiresAdult: req.body.requiresAdult !== undefined
          ? [true, 1, '1', 'true'].includes(req.body.requiresAdult)
          : Boolean(current.requiresAdult),
      };

      if (idx !== -1) {
        tickets[idx] = updatedTicket;
      } else {
        tickets.push(updatedTicket);
      }

      draft.tickets = tickets;
      await prisma.attraction.update({
        where: { id: existing.attractionId },
        data: { draftData: draft, status: 'DRAFT', rejectionReason: null },
      });

      await writeAuditLog({
        req,
        action: 'ATTRACTION_TICKET_UPDATED',
        entityType: 'ATTRACTION',
        entityId: existing.attractionId,
        metadata: { ticketId: existing.id, isDraft: true },
      });

      return res.json({
        message: 'Cập nhật gói vé thành công.',
        ticket: toTicket(updatedTicket),
      });
    }

    const ticketData = buildTicketData(req.body);
    if (ticketData.refundPolicy !== undefined || ticketData.refundFeeRate !== undefined) {
      const nextRefundPolicy = ticketData.refundPolicy || existing.refundPolicy;
      const nextRefundFeeRate = ticketData.refundFeeRate !== undefined
        ? ticketData.refundFeeRate
        : existing.refundFeeRate;
      ticketData.refundFeeRate = normalizeRefundFeeRate(nextRefundPolicy, nextRefundFeeRate);
    }

    const ticket = await prisma.ticketProduct.update({
      where: { id: existing.id },
      data: ticketData,
    });
    await refreshAttractionMinPrice(prisma, existing.attractionId);
    await writeAuditLog({
      req,
      action: 'ATTRACTION_TICKET_UPDATED',
      entityType: 'ATTRACTION',
      entityId: existing.attractionId,
      metadata: { ticketId: existing.id },
    });

    return res.json({
      message: 'Cập nhật gói vé thành công.',
      ticket: toTicket(ticket),
    });
  } catch (error) {
    next(error);
  }
}

// DELETE /api/partners/tickets/:ticketId
async function deleteTicket(req, res, next) {
  try {
    const ticketId = req.params.ticketId;
    if (ticketId.startsWith('draft-')) {
      const attractions = await prisma.attraction.findMany({
        where: { partnerId: req.partner.id, archivedAt: null },
      });
      let attraction = null;
      let draft = null;
      for (const a of attractions) {
        const d = a.draftData;
        if (d && Array.isArray(d.tickets)) {
          const idx = d.tickets.findIndex((tk) => tk.id === ticketId);
          if (idx !== -1) {
            attraction = a;
            draft = d;
            break;
          }
        }
      }
      if (!attraction) {
        return res.status(404).json({ message: 'Không tìm thấy gói vé.' });
      }

      assertPartnerCanEdit(attraction);

      draft.tickets = draft.tickets.filter((tk) => tk.id !== ticketId);
      await prisma.attraction.update({
        where: { id: attraction.id },
        data: { draftData: draft, status: 'DRAFT', rejectionReason: null },
      });

      await writeAuditLog({
        req,
        action: 'ATTRACTION_TICKET_ARCHIVED',
        entityType: 'ATTRACTION',
        entityId: attraction.id,
        metadata: { ticketId, isDraft: true },
      });

      return res.json({ message: 'Đã xóa gói vé khỏi bản nháp.' });
    }

    const existing = await findOwnedTicket(ticketId, req.partner.id);
    if (!existing) {
      return res.status(404).json({ message: 'Không tìm thấy gói vé.' });
    }

    assertPartnerCanEdit(existing.attraction);

    if (hasPublishedVersion(existing.attraction)) {
      const draft = existing.attraction.draftData || buildAttractionSnapshot(existing.attraction);
      const tickets = draft.tickets || [];
      draft.tickets = tickets.filter((tk) => tk.id !== ticketId);

      await prisma.attraction.update({
        where: { id: existing.attractionId },
        data: { draftData: draft, status: 'DRAFT', rejectionReason: null },
      });

      await writeAuditLog({
        req,
        action: 'ATTRACTION_TICKET_ARCHIVED',
        entityType: 'ATTRACTION',
        entityId: existing.attractionId,
        metadata: { ticketId: existing.id, isDraft: true },
      });

      return res.json({ message: 'Đã xóa gói vé khỏi bản nháp.' });
    }

    await prisma.ticketProduct.update({
      where: { id: existing.id },
      data: { archivedAt: new Date(), status: 'INACTIVE' },
    });
    await refreshAttractionMinPrice(prisma, existing.attractionId);
    await writeAuditLog({
      req,
      action: 'ATTRACTION_TICKET_ARCHIVED',
      entityType: 'ATTRACTION',
      entityId: existing.attractionId,
      metadata: { ticketId: existing.id },
    });

    return res.json({ message: 'Đã lưu trữ gói vé. Lịch sử đặt vé được giữ nguyên.' });
  } catch (error) {
    next(error);
  }
}

// ==========================================
// FUNCTIONS TỪ MPhu (booking flow)
// ==========================================

function parseDateString(dateStr) {
  // Expect YYYY-MM-DD
  if (!dateStr || typeof dateStr !== 'string') return null;
  const m = /^\d{4}-\d{2}-\d{2}$/.exec(dateStr);
  if (!m) return null;
  // create Date at UTC midnight
  const d = new Date(dateStr + 'T00:00:00.000Z');
  if (Number.isNaN(d.getTime())) return null;
  // JavaScript normalizes impossible dates (for example 2026-02-31 -> 2026-03-03).
  // Round-trip the value so the API never silently books a different calendar day.
  if (d.toISOString().slice(0, 10) !== dateStr) return null;
  return d;
}

// POST /api/attractions/:attractionId/tickets — tạo vé (public partner flow từ MPhu)
async function createTicketProduct(req, res, next) {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Unauthorized' } });

    const attractionId = req.params.attractionId;
    const attraction = await prisma.attraction.findUnique({
      where: { id: attractionId },
      include: attractionInclude,
    });
    if (!attraction) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Attraction not found' } });

    const partner = await prisma.partnerProfile.findUnique({ where: { userId } });
    if (!partner || partner.id !== attraction.partnerId) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Không có quyền thao tác' } });
    }

    assertPartnerCanEdit(attraction);

    const { name, description, originalPrice, sellingPrice, refundPolicy } = req.body || {};
    if (!name || !description || originalPrice == null || sellingPrice == null) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'name, description, originalPrice, sellingPrice are required' } });
    }

    const validPolicies = ['NON_REFUNDABLE', 'FREE_CANCELLATION', 'REFUND_WITH_FEE'];
    if (refundPolicy && !validPolicies.includes(refundPolicy)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'refundPolicy is invalid' } });
    }
    const ticketValidationError = validateTicket(req.body || {}, { partial: false });
    if (ticketValidationError) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: ticketValidationError },
      });
    }

    if (hasPublishedVersion(attraction)) {
      const draft = attraction.draftData || buildAttractionSnapshot(attraction);
      const tickets = draft.tickets || [];
      const ticketId = `draft-${randomUUID()}`;
      const normalizedRefundPolicy = refundPolicy || 'NON_REFUNDABLE';
      const normalizedRefundFeeRate = normalizeRefundFeeRate(
        normalizedRefundPolicy,
        req.body.refundFeeRate,
      );
      const newTicket = {
        id: ticketId,
        name,
        type: String(req.body.type || 'ADULT').toUpperCase(),
        description,
        originalPrice: Number(originalPrice),
        sellingPrice: Number(sellingPrice),
        status: 'ACTIVE',
        refundPolicy: normalizedRefundPolicy,
        refundFeeRate: normalizedRefundFeeRate,
        refundCutoffHours: Number(req.body.refundCutoffHours ?? 24),
        minAgeYears: req.body.minAgeYears === '' || req.body.minAgeYears == null
          ? null
          : Number(req.body.minAgeYears),
        maxAgeYears: req.body.maxAgeYears === '' || req.body.maxAgeYears == null
          ? null
          : Number(req.body.maxAgeYears),
        minHeightCm: req.body.minHeightCm === '' || req.body.minHeightCm == null
          ? null
          : Number(req.body.minHeightCm),
        maxHeightCm: req.body.maxHeightCm === '' || req.body.maxHeightCm == null
          ? null
          : Number(req.body.maxHeightCm),
        requiresAdult: [true, 1, '1', 'true'].includes(req.body.requiresAdult),
      };
      tickets.push(newTicket);
      draft.tickets = tickets;

      await prisma.attraction.update({
        where: { id: attraction.id },
        data: { draftData: draft, status: 'DRAFT', rejectionReason: null },
      });

      await writeAuditLog({
        req,
        action: 'ATTRACTION_TICKET_CREATED',
        entityType: 'ATTRACTION',
        entityId: attraction.id,
        metadata: { ticketId, isDraft: true },
      });

      return res.status(201).json({ success: true, data: { id: ticketId, name, status: 'ACTIVE' } });
    }

    const normalizedRefundPolicy = refundPolicy || 'NON_REFUNDABLE';
    const normalizedRefundFeeRate = normalizeRefundFeeRate(
      normalizedRefundPolicy,
      req.body.refundFeeRate,
    );

    const product = await prisma.ticketProduct.create({
      data: {
        attractionId,
        name,
        type: String(req.body.type || 'ADULT').toUpperCase(),
        description,
        originalPrice,
        sellingPrice,
        refundPolicy: normalizedRefundPolicy,
        refundFeeRate: normalizedRefundFeeRate,
        refundCutoffHours: Number(req.body.refundCutoffHours ?? 24),
        minAgeYears: req.body.minAgeYears === '' || req.body.minAgeYears == null
          ? null
          : Number(req.body.minAgeYears),
        maxAgeYears: req.body.maxAgeYears === '' || req.body.maxAgeYears == null
          ? null
          : Number(req.body.maxAgeYears),
        minHeightCm: req.body.minHeightCm === '' || req.body.minHeightCm == null
          ? null
          : Number(req.body.minHeightCm),
        maxHeightCm: req.body.maxHeightCm === '' || req.body.maxHeightCm == null
          ? null
          : Number(req.body.maxHeightCm),
        requiresAdult: [true, 1, '1', 'true'].includes(req.body.requiresAdult),
        status: 'ACTIVE',
      },
    });
    await refreshAttractionMinPrice(prisma, attractionId);

    return res.status(201).json({ success: true, data: { id: product.id, name: product.name, status: product.status } });
  } catch (error) {
    return next(error);
  }
}


// PUT /api/tickets/:ticketProductId/time-slots — thiết lập khung giờ (MPhu)
async function setupTimeSlots(req, res, next) {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Unauthorized' } });

    const ticketProductId = req.params.ticketProductId;
    const product = await prisma.ticketProduct.findUnique({ where: { id: ticketProductId }, include: { attraction: true } });
    if (!product || product.archivedAt) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket product not found' } });

    const partner = await prisma.partnerProfile.findUnique({ where: { userId } });
    if (!partner || partner.id !== product.attraction.partnerId) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Không có quyền thao tác' } });
    }

    try {
      assertPartnerCanEdit(product.attraction);
    } catch (error) {
      return res.status(error.statusCode || 409).json({
        success: false,
        error: {
          code: error.statusCode === 403 ? 'FORBIDDEN' : 'INVALID_STATE',
          message: error.message,
        },
      });
    }

    if (hasPublishedVersion(product.attraction)) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'REVIEW_REQUIRED',
          message: 'Khung gio cua goi ve da cong khai phai duoc thay doi qua ban nhap va gui admin duyet.',
        },
      });
    }

    const slots = Array.isArray(req.body.slots) ? req.body.slots : null;
    if (!slots || !slots.length) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'slots array is required' } });

    // Validate slots
    for (const s of slots) {
      if (!isValidTime(s.startTime) || !isValidTime(s.endTime)) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Khung giờ phải đúng định dạng HH:MM.' } });
      }
      if (s.startTime >= s.endTime) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Giờ bắt đầu khung giờ phải trước giờ kết thúc.' } });
      }
      if (!Number.isFinite(Number(s.maxCapacity)) || Number(s.maxCapacity) < 1) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Each slot requires startTime, endTime and positive maxCapacity' } });
      }
    }

    const sortedSlots = [...slots].sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
    for (let i = 1; i < sortedSlots.length; i += 1) {
      if (String(sortedSlots[i].startTime) < String(sortedSlots[i - 1].endTime)) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Các khung giờ không được chồng lấn nhau.' },
        });
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.timeSlot.updateMany({
        where: { ticketProductId, isActive: true },
        data: { isActive: false },
      });
      const createData = slots.map((s) => ({ ticketProductId, startTime: s.startTime, endTime: s.endTime, maxCapacity: Number(s.maxCapacity), isActive: s.isActive !== false }));
      await tx.timeSlot.createMany({ data: createData });
    });

    return res.status(200).json({ success: true, data: { message: 'Thiết lập khung giờ thành công!' } });
  } catch (error) {
    return next(error);
  }
}

// GET /api/tickets/:ticketProductId/availability — kiểm tra sức chứa (MPhu)
async function checkAvailability(req, res, next) {
  try {
    const ticketProductId = req.params.ticketProductId;
    const dateStr = req.query.date;
    const date = parseDateString(dateStr);
    if (!date) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid date format (YYYY-MM-DD)' } });

    const schedule = await getBookableSchedule(prisma, ticketProductId, date);
    if (schedule.isClosed) {
      return res.status(200).json({
        success: true,
        data: [],
        meta: { closed: true, reason: 'Địa điểm đóng cửa trong ngày đã chọn.' },
      });
    }

    const [dailyStock, attractionStock, slotStocks] = await Promise.all([
      prisma.dailyStock.findUnique({
        where: { ticketProductId_date: { ticketProductId, date } },
      }),
      prisma.attractionDailyStock.findUnique({
        where: {
          attractionId_date: { attractionId: schedule.attraction.id, date },
        },
      }),
      schedule.slots.length > 0
        ? prisma.timeSlotStock.findMany({
            where: { timeSlotId: { in: schedule.slots.map((slot) => slot.id) }, date },
          })
        : Promise.resolve([]),
    ]);

    const productAvailable = Math.max(
      0,
      getProductCapacity(schedule)
        - Number(dailyStock?.bookedQuantity || 0)
        - Number(dailyStock?.heldQuantity || 0),
    );
    const attractionAvailable = Math.max(
      0,
      schedule.dayCapacity
        - Number(attractionStock?.bookedQty || 0)
        - Number(attractionStock?.heldQty || 0),
    );
    const stockBySlot = new Map(slotStocks.map((stock) => [stock.timeSlotId, stock]));

    const results = schedule.slots.length > 0
      ? schedule.slots.map((slot) => {
          const stock = stockBySlot.get(slot.id);
          const bookingClosed = isBookingCutoffPassed({
            date,
            timeSlot: slot,
            attraction: schedule.attraction,
          });
          const slotAvailable = Math.max(
            0,
            getSlotCapacity(schedule, slot)
              - Number(stock?.bookedQty || 0)
              - Number(stock?.heldQty || 0),
          );
          return {
            id: slot.id,
            timeSlotId: slot.id,
            startTime: slot.startTime,
            endTime: slot.endTime,
            maxCapacity: getSlotCapacity(schedule, slot),
            availableTickets: Math.min(
              bookingClosed ? 0 : slotAvailable,
              bookingClosed ? 0 : productAvailable,
              bookingClosed ? 0 : attractionAvailable,
            ),
            bookingClosed,
          };
        })
      : [{
          id: 'all-day',
          timeSlotId: null,
          startTime: schedule.attraction.openTime || null,
          endTime: schedule.attraction.closeTime || null,
          label: 'Vé sử dụng trong ngày',
          maxCapacity: Math.min(getProductCapacity(schedule), schedule.dayCapacity),
          availableTickets: isBookingCutoffPassed({
            date,
            attraction: schedule.attraction,
          })
            ? 0
            : Math.min(productAvailable, attractionAvailable),
          bookingClosed: isBookingCutoffPassed({
            date,
            attraction: schedule.attraction,
          }),
        }];

    return res.status(200).json({
      success: true,
      data: results,
      meta: {
        closed: false,
        slotSource: schedule.slotSource,
        dayCapacity: schedule.dayCapacity,
      },
    });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: error.message },
      });
    }
    return next(error);
  }
}

async function runSerializable(work, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      lastError = error;
      const retryable = error.code === 'P2034' || error.code === 'P2002';
      if (!retryable || attempt === maxAttempts) throw error;
    }
  }
  throw lastError;
}

// POST /api/tickets/:ticketProductId/reserve — đặt chỗ (MPhu)
async function reserveTickets(req, res, next) {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Unauthorized' } });

    const ticketProductId = req.params.ticketProductId;
    const { date: dateStr, quantity: qtyRaw, timeSlotId } = req.body || {};
    const quantity = Number(qtyRaw);
    if (!dateStr) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'date is required' } });
    if (
      !Number.isSafeInteger(quantity)
      || quantity < 1
      || quantity > MAX_TICKETS_PER_ORDER
    ) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `Số lượng vé mỗi đơn phải là số nguyên từ 1 đến ${MAX_TICKETS_PER_ORDER}.`,
        },
      });
    }

    const date = parseDateString(dateStr);
    if (!date) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid date format (YYYY-MM-DD)' } });

    // Chỉ cho đặt từ hôm nay (giờ VN) tới tối đa 1 năm — chặn đặt vé cho ngày quá khứ.
    const today = todayInVietnam();
    const visitDay = date.toISOString().slice(0, 10);
    if (visitDay < today) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Ngày tham quan phải từ hôm nay trở đi.' },
      });
    }
    const maxDay = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (visitDay > maxDay) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Chỉ có thể đặt vé trong vòng 1 năm tới.' },
      });
    }

    const holdStartedAt = new Date();
    const expiresAt = new Date(holdStartedAt.getTime() + HOLD_DURATION_MS);

    const result = await runSerializable(async (tx) => {
      const activeHoldWhere = {
        userId,
        status: 'HELD',
        expiresAt: { gt: holdStartedAt },
      };
      const [activeHoldCount, duplicateHold] = await Promise.all([
        tx.reservation.count({ where: activeHoldWhere }),
        tx.reservation.findFirst({
          where: {
            ...activeHoldWhere,
            ticketProductId,
            date,
            timeSlotId: timeSlotId || null,
          },
          select: { id: true, expiresAt: true },
        }),
      ]);

      if (duplicateHold) {
        const err = new Error('Bạn đã có một lượt giữ chỗ còn hiệu lực cho lựa chọn này. Vui lòng tiếp tục thanh toán hoặc chờ lượt giữ chỗ hết hạn.');
        err.statusCode = 409;
        throw err;
      }
      if (activeHoldCount >= MAX_ACTIVE_HOLDS_PER_USER) {
        const err = new Error(`Mỗi tài khoản chỉ được có tối đa ${MAX_ACTIVE_HOLDS_PER_USER} lượt giữ chỗ cùng lúc.`);
        err.statusCode = 429;
        throw err;
      }

      const schedule = await getBookableSchedule(tx, ticketProductId, date);
      if (schedule.isClosed) {
        const err = new Error('Địa điểm đóng cửa trong ngày đã chọn.');
        err.statusCode = 409;
        throw err;
      }
      const snapshotUnitPrice = parseVndInteger(schedule.product.sellingPrice);
      if (snapshotUnitPrice === null) {
        const err = new Error('Giá bán của gói vé phải là số nguyên VND hợp lệ.');
        err.statusCode = 409;
        throw err;
      }
      const snapshotRefundPolicy =
        schedule.product.refundPolicy || 'NON_REFUNDABLE';
      const snapshotRefundFeeRate = normalizeRefundFeeRate(
        snapshotRefundPolicy,
        schedule.product.refundFeeRate,
      );
      const rawRefundCutoffHours = Number(schedule.product.refundCutoffHours ?? 24);
      const snapshotRefundCutoffHours =
        Number.isSafeInteger(rawRefundCutoffHours)
        && rawRefundCutoffHours >= 0
        && rawRefundCutoffHours <= 720
          ? rawRefundCutoffHours
          : 24;
      const rawCommissionRate = Number(
        schedule.attraction.partner?.commissionRate ?? 0.10,
      );
      const snapshotCommissionRate = Number.isFinite(rawCommissionRate)
        ? Math.min(Math.max(rawCommissionRate, 0), 1)
        : 0.10;

      let selectedSlot = null;
      if (timeSlotId) {
        selectedSlot = schedule.slots.find((slot) => slot.id === timeSlotId) || null;
        if (!selectedSlot) {
          const err = new Error('Khung giờ không thuộc gói vé hoặc đã ngừng hoạt động.');
          err.statusCode = 404;
          throw err;
        }
      } else if (schedule.slots.length > 0) {
        const err = new Error('Vui lòng chọn khung giờ tham quan.');
        err.statusCode = 400;
        throw err;
      }

      if (isBookingCutoffPassed({
        date,
        timeSlot: selectedSlot,
        attraction: schedule.attraction,
        now: holdStartedAt,
      })) {
        const err = new Error('Đã quá giờ nhận đặt vé cho khung giờ hoặc ngày tham quan này.');
        err.statusCode = 409;
        throw err;
      }

      const productCapacity = getProductCapacity(schedule);
      const dailyWhere = { ticketProductId_date: { ticketProductId, date } };
      let daily = await tx.dailyStock.findUnique({ where: dailyWhere });
      if (!daily) {
        daily = await tx.dailyStock.create({
          data: {
            ticketProductId,
            date,
            capacity: productCapacity,
            bookedQuantity: 0,
            heldQuantity: 0,
          },
        });
      } else if (daily.capacity !== productCapacity) {
        daily = await tx.dailyStock.update({
          where: { id: daily.id },
          data: { capacity: productCapacity },
        });
      }

      const attractionWhere = {
        attractionId_date: { attractionId: schedule.attraction.id, date },
      };
      let attractionStock = await tx.attractionDailyStock.findUnique({
        where: attractionWhere,
      });
      if (!attractionStock) {
        attractionStock = await tx.attractionDailyStock.create({
          data: {
            attractionId: schedule.attraction.id,
            date,
            capacity: schedule.dayCapacity,
          },
        });
      } else if (attractionStock.capacity !== schedule.dayCapacity) {
        attractionStock = await tx.attractionDailyStock.update({
          where: { id: attractionStock.id },
          data: { capacity: schedule.dayCapacity },
        });
      }

      const availableDaily = daily.capacity - daily.bookedQuantity - daily.heldQuantity;
      const availableAttraction =
        attractionStock.capacity - attractionStock.bookedQty - attractionStock.heldQty;
      const availableForDay = Math.min(availableDaily, availableAttraction);
      if (availableForDay < quantity) {
        const err = new Error(`Không đủ vé. Còn lại: ${Math.max(0, availableForDay)} vé`);
        err.statusCode = 409;
        throw err;
      }

      let tstock = null;
      if (selectedSlot) {
        const tslotWhere = { timeSlotId_date: { timeSlotId, date } };
        tstock = await tx.timeSlotStock.findUnique({ where: tslotWhere });
        if (!tstock) {
          tstock = await tx.timeSlotStock.create({
            data: { timeSlotId, date, bookedQty: 0, heldQty: 0 },
          });
        }
        const availableSlot =
          getSlotCapacity(schedule, selectedSlot) - tstock.bookedQty - tstock.heldQty;
        if (availableSlot < quantity) {
          const err = new Error(
            `Không đủ vé ở khung giờ này. Còn lại: ${Math.max(0, availableSlot)} vé`,
          );
          err.statusCode = 409;
          throw err;
        }
      }

      await tx.dailyStock.update({
        where: { id: daily.id },
        data: { heldQuantity: { increment: quantity } },
      });
      await tx.attractionDailyStock.update({
        where: { id: attractionStock.id },
        data: { heldQty: { increment: quantity } },
      });
      if (tstock) {
        await tx.timeSlotStock.update({
          where: { id: tstock.id },
          data: { heldQty: { increment: quantity } },
        });
      }

      const reservation = await tx.reservation.create({
        data: {
          userId,
          ticketProductId,
          timeSlotId: selectedSlot?.id || null,
          date,
          quantity,
          status: 'HELD',
          expiresAt,
          paymentDeadline: expiresAt,
          snapshotUnitPrice,
          snapshotRefundPolicy,
          snapshotRefundFeeRate,
          snapshotRefundCutoffHours,
          snapshotCommissionRate,
        },
      });

      return { reservationId: reservation.id, ticketProductId, quantity, expiresAt };
    });

    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    if (error.statusCode === 404) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: error.message } });
    if (error.statusCode === 400) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: error.message } });
    if (error.statusCode === 409) return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: error.message } });
    if (error.statusCode === 429) return res.status(429).json({ success: false, error: { code: 'HOLD_LIMIT_EXCEEDED', message: error.message } });
    return next(error);
  }
}

module.exports = {
  // Partner portal routes
  listTickets,
  createTicket,
  getTicket,
  updateTicket,
  deleteTicket,
  // Public/booking routes (từ MPhu)
  createTicketProduct,
  setupTimeSlots,
  checkAvailability,
  reserveTickets,
  HOLD_DURATION_MS,
  MAX_ACTIVE_HOLDS_PER_USER,
  MAX_TICKETS_PER_ORDER,
};

