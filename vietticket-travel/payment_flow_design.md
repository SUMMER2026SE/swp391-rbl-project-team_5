# Thiết kế luồng Thanh toán VNPay & Cleanup Worker (Lộc — L1/L2/L3)

> Tài liệu chốt thiết kế tương tranh L2↔L3 và đặc tả lại 3 task theo **schema thật** (Prisma).
> Trạng thái: ĐÃ CHỐT (cửa sổ thanh toán 10 phút, thêm cột `Booking.refundRequired`).

---

## 0. Bối cảnh code hiện tại
- Booking/Payment flow đã có sẵn (`bookingController.js`). Hiện thanh toán đang **giả lập client-side** qua `PATCH /api/bookings/:id/payment-status` → KHÔNG an toàn, sẽ bị thay thế.
- `createBooking` đã tạo sẵn 1 bản ghi `Payment` (status `PENDING`) khi tạo booking.
- Enum thật: `BookingStatus = PENDING_PAYMENT | CONFIRMED | CANCELLED | COMPLETED`; `PaymentStatus = PENDING | SUCCESS | FAILED`; `ReservationStatus = HELD | CONFIRMED | EXPIRED | CANCELLED`.
- Cột kho: `DailyStock.heldQuantity` / `bookedQuantity`; `TimeSlotStock.heldQty` / `bookedQty`.

---

## 1. Mô hình tương tranh (đã chốt)

| # | Quyết định |
|---|---|
| 1 | **Một mốc thời hạn duy nhất**: `Reservation.expiresAt`. |
| 2 | **Reset cửa sổ thanh toán trong L1 (mỗi lần tạo URL)**: trong `createVNPayUrl`, set `reservation.expiresAt = now + 10 phút`. Đặt ở đây (không ở `createBooking`) để hỗ trợ thử lại thanh toán — mỗi lần retry có cửa sổ mới và `vnp_ExpireDate` tươi. |
| 3 | **`vnp_ExpireDate` = `reservation.expiresAt`** → VNPay tự từ chối giao dịch sau hạn ⇒ triệt tiêu ca tương tranh thường gặp. |
| 4 | **IPN là nguồn ghi DB chính**. Return URL có chữ ký hợp lệ chạy cùng logic đối soát idempotent làm fallback cho môi trường local/private. `PATCH payment-status` vẫn bị khóa cho vnpay. Cả callback & Worker đều dùng transaction **Serializable** + guard; ai commit trước thắng. |
| 5 | **Idempotency theo `Payment.status === 'SUCCESS'`, KHÔNG theo `Booking.status`** (xem §1.1). |
| 6 | **Worker có grace period**: chỉ quét `expiresAt < now - GRACE` (GRACE = 2–3 phút) để IPN trả trễ kịp đáp xuống trước → giảm ca `refundRequired`. |
| 7 | **Ca biên "đã trả nhưng vé đã bị thu hồi"**: ghi `Payment=SUCCESS`, `Booking=CANCELLED`, `refundRequired=true`, log + (tùy) email admin; trả `RspCode "00"` cho VNPay. |

### 1.1. Idempotency — khóa theo Payment, không theo Booking (QUAN TRỌNG)
Worker hủy booking mồ côi (`Booking→CANCELLED`) và IPN trả trễ có thể đá nhau: nếu IPN guard "thấy CANCELLED → bỏ qua" thì khách đã trả tiền nhưng không được set `refundRequired` ⇒ **mất tiền âm thầm**. Vì vậy:
- **Đã tồn tại `Payment` SUCCESS cho booking** → mới trả `RspCode "02"` (đã xử lý xong).
- IPN success mà `Booking=CANCELLED` nhưng **chưa** có Payment SUCCESS → **vẫn xử lý**: `Payment→SUCCESS` + `refundRequired=true` + log, trả `00`.

### 1.2. Xử lý serialization failure
Transaction Serializable có thể fail khi tranh chấp — KHÔNG cần vòng retry phức tạp:
- **Worker**: gặp lỗi ở 1 reservation → log & bỏ qua, vòng sau (60s) quét lại.
- **IPN**: trả `RspCode` ≠ "00" để VNPay tự gọi lại.

Ngoài phạm vi: trạng thái `pending_partner` (duyệt thủ công) — schema chưa có, không làm trong cụm này.

---

## 2. Thay đổi schema (1 migration) — đã gồm Phương án A (duyệt thủ công)
```prisma
enum BookingStatus {
  PENDING_PAYMENT
  PENDING_PARTNER   // MỚI: đã trả tiền, chờ đối tác duyệt thủ công
  CONFIRMED
  CANCELLED
  COMPLETED
}

model Booking {
  // ... giữ nguyên các cột hiện có
  refundRequired Boolean @default(false) // true khi đã thu tiền nhưng đơn bị hủy/không giữ được vé → cần hoàn tiền thủ công
}

model Attraction {
  // ... giữ nguyên các cột hiện có
  requiresManualApproval Boolean @default(false) // địa điểm cần đối tác duyệt từng đơn
}
```
Lệnh: `npx prisma migrate dev --name add_manual_approval_and_refund`

