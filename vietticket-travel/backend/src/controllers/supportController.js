'use strict';

const prisma = require('../config/prisma');
const { isPlatformStaff } = require('../middleware/roleMiddleware');
const { hasRole } = require('../utils/userRoles');
const { writeAuditLog } = require('../utils/auditLog');
const {
  emitSupportMessage,
  emitSupportTicketUpdated,
} = require('../realtime/events');

const SUPPORT_STATUSES = new Set(['OPEN', 'IN_PROGRESS', 'RESOLVED']);
const SUPPORT_PRIORITIES = new Set(['LOW', 'NORMAL', 'HIGH', 'URGENT']);
const RESOLUTION_CODES = new Set([
  'RESOLVED_INFORMATION',
  'REFUND_GUIDANCE',
  'TECHNICAL_FIXED',
  'PARTNER_FOLLOW_UP',
  'OTHER',
]);
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

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

function getSupportSenderRole(user) {
  if (hasRole(user, 'ADMIN')) return 'ADMIN';
  if (isSupportStaff(user)) return 'STAFF';
  return 'CUSTOMER';
}

function inferPriority(subject, bookingId) {
  const normalized = String(subject || '').toLowerCase();
  if (bookingId && /(thanh toán|hoàn|payment|refund)/u.test(normalized)) return 'HIGH';
  return 'NORMAL';
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
    select: {
      id: true,
      fullName: true,
      role: true,
      roleMemberships: { select: { role: true } },
    },
  });
  const byId = new Map(users.map((u) => [u.id, u]));

  return messages.map((m) => ({
    ...m,
    senderName: byId.get(m.senderId)?.fullName || 'Người dùng',
    senderRole: getSupportSenderRole(byId.get(m.senderId)),
  }));
}

