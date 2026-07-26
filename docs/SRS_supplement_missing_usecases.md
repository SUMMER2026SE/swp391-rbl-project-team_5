# SRS Supplement — Missing Use Cases (đối chiếu với mã nguồn thật)

> Tài liệu này bổ sung các use case đang **có trong code** (`vietticket-travel/backend`) nhưng **thiếu** trong 3 phần:
> 3.2 Authentication & Profile Management, 3.3 Attraction Discovery & Favorites, 3.4 Booking & Payment.
> Giữ nguyên format UC của SRS gốc để dán thẳng vào Google Doc. Cuối tài liệu là **danh sách sửa endpoint ghi sai**.

---

## Bổ sung cho 3.2 — Authentication & Profile Management

### UC13 – Restore Session / Get Current User
**Actors:** Authenticated user
**Trigger:** Frontend tải lại trang hoặc khởi động app, cần khôi phục phiên từ cookie JWT
**Description:** Trả về thông tin người dùng hiện tại dựa trên JWT trong HttpOnly cookie, để đồng bộ lại state/localStorage sau khi refresh.
**Preconditions:**
- Có `auth_token` cookie hợp lệ

**Postconditions:**
- Trả về hồ sơ người dùng đã "sanitize" (bỏ passwordHash)

**Normal Flow:**
1. Frontend gọi `GET /api/auth/me`
2. Middleware `protect` xác thực JWT từ cookie
3. Backend nạp user + profile, loại bỏ trường nhạy cảm
4. Trả HTTP 200 với `{ user }`

**Exceptions:**
- E1: Không có/không hợp lệ token → HTTP 401 → frontend `clearSession()`

**Business Rules:**
- BR1: Không bao giờ trả `passwordHash`
- BR2: Endpoint chỉ đọc, không đổi trạng thái

**Endpoint:** GET /api/auth/me

---

## Bổ sung cho 3.3 — Attraction Discovery & Favorites

### UC_M2.20 – Explore Attractions on Map
**Actors:** Guest, Customer
**Trigger:** Người dùng mở chế độ xem bản đồ trên trang khám phá
**Description:** Trả về danh sách điểm đến có toạ độ để hiển thị marker trên bản đồ (kèm ảnh chính và giá vé thấp nhất).
**Preconditions:**
- Hệ thống hoạt động bình thường

**Postconditions:**
- Danh sách điểm (lat/lng, ảnh, giá tối thiểu) được trả về

**Normal Flow:**
1. Frontend gọi `GET /api/attractions/map-points`
2. Backend truy vấn các attraction công khai (`publishedAt != null`, `publicationStatus = ACTIVE`, chưa lưu trữ, không SUSPENDED) **và có cả latitude/longitude**
3. Lấy ảnh chính + vé ACTIVE rẻ nhất mỗi điểm
4. Trả về `{ points, total }`

**Business Rules:**
- BR_M2.20.1: Chỉ hiển thị điểm đến công khai và **có toạ độ**; điểm thiếu lat/lng bị loại
- BR_M2.20.2: Chỉ tính giá từ vé `status = ACTIVE`

**Endpoint:** GET /api/attractions/map-points *(phải khai báo trước route `/:id`)*

---

### UC_M2.21 – View My Favorites List
**Actors:** Customer
**Trigger:** Customer mở trang "Địa điểm yêu thích"
**Description:** Hiển thị danh sách attraction đã lưu, sắp xếp mới nhất trước; tự ẩn các điểm đã bị gỡ/khoá.
**Preconditions:**
- Customer đã đăng nhập

**Postconditions:**
- Danh sách favorite (đã lọc điểm còn hoạt động) được trả về

**Normal Flow:**
1. Frontend gọi `GET /api/favorites`
2. Backend lấy `FavoriteAttraction` của user, **chỉ giữ** điểm đang công khai (`publishedAt != null`, `publicationStatus = ACTIVE`, `status != SUSPENDED`, chưa lưu trữ)
3. Map dữ liệu (ảnh chính, rating, giá tối thiểu), sắp xếp `createdAt` giảm dần
4. Trả về `{ favorites }`

**Business Rules:**
- BR_M2.21.1: Điểm đã bị SUSPENDED/lưu trữ **không** hiển thị dù vẫn nằm trong bảng favorite

