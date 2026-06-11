'use strict';

const bcrypt = require('bcrypt');
const prisma = require('./src/config/prisma');

const ACCOUNTS = [
  {
    email: 'staff@vietticket.com',
    password: 'Staff@123456',
    fullName: 'Nhân viên Hỗ trợ',
    role: 'STAFF',
    phone: '0912345678',
  },
  {
    email: 'staff2@vietticket.com',
    password: 'Staff@123456',
    fullName: 'Nhân viên Hoàn tiền',
    role: 'STAFF',
    phone: '0923456789',
  },
];

async function createStaff() {
  try {
    console.log('Đang kết nối cơ sở dữ liệu...');
    await prisma.$connect();

    for (const account of ACCOUNTS) {
      console.log(`\nKiểm tra tài khoản: ${account.email}`);
      const existing = await prisma.user.findUnique({
        where: { email: account.email },
      });

      if (existing) {
        if (existing.role !== account.role) {
          await prisma.user.update({
            where: { id: existing.id },
            data: { role: account.role, status: 'ACTIVE', isEmailVerified: true },
          });
          console.log(`  ✅ Cập nhật role → ${account.role}: ${account.email}`);
        } else {
          console.log(`  ℹ️  Đã tồn tại (${account.role}): ${account.email}`);
        }
        continue;
      }

      const passwordHash = await bcrypt.hash(account.password, 10);
      await prisma.user.create({
        data: {
          email: account.email,
          passwordHash,
          fullName: account.fullName,
          role: account.role,
          isEmailVerified: true,
          status: 'ACTIVE',
          profile: {
            create: {
              phoneNumber: account.phone,
              gender: 'MALE',
              address: 'TP. Hồ Chí Minh, Việt Nam',
            },
          },
        },
      });
      console.log(`  ✅ Tạo thành công (${account.role}): ${account.email}`);
    }

    console.log('\n==================================================');
    console.log('         THÔNG TIN TÀI KHOẢN STAFF              ');
    console.log('==================================================');
    for (const a of ACCOUNTS) {
      console.log(`Role     : ${a.role}`);
      console.log(`Email    : ${a.email}`);
      console.log(`Password : ${a.password}`);
      console.log(`Tên      : ${a.fullName}`);
      console.log('--------------------------------------------------');
    }
  } catch (error) {
    console.error('Lỗi:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

createStaff();
