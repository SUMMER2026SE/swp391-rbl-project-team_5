'use strict';

const bcrypt = require('bcrypt');
const prisma = require('./src/config/prisma');

function getConfiguredAccounts() {
  const email = String(process.env.STAFF_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.STAFF_PASSWORD || '');
  const fullName = String(process.env.STAFF_FULLNAME || '').trim();
  const phone = String(process.env.STAFF_PHONE || '').trim() || null;
  if (!email || !password || !fullName) {
    throw new Error('Cần cấu hình STAFF_EMAIL, STAFF_PASSWORD và STAFF_FULLNAME.');
  }
  if (password.length < 12) {
    throw new Error('STAFF_PASSWORD phải có ít nhất 12 ký tự.');
  }
  return [{ email, password, fullName, role: 'STAFF', phone }];
}

function assertRotatablePlatformStaff(existing) {
  const roles = new Set([
    existing.role,
    ...(existing.roleMemberships || []).map((membership) => membership.role),
  ]);
  const hasNonStaffRole = [...roles].some((role) => role !== 'STAFF');

  if (existing.provider !== 'LOCAL' || (existing.oauthAccounts || []).length > 0) {
    throw new Error('Từ chối xoay mật khẩu cho tài khoản staff OAuth hoặc đã liên kết OAuth.');
  }
  if (
    existing.employerPartnerId
    || existing.partnerProfile
    || !roles.has('STAFF')
    || hasNonStaffRole
  ) {
    throw new Error(
      'Chỉ được xoay mật khẩu cho danh tính platform STAFF độc lập, không thuộc đối tác.',
    );
  }
}

async function rotateExistingStaff(client, existing, account, hashPassword = bcrypt.hash) {
  assertRotatablePlatformStaff(existing);
  const passwordHash = await hashPassword(account.password, 10);

  return client.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: existing.id },
      data: {
        passwordHash,
        fullName: account.fullName,
        role: 'STAFF',
        isEmailVerified: true,
        tokenVersion: { increment: 1 },
      },
    });
    await tx.authSession.updateMany({
      where: { userId: existing.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.userRoleMembership.upsert({
      where: { userId_role: { userId: existing.id, role: 'STAFF' } },
      update: {},
      create: { userId: existing.id, role: 'STAFF' },
    });
    return updated;
  });
}

async function createStaff() {
  try {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Script tạo staff mẫu bị cấm trong production.');
    }
    if (process.env.ALLOW_DEMO_SCRIPTS !== 'true') {
      throw new Error('Đặt ALLOW_DEMO_SCRIPTS=true để xác nhận chạy script ngoài production.');
    }
    const accounts = getConfiguredAccounts();

    console.log('Đang kết nối cơ sở dữ liệu...');
    await prisma.$connect();

    for (const account of accounts) {
      console.log(`\nKiểm tra tài khoản: ${account.email}`);
      const existing = await prisma.user.findUnique({
        where: { email: account.email },
        include: {
          roleMemberships: { select: { role: true } },
          partnerProfile: { select: { id: true } },
          oauthAccounts: { select: { id: true, provider: true } },
        },
      });

      if (existing) {
        if (process.env.ROTATE_EXISTING_STAFF !== 'true') {
          throw new Error(
            `Tài khoản ${account.email} đã tồn tại. Đặt ROTATE_EXISTING_STAFF=true để xác nhận xoay mật khẩu platform STAFF hợp lệ.`,
          );
        }
        await rotateExistingStaff(prisma, existing, account);
        console.log(`  ✅ Đã xoay mật khẩu và thu hồi phiên cũ: ${account.email}`);
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
          roleMemberships: { create: { role: 'STAFF' } },
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
    console.log('         ĐÃ TẠO TÀI KHOẢN STAFF                 ');
    console.log('==================================================');
    for (const a of accounts) {
      console.log(`Role     : ${a.role}`);
      console.log(`Email    : ${a.email}`);
      console.log(`Tên      : ${a.fullName}`);
      console.log('--------------------------------------------------');
    }
  } catch (error) {
    console.error('Lỗi:', error.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  createStaff();
}

module.exports = {
  assertRotatablePlatformStaff,
  createStaff,
  getConfiguredAccounts,
  rotateExistingStaff,
};