**Endpoint:** GET /api/favorites

> **Lưu ý:** Đây là UC "xem danh sách", tách biệt với UC_M2.03 (toggle lưu/bỏ lưu).

---

### UC_M2.22 – Write Review (After Visit)
**Actors:** Customer
**Trigger:** Customer bấm "Viết đánh giá" trên đơn đã hoàn tất chuyến đi
**Description:** Customer chấm sao (1–5) và viết nhận xét cho một booking đã sử dụng; hệ thống tính lại điểm trung bình của điểm đến.
**Preconditions:**
- Customer đăng nhập và sở hữu booking
- Booking đủ điều kiện: `COMPLETED`, hoặc `CONFIRMED` + đã check-in ≥ 1 vé + đã qua giờ tham quan

**Postconditions:**
- `Review` được tạo (`isHidden = false`)
- `averageRating` và `totalReviews` của attraction được tính lại

**Normal Flow:**
1. Customer nhập `rating` (1–5) và `comment` (≤ 2000 ký tự)
2. Gửi `POST /api/reviews` với `{ bookingId, rating, comment }`
3. Backend kiểm tra quyền sở hữu booking + điều kiện đủ tư cách (`isReviewEligible`)
4. Trong transaction: tạo review + gọi `recalculateAttractionRating`
5. Trả HTTP 201 "Gửi đánh giá thành công!"

**Exceptions:**
- E1: Booking không thuộc user → HTTP 404
- E2: Chưa đủ điều kiện review → HTTP 400 (kèm lý do)
- E3: Booking đã được đánh giá → HTTP 400 (race: unique bookingId → HTTP 409)
- E4: Rating ngoài 1–5 hoặc comment > 2000 ký tự → HTTP 400

**Business Rules:**
- BR_M2.22.1: Mỗi booking chỉ được đánh giá **một lần** (unique `bookingId`)
- BR_M2.22.2: Điểm trung bình chỉ tính trên review `isHidden = false`

**Endpoints:** POST /api/reviews (viết); GET /api/reviews?attractionId=…&page=&limit=&rating= (đọc công khai + histogram sao); POST /api/reviews/:reviewId/reply (partner phản hồi); PATCH /api/reviews/:reviewId/moderate (admin/staff ẩn/hiện)

---

## Bổ sung cho 3.4 — Booking & Payment

### UC-03-06 – Check Ticket Availability
**Actors:** Guest, Customer
**Trigger:** Người dùng chọn ngày tham quan trên trang chi tiết vé
**Description:** Trả về số chỗ còn trống theo từng khung giờ (hoặc "vé trong ngày"), lấy min của 3 tầng tồn kho: sản phẩm vé, sức chứa điểm đến, và khung giờ.
**Preconditions:**
- Ticket product tồn tại

**Postconditions:**
- Danh sách khung giờ + `availableTickets` được trả về (không đổi dữ liệu)

**Normal Flow:**
1. Frontend gọi `GET /api/tickets/:ticketProductId/availability?date=YYYY-MM-DD`
2. Backend nạp lịch (`getBookableSchedule`); nếu ngày đóng cửa → trả mảng rỗng + `meta.closed = true`
3. Đọc `DailyStock`, `AttractionDailyStock`, `TimeSlotStock`
4. Tính `available = capacity − booked − held` cho từng tầng
5. Với mỗi slot: `availableTickets = min(slot, product, attraction)`; nếu không có slot → mục "Vé sử dụng trong ngày"

**Exceptions:**
- E1: Sai định dạng ngày → HTTP 400 (VALIDATION_ERROR)

**Business Rules:**
- BR-06-1: Chỗ trống bị chặn bởi **tầng thấp nhất** trong 3 tầng tồn kho
- BR-06-2: Ngày đóng cửa (special date) trả về "closed", không cho đặt

**Endpoint:** GET /api/tickets/:ticketProductId/availability

---

### UC-03-07 – View My Reservations & Bookings
**Actors:** Customer
**Trigger:** Customer mở trang "Vé của tôi" hoặc màn hình xác nhận giữ chỗ
**Description:** Customer xem đơn giữ chỗ đang chờ và danh sách/booking chi tiết đã đặt.
**Preconditions:**
- Customer đăng nhập; chỉ xem đơn của chính mình

