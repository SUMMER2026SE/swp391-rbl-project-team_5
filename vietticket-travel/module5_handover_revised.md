# Kế hoạch bàn giao & triển khai Module 5 (BẢN ĐÃ HIỆU CHỈNH THEO CODE THẬT)

> Phiên bản này được đối chiếu trực tiếp với mã nguồn trong repo và sửa lại các điểm
> sai/mâu thuẫn so với bản gốc. Những chỗ thay đổi quan trọng được đánh dấu **[SỬA]**.
> Đường dẫn file dùng theo cấu trúc repo: `vietticket-travel/...`.

---

## 🛠️ PHẦN 1: BẢN ĐỒ DATABASE

Các model/enum sau **đã có sẵn** trong [schema.prisma](backend/prisma/schema.prisma), không cần đụng:

- **BookingStatus**: `PENDING_PAYMENT`, `PENDING_PARTNER`, `CONFIRMED`, `CANCELLED`, `COMPLETED`, `REFUND_REQUESTED`, `REFUNDED`
- **RefundStatus**: `PENDING`, `APPROVED`, `REJECTED`
- **SupportStatus**: `OPEN`, `IN_PROGRESS`, `RESOLVED`
- **RefundRequest**: `id`, `bookingId` (unique), `requestedById`, `reason`, `amount`, `status`, `staffNotes`, `processedById`, `createdAt`, `processedAt`, `updatedAt`
- **SupportTicket**: `id`, `userId`, `bookingId?`, `subject`, `description`, `status`, `createdAt`, `updatedAt` + quan hệ `messages`
- **SupportMessage**: `id`, `ticketId`, `senderId`, `message`, `createdAt`
- **Review**: `id`, `userId`, `attractionId`, `rating` (1-5), `comment`, `isHidden`, `replyComment`, `repliedAt`, `createdAt`, `updatedAt`

### [SỬA] Một migration DUY NHẤT cần chạy (cho phần của Như)
Model `Review` hiện **không có `bookingId`** và **không có ràng buộc unique**, nên không thể
ép "mỗi đơn đánh giá 1 lần" như nghiệp vụ yêu cầu. Bổ sung:

```prisma
model Review {
  // ... các field cũ giữ nguyên ...
  bookingId String? @unique   // [THÊM] gắn review với đúng 1 booking
  booking   Booking? @relation(fields: [bookingId], references: [id], onDelete: SetNull)
}

model Booking {
  // ... giữ nguyên ...
  review Review?   // [THÊM] quan hệ ngược
}
```
→ **Hoàng Anh** chạy `npx prisma migrate dev` và thông báo cả team `prisma migrate` lại.
Đây là ngoại lệ có chủ đích so với luật "không migration".

---

## 🧑‍💻 PHẦN 2: ĐẶC TẢ CHO LỘC (Refund VNPay + Support real-time)

### 0. [BỔ SUNG] API khách hàng GỬI yêu cầu hoàn tiền (cho modal A4)
> Hiện **chưa có** endpoint nào cho khách tạo `RefundRequest` / chuyển đơn sang `REFUND_REQUESTED`.
> Modal A4 cần nó. Giao cho Lộc viết trong [paymentController.js](backend/src/controllers/paymentController.js)
> + đăng ký ở [paymentRoutes.js](backend/src/routes/paymentRoutes.js).

* `POST /api/payments/refund-request` (hoặc `/api/bookings/:id/refund-request`) — `protect`, `restrictTo('CUSTOMER')`.
  - Body: `{ bookingId, reason }`.
  - Kiểm tra: đơn thuộc user, đang `CONFIRMED`, `TicketProduct.refundPolicy != NON_REFUNDABLE`,
    và đơn **chưa** có `RefundRequest` (cột `RefundRequest.bookingId` là `@unique` → mỗi đơn chỉ 1 yêu cầu).
  - Dùng `calculateRefundAmount(booking)` có sẵn trong [refundService.js](backend/src/utils/refundService.js)
    để tính `amount` (đã trừ phí hủy).
  - Trong 1 transaction: tạo `RefundRequest { bookingId, requestedById, reason, amount, status: PENDING }`
    và cập nhật `Booking.status = REFUND_REQUESTED`.
  > Lưu ý: vì `bookingId` là `@unique` trên `RefundRequest`, đơn đã bị từ chối hoàn (`REJECTED`) sẽ
  > không tạo lại được — nếu nghiệp vụ cần cho phép yêu cầu lại, phải bỏ `@unique` (migration). Tạm thời
  > giữ nguyên: 1 đơn = 1 lần yêu cầu.

