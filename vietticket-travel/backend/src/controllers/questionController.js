'use strict';

const prisma = require('../config/prisma');
const { publicAttractionWhere } = require('../services/catalogVisibilityService');
const { writeAuditLog } = require('../utils/auditLog');
const { maskPublicName } = require('../utils/publicIdentity');

const AUTO_HIDE_REPORT_THRESHOLD = 3;
const DIRECT_CONTACT_PATTERN =
  /(?:[^\s@]+@[^\s@]+\.[^\s@]+)|(?:\+?\d[\d\s().-]{7,}\d)/iu;

function hasDirectContact(value) {
  return DIRECT_CONTACT_PATTERN.test(String(value || ''));
}

function serializeQuestion(item) {
  return {
    id: item.id,
    question: item.question,
    answer: item.answer || null,
    answeredAt: item.answeredAt || null,
    createdAt: item.createdAt,
    status: item.status || 'PUBLISHED',
    reportCount: Number(item.reportCount || 0),
    user: { fullName: maskPublicName(item.user?.fullName) },
    attraction: item.attraction
      ? { id: item.attraction.id, title: item.attraction.title }
      : undefined,
  };
}

async function listPublicQuestions(req, res, next) {
  try {
    const attractionId = String(req.query.attractionId || '').trim();
    if (!attractionId) return res.status(400).json({ message: 'Thiếu attractionId.' });
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
    const where = {
      attractionId,
      status: 'PUBLISHED',
      attraction: publicAttractionWhere(),
    };
    const [total, questions] = await Promise.all([
      prisma.attractionQuestion.count({ where }),
      prisma.attractionQuestion.findMany({
        where,
        include: { user: { select: { fullName: true } } },
        orderBy: [{ answeredAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return res.json({
      success: true,
      data: questions.map(serializeQuestion),
      meta: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error) {
    return next(error);
  }
}

async function createQuestion(req, res, next) {
  try {
    const attractionId = String(req.body?.attractionId || '').trim();
    const question = String(req.body?.question || '').trim().replace(/\s+/g, ' ');
    if (question.length < 10 || question.length > 1000) {
      return res.status(400).json({ message: 'Câu hỏi phải từ 10 đến 1.000 ký tự.' });
    }
    if (hasDirectContact(question)) {
      return res.status(400).json({
        message: 'Không đăng email hoặc số điện thoại trong Hỏi & đáp công khai. Vui lòng dùng Trung tâm hỗ trợ nếu cần trao đổi thông tin riêng.',
      });
    }
    const attraction = await prisma.attraction.findFirst({
      where: { id: attractionId, ...publicAttractionWhere() },
      select: { id: true },
    });
    if (!attraction) return res.status(404).json({ message: 'Không tìm thấy điểm tham quan.' });
    const created = await prisma.attractionQuestion.create({
      data: { attractionId, userId: req.user.id, question },
      include: { user: { select: { fullName: true } } },
    });
    return res.status(201).json({
      success: true,
      message: 'Đã gửi câu hỏi cho đối tác.',
      data: serializeQuestion(created),
    });
  } catch (error) {
    return next(error);
  }
}

async function listPartnerQuestions(req, res, next) {
  try {
    const questions = await prisma.attractionQuestion.findMany({
      where: { attraction: { partnerId: req.partner.id } },
      include: {
        user: { select: { fullName: true } },
        attraction: { select: { id: true, title: true } },
      },
      orderBy: [{ answeredAt: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    });
    return res.json({ success: true, data: questions.map(serializeQuestion) });
  } catch (error) {
    return next(error);
  }
}

async function answerQuestion(req, res, next) {
  try {
    const answer = String(req.body?.answer || '').trim();
    if (answer.length < 5 || answer.length > 2000) {
      return res.status(400).json({ message: 'Câu trả lời phải từ 5 đến 2.000 ký tự.' });
    }
    if (hasDirectContact(answer)) {
      return res.status(400).json({
        message: 'Không đăng email hoặc số điện thoại trong câu trả lời công khai.',
      });
    }
    const question = await prisma.attractionQuestion.findFirst({
      where: {
        id: String(req.params.questionId || ''),
        status: 'PUBLISHED',
        attraction: { partnerId: req.partner.id },
      },
      select: { id: true },
    });
    if (!question) return res.status(404).json({ message: 'Không tìm thấy câu hỏi.' });
    const updated = await prisma.attractionQuestion.update({
      where: { id: question.id },
      data: { answer, answeredById: req.user.id, answeredAt: new Date() },
    });
    return res.json({
      success: true,
      message: 'Đã đăng câu trả lời.',
      data: serializeQuestion(updated),
    });
  } catch (error) {
    return next(error);
  }
}

async function reportQuestion(req, res, next) {
  try {
    const questionId = String(req.params.questionId || '').trim();
    const reason = String(req.body?.reason || '').trim();
    if (reason.length > 500) {
      return res.status(400).json({ message: 'Lý do báo cáo tối đa 500 ký tự.' });
    }

    const question = await prisma.attractionQuestion.findFirst({
      where: { id: questionId, status: 'PUBLISHED' },
      select: { id: true, userId: true },
    });
    if (!question) {
      return res.status(404).json({ message: 'Không tìm thấy câu hỏi công khai.' });
    }
    if (question.userId === req.user.id) {
      return res.status(409).json({ message: 'Bạn không thể tự báo cáo câu hỏi của mình.' });
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.attractionQuestionReport.create({
        data: {
          questionId,
          userId: req.user.id,
          reason: reason || null,
        },
      });
      const reportCount = await tx.attractionQuestionReport.count({
        where: { questionId },
      });
      const hidden = reportCount >= AUTO_HIDE_REPORT_THRESHOLD;
      await tx.attractionQuestion.update({
        where: { id: questionId },
        data: {
          reportCount,
          ...(hidden
            ? {
                status: 'HIDDEN',
                moderationReason: 'Tự động ẩn vì nhận nhiều báo cáo độc lập.',
                moderatedAt: new Date(),
              }
            : {}),
        },
      });
      return { reportCount, hidden };
    });

    return res.status(201).json({
      success: true,
      message: result.hidden
        ? 'Câu hỏi đã được tạm ẩn để quản trị viên kiểm tra.'
        : 'Đã ghi nhận báo cáo của bạn.',
      data: result,
    });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ message: 'Bạn đã báo cáo câu hỏi này trước đó.' });
    }
    return next(error);
  }
}

async function moderateQuestion(req, res, next) {
  try {
    const questionId = String(req.params.questionId || '').trim();
    const status = String(req.body?.status || '').trim().toUpperCase();
    const reason = String(req.body?.reason || '').trim();
    if (!['PUBLISHED', 'HIDDEN'].includes(status)) {
      return res.status(400).json({ message: 'Trạng thái kiểm duyệt không hợp lệ.' });
    }
    if (status === 'HIDDEN' && reason.length < 5) {
      return res.status(400).json({ message: 'Cần nhập lý do ẩn câu hỏi (ít nhất 5 ký tự).' });
    }
    const current = await prisma.attractionQuestion.findUnique({
      where: { id: questionId },
    });
    if (!current) return res.status(404).json({ message: 'Không tìm thấy câu hỏi.' });

    const updated = await prisma.$transaction(async (tx) => {
      const item = await tx.attractionQuestion.update({
        where: { id: questionId },
        data: {
          status,
          moderationReason: status === 'HIDDEN' ? reason : null,
          moderatedAt: new Date(),
        },
      });
      await writeAuditLog({
        client: tx,
        req,
        action: status === 'HIDDEN' ? 'QUESTION_HIDDEN' : 'QUESTION_RESTORED',
        entityType: 'ATTRACTION_QUESTION',
        entityId: questionId,
        metadata: {
          previousStatus: current.status,
          status,
          reason: status === 'HIDDEN' ? reason : null,
        },
      });
      return item;
    });
    return res.json({ success: true, data: serializeQuestion(updated) });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  answerQuestion,
  createQuestion,
  listPartnerQuestions,
  listPublicQuestions,
  moderateQuestion,
  reportQuestion,
};
