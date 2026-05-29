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

module.exports = {
  sendPasswordResetEmail,
  sendVerificationEmail,
};
