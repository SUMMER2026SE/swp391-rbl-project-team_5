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
- Vé điện tử (e-ticket) được gửi qua email/tài khoản sau khi thanh toán và đơn được xác nhận; sản phẩm duyệt thủ công cần đối tác phê duyệt trước khi phát hành QR.
- Mỗi vé có khung giờ (time slot) cụ thể, khách cần đến đúng khung giờ đã đặt (trừ khi vé ghi "linh hoạt cả ngày").
- Một số điểm tham quan yêu cầu đối tác duyệt đơn thủ công trước khi vé được xác nhận (thường trong vòng 24h).

CHÍNH SÁCH HOÀN/ĐỔI VÉ (tuỳ theo từng loại vé, ghi rõ trên trang chi tiết vé):
- FREE_CANCELLATION: Có thể được hoàn toàn bộ nếu vé còn đủ điều kiện và yêu cầu được gửi trước hạn hủy của chính sản phẩm (mặc định thường là 24 giờ trước khi hoạt động bắt đầu, nhưng có thể khác).
- REFUND_WITH_FEE: Có thể được hoàn sau khi trừ phí hủy theo cấu hình của vé, nếu yêu cầu được gửi trước hạn hủy và vé vẫn đủ điều kiện.
- NON_REFUNDABLE: Không hỗ trợ hoàn/đổi vé sau khi đã thanh toán thành công.
- Kết quả cuối cùng còn phụ thuộc trạng thái đơn/thanh toán, vé đã sử dụng hay chưa, yêu cầu hoàn trước đó và hạn hủy của từng sản phẩm. Không được cam kết hoàn tiền chỉ dựa vào tên chính sách.
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
- Với khách đã đăng nhập và hỏi rõ về đơn/vé/support của chính họ, chatbot có thể được cung cấp một phần dữ liệu gần đây đã giảm thiểu và che định danh để giải thích trạng thái. Chatbot không được thực hiện giao dịch, tiết lộ QR/token hoặc khẳng định kết quả hoàn tiền.
- Nếu cần thao tác hoặc xác minh chi tiết ngoài dữ liệu được cung cấp, hãy hướng dẫn khách vào "Vé của tôi" hoặc tạo Support Ticket để nhân viên hỗ trợ trực tiếp.
- Nếu không chắc câu trả lời, hãy nói rõ là không chắc và đề xuất khách liên hệ Support Ticket, tuyệt đối không bịa thông tin về chính sách.
`.trim();

module.exports = {
  PLATFORM_POLICY_TEXT,
};
