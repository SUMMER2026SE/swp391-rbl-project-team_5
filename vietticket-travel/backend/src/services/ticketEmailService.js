const prisma = require('../config/prisma');
const { generateTicketPDF } = require('../utils/generateTicketPDF');
const { sendTicketConfirmationEmail } = require('../utils/mailer');

const CONFIRMED_BOOKING_INCLUDE = {
  ticketInstances: true,
  reservation: {
    include: {
      timeSlot: true,
      ticketProduct: {
        include: {
          attraction: true,
        },
      },
    },
  },
};

async function processConfirmedTicketEmail(bookingId) {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: CONFIRMED_BOOKING_INCLUDE,
    });

    if (!booking || booking.status !== 'CONFIRMED') {
      return { sent: false, reason: 'BOOKING_NOT_CONFIRMED' };
    }

    const pdfBuffer = await generateTicketPDF(booking);
    return await sendTicketConfirmationEmail({ booking, pdfBuffer });
  } catch (error) {
    console.error(`[TicketEmail] Failed to deliver ticket for ${bookingId}:`, error);
    return { sent: false, reason: 'DELIVERY_FAILED', error };
  }
}

function queueConfirmedTicketEmail(bookingId) {
  if (process.env.NODE_ENV === 'test') return;
  void processConfirmedTicketEmail(bookingId);
}

module.exports = {
  processConfirmedTicketEmail,
  queueConfirmedTicketEmail,
};
