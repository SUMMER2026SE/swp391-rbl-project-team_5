# Hướng dẫn test chi tiết từng chức năng — VietTicket Travel

Tài liệu này để **tự tay kiểm thử toàn bộ chức năng** trước khi bảo vệ.
Khác với [DEMO_RUNBOOK_4_MEMBERS.md](DEMO_RUNBOOK_4_MEMBERS.md) (kịch bản trình
diễn theo thời lượng), tài liệu này đi theo **từng chức năng một**, kèm dữ liệu
thật đang có trong database và kết quả mong đợi cụ thể.

Các mục đánh dấu 🆕 là nghiệp vụ mới merge, **runbook cũ chưa có**.

---

## 0. Chuẩn bị

### 0.1. Dựng dữ liệu

```bash
cd "C:\Users\Lenovo\Desktop\New folder (2)\swp391-rbl-project-team_5\vietticket-travel\backend"; if ($?) { npm run demo:prepare; if ($?) { npm run demo:gap } }
```

Chạy đúng thứ tự. `demo:gap` bổ sung dữ liệu cho 9 nghiệp vụ mới mà
`demo:prepare` không phủ.

> **Dữ liệu gắn theo ngày.** Vé check-in chỉ hợp lệ trong ngày seed. Sang ngày
> mới phải seed lại, nếu không cổng soát vé không quét được vé nào.

### 0.2. Khởi động

Terminal 1 — backend:
```bash
cd "C:\Users\Lenovo\Desktop\New folder (2)\swp391-rbl-project-team_5\vietticket-travel\backend"; if ($?) { npm run dev }
```

Terminal 2 — frontend:
```bash
cd "C:\Users\Lenovo\Desktop\New folder (2)\swp391-rbl-project-team_5\vietticket-travel"; if ($?) { npm run dev }
```

Truy cập `http://localhost:5173`.

### 0.3. Tài khoản

Mật khẩu chung: **`Demo@VietTicket2026`**

| Vai trò | Email | Ghi chú |
|---|---|---|
| Khách hàng | `minh.anh.nguyen@vietticket.local` | Khách chính, có lịch sử đầy đủ |
| Đối tác | `hoang.nam.tran@vietticket.local` | Đã duyệt KYC, có 4 điểm |
| Trưởng cổng | `quoc.bao.pham@vietticket.local` | STAFF · **MANAGER** · thuộc đối tác |
| Nhân viên soát vé 🆕 | `soatve.canh@vietticket.local` | STAFF · **SCANNER** · thuộc đối tác |
| NV nền tảng | `thu.ha.le@vietticket.local` | STAFF · MANAGER · hoàn tiền, hỗ trợ |
| Admin | `ngoc.lan.vu@vietticket.local` | Người **khớp** sao kê (maker) |
| Admin checker | `minh.quan.ngo@vietticket.local` | Người **duyệt** sao kê (checker) |

> Dùng **cửa sổ ẩn danh riêng cho mỗi vai trò**. Đăng nhập chồng nhau trong cùng
> trình duyệt sẽ ghi đè cookie phiên.

### 0.4. Mở đầu mỗi tài khoản

Lần đầu đăng nhập, một số tài khoản hiện modal **"Chính sách VietTicket đã được
cập nhật"**. Tick 2 ô rồi bấm *Đồng ý và tiếp tục*. Chưa đồng ý thì đặt vé,
thanh toán, đánh giá, hỏi đáp đều trả lỗi 428.

---

## A. Khách hàng (Customer)

Đăng nhập `minh.anh.nguyen@vietticket.local`.

### A1. Tìm kiếm và lọc

