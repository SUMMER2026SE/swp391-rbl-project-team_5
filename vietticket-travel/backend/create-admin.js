const bcrypt = require('bcrypt');
const prisma = require('./src/config/prisma');

const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '');
const ADMIN_FULLNAME = String(process.env.ADMIN_FULLNAME || 'VietTicket Admin').trim();

async function createAdmin() {
  try {
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
      throw new Error('Cần cấu hình ADMIN_EMAIL và ADMIN_PASSWORD trong biến môi trường.');
    }
    if (ADMIN_PASSWORD.length < 12) {
      throw new Error('ADMIN_PASSWORD phải có ít nhất 12 ký tự.');
    }
    console.log('Đang kết nối cơ sở dữ liệu...');
    await prisma.$connect();

    console.log(`Đang kiểm tra tài khoản ${ADMIN_EMAIL}...`);
    const existingUser = await prisma.user.findUnique({
      where: { email: ADMIN_EMAIL },
    });

    if (existingUser) {
      console.log(`Tài khoản ${ADMIN_EMAIL} đã tồn tại trong hệ thống.`);
      
      // If it exists but is not ADMIN, update its role
      if (existingUser.role !== 'ADMIN') {
        console.log('Đang cập nhật vai trò thành ADMIN...');
        await prisma.user.update({
          where: { id: existingUser.id },
          data: { role: 'ADMIN', status: 'ACTIVE', isEmailVerified: true },
        });
        console.log('Cập nhật vai trò Admin thành công!');
      }
      return;
    }

    console.log('Đang mã hóa mật khẩu...');
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, saltRounds);

    console.log('Đang tạo tài khoản Admin...');
    const adminUser = await prisma.user.create({
      data: {
        email: ADMIN_EMAIL,
        passwordHash,
        fullName: ADMIN_FULLNAME,
        role: 'ADMIN',
        isEmailVerified: true,
        status: 'ACTIVE',
        profile: {
          create: {
            phoneNumber: '0901234567',
            gender: 'MALE',
            address: 'Hà Nội, Việt Nam',
          },
        },
      },
    });

    console.log('==================================================');
    console.log('TẠO TÀI KHOẢN ADMIN THÀNH CÔNG!');
    console.log(`Email đăng nhập: ${ADMIN_EMAIL}`);
    console.log(`Họ và tên:       ${adminUser.fullName}`);
    console.log('==================================================');
  } catch (error) {
    console.error('Tạo tài khoản Admin thất bại:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createAdmin();