---

## 3. L1 — Tạo URL thanh toán
**Endpoint:** `POST /api/payments/create-vnpay-url` — `protect` + `restrictTo('CUSTOMER')`

1. Input `{ bookingId }`; kiểm `booking.userId === req.user.id`.
2. Tiền điều kiện: `Booking.status === 'PENDING_PAYMENT'` và `paymentMethod === 'vnpay'`.
3. **Reset cửa sổ thanh toán**: `reservation.expiresAt = now + 10 phút` (hỗ trợ retry — xem QĐ2).
4. `vnp_Amount = Math.round(Number(booking.totalAmount) * 100)` (×100, số nguyên).
5. `vnp_TxnRef` duy nhất mỗi lần thử: `${bookingId_bỏ_dấu_gạch}${Date.now()}` (chỉ [a-z0-9], vì VNPay giới hạn charset). **Update** bản `Payment` PENDING có sẵn, lưu TxnRef vào `Payment.transactionId` (`@unique`). **IPN/Return tra ngược booking bằng lookup `Payment.transactionId === vnp_TxnRef`** (uuid chứa `-` nên không parse tiền tố).
6. `vnp_CreateDate` = now, `vnp_ExpireDate` = `reservation.expiresAt` (vừa reset), format `yyyyMMddHHmmss` theo GMT+7.
6. `vnp_IpAddr` từ `x-forwarded-for` fallback `req.socket.remoteAddress`.
7. Ký: sort tham số alphabet → `qs.stringify({ encode:true })` → HMAC-SHA512 (`VNP_HASHSECRET`) → gắn `vnp_SecureHash`.
8. Output: `{ success:true, data:{ paymentUrl } }`.

**.env.example bổ sung:**
```env
VNP_TMNCODE=
VNP_HASHSECRET=
VNP_URL=https://sandbox.vnpayment.vn/paymentv2/vpcpay.html
VNP_RETURNURL=http://localhost:5000/api/payments/vnpay-return
VNP_IPNURL=http://localhost:5000/api/payments/vnpay-ipn
```

---

## 4. L2 — IPN & Return
### IPN: `GET /api/payments/vnpay-ipn` (KHÔNG auth)
1. Tách `vnp_SecureHash`, tính lại HMAC trên tham số đã sort. Sai → `{ RspCode:"97", Message:"Invalid signature" }`.
2. Từ `vnp_TxnRef` lấy `bookingId`. Không thấy → `{ RspCode:"01", Message:"Order not found" }`.
3. **Kiểm số tiền**: `vnp_Amount !== Math.round(totalAmount*100)` → `{ RspCode:"04", Message:"Invalid amount" }`.
4. Transaction **Serializable** (dùng helper export từ `bookingController`):
   - Đọc lại Booking + Reservation + Payment mới nhất.
   - **Idempotency (theo Payment, xem §1.1)**: nếu đã có `Payment.status === 'SUCCESS'` → `{ RspCode:"02", Message:"Order already confirmed" }`.
   - `vnp_ResponseCode === '00'`:
     - Nếu `Reservation.status==='HELD'` & kho held đủ → `confirmReservationAndStock` (held→booked, `Reservation→CONFIRMED`) + `Payment→SUCCESS`, **rồi rẽ nhánh theo `attraction.requiresManualApproval`**:
       - `false` → `Booking→CONFIRMED` + `createTicketInstances` (như cũ).
       - `true` → `Booking→PENDING_PARTNER`, **CHƯA** tạo TicketInstance (chờ đối tác duyệt ở N2). Kho đã booked, reservation đã CONFIRMED nên Worker không đụng tới.
     - Ngược lại — reservation đã EXPIRED/kho đã trả, **kể cả khi Booking đã CANCELLED** (ca biên QĐ7) → `Payment→SUCCESS`, `Booking→CANCELLED`, `refundRequired=true`, log.
   - Thất bại (ResponseCode ≠ '00'): nếu chưa có Payment SUCCESS → `Payment→FAILED`, `Booking→CANCELLED`.
   - Trả `{ RspCode:"00", Message:"Confirm success" }`. **Luôn HTTP 200** kèm `{RspCode, Message}` (kể cả nhánh lỗi 01/04/97, trừ serialization failure thì trả mã ≠00 để VNPay gọi lại).