| Bước | Thao tác | Kết quả mong đợi |
|---|---|---|
| 1 | Vào `/attractions` | Danh sách điểm đã duyệt, có phân trang |
| 2 | Gõ "bảo tàng" vào ô tìm | Ra các điểm có chữ "Bảo tàng" |
| 3 | Gõ **"bao tang"** (không dấu) | **Vẫn ra kết quả** — hệ thống chuẩn hóa tiếng Việt |
| 4 | Lọc theo thành phố "Hồ Chí Minh" | Chỉ còn điểm ở TP.HCM |
| 5 | Chọn ngày + số khách | Điểm hết chỗ ngày đó bị loại khỏi kết quả |

**Điểm cần nhấn với hội đồng:** kiểm tra sức chứa theo *ngày cụ thể* chứ không
phải sức chứa tĩnh.

### A2. Chi tiết điểm tham quan

Vào `Bảo tàng Mỹ thuật Thành phố Hồ Chí Minh`.

- Ảnh, mô tả, bản đồ, giờ mở cửa, điểm hẹn, hướng dẫn check-in.
- Danh sách loại vé kèm giá, chính sách hoàn, giới hạn tuổi/chiều cao.
- Khối **Đánh giá** và khối **Hỏi & đáp** (mục E1).

### A3. Yêu thích

Bấm tim ở 2–3 điểm → vào `/favorites` → đủ số điểm đã thích. Bấm tim lần nữa để
bỏ, danh sách cập nhật ngay.

### A4. Đặt vé — luồng chuẩn

| Bước | Thao tác | Kết quả mong đợi |
|---|---|---|
| 1 | Chọn loại vé, ngày, số lượng | Hiện tạm tính |
| 2 | Bấm *Đặt vé* | Vào `/checkout/:reservationId`, **đồng hồ giữ chỗ đếm ngược** |
| 3 | Điền thông tin liên hệ | |
| 4 | 🆕 Khai **danh sách hành khách** | Xem mục E5 |
| 5 | 🆕 Tick **Xuất hóa đơn** | Xem mục E6 |
| 6 | Nhập voucher | Xem mục E4 |
| 7 | Chọn VNPay → thanh toán sandbox | Về `/booking-success`, vé có QR |

**Test giữ chỗ hết hạn:** mở checkout rồi để yên quá thời gian giữ chỗ → đơn tự
hủy, số vé được trả lại kho.

### A5. Đặt vé cần đối tác duyệt

Chọn điểm có bật *duyệt thủ công*. Sau khi đặt, đơn ở trạng thái
`PENDING_PARTNER`, **chưa trừ tiền**. Chờ đối tác xử lý ở mục B4.

### A6. Thanh toán chuyển khoản VietQR

Chọn phương thức *Chuyển khoản ngân hàng* → `/bank-transfer/:bookingId`.

- Hiện mã QR VietQR, số tài khoản, **nội dung chuyển khoản đúng định dạng**.
- Đồng hồ giữ chỗ dài hơn VNPay (240 phút) để kịp đối chiếu.
- Đơn nằm chờ Admin đối soát — xem mục E3.

Đơn có sẵn chưa đối chiếu: `295741b8-7ab3-4afe-ad30-b40f72c1d9a6` (60.000 đ).

### A7. Vé điện tử

Vào `/my-tickets`.

- Vé hiển thị QR, trạng thái, ngày tham quan.
- Tải vé PDF.
- Lọc theo trạng thái: Sắp tới / Đã hoàn thành / Đã hủy.

### A8. Hủy vé và hoàn tiền

Chọn một vé còn hạn hủy → *Yêu cầu hoàn tiền*.

- Modal hiện **chính sách hoàn và số tiền thực nhận trước khi gửi**.
- Gửi xong đơn chuyển `REFUND_REQUESTED`, chờ nhân viên nền tảng (mục C4).

Đơn có sẵn: `2001831d-9a22-4555-a649-d2a7f9406e1c`,
`03f49157-10ab-45f7-a2e0-5c19b8e24a70`.

### A9. Đánh giá

Chỉ đánh giá được chuyến **đã hoàn thành**. Kiểm tra:

