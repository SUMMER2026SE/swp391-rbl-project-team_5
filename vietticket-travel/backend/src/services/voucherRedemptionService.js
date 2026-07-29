'use strict';

function voucherError(message, code = 'VOUCHER_NOT_APPLICABLE') {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = code;
  return error;
}

async function countActiveVoucherUses(client, voucherId, userId) {
  if (!client?.voucherRedemption?.count || !voucherId || !userId) return 0;
  return client.voucherRedemption.count({
    where: { voucherId, userId, status: 'ACTIVE' },
  });
}

async function claimVoucherRedemption(client, { voucher, userId, bookingId }) {
  if (!voucher || !userId || !bookingId || !client?.voucherRedemption?.create) {
    return null;
  }
  const maxUsesPerUser = Math.min(
    Math.max(Number(voucher.maxUsesPerUser || 1), 1),
    100,
  );
  const activeUses = await countActiveVoucherUses(client, voucher.id, userId);
  if (activeUses >= maxUsesPerUser) {
    throw voucherError(
      `Bạn đã sử dụng đủ ${maxUsesPerUser} lượt cho mã ưu đãi này.`,
      'VOUCHER_USER_LIMIT_REACHED',
    );
  }
  return client.voucherRedemption.create({
    data: {
      voucherId: voucher.id,
      userId,
      bookingId,
      status: 'ACTIVE',
    },
  });
}

async function releaseVoucherRedemption(
  client,
  { bookingId, voucherId, now = new Date() },
) {
  if (!voucherId) return false;

  if (!client?.voucherRedemption?.updateMany) {
    await client.voucher.updateMany({
      where: { id: voucherId, usedCount: { gt: 0 } },
      data: { usedCount: { decrement: 1 } },
    });
    return true;
  }

  const released = await client.voucherRedemption.updateMany({
    where: { bookingId, voucherId, status: 'ACTIVE' },
    data: { status: 'RELEASED', releasedAt: now },
  });
  if (released.count !== 1) return false;

  await client.voucher.updateMany({
    where: { id: voucherId, usedCount: { gt: 0 } },
    data: { usedCount: { decrement: 1 } },
  });
  return true;
}

module.exports = {
  claimVoucherRedemption,
  countActiveVoucherUses,
  releaseVoucherRedemption,
  voucherError,
};