**Postconditions:**
- Dữ liệu reservation/booking của user được trả về

**Normal Flow:**
1. `GET /api/bookings` → danh sách booking của user (mới nhất trước)
2. `GET /api/bookings/:bookingId` → chi tiết một booking
3. `GET /api/bookings/reservations/:reservationId` → chi tiết đơn giữ chỗ (đếm ngược 10 phút)

**Exceptions:**
- E1: Bản ghi không thuộc user → HTTP 404 ("Không tìm thấy đơn…")

**Business Rules:**
- BR-07-1: Bắt buộc kiểm tra `userId` khớp — không lộ đơn của người khác

**Endpoints:** GET /api/bookings; GET /api/bookings/:bookingId; GET /api/bookings/reservations/:reservationId

---

### UC-03-08 – VNPay Return (Browser Redirect)
**Actors:** Customer, VNPay
**Trigger:** VNPay redirect trình duyệt khách về `returnUrl` sau khi thanh toán
**Description:** Xác minh chữ ký trên URL trả về, **đối soát idempotent** (fallback cho môi trường local nơi VNPay không gọi được IPN vào localhost), rồi chuyển hướng khách tới trang kết quả.
**Preconditions:**
- Query có tham số VNPay + chữ ký

**Postconditions:**
- Nếu hợp lệ: gọi `reconcileVnpayPayment` (idempotent với IPN)
- Redirect về `/booking-success?bookingId=…&status=…&vnp_ResponseCode=…`

**Normal Flow:**
1. Trình duyệt mở `GET /api/payments/vnpay-return?...`
2. Backend verify HMAC-SHA512; nếu hợp lệ & có `TxnRef` → đối soát
3. Xác định `status` ∈ {success, failed, invalid}
4. Redirect về frontend kèm `bookingId` và mã kết quả

**Alternative Flows:**
- AF1: IPN đã đối soát trước → return chỉ đọc lại kết quả (idempotent, không cộng kho lần hai)

**Business Rules:**
- BR-08-1: Return **không được** là nguồn tin cậy duy nhất — chỉ đóng vai trò fallback; IPN (UC-03-05) mới là kênh chính
- BR-08-2: Chữ ký sai hoặc chưa đối soát được với `responseCode=00` → `status = invalid`

**Endpoint:** GET /api/payments/vnpay-return

---

### UC-03-09 – Request Refund (Customer)
**Actors:** Customer
**Secondary Actors:** System (email), Platform Staff (duyệt ở UC-03-10)
**Trigger:** Customer bấm "Yêu cầu hoàn tiền" trên đơn đã xác nhận
**Description:** Customer xem trước số tiền hoàn (đã trừ phí) rồi gửi yêu cầu; hệ thống tạo `RefundRequest` (PENDING) và chuyển đơn sang `REFUND_REQUESTED`.
**Preconditions:**
- Customer sở hữu booking, `status = CONFIRMED`
- Chính sách vé ≠ `NON_REFUNDABLE`
- Còn trước hạn hoàn (`isBeforeRefundCutoff` — trước ngày sử dụng)
- Chưa có yêu cầu hoàn nào cho đơn

**Postconditions:**
- `RefundRequest` (PENDING) được tạo với `amount = refundAmount`
- Booking → `REFUND_REQUESTED`
- Email xác nhận đã tiếp nhận yêu cầu được gửi

**Normal Flow:**
1. `GET /api/payments/refund-preview/:bookingId` → hiển thị `refundAmount`, `feeAmount`, `refundPolicy`, `refundable`, lý do nếu không đủ điều kiện
2. Customer nhập lý do (≥ 5 ký tự), xác nhận
3. `POST /api/payments/refund-request` với `{ bookingId, reason }`
4. Transaction (Serializable): kiểm tra điều kiện, tạo RefundRequest, cập nhật booking
5. Gửi email `sendRefundRequestReceivedEmail`, trả HTTP 201

