'use strict';

const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const ALLOWED_PARTNER_ROLES = new Set(['CUSTOMER', 'PARTNER']);
const DEFAULT_DOCUMENTS_DIR = path.join(__dirname, '../private/documents');

function effectiveRoles(user) {
  return new Set([
    user.role,
    ...(user.roleMemberships || []).map((membership) => membership.role),
  ]);
}

function assertRotatablePartnerIdentity(user) {
  const roles = effectiveRoles(user);
  const hasConflictingRole = [...roles].some((role) => !ALLOWED_PARTNER_ROLES.has(role));

  if (user.provider !== 'LOCAL' || (user.oauthAccounts || []).length > 0) {
    throw new Error(
      'Từ chối xoay mật khẩu seed cho tài khoản OAuth hoặc đã liên kết OAuth.',
    );
  }
  if (user.employerPartnerId || hasConflictingRole) {
    throw new Error(
      'Từ chối dùng tài khoản ADMIN/STAFF/nhân viên làm đối tác seed.',
    );
  }
  if (!roles.has('PARTNER') && !user.partnerProfile) {
    throw new Error(
      'Từ chối tự động nâng một tài khoản khách hàng hiện có thành đối tác seed.',
    );
  }
}

async function ensureSeedPartnerIdentity({
  client,
  email,
  password,
  fullName,
  phoneNumber,
  hashPassword = (value) => bcrypt.hash(value, 10),
}) {
  if (!client || !email || typeof password !== 'string' || password.length < 12) {
    throw new Error('Thông tin danh tính đối tác seed không hợp lệ.');
  }

  const existing = await client.user.findUnique({
    where: { email },
    include: {
      roleMemberships: { select: { role: true } },
      partnerProfile: { select: { id: true } },
      oauthAccounts: { select: { id: true, provider: true } },
    },
  });

  if (!existing) {
    const passwordHash = await hashPassword(password);
    const user = await client.user.create({
      data: {
        email,
        passwordHash,
        fullName,
        role: 'PARTNER',
        provider: 'LOCAL',
        isEmailVerified: true,
        status: 'ACTIVE',
        profile: { create: { phoneNumber } },
        roleMemberships: {
          create: [{ role: 'CUSTOMER' }, { role: 'PARTNER' }],
        },
      },
    });
    return { user, created: true };
  }

  assertRotatablePartnerIdentity(existing);
  const passwordHash = await hashPassword(password);
  const user = await client.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: existing.id },
      data: {
        passwordHash,
        role: 'PARTNER',
        isEmailVerified: true,
        tokenVersion: { increment: 1 },
      },
    });
    await tx.authSession.updateMany({
      where: { userId: existing.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.userRoleMembership.upsert({
      where: { userId_role: { userId: existing.id, role: 'CUSTOMER' } },
      update: {},
      create: { userId: existing.id, role: 'CUSTOMER' },
    });
    await tx.userRoleMembership.upsert({
      where: { userId_role: { userId: existing.id, role: 'PARTNER' } },
      update: {},
      create: { userId: existing.id, role: 'PARTNER' },
    });
    return updated;
  });

  return { user, created: false };
}

async function createDemoLicensePdf(filePath) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(filePath, { flags: 'wx' });
    const document = new PDFDocument({ size: 'A4', margin: 56 });

    output.on('finish', resolve);
    output.on('error', reject);
    document.on('error', reject);
    document.pipe(output);
    document.fontSize(18).text('VIETTICKET DEMO KYC DOCUMENT', { align: 'center' });
    document.moveDown();
    document.fontSize(12).text(
      'This fixture exists only to demonstrate the complete partner KYC workflow. '
      + 'It is not a real business licence and must never be used outside demo data.',
    );
    document.moveDown();
    document.text(`Generated: ${new Date().toISOString()}`);
    document.end();
  }).catch(async (error) => {
    if (error.code !== 'EEXIST') throw error;
  });
}

async function ensureSeedPartnerKycDocument({
  userId,
  backendUrl = process.env.BACKEND_URL || 'http://localhost:5000',
  documentsDir = DEFAULT_DOCUMENTS_DIR,
}) {
  const safeUserId = String(userId || '').replace(/[^a-zA-Z0-9-]/g, '');
  if (!safeUserId || safeUserId !== userId) {
    throw new Error('Không thể tạo tài liệu KYC seed vì userId không hợp lệ.');
  }

  let origin;
  try {
    origin = new URL(backendUrl).origin;
  } catch {
    throw new Error('BACKEND_URL không hợp lệ để tạo tài liệu KYC seed.');
  }

  const filename = `${safeUserId}-seed-business-license.pdf`;
  const filePath = path.join(documentsDir, filename);
  try {
    const stats = await fs.promises.stat(filePath);
    if (!stats.isFile()) throw new Error('Đường dẫn tài liệu KYC seed không phải tệp.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await createDemoLicensePdf(filePath);
  }

  return `${origin}/api/upload/documents/${filename}`;
}

module.exports = {
  assertRotatablePartnerIdentity,
  ensureSeedPartnerIdentity,
  ensureSeedPartnerKycDocument,
};
