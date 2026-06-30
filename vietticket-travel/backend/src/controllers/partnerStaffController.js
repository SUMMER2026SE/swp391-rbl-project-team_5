'use strict';

const prisma = require('../config/prisma');
const { createRandomToken, hashToken, addMinutes } = require('../utils/tokenUtils');
const { isValidEmail, validateFullName, isValidPhoneNumber } = require('../utils/validators');
const { sendStaffInviteEmail, sendAccountStatusEmail } = require('../utils/mailer');
const { writeAuditLog } = require('../utils/auditLog');

// Lời mời đặt mật khẩu có hạn dài hơn link quên mật khẩu thường (48 giờ) để nhân
// viên có đủ thời gian kích hoạt tài khoản.
const INVITE_EXPIRY_MINUTES = 60 * 48;
const ALLOWED_STAFF_STATUSES = ['ACTIVE', 'LOCKED'];

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// Định dạng nhân viên trả về cho FE đối tác.
function toStaffResponse(staff) {
  const activeAssignments = (staff.staffAssignments || []).filter((a) => a.revokedAt === null);
  return {
    id: staff.id,
    email: staff.email,
    fullName: staff.fullName,
    status: staff.status,
    // Nhân viên chưa đặt mật khẩu (chưa kích hoạt) -> passwordHash null.
    activated: Boolean(staff.passwordHash),
    phoneNumber: staff.profile?.phoneNumber || null,
    createdAt: staff.createdAt,
    assignments: activeAssignments.map((a) => ({
      attractionId: a.attractionId,
      title: a.attraction?.title || null,
      city: a.attraction?.city || null,
    })),
  };
}

const staffResponseInclude = {
  profile: { select: { phoneNumber: true } },
  staffAssignments: {
    where: { revokedAt: null },
    include: { attraction: { select: { id: true, title: true, city: true } } },
  },
};

// Lấy nhân viên CHẮC CHẮN thuộc đối tác hiện tại; null nếu không phải.
async function findOwnedStaff(client, partnerId, staffId, include = staffResponseInclude) {
  const staff = await client.user.findUnique({
    where: { id: staffId },
    include,
  });
  if (!staff || staff.role !== 'STAFF' || staff.employerPartnerId !== partnerId) {
    return null;
  }
  return staff;
}

// Tạo token đặt mật khẩu (tái dùng PasswordResetToken) cho luồng mời nhân viên.
async function createInviteToken(tx, userId) {
  await tx.passwordResetToken.deleteMany({ where: { userId } });
  const rawToken = createRandomToken();
  await tx.passwordResetToken.create({
    data: {
      userId,
      token: hashToken(rawToken),
      expiresAt: addMinutes(INVITE_EXPIRY_MINUTES),
    },
  });
  return rawToken;
}

// GET /api/partners/staff — danh sách nhân viên của đối tác.
async function listStaff(req, res, next) {
  try {
    const staff = await prisma.user.findMany({
      where: { role: 'STAFF', employerPartnerId: req.partner.id },
      orderBy: { createdAt: 'asc' },
      include: staffResponseInclude,
    });
    return res.json({ success: true, data: staff.map(toStaffResponse) });
  } catch (error) {
    return next(error);
  }
}

