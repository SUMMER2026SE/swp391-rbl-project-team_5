const prisma = require('../config/prisma');

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

module.exports = { subscribe };