- Chọn sao, viết nội dung, đính ảnh, chọn loại hình du lịch.
- Không đánh giá được chuyến chưa đi → nút bị chặn.
- 🆕 Bấm **Hữu ích** ở đánh giá của người khác — xem mục E2.

### A10. Hỗ trợ

`/support` — tạo yêu cầu, gửi tin nhắn. `/my-support` — xem lịch sử. Tin nhắn
nhân viên trả lời hiện **realtime** không cần F5.

### A11. Trợ lý AI và lịch trình

- Chatbot góc phải: hỏi "gợi ý điểm tham quan ở TP.HCM cho gia đình".
- `/journey` — tạo lịch trình AI, lưu, đặt vé từ lịch trình.

> Cần `GEMINI_API_KEY` hoặc `OPENAI_API_KEY` trong `backend/.env`. Không có key
> thì hệ thống trả lời bằng dữ liệu tra cứu, không phải AI thật.

### A12. Điểm thưởng

`/rewards` — xem điểm tích lũy, đổi voucher cá nhân. Voucher đổi ra **chỉ tài
khoản đó dùng được**.

---

## B. Đối tác (Partner)

Đăng nhập `hoang.nam.tran@vietticket.local`.

### B1. Dashboard

`/partner/dashboard` — doanh thu, số booking, tỉ lệ lấp đầy, biểu đồ theo thời
gian.

### B2. Quản lý điểm tham quan

`/partner/attractions`

| Test | Kết quả mong đợi |
|---|---|
| Tạo điểm mới | Lưu ở trạng thái `DRAFT` |
| Gửi duyệt | Chuyển `PENDING`, chờ Admin |
| Sửa điểm đã duyệt | Tạo **phiên bản chờ duyệt**, bản đang bán không đổi |
| Tạm dừng bán | `publicationStatus` = PAUSED, khách không đặt được |

Ba lớp trạng thái tách bạch: **kiểm duyệt** (DRAFT/PENDING/APPROVED/REJECTED),
**phát hành** (PUBLISHED/PAUSED), **vận hành** (ACTIVE/SUSPENDED).

### B3. Vé và lịch

- `/partner/attractions/:id/tickets` — tạo loại vé, đặt giá, chính sách hoàn,
  giới hạn tuổi/chiều cao, số khách mỗi vé.
- `/partner/attractions/:id/schedule` — sức chứa theo ngày, khung giờ, ngày nghỉ.

### B4. Duyệt booking thủ công

`/partner/bookings` — đơn `PENDING_PARTNER` kèm **hạn xử lý**.

| Test | Kết quả mong đợi |
|---|---|
| Duyệt đơn | Khách nhận email, đơn chuyển chờ thanh toán |
| Từ chối đơn | Kích hoạt luồng hoàn bắt buộc nếu đã thu tiền |
| Để quá hạn | Đơn tự hủy, trả vé về kho |

Đơn có sẵn: `cdca6c89-6ad6-4bdf-a3db-c3e71a9b520f`,
`ef0d2212-07b3-4b01-ae50-9d42f6a10c8e`.

### B5. Nhân viên 🆕

`/partner/staff`

| Test | Kết quả mong đợi |
|---|---|
| Xem danh sách | `quoc.bao.pham` = MANAGER, `soatve.canh` = **SCANNER** |
| Đổi cấp quyền | Dropdown SCANNER ↔ MANAGER, lưu xong **phiên cũ bị vô hiệu** |
| Thêm nhân viên | Mặc định SCANNER |
| Gỡ nhân viên | Mất quyền truy cập ngay |

### B6. Đánh giá và hỏi đáp

- `/partner/reviews` — phản hồi đánh giá của khách.
- 🆕 `/partner/questions` — trả lời câu hỏi công khai, xem mục E1.

### B7. Báo cáo và AI dự báo

`/partner/reports`

