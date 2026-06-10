const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

const COLORS = {
  primary: '#00474d',
  surface: '#f2f4f5',
  border: '#d9e1e2',
  text: '#191c1d',
  muted: '#5f6f71',
  white: '#ffffff',
};

const REGULAR_FONT = require.resolve(
  '@fontsource/noto-sans/files/noto-sans-vietnamese-400-normal.woff',
);
const BOLD_FONT = require.resolve(
  '@fontsource/noto-sans/files/noto-sans-vietnamese-700-normal.woff',
);

function toNumber(value) {
  return value == null ? 0 : Number(value.toString());
}

function formatCurrency(value) {
  return `${new Intl.NumberFormat('vi-VN').format(toNumber(value))} VND`;
}

function formatDate(value) {
  if (!value) return 'Chưa cập nhật';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value));
}

function getAddress(attraction) {
  return [attraction.address, attraction.district, attraction.city]
    .filter(Boolean)
    .join(', ');
}

function getTimeSlot(reservation) {
  return reservation.timeSlot
    ? `${reservation.timeSlot.startTime} - ${reservation.timeSlot.endTime}`
    : 'Sử dụng trong ngày đã chọn';
}

function drawLabelValue(doc, label, value, x, y, width) {
  doc
    .font('NotoSans')
    .fontSize(8)
    .fillColor(COLORS.muted)
    .text(label.toUpperCase(), x, y, { width, characterSpacing: 0.4 });
  doc
    .font('NotoSansBold')
    .fontSize(10.5)
    .fillColor(COLORS.text)
    .text(String(value || '-'), x, y + 15, { width, lineGap: 2 });
}

function drawTicketPage(doc, booking, ticket, qrDataUrl, index, totalTickets) {
  const reservation = booking.reservation;
  const product = reservation.ticketProduct;
  const attraction = product.attraction;
  const pageWidth = doc.page.width;
  const margin = 44;
  const contentWidth = pageWidth - margin * 2;

  doc.rect(0, 0, pageWidth, 128).fill(COLORS.primary);
  doc
    .font('NotoSansBold')
    .fontSize(20)
    .fillColor(COLORS.white)
    .text('VIETTICKET TRAVEL', margin, 36);
  doc
    .font('NotoSans')
    .fontSize(11)
    .fillColor('#d9f0f1')
    .text('VÉ ĐIỆN TỬ (E-TICKET)', margin, 68);
  doc.roundedRect(pageWidth - 174, 34, 130, 42, 10).fill('#0d5b61');
  doc
    .font('NotoSansBold')
    .fontSize(10)
    .fillColor(COLORS.white)
    .text(`VÉ ${index + 1}/${totalTickets}`, pageWidth - 174, 50, {
      width: 130,
      align: 'center',
    });

  doc
    .font('NotoSansBold')
    .fontSize(17)
    .fillColor(COLORS.primary)
    .text(attraction.title, margin, 158, { width: contentWidth });
  doc
    .font('NotoSans')
    .fontSize(9.5)
    .fillColor(COLORS.muted)
    .text(getAddress(attraction), margin, 186, { width: contentWidth });

  doc.roundedRect(margin, 222, contentWidth, 106, 12).fill(COLORS.surface);
  drawLabelValue(doc, 'Khách hàng', booking.fullName, margin + 18, 241, 220);
  drawLabelValue(doc, 'Email', booking.email, margin + 260, 241, 245);
  drawLabelValue(
    doc,
    'Số điện thoại',
    booking.phone || 'Chưa cập nhật',
    margin + 18,
    285,
    220,
  );
  drawLabelValue(doc, 'Mã đặt chỗ', booking.id.toUpperCase(), margin + 260, 285, 245);

  doc
    .font('NotoSansBold')
    .fontSize(12)
    .fillColor(COLORS.primary)
    .text('CHI TIẾT DỊCH VỤ', margin, 360);
  doc
    .moveTo(margin, 382)
    .lineTo(pageWidth - margin, 382)
    .strokeColor(COLORS.border)
    .stroke();

  drawLabelValue(doc, 'Loại vé', product.name, margin, 400, 225);
  drawLabelValue(doc, 'Số lượng', reservation.quantity, margin + 260, 400, 100);
  drawLabelValue(doc, 'Ngày tham quan', formatDate(reservation.date), margin, 452, 225);
  drawLabelValue(doc, 'Khung giờ', getTimeSlot(reservation), margin + 260, 452, 245);
  drawLabelValue(
    doc,
    'Tổng tiền đã thanh toán',
    formatCurrency(booking.totalAmount),
    margin,
    504,
    260,
  );

  const qrSize = 176;
  const qrX = (pageWidth - qrSize) / 2;
  const qrY = 558;
  doc
    .roundedRect(qrX - 12, qrY - 12, qrSize + 24, qrSize + 24, 14)
    .fillAndStroke(COLORS.white, COLORS.border);
  doc.image(qrDataUrl, qrX, qrY, { width: qrSize, height: qrSize });
  doc
    .font('NotoSansBold')
    .fontSize(9)
    .fillColor(COLORS.primary)
    .text('MÃ QR KIỂM SOÁT', margin, qrY + qrSize + 18, {
      width: contentWidth,
      align: 'center',
    });
  doc
    .font('NotoSans')
    .fontSize(7.5)
    .fillColor(COLORS.muted)
    .text(ticket.qrCodeToken, margin, qrY + qrSize + 34, {
      width: contentWidth,
      align: 'center',
    });

  doc
    .font('NotoSans')
    .fontSize(7.5)
    .fillColor(COLORS.muted)
    .text(
      'Vui lòng xuất trình mã QR này tại quầy soát vé. Mỗi mã QR chỉ có giá trị cho một lượt sử dụng.',
      margin,
      796,
      { width: contentWidth, align: 'center' },
    );
}

async function generateTicketPDF(booking) {
  const reservation = booking?.reservation;
  const product = reservation?.ticketProduct;
  const attraction = product?.attraction;
  const tickets = booking?.ticketInstances || [];

  if (!booking || !reservation || !product || !attraction || tickets.length === 0) {
    throw new Error('Booking chưa có đủ dữ liệu để tạo vé PDF.');
  }

  const qrImages = await Promise.all(
    tickets.map((ticket) =>
      QRCode.toDataURL(ticket.qrCodeToken, {
        errorCorrectionLevel: 'H',
        margin: 2,
        width: 512,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      }),
    ),
  );

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      autoFirstPage: false,
      bufferPages: true,
      info: {
        Title: `VietTicket E-Ticket ${booking.id}`,
        Author: 'VietTicket Travel',
        Subject: 'Electronic attraction ticket',
      },
      margin: 0,
      size: 'A4',
    });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('NotoSans', REGULAR_FONT);
    doc.registerFont('NotoSansBold', BOLD_FONT);

    tickets.forEach((ticket, index) => {
      doc.addPage();
      drawTicketPage(doc, booking, ticket, qrImages[index], index, tickets.length);
    });

    doc.end();
  });
}

module.exports = {
  generateTicketPDF,
};