### 1. Tích hợp VNPay Refund API (luồng Staff DUYỆT hoàn)

* **File**: [paymentController.js](backend/src/controllers/paymentController.js) — viết **hàm `refundViaVnpay(...)` và export ra**.
* **[SỬA] Phải viết hàm ký MỚI**: helper trong [vnpay.js](backend/src/utils/vnpay.js)
  (`buildVnpayUrl`/`sortObject`) chỉ ký theo querystring-sort cho luồng `pay` — **KHÔNG dùng được**
  cho refund. Refund ký theo chuỗi nối `|` (xem dưới). Cần thêm biến môi trường **`VNP_API`**
  (URL API refund của Sandbox), bên cạnh `VNP_TMNCODE`/`VNP_HASHSECRET` đã có.
* **[SỬA] Điểm tích hợp**: Hàm `processRefundRequest` trong
  [staffController.js](backend/src/controllers/staffController.js) **ĐÃ tồn tại** và hiện chỉ
  `update status = REFUNDED` trong DB (hoàn tiền "ảo"). Lộc **không tạo luồng mới** mà phối hợp
  Hoàng Anh để chèn lời gọi `refundViaVnpay`.
* **[SỬA] Thứ tự đúng — KHÔNG gọi HTTP trong transaction**: gọi VNPay là I/O mạng chậm; nếu đặt
  trong `prisma.$transaction(Serializable)` sẽ giữ lock DB suốt thời gian chờ → dễ timeout. Luồng đúng:
  1. (Khi `action === 'APPROVED'`) đọc booking + payment, kiểm tra điều kiện.
  2. **Gọi `refundViaVnpay` TRƯỚC, NGOÀI transaction.** Nếu `vnp_ResponseCode !== '00'` → trả lỗi,
     **không** đụng DB (đơn giữ nguyên `REFUND_REQUESTED`).
  3. Chỉ khi cổng trả `00` mới mở transaction cập nhật DB (`releaseInventory`, ticketInstance,
     `Booking.status = REFUNDED`, `RefundRequest.status = APPROVED`).
  - Rủi ro hiếm: cổng hoàn thành công nhưng DB update lỗi → log lại để đối soát thủ công (ghi
    `vnp_TransactionNo` vào `staffNotes`/`Payment.rawResponse`). Chấp nhận được hơn là giữ lock qua HTTP.
  - `action === 'REJECTED'` giữ nguyên logic cũ (không gọi cổng).

* **[SỬA] Phân nhánh theo phương thức thanh toán**: chỉ gọi VNPay khi đơn có `Payment.status = SUCCESS`
  qua cổng VNPay. Đơn thanh toán tiền mặt/khác → bỏ qua cổng, chỉ cập nhật DB (hoàn thủ công).

* **[SỬA] Hoàn TOÀN PHẦN vs MỘT PHẦN**: số tiền hoàn lấy từ `RefundRequest.amount` (đã trừ phí hủy
  theo `TicketProduct.refundPolicy` / `refundFeeRate`). Do đó:
  - Nếu `amount == Booking.totalAmount` → `vnp_TransactionType = "02"` (toàn phần).
  - Nếu `amount < totalAmount` (có phí hủy) → `vnp_TransactionType = "03"` (một phần).
  > Bản gốc ép cứng "02" là **sai** với chính sách hoàn có phí.

