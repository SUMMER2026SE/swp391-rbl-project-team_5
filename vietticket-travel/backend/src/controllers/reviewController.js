'use strict';

const prisma = require('../config/prisma');
const { isPlatformStaff } = require('../middleware/roleMiddleware');
const { isReviewEligible } = require('../utils/reviewEligibility');
const { writeAuditLog } = require('../utils/auditLog');

// Helper function to recalculate average rating and total reviews for an attraction
async function recalculateAttractionRating(tx, attractionId) {
  const activeReviews = await tx.review.findMany({
    where: {
      attractionId,
      isHidden: false,
    },
    select: {
      rating: true,
    },
  });

  const totalReviews = activeReviews.length;
  let averageRating = 0;
  if (totalReviews > 0) {
    const sum = activeReviews.reduce((acc, curr) => acc + curr.rating, 0);
    averageRating = parseFloat((sum / totalReviews).toFixed(1));
  }

  await tx.attraction.update({
    where: { id: attractionId },
    data: {
      averageRating,
      totalReviews,
    },
  });
}

// 1. GET /api/reviews?attractionId=...&page=1&limit=6&rating=5
// Trả về 1 trang review công khai + meta phân trang + phân bố số sao (histogram).
async function listPublicReviews(req, res, next) {
  try {
    const { attractionId } = req.query;
    if (!attractionId) {
      return res.status(400).json({ message: 'Thiếu attractionId.' });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 6));
    const ratingFilter = parseInt(req.query.rating, 10);
    const hasRatingFilter = !isNaN(ratingFilter) && ratingFilter >= 1 && ratingFilter <= 5;

    const baseWhere = { attractionId, isHidden: false };
    const where = hasRatingFilter ? { ...baseWhere, rating: ratingFilter } : baseWhere;

    const [total, grouped, reviews] = await Promise.all([
      prisma.review.count({ where }),
      // Phân bố sao tính trên TOÀN BỘ review hiển thị (không theo filter trang).
      prisma.review.groupBy({
        by: ['rating'],
        where: baseWhere,
        _count: { rating: true },
      }),
      prisma.review.findMany({
        where,
        include: {
          user: {
            select: {
              fullName: true,
              profile: {
                select: {
                  avatarUrl: true,
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    grouped.forEach((g) => {
      breakdown[g.rating] = g._count.rating;
    });

    return res.json({
      success: true,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
      breakdown,
      data: reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        replyComment: r.replyComment,
        repliedAt: r.repliedAt,
        createdAt: r.createdAt,
        user: {
          fullName: r.user.fullName,
          profile: {
            avatarUrl: r.user.profile?.avatarUrl || null,
          },
        },
      })),
    });
  } catch (error) {
    return next(error);
  }
}

// 2. POST /api/reviews
async function createReview(req, res, next) {
  try {
    const userId = req.user.id;
    const { bookingId, rating, comment } = req.body;

    if (!bookingId || !rating) {
      return res.status(400).json({ message: 'Mã đặt chỗ (bookingId) và số sao (rating) là bắt buộc.' });
    }

    const parsedRating = parseInt(rating);
    if (isNaN(parsedRating) || parsedRating < 1 || parsedRating > 5) {
      return res.status(400).json({ message: 'Số sao đánh giá không hợp lệ (phải từ 1 đến 5).' });
    }

    const trimmedComment = String(comment || '').trim();
    if (trimmedComment.length > 2000) {
      return res.status(400).json({ message: 'Nhận xét tối đa 2000 ký tự.' });
    }

    // Find booking
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        review: true,
        ticketInstances: { select: { status: true } },
        reservation: {
          include: {
            ticketProduct: true,
            timeSlot: { select: { endTime: true } }, // cần để tính giờ kết thúc tham quan
          },
        },
      },
    });

    // Validations
    if (!booking || booking.isForecastTrainingSample || booking.userId !== userId) {
      return res.status(404).json({ message: 'Không tìm thấy đơn đặt vé của bạn.' });
    }

    // SRS quy định chỉ booking COMPLETED mới được đánh giá.
    const eligibility = isReviewEligible(booking);
    if (!eligibility.allowed) {
      return res.status(400).json({ message: eligibility.reason });
    }

    if (booking.review) {
      return res.status(400).json({ message: 'Đơn đặt vé này đã được đánh giá trước đó.' });
    }

    const attractionId = booking.reservation.ticketProduct.attractionId;

    // Create review and update rating in a transaction
    const review = await prisma.$transaction(async (tx) => {
      const created = await tx.review.create({
        data: {
          userId,
          attractionId,
          bookingId,
          rating: parsedRating,
          comment: trimmedComment,
          isHidden: false,
        },
      });

      await recalculateAttractionRating(tx, attractionId);
      return created;
    });

    return res.status(201).json({
      success: true,
      message: 'Gửi đánh giá thành công!',
      data: review,
    });
  } catch (error) {
    // Race hiếm: 2 request cùng lúc vượt qua check phía trên -> unique(bookingId) chặn.
    if (error.code === 'P2002') {
      return res.status(409).json({ message: 'Đơn đặt vé này đã được đánh giá trước đó.' });
    }
    return next(error);
  }
}

// 3. POST /api/reviews/:reviewId/reply
async function replyReview(req, res, next) {
  try {
    const { reviewId } = req.params;
    const { replyComment } = req.body;

    if (!replyComment || !replyComment.trim()) {
      return res.status(400).json({ message: 'Nội dung phản hồi không được để trống.' });
    }
    if (replyComment.trim().length > 2000) {
      return res.status(400).json({ message: 'Nội dung phản hồi tối đa 2000 ký tự.' });
    }

    // Fetch review
    const review = await prisma.review.findUnique({
      where: { id: reviewId },
      include: {
        attraction: true,
      },
    });

    if (!review) {
      return res.status(404).json({ message: 'Không tìm thấy đánh giá.' });
    }

    // req.partner do middleware requirePartner nạp sẵn; fallback tự truy vấn
    // để controller vẫn dùng được ở nơi không gắn middleware.
    const partnerProfile =
      req.partner ||
      (await prisma.partnerProfile.findUnique({
        where: { userId: req.user.id },
      }));

    if (!partnerProfile || review.attraction.partnerId !== partnerProfile.id) {
      return res.status(403).json({ message: 'Bạn không có quyền phản hồi đánh giá này.' });
    }

    const updated = await prisma.review.update({
      where: { id: reviewId },
      data: {
        replyComment: replyComment.trim(),
        repliedAt: new Date(),
      },
    });

    return res.json({
      success: true,
      message: 'Đã phản hồi đánh giá thành công.',
      data: updated,
    });
  } catch (error) {
    return next(error);
  }
}

// 4. PATCH /api/reviews/:reviewId/moderate
async function moderateReview(req, res, next) {
  try {
    if (!isPlatformStaff(req.user)) {
      return res.status(403).json({
        message: 'Chỉ nhân viên nội bộ của nền tảng mới có quyền kiểm duyệt đánh giá.',
        code: 'PLATFORM_STAFF_REQUIRED',
      });
    }

    const { reviewId } = req.params;
    const { isHidden } = req.body;
    const reason = String(req.body?.reason || '').trim();

    if (typeof isHidden !== 'boolean') {
      return res.status(400).json({ message: 'Trạng thái isHidden phải là boolean.' });
    }
    if (reason.length < 10 || reason.length > 500) {
      return res.status(400).json({ message: 'Lý do kiểm duyệt phải từ 10 đến 500 ký tự.' });
    }

    const review = await prisma.review.findUnique({
      where: { id: reviewId },
    });

    if (!review) {
      return res.status(404).json({ message: 'Không tìm thấy đánh giá.' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const mod = await tx.review.update({
        where: { id: reviewId },
        data: {
          isHidden,
          moderationReason: reason,
          moderatedAt: new Date(),
          moderatedById: req.user.id,
        },
      });

      await recalculateAttractionRating(tx, review.attractionId);
      await writeAuditLog({
        client: tx,
        req,
        action: isHidden ? 'REVIEW_HIDDEN' : 'REVIEW_RESTORED',
        entityType: 'Review',
        entityId: reviewId,
        metadata: {
          reason,
          attractionId: review.attractionId,
          previousHiddenStatus: review.isHidden,
        },
      });
      return mod;
    });

    return res.json({
      success: true,
      message: updated.isHidden ? 'Đã ẩn đánh giá.' : 'Đã hiển thị lại đánh giá.',
      data: updated,
    });
  } catch (error) {
    return next(error);
  }
}

// 5. GET /api/partners/reviews
async function listPartnerReviews(req, res, next) {
  try {
    const partnerProfile = await prisma.partnerProfile.findUnique({
      where: { userId: req.user.id },
    });

    if (!partnerProfile) {
      return res.status(403).json({ message: 'Tài khoản không phải đối tác.' });
    }

    const reviews = await prisma.review.findMany({
      where: {
        attraction: {
          partnerId: partnerProfile.id,
        },
      },
      include: {
        attraction: {
          select: {
            title: true,
          },
        },
        user: {
          select: {
            fullName: true,
            profile: {
              select: {
                avatarUrl: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return res.json({
      success: true,
      data: reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        replyComment: r.replyComment,
        repliedAt: r.repliedAt,
        isHidden: r.isHidden,
        createdAt: r.createdAt,
        user: {
          fullName: r.user.fullName,
          profile: {
            avatarUrl: r.user.profile?.avatarUrl || null,
          },
        },
        attraction: {
          title: r.attraction.title,
        },
      })),
    });
  } catch (error) {
    return next(error);
  }
}

// 6. GET /api/partners/reviews/stats
async function getPartnerReviewStats(req, res, next) {
  try {
    const partnerProfile = await prisma.partnerProfile.findUnique({
      where: { userId: req.user.id },
    });

    if (!partnerProfile) {
      return res.status(403).json({ message: 'Tài khoản không phải đối tác.' });
    }

    const reviews = await prisma.review.findMany({
      where: {
        attraction: {
          partnerId: partnerProfile.id,
        },
      },
    });

    const totalReviews = reviews.length;
    const unrepliedReviews = reviews.filter((r) => !r.replyComment).length;

    const activeReviews = reviews.filter((r) => !r.isHidden);
    let averageRating = 0.0;
    if (activeReviews.length > 0) {
      const sum = activeReviews.reduce((acc, curr) => acc + curr.rating, 0);
      averageRating = parseFloat((sum / activeReviews.length).toFixed(1));
    }

    return res.json({
      success: true,
      data: {
        averageRating,
        totalReviews,
        unrepliedReviews,
      },
    });
  } catch (error) {
    return next(error);
  }
}

// 7. GET /api/admin/reviews
async function listAdminReviews(req, res, next) {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
    const search = String(req.query.search || '').trim().slice(0, 200);
    const rawRating = String(req.query.rating || '').trim();
    const rating = Number.parseInt(rawRating, 10);

    if (rawRating && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Rating must be an integer from 1 to 5' },
      });
    }

    const where = {};
    if (rawRating) where.rating = rating;
    if (search) {
      where.OR = [
        { comment: { contains: search, mode: 'insensitive' } },
        { user: { fullName: { contains: search, mode: 'insensitive' } } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
        { attraction: { title: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [totalResult, statusGroupsResult, reviews] = await Promise.all([
      prisma.review.count({ where }),
      prisma.review.groupBy({
        by: ['isHidden'],
        _count: { _all: true },
      }),
      prisma.review.findMany({
        where,
        include: {
          attraction: {
            select: {
              title: true,
            },
          },
          user: {
            select: {
              fullName: true,
              email: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const safeReviews = Array.isArray(reviews) ? reviews : [];
    const total = Number.isFinite(totalResult) ? totalResult : safeReviews.length;
    const statusGroups = Array.isArray(statusGroupsResult) ? statusGroupsResult : [];
    const visible = statusGroups
      .filter((group) => !group.isHidden)
      .reduce((sum, group) => sum + Number(group?._count?._all || 0), 0);
    const hidden = statusGroups
      .filter((group) => group.isHidden)
      .reduce((sum, group) => sum + Number(group?._count?._all || 0), 0);

    return res.json({
      success: true,
      data: safeReviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        replyComment: r.replyComment,
        repliedAt: r.repliedAt,
        isHidden: r.isHidden,
        moderationReason: r.moderationReason,
        moderatedAt: r.moderatedAt,
        moderatedById: r.moderatedById,
        createdAt: r.createdAt,
        user: {
          fullName: r.user?.fullName || '',
          email: r.user?.email || '',
        },
        attraction: {
          title: r.attraction?.title || '',
        },
      })),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
      stats: {
        total: visible + hidden,
        visible,
        hidden,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listPublicReviews,
  createReview,
  replyReview,
  moderateReview,
  listPartnerReviews,
  getPartnerReviewStats,
  listAdminReviews,
};
