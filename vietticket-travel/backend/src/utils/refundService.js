'use strict';

/**
 * Calculate the refundable amount from the ticket product's refund policy.
 *
 * @param {Object} booking Booking including reservation.ticketProduct.
 * @returns {{ refundAmount: number, feeAmount: number, policyLabel: string }}
 */
function calculateRefundAmount(booking) {
  const totalAmount = Number(booking?.totalAmount || 0);
  const ticketProduct = booking?.reservation?.ticketProduct;

  if (!ticketProduct) {
    return {
      refundAmount: 0,
      feeAmount: totalAmount,
      policyLabel: 'NON_REFUNDABLE',
    };
  }

  const policy = ticketProduct.refundPolicy;
  const feeRate = Number(ticketProduct.refundFeeRate || 0);

  if (policy === 'FREE_CANCELLATION') {
    return {
      refundAmount: totalAmount,
      feeAmount: 0,
      policyLabel: 'FREE_CANCELLATION',
    };
  }

  if (policy === 'REFUND_WITH_FEE') {
    const feeAmount = Math.round(totalAmount * feeRate);
    return {
      refundAmount: Math.max(0, totalAmount - feeAmount),
      feeAmount,
      policyLabel: `REFUND_WITH_FEE (${feeRate * 100}% fee)`,
    };
  }

  return {
    refundAmount: 0,
    feeAmount: totalAmount,
    policyLabel: 'NON_REFUNDABLE',
  };
}

/**
 * Return confirmed inventory for a cancelled booking.
 * This function must run inside a Prisma transaction.
 *
 * @param {Object} tx Prisma transaction client.
 * @param {Object} booking Booking including reservation.
 */
async function releaseInventory(tx, booking) {
  const reservation = booking?.reservation;
  if (!reservation || reservation.status !== 'CONFIRMED') return;

  const { ticketProductId, timeSlotId, date, quantity } = reservation;

  const dailyStock = await tx.dailyStock.updateMany({
    where: {
      ticketProductId,
      date,
      bookedQuantity: { gte: quantity },
    },
    data: { bookedQuantity: { decrement: quantity } },
  });

  if (dailyStock.count !== 1) {
    const error = new Error('Không thể hoàn trả kho vé theo ngày.');
    error.statusCode = 409;
    throw error;
  }

  if (timeSlotId) {
    const timeSlotStock = await tx.timeSlotStock.updateMany({
      where: {
        timeSlotId,
        date,
        bookedQty: { gte: quantity },
      },
      data: { bookedQty: { decrement: quantity } },
    });

    if (timeSlotStock.count !== 1) {
      const error = new Error('Không thể hoàn trả kho vé theo khung giờ.');
      error.statusCode = 409;
      throw error;
    }
  }

  await tx.reservation.update({
    where: { id: reservation.id },
    data: { status: 'CANCELLED' },
  });
}

module.exports = { calculateRefundAmount, releaseInventory };