* **Tham số gửi VNPay** (POST JSON tới `vnp_Api` của Sandbox; tự đăng ký Merchant Test lấy
  `vnp_TmnCode`, `vnp_HashSecret`, `vnp_Api`):
  `vnp_RequestId` (UUID), `vnp_Version="2.1.0"`, `vnp_Command="refund"`, `vnp_TmnCode`,
  `vnp_TransactionType` (02/03 như trên), `vnp_TxnRef` (mã giao dịch gốc của booking),
  `vnp_Amount` (× 100), `vnp_TransactionNo` (lấy từ `Payment.transactionId`),
  `vnp_TransactionDate`, `vnp_CreateBy` (email staff), `vnp_CreateDate`, `vnp_IpAddr`,
  `vnp_OrderInfo`, `vnp_SecureHash`.

* **[SỬA] Chuỗi ký SHA512**: refund **KHÔNG** ký theo querystring-sort như luồng `pay`. Phải nối
  **đúng thứ tự cố định** rồi HMAC-SHA512 bằng `VNP_HASHSECRET`:
  ```
  vnp_RequestId | vnp_Version | vnp_Command | vnp_TmnCode | vnp_TransactionType |
  vnp_TxnRef | vnp_Amount | vnp_TransactionNo | vnp_TransactionDate |
  vnp_CreateBy | vnp_CreateDate | vnp_IpAddr | vnp_OrderInfo
  ```
  (nối bằng dấu `|`). Sai thứ tự → lỗi `97`.

* **[SỬA] Nguồn `vnp_TransactionDate`**: là thời điểm giao dịch gốc (`YYYYMMDDHHmmss`), lấy từ
  `vnp_PayDate` đã lưu trong `Payment.rawResponse` lúc thanh toán. Nếu chưa lưu, phối hợp để
  bổ sung lưu trường này ở luồng IPN/return.

* **Xử lý kết quả**: `vnp_ResponseCode === "00"` → cho phép update `REFUNDED`. Ngược lại `throw`
  kèm message cụ thể để Staff thấy lỗi trên UI.

### 2. Hệ thống Support Ticket (real-time)

* **[SỬA] TÁI SỬ DỤNG hạ tầng socket đã có** — KHÔNG khởi tạo `new Server()` mới:
  - Server socket đã dựng tại [socketServer.js](backend/src/realtime/socketServer.js) (đã xác thực
    JWT qua cookie, gắn `socket.user = { id, role, partnerProfileId }`).
  - Đã có helper phát sự kiện theo room tại [events.js](backend/src/realtime/events.js)
    (pattern `user:${id}`, `partner:${id}`). Thêm helper mới cùng kiểu, ví dụ
    `emitSupportMessage(ticketId, payload)` phát tới room `ticket:${ticketId}`.
* **[SỬA BẢO MẬT] Kiểm soát quyền vào room**: phải **sửa thêm [socketServer.js](backend/src/realtime/socketServer.js)**
  (file chung của Hoàng Anh — phối hợp). Trong `io.on('connection')` đã có sẵn auto-join `user:`/`partner:`,
  cần đăng ký thêm handler `socket.on('JOIN_SUPPORT_TICKET', async (ticketId) => {...})`: truy vấn ticket,
  chỉ cho `socket.join('ticket:'+ticketId)` khi `socket.user.id === ticket.userId` HOẶC
  `socket.user.role` ∈ {`STAFF`,`ADMIN`}. Không cho join tuỳ tiện (tránh đọc trộm chat).
* **Luồng gửi tin**: `POST /api/support/tickets/:ticketId/messages` → lưu `SupportMessage` →
  `emitSupportMessage` broadcast tới room → đối phương nhận tức thời.