- Doanh thu theo thời gian, theo điểm, theo loại vé.
- **AI dự báo doanh thu**: chỉ hiện khi điểm có ≥ 14 ngày doanh thu và ≥ 30
  booking hoàn tất. Chưa đủ thì hiện rõ `HISTORICAL_BASELINE` hoặc
  `INSUFFICIENT_DATA`, **không gắn nhãn AI**.

> Cần chạy ml-service để có dự báo AI thật:
> ```bash
> cd "C:\Users\Lenovo\Desktop\New folder (2)\swp391-rbl-project-team_5\vietticket-travel\ml-service"; if ($?) { .\.venv\Scripts\Activate.ps1; uvicorn app.main:app --host 127.0.0.1 --port 8000 }
> ```

### B8. Giá động

`/partner/dynamic-pricing` — đặt chính sách, xem đề xuất AI.

**Kiểm tra công tắc an toàn:** dù chính sách để `AUTO_APPLY`, nếu
`DYNAMIC_PRICING_AUTO_APPLY_ALLOWED=false` trong `.env` thì AI **chỉ đề xuất,
không đổi giá khách trả**. Đây là câu hội đồng hay hỏi.

### B9. Đối soát

`/partner/settlements` — kỳ đối soát, doanh thu, hoa hồng, số thực nhận, trạng
thái DRAFT → APPROVED → PAID.

### B10. Đổi thông tin KYC 🆕

`/partner/kyc-change-request` — xem mục E7.

---

## C. Nhân viên (Staff)

### C1. Check-in bằng QR — trưởng cổng

Đăng nhập `quoc.bao.pham@vietticket.local` (MANAGER) → `/staff/checkin`.

Mã QR nhập tay dùng được ngay hôm nay:

```
a5313558-c74a-49bc-a9d6-2b6fadc166a4
be1d019c-68e2-407d-afea-f26bd8979634
74e03d4a-3e52-4b57-a60b-a75a9aedc614
```

| Test | Kết quả mong đợi |
|---|---|
| Tra cứu QR hợp lệ | Hiện thông tin khách, vé, ngày |
| Check-in | Vé chuyển `USED`, ghi thời điểm và người quét |
| Quét lại vé đã dùng | **Bị từ chối**, báo đã check-in |
| Quét vé ngày khác | **Bị từ chối**, ngoài khung giờ cho phép |
| Quét vé điểm khác | **Bị từ chối**, không thuộc phạm vi phụ trách |

### C2. Phân cấp quyền nhân viên 🆕

**Đây là điểm quan trọng — test bằng 2 tài khoản.**

| Tài khoản | Cấp | Check-in | Cấp lại vé |
|---|---|---|---|
| `quoc.bao.pham@vietticket.local` | MANAGER | ✅ | ✅ |
| `soatve.canh@vietticket.local` | SCANNER | ✅ | ❌ |

Đăng nhập bằng `soatve.canh` → vào `/staff/checkin` → **nút cấp lại vé không
hiện**. Nếu gọi thẳng API sẽ nhận HTTP 403 `STAFF_ACCESS_LEVEL_REQUIRED`.

### C3. Cấp lại vé

Đăng nhập `quoc.bao.pham` → tìm booking → *Cấp lại vé*.

Kết quả: QR cũ chuyển `EXPIRED`, QR mới `VALID`, ghi audit log. Quét lại QR cũ
bị từ chối.

### C4. Hoàn tiền

Đăng nhập `thu.ha.le@vietticket.local` → `/staff/refunds`.

| Test | Kết quả mong đợi |
|---|---|
| Xem yêu cầu | Hiện chính sách, số tiền, lý do khách gửi |
| Duyệt hoàn | Gọi VNPay sandbox, ghi giao dịch hoàn |
| Từ chối | Ghi lý do, khách nhận thông báo |
| Hoàn đơn chưa thu tiền | **Bị chặn** — không hoàn tiền chưa nhận |

### C5. Hỗ trợ khách

