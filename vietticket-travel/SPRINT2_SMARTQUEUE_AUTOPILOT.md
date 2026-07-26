# Sprint 2 — VietTicket Live Trip Autopilot + SmartQueue

## 1. Mục tiêu nghiệp vụ

Sprint 2 biến lịch trình tĩnh thành một lớp điều phối chuyến đi theo dữ liệu vận hành hiện có:

- **Arrival Pressure** tổng hợp tồn chỗ, booking, tỷ lệ khách đến, QR check-in gần đây và số khách đang chờ.
- **Autopilot** phát hiện hoạt động có rủi ro và chỉ tạo đề xuất đổi giờ khi tìm được khung ít đông hơn, đủ sức chứa và không xung đột lịch trình.
- **SmartQueue** giữ thứ tự vào cổng cho booking hợp lệ, ước lượng thời gian chờ và đồng bộ trạng thái khi nhân viên quét QR.
- **Live Event Timeline + Socket.IO** giải thích quyết định và cập nhật giao diện gần realtime.

Đây là hệ thống hỗ trợ quyết định, không tuyên bố đếm người bằng cảm biến và không tự ý sửa booking đã thanh toán.

## 2. Các bất biến không được vi phạm

### Autopilot

1. Không đổi, hủy hoặc hoàn tiền booking.
2. Hoạt động đã liên kết booking chỉ được cảnh báo; không được tạo đề xuất đổi giờ.
3. Hoạt động chưa có booking chỉ được đề xuất khi:
   - điểm tham quan đang hoạt động;
   - khung mới có pressure nhỏ hơn `70/100` và thấp hơn khung hiện tại;
   - còn đủ chỗ cho cả nhóm;
   - còn đủ thời gian để khách quyết định;
   - không đè lên hoạt động khác, kể cả buffer di chuyển 30 phút.
4. Khách phải bấm chấp nhận hoặc từ chối.
5. Khi chấp nhận, backend kiểm tra lại lịch, sức chứa, pressure và trạng thái điểm tham quan trong cùng transaction.
6. Mỗi hoạt động có tối đa một đề xuất `PENDING`; lịch sử đề xuất cũ vẫn được giữ.

### SmartQueue

1. Chỉ tài khoản sở hữu chuyến đi và booking mới thao tác được.
2. Chỉ booking `CONFIRMED`, đúng ngày tham quan theo giờ Việt Nam, chưa có vé `USED` mới được tham gia.
3. Mở theo `openBeforeMinutes` do đối tác cấu hình và đóng khi hoạt động kết thúc.
4. Chỉ mở khi pressure từ `70/100`; nếu không đông, khách đi thẳng đến cổng.
5. Số người trong lượt lấy từ `Reservation.quantity`, không tin dữ liệu do client gửi.
6. Thứ tự FIFO dùng `joinedAt`, sau đó dùng `id` để phá hòa.
7. Request join lặp hoặc đồng thời không được reset `joinedAt`, không tạo event join trùng.
8. `READY` chỉ có nghĩa là mời khách đến cổng; quyền vào cổng vẫn do nhân viên xác nhận bằng QR.
9. QR check-in thành công là nguồn sự thật để chuyển `ADMITTED`. Nếu hook realtime lỗi, worker sẽ tự phục hồi từ vé `USED`.
10. Mỗi booking chỉ đăng ký một lần cho hoạt động trong ngày; số nhóm active không vượt policy hữu hạn.
11. Staff chỉ gọi đúng FIFO và chỉ ghi no-show khi return window đã hết.
12. Khi một hoạt động chưa có booking đã qua khung giờ, Live Trip chuyển hoạt động sang `SKIPPED` và ghi timeline; hoạt động đã có booking nhưng chưa hoàn tất chuyển `AT_RISK` để bảo vệ quyền lợi khách và chờ đối soát.

## 3. Công thức ETA minh bạch

Ưu tiên throughput QR thực tế trong 15 phút gần nhất:

```text
ETA phút = ceil((khách phía trước + số khách của lượt hiện tại)
                 / (QR check-in 15 phút gần nhất / 15))
```

Khi chưa có đủ dữ liệu QR, hệ thống dùng `fallbackThroughput15m` do đối tác cấu hình. ETA được chặn tối đa 240 phút và luôn trả về `estimateBasis` cùng `confidence` để giao diện không trình bày con số ước lượng như sự thật tuyệt đối.

## 4. API Sprint 2

Tất cả endpoint dưới đây yêu cầu đăng nhập với vai trò `CUSTOMER` và kiểm tra ownership ở backend.

