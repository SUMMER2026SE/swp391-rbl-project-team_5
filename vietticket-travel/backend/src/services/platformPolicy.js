'use strict';

// ============================================================
// platformPolicy.js
// ------------------------------------------------------------
// Nội dung chính sách & FAQ của nền tảng VietTicket Travel.
// Được đưa vào system prompt của chatbot để trả lời các câu hỏi
// về dịch vụ, thanh toán, hoàn/đổi vé, v.v.
//
// CHỈNH SỬA: cập nhật nội dung này theo chính sách thật của
// dự án (lấy từ trang Điều khoản/FAQ trên frontend nếu có).
// ============================================================

const PLATFORM_POLICY_TEXT = `
THÔNG TIN NỀN TẢNG VIETTICKET TRAVEL:
- VietTicket Travel là nền tảng đặt vé tham quan trực tuyến, kết nối du khách với các điểm tham quan, khu du lịch, công viên giải trí trên toàn Việt Nam.
- Người dùng có thể tìm kiếm điểm tham quan theo thành phố/khu vực, xem mô tả, giá vé, đánh giá, và đặt vé trực tuyến.

CHÍNH SÁCH ĐẶT VÉ:
- Vé điện tử (e-ticket) được gửi qua email/tài khoản ngay sau khi thanh toán thành công.
- Mỗi vé có khung giờ (time slot) cụ thể, khách cần đến đúng khung giờ đã đặt (trừ khi vé ghi "linh hoạt cả ngày").
- Một số điểm tham quan yêu cầu đối tác duyệt đơn thủ công trước khi vé được xác nhận (thường trong vòng 24h).

CHÍNH SÁCH HOÀN/ĐỔI VÉ (tuỳ theo từng loại vé, ghi rõ trên trang chi tiết vé):
- FREE_CANCELLATION: Miễn phí hủy/hoàn tiền nếu hủy trước thời gian quy định (thường 24-48h trước giờ tham quan).
- REFUND_WITH_FEE: Được hoàn tiền nhưng tính phí hủy (theo % giá vé, hiển thị cụ thể trên vé).
- NON_REFUNDABLE: Không hỗ trợ hoàn/đổi vé sau khi đã thanh toán thành công.
- Mọi yêu cầu hoàn/đổi vé thực hiện qua mục "Vé của tôi" hoặc liên hệ hỗ trợ qua hệ thống Support Ticket.

THANH TOÁN:
- Hỗ trợ thanh toán qua VNPay (thẻ ATM nội địa, thẻ quốc tế, ví điện tử, QR code).
- Sau khi thanh toán, trạng thái đơn được cập nhật tự động qua hệ thống IPN của VNPay.

VOUCHER & ƯU ĐÃI:
- Người dùng có thể nhập mã voucher (nếu có) ở bước thanh toán để được giảm giá.
- Mỗi voucher có điều kiện áp dụng riêng (giá trị tối thiểu, thời hạn, số lần sử dụng).

LIÊN HỆ HỖ TRỢ:
- Khách hàng gặp vấn đề về đơn hàng, thanh toán, hoặc cần hỗ trợ khác có thể tạo "Support Ticket" trong tài khoản; đội ngũ hỗ trợ (Staff/Admin) sẽ phản hồi qua hệ thống nhắn tin của ticket đó.

LƯU Ý CHO CHATBOT:
- Nếu câu hỏi liên quan đến đơn hàng/giao dịch CỤ THỂ của một khách hàng (ví dụ "vé của tôi bị lỗi", "tôi chưa nhận được email vé"), hãy hướng dẫn khách tạo Support Ticket để được nhân viên hỗ trợ trực tiếp, vì chatbot không có quyền truy cập dữ liệu đơn hàng cá nhân.
- Nếu không chắc câu trả lời, hãy nói rõ là không chắc và đề xuất khách liên hệ Support Ticket, tuyệt đối không bịa thông tin về chính sách.
`.trim();

module.exports = {
  PLATFORM_POLICY_TEXT,
};
