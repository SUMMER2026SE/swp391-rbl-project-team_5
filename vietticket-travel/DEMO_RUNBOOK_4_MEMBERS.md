# Kịch bản bảo vệ VietTicket Travel — 4 thành viên

Tài liệu này dùng cho bộ dữ liệu vận hành tái lập v2 trên nhánh `HAnh`. Kịch bản chính kéo dài khoảng 32–38 phút, không trình bày đăng ký/đăng nhập/xác thực email. Các cửa sổ phải được đăng nhập sẵn trước khi giảng viên vào phòng.

### Nguyên tắc trung thực dữ liệu

- Dữ liệu nghiệp vụ nhìn thấy trên booking, vé, refund, support, KPI, báo cáo tài chính và đối soát là các hồ sơ vận hành có chủ đích, tên/mã/thời gian/trạng thái nhất quán và có thể thao tác xuyên suốt. Không gọi đây là giao dịch khách hàng production hay tiền thật.
- Các bản ghi có sẵn ngoài bộ tái lập được giữ nguyên. Lệnh chuẩn bị chỉ tạo/cập nhật các hồ sơ mà kịch bản sở hữu, không xóa dữ liệu người dùng khác.
- 270 quan sát lịch sử dùng để kiểm tra pipeline dự báo được gắn `isForecastTrainingSample=true`. Chúng chỉ đi vào dịch vụ forecast; mọi API booking, vé, support, Partner, Staff, Admin, KPI, tài chính và đối soát đều loại các quan sát này.
- Vì vậy số booking trên dashboard và danh sách có thể bao gồm hồ sơ vận hành thật đã có trong cơ sở dữ liệu, nhưng không bao giờ bị cộng phồng bởi lịch sử huấn luyện forecast.

## 1. Thông điệp xuyên suốt

VietTicket Travel không chỉ là trang bán vé. Hệ thống quản lý trọn vòng đời của một dịch vụ du lịch:

1. Partner được KYC và công bố sản phẩm có lịch, giá, sức chứa, chính sách hoàn.
2. Customer tìm kiếm hoặc dùng AI để chọn trải nghiệm, giữ chỗ, thanh toán và nhận QR.
3. Partner xử lý các booking cần xác nhận thủ công.
4. Staff check-in, cấp lại vé, hỗ trợ khách và xử lý hoàn tiền theo phạm vi quyền.
5. Admin kiểm duyệt, giám sát tài chính, đối soát và xem audit log.
6. AI dự báo hỗ trợ vận hành bằng lịch sử doanh thu; dữ liệu mô phỏng luôn được gắn nhãn rõ, không trình bày như độ chính xác production.

## 2. Chuẩn bị máy trước buổi demo

### 2.1. Quy tắc an toàn

- Không mở `backend/.env` trước máy chiếu; file này chứa khóa dịch vụ thật.
- Không chạy `demo:prepare` hoặc `demo:smoke` sau khi đã đăng nhập các cửa sổ. Hai lệnh này reset tài khoản demo và làm session cũ hết hiệu lực.
- Không phụ thuộc vào thanh toán VNPay trực tiếp trong bài chính. Dùng các booking đã chuẩn bị để trình bày đủ trạng thái; giao dịch sandbox không phải tiền thật.
- Không bấm cùng một hành động từ hai cửa sổ. Backend có khóa cạnh tranh và sẽ từ chối thao tác thứ hai.

### 2.2. Tối hôm trước: kiểm thử toàn bộ

Mở Terminal 1, chạy ML service và giữ nguyên cửa sổ:

```powershell
cd "D:\Desktop\KY5SU25\SWP\Attraction-Ticket System\swp391-rbl-project-team_5\vietticket-travel\ml-service"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Mở Terminal 2:

```powershell
cd "D:\Desktop\KY5SU25\SWP\Attraction-Ticket System\swp391-rbl-project-team_5\vietticket-travel\backend"
npm run demo:smoke
npm run demo:check
npm run demo:llm-check
```

`demo:llm-check` ưu tiên kiểm tra Gemini/OpenAI. Nếu dịch vụ ngoài hết hạn mức, mất mạng hoặc trả `429`, lệnh sẽ cảnh báo rồi tự xác minh lịch trình rule-based bằng catalog nội bộ. Preflight chỉ thất bại khi cả provider tăng cường lẫn luồng dự phòng đều không hoạt động. Dùng thêm `-- --require-provider` khi cần kiểm tra nghiêm ngặt riêng kết nối LLM.

`demo:smoke` chạy các thao tác customer, partner, gate staff, platform staff và admin trên API thật rồi tự phục hồi lại dữ liệu chuẩn. Kết quả cuối phải có dòng `SMOKE TEST THÀNH CÔNG` và thông báo dữ liệu đã được phục hồi nguyên trạng.

### 2.3. Sáng hôm demo: khởi động theo đúng thứ tự

Nếu đã chạy smoke-test tối hôm trước, sáng hôm demo chỉ cần tạo lại dữ liệu một lần:

Terminal 1 — ML service:

```powershell
cd "D:\Desktop\KY5SU25\SWP\Attraction-Ticket System\swp391-rbl-project-team_5\vietticket-travel\ml-service"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Terminal 2 — tạo dữ liệu rồi chạy backend:

```powershell
cd "D:\Desktop\KY5SU25\SWP\Attraction-Ticket System\swp391-rbl-project-team_5\vietticket-travel\backend"
npm run demo:prepare
npm run demo:check
npm run dev
```

Terminal 3 — frontend:

```powershell
cd "D:\Desktop\KY5SU25\SWP\Attraction-Ticket System\swp391-rbl-project-team_5\vietticket-travel"
npm run dev
```

Khi cả ba service đã chạy, mở Terminal 4:

```powershell
cd "D:\Desktop\KY5SU25\SWP\Attraction-Ticket System\swp391-rbl-project-team_5\vietticket-travel"
powershell -ExecutionPolicy Bypass -File .\demo-preflight.ps1
```

Chỉ tiếp tục khi thấy `PRE-FLIGHT PASS`.

## 3. Tài khoản và cửa sổ trình duyệt

Mật khẩu chung local: `Demo@VietTicket2026`

| Cửa sổ | Vai trò       | Email                                | Trang mở sẵn                              |
| -------- | -------------- | ------------------------------------ | ------------------------------------------- |
| A        | Customer       | `minh.anh.nguyen@vietticket.local` | `http://localhost:5173/`                  |
| B        | Partner        | `hoang.nam.tran@vietticket.local`  | `http://localhost:5173/partner/dashboard` |
| C        | Gate staff     | `quoc.bao.pham@vietticket.local`   | `http://localhost:5173/staff/checkin`     |
| D        | Platform staff | `thu.ha.le@vietticket.local`       | `http://localhost:5173/staff/refunds`     |
| E        | Admin          | `ngoc.lan.vu@vietticket.local`     | `http://localhost:5173/admin`             |

Dùng Chrome Profile/Edge/Firefox riêng để năm tài khoản không ghi đè cookie của nhau. Thành viên 3 giữ hai cửa sổ C và D. Đăng nhập trước, sau đó quay về đúng trang mở sẵn; không trình bày bước authentication.

## 4. Dữ liệu nhận diện nhanh

| Dữ liệu                  | Giá trị dùng trong kịch bản                                    |
| -------------------------- | ------------------------------------------------------------------- |
| Thành phố tìm kiếm     | `ho chi minh`                                                     |
| Voucher                    | `KHAMPHA15` — giảm 15%, tối đa 100.000đ, đơn từ 200.000đ |
| QR check-in chính         | `VTQ-A74C-91D2-E8B5-01`                                           |
| QR dự phòng              | `VTQ-A74C-91D2-E8B5-02`                                           |
| Điểm giá thấp          | Bảo tàng Mỹ thuật Thành phố Hồ Chí Minh                     |
| Điểm cần Partner duyệt | Tour Hoàng hôn trên sông Sài Gòn                              |
| Điểm trọn ngày         | Khu du lịch sinh thái Vàm Sát – Cần Giờ                      |
| Bản nháp Partner         | Tour Ẩm thực Chợ Lớn – Bản nháp                              |
| Chờ Admin duyệt          | Không gian Văn hóa Áo dài Việt Nam                            |
| Chờ Admin từ chối       | Trải nghiệm Chợ nổi Sài Gòn                                   |
| Điểm đang đình chỉ   | Khu vui chơi Ven sông Sài Gòn                                   |

Nguồn kiểm chứng danh mục:

- Bảo tàng Mỹ thuật Thành phố Hồ Chí Minh: địa chỉ, giờ mở cửa và vé tiêu chuẩn được đối chiếu tại [trang tham quan chính thức](https://baotangmythuattphcm.com.vn/tham-quan).
- Vàm Sát: vé vào cổng tiêu chuẩn được đối chiếu tại [bảng giá dịch vụ chính thức](https://vamsat.vn/bang-gia-dich-vu/). Các gói 520.000đ/360.000đ trên hệ thống là gói trọn ngày của Partner, có thêm trung chuyển, tuyến trải nghiệm và hướng dẫn viên; không trình bày đó là giá vé vào cổng.
- Tour Hoàng hôn là sản phẩm do Partner cấu hình và chịu trách nhiệm vận hành, không mượn tên hoặc giá niêm yết của một hãng tàu khác.

Ký hiệu `T` dưới đây là ngày chạy `demo:prepare`. Dữ liệu tự dịch ngày theo ngày demo:

| Mốc | Kịch bản                                                                                 |
| ---- | ------------------------------------------------------------------------------------------ |
| T    | Hai QR hợp lệ để check-in; một vé khác đã dùng để chứng minh chặn quét lại |
| T+2  | Booking du thuyền chờ Partner duyệt                                                     |
| T+3  | Booking du thuyền chờ Partner từ chối                                                  |
| T+5  | Booking Customer có thể tự gửi yêu cầu hoàn                                         |
| T+6  | Refund đã đối soát sandbox thành công, chờ Staff hoàn tất DB                     |
| T+7  | Refund an toàn để Staff từ chối có lý do                                            |
| T+8  | Booking riêng để cấp lại QR                                                           |

## 5. Thứ tự trình bày bắt buộc

1. Thành viên 1 — Public/Customer.
2. Thành viên 2 — Partner.
3. Thành viên 3 — Gate staff và Platform staff.
4. Thành viên 4 — Admin.

Thứ tự này giúp người xem thấy dữ liệu đi từ nhu cầu khách hàng đến vận hành và quản trị. Admin tạm ẩn địa điểm ở cuối để không ảnh hưởng phần public/partner trước đó.

---

## 6. Thành viên 1 — Hành trình Customer (8–9 phút)

### Mục tiêu

Chứng minh khách chọn đúng sản phẩm du lịch theo ngày, nhóm người, ngân sách; hiểu giá/chính sách trước khi trả tiền; quản lý vé, đánh giá, hoàn tiền và hỗ trợ sau bán.

### 6.1. Trang chủ, tìm kiếm và chi tiết điểm tham quan

1. Từ trang chủ, giới thiệu nhanh hero, loại hình du lịch, điểm phổ biến và chatbot nổi.
2. Mở `/attractions`, tìm `ho chi minh`.
3. Dùng bộ lọc loại hình hoặc mức giá; chuyển danh sách/bản đồ nếu có.
4. Mở `Bảo tàng Mỹ thuật Thành phố Hồ Chí Minh`.
5. Chỉ vào ảnh, địa chỉ, giờ mở cửa, bản đồ/thời tiết, rating và các gói người lớn/trẻ em/học sinh.

Lời thoại:

> Catalog công khai chỉ lấy địa điểm đã được duyệt, đang phát hành, đang vận hành và thuộc Partner còn hoạt động. Giá vé, độ tuổi, điều kiện đi kèm người lớn, lịch và sức chứa đều là dữ liệu nghiệp vụ chứ không phải nội dung tĩnh.

### 6.2. Gợi ý theo tiêu chí

Quay về trang chủ, kéo đến `Gợi ý địa điểm theo tiêu chí của bạn`:

- Ngân sách: `1200000`
- Ngày: T+1
- Người lớn: `2`
- Trẻ em: `1`
- Thành phố: `ho chi minh`
- Loại hình: `Bảo tàng` và `Thiên nhiên & Ngắm cảnh`
- Ưu tiên: `Đánh giá cao`
- Đi cùng: `Gia đình có trẻ`

Bấm `Gợi ý cho tôi`, chỉ vào ba kết quả và gói vé theo đúng cơ cấu 2 người lớn + 1 trẻ.

Lời thoại:

> Phần này là recommendation có thể giải thích: hệ thống lọc catalog thật, kiểm tra vé theo ngày, ghép đúng loại vé người lớn/trẻ em, loại phương án vượt ngân sách rồi xếp hạng theo tiêu chí. Kết quả là các lựa chọn độc lập, không đánh tráo thành một combo nhiều điểm.

### 6.3. Lịch trình AI

Mở `/attractions`, bấm `Kế hoạch tham quan AI`:

- Thành phố: `ho chi minh`
- Số ngày: `2`
- Bắt đầu: T+1
- 2 người lớn, 1 trẻ em
- Ngân sách: `1800000`
- Nhịp độ: `Vừa phải`
- Ưu tiên: `Đánh giá cao`
- Đi cùng: `Gia đình có trẻ`

Tạo kế hoạch. Chỉ vào:

- Hoạt động theo ngày và khung giờ.
- Giá nhóm, thời lượng tham quan.
- Khoảng cách/thời gian di chuyển và bản đồ.
- Thời tiết, phương án thay thế, cảnh báo nếu không đủ sức chứa/ngân sách.
- Tiêu đề và mẹo do Gemini sinh; lịch và giá do backend rule-based tạo từ DB.

Sau đó mở lịch trình đã lưu `Hồ Chí Minh 2 ngày: di sản và sinh thái` để có phương án dự phòng ổn định. Không cần xóa lịch trình.

Lời thoại:

> LLM không được tự bịa địa điểm hay giá. Backend chọn dữ liệu thật, kiểm tra ngày, thời lượng, khoảng di chuyển và ngân sách; Gemini chỉ hỗ trợ tiêu đề và mẹo ngắn. Nếu provider ngoài lỗi, lịch trình nghiệp vụ vẫn chạy bằng rule-based.

### 6.4. Vé điện tử và vòng đời sau bán

Mở `/my-tickets`:

1. Chỉ các tab Chờ thanh toán, Đang sử dụng, Lịch sử và các trạng thái đã seed.
2. Mở booking ngày T để xem e-ticket/QR; không tự check-in ở màn Customer.
3. Mở booking `COMPLETED` ngày T-2 chưa review, bấm đánh giá 5 sao, nhập:
   `Trải nghiệm đúng mô tả, quy trình nhận vé rõ ràng và nhân viên hỗ trợ tốt.`
4. Mở booking Bảo tàng ngày T+5, bấm yêu cầu hoàn. Chỉ cho giảng viên xem preview chính sách, deadline, phí và số tiền hoàn. Nếu muốn tạo thật, nhập:
   `Gia đình thay đổi lịch trình và gửi yêu cầu trước thời hạn miễn phí.`
5. Mở `/favorites` để cho thấy ba địa điểm đã lưu.

Lời thoại:

> Booking lưu snapshot tên điểm, giá, chính sách hoàn và hoa hồng tại thời điểm mua, nên Partner đổi giá sau này không làm sai hóa đơn cũ. Chỉ booking đã hoàn thành mới được review; vé đã dùng không được hoàn.

### 6.5. Hỗ trợ khách hàng

Mở `/support` và tạo ticket mới:

- Tiêu đề: `Cần xác nhận hiệu lực từng mã QR`
- Chọn booking ngày T nếu giao diện cho chọn.
- Nội dung: `Gia đình đến cổng ở hai thời điểm khác nhau, nhờ xác nhận mỗi mã QR có thể check-in riêng.`

Mở `/my-support` để chỉ lịch sử OPEN/IN_PROGRESS/RESOLVED và chat hai chiều.

Chốt bàn giao:

> Khi khách đã thanh toán, nghiệp vụ chuyển sang Partner và đội vận hành. Tiếp theo nhóm sẽ xử lý đúng các đơn tôi vừa giới thiệu.

---

## 7. Thành viên 2 — Partner vận hành sản phẩm (9–10 phút)

### Mục tiêu

Chứng minh Partner quản lý catalog, lịch/sức chứa, nhân sự, booking, review, báo cáo, dự báo và đối soát trong đúng phạm vi sở hữu.

### 7.1. Dashboard và quản lý điểm

1. Từ `/partner/dashboard`, giải thích các KPI: điểm hoạt động, gói vé, booking tháng, vé bán, lấp đầy, doanh thu thuần và thực nhận.
2. Mở `/partner/attractions`.
3. Cho thấy ba điểm active, hai điểm pending, một điểm suspended và bản nháp.
4. Mở `Tour Ẩm thực Chợ Lớn – Bản nháp`; chỉ các trường mô tả, tọa độ, môi trường, thời lượng. Không gửi duyệt nếu muốn giữ dữ liệu cho lần tập sau.
5. Mở quản lý gói vé của Bảo tàng: giá gốc/giá bán, loại vé, độ tuổi, chính sách hoàn.
6. Mở lịch/sức chứa của Du thuyền: hai khung 16:30 và 18:30; chỉ ngày đặc biệt bảo trì T+14.

Lời thoại:

> Điểm tham quan, gói vé và lịch là ba lớp riêng. Sức chứa được giữ theo ngày/khung giờ bằng stock, tránh bán vượt tải. Nội dung Partner gửi duyệt được chụp thành snapshot để Admin xem đúng phiên bản, không bị thay đổi ngầm trong lúc duyệt.

### 7.2. Booking cần Partner xác nhận

Mở `/partner/bookings`, lọc `Chờ đối tác`:

1. Chọn booking Du thuyền ngày T+2, số lượng 2, bấm duyệt.
2. Giải thích sau duyệt hệ thống tạo QR và báo cho Customer.
3. Chọn booking Du thuyền ngày T+3, bấm từ chối, lý do:
   `Tàu phải bảo trì đột xuất nên không thể phục vụ đúng khung giờ đã đặt.`

Lời thoại:

> Đây là đơn đã thanh toán nhưng sản phẩm yêu cầu xác nhận tải trọng. Nếu Partner từ chối, khách không mất tiền: booking bị hủy, tồn kho được trả và một yêu cầu hoàn bắt buộc được tạo để đội nền tảng xử lý.

### 7.3. Nhân viên và đánh giá

1. Mở `/partner/staff`, chỉ nhân viên cổng đã được gán đúng ba địa điểm của Partner.
2. Mở `/partner/reviews`, tìm review 5 sao chưa phản hồi và nhập:
   `Cảm ơn góp ý của bạn. Chúng tôi đã bổ sung biển hướng dẫn tại quầy đón khách.`
3. Giải thích Partner chỉ phản hồi, không được tự ẩn đánh giá.

### 7.4. Báo cáo và AI dự báo doanh thu

Mở `/partner/reports`:

1. Giải thích doanh số thuần, hoa hồng và thực nhận là ba con số khác nhau.
2. Kéo đến `Dự báo doanh thu`.
3. Chọn 7 ngày và lần lượt ba điểm Bảo tàng, Du thuyền, Cần Giờ.
4. Chỉ tổng doanh thu dự kiến, dải tin cậy, biểu đồ theo ngày, số booking lịch sử và nhãn `Mô hình ước tính thử nghiệm`.

Lời thoại chuẩn:

> Đây là pipeline ML thật chạy Random Forest kết hợp XGBoost, target là doanh thu vé thuần theo ngày sử dụng dịch vụ. Bộ kiểm thử có 90 ngày lịch sử cho ba điểm và được cách ly khỏi dữ liệu vận hành bằng cờ kỹ thuật riêng. Giao diện ghi rõ đây là mô hình ước tính thử nghiệm; nhóm không dùng dữ liệu kiểm thử để tuyên bố độ chính xác thực tế.

> Khi có dữ liệu production, pipeline chỉ nhận booking COMPLETED/NO_SHOW đã thanh toán thành công, bỏ giao dịch trùng, trừ refund, zero-fill ngày không bán và không dùng ngày hiện tại chưa chốt. Nếu thiếu dữ liệu, hệ thống hiện baseline hoặc `chưa đủ dữ liệu`, không giả kết quả AI.

### 7.5. Đối soát Partner

Mở `/partner/settlements`, chỉ ba trạng thái Nháp/Đã duyệt/Đã chuyển khoản và số tiền phải trả.

Chốt bàn giao:

> Partner vận hành sản phẩm và khách tại điểm; các quyền tài chính nhạy cảm, check-in và kiểm duyệt được tách sang staff/admin.

---

## 8. Thành viên 3 — Gate staff và Platform staff (7–8 phút)

### Mục tiêu

Chứng minh phân tách nhiệm vụ: nhân viên cổng chỉ thao tác các điểm được Partner gán; nhân viên nền tảng xử lý refund và support toàn hệ thống.

### 8.1. Check-in tại cổng

Ở cửa sổ Gate staff `/staff/checkin`:

1. Chỉ danh sách booking hôm nay: một đoàn có hai QR hợp lệ và một booking đã check-in.
2. Nhập `VTQ-A74C-91D2-E8B5-01`, bấm tra cứu.
3. Đối chiếu tên khách, điểm, ngày, gói vé, trạng thái và bấm check-in.
4. Nhập lại cùng QR để cho thấy hệ thống chặn dùng lần hai.
5. QR `VTQ-A74C-91D2-E8B5-02` là dự phòng; không quét nếu đã đủ thời gian.

Lời thoại:

> Mỗi TicketInstance có token riêng. Backend kiểm tra trạng thái, đúng ngày/giờ, booking còn hiệu lực và nhân viên có assignment tới điểm đó. Check-in dùng update có điều kiện nên hai cổng quét đồng thời cũng chỉ một request thắng.

### 8.2. Cấp lại vé

Trong danh sách staff, chọn booking Cần Giờ ngày T+8 và cấp lại với:

- Lý do: `Mã QR bị lỗi/không đọc được`
- Mô tả: `Mã QR trên điện thoại của khách bị lỗi hiển thị tại cổng.`

Lời thoại:

> Cấp lại không sửa token cũ. Hệ thống đánh dấu toàn bộ QR cũ là EXPIRED, tạo QR mới và ghi audit log gồm người thực hiện, mã lý do và danh sách vé thay thế.

### 8.3. Refund

Chuyển sang cửa sổ Platform staff `/staff/refunds`:

1. Chọn yêu cầu Bảo tàng ngày T+6; chỉ số tiền gốc, phí, số tiền hoàn, chính sách snapshot và kết quả giao dịch sandbox đã đối soát.
2. Duyệt với ghi chú:
   `Đã kiểm tra giao dịch và xác nhận kết quả hoàn tiền sandbox thành công.`
3. Chọn yêu cầu ngày T+7 và từ chối:
   `Yêu cầu đã quá thời hạn hoàn tiền theo chính sách được lưu tại thời điểm đặt.`

Nếu thành viên 1 đã tạo refund ngày T+5, chỉ cho thấy nó xuất hiện trong hàng chờ; không cần xử lý để tránh nhầm mục tiêu.

Lời thoại:

> Bài demo không giả lập tiền đã về ngân hàng. Yêu cầu được duyệt đã có RefundTransaction sandbox thành công, staff chỉ hoàn tất trạng thái DB một cách idempotent. Ở môi trường thật, backend gọi VNPay Refund API; nếu timeout sẽ chuyển sang trạng thái cần đối soát thay vì hoàn mù.

### 8.4. Support realtime

Mở `/staff/tickets`:

1. Tìm ticket `Cần xác nhận hiệu lực từng mã QR` của thành viên 1; nếu không có, dùng `Cần hỗ trợ nhận diện mã QR tại cổng`.
2. Gửi:
   `Chúng tôi đã kiểm tra và xác nhận mỗi mã QR được check-in riêng cho một khách.`
3. Chuyển trạng thái RESOLVED, mã kết quả `Đã cung cấp thông tin`, kết luận:
   `Đã xác nhận hiệu lực vé và hướng dẫn khách cách check-in tách lượt tại cổng.`

Lời thoại:

> Tin nhắn đầu tiên của staff tự claim ticket để hai người không xử lý trùng. Ticket chỉ được đóng sau khi đã có phản hồi và phải lưu mã kết quả cùng kết luận nghiệp vụ.

Chốt bàn giao:

> Các thao tác vận hành đều tạo dấu vết. Thành viên cuối sẽ trình bày lớp quản trị và kiểm soát toàn hệ thống.

---

## 9. Thành viên 4 — Admin và quản trị nền tảng (9–10 phút)

### Mục tiêu

Chứng minh Admin không can thiệp tùy ý mà thao tác theo workflow duyệt, trạng thái hợp lệ, lý do bắt buộc và audit log.

### 9.1. Dashboard, booking và tài chính

1. Từ `/admin`, chỉ KPI người dùng, Partner, điểm, booking, tiền qua cổng, hoa hồng đã ghi nhận.
2. Chỉ panel forecast toàn nền tảng và nhãn nguồn dữ liệu mô hình.
3. Mở `/admin/bookings`, lọc vài trạng thái: chờ Partner, hoàn tiền, completed, no-show, cancelled.
4. Mở `/admin/reports`, giải thích dòng tiền qua cổng, refund, doanh thu thuần, commission và phần phải trả Partner.

### 9.2. Duyệt KYC Partner

Mở `/admin/kyc-approval`:

1. Mở `Công ty TNHH Hành trình Xanh`, xem giấy phép, mã số thuế, đại diện, ngân hàng; bấm duyệt.
2. Mở `Hộ kinh doanh Du lịch Bình Minh`, bấm từ chối với lý do:
   `Tên chủ tài khoản ngân hàng chưa trùng với tên pháp lý trên giấy phép kinh doanh.`

Lời thoại:

> Tài liệu KYC nằm ở private storage và URL phải cùng trusted origin, tên file phải thuộc đúng user. Admin duyệt hồ sơ, không nhận một URL tài liệu tùy ý từ Internet.

### 9.3. Duyệt điểm tham quan

Mở `/admin/attraction-approval`:

1. Duyệt `Không gian Văn hóa Áo dài Việt Nam`.
2. Từ chối `Trải nghiệm Chợ nổi Sài Gòn` với:
   `Cần bổ sung phương án an toàn đường thủy và ảnh rõ khu vực trang bị áo phao.`

Lời thoại:

> Admin duyệt snapshot gồm nội dung, danh mục, ảnh, gói vé và lịch. Nếu danh mục bị khóa hoặc snapshot thiếu trường, backend không cho duyệt.

### 9.4. Vi phạm và ba lớp trạng thái

Mở `/admin/violations`:

1. Tạm ẩn `Bảo tàng Mỹ thuật Thành phố Hồ Chí Minh` với:
   `Tạm ẩn để kiểm tra phản ánh về thời gian mở cửa trong ngày lễ.`
2. Khôi phục `Khu vui chơi Ven sông Sài Gòn`.

Giải thích rõ:

- `status=APPROVED`: nội dung đã qua duyệt.
- `operationalStatus=SUSPENDED/ACTIVE`: có được vận hành hay không.
- `publicationStatus=ACTIVE/PAUSED`: có đang công khai bán hay không.

Sau khi Admin khôi phục, điểm trở về vận hành ACTIVE nhưng vẫn PAUSED; Partner phải chủ động phát hành lại. Đây là tách trách nhiệm, không phải lỗi.

### 9.5. Review, danh mục, voucher, user

1. Mở `/admin/reviews`, chọn review 2 sao nhắc đích danh nhân viên trực ca, ẩn với:
   `Nội dung chứa công kích cá nhân, không phản ánh chất lượng dịch vụ du lịch.`
2. Mở `/admin/categories`, chỉ taxonomy dùng chung với bộ lọc AI; không xóa category đang được dùng.
3. Mở `/admin/vouchers`, tìm `KHAMPHA15`, chỉ điều kiện đơn tối thiểu, phần trăm, trần giảm và hạn dùng.
4. Mở `/admin/users`, chỉ tìm kiếm/lọc role/status và quản lý platform staff. Không khóa tài khoản demo trong bài chính.

### 9.6. Đối soát và audit log

Mở `/admin/settlements`:

1. Duyệt kỳ DRAFT.
2. Chọn kỳ APPROVED, ghi nhận đã trả với mã `FT262010845731`.
3. Chỉ kỳ PAID lịch sử và booking items bên trong.

Mở `/admin/audit-logs`, tìm các action mới: KYC, attraction, review, check-in, reissue, settlement.

Lời thoại:

> Đối soát chỉ lấy booking đã đủ điều kiện, chưa nằm trong kỳ chưa hủy; số tiền dùng snapshot commission. Chuyển trạng thái theo DRAFT → APPROVED → PAID, mã ngân hàng là duy nhất. Các hành động nhạy cảm đều có actor, entity, thời gian, IP và metadata cần thiết để truy vết.

### 9.7. Kết luận chung

> Nhóm đã trình bày một vòng đời khép kín từ catalog, AI hỗ trợ lựa chọn, booking/vé, Partner xác nhận, check-in, refund/support đến kiểm duyệt, tài chính, đối soát và audit. Các module không chỉ nối màn hình; backend giữ ràng buộc trạng thái, quyền sở hữu, tồn kho và tính nhất quán tiền.

---

## 10. Các câu hỏi phản biện nên trả lời thống nhất

### “AI dự báo này có thật hay chỉ random?”

Pipeline thật dùng ensemble Random Forest + XGBoost, có lag 1/7/14 ngày, rolling mean, cuối tuần, lễ Việt Nam và split validation theo thời gian. Bộ bảo vệ dùng lịch sử kiểm thử có kiểm soát, được cách ly hoàn toàn khỏi booking/KPI/tài chính; giao diện bắt buộc ghi `Mô hình ước tính thử nghiệm`. Nhóm không dùng metric kiểm thử để cam kết production.

### “Vì sao báo cáo dự báo có nhiều đơn lịch sử hơn danh sách booking?”

Dịch vụ forecast cần chuỗi dữ liệu đủ dài để kiểm thử thuật toán. Các quan sát huấn luyện được đánh dấu bằng `isForecastTrainingSample`, chỉ truy cập trong pipeline dự báo và bị chặn ở cả API danh sách lẫn API truy cập trực tiếp. Do đó đây không phải các đơn hàng ẩn, không tạo doanh thu kế toán, không sinh vé và không tham gia đối soát.

### “Tại sao không dùng Gemini để dự báo doanh thu?”

Doanh thu là bài toán chuỗi thời gian có số liệu cấu trúc, cần metric và tái lập nên dùng ML regression. Gemini phù hợp sinh tiêu đề/mẹo và chatbot; không được tự quyết định số tiền dự báo.

### “Nếu điểm mới chưa có dữ liệu?”

Backend không gọi model nếu chưa đủ tối thiểu 14 ngày có doanh thu và 30 booking hoàn tất. Có lịch sử ít thì hiện `HISTORICAL_BASELINE`; không có thì hiện `INSUFFICIENT_DATA`. UI không cộng 0 giả vào tổng dự báo thành công.

### “Forecast có rò rỉ dữ liệu tương lai không?”

Lịch sử kết thúc ở ngày hôm qua, chia train/validation theo thời gian, feature động chỉ lấy lag/rolling từ quá khứ. Dự báo còn bị chặn âm và giới hạn bởi sức chứa.

### “Vì sao Partner từ chối sau khi khách đã trả tiền?”

Chỉ sản phẩm `requiresManualApproval` mới có bước này, ví dụ tàu cần xác nhận tải trọng. Nếu từ chối, hệ thống hủy booking, trả tồn và tạo mandatory refund đầy đủ; Partner không giữ tiền khách.

### “Luồng hoàn tiền có chuyển tiền thật không?”

Không. Dữ liệu bảo vệ dùng giao dịch VNPay sandbox đã đối soát để minh họa bước hoàn tất an toàn. Production gọi Refund API, lưu request/response và có worker reconcile khi kết quả chưa chắc chắn.

### “Tại sao Admin khôi phục rồi điểm chưa public?”

Admin xác nhận hết đình chỉ vận hành; Partner chịu trách nhiệm quyết định khi nào phát hành bán lại. Vì vậy operational ACTIVE nhưng publication PAUSED là có chủ đích.

### “Tại sao có hai loại staff?”

Gate staff thuộc Partner và chỉ thao tác các attraction được assignment. Platform staff thuộc nền tảng, không thuộc Partner, xử lý refund/support/moderation. Việc tách quyền giảm lạm dụng và đúng separation of duties.

## 11. Phương án cứu demo

### Gemini hoặc OpenAI lỗi

- Gợi ý địa điểm vẫn chạy rule-based và không gọi LLM.
- Lịch trình vẫn có lịch/giá/tuyến rule-based; chỉ title/tips dùng fallback.
- Mở lịch trình đã seed `Hồ Chí Minh 2 ngày: di sản và sinh thái`.
- Không dành thời gian sửa key trước giảng viên.

### ML service mất kết nối

- Không bấm làm mới forecast liên tục.
- Cache 7 ngày đã được tạo bởi `demo:prepare`; giải thích rõ thời điểm tạo.
- Nếu trang chưa tải cache, chuyển sang báo cáo lịch sử và nói pipeline forecast là service tách riêng đang được health-check.

### VNPay/Internet chậm

- Không thanh toán live trong kịch bản chính.
- Dùng booking `PENDING_PAYMENT`, `PENDING_PARTNER`, `CONFIRMED`, `REFUND_REQUESTED`, `REFUNDED` đã seed để giải thích vòng đời.
- Ảnh ngoài không tải không ảnh hưởng dữ liệu, giá, lịch hay thao tác.

### Dữ liệu đã bị thao tác khi tập

Chỉ làm khi chưa có giảng viên và chấp nhận đăng nhập lại tất cả cửa sổ:

```powershell
cd backend
npm run demo:prepare
npm run demo:check
```

### Một tài khoản bị logout

Đăng nhập lại ở đúng cửa sổ riêng rồi quay về route đã ghi trong bảng. Không demo quy trình authentication.

## 12. Checklist 3 phút trước khi bắt đầu

- [ ] `git branch --show-current` trả `HAnh`.
- [ ] ML `/health`: model đã nạp và trả trạng thái `healthy`.
- [ ] Backend `/api/health`: database connected.
- [ ] Frontend mở được `http://localhost:5173`.
- [ ] `demo-preflight.ps1` PASS.
- [ ] Năm cửa sổ đã đăng nhập đúng role và đúng route.
- [ ] Zoom trình duyệt 90–100%, tắt notification cá nhân.
- [ ] Clipboard có `VTQ-A74C-91D2-E8B5-01`, `KHAMPHA15` và các câu lý do mẫu.
- [ ] Không mở `.env`, terminal chứa key hoặc trang quản lý API key khi đang chiếu.
- [ ] Thành viên 1 bắt đầu; các thành viên khác không thao tác dữ liệu trước lượt.