| Method | Endpoint | Ý nghĩa |
| --- | --- | --- |
| `POST` | `/api/live/trips/:tripId/autopilot/refresh` | Phân tích lại rủi ro và đề xuất |
| `POST` | `/api/live/trips/:tripId/proposals/:proposalId/decision` | Chấp nhận/từ chối đề xuất |
| `GET` | `/api/live/trips/:tripId/items/:itemId/queue` | Đọc trạng thái queue, không gây mutation |
| `POST` | `/api/live/trips/:tripId/items/:itemId/queue` | Tham gia hoặc đọc lại lượt hiện hữu |
| `DELETE` | `/api/live/trips/:tripId/items/:itemId/queue` | Rời SmartQueue nếu chưa admitted |

Socket event `LIVE_TRIP_UPDATED` chỉ phát đến room của đúng khách hàng, mang `tripId`, `itemId`, `reason`, `queueStatus` hoặc `proposalId` để client tải lại nguồn dữ liệu chính thức.

## 5. Worker và khả năng phục hồi

Worker chạy mỗi 60 giây và dùng `ScheduledJobLock` để chỉ một instance xử lý tại một thời điểm khi scale ngang:

1. Làm mới SmartQueue: hết hạn, mời lượt đầu tiên, tự chữa trạng thái từ QR.
2. Làm mới Autopilot: hết hạn đề xuất, cập nhật rủi ro, tạo đề xuất mới và hoàn tất item/trip.
3. Lỗi của một queue/trip được cô lập; worker tiếp tục xử lý bản ghi khác.
4. Check-in vé không bị rollback chỉ vì lớp SmartQueue hoặc socket tạm lỗi.

## 6. Kịch bản demo bảo vệ

### Kịch bản A — Autopilot có kiểm soát

1. Mở một Live Trip có hoạt động chưa gắn booking ở khung đông.
2. Bấm **Phân tích lại**.
3. Chỉ ra pressure hiện tại, khung giờ mới, chỗ còn lại, buffer và hạn xác nhận.
4. Bấm **Chấp nhận** và chứng minh LiveTripItem đổi giờ nhưng booking không thay đổi.
5. Mở timeline để cho thấy lý do và thời điểm quyết định được lưu bền vững.

### Kịch bản B — Bảo vệ booking đã thanh toán

1. Mở hoạt động có booking `CONFIRMED` ở khung đông.
2. Autopilot chỉ đánh dấu rủi ro và hiển thị SmartQueue; không có nút đổi booking.
3. Nhấn mạnh invariant `mutatesPaidBookings: false`.

### Kịch bản C — SmartQueue đến QR check-in

1. Trong đúng ngày và trong cửa sổ `openBeforeMinutes`, bấm **Tham gia SmartQueue**.
2. Chỉ ra vị trí, số khách phía trước, ETA, basis và confidence.
3. Khi đến lượt, giao diện nhận socket và chuyển `READY`.
4. Nhân viên quét QR; trạng thái chuyển `ADMITTED`, booking/ticket giữ nguyên nghiệp vụ check-in hiện có.
5. Staff/AUTO chỉ được gọi từ 15 phút trước giờ tham quan; gọi sớm trả
   `QUEUE_CALL_TOO_EARLY`.

### Kịch bản D — Thầy cô hỏi về dữ liệu giả lập

Trả lời rõ: pressure là chỉ số proxy từ dữ liệu booking/tồn chỗ/QR/queue trong hệ thống, không phải số người đo từ camera hoặc cảm biến. Giá trị “wow” nằm ở quyết định có guard, explainability, concurrency safety và vòng đời end-to-end, không phải ở việc gắn nhãn AI cho một con số giả.

## 7. Cài migration và kiểm tra

Không chạy migration production khi chưa sao lưu và xác nhận đúng database.

```powershell
cd backend
npx prisma migrate deploy
npx prisma generate
npm test

cd ..
npm run lint
npm test
npm run build
```

Migration Sprint 2: `backend/prisma/migrations/20260720210000_add_smart_queue_autopilot/migration.sql`.

## 8. Tiêu chí hoàn thành Sprint 2

- Schema và Prisma Client hợp lệ.
- API có authentication, authorization và ownership guard.
- Đề xuất có accept/reject/expire/supersede và kiểm tra lại điều kiện trước khi áp dụng.
- Queue có join/read/cancel/ready/admitted/expire, FIFO, ETA và idempotency khi concurrent.
- QR check-in và worker có cơ chế tự phục hồi.
- Timeline và realtime phản ánh các chuyển trạng thái quan trọng.
- Backend test, frontend test, ESLint và production build đều phải xanh trước khi merge.
