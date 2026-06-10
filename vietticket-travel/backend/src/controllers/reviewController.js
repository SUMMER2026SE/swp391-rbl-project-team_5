'use strict';

const prisma = require('../config/prisma');

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

// 1. GET /api/reviews?attractionId=...
async function listPublicReviews(req, res, next) {
  try {
    const { attractionId } = req.query;
    if (!attractionId) {
      return res.status(400).json({ message: 'Thiếu attractionId.' });
    }

    const reviews = await prisma.review.findMany({
      where: {
        attractionId,
        isHidden: false,
      },
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
    });

    return res.json({
      success: true,
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

    // Find booking
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        review: true,
        reservation: {
          include: {
            ticketProduct: true,
          },
        },
      },
    });

    // Validations
    if (!booking || booking.userId !== userId) {
      return res.status(404).json({ message: 'Không tìm thấy đơn đặt vé của bạn.' });
    }

    if (booking.status.toUpperCase() !== 'COMPLETED') {
      return res.status(400).json({ message: 'Bạn chỉ được đánh giá cho đơn đặt vé đã hoàn thành (COMPLETED).' });
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
          comment: comment || '',
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

    // Fetch partner profile of the user
    const partnerProfile = await prisma.partnerProfile.findUnique({
      where: { userId: req.user.id },
    });

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
    const { reviewId } = req.params;
    const { isHidden } = req.body;

    if (isHidden === undefined) {
      return res.status(400).json({ message: 'Thiếu trạng thái isHidden.' });
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
          isHidden: Boolean(isHidden),
        },
      });

      await recalculateAttractionRating(tx, review.attractionId);
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
    const reviews = await prisma.review.findMany({
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
          email: r.user.email,
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

module.exports = {
  listPublicReviews,
  createReview,
  replyReview,
  moderateReview,
  listPartnerReviews,
  getPartnerReviewStats,
  listAdminReviews,
};
