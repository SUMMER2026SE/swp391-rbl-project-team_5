const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const { formatBookingReference } = require('./bookingReference');

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

function getTimeSlot(reservation) {
  return reservation.timeSlot
    ? `${reservation.timeSlot.startTime} - ${reservation.timeSlot.endTime}`
    : 'Sử dụng trong ngày đã chọn';
}

function getSnapshotAddress(booking, attraction) {
  return [
    booking.snapshotAttractionAddress ?? attraction.address,
    booking.snapshotAttractionDistrict ?? attraction.district,
    booking.snapshotAttractionCity ?? attraction.city,
  ]
    .filter(Boolean)
    .join(', ');
}

function getOperationalDetails(booking, attraction, product) {
  const list = (snapshotValue, currentValue) => (
    Array.isArray(snapshotValue)
      ? snapshotValue.map((item) => String(item)).filter(Boolean)
      : (Array.isArray(currentValue) ? currentValue.map((item) => String(item)).filter(Boolean) : [])
  );
  return {
    meetingPoint: booking.snapshotMeetingPoint ?? attraction.meetingPoint ?? '',
    checkInInstructions:
      booking.snapshotCheckInInstructions ?? attraction.checkInInstructions ?? '',
    accessibilityInfo:
      booking.snapshotAccessibilityInfo ?? attraction.accessibilityInfo ?? '',
    whatToBring: list(booking.snapshotWhatToBring, attraction.whatToBring),
    inclusions: list(booking.snapshotInclusions, product.inclusions),
    exclusions: list(booking.snapshotExclusions, product.exclusions),
  };
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
    .text(booking.snapshotAttractionTitle || attraction.title, margin, 158, { width: contentWidth });
  doc
    .font('NotoSans')
    .fontSize(9.5)
    .fillColor(COLORS.muted)
    .text(getSnapshotAddress(booking, attraction), margin, 186, { width: contentWidth });

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
  drawLabelValue(doc, 'Mã đặt chỗ', formatBookingReference(booking.id), margin + 260, 285, 245);

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

  drawLabelValue(doc, 'Loại vé', booking.snapshotTicketName || product.name, margin, 400, 225);
  drawLabelValue(doc, 'Số lượng', reservation.quantity, margin + 260, 400, 100);
  drawLabelValue(
    doc,
    'Ngày tham quan',
    formatDate(booking.snapshotVisitDate || reservation.date),
    margin,
    452,
    225,
  );
  drawLabelValue(
    doc,
    'Khung giờ',
    booking.snapshotTimeSlotLabel || getTimeSlot(reservation),
    margin + 260,
    452,
    245,
  );
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

function drawOperationalGuide(doc, booking) {
  const reservation = booking.reservation;
  const product = reservation.ticketProduct;
  const attraction = product.attraction;
  const details = getOperationalDetails(booking, attraction, product);
  const margin = 44;
  const contentWidth = doc.page.width - margin * 2;
  let y = 44;

  const addPageHeader = () => {
    doc.rect(0, 0, doc.page.width, 92).fill(COLORS.primary);
    doc
      .font('NotoSansBold')
      .fontSize(18)
      .fillColor(COLORS.white)
      .text('HƯỚNG DẪN SỬ DỤNG VÉ', margin, 32);
    doc
      .font('NotoSans')
      .fontSize(8.5)
      .fillColor('#d9f0f1')
      .text(`Mã đặt chỗ: ${formatBookingReference(booking.id)}`, margin, 61);
    y = 118;
  };

  const ensureSpace = (requiredHeight) => {
    if (y + requiredHeight <= doc.page.height - 50) return;
    doc.addPage();
    addPageHeader();
  };

  const drawSection = (title, value, emptyText) => {
    const body = Array.isArray(value)
      ? (value.length > 0 ? value.map((item) => `• ${item}`).join('\n') : emptyText)
      : (String(value || '').trim() || emptyText);
    doc.font('NotoSans').fontSize(9.5);
    const bodyHeight = doc.heightOfString(body, { width: contentWidth, lineGap: 3 });
    ensureSpace(bodyHeight + 46);
    doc
      .font('NotoSansBold')
      .fontSize(11)
      .fillColor(COLORS.primary)
      .text(title, margin, y, { width: contentWidth });
    y += 22;
    doc
      .font('NotoSans')
      .fontSize(9.5)
      .fillColor(COLORS.text)
      .text(body, margin, y, { width: contentWidth, lineGap: 3 });
    y += bodyHeight + 24;
  };

  doc.addPage();
  addPageHeader();
  drawSection('Điểm gặp / quầy check-in', details.meetingPoint, 'Theo địa chỉ điểm tham quan trên vé.');
  drawSection('Cách check-in', details.checkInInstructions, 'Xuất trình mã QR hợp lệ tại cổng.');
  drawSection('Vé bao gồm', details.inclusions, 'Chưa có nội dung được công bố.');
  drawSection('Vé không bao gồm', details.exclusions, 'Không có khoản loại trừ được công bố.');
  drawSection('Cần mang theo', details.whatToBring, 'Không có vật dụng bắt buộc được công bố.');
  drawSection('Hỗ trợ tiếp cận', details.accessibilityInfo, 'Vui lòng liên hệ điểm tham quan để xác nhận.');
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
    drawOperationalGuide(doc, booking);

    doc.end();
  });
}

module.exports = {
  generateTicketPDF,
};