`/staff/tickets` — nhận yêu cầu, trả lời realtime, đóng ticket kèm kết luận.
Mở đồng thời cửa sổ khách để thấy tin nhắn hiện ngay hai phía.

### C6. SmartQueue

`/staff/smart-queue` — hàng đợi, gọi khách, chính sách điều phối.

---

## D. Quản trị (Admin)

Đăng nhập `ngoc.lan.vu@vietticket.local`.

### D1. Dashboard và người dùng

- `/admin` — tổng quan hệ thống.
- `/admin/users` — tìm kiếm, khóa/mở tài khoản, đổi vai trò.

### D2. Duyệt KYC đối tác

`/admin/kyc-approval` — 2 hồ sơ chờ duyệt:

| Hồ sơ | Kịch bản |
|---|---|
| Công ty TNHH Hành trình Xanh | Đủ giấy tờ → **duyệt** |
| Hộ kinh doanh Du lịch Bình Minh | Thiếu nhất quán → **từ chối kèm lý do** |

Xem được ảnh giấy phép. Sau khi duyệt, đối tác đăng nhập thấy quyền mở ra ngay.

### D3. Duyệt điểm tham quan

`/admin/attraction-approval` — 2 điểm chờ: *Không gian Văn hóa Áo dài Việt Nam*
và *Trải nghiệm Chợ nổi Sài Gòn*. Duyệt 1, từ chối 1 kèm lý do.

### D4. Đình chỉ và khôi phục

`/admin/violations`

**Quan trọng 🆕:** khi đình chỉ điểm **đang kinh doanh**, hệ thống bắt buộc
**tick xác nhận đã có phương án cho booking bị ảnh hưởng**. Không tick sẽ nhận
lỗi `CUSTOMER_IMPACT_ACKNOWLEDGEMENT_REQUIRED`.

Khôi phục xong điểm **không tự bán lại** — phải đối tác chủ động phát hành lại.

### D5. Báo cáo tài chính

`/admin/reports`

- Doanh thu, hoa hồng, chiết khấu nền tảng và đối tác tách riêng.
- **Chỉ tính doanh thu đã thực thu**, không tính đơn chờ thanh toán.
- Dòng đối tác không phát sinh giao dịch **bị loại khỏi báo cáo**.

### D6. Đối soát

`/admin/settlements` — duyệt kỳ nháp, đánh dấu đã trả, xem bằng chứng tỷ giá.

### D7. Voucher

`/admin/vouchers` — tạo/sửa/vô hiệu. Xem mục E4 cho phạm vi và hạn mức.

### D8. Danh mục và đánh giá

- `/admin/categories` — thêm/sửa/xóa danh mục.
- `/admin/reviews` — ẩn đánh giá vi phạm kèm lý do.

### D9. Audit log

`/admin/audit-logs` — lọc theo hành động, người thực hiện, thời gian. Mọi thao
tác nhạy cảm ở trên đều phải để lại dấu vết ở đây.

---

## E. Chín nghiệp vụ mới 🆕

Phần này **runbook cũ chưa có**. Hội đồng sẽ hỏi vì đây là code mới nhất.

### E1. Hỏi & đáp công khai

Dữ liệu đã dựng sẵn 5 câu:

| Điểm | Nội dung | Trạng thái |
|---|---|---|
| Bảo tàng Mỹ thuật | "Bảo tàng có cho phép chụp ảnh…" | PUBLISHED · **đã trả lời** |
| Bảo tàng Mỹ thuật | "Đoàn học sinh 30 em có được giảm giá…" | PUBLISHED · **chờ đối tác trả lời** |
| Bảo tàng Mỹ thuật | "Liên hệ 09xxx để mua vé rẻ hơn…" | **HIDDEN** · admin ẩn tay |
| Khu vui chơi Ven sông | "Tour này chán lắm…" | PUBLISHED · **2 báo cáo** |
| Khu vui chơi Ven sông | "Spam quảng cáo…" | **HIDDEN** · 3 báo cáo, tự ẩn |

