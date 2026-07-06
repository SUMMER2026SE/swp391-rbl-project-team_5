'use strict';

const prisma = require('../config/prisma');
const { isPlatformStaff } = require('../middleware/roleMiddleware');
const {
  emitSupportMessage,
  emitSupportTicketUpdated,
} = require('../realtime/events');

const SUPPORT_STATUSES = new Set(['OPEN', 'IN_PROGRESS', 'RESOLVED']);

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isSupportStaff(user) {
  return isPlatformStaff(user);
}

function assertSupportStaff(user) {
  if (!isSupportStaff(user)) {
    throw httpError(403, 'Chỉ nhân viên nội bộ của nền tảng mới có quyền xử lý yêu cầu hỗ trợ.');
  }
}

function sendError(res, error, next) {
  if (error.statusCode) {
    return res.status(error.statusCode).json({
      success: false,
      error: { message: error.message },
    });
  }
  return next(error);
}

// SupportMessage không có quan hệ tới User trong schema -> nạp tên người gửi rời.
async function attachSenders(messages) {
  const ids = [...new Set(messages.map((m) => m.senderId))];
  if (ids.length === 0) return messages;

  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, fullName: true, role: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));

  return messages.map((m) => ({
    ...m,
    senderName: byId.get(m.senderId)?.fullName || 'Người dùng',
    senderRole: byId.get(m.senderId)?.role || 'CUSTOMER',
  }));
}

// POST /api/support/tickets — khách tạo yêu cầu hỗ trợ.
async function createTicket(req, res, next) {
  try {
    const subject = String(req.body?.subject || '').trim();
    const description = String(req.body?.description || '').trim();
    const bookingId = String(req.body?.bookingId || '').trim() || null;

    if (!subject) throw httpError(400, 'Vui lòng nhập tiêu đề yêu cầu.');
    if (description.length < 10) {
      throw httpError(400, 'Nội dung chi tiết cần tối thiểu 10 ký tự.');
    }

    if (bookingId) {
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: { userId: true },
      });
      if (!booking || booking.userId !== req.user.id) {
        throw httpError(404, 'Không tìm thấy đơn hàng liên quan.');
      }
    }

    // Lưu mô tả thành tin nhắn đầu tiên để Staff thấy ngay trong khung chat.
    const ticket = await prisma.supportTicket.create({
      data: {
        userId: req.user.id,
        bookingId,
        subject,
        description,
        status: 'OPEN',
        messages: {
          create: { senderId: req.user.id, message: description },
        },
      },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });

    return res.status(201).json({ success: true, data: ticket });
  } catch (error) {
    return sendError(res, error, next);
  }
}

// GET /api/support/tickets/my-tickets — danh sách ticket của khách đang đăng nhập.
async function listMyTickets(req, res, next) {
  try {
    const tickets = await prisma.supportTicket.findMany({
      where: { userId: req.user.id },
      orderBy: { updatedAt: 'desc' },
      include: {
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    return res.json({ success: true, data: tickets });
  } catch (error) {
    return next(error);
  }
}

// GET /api/support/tickets — (Staff/Admin) toàn bộ ticket, lọc theo trạng thái + tìm kiếm.
async function listAllTickets(req, res, next) {
  try {
    assertSupportStaff(req.user);

    const status = String(req.query.status || '').trim().toUpperCase();
    if (status && !SUPPORT_STATUSES.has(status)) {
      throw httpError(400, 'Trạng thái không hợp lệ.');
    }
    const search = String(req.query.search || '').trim();

    const where = {};
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { id: { contains: search, mode: 'insensitive' } },
        { user: { fullName: { contains: search, mode: 'insensitive' } } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const tickets = await prisma.supportTicket.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        user: { select: { fullName: true, email: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    return res.json({ success: true, data: tickets });
  } catch (error) {
    return sendError(res, error, next);
  }
}

// GET /api/support/tickets/:ticketId — chi tiết + tin nhắn. Chủ ticket hoặc Staff/Admin.
async function getTicketDetail(req, res, next) {
  try {
    const { ticketId } = req.params;

    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            profile: { select: { phoneNumber: true, avatarUrl: true } },
          },
        },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!ticket) throw httpError(404, 'Không tìm thấy yêu cầu hỗ trợ.');
    if (!isSupportStaff(req.user) && ticket.userId !== req.user.id) {
      throw httpError(403, 'Bạn không có quyền xem yêu cầu này.');
    }

    ticket.messages = await attachSenders(ticket.messages);
    return res.json({ success: true, data: ticket });
  } catch (error) {
    return sendError(res, error, next);
  }
}

// POST /api/support/tickets/:ticketId/messages — gửi tin nhắn (kèm broadcast socket).
async function sendMessage(req, res, next) {
  try {
    const { ticketId } = req.params;
    const text = String(req.body?.message || '').trim();
    if (!text) throw httpError(400, 'Nội dung tin nhắn không được để trống.');

    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: { id: true, userId: true, status: true },
    });
    if (!ticket) throw httpError(404, 'Không tìm thấy yêu cầu hỗ trợ.');

    const staff = isSupportStaff(req.user);
    if (!staff && ticket.userId !== req.user.id) {
      throw httpError(403, 'Bạn không có quyền gửi tin trong yêu cầu này.');
    }
    if (ticket.status === 'RESOLVED') {
      throw httpError(409, 'Yêu cầu này đã được đóng. Vui lòng tạo yêu cầu mới.');
    }

    // Staff trả lời lần đầu cho ticket OPEN -> tự chuyển IN_PROGRESS.
    const shouldProgress = staff && ticket.status === 'OPEN';

    const [message] = await prisma.$transaction([
      prisma.supportMessage.create({
        data: { ticketId, senderId: req.user.id, message: text },
      }),
      // Ghi cùng status hiện tại để @updatedAt tự cập nhật -> ticket nổi lên đầu hàng đợi.
      prisma.supportTicket.update({
        where: { id: ticketId },
        data: { status: shouldProgress ? 'IN_PROGRESS' : ticket.status },
      }),
    ]);

    const enriched = {
      ...message,
      senderName: req.user.fullName,
      senderRole: req.user.role,
    };

    emitSupportMessage(ticketId, enriched);
    if (shouldProgress) {
      emitSupportTicketUpdated(ticketId, { ticketId, status: 'IN_PROGRESS' });
    }

    return res.status(201).json({ success: true, data: enriched });
  } catch (error) {
    return sendError(res, error, next);
  }
}

// PATCH /api/support/tickets/:ticketId/status — (Staff/Admin) đổi trạng thái ticket.
async function updateTicketStatus(req, res, next) {
  try {
    assertSupportStaff(req.user);

    const { ticketId } = req.params;
    const status = String(req.body?.status || '').trim().toUpperCase();
    if (!SUPPORT_STATUSES.has(status)) {
      throw httpError(400, 'Trạng thái không hợp lệ.');
    }

    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: { id: true },
    });
    if (!ticket) throw httpError(404, 'Không tìm thấy yêu cầu hỗ trợ.');

    const updated = await prisma.supportTicket.update({
      where: { id: ticketId },
      data: { status },
    });

    emitSupportTicketUpdated(ticketId, { ticketId, status });
    return res.json({ success: true, data: updated });
  } catch (error) {
    return sendError(res, error, next);
  }
}

module.exports = {
  createTicket,
  listMyTickets,
  listAllTickets,
  getTicketDetail,
  sendMessage,
  updateTicketStatus,
};