**Exceptions:**
- E1: Không sở hữu booking → HTTP 404
- E2: Đơn không `CONFIRMED` → HTTP 409
- E3: Vé `NON_REFUNDABLE` → HTTP 400
- E4: Quá hạn hoàn → HTTP 409
- E5: Đã có yêu cầu hoàn → HTTP 409
- E6: Lý do < 5 ký tự → HTTP 400

**Business Rules:**
- BR-09-1: `refundAmount` tính theo `refundPolicy` + `refundFeeRate` **snapshot tại thời điểm đặt** (không đổi khi partner sửa giá sau này)
- BR-09-2: Mỗi booking chỉ một `RefundRequest`

**Endpoints:** GET /api/payments/refund-preview/:bookingId; POST /api/payments/refund-request

---

### UC-03-10 – Process Refund Request (Platform Staff)
**Actors:** Platform Staff (nhân viên nội bộ nền tảng), Admin
**Secondary Actors:** VNPay, Customer
**Trigger:** Staff mở màn hình "Yêu cầu hoàn tiền", chọn Duyệt/Từ chối
**Description:** Staff nội bộ duyệt hoặc từ chối yêu cầu hoàn tiền. Khi duyệt đơn trả online: **gọi cổng VNPay hoàn tiền trước**, thành công mới ghi DB (giải phóng kho, huỷ vé, đơn → REFUNDED).
**Preconditions:**
- `isPlatformStaff(user)` = true
- `RefundRequest.status = PENDING`

**Postconditions:**
- RefundRequest → APPROVED/REJECTED (qua trạng thái trung gian PROCESSING để chống tranh chấp)
- Nếu duyệt: `RefundTransaction` tạo & gọi cổng; kho được `releaseInventory`; vé → REFUNDED; booking → REFUNDED
- Email `sendRefundStatusEmail` gửi khách

**Normal Flow (Approve):**
1. `GET /api/staff/refunds?status=&search=&page=&limit=` → danh sách + thống kê theo trạng thái
2. Staff bấm "Duyệt" → `PATCH /api/staff/refunds/:refundId` `{ action: 'APPROVED', staffNotes? }`
3. Chiếm việc: cập nhật PENDING → PROCESSING (guard chống 2 staff xử lý cùng lúc)
4. Nếu có thanh toán VNPay: tạo `RefundTransaction`, gọi `refundViaVnpay` (02 = toàn phần, 03 = một phần khi có phí)
5. Cổng OK → transaction (Serializable): release kho, vé → REFUNDED, booking → REFUNDED
6. Gửi email, trả kết quả

**Alternative Flows:**
- AF1: Reject → `action = 'REJECTED'` + `staffNotes` **bắt buộc**; nếu khách tự yêu cầu (REFUND_REQUESTED) thì trả đơn về CONFIRMED
- AF2: Cổng VNPay từ chối → HTTP 502, **không** đụng DB (đơn giữ REFUND_REQUESTED)
- AF3: Cổng đã hoàn nhưng ghi DB lỗi → `RefundTransaction` = `NEEDS_RECONCILIATION`, log đối soát thủ công

**Exceptions:**
- E1: Không phải platform staff → HTTP 403
- E2: Yêu cầu không PENDING → HTTP 409
- E3: Từ chối yêu cầu hoàn **bắt buộc** (`refundRequired = true`) → HTTP 400
- E4: Từ chối thiếu `staffNotes` → HTTP 400

**Business Rules:**
- BR-10-1: Chỉ **nhân viên nền tảng** (không phải nhân viên đối tác) mới xử lý hoàn tiền
- BR-10-2: Gọi cổng thanh toán **trước**, ghi DB **sau** — đảm bảo không đánh dấu REFUNDED khi tiền chưa thực sự hoàn
- BR-10-3: Đơn CANCELLED (partner từ chối) giữ `refundRequired` để tiếp tục đối soát

**Endpoints:** GET /api/staff/refunds; PATCH /api/staff/refunds/:refundId

---

### UC-03-11 – Gate Check-in via QR
**Actors:** Partner Check-in Staff, Admin
**Trigger:** Nhân viên quét mã QR của khách tại cổng
**Description:** Nhân viên tra cứu vé theo token QR rồi check-in **cả đơn** (mọi vé VALID → USED). E-ticket hiển thị một mã QR cho cả booking nên check-in theo đơn.
**Preconditions:**
- Nhân viên có role STAFF/ADMIN, đối tác chủ quản còn hoạt động (`requireActiveEmployer`)
- Nhân viên được phân công địa điểm của vé (admin bỏ qua)