**Kịch bản test:**

1. **Khách xem** — vào chi tiết Bảo tàng Mỹ thuật, kéo tới khối Hỏi & đáp.
   Thấy 2 câu. **Câu bị ẩn không xuất hiện.**
2. **Khách đặt câu hỏi** — gõ câu mới, gửi. Xuất hiện ngay, chưa có trả lời.
3. **Đối tác trả lời** — đăng nhập partner → `/partner/questions` → trả lời câu
   "Đoàn học sinh 30 em…". Quay lại trang khách, thấy câu trả lời.
4. **Tự động ẩn ở ngưỡng 3** — đăng nhập một khách khác, báo cáo câu "Tour này
   chán lắm…" (đang có 2 báo cáo). Đủ 3 → **câu tự chuyển HIDDEN**, biến mất
   khỏi trang công khai.
5. **Admin kiểm duyệt** — ẩn/khôi phục câu hỏi kèm lý do.

### E2. Đánh giá hữu ích

1. Đăng nhập khách chính, vào điểm có đánh giá.
2. Bấm **Hữu ích** ở một đánh giá → số đếm tăng 1, nút đổi trạng thái.
3. Bấm lần nữa → **bỏ vote**, số đếm giảm về cũ (toggle).
4. Không tự vote đánh giá của chính mình.

Hiện có 4 lượt vote sẵn và 6 đánh giá khách chính chưa vote.

### E3. Maker-checker đối soát chuyển khoản

**Đây là nghiệp vụ kiểm soát nội bộ mạnh nhất — nên demo kỹ.**

Nguyên tắc: **người khớp sao kê không được tự duyệt**. Phải hai người.

| Bước | Tài khoản | Thao tác |
|---|---|---|
| 1 | `ngoc.lan.vu` (Admin A) | `/admin/bank-transfers` → đơn `295741b8-…` → nhập mã giao dịch, số tiền **đúng 60.000**, ngày nhận → *Khớp sao kê* |
| 2 | `ngoc.lan.vu` (Admin A) | Thử **tự duyệt** đơn vừa khớp → ❌ **HTTP 409 `MAKER_CHECKER_SEPARATION_REQUIRED`** |
| 3 | `minh.quan.ngo` (Admin B) | Vào cùng màn hình → *Duyệt* → vé được phát, đơn `CONFIRMED` |

**Test số tiền lệch:** nhập số tiền khác 60.000 → bị chặn
`BANK_TRANSFER_AMOUNT_MISMATCH`, **không phát vé**, chuyển hàng đợi ngoại lệ.

Dữ liệu sẵn có:

| Trạng thái | Mã giao dịch | Booking |
|---|---|---|
| Chưa đối chiếu | — | `295741b8-7ab3-4afe-ad30-b40f72c1d9a6` |
| **MATCHED** (chờ duyệt) | `FT539515533301` | `1d967431-cbeb-4158-a64e-45ed84d3c481` |
| APPROVED (hoàn tất) | `FT539515533302` | `fe52fa5a-d944-48ec-a1f0-4ff672047e25` |

### E4. Phạm vi và hạn mức voucher

| Mã | Giảm | Phạm vi | Hạn mức/người | Nguồn tiền |
|---|---|---|---|---|
| `BAOTANG25` | 25%, tối đa 80k | **Chỉ Bảo tàng Mỹ thuật** | 2 | Đối tác |
| `DOITAC10` | 10%, tối đa 50k | **Cả 4 điểm của đối tác** | 3 | Chia 50/50 |
| `CHIMOTLAN` | 30.000 đ | Toàn sàn | **1 — đã dùng hết** | Nền tảng |
| `KHAMPHA15` | 15%, tối đa 100k | Toàn sàn | 1 | Nền tảng |

**Kịch bản test:**