// POST /api/partners/staff — tạo nhân viên mới và gửi email mời đặt mật khẩu.
async function createStaff(req, res, next) {
  try {
    const fullName = String(req.body.fullName || '').trim().replace(/\s+/g, ' ');
    const email = normalizeEmail(req.body.email);
    const phoneNumber = req.body.phoneNumber ? String(req.body.phoneNumber).trim() : null;

    const fullNameError = validateFullName(fullName);
    if (fullNameError) {
      return res.status(400).json({ success: false, error: { message: fullNameError } });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, error: { message: 'Email không hợp lệ.' } });
    }
    if (!isValidPhoneNumber(phoneNumber)) {
      return res.status(400).json({ success: false, error: { message: 'Số điện thoại không hợp lệ.' } });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({
        success: false,
        error: { message: 'Email này đã được sử dụng cho một tài khoản khác.' },
      });
    }

    let inviteToken = '';
    const staff = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          fullName,
          email,
          role: 'STAFF',
          provider: 'LOCAL',
          // Đối tác bảo lãnh nên coi email đã xác minh; chưa có mật khẩu cho tới
          // khi nhân viên kích hoạt qua email mời.
          isEmailVerified: true,
          passwordHash: null,
          employerPartnerId: req.partner.id,
          profile: { create: { phoneNumber } },
        },
        include: staffResponseInclude,
      });
      inviteToken = await createInviteToken(tx, created.id);

      await writeAuditLog({
        client: tx,
        req,
        actorId: req.user.id,
        action: 'PARTNER_STAFF_CREATED',
        entityType: 'User',
        entityId: created.id,
        metadata: { partnerId: req.partner.id, email },
      });

      return created;
    });

    try {
      await sendStaffInviteEmail({
        to: email,
        fullName,
        businessName: req.partner.businessName,
        token: inviteToken,
      });
    } catch (emailError) {
      console.error('[partner-staff] Không thể gửi email mời:', emailError.message);
    }

    return res.status(201).json({ success: true, data: toStaffResponse(staff) });
  } catch (error) {
    return next(error);
  }
}

// POST /api/partners/staff/:staffId/invite — gửi lại email mời cho nhân viên chưa kích hoạt.
async function resendStaffInvite(req, res, next) {
  try {
    const staff = await findOwnedStaff(prisma, req.partner.id, req.params.staffId);
    if (!staff) {
      return res.status(404).json({ success: false, error: { message: 'Không tìm thấy nhân viên.' } });
    }
    if (staff.passwordHash) {
      return res.status(409).json({
        success: false,
        error: { message: 'Nhân viên này đã kích hoạt tài khoản.' },
      });
    }

    const inviteToken = await prisma.$transaction((tx) => createInviteToken(tx, staff.id));
    try {
      await sendStaffInviteEmail({
        to: staff.email,
        fullName: staff.fullName,
        businessName: req.partner.businessName,
        token: inviteToken,
      });
    } catch (emailError) {
      console.error('[partner-staff] Không thể gửi lại email mời:', emailError.message);
    }

    return res.json({ success: true, message: 'Đã gửi lại email mời.' });
  } catch (error) {
    return next(error);
  }
}

// PATCH /api/partners/staff/:staffId/status — khóa / mở khóa nhân viên.
async function changeStaffStatus(req, res, next) {
  try {
    const status = String(req.body.status || '').trim().toUpperCase();
    if (!ALLOWED_STAFF_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        error: { message: 'Trạng thái phải là ACTIVE hoặc LOCKED.' },
      });
    }

    const staff = await findOwnedStaff(prisma, req.partner.id, req.params.staffId);
    if (!staff) {
      return res.status(404).json({ success: false, error: { message: 'Không tìm thấy nhân viên.' } });
    }

    if (staff.status !== status) {
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: staff.id },
          // Khi khóa: tăng tokenVersion để vô hiệu token JWT đang dùng.
          data: status === 'LOCKED' ? { status, tokenVersion: { increment: 1 } } : { status },
        });
        if (status === 'LOCKED') {
          await tx.authSession.updateMany({
            where: { userId: staff.id, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }
        await writeAuditLog({
          client: tx,
          req,
          actorId: req.user.id,
          action: status === 'LOCKED' ? 'PARTNER_STAFF_LOCKED' : 'PARTNER_STAFF_UNLOCKED',
          entityType: 'User',
          entityId: staff.id,
          metadata: { partnerId: req.partner.id },
        });
      });

      try {
        await sendAccountStatusEmail({ to: staff.email, fullName: staff.fullName, status });
      } catch (emailError) {
        console.error('[partner-staff] Không thể gửi email trạng thái:', emailError.message);
      }
    }

    const fresh = await findOwnedStaff(prisma, req.partner.id, staff.id);
    return res.json({ success: true, data: toStaffResponse(fresh) });
  } catch (error) {
    return next(error);
  }
}

