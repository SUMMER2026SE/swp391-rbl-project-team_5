const prisma = require('../config/prisma');
const {
  createNewsletterUnsubscribeToken,
  verifyNewsletterUnsubscribeToken,
} = require('../utils/newsletterToken');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function subscribe(req, res, next) {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email) || email.length > 254) {
      return res.status(400).json({ message: 'Địa chỉ email không hợp lệ.' });
    }

    await prisma.newsletterSubscription.upsert({
      where: { email },
      create: { email },
      update: { isActive: true, subscribedAt: new Date() },
    });

    return res.status(200).json({
      message: 'Đăng ký nhận tin thành công. Cảm ơn bạn đã đồng hành cùng VietTicket.',
    });
  } catch (error) {
    return next(error);
  }
}

async function unsubscribe(req, res, next) {
  try {
    const verified = verifyNewsletterUnsubscribeToken(
      req.body?.token || req.query?.token,
    );
    if (!verified) {
      return res.status(400).json({
        message: 'Liên kết hủy nhận tin không hợp lệ hoặc đã hết hạn.',
      });
    }

    await prisma.newsletterSubscription.updateMany({
      where: { email: verified.email, isActive: true },
      data: { isActive: false },
    });

    return res.status(200).json({
      message: 'Đã ghi nhận yêu cầu hủy nhận tin cho địa chỉ email này.',
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createNewsletterUnsubscribeToken,
  subscribe,
  unsubscribe,
};