1. Đặt vé **Bảo tàng Mỹ thuật**, nhập `BAOTANG25` → ✅ áp dụng.
2. Đặt vé **điểm khác**, nhập `BAOTANG25` → ❌ **bị từ chối vì ngoài phạm vi**.
3. Nhập `DOITAC10` ở bất kỳ điểm nào của đối tác → ✅ áp dụng.
4. Nhập `CHIMOTLAN` bằng khách chính → ❌ **"đã dùng hết lượt"** — lưu ý báo
   đúng là *hết hạn mức cá nhân*, không phải *hết lượt toàn hệ thống*.
5. Nhập `CHIMOTLAN` bằng **khách khác** → ✅ vẫn dùng được.

### E5. Danh sách hành khách

Ở bước checkout, khai đủ hành khách theo số vé:

| Test | Kết quả mong đợi |
|---|---|
| Khai thiếu người | ❌ "Cần khai báo đúng N hành khách" |
| Không tick xác nhận chính xác | ❌ Bị chặn |
| Ngày sinh sai định dạng | ❌ Yêu cầu `YYYY-MM-DD` |
| Vé trẻ em, khai người lớn | ❌ Vượt độ tuổi tối đa của loại vé |
| Vé có giới hạn chiều cao, bỏ trống | ❌ Chiều cao là bắt buộc |
| Toàn trẻ em, vé cần người lớn | ❌ Yêu cầu khai **người đi cùng ≥ 18 tuổi** |

Booking mẫu đã có manifest: `4464b14b-…` (2 khách người lớn),
`29b5e85a-…` (trẻ em + người giám hộ).

Đối tác xem danh sách này ở màn hình booking để chuẩn bị đón khách.

### E6. Thông tin xuất hóa đơn

Tick *Xuất hóa đơn* ở checkout:

| Loại | Test | Kết quả mong đợi |
|---|---|---|
| Doanh nghiệp | MST `0312345678-001` | ✅ Hợp lệ (10 số hoặc 10-3 số) |
| Doanh nghiệp | MST `12345` | ❌ Sai định dạng |
| Doanh nghiệp | Bỏ trống MST | ❌ Bắt buộc với doanh nghiệp |
| Cá nhân | Không MST | ✅ Được phép |
| Cả hai | Email sai định dạng | ❌ Bị chặn |

Booking mẫu: `4464b14b-…` = BUSINESS, `29b5e85a-…` = PERSONAL.

### E7. Yêu cầu đổi thông tin KYC

**Đối tác:** `/partner/kyc-change-request` — gửi yêu cầu đổi số tài khoản/địa
chỉ/người đại diện kèm lý do. **Thông tin cũ không đổi ngay**, phải chờ duyệt.

**Admin:** `/admin/kyc-change-requests` — 3 yêu cầu sẵn có:

| Trạng thái | Nội dung |
|---|---|
| **PENDING** | Chuyển tài khoản nhận tiền sang Vietcombank → *duyệt thử* |
| APPROVED | Cập nhật địa chỉ trụ sở |
| REJECTED | Đổi mã số thuế — từ chối vì đổi pháp nhân phải đăng ký hồ sơ mới |

Duyệt yêu cầu PENDING → thông tin ngân hàng của đối tác đổi theo, ghi audit log.

### E8. Quyết toán đa tiền tệ

`/admin/settlements` — đối soát ngoại tệ **bị chặn** nếu chưa cấu hình:

```
PAYOUT_EXCHANGE_RATES={"USD":26000}
PAYOUT_EXCHANGE_RATE_SOURCE=Phòng Tài chính
PAYOUT_EXCHANGE_RATE_EFFECTIVE_AT=2026-07-30T00:00:00.000Z
```

Thiếu nguồn hoặc bảng tỷ giá quá 168 giờ → từ chối lập đối soát. Mặc định tất cả
đối tác đều VND nên **không cần cấu hình** nếu không demo phần này.

### E9. Dọn phiên hết hạn