// GET /api/partners/staff/:staffId/assignments — phân công hiện tại + danh sách địa điểm của đối tác.
async function getStaffAssignments(req, res, next) {
  try {
    const staff = await findOwnedStaff(prisma, req.partner.id, req.params.staffId);
    if (!staff) {
      return res.status(404).json({ success: false, error: { message: 'Không tìm thấy nhân viên.' } });
    }

    const attractions = await prisma.attraction.findMany({
      where: { partnerId: req.partner.id, archivedAt: null },
      orderBy: { title: 'asc' },
      select: { id: true, title: true, city: true, status: true, publicationStatus: true },
    });

    return res.json({
      success: true,
      data: {
        staff: toStaffResponse(staff),
        assignedAttractionIds: (staff.staffAssignments || []).map((a) => a.attractionId),
        attractions,
      },
    });
  } catch (error) {
    return next(error);
  }
}

// PUT /api/partners/staff/:staffId/assignments — thay toàn bộ phân công địa điểm cho nhân viên.
async function replaceStaffAssignments(req, res, next) {
  try {
    const attractionIds = Array.isArray(req.body?.attractionIds)
      ? [...new Set(req.body.attractionIds.map((id) => String(id).trim()).filter(Boolean))]
      : null;
    if (!attractionIds) {
      return res.status(400).json({
        success: false,
        error: { message: 'attractionIds phải là một mảng.' },
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      // Lớp 1: nhân viên phải thuộc đối tác này.
      const staff = await findOwnedStaff(tx, req.partner.id, req.params.staffId, { staffAssignments: false });
      if (!staff) {
        throw httpError(404, 'Không tìm thấy nhân viên.');
      }

      // Lớp 2: MỌI địa điểm phải thuộc chính đối tác này (và chưa lưu trữ).
      if (attractionIds.length > 0) {
        const ownedCount = await tx.attraction.count({
          where: { id: { in: attractionIds }, partnerId: req.partner.id, archivedAt: null },
        });
        if (ownedCount !== attractionIds.length) {
          throw httpError(400, 'Có địa điểm không thuộc về bạn hoặc không tồn tại.');
        }
      }

      // Thu hồi các phân công không còn trong danh sách mới.
      await tx.staffAttractionAssignment.updateMany({
        where: {
          staffId: staff.id,
          revokedAt: null,
          attractionId: { notIn: attractionIds.length > 0 ? attractionIds : ['__none__'] },
        },
        data: { revokedAt: new Date() },
      });

      // Tạo mới hoặc khôi phục phân công.
      for (const attractionId of attractionIds) {
        await tx.staffAttractionAssignment.upsert({
          where: { staffId_attractionId: { staffId: staff.id, attractionId } },
          update: { revokedAt: null, createdById: req.user.id },
          create: { staffId: staff.id, attractionId, createdById: req.user.id },
        });
      }

      await writeAuditLog({
        client: tx,
        req,
        actorId: req.user.id,
        action: 'PARTNER_STAFF_ASSIGNMENTS_REPLACED',
        entityType: 'User',
        entityId: staff.id,
        metadata: { partnerId: req.partner.id, attractionIds },
      });

      return staff.id;
    });

    return res.json({ success: true, data: { staffId: result, attractionIds } });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, error: { message: error.message } });
    }
    return next(error);
  }
}

// DELETE /api/partners/staff/:staffId — gỡ nhân viên khỏi công ty (khóa + thu hồi mọi phân công).
// Không xóa cứng để giữ lịch sử check-in.
async function removeStaff(req, res, next) {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const staff = await findOwnedStaff(tx, req.partner.id, req.params.staffId, { staffAssignments: false });
      if (!staff) {
        throw httpError(404, 'Không tìm thấy nhân viên.');
      }

      await tx.staffAttractionAssignment.updateMany({
        where: { staffId: staff.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.user.update({
        where: { id: staff.id },
        data: { status: 'LOCKED', tokenVersion: { increment: 1 } },
      });
      await tx.authSession.updateMany({
        where: { userId: staff.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await writeAuditLog({
        client: tx,
        req,
        actorId: req.user.id,
        action: 'PARTNER_STAFF_REMOVED',
        entityType: 'User',
        entityId: staff.id,
        metadata: { partnerId: req.partner.id },
      });

      return staff.id;
    });

    return res.json({ success: true, data: { staffId: result } });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, error: { message: error.message } });
    }
    return next(error);
  }
}

module.exports = {
  listStaff,
  createStaff,
  resendStaffInvite,
  changeStaffStatus,
  getStaffAssignments,
  replaceStaffAssignments,
  removeStaff,
};
