// Tiện ích DEV: xác minh email cho tài khoản (bỏ qua SMTP khi test cục bộ).
// Dùng: node verify-user.js <email>
const prisma = require('./src/config/prisma');

(async () => {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  if (!email) {
    console.log('Cách dùng: node verify-user.js <email>');
    process.exit(1);
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.log(`Không tìm thấy tài khoản: ${email}`);
    process.exit(0);
  }
  await prisma.user.update({
    where: { email },
    data: { isEmailVerified: true, status: 'ACTIVE' },
  });
  await prisma.emailVerificationToken.deleteMany({ where: { userId: user.id } });
  console.log(`✓ Đã xác minh email cho ${email} (role=${user.role}). Có thể đăng nhập ngay.`);
  process.exit(0);
})().catch((e) => {
  console.error('Lỗi:', e.message);
  process.exit(1);
});
