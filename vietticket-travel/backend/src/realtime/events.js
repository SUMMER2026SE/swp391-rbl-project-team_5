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

function disconnectMatchingSockets(predicate) {
  if (!socketServer) return 0;
  let disconnected = 0;
  for (const socket of socketServer.sockets.sockets.values()) {
    if (!predicate(socket.user || {})) continue;
    socket.emit('AUTHORIZATION_REVOKED', {
      message: 'Quyền truy cập của tài khoản vừa thay đổi. Vui lòng đăng nhập lại.',
    });
    socket.disconnect(true);
    disconnected += 1;
  }
  return disconnected;
}

function disconnectUserSockets(userId) {
  if (!userId) return 0;
  return disconnectMatchingSockets((user) => user.id === userId);
}

function disconnectPartnerSockets(partnerId) {
  if (!partnerId) return 0;
  return disconnectMatchingSockets(
    (user) => user.partnerProfileId === partnerId || user.employerPartnerId === partnerId,
  );
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

// --- Support ticket (Module 5) ---
// Phát tin nhắn mới tới phòng chat của ticket. Quyền vào phòng được kiểm soát
// ở socketServer.js (handler JOIN_SUPPORT_TICKET), nên ở đây chỉ cần broadcast.
function emitSupportMessage(ticketId, message) {
  if (!socketServer || !ticketId) return false;

  socketServer.to(`ticket:${ticketId}`).emit('SUPPORT_MESSAGE', message);
  return true;
}

// Phát thay đổi trạng thái ticket (OPEN -> IN_PROGRESS -> RESOLVED) tới phòng chat.
function emitSupportTicketUpdated(ticketId, payload) {
  if (!socketServer || !ticketId) return false;

  socketServer.to(`ticket:${ticketId}`).emit('SUPPORT_TICKET_UPDATED', payload);
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
  disconnectPartnerSockets,
  disconnectUserSockets,
  emitBookingStatusUpdated,
  emitNewBooking,
  emitSupportMessage,
  emitSupportTicketUpdated,
  publishNewBookingById,
  queueNewBookingNotification,
  setSocketServer,
};
