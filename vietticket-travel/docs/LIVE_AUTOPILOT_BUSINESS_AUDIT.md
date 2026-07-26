# Audit nghiệp vụ VietTicket Live–Autopilot + SmartQueue

Ngày audit: 24/07/2026. Phạm vi: customer Live Trip, SmartQueue tại cổng,
partner policy, staff control tower, worker, prediction service và constrained
optimizer.

## 1. Benchmark chính thức

| Chuẩn tham chiếu | Hành vi của sản phẩm tham chiếu | VietTicket sau audit |
| --- | --- | --- |
| [Disney World Virtual Queue](https://disneyworld.disney.go.com/guest-services/virtual-queue/) | Cần vé/admission hợp lệ, suất boarding group hữu hạn, một lượt/experience/ngày, thông báo khi được gọi, quay lại trong return window, quét pass tại touchpoint; tham gia queue không bảo đảm được phục vụ. | Booking `CONFIRMED` là điều kiện bắt buộc; `maxActiveParties`; một enrollment/booking/activity/day; `READY` + `readyExpiresAt`; QR là nguồn sự thật; UI nói rõ suất hữu hạn và không làm thay đổi quyền của vé. |
| [Universal Orlando Virtual Line](https://www.universalorlando.com/web/en/us/plan-your-visit/virtual-line) | Gắn travel party với ticket, chọn return time khi ở trong park, suất hữu hạn, QR được thêm vào wallet để redeem. | Party size lấy từ reservation, không tin client; queue chỉ trong ngày/cửa sổ vận hành; QR ticket hiện hữu dùng để admit; nhóm được giữ nguyên. VietTicket không tuyên bố geofence vì chưa có nguồn vị trí đủ tin cậy. |
| [Google Maps Popular times](https://support.google.com/business/answer/6263531?hl=en) | Phân biệt pattern lịch sử, live visit data và wait estimate; chỉ hiển thị khi đủ dữ liệu. | Tách QR live, booking/stock, historical show-rate và ML prediction; dưới 24 mẫu dùng fallback có nhãn; prediction có freshness, provenance, confidence và actual evaluation. |
| [TripIt Pro Go Now](https://help.tripit.com/en/support/solutions/articles/103000063349-go-now) | Khuyến nghị thời điểm rời đi dựa trên trạng thái hiện tại, traffic, preference; có countdown/notification. | Live Trip phát socket alert, hiển thị return deadline và cập nhật Control Tower 15 giây. Chưa dùng GPS/traffic nên không giả vờ có travel ETA thời gian thực. |

## 2. Bất biến nghiệp vụ

1. SmartQueue không thay thế vé và không cam kết admission.
2. Chỉ owner của Live Trip và booking được thao tác customer flow.
3. Booking phải `CONFIRMED`, đúng attraction, đúng ngày Việt Nam, chưa có vé
   `USED`, attraction đang hoạt động và còn trong cửa sổ queue.
4. Một booking chỉ có một enrollment cho activity/day. Rời queue là kết thúc
   lượt; UI bắt xác nhận và giải thích trước.
5. Queue có capacity hữu hạn; check capacity và create cùng transaction
   `Serializable`.
6. FIFO dùng `joinedAt`, rồi `id`, nhưng được phân vùng theo khung giờ trên
   `Reservation`; khách ca sau không thể chặn khách ca hiện tại. Vé không có
   time slot dùng hàng chung attraction/day.
7. `maxReadyParties` là capacity return-window của từng hàng theo khung vé.
   READY party không chặn việc release party FIFO kế tiếp nếu batch còn chỗ.
8. `NO_SHOW` chỉ hợp lệ sau `readyExpiresAt`. `ADMITTED` chỉ đến từ QR `USED`.
9. Pause/resume giữ nguyên FIFO, bắt buộc lý do khi pause, ghi audit + durable
   event và gửi realtime cho khách đang active.
10. Partner quản policy dài hạn; staff chỉ vận hành call/no-show/pause/resume;
    admin mới override policy qua staff API.
11. AUTO và staff chỉ được gọi khách từ 15 phút trước `scheduledStart`; cửa sổ
    quay lại không được bắt đầu quá sớm rồi biến khách thành no-show trước giờ vé.
12. QR check-in gần nhất chỉ đếm timestamp `checkedInAt <= now`; dữ liệu tương
    lai không được làm tăng pressure hay throughput.
13. Queue eligibility, ETA và AUTO release dùng pressure của đúng time slot trên
    reservation, không dùng nhầm tổng tải cả ngày. Staff UI hiển thị giờ tham
    quan, mốc được phép gọi và khóa nút trước cửa sổ.
14. Một lượt `READY` không thể bị gọi lặp để kéo dài `readyExpiresAt`; nếu thiếu
    `scheduledStart`, thao tác CALL fail-closed thay vì gọi khách không an toàn.

## 3. Tính AI và giới hạn tuyên bố

- Arrival model là `GradientBoostingRegressor` quantile riêng cho p50 và p90,
  time-split 80/20, tối thiểu 24 observation có actual.
- Prediction log gắn observation khi có, lưu version/source/fallback/local
  counterfactual contributions và được worker đối soát với QR actual.
- Public request có bound và cache 15 phút; queue chỉ dùng prediction không
  fallback, confidence `MEDIUM/HIGH`, có `predictedAt <= now` và còn mới tối đa
  30 phút. Nếu không đạt, nhãn ETA hạ xuống QR throughput hoặc capacity fallback.
- Autopilot là **hybrid decision system**: rule/constraint bảo vệ booking và
  capacity; ML quantile chỉ được dùng khi prediction còn hạn, không fallback và
  confidence `MEDIUM/HIGH`.
- Constrained optimizer không phải ML. Nó tách từng trip day, dùng múi giờ
  `Asia/Ho_Chi_Minh`, buffer di chuyển, khóa item có booking và không tuyên bố
  “phút tiết kiệm” khi chưa có wait curve theo slot.
- Không có camera, sensor, GPS hay traffic feed thì hệ thống không tuyên bố đang
  đo số người/vị trí/travel ETA thật.

## 4. Các câu hỏi phản biện và câu trả lời ngắn

**“Đăng ký queue có đảm bảo được vào không?”** Không. Vé/điều kiện attraction
mới quyết định admission; queue chỉ điều phối thứ tự quay lại.

**“AI nằm ở đâu?”** Ở dự báo quantile arrivals/wait, actual feedback loop và
predictive signal của hybrid decision engine. FIFO, authorization và safety
constraints cố ý là deterministic rules.

**“Dữ liệu demo có bị giả thành dữ liệu thật?”** Không. Observation seed có
`dataSource=DEMO_OPERATIONAL`; response ghi `trainingSource=demo_operational_history`.
Hai booking đoàn tạo tải cao được lưu đủ reservation/booking/payment/ticket và
stock tương ứng; `demo:check` đối chiếu tỷ lệ 153/180 và 39/45 thay vì hard-code
pressure trên UI.

**“Tại sao không theo dõi GPS như TripIt?”** Vì chưa có consent flow và traffic
provider đủ tin cậy. Sản phẩm hiện chỉ dùng dữ liệu booking/stock/QR nội bộ,
tránh thu thập vị trí không cần thiết.

**“Ai chịu trách nhiệm khi hệ thống gợi ý sai?”** Booking trả phí không bị tự
đổi. Proposal cần customer confirmation; staff có emergency pause; QR và
attraction policy là guard cuối.