// POST /api/support/tickets — khách tạo yêu cầu hỗ trợ.
async function createTicket(req, res, next) {
  try {
    const subject = String(req.body?.subject || '').trim();
    const description = String(req.body?.description || '').trim();
    const bookingId = String(req.body?.bookingId || '').trim() || null;

    if (!subject) throw httpError(400, 'Vui lòng nhập tiêu đề yêu cầu.');
    if (subject.length > 200) throw httpError(400, 'Tiêu đề không được vượt quá 200 ký tự.');
    if (description.length < 10) {
      throw httpError(400, 'Nội dung chi tiết cần tối thiểu 10 ký tự.');
    }
    if (description.length > 5000) {
      throw httpError(400, 'Nội dung chi tiết không được vượt quá 5.000 ký tự.');
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
        priority: inferPriority(subject, bookingId),
        messages: {
          create: { senderId: req.user.id, message: description },
        },
      },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });

    emitSupportTicketUpdated(ticket);
    await writeAuditLog({
      req,
      actorId: req.user.id,
      action: 'SUPPORT_TICKET_CREATED',
      entityType: 'SupportTicket',
      entityId: ticket.id,
      metadata: { bookingId, priority: ticket.priority },
    }).catch((auditError) => {
      console.error('[support] Không thể ghi audit log tạo yêu cầu:', auditError.message);
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
    const priority = String(req.query.priority || '').trim().toUpperCase();
    if (priority && !SUPPORT_PRIORITIES.has(priority)) {
      throw httpError(400, 'Mức ưu tiên không hợp lệ.');
    }
    const search = String(req.query.search || '').trim();
    const assignment = String(req.query.assignment || '').trim().toLowerCase();
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(parsePositiveInt(req.query.limit, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
    const skip = (page - 1) * limit;

    const where = {};
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (assignment === 'me') where.assignedToId = req.user.id;
    if (assignment === 'unassigned') where.assignedToId = null;
    if (search) {
      where.OR = [
        { id: { contains: search, mode: 'insensitive' } },
        { user: { fullName: { contains: search, mode: 'insensitive' } } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [tickets, total, statusGroups = []] = await Promise.all([
      prisma.supportTicket.findMany({
        where,
        orderBy: [
          { priority: 'desc' },
          { createdAt: 'asc' },
        ],
        skip,
        take: limit,
        include: {
          user: { select: { fullName: true, email: true } },
          assignedTo: { select: { id: true, fullName: true, email: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      }),
      prisma.supportTicket.count({ where }),
      prisma.supportTicket.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
    ]);
    const stats = { OPEN: 0, IN_PROGRESS: 0, RESOLVED: 0 };
    for (const group of statusGroups || []) {
      if (Object.hasOwn(stats, group.status)) {
        stats[group.status] = Number(group?._count?._all || 0);
      }
    }
    return res.json({
      success: true,
      data: tickets,
      stats,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
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
        assignedTo: {
          select: { id: true, fullName: true, email: true },
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
    if (text.length > 5000) throw httpError(400, 'Tin nhắn không được vượt quá 5.000 ký tự.');

    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        userId: true,
        status: true,
        assignedToId: true,
        firstRespondedAt: true,
      },
    });
    if (!ticket) throw httpError(404, 'Không tìm thấy yêu cầu hỗ trợ.');

    const staff = isSupportStaff(req.user);
    if (!staff && ticket.userId !== req.user.id) {
      throw httpError(403, 'Bạn không có quyền gửi tin trong yêu cầu này.');
    }
    if (ticket.status === 'RESOLVED') {
      throw httpError(409, 'Yêu cầu này đã được đóng. Vui lòng tạo yêu cầu mới.');
    }
    if (staff && ticket.assignedToId && ticket.assignedToId !== req.user.id) {
      throw httpError(409, 'Yêu cầu này đang được một nhân viên khác xử lý.');
    }

    // Staff trả lời lần đầu cho ticket OPEN -> tự chuyển IN_PROGRESS.
    const shouldProgress = staff && ticket.status === 'OPEN';

    const now = new Date();
    const message = await prisma.$transaction(async (tx) => {
      if (staff) {
        const claimed = await tx.supportTicket.updateMany({
          where: {
            id: ticketId,
            status: { not: 'RESOLVED' },
            OR: [
              { assignedToId: null },
              { assignedToId: req.user.id },
            ],
          },
          data: {
            status: 'IN_PROGRESS',
            assignedToId: req.user.id,
            assignedAt: ticket.assignedToId ? undefined : now,
            firstRespondedAt: ticket.firstRespondedAt || now,
          },
        });
        if (claimed.count !== 1) {
          throw httpError(409, 'Yêu cầu vừa được nhận bởi một nhân viên khác.');
        }
      } else {
        await tx.supportTicket.update({
          where: { id: ticketId },
          data: { status: ticket.status },
        });
      }

      const created = await tx.supportMessage.create({
        data: { ticketId, senderId: req.user.id, message: text },
      });
      if (staff && !ticket.assignedToId) {
        await writeAuditLog({
          client: tx,
          req,
          action: 'SUPPORT_TICKET_CLAIMED',
          entityType: 'SupportTicket',
          entityId: ticketId,
          metadata: { source: 'FIRST_RESPONSE' },
        });
      }
      return created;
    });

    const enriched = {
      ...message,
      senderName: req.user.fullName,
      senderRole: getSupportSenderRole(req.user),
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
    const resolutionCode = String(req.body?.resolutionCode || '').trim().toUpperCase();
    const resolutionNote = String(req.body?.resolutionNote || '').trim();
    if (!SUPPORT_STATUSES.has(status)) {
      throw httpError(400, 'Trạng thái không hợp lệ.');
    }

    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        userId: true,
        status: true,
        assignedToId: true,
      },
    });
    if (!ticket) throw httpError(404, 'Không tìm thấy yêu cầu hỗ trợ.');

    const updated = await prisma.$transaction(async (tx) => {
      const now = new Date();
      if (status === 'IN_PROGRESS') {
        if (ticket.status === 'RESOLVED') {
          throw httpError(409, 'Yêu cầu đã đóng; hãy mở lại trước khi nhận xử lý.');
        }
        const claimed = await tx.supportTicket.updateMany({
          where: {
            id: ticketId,
            status: { not: 'RESOLVED' },
            OR: [
              { assignedToId: null },
              { assignedToId: req.user.id },
            ],
          },
          data: {
            status: 'IN_PROGRESS',
            assignedToId: req.user.id,
            assignedAt: ticket.assignedToId ? undefined : now,
          },
        });
        if (claimed.count !== 1) {
          throw httpError(409, 'Yêu cầu đang được một nhân viên khác xử lý.');
        }
        await writeAuditLog({
          client: tx,
          req,
          action: 'SUPPORT_TICKET_CLAIMED',
          entityType: 'SupportTicket',
          entityId: ticketId,
        });
        return tx.supportTicket.findUnique({
          where: { id: ticketId },
          include: { assignedTo: { select: { id: true, fullName: true, email: true } } },
        });
      }

      if (status === 'RESOLVED') {
        if (ticket.status === 'RESOLVED') {
          throw httpError(409, 'Yêu cầu này đã được giải quyết trước đó.');
        }
        if (ticket.assignedToId !== req.user.id) {
          throw httpError(409, 'Bạn phải nhận xử lý yêu cầu trước khi đóng.');
        }
        if (!RESOLUTION_CODES.has(resolutionCode)) {
          throw httpError(400, 'Vui lòng chọn kết quả xử lý hợp lệ.');
        }
        if (resolutionNote.length < 10 || resolutionNote.length > 2000) {
          throw httpError(400, 'Kết luận xử lý phải từ 10 đến 2.000 ký tự.');
        }
        const staffReplyCount = await tx.supportMessage.count({
          where: {
            ticketId,
            senderId: { not: ticket.userId },
          },
        });
        if (staffReplyCount < 1) {
          throw httpError(409, 'Phải gửi ít nhất một phản hồi cho khách trước khi đóng yêu cầu.');
        }
        const resolved = await tx.supportTicket.update({
          where: { id: ticketId },
          data: {
            status: 'RESOLVED',
            resolvedAt: now,
            resolutionCode,
            resolutionNote,
          },
          include: { assignedTo: { select: { id: true, fullName: true, email: true } } },
        });
        await writeAuditLog({
          client: tx,
          req,
          action: 'SUPPORT_TICKET_RESOLVED',
          entityType: 'SupportTicket',
          entityId: ticketId,
          metadata: { resolutionCode, resolutionNote },
        });
        return resolved;
      }

      if (ticket.status !== 'RESOLVED') {
        throw httpError(409, 'Chỉ yêu cầu đã giải quyết mới có thể được mở lại.');
      }
      if (resolutionNote.length < 10 || resolutionNote.length > 2000) {
        throw httpError(400, 'Lý do mở lại phải từ 10 đến 2.000 ký tự.');
      }
      const reopened = await tx.supportTicket.update({
        where: { id: ticketId },
        data: {
          status: 'OPEN',
          assignedToId: null,
          assignedAt: null,
          resolvedAt: null,
          resolutionCode: null,
          resolutionNote: null,
        },
      });
      await writeAuditLog({
        client: tx,
        req,
        action: 'SUPPORT_TICKET_REOPENED',
        entityType: 'SupportTicket',
        entityId: ticketId,
        metadata: { reason: resolutionNote },
      });
      return reopened;
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
