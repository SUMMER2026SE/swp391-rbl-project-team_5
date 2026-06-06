const prisma = require('../config/prisma');

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

async function reserveTickets(req, res, next) {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Unauthorized' } });

    const ticketProductId = req.params.ticketProductId;
    const { date: dateStr, quantity: qtyRaw, timeSlotId } = req.body || {};
    const quantity = Number(qtyRaw);
    if (!dateStr) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'date is required' } });
    if (!Number.isFinite(quantity) || quantity < 1) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'quantity must be a positive integer' } });

    const date = parseDateString(dateStr);
    if (!date) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid date format (YYYY-MM-DD)' } });

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    const result = await prisma.$transaction(async (tx) => {
      const product = await tx.ticketProduct.findUnique({ where: { id: ticketProductId } });
      if (!product || product.status !== 'ACTIVE') {
        const err = new Error('Ticket product not available');
        err.statusCode = 404;
        throw err;
      }

      // compute capacity
      let totalCapacity = 0;
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

    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    if (error.statusCode === 404) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: error.message } });
    if (error.statusCode === 409) return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: error.message } });
    return next(error);
  }
}

module.exports = { createTicketProduct, setupTimeSlots, checkAvailability, reserveTickets };