**Postconditions:**
- Tất cả vé VALID của booking → USED, ghi `checkedInAt`, `checkedInById`
- Ghi `AuditLog` `TICKET_CHECKED_IN`

**Normal Flow:**
1. `GET /api/staff/checkin/:token` → xem thông tin vé + `canCheckIn` + `blockReason` (chỉ đọc)
2. Nếu hợp lệ, `POST /api/staff/checkin/:token`
3. Transaction (Serializable): `updateMany` các vé VALID của booking → USED (guard chống quét trùng)
4. Trả "Check-in thành công N vé"

**Exceptions:**
- E1: Token không tồn tại → HTTP 404
- E2: Không được phân công địa điểm → HTTP 403
- E3: Vé đã USED / REFUNDED / EXPIRED, hoặc đơn không CONFIRMED, hoặc sai ngày tham quan → HTTP 409 (kèm lý do cụ thể)
- E4: Bị nhân viên khác check-in trước (count = 0) → HTTP 409

**Business Rules:**
- BR-11-1: Chỉ check-in đúng **ngày tham quan** (giờ VN)
- BR-11-2: Token QR chấp nhận cả chuỗi `VIETTICKET:<token>` lẫn token thuần
- BR-11-3: Check-in theo **đơn**, không theo từng vé lẻ

**Endpoints:** GET /api/staff/checkin/:token; POST /api/staff/checkin/:token

---

### UC-03-12 – Reissue E-Ticket
**Actors:** Partner Check-in Staff, Admin
**Trigger:** Khách mất/không mở được QR, nhân viên cấp lại vé
**Description:** Thu hồi các vé VALID hiện tại (→ EXPIRED) và phát hành vé mới với QR token mới cho cùng booking.
**Preconditions:**
- Booking `CONFIRMED`/`COMPLETED`, còn vé VALID
- Nhân viên được phân công địa điểm của đơn

**Postconditions:**
- Vé VALID cũ → EXPIRED; tạo `TicketInstance` mới (QR mới), gửi email `sendReissueTicketEmail`

**Normal Flow:**
1. `POST /api/staff/bookings/:bookingId/reissue`
2. Transaction (Serializable): kiểm tra quyền + trạng thái, EXPIRE vé cũ, tạo vé mới số lượng tương ứng
3. Gửi email, trả danh sách vé mới

**Exceptions:**
- E1: Không tìm thấy đơn → HTTP 404
- E2: Đơn không CONFIRMED/COMPLETED → HTTP 409
- E3: Không còn vé VALID → HTTP 400

**Business Rules:**
- BR-12-1: Vé cũ bị vô hiệu ngay (khi check-in sẽ báo "đã thu hồi, mở vé mới nhất")

**Endpoint:** POST /api/staff/bookings/:bookingId/reissue

---

### UC-03-13 – View Today's Gate Bookings
**Actors:** Partner Check-in Staff, Admin
**Trigger:** Nhân viên mở màn hình "Khách hôm nay"
**Description:** Liệt kê các đơn CONFIRMED/COMPLETED có ngày tham quan là hôm nay (giờ VN) để đối chiếu khách đến cổng; lọc theo địa điểm được phân công.
**Preconditions:**
- Nhân viên STAFF/ADMIN

**Postconditions:**
- Danh sách đơn hôm nay + trạng thái check-in được trả về

**Normal Flow:**
1. `GET /api/staff/bookings/today`
2. Xác định các attraction được phân công (admin xem tất cả)
3. Truy vấn booking ngày hôm nay, tính `checkedIn`/`usedCount`/`validCount`
4. Trả về `data` + `meta { date, total, checkedIn }`

**Business Rules:**
- BR-13-1: Nhân viên chỉ thấy đơn thuộc **địa điểm được phân công**

**Endpoint:** GET /api/staff/bookings/today

---