* **API cần viết** (trong `supportController.js` + `supportRoutes.js`):
  1. `POST /api/support/tickets` — khách tạo ticket (`subject`, `description`, optional `bookingId`), status `OPEN`.
  2. `GET /api/support/tickets/my-tickets` — ticket của khách đang đăng nhập.
  3. `GET /api/support/tickets/:ticketId` — chi tiết + messages. Chỉ chủ ticket hoặc Staff/Admin.
  4. `POST /api/support/tickets/:ticketId/messages` — gửi tin (kèm broadcast socket).
  5. `GET /api/support/tickets` — (Staff/Admin) tất cả ticket, lọc theo `status`.
  6. `PATCH /api/support/tickets/:ticketId/status` — đổi trạng thái. Khi Staff gửi tin đầu tiên
     vào ticket `OPEN` → tự động chuyển `IN_PROGRESS`; bấm giải quyết xong → `RESOLVED`.

---

## 👩‍💻 PHẦN 3: ĐẶC TẢ CHO NHƯ (Reviews & Moderation)

* **File**: `reviewController.js` + `reviewRoutes.js` (gắn ở `/api/reviews`, đã đăng ký trong app.js).

> ### ✅ [ĐÃ FIX] Luồng tự động chuyển đơn sang `COMPLETED`
> Trước đây backend **không có** chỗ nào set `status = COMPLETED` → luồng đánh giá không chạy được.
> Đã bổ sung worker [completionWorker.js](backend/src/utils/completionWorker.js) (cùng pattern với
> `cleanupWorker`): mỗi 10 phút quét các đơn `CONFIRMED` đã qua ngày tham quan
> (`reservation.date < 00:00 hôm nay`) và chuyển sang `COMPLETED`. Đã wire vào
> [server.js](backend/src/server.js) (`startCompletionWorker` + clear khi shutdown).
> → Sau ngày tham quan, đơn tự `COMPLETED`, nút "Đánh giá ngay" của Như sẽ hiện đúng.
> Để test ngay không cần chờ, có thể gọi `sweepCompletedBookings()` hoặc set tay 1 đơn về `COMPLETED`.

### Quy tắc nghiệp vụ
1. `GET /api/reviews?attractionId=...` — danh sách review công khai (`isHidden: false`), kèm
   `avatar`, `fullName` (join `User` → `UserProfile`).
2. `POST /api/reviews` — tạo review mới.
   - **[SỬA] Điều kiện**: body nhận `bookingId` (không chỉ `attractionId`). Kiểm tra đơn này là
     của user đang đăng nhập, đang `COMPLETED`, và xác định `attractionId` qua chuỗi join thật:
     `Booking.reservationId → Reservation.ticketProductId → TicketProduct.attractionId`.
   - **[SỬA] Chống trùng**: nhờ `@@unique([bookingId])`, mỗi đơn chỉ review 1 lần. Bọc trong
     transaction để tránh race; bắt lỗi unique để trả 409 thân thiện.
   - **[SỬA] Tính lại điểm**: sau khi tạo, `aggregate` `avg(rating)` và `count` trên các review
     **`isHidden: false`** của attraction đó rồi cập nhật `averageRating`, `totalReviews`.
3. `POST /api/reviews/:reviewId/reply` — (Partner) trả lời review.
   - **[SỬA] `req.user` KHÔNG kèm `partnerProfile`** (middleware `protect` chỉ nạp `profile`). Route
     này phải dùng middleware `requirePartner` + `requireApprovedPartner` (đã có) để có `req.partner`,
     rồi so `attraction.partnerId === req.partner.id`. Cập nhật `replyComment` + `repliedAt = now`.
4. `PATCH /api/reviews/:reviewId/moderate` — (Admin/Staff) ẩn/hiện review.
   - Cập nhật `isHidden`, và **tính lại `averageRating`/`totalReviews` ngay** (luôn chỉ tính trên
     `isHidden: false`) để điểm hiển thị chính xác.

---

## 🖥️ PHẦN 4: THIẾT KẾ GIAO DIỆN

### 🧑‍💻 A. CÁC TRANG CỦA LỘC

