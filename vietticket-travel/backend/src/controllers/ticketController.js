const prisma = require('../config/prisma');
const {
  ticketStatusFromClient,
  refundPolicyFromClient,
  toTicket,
} = require('../utils/partnerMappers');
const { validateTicket } = require('../utils/partnerValidators');
const { findOwnedAttraction } = require('./attractionController');
const { todayInVietnam } = require('../utils/refundService');

// Tìm vé và xác minh thuộc về đối tác hiện tại (qua điểm tham quan)
async function findOwnedTicket(ticketId, partnerId) {
  const ticket = await prisma.ticketProduct.findUnique({
    where: { id: ticketId },
    include: { attraction: { select: { partnerId: true } } },
  });

  if (!ticket || ticket.attraction.partnerId !== partnerId) {
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
  return data;
}

// GET /api/partners/attractions/:id/tickets
async function listTickets(req, res, next) {
  try {
    const attraction = await findOwnedAttraction(req.params.id, req.partner.id, {});
    if (!attraction) {
      return res.status(404).json({ message: 'Không tìm thấy điểm tham quan.' });
    }

    const tickets = await prisma.ticketProduct.findMany({
      where: { attractionId: attraction.id },
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

    const validationError = validateTicket(req.body, { partial: false });
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    const data = buildTicketData(req.body);
    if (!data.type) data.type = 'ADULT';
    if (!data.status) data.status = 'ACTIVE';
    if (!data.refundPolicy) data.refundPolicy = 'NON_REFUNDABLE';
    if (!data.description) data.description = '';

    const ticket = await prisma.ticketProduct.create({
      data: { ...data, attractionId: attraction.id },
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
    const ticket = await findOwnedTicket(req.params.ticketId, req.partner.id);
    if (!ticket) {
      return res.status(404).json({ message: 'Không tìm thấy gói vé.' });
    }
    return res.json({ ticket: toTicket(ticket) });
  } catch (error) {
    next(error);
  }
}

// PUT /api/partners/tickets/:ticketId
async function updateTicket(req, res, next) {
  try {
    const existing = await findOwnedTicket(req.params.ticketId, req.partner.id);
    if (!existing) {
      return res.status(404).json({ message: 'Không tìm thấy gói vé.' });
    }

    const validationError = validateTicket(req.body, { partial: true });
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    // Kiểm tra chéo giá khi chỉ cập nhật một trong hai
    const original = req.body.originalPrice !== undefined
      ? Number(req.body.originalPrice)
      : Number(existing.originalPrice);
    const selling = req.body.sellingPrice !== undefined
      ? Number(req.body.sellingPrice)
      : Number(existing.sellingPrice);
    if (selling > original) {
      return res.status(400).json({ message: 'Giá bán không được lớn hơn giá gốc.' });
    }

    const ticket = await prisma.ticketProduct.update({
      where: { id: existing.id },
      data: buildTicketData(req.body),
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
    const existing = await findOwnedTicket(req.params.ticketId, req.partner.id);
    if (!existing) {
      return res.status(404).json({ message: 'Không tìm thấy gói vé.' });
    }

    await prisma.ticketProduct.delete({ where: { id: existing.id } });

    return res.json({ message: 'Đã xóa gói vé.' });
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
  return d;
}

// POST /api/attractions/:attractionId/tickets — tạo vé (public partner flow từ MPhu)
async function createTicketProduct(req, res, next) {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Unauthorized' } });

    const attractionId = req.params.attractionId;
    const attraction = await prisma.attraction.findUnique({ where: { id: attractionId } });
    if (!attraction) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Attraction not found' } });

    const partner = await prisma.partnerProfile.findUnique({ where: { userId } });
    if (!partner || partner.id !== attraction.partnerId) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Không có quyền thao tác' } });
    }

    const { name, description, originalPrice, sellingPrice, refundPolicy } = req.body || {};
    if (!name || !description || originalPrice == null || sellingPrice == null) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'name, description, originalPrice, sellingPrice are required' } });
    }

    const validPolicies = ['NON_REFUNDABLE', 'FREE_CANCELLATION', 'REFUND_WITH_FEE'];
    if (refundPolicy && !validPolicies.includes(refundPolicy)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'refundPolicy is invalid' } });
    }

    const product = await prisma.ticketProduct.create({
      data: {
        attractionId,
        name,
        description,
        originalPrice,
        sellingPrice,
        refundPolicy: refundPolicy || 'NON_REFUNDABLE',
        status: 'ACTIVE',
      },
    });

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
    if (!product) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket product not found' } });

    const partner = await prisma.partnerProfile.findUnique({ where: { userId } });
    if (!partner || partner.id !== product.attraction.partnerId) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Không có quyền thao tác' } });
    }

    const slots = Array.isArray(req.body.slots) ? req.body.slots : null;
    if (!slots || !slots.length) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'slots array is required' } });

    // Validate slots
    for (const s of slots) {
      if (!s.startTime || !s.endTime || !Number.isFinite(Number(s.maxCapacity)) || Number(s.maxCapacity) < 1) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Each slot requires startTime, endTime and positive maxCapacity' } });
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.timeSlot.deleteMany({ where: { ticketProductId } });
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

    const timeSlots = await prisma.timeSlot.findMany({ where: { ticketProductId, isActive: true } });

    const results = [];
    for (const slot of timeSlots) {
      const stock = await prisma.timeSlotStock.findUnique({ where: { timeSlotId_date: { timeSlotId: slot.id, date } } });
      const booked = (stock && stock.bookedQty) || 0;
      const held = (stock && stock.heldQty) || 0;
      const available = Math.max(0, slot.maxCapacity - booked - held);
      results.push({ timeSlotId: slot.id, startTime: slot.startTime, endTime: slot.endTime, maxCapacity: slot.maxCapacity, availableTickets: available });
    }

    return res.status(200).json({ success: true, data: results });
  } catch (error) {
    return next(error);
  }
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
    if (!Number.isInteger(quantity) || quantity < 1) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'quantity must be a positive integer' } });

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

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    const result = await prisma.$transaction(async (tx) => {
      const product = await tx.ticketProduct.findUnique({ where: { id: ticketProductId } });
      if (!product || product.status !== 'ACTIVE') {
        const err = new Error('Ticket product not available');
        err.statusCode = 404;
        throw err;
      }

      // compute capacity
      let totalCapacity;
      if (timeSlotId) {
        const slot = await tx.timeSlot.findUnique({ where: { id: timeSlotId } });
        if (!slot || slot.ticketProductId !== ticketProductId) {
          const err = new Error('Time slot not found');
          err.statusCode = 404;
          throw err;
        }
        totalCapacity = slot.maxCapacity;
      } else {
        const slots = await tx.timeSlot.findMany({ where: { ticketProductId, isActive: true } });
        totalCapacity = slots.reduce((s, t) => s + (t.maxCapacity || 0), 0);
      }

      // find or create daily stock
      const dailyWhere = { ticketProductId_date: { ticketProductId, date } };
      let daily = await tx.dailyStock.findUnique({ where: dailyWhere });
      if (!daily) {
        daily = await tx.dailyStock.create({ data: { ticketProductId, date, capacity: totalCapacity, bookedQuantity: 0, heldQuantity: 0 } });
      }

      const availableDaily = daily.capacity - daily.bookedQuantity - daily.heldQuantity;
      if (availableDaily < quantity) {
        const err = new Error(`Không đủ vé. Còn lại: ${availableDaily} vé`);
        err.statusCode = 409;
        throw err;
      }

      // if timeSlot provided, check time slot stock
      if (timeSlotId) {
        const tslotWhere = { timeSlotId_date: { timeSlotId, date } };
        let tstock = await tx.timeSlotStock.findUnique({ where: tslotWhere });
        if (!tstock) {
          tstock = await tx.timeSlotStock.create({ data: { timeSlotId, date, bookedQty: 0, heldQty: 0 } });
        }
        const availableSlot = (await tx.timeSlot.findUnique({ where: { id: timeSlotId } })).maxCapacity - tstock.bookedQty - tstock.heldQty;
        if (availableSlot < quantity) {
          const err = new Error(`Không đủ vé ở khung giờ này. Còn lại: ${availableSlot} vé`);
          err.statusCode = 409;
          throw err;
        }

        // increment held counts
        await tx.dailyStock.update({ where: { id: daily.id }, data: { heldQuantity: { increment: quantity } } });
        await tx.timeSlotStock.update({ where: { id: tstock.id }, data: { heldQty: { increment: quantity } } });
      } else {
        // increment only daily held
        await tx.dailyStock.update({ where: { id: daily.id }, data: { heldQuantity: { increment: quantity } } });
      }

      const reservation = await tx.reservation.create({ data: { userId, ticketProductId, timeSlotId: timeSlotId || null, date, quantity, status: 'HELD', expiresAt } });

      return { reservationId: reservation.id, ticketProductId, quantity, expiresAt };
    });

    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    if (error.statusCode === 404) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: error.message } });
    if (error.statusCode === 409) return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: error.message } });
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
};