### UC-03-14 – Auto-Expire Held Reservations (Background Worker)
**Actors:** System (cleanupWorker)
**Trigger:** Hẹn giờ chạy mỗi ~1 phút
**Description:** Giải phóng các đơn giữ chỗ HELD đã quá hạn (kèm 3 phút ân hạn cho IPN trả trễ), trả `heldQuantity` về kho và gửi email báo hết hạn.
**Preconditions:**
- Có `Reservation` HELD với `expiresAt` < now − grace

**Postconditions:**
- Reservation HELD hết hạn được huỷ, kho được hoàn; email `sendHoldExpiredEmail`

**Normal Flow:**
1. Worker acquire distributed lock (`ScheduledJobLock`) — chỉ một instance chạy khi scale ngang
2. Tìm reservation HELD quá hạn, hoàn `heldQuantity` (Daily/TimeSlot stock)
3. Nhả lock

**Business Rules:**
- BR-14-1: Hiện thực BR-01 (hold 10 phút tự hết hạn); grace 3 phút tránh huỷ nhầm khi IPN về trễ
- BR-14-2: Lock có TTL để tự nhả nếu process crash

**Cơ chế:** `utils/cleanupWorker.js` (job `cleanup_expired_reservations`)

---

### UC-03-15 – Auto-Complete / No-Show Bookings (Background Worker)
**Actors:** System (completionWorker)
**Trigger:** Hẹn giờ chạy mỗi ~10 phút
**Description:** Với các đơn CONFIRMED đã qua ngày tham quan: đơn có ≥ 1 vé USED → COMPLETED; đơn không vé nào USED → NO_SHOW (để không mở nhầm quyền đánh giá).
**Preconditions:**
- Có booking CONFIRMED với `reservation.date` < 00:00 hôm nay (giờ VN)

**Postconditions:**
- Booking → COMPLETED hoặc NO_SHOW

**Business Rules:**
- BR-15-1: Chỉ đơn đã check-in mới COMPLETED; NO_SHOW không được mở quyền review (liên kết BR_M2.22.1)

**Cơ chế:** `utils/completionWorker.js` (job `completion_bookings`)

---

### UC-03-16 – Retry Pending Refund Transactions (Background Worker)
**Actors:** System (refundWorker)
**Trigger:** Hẹn giờ chạy mỗi ~1 phút
**Description:** Quét các `RefundTransaction` còn PENDING (ví dụ hoàn tiền cho payment trùng/lỗi tạm thời), gọi lại cổng VNPay và cập nhật kết quả.
**Preconditions:**
- Có `RefundTransaction.status = PENDING`

**Postconditions:**
- Giao dịch được gọi cổng lại; cập nhật SUCCESS/FAILED tương ứng

**Business Rules:**
- BR-16-1: Claim từng giao dịch bằng guard PENDING → PROCESSING để không xử lý trùng
- BR-16-2: Chạy dưới job-lease để tránh nhiều instance cùng quét

**Cơ chế:** `utils/refundWorker.js`

---

## Sửa các endpoint/method ghi SAI trong SRS gốc

| UC | SRS gốc ghi | Đúng theo code | Nguồn |
|----|-------------|----------------|-------|
| UC_M2.03 (Save Favorite) | `POST /api/favorites/:id` | **`POST /api/attractions/:id/favorite`** (toggle). `/api/favorites` chỉ dùng cho `GET` (danh sách) | `attractionRoutes.js:14`, `favoriteRoutes.js:7` |
| UC-03-05 (VNPay IPN) | `POST /api/webhooks/vnpay-ipn` | **`GET /api/payments/vnpay-ipn`** (sai cả method lẫn path) | `paymentRoutes.js:22` |

## Ghi chú thống nhất nội dung (không phải lỗi endpoint)

- **UC-03-03 / BR-06:** Bản phát hành hiện tại chỉ hỗ trợ `paymentMethod = vnpay`. Các nhánh `onsite → CONFIRMED` / `onsite + approval → PENDING_PARTNER` trong BR-06 là thiết kế cho tương lai, **chưa kích hoạt** — nên chú thích rõ để tránh hiểu nhầm là đã chạy.
- **Rate limit (3.2):** Thực tế giới hạn theo **`IP + path`** (mỗi endpoint một bộ đếm riêng), không phải một bộ đếm chung cho toàn nhóm auth.
