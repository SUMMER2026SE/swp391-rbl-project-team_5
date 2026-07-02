// Tiện ích DEV: xác minh email cho tài khoản (bỏ qua SMTP khi test cục bộ).
// Dùng: ALLOW_VERIFY_USER=1 node verify-user.js <email>
//
// ⚠️ Script này BỎ QUA toàn bộ xác thực — bất kỳ ai chạy được đều có thể tự
// verify email của tài khoản khác. Chỉ dùng ở môi trường phát triển.
const prisma = require('./src/config/prisma');

// Bảo vệ theo mô hình "mặc định từ chối" (không phụ thuộc việc prod có set
// NODE_ENV hay không):
// 1) Chặn cứng nếu NODE_ENV=production.
// 2) Bắt buộc opt-in tường minh qua ALLOW_VERIFY_USER=1 -> chạy nhầm ở bất kỳ
//    môi trường nào (kể cả khi NODE_ENV chưa set) đều bị từ chối.
if (process.env.NODE_ENV === 'production') {
  console.error('⛔ KHÔNG chạy script verify-user.js ở môi trường production!');
  process.exit(1);
}
if (process.env.ALLOW_VERIFY_USER !== '1') {
  console.error(
    '⛔ Script này bị khóa mặc định. Nếu chắc chắn đang ở môi trường dev, chạy lại với:\n'
    + '   ALLOW_VERIFY_USER=1 node verify-user.js <email>',
  );
  process.exit(1);
}

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
