const prisma = require('../config/prisma');
const {
  ticketStatusFromClient,
  refundPolicyFromClient,
  toTicket,
} = require('../utils/partnerMappers');
const { validateTicket } = require('../utils/partnerValidators');
const { findOwnedAttraction } = require('./attractionController');

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

module.exports = {
  listTickets,
  createTicket,
  getTicket,
  updateTicket,
  deleteTicket,
};
