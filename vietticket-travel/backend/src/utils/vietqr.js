'use strict';

// ============================================================
// vietqr.js — Sinh chuỗi mã QR chuyển khoản theo chuẩn VietQR (NAPAS 247).
// ------------------------------------------------------------
// Chuỗi tuân thủ EMVCo QR (TLV: ID 2 ký tự + LENGTH 2 ký tự + VALUE) và được
// mọi app ngân hàng tại Việt Nam quét được. Sinh HOÀN TOÀN cục bộ nên:
//   - Không gọi dịch vụ bên ngoài, không lộ dữ liệu đơn hàng.
//   - Demo offline vẫn hoạt động (không phụ thuộc img.vietqr.io).
//
// Frontend chỉ cần render chuỗi này bằng thư viện QR sẵn có (qrcode.react).
// ============================================================

const PAYLOAD_FORMAT_INDICATOR = '01';
const POINT_OF_INITIATION_DYNAMIC = '12'; // QR một lần, có gắn số tiền
const POINT_OF_INITIATION_STATIC = '11'; // QR dùng lại, khách tự nhập số tiền
const VIETQR_GUID = 'A000000727';
const SERVICE_TRANSFER_TO_ACCOUNT = 'QRIBFTTA';
const CURRENCY_VND = '704';
const COUNTRY_VN = 'VN';

// Nối một trường TLV. Độ dài luôn 2 chữ số theo chuẩn EMVCo.
function tlv(id, value) {
  const content = String(value ?? '');
  if (content.length > 99) {
    throw new Error(`Trường VietQR "${id}" vượt quá 99 ký tự.`);
  }
  return `${id}${String(content.length).padStart(2, '0')}${content}`;
}

// CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) — bắt buộc ở cuối chuỗi VietQR.
function crc16(input) {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i += 1) {
    crc ^= (input.charCodeAt(i) & 0xff) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// Nội dung chuyển khoản: nhiều ngân hàng loại bỏ dấu và ký tự đặc biệt, nên
// chỉ giữ chữ/số/khoảng trắng để nội dung tới nơi đúng như lúc tạo -> đối soát được.
function sanitizeTransferContent(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .replace(/đ/gu, 'd')
    .replace(/Đ/gu, 'D')
    .replace(/[^0-9a-zA-Z ]/gu, '')
    .trim()
    .slice(0, 25);
}

function isValidBankBin(bin) {
  return /^\d{6}$/u.test(String(bin || ''));
}

function isValidAccountNumber(accountNumber) {
  return /^\d{6,19}$/u.test(String(accountNumber || ''));
}

/**
 * Sinh chuỗi payload VietQR.
 *
 * @param {object} params
 * @param {string} params.bankBin       Mã BIN ngân hàng (6 chữ số, ví dụ Vietcombank 970436)
 * @param {string} params.accountNumber Số tài khoản thụ hưởng
 * @param {number} [params.amount]      Số tiền VND (bỏ trống -> QR tĩnh, khách tự nhập)
 * @param {string} [params.content]     Nội dung chuyển khoản (dùng để đối soát)
 * @returns {string} Chuỗi để render thành ảnh QR
 */
function buildVietQrPayload({ bankBin, accountNumber, amount, content } = {}) {
  if (!isValidBankBin(bankBin)) {
    throw new Error('Mã BIN ngân hàng không hợp lệ (phải gồm đúng 6 chữ số).');
  }
  if (!isValidAccountNumber(accountNumber)) {
    throw new Error('Số tài khoản ngân hàng không hợp lệ.');
  }

  const hasAmount = Number.isFinite(Number(amount)) && Number(amount) > 0;
  // VND không dùng phần thập phân -> làm tròn về số nguyên.
  const amountText = hasAmount ? String(Math.round(Number(amount))) : null;

  const beneficiary = tlv('00', bankBin) + tlv('01', String(accountNumber));
  const merchantAccountInfo =
    tlv('00', VIETQR_GUID)
    + tlv('01', beneficiary)
    + tlv('02', SERVICE_TRANSFER_TO_ACCOUNT);

  const cleanContent = sanitizeTransferContent(content);

  let payload =
    tlv('00', PAYLOAD_FORMAT_INDICATOR)
    + tlv('01', hasAmount ? POINT_OF_INITIATION_DYNAMIC : POINT_OF_INITIATION_STATIC)
    + tlv('38', merchantAccountInfo)
    + tlv('53', CURRENCY_VND);

  if (amountText) payload += tlv('54', amountText);

  payload += tlv('58', COUNTRY_VN);
  if (cleanContent) payload += tlv('62', tlv('08', cleanContent));

  // CRC được tính trên toàn bộ chuỗi ĐÃ bao gồm "6304".
  const withCrcHeader = `${payload}6304`;
  return `${withCrcHeader}${crc16(withCrcHeader)}`;
}

module.exports = {
  buildVietQrPayload,
  crc16,
  sanitizeTransferContent,
  isValidBankBin,
  isValidAccountNumber,
};
