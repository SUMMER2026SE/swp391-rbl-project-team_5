const nodemailer = require('nodemailer');

function hasSmtpConfig() {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_PORT &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      process.env.MAIL_FROM,
  );
}

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function createEmailTemplate({ title, preview, buttonText, link }) {
  return `
    <div style="margin:0;padding:32px;background:#f9f6f2;font-family:Arial,sans-serif;color:#113336;">
      <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:20px;overflow:hidden;border:1px solid #eaded2;">
        <div style="padding:28px 32px;background:#006068;color:#fff;">
          <h1 style="margin:0;font-size:24px;">VietTicket Travel</h1>
          <p style="margin:8px 0 0;color:#d8f3f5;">Vé tham quan Việt Nam nhanh chóng và an toàn</p>
        </div>
        <div style="padding:32px;">
          <h2 style="margin:0 0 12px;color:#123438;font-size:22px;">${title}</h2>
          <p style="margin:0 0 24px;line-height:1.6;color:#516164;">${preview}</p>
          <a href="${link}" style="display:inline-block;background:#006068;color:#fff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:999px;">
            ${buttonText}
          </a>
          <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#6f7f82;">
            Nếu nút không hoạt động, hãy sao chép liên kết này vào trình duyệt:<br />
            <span style="word-break:break-all;color:#006068;">${link}</span>
          </p>
        </div>
      </div>
    </div>
  `;
}

async function sendMail({ to, subject, html, text, fallbackLink }) {
  if (!hasSmtpConfig()) {
    console.log(`[VietTicket Travel] SMTP chưa cấu hình. Link demo cho ${to}: ${fallbackLink}`);
    return { sent: false, reason: 'SMTP_NOT_CONFIGURED' };
  }

  const transporter = createTransporter();

  await transporter.sendMail({
    from: process.env.MAIL_FROM,
    to,
    subject,
    text,
    html,
  });

  return { sent: true };
}

async function sendVerificationEmail({ to, token }) {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const link = `${frontendUrl}/verify-email?token=${encodeURIComponent(token)}`;

  return sendMail({
    to,
    subject: 'Xác minh email VietTicket Travel',
    text: `Xác minh email của bạn tại: ${link}`,
    fallbackLink: link,
    html: createEmailTemplate({
      title: 'Xác minh email của bạn',
      preview: 'Cảm ơn bạn đã đăng ký VietTicket Travel. Hãy xác minh email để bắt đầu đặt vé tham quan.',
      buttonText: 'Xác minh email',
      link,
    }),
  });
}

async function sendPasswordResetEmail({ to, token }) {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const link = `${frontendUrl}/reset-password?token=${encodeURIComponent(token)}`;

  return sendMail({
    to,
    subject: 'Đặt lại mật khẩu VietTicket Travel',
    text: `Đặt lại mật khẩu của bạn tại: ${link}`,
    fallbackLink: link,
    html: createEmailTemplate({
      title: 'Đặt lại mật khẩu',
      preview: 'Chúng tôi nhận được yêu cầu đặt lại mật khẩu. Liên kết này sẽ hết hạn sau một khoảng thời gian ngắn.',
      buttonText: 'Đặt lại mật khẩu',
      link,
    }),
  });
}

