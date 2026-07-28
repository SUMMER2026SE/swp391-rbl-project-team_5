# Audit nghiệp vụ VietTicket Live–Autopilot + SmartQueue

Ngày audit gần nhất: 28/07/2026. Phạm vi: customer Live Trip, SmartQueue tại cổng,
partner policy, staff control tower, worker, prediction service và constrained
optimizer.

## 1. Benchmark chính thức

| Chuẩn tham chiếu | Hành vi của sản phẩm tham chiếu | VietTicket sau audit |
| --- | --- | --- |
| [Disney World Virtual Queue](https://disneyworld.disney.go.com/guest-services/virtual-queue/) | Cần vé/admission hợp lệ, suất boarding group hữu hạn, một lượt/experience/ngày, thông báo khi được gọi, quay lại trong return window, quét pass tại touchpoint; tham gia queue không bảo đảm được phục vụ. | Booking `CONFIRMED` là điều kiện bắt buộc; `maxActiveParties`; một enrollment/booking/activity/day; `READY` + `readyExpiresAt`; QR là nguồn sự thật; UI nói rõ suất hữu hạn và không làm thay đổi quyền của vé. |
| [Universal Orlando Virtual Line](https://www.universalorlando.com/web/en/us/plan-your-visit/virtual-line) | Gắn travel party với ticket, chọn return time khi ở trong park, suất hữu hạn, QR được thêm vào wallet để redeem. | Party size lấy từ reservation, không tin client; queue chỉ trong ngày/cửa sổ vận hành; QR ticket hiện hữu dùng để admit; nhóm được giữ nguyên. VietTicket không tuyên bố geofence vì chưa có nguồn vị trí đủ tin cậy. |
| [Google Maps Popular times](https://support.google.com/business/answer/6263531?hl=en) | Phân biệt pattern lịch sử, live visit data và wait estimate; chỉ hiển thị khi đủ dữ liệu. | Chỉ gọi đây là “nhu cầu quan sát trên VietTicket”, công khai `VIETTICKET_CHANNEL_ONLY`, không suy rộng thành tổng khách tại điểm; tách QR live, booking/stock, historical show-rate và ML prediction. |
| [TripIt Pro Go Now](https://help.tripit.com/en/support/solutions/articles/103000063349-go-now) | Khuyến nghị thời điểm rời đi dựa trên trạng thái hiện tại, traffic, preference; có countdown/notification. | Live Trip phát socket alert, hiển thị return deadline và cập nhật Control Tower 15 giây. Chưa dùng GPS/traffic nên không giả vờ có travel ETA thời gian thực. |

## 2. Bất biến nghiệp vụ

1. SmartQueue không thay thế vé, không cam kết admission và không đại diện hàng
   chờ của toàn bộ khách tại địa điểm.
2. SmartQueue mặc định tắt. Partner chỉ được bật sau khi xác nhận có nhân sự và
   luồng check-in VietTicket tại cổng; không thể tắt khi còn lượt active.
3. Chỉ owner của Live Trip và booking được thao tác customer flow.
4. Booking phải `CONFIRMED`, đúng attraction, đúng ngày Việt Nam, chưa có vé
   `USED`, attraction đang hoạt động và còn trong cửa sổ queue.
5. Một booking chỉ có một enrollment cho activity/day. Rời queue là kết thúc
   lượt; UI bắt xác nhận và giải thích trước.
6. Queue có capacity hữu hạn; check capacity và create cùng transaction
   `Serializable`.
7. FIFO dùng `joinedAt`, rồi `id`, nhưng được phân vùng theo khung giờ trên
   `Reservation`; khách ca sau không thể chặn khách ca hiện tại. Vé không có
   time slot dùng hàng chung attraction/day.
8. `maxReadyParties` và `maxReadyGuests` cùng bảo vệ capacity return-window của
   từng hàng theo khung vé. READY party không chặn việc release party FIFO kế
   tiếp nếu cả trần nhóm và trần khách vẫn còn chỗ.
9. `NO_SHOW` chỉ hợp lệ sau `readyExpiresAt`. `ADMITTED` chỉ đến từ QR `USED`.
10. Pause/resume giữ nguyên FIFO và dừng countdown `READY`; khi resume deadline
    được cộng đúng thời gian pause nhưng không vượt giờ đóng của vé. Trong khi
    pause, staff và worker đều không được ghi no-show.
11. Partner quản policy dài hạn; staff chỉ vận hành call/no-show/pause/resume;
    admin mới override policy qua staff API.
12. AUTO và staff chỉ được gọi khách từ 15 phút trước `scheduledStart`; cửa sổ
    quay lại không được bắt đầu quá sớm rồi biến khách thành no-show trước giờ vé.
13. QR check-in gần nhất chỉ đếm timestamp `checkedInAt <= now`; dữ liệu tương
    lai không được làm tăng pressure hay throughput.
14. Queue eligibility, ETA và AUTO release dùng nhu cầu của đúng time slot trên
    reservation, không dùng nhầm tổng tải cả ngày. Staff UI hiển thị giờ tham
    quan, mốc được phép gọi và khóa nút trước cửa sổ.
15. Một lượt `READY` không thể bị gọi lặp để kéo dài `readyExpiresAt`; nếu thiếu
   `scheduledStart`, thao tác CALL fail-closed thay vì gọi khách không an toàn.
16. ETA tới lượt chỉ tính khách phía trước. Dự báo lượng khách đến không được
    dùng làm tốc độ phục vụ; ETA chỉ dùng throughput QR 15 phút gần nhất hoặc
    fallback bảo thủ do partner cấu hình.
17. Autopilot chỉ đổi lịch item chưa có booking sau xác nhận của khách. Việc
    kiểm tra quota tại thời điểm đề xuất/accept không tạo reservation và UI phải
    nói rõ “không giữ vé/tồn chỗ”.
18. Khi toàn bộ cửa sổ hoạt động đã qua, Live Trip được đóng để worker không quét
    vô hạn; item booking chưa đối soát vẫn giữ `AT_RISK` trong lịch sử.

## 3. Tính AI và giới hạn tuyên bố

- Arrival model là `GradientBoostingRegressor` quantile riêng cho p50 và p90,
  time-split 80/20, tối thiểu 24 observation có actual.
- Prediction log gắn observation khi có, lưu version/source/fallback/local
  counterfactual contributions và được worker đối soát với QR actual.
- Public prediction request có bound và cache 15 phút. Arrival prediction chỉ là
  tín hiệu nhu cầu cho Autopilot; SmartQueue ETA cố ý không dùng arrival p50/p90
  như throughput vì hai đại lượng khác bản chất.
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

**“VietTicket có biết toàn bộ khách đang ở điểm tham quan không?”** Không.
Response ghi rõ `coverageScope=VIETTICKET_CHANNEL_ONLY`,
`venueCoverageKnown=false`; UI gọi đây là nhu cầu khách VietTicket, không gọi là
mật độ toàn địa điểm.

**“SmartQueue có ý nghĩa nếu partner chỉ bán một phần vé qua VietTicket?”** Có,
nhưng chỉ khi partner vận hành một luồng/làn check-in cho nhóm khách VietTicket.
Nếu không có cam kết đó, tính năng mặc định tắt và không xuất hiện như một quyền
lợi giả.

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

## 5. Ma trận tình huống thực tế đã kiểm chứng

| Nhóm | Tình huống | Kết quả bắt buộc |
| --- | --- | --- |
| Kích hoạt | Chưa có policy | SmartQueue tắt, không hứa quyền lợi với khách |
| Kích hoạt | Partner bật lần đầu nhưng chưa xác nhận nhân sự/cổng | Từ chối `QUEUE_OPERATIONAL_READINESS_REQUIRED` |
| Kích hoạt | Partner tắt khi còn khách WAITING/READY | Từ chối; yêu cầu dùng emergency pause |
| Quyền | Khách thao tác trip/booking người khác | Từ chối theo ownership |
| Vé | Booking chưa xác nhận, hoàn tiền, sai ngày, sai attraction | Không được join |
| Vé | Có ít nhất một QR đã dùng | Queue kết thúc theo booking; vé còn lại vẫn giữ trạng thái riêng |
| Thời gian | Trước giờ mở queue hoặc sau giờ đóng | Không được join |
| Công suất | Hai request join đồng thời | Unique key + transaction Serializable chỉ tạo một lượt |
| Công suất | Queue vừa đầy khi đang join | Fail với capacity changed/full, không overbook |
| FIFO | Hai khách cùng `joinedAt` | `id` là tie-breaker xác định |
| FIFO | Hai time slot khác nhau | Xếp hàng độc lập, ca sau không chặn ca trước |
| Gọi lượt | AUTO/staff gọi trước cửa sổ 15 phút | Bị chặn |
| Gọi lượt | Staff cố nhảy qua khách đầu hàng | Bị chặn `QUEUE_FIFO_VIOLATION` |
| Gọi lượt | READY batch đã đầy | Không gọi thêm |
| Gọi lượt | Số nhóm còn chỗ nhưng group tiếp theo làm vượt trần khách tại cổng | Không gọi thêm; bảo vệ capacity theo số người |
| Gọi lượt | Gọi lặp khách READY | Không kéo dài grace |
| Pause | READY hết deadline trong lúc cổng pause | Không bị no-show |
| Resume | Pause 5 phút, deadline còn trong giờ vé | Deadline được cộng 5 phút |
| Resume | Deadline cộng thêm vượt giờ vé | Cắt tại `expiresAt` của lượt |
| No-show | Staff đánh dấu trước deadline | Bị chặn |
| No-show | Staff đánh dấu trong lúc pause | Bị chặn |
| Check-in | QR và queue chạy đồng thời | Cùng transaction DB; QR thắng mọi trạng thái queue, realtime chỉ phát sau commit |
| Rescue | Booking cũ đã từng vào SmartQueue | Giữ item/queue cũ làm lịch sử, tạo item mới nên booking thay thế có enrollment độc lập |
| ETA | Có QR throughput gần đây | Chỉ dùng tốc độ QR thực đo |
| ETA | Chưa có QR throughput | Dùng fallback partner, gắn confidence thấp |
| ETA | Arrival AI dự báo lượng khách rất cao | Không được hiểu thành cổng xử lý nhanh |
| Dữ liệu | Nhiều slot cùng/chéo giờ | QR được quy đúng `reservation.timeSlotId`, không nhân đôi cho mọi slot |
| Autopilot | Item đã có booking | Không đổi giờ, chỉ cảnh báo/SmartQueue nếu đủ điều kiện |
| Autopilot | Item chưa có booking, có slot tốt hơn | Tạo proposal; khách phải accept |
| Autopilot | Quota đổi trước lúc accept | Proposal bị supersede, không áp dụng |
| Autopilot | Accept proposal | Chỉ đổi kế hoạch; không tạo booking hay giữ tồn |
| Lifecycle | Trip đã hết ngày/cửa sổ | Không simulation mới; trip đóng, lịch sử/risk còn để đối soát |

## 6. Kết luận kiểm chứng lần hai và giới hạn còn lại

### Đã khóa thêm trong lần kiểm chứng này

- Xác nhận sẵn sàng vận hành được lưu bằng
  `operationalReadinessConfirmedAt`. Policy cũ từng `enabled=true` nhưng chưa có
  xác nhận này bị coi là **chưa kích hoạt**, tránh tự động thừa kế một cam kết
  vận hành mà partner chưa chấp thuận.
- Control Tower hiển thị rõ `Chưa kích hoạt`, khóa pause/call/no-show và backend
  cũng fail-closed. Giao diện không còn gắn nhãn `Auto + override` cho policy
  không hợp lệ.
- Staff không thể call/no-show khi attraction đã `SUSPENDED` hoặc booking không
  còn `CONFIRMED`. Nếu QR đã được dùng thì QR vẫn là nguồn sự thật và queue được
  tự chữa về `ADMITTED` trước các guard trên.
- Cảnh báo `LIVE_TRIP_UPDATED` được nghe ở cấp toàn ứng dụng, không chỉ khi khách
  đang đứng đúng trang Live Trip. Khi khách cho phép, tab đang mở ở nền có thêm
  native browser notification cho `QUEUE_READY`, pause/resume và proposal.
- Seed demo không dựng queue/proposal giả sau khi cửa sổ vận hành thật đã đóng.
  `demo:check` vẫn kiểm tra fixture nền và báo rõ lý do live showcase không tồn tại.
- Observation ML bắt đầu nhãn đúng tại thời điểm chụp feature để loại target
  leakage; worker retry cùng bucket nếu một attraction/evaluation lỗi tạm thời.
- Stored prediction sai miền hoặc runtime drift không thể làm hỏng Live Trip:
  Autopilot bỏ tín hiệu đó và quay về rule bảo thủ.

### Giá trị thực đã được chứng minh

SmartQueue có giá trị thật trong mô hình **partner-operated VietTicket lane**:
khách có booking hợp lệ rời hàng vật lý, hệ thống giữ FIFO theo khung vé, partner
giới hạn số nhóm được gọi, QR đóng vòng admission và pause bảo vệ khách khi cổng
gặp sự cố. Live Trip tạo giá trị ở lớp điều phối: gom trạng thái booking, queue,
risk và đề xuất thay đổi kế hoạch mà không tự sửa giao dịch đã thanh toán.

Giá trị này không mở rộng thành “quản lý toàn bộ đám đông tại điểm đến”. Khi
partner không có luồng cổng riêng, SmartQueue phải để tắt; chỉ số pressure chỉ là
nhu cầu VietTicket và Autopilot chỉ là decision support.

### P1 còn lại trước vận hành production rộng

1. Native notification hiện chỉ hoạt động khi phiên web/tab còn mở. Cần Web Push
   có service worker hoặc SMS/Zalo/email fallback để không biến khách khóa trình
   duyệt thành no-show.
2. Chưa có geofence/nearby attestation. Khách ở quá xa vẫn có thể tham gia rồi
   không kịp return window; production nên thêm consent vị trí hoặc check-in
   proximity bảo vệ capacity.
3. Chưa có offline-first cho QR và trạng thái queue. Mạng yếu tại cổng vẫn là
   failure mode lớn dù backend/realtime đúng.
4. Cần pilot tại một cổng thật để đo `actual wait`, tỷ lệ khách nhận thông báo,
   no-show, throughput và số lần staff override. Test tự động chứng minh tính
   đúng logic, không thể chứng minh nhân sự tại cổng tuân thủ SLA.

### P2 cần cải thiện bằng dữ liệu thật

- Show-rate hiện học theo booking; party-size mix lớn/nhỏ có thể làm lệch ước
  lượng khách. Nên chuyển dần sang guest-weighted attendance.
- ETA fallback do partner cấu hình là bảo thủ nhưng vẫn cần calibration theo
  attraction/time-slot và cảnh báo khi sai số vượt ngưỡng.
- Cần dashboard SLA cho oldest waiting, ready response time, no-show reason và
  prediction/ETA error thay vì chỉ xem trạng thái tức thời.