Đăng nhập, đổi mật khẩu ở `/change-password` → **các phiên khác bị đăng xuất**.
Tương tự khi partner đổi cấp quyền nhân viên (mục B5).

---

## F. Các trường hợp phải BỊ CHẶN

Hội đồng thường hỏi "hệ thống có chặn sai sót không". Danh sách nên demo:

| # | Thao tác | Kết quả đúng |
|---|---|---|
| 1 | Admin tự duyệt sao kê mình đã khớp | 409 `MAKER_CHECKER_SEPARATION_REQUIRED` |
| 2 | SCANNER cấp lại vé | 403 `STAFF_ACCESS_LEVEL_REQUIRED` |
| 3 | Số tiền chuyển khoản lệch | `BANK_TRANSFER_AMOUNT_MISMATCH`, không phát vé |
| 4 | Đình chỉ điểm không tick xác nhận | `CUSTOMER_IMPACT_ACKNOWLEDGEMENT_REQUIRED` |
| 5 | Voucher dùng ngoài phạm vi | Từ chối, nêu rõ lý do |
| 6 | Voucher hết hạn mức cá nhân | Từ chối, phân biệt với hết lượt toàn sàn |
| 7 | Quét lại vé đã check-in | Từ chối |
| 8 | Quét vé sai ngày / sai điểm | Từ chối |
| 9 | Hoàn tiền đơn chưa thu tiền | Từ chối |
| 10 | Chưa đồng ý chính sách mà đặt vé | 428 `POLICY_REACCEPTANCE_REQUIRED` |
| 11 | Khai thiếu hành khách | Chặn ở checkout |
| 12 | Doanh nghiệp không nhập MST | Chặn ở checkout |
| 13 | Đánh giá chuyến chưa đi | Chặn |
| 14 | Giữ chỗ hết hạn | Đơn tự hủy, trả vé về kho |
| 15 | Đối soát ngoại tệ thiếu nguồn tỷ giá | Từ chối lập đối soát |

---

## G. Kiểm tra tự động

Chạy trước buổi bảo vệ để chắc chắn không có gì hỏng:

```bash
cd "C:\Users\Lenovo\Desktop\New folder (2)\swp391-rbl-project-team_5\vietticket-travel\backend"; if ($?) { npm test }
```

```bash
cd "C:\Users\Lenovo\Desktop\New folder (2)\swp391-rbl-project-team_5\vietticket-travel\backend"; if ($?) { npm run demo:smoke }
```

Kết quả chuẩn đã đạt: **1087 unit test PASS**, **smoke 45 PASS**.

> `demo:smoke` tự chạy lại `demo:prepare` ở cuối để khôi phục dữ liệu, nên
> **sau khi chạy smoke phải chạy lại `npm run demo:gap`**.

Kiểm tra nhanh không ghi database:

```bash
cd "C:\Users\Lenovo\Desktop\New folder (2)\swp391-rbl-project-team_5\vietticket-travel\backend"; if ($?) { npm run demo:check }
```

---

## H. Điểm đã biết trước

| Vấn đề | Giải thích |
|---|---|
| `demo:check` cảnh báo **không có đề xuất Live-AutoPilot** | Kịch bản du thuyền khởi hành 16:30. Seed ngoài khung giờ đó thì không còn gì để đề xuất. Code coi đây là safe fallback hợp lệ. **Muốn demo phần này thì seed vào buổi sáng.** |
| Dự báo AI hiện `LOW confidence` | Model huấn luyện trên dữ liệu demo, gắn nhãn `AI_DEMO_ENSEMBLE`. Đúng thiết kế — hệ thống không nhận vơ độ chính xác. |
| Email không gửi được | Chưa cấu hình SMTP, nội dung email log ra console backend. Không ảnh hưởng nghiệp vụ. |
| Chatbot trả lời chung chung | Chưa có `GEMINI_API_KEY` / `OPENAI_API_KEY`. |
