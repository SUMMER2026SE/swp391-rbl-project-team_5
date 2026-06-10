const prisma = require('../config/prisma');

let socketServer = null;

const BOOKING_NOTIFICATION_INCLUDE = {
  reservation: {
    include: {
      ticketProduct: {
        include: {
          attraction: true,
        },
      },
    },
  },
};

function setSocketServer(io) {
  socketServer = io || null;
}

function toNumber(value) {
  return value == null ? 0 : Number(value.toString());
}

function toDateOnly(value) {
  return value ? new Date(value).toISOString().slice(0, 10) : '';
}

function emitNewBooking(booking) {
  const attraction = booking?.reservation?.ticketProduct?.attraction;
  if (!socketServer || !booking || !attraction?.partnerId) return false;

  socketServer.to(`partner:${attraction.partnerId}`).emit('NEW_BOOKING', {
    bookingId: booking.id,
    customerName: booking.fullName,
    attractionTitle: attraction.title,
    totalAmount: toNumber(booking.totalAmount),
    visitDate: toDateOnly(booking.reservation.date),
    status: booking.status,
  });

  return true;
}

function emitBookingStatusUpdated({ customerId, bookingId, status, message }) {
  if (!socketServer || !customerId) return false;

  socketServer.to(`user:${customerId}`).emit('BOOKING_STATUS_UPDATED', {
    bookingId,
    status,
    message,
  });

  return true;
}

async function publishNewBookingById(bookingId) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: BOOKING_NOTIFICATION_INCLUDE,
  });

  if (!booking || !['PENDING_PARTNER', 'CONFIRMED'].includes(booking.status)) {
    return false;
  }

  return emitNewBooking(booking);
}

function queueNewBookingNotification(bookingId) {
  if (process.env.NODE_ENV === 'test') return;

  void publishNewBookingById(bookingId).catch((error) => {
    console.error(`[Realtime] Failed to emit NEW_BOOKING for ${bookingId}:`, error);
  });
}

module.exports = {
  emitBookingStatusUpdated,
  emitNewBooking,
  publishNewBookingById,
  queueNewBookingNotification,
  setSocketServer,
};