#### A1. `/support` → `src/pages/SupportCenterPage.jsx` *(file MỚI)*
Khách tạo ticket. Card max-width 600px, tông xanh mòng két `#006068`. Form:
- Dropdown chủ đề: *Lỗi thanh toán / Yêu cầu hoàn vé / Phản ánh dịch vụ / Trợ giúp khác*.
- Dropdown đơn liên quan (optional): API lấy đơn `CONFIRMED`/`COMPLETED`, hiển thị
  `[Mã đơn] - [Tên địa điểm] - [Ngày tham quan]`.
- Input tiêu đề; Textarea nội dung (≥ 10 ký tự); Nút gửi có trạng thái loading.
- Toast thành công → chuyển sang `/my-support`.

#### A2. `/my-support` → `src/pages/MySupportTicketsPage.jsx` *(file MỚI)*
Split-view: cột trái danh sách ticket (badge: `OPEN` xám, `IN_PROGRESS` xanh dương,
`RESOLVED` xanh lá; snippet tin cuối + thời gian). Cột phải khung chat real-time:
- Tin khách: căn phải, nền `#006068`, chữ trắng. Tin Staff: căn trái, nền `#F3F4F6`, chữ đen.
- Mỗi tin có tên người gửi + giờ/phút.
- Nếu ticket `RESOLVED`: ẩn ô nhập, thay bằng banner *"Yêu cầu này đã được giải quyết và đóng
  lại. Vui lòng tạo yêu cầu mới nếu bạn cần hỗ trợ thêm."*

#### A3. `/staff/tickets` → [SupportTicketsPage.jsx](src/pages/staff/SupportTicketsPage.jsx) *(thay placeholder)*
2 pane: trái = hàng đợi (tìm theo mã ticket/tên khách; tab lọc OPEN/IN_PROGRESS/RESOLVED).
Phải = hội thoại real-time + Info Panel (họ tên, email, SĐT khách) + nút **"Đánh dấu đã giải
quyết"** (→ `RESOLVED`). Khi Staff gửi tin đầu cho ticket `OPEN` → tự động `IN_PROGRESS` và
cập nhật real-time sang UI khách.

#### A4. `/my-tickets` — modal "Yêu cầu hoàn tiền"
> **[SỬA] KHÔNG sửa trực tiếp [MyTicketsPage.jsx](src/pages/MyTicketsPage.jsx)** (Như cũng cần
> file này). **Lộc tạo component riêng** `src/components/tickets/RefundModal.jsx` và chỉ thêm
> **đúng 1 dòng import + 1 nút** vào MyTicketsPage (xem Phần 5 về chống conflict).

Vé `CONFIRMED` có chính sách cho hoàn → nút **"Yêu cầu hoàn tiền"**. Modal hiển thị: giá gốc,
chính sách hoàn (miễn phí / mất phí X%), số thực nhận dự kiến, textarea lý do (bắt buộc), nút
**"Xác nhận gửi yêu cầu"** (màu đỏ). Gửi → đơn sang `REFUND_REQUESTED`, đóng modal.

### 👩‍💻 B. CÁC TRANG CỦA NHƯ

#### B1. `/my-tickets` — modal "Đánh giá dịch vụ"
> **[SỬA]** Tương tự A4: **Như tạo component riêng** `src/components/tickets/ReviewModal.jsx`,
> chỉ thêm 1 import + 1 nút vào MyTicketsPage.

Vé `COMPLETED` và đơn đó chưa có review → nút **"Đánh giá ngay"**. Modal: 5 sao hover đổi màu
vàng + click chọn; textarea nhận xét; nút gửi. Gửi xong ẩn nút để tránh trùng (kiểm theo
`bookingId`).

#### B2. `/attractions/:id` → [AttractionDetailPage.jsx](src/pages/AttractionDetailPage.jsx) — tab Review thật
Thay mock bằng data thật: điểm trung bình (`averageRating`) + số lượt (`totalReviews`); danh
sách review (avatar, tên ẩn bớt ví dụ `N*** T***`, số sao vàng, ngày, nội dung). Nếu có
`replyComment`: hiện khung thụt lề nền nhạt *"Phản hồi từ Đối tác:"* + `repliedAt`.