async function sendAccountStatusEmail({ to, fullName, status, reason }) {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const loginLink = `${frontendUrl}/login`;
  const safeFullName = escapeHtml(fullName || 'bạn');
  const safeReason = escapeHtml(reason || 'Không có lý do cụ thể.');

  if (status === 'LOCKED') {
    return sendMail({
      to,
      subject: 'Tài khoản của bạn đã bị khóa - VietTicket Travel',
      text: `Xin chào ${fullName || 'bạn'}, tài khoản VietTicket Travel của bạn đã bị khóa. Lý do: ${reason || 'Không có lý do cụ thể.'}`,
      fallbackLink: loginLink,
      html: createEmailTemplate({
        title: 'Tài khoản của bạn đã bị khóa',
        preview: `Xin chào ${safeFullName}, tài khoản VietTicket Travel của bạn đã bị khóa bởi quản trị viên.<br /><br /><strong>Lý do:</strong> ${safeReason}`,
        buttonText: 'Truy cập VietTicket',
        link: loginLink,
      }),
    });
  }

  if (status === 'ACTIVE') {
    return sendMail({
      to,
      subject: 'Tài khoản của bạn đã được kích hoạt lại - VietTicket Travel',
      text: `Xin chào ${fullName || 'bạn'}, tài khoản VietTicket Travel của bạn đã được kích hoạt lại. Bạn có thể đăng nhập và tiếp tục sử dụng dịch vụ.`,
      fallbackLink: loginLink,
      html: createEmailTemplate({
        title: 'Tài khoản đã được kích hoạt lại',
        preview: `Xin chào ${safeFullName}, tài khoản VietTicket Travel của bạn hiện đã hoạt động trở lại. Bạn có thể đăng nhập và tiếp tục sử dụng dịch vụ.`,
        buttonText: 'Đăng nhập ngay',
        link: loginLink,
      }),
    });
  }

  return { sent: false, reason: 'UNSUPPORTED_ACCOUNT_STATUS' };
}

module.exports = {
  sendAccountStatusEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
};

async function sendPartnerReviewEmail({ to, businessName, action, rejectionReason }) {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const safeBusiness = escapeHtml(businessName || 'Đối tác');
  if (action === 'APPROVED') {
    const link = `${frontendUrl}/partner/dashboard`;
    return sendMail({
      to,
      subject: 'Hồ sơ đối tác đã được duyệt - VietTicket Travel',
      text: `Hồ sơ đối tác ${businessName} đã được duyệt. Truy cập: ${link}`,
      fallbackLink: link,
      html: createEmailTemplate({
        title: 'Hồ sơ đối tác đã được duyệt',
        preview: `Chúc mừng ${safeBusiness}, hồ sơ đối tác của bạn đã được chấp thuận.`,
        buttonText: 'Vào trang đối tác',
        link,
      }),
    });
  }

  if (action === 'REJECTED') {
    const link = `${frontendUrl}/`;
    const safeReason = escapeHtml(rejectionReason || 'Không có lý do cụ thể.');
    return sendMail({
      to,
      subject: 'Hồ sơ đối tác bị từ chối - VietTicket Travel',
      text: `Hồ sơ đối tác ${businessName} bị từ chối. Lý do: ${rejectionReason}`,
      fallbackLink: link,
      html: createEmailTemplate({
        title: 'Hồ sơ đối tác bị từ chối',
        preview: `Xin chào ${safeBusiness}, hồ sơ đối tác của bạn không được chấp thuận.<br /><br /><strong>Lý do:</strong> ${safeReason}`,
        buttonText: 'Liên hệ hỗ trợ',
        link,
      }),
    });
  }

  return { sent: false, reason: 'INVALID_ACTION' };
}

async function sendAttractionViolationEmail({ to, partnerName, attractionTitle, reason }) {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const link = `${frontendUrl}/support`;
  const safePartner = escapeHtml(partnerName || 'Đối tác');
  const safeAttraction = escapeHtml(attractionTitle || 'địa điểm');
  const safeReason = escapeHtml(reason || 'Không có lý do cụ thể.');

  return sendMail({
    to,
    subject: `⚠️ Địa điểm của bạn đã bị tạm ẩn - ${safeAttraction}`,
    text: `Địa điểm ${attractionTitle} của bạn đã bị tạm ẩn. Lý do: ${reason}. Liên hệ: ${link}`,
    fallbackLink: link,
    html: createEmailTemplate({
      title: 'Địa điểm của bạn đã bị tạm ẩn',
      preview: `Xin chào ${safePartner}, địa điểm "${safeAttraction}" vi phạm chính sách. Lý do: ${safeReason}`,
      buttonText: 'Liên hệ hỗ trợ',
      link,
    }),
  });
}

module.exports = {
  sendAccountStatusEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
  sendPartnerReviewEmail,
  sendAttractionViolationEmail,
};
