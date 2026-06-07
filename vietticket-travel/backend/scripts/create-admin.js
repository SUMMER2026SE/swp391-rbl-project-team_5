const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  const email = 'admin@vietticket.com';
  const password = 'AdminPassword123@';
  const fullName = 'Hệ Thống Admin';

  console.log(`Đang kiểm tra tài khoản: ${email}...`);

  const existing = await prisma.user.findUnique({
    where: { email },
  });

  if (existing) {
    console.log(`Tài khoản ${email} đã tồn tại trên hệ thống.`);
    if (existing.role !== 'ADMIN') {
      console.log('Đang cập nhật vai trò tài khoản thành ADMIN...');
      await prisma.user.update({
        where: { email },
        data: { role: 'ADMIN', isEmailVerified: true },
      });
      console.log('Cập nhật vai trò thành công!');
    } else {
      console.log('Tài khoản đã có vai trò ADMIN.');
    }
    return;
  }

  console.log('Đang mã hóa mật khẩu...');
  const passwordHash = await bcrypt.hash(password, 10);

  console.log('Đang tạo tài khoản ADMIN mới...');
  await prisma.user.create({
    data: {
      email,
      passwordHash,
      fullName,
      role: 'ADMIN',
      isEmailVerified: true,
      status: 'ACTIVE',
      profile: {
        create: {
          avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=128&h=128&q=80',
        },
      },
    },
  });

  console.log(`====================================================`);
  console.log(`Tạo tài khoản ADMIN thành công!`);
  console.log(`Email: ${email}`);
  console.log(`Mật khẩu: ${password}`);
  console.log(`====================================================`);
}

main()
  .catch((e) => {
    console.error('Lỗi khi tạo admin:', e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