#### B3. `/partner/reviews` → [PartnerReviewsPage.jsx](src/pages/PartnerReviewsPage.jsx) *(thay placeholder)*
Stats trên cùng: điểm TB toàn bộ địa điểm của Partner, tổng đánh giá, số chưa phản hồi.
Feed card: thông tin review + tên địa điểm. Chưa phản hồi → nút "Viết phản hồi" (mở input + gửi);
đã phản hồi → hiện nội dung + nút "Chỉnh sửa phản hồi".

#### B4. `/admin/reviews` → [ReviewModerationPage.jsx](src/pages/admin/ReviewModerationPage.jsx) *(thay placeholder)*
Bảng: Tên khách, Địa điểm, Sao, Nội dung, Ngày, Trạng thái, Hành động. Nút toggle:
đang hiện → đỏ "Ẩn đánh giá vi phạm" (`isHidden=true`); đang ẩn → xanh "Hiển thị lại"
(`isHidden=false`). Có ô tìm theo từ khoá bình luận + lọc theo số sao (lọc nhanh 1-2 sao).

---

## ⚡ PHẦN 5: QUY TRÌNH HỢP TÁC KHÔNG CONFLICT

1. **KHÔNG CHẠM**: [app.js](backend/src/app.js) (route backend đã đăng ký sẵn).
2. **[SỬA] AppRoutes.jsx do Hoàng Anh xử lý**: 3 route `/staff/tickets`, `/partner/reviews`,
   `/admin/reviews` đã có. Còn **thiếu `/support` và `/my-support`** → **Hoàng Anh đăng ký bổ sung**
   2 route + import (Lộc chỉ tạo file page). Lộc/Như **không tự sửa AppRoutes**.
3. **[SỬA] Tránh đụng MyTicketsPage**: cả Lộc (RefundModal) và Như (ReviewModal) đều cần trang
   `/my-tickets`. Để không conflict:
   - Mỗi người tạo **component riêng** trong `src/components/tickets/`.
   - Việc gắn 2 nút + 2 import vào [MyTicketsPage.jsx](src/pages/MyTicketsPage.jsx) gom về **1 người
     làm 1 commit nhỏ** (hoặc nhờ Hoàng Anh chèn), để không có 2 nhánh cùng sửa 1 file.
4. **[SỬA] staffController.js là code của Hoàng Anh**: việc nối VNPay refund vào
   `processRefundRequest` phải **phối hợp trực tiếp với Hoàng Anh** (Lộc export hàm, Hoàng Anh gọi),
   không tự ý viết đè.
5. **File riêng từng người**:
   - **Lộc**: `supportController.js`, `supportRoutes.js`, `paymentController.js` (hàm refund +
     `createRefundRequest`), `paymentRoutes.js` (thêm route refund-request — file chung, phối hợp),
     `realtime/events.js` + `realtime/socketServer.js` (helper + handler join room — file chung của
     Hoàng Anh, **phải phối hợp**), `SupportTicketsPage.jsx`, `SupportCenterPage.jsx`,
     `MySupportTicketsPage.jsx`, `components/tickets/RefundModal.jsx`, component chat mới.
   - **Như**: `reviewController.js`, `reviewRoutes.js` (middleware hỗn hợp: `GET` công khai,
     `POST` cần `protect`+`CUSTOMER`, `reply` cần `requirePartner`+`requireApprovedPartner`,
     `moderate` cần `protect`+`restrictTo('ADMIN','STAFF')`), `AttractionDetailPage.jsx` (phần render
     review), `PartnerReviewsPage.jsx`, `ReviewModerationPage.jsx`, `components/tickets/ReviewModal.jsx`.
6. **Nhánh git**: Lộc `git checkout -b Loc_Module5`, Như `git checkout -b Nhu_Module5`; PR vào
   nhánh phát triển chung để Hoàng Anh review & merge.