### Return: `GET /api/payments/vnpay-return` (KHÔNG auth)
- Verify `vnp_SecureHash`, chạy cùng logic đối soát idempotent với IPN rồi redirect sang FE.
- Đây là fallback khi VNPay không thể gọi IPN vào `localhost`; production vẫn phải cấu hình IPN bằng URL HTTPS công khai.

### Refactor kèm theo
- Export `confirmReservationAndStock`, `createTicketInstances` từ `bookingController.js`.
- **Khóa** `PATCH /api/bookings/:id/payment-status` cho luồng vnpay (chỉ còn cho `onsite` nếu cần).

---

## 5. L3 — Cleanup Worker (`backend/src/utils/cleanupWorker.js`)
- Khởi động ở **`server.js`** (KHÔNG ở `app.js` — tránh treo Jest). `setInterval` 60s, cờ `isRunning` chống chạy chồng.
- Tìm `Reservation` `status==='HELD'` & **`expiresAt < now - GRACE`** (GRACE = 2–3 phút, xem QĐ6 — chừa thời gian cho IPN trả trễ).
- Serialization failure ở 1 reservation → log & bỏ qua, vòng sau quét lại (xem §1.2).
- **Booking `PENDING_PARTNER` an toàn tự nhiên**: khi đó reservation đã `CONFIRMED` (stock booked) nên không lọt vào điều kiện `HELD` → Worker không thu hồi. Không cần xử lý đặc biệt.
- **Mỗi reservation 1 transaction Serializable riêng** (try/catch riêng):
  1. Đọc lại; nếu không còn HELD → skip.
  2. `Reservation → EXPIRED`.
  3. Trừ kho (đúng tên cột): `DailyStock.heldQuantity` và nếu có `timeSlotId` thì `TimeSlotStock.heldQty`, dùng `updateMany` guard `{ gte: quantity }`.
  4. Nếu Booking gắn reservation đang `PENDING_PAYMENT` → `Booking → CANCELLED`, `Payment → FAILED` (dọn đơn mồ côi).
- Log số bản ghi đã dọn mỗi vòng.

---

## 6. Test cần thêm
- IPN: chữ ký sai (97), không thấy đơn (01), sai số tiền (04), đã có Payment SUCCESS → (02), thành công (00) tạo đủ TicketInstance, thất bại → CANCELLED.
- Worker: reservation hết hạn (qua GRACE) → EXPIRED + trả đúng kho (`heldQuantity`/`heldQty`); không trừ âm; dọn booking mồ côi.
- Idempotency: gọi IPN 2 lần không nhân đôi vé/kho (chặn bởi Payment SUCCESS).
- Ca biên QĐ7: IPN success khi reservation đã EXPIRED **và Booking đã CANCELLED** → `refundRequired=true`, không bị guard `02` nuốt mất.
- Luồng duyệt thủ công: IPN success + `requiresManualApproval=true` → `Booking=PENDING_PARTNER`, kho booked, **chưa** có TicketInstance.
- N2 approve: `PENDING_PARTNER → CONFIRMED` + tạo đúng số TicketInstance; approve đơn không phải của mình → 403; approve khi không phải PENDING_PARTNER → 409.
- N2 reject: `→ CANCELLED`, trả đúng `bookedQuantity`/`bookedQty`, có Payment SUCCESS → `refundRequired=true`.
- N1: partner A không thấy booking của partner B (lọc chuỗi sở hữu).

## 8. Phần của Như (B2B) — N1/N2/N3 (Phương án A)

> Chuỗi sở hữu dùng chung: `Booking → reservation → ticketProduct → attraction → partnerId`.
> Mount các route N1/N2 trong `partnerRoutes.js` **sau** `requireApprovedPartner` để thừa hưởng phân quyền.

### N1 — `GET /api/partners/bookings`
- Query: `where: { reservation: { ticketProduct: { attraction: { partnerId: req.partner.id } } } }`, kèm phân trang + lọc `status`.
- Số lượng/tên vé/ngày lấy từ `reservation.quantity`, `reservation.ticketProduct`, `reservation.date` (Booking **không có** cột quantity).
- Viết **mapper riêng cho partner** (không tái dùng `toBookingResponse` hướng khách — nó map `PENDING_PAYMENT`→`"unpaid"`). Giữ nguyên tên status enum cho FE lọc.
- Trả: mã đơn, tên khách, tên vé, ngày tham quan, số lượng, tổng tiền, trạng thái.

