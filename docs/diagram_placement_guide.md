# Hướng dẫn chèn Sequence Diagram vào Google Doc (SDS)

Thư mục ảnh: `docs/diagrams/`
Mỗi mục trong Google Doc đã có sẵn chỗ giữ chỗ dạng `[SEQUENCE DIAGRAM PLACEHOLDER - <mục>]`
trong phần **c. Sequence Diagram(s)**.

## Cách chèn thủ công (mỗi ảnh)
1. Trong Google Docs nhấn **Ctrl+F**, gõ số mục (ví dụ `PLACEHOLDER - 1.1`) để nhảy tới đúng chỗ.
2. Bôi đen dòng placeholder rồi xoá (hoặc đặt con trỏ ngay dưới nó).
3. **Chèn → Hình ảnh → Tải lên từ máy tính** → chọn file PNG tương ứng trong `docs/diagrams/`.

---

## Module 1 — Authentication (mục 1.x)

| File PNG | Mục trong doc (c. Sequence Diagram(s)) |
|----------|-----------------------------------------|
| `02_register.png` | 1.1 Register Account |
| `03_verify_email.png` | 1.2 Verify Email |
| `04_resend_verification.png` | 1.3 Resend Verification Email |
| `05_login.png` | 1.4 Login |
| `06_google_login.png` | 1.5 Google Login |
| `10_logout.png` | 1.6 Logout |
| `09_get_me.png` | 1.7 Get Current User |
| `07_forgot_password.png` | 1.8 Forgot Password |
| `08_reset_password.png` | 1.9 Reset Password |
| `11_get_profile.png` | 1.10 View Profile |
| `12_update_profile.png` | 1.11 Update Profile |
| `13_upload_avatar.png` | 1.12 Upload Avatar |
| `14_change_password.png` | 1.13 Change Password |
| `01_auth_middleware_protect.png` | Placeholder đã thêm dưới **1.7** (xem bảng "sơ đồ dùng chung" bên dưới). |

## Module 3 (puml) — Ticket / Booking / Payment / Refund (mục 4.x & 5.x)

| File PNG | Mục trong doc (c. Sequence Diagram(s)) |
|----------|-----------------------------------------|
| `M3_01_check_availability.png` | 4.10 Check Ticket Availability |
| `M3_02_reserve_hold.png` | 4.11 Reserve Tickets |
| `M3_14_get_reservation.png` | 5.1 Get Reservation Checkout |
| `M3_03_apply_voucher.png` | 5.2 Apply Voucher |
| `M3_04_create_booking.png` | 5.3 Create Booking |
| `M3_16_list_bookings.png` | 5.4 List Customer Bookings |
| `M3_15_get_booking.png` | 5.5 View Booking Detail |
| `M3_05_create_vnpay_url.png` | 5.6 Create VNPay Payment URL |
| `M3_07_vnpay_ipn.png` | 5.7 Handle VNPay IPN |
| `M3_08_vnpay_return.png` | 5.8 Handle VNPay Return |
| `M3_12_refund_preview.png` | 5.12 Get Refund Preview |
| `M3_11_create_refund_request.png` | 5.13 Create Refund Request |

### Sơ đồ KHÔNG có mục riêng — ĐÃ thêm placeholder vào Google Doc
Các dòng placeholder dưới đây đã được chèn sẵn vào Google Doc (ngay dưới placeholder của mục liên quan).
Chỉ cần Ctrl+F tới dòng placeholder rồi chèn ảnh như bình thường.

| File PNG | Nội dung | Placeholder trong doc (đã thêm) |
|----------|----------|----------------------------------|
| `01_auth_middleware_protect.png` | Middleware `protect` dùng chung | Dưới **1.7**: `[... Auth Middleware (protect) - shared by 1.6, 1.7, 1.10-1.13]` |
| `M3_09_cleanup_worker_hold_expiry.png` | Worker tự huỷ đơn giữ chỗ hết hạn | Dưới **4.11**: `[... Cleanup Worker (auto-expire held reservations)]` |
| `M3_10_completion_worker.png` | Worker tự hoàn tất / no-show | Dưới **5.5**: `[... Completion Worker (auto-complete / no-show)]` |
| `M3_06_reconcile_vnpay_payment.png` | Hàm đối soát dùng chung cho IPN & Return | Dưới **5.7**: `[... Reconcile VNPay Payment (shared by 5.7 IPN & 5.8 Return)]` |
| `M3_13_refund_worker.png` | Worker gọi VNPay hoàn tiền | Dưới **6.2**: `[... Refund Worker (process refund transactions via VNPay)]` |

---

## Ghi chú về "sửa lỗi" trong doc
Đã đối chiếu doc ↔ mã nguồn backend: các endpoint/logic trong Module 1 & 3 của doc **khớp code**
(vd 4.11 ghi đúng `POST /api/tickets/:ticketProductId/reserve; protect -> restrictTo('CUSTOMER')`,
5.6 dùng đúng `create-vnpay-url`). Các "path sai" nêu ở bước trước là do công cụ **tóm tắt tự động bịa ra**,
không phải lỗi thật trong tài liệu. Nếu phát hiện điểm sai cụ thể, ghi lại số mục để sửa đúng chỗ.