### N2 — Duyệt / Từ chối (chỉ áp dụng `Booking.status === 'PENDING_PARTNER'`)
- `PATCH /api/partners/bookings/:bookingId/approve`
- `PATCH /api/partners/bookings/:bookingId/reject`
- Kiểm `attraction.partnerId === req.partner.id`; nếu status ≠ `PENDING_PARTNER` → 409. Transaction Serializable.
- **Approve** → `Booking→CONFIRMED` + `createTicketInstances` (tái dùng helper export từ `bookingController`). Kho đã booked từ IPN nên **không cộng lại**.
- **Reject** → `Booking→CANCELLED`; `Reservation→CANCELLED`; **trả kho `booked`** (đúng tên cột): `DailyStock.bookedQuantity` ↓ và (nếu có timeSlot) `TimeSlotStock.bookedQty` ↓, dùng `updateMany` guard `{ gte: quantity }`. Nếu đã có `Payment SUCCESS` → **bắt buộc** `refundRequired=true` (không optional).

### N3 — Dashboard doanh thu thật (`getDashboard`)
- Thay các số hardcode `0` ([partnerController.js:209](backend/src/controllers/partnerController.js:209)).
- **Doanh thu**: hiển thị cả **gross** = `sum(totalAmount)` của booking `CONFIRMED`/`COMPLETED` của partner, và **net payout** = `gross × (1 - commissionRate)`.
- **Số vé bán**: `sum(reservation.quantity)` của các booking `CONFIRMED`/`COMPLETED`.
- **Tỷ lệ lấp đầy (định nghĩa chốt)**: `sum(DailyStock.bookedQuantity) / sum(DailyStock.capacity)` trên các `ticketProduct` của partner, lọc `date` trong tháng hiện tại. (Không dùng TimeSlotStock vì bảng đó không có cột capacity.)
- Mọi aggregate kèm bộ lọc chuỗi sở hữu partner.

## 9. Sai sót phát hiện ở rà soát cuối — PHẢI xử lý

1. 🔴 **`createBooking` nhánh `onsite` bỏ qua duyệt thủ công** ([bookingController.js:471](backend/src/controllers/bookingController.js:471)). Phải rẽ nhánh giống IPN: `onsite` + `attraction.requiresManualApproval=true` → `Booking=PENDING_PARTNER`, **không** tạo TicketInstance; ngược lại giữ `CONFIRMED` như cũ.
2. ⏸️ **`PENDING_PARTNER` lan sang phía KHÁCH** (Phú/HAnh) — **TẠM GÁC** (theo chốt). Mapper `toBookingResponse` ([:140](backend/src/controllers/bookingController.js:140)) sẽ trả chuỗi thô `"pending_partner"`; khách tạm chưa có nhãn đẹp. Ghi lại để xử lý sau, không chặn đợt này.
3. 🟡 **Fill-rate (N3)**: `DailyStock.capacity` lấy từ tổng `TimeSlot.maxCapacity` cấp-ticketProduct, **tách rời** `defaultCapacity`/timeslot cấp-attraction của trang Lịch Module 2. Định nghĩa chốt: chỉ tính trên `DailyStock` thực có; **xử lý chia 0** (không có dòng → fill rate = 0 hoặc "—"). Cảnh báo partner phải tạo timeslot cấp-vé thì mới có capacity bookable.
4. 🟢 **N2 approve idempotent**: re-check `status==='PENDING_PARTNER'` BÊN TRONG transaction + chỉ `createTicketInstances` khi `ticketInstances.length===0` (chống double-click).
5. 🟢 **N1**: loại `PENDING_PAYMENT` khỏi danh sách partner; dùng shape phân trang `{total,page,limit,totalPages}`. Phân quyền dùng nguyên chuỗi `partnerRoutes` (`requireApprovedPartner`), không thêm `restrictTo` rời.
6. 🟢 **`refundRequired` chỉ là cờ** — chưa có gọi API hoàn tiền VNPay / UI admin xử lý. Không coi là hoàn tiền tự động.

## 7. Phạm vi & phụ thuộc
- **L1/L2/L3 là backend.** Phần backend gồm: migration, `paymentController` (createVNPayUrl + vnpayIpn + vnpayReturn), `paymentRoutes`, refactor export helper, khóa `PATCH payment-status` cho vnpay, `cleanupWorker`.
- **L4 (FE, thuộc Lộc):** `CheckoutPage` gọi `create-vnpay-url` rồi redirect sang `paymentUrl` thật; `booking-success` đọc `vnp_ResponseCode`; **gỡ `VNPaySimulatorPage`** + route `/payment/vnpay-mock/:bookingId` + import liên quan trong `AppRoutes.jsx`.
- ⏸️ **Tạm gác:** nhãn/màn hình `PENDING_PARTNER` phía KHÁCH (Phú/HAnh) — chưa làm trong đợt này. Khách của địa điểm cần-duyệt sẽ tạm thấy chuỗi thô `"pending_partner"` cho tới khi team khách thêm nhãn.
- Cần `VNP_TMNCODE`/`VNP_HASHSECRET` từ tài khoản VNPay Sandbox để chạy thật.
