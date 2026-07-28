# VietTicket Live–AutoPilot: Sprint 2.5 → 5

## Nghiệp vụ đã chốt

- SmartQueue chỉ giữ chỗ cho booking `CONFIRMED`, đúng ngày Việt Nam, đúng hoạt động và chưa có vé `USED`.
- SmartQueue mặc định tắt; partner phải xác nhận có nhân sự và luồng check-in
  VietTicket tại cổng trước khi bật. Dữ liệu nhu cầu chỉ có phạm vi
  `VIETTICKET_CHANNEL_ONLY`, không đại diện tổng khách tại địa điểm.
- Một `bookingId` chỉ có thể có một bản ghi SmartQueue trong toàn hệ thống; database
  chặn duplicate enrollment kể cả khi khách mở hai lịch trình đã lưu đồng thời.
- FIFO dựa trên `joinedAt` + `id` trong từng time slot của reservation; khách ở
  ca sau không chặn ca hiện tại. Unique `liveTripItemId` chống tham gia trùng khi
  hai request đồng thời.
- Mỗi booking chỉ đăng ký một lần cho hoạt động trong ngày; queue có `maxActiveParties` hữu hạn và join chạy ở transaction `Serializable`.
- `READY` có `readyExpiresAt`; hết grace chuyển `NO_SHOW`, không tự chuyển sang `ADMITTED`.
- Pause dừng countdown READY; resume cộng lại thời gian pause nhưng không vượt
  giờ đóng của lượt. Không thể no-show khách trong khi pause.
- Staff chỉ gọi nhóm FIFO đầu tiên của đúng khung vé, không vượt
  `maxReadyParties`, không thể gọi lặp để kéo dài grace, và chỉ ghi no-show sau
  khi hết return window.
- AUTO và staff không được gọi trước cửa sổ 15 phút tính từ `scheduledStart`.
- Check-in QR và cập nhật SmartQueue `ADMITTED` cùng nằm trong một transaction
  database; realtime chỉ phát sau commit nên lỗi socket không rollback check-in.
- Rescue giữ nguyên item/queue cũ làm lịch sử `SKIPPED`, tạo item mới cho booking
  thay thế và supersede proposal cũ. Khách vì vậy có thể đăng ký SmartQueue cho
  booking mới mà không bị chặn bởi enrollment lịch sử.
- Staff chỉ được vận hành attraction thuộc `StaffAttractionAssignment`; partner chỉ cấu hình attraction thuộc `PartnerProfile`; admin có quyền nền tảng.
- Policy `AUTO`/`STAFF_CONTROLLED`, pause/resume và mọi call/no-show/policy update đều có audit/event.
- Autopilot không sửa booking đã liên kết; mô phỏng không mutate lịch trình; proposal đổi giờ vẫn cần customer confirmation.

## AI / dữ liệu

- Worker ghi observation 15 phút có `observationKey` idempotent, sau đó đánh giá cả observation lẫn prediction bằng QR actual.
- Worker chạy theo bucket UTC 15 phút, không phụ thuộc tick rơi đúng giây `00`; cache prediction theo bucket ngăn ghi trùng sau restart.
- ML service nhận dữ liệu từ Node (không truy cập DB), time-split theo thời gian; tối thiểu 32 mẫu đã có nhãn mới train model arrival.
- Response lưu `modelVersion`, `trainingSource`, `confidence`, `usedFallback`, local counterfactual contributions và metric MAE/coverage.
- Arrival model v3 dùng cửa sổ tối đa 14 ngày, feature tỷ lệ theo capacity + chu kỳ giờ/ngày,
  recency weighting, holdout theo thời gian và split-conformal calibration cho p10/p50/p90.
- Dữ liệu tương lai, timestamp trùng và target vượt capacity được loại/chặn trước khi train.
  Lịch sử demo hoặc quá cũ luôn bị hạ `LOW`; SmartQueue/Autopilot chỉ tin
  `live_operational_history` có confidence `MEDIUM/HIGH`.
- Node có runtime drift gate trên các prediction đã được đối soát QR; nếu MAE/coverage
  thực tế suy giảm thì tự hạ confidence để không dùng AI không còn đáng tin.
- Prediction cache được kiểm tra lại quantile, capacity, provenance và runtime drift trước khi
  trả kết quả; cache lỗi hoặc đã vượt miền nghiệp vụ sẽ bị bỏ qua và gọi lại ML/fallback.
- Observation dùng thời điểm chụp feature làm đầu cửa sổ nhãn 15 phút, không dùng
  mốc floor bucket nên không rò dữ liệu target. Worker chỉ đánh dấu bucket hoàn tất
  sau khi mọi attraction/evaluation thành công và tự retry phần còn thiếu.
- Production ML bắt buộc API key nội bộ mạnh, model từ `real_booking_history` và
  artifact SHA-256 khớp metadata; model demo không được phép khởi động production.
- Thiếu dữ liệu hoặc ML service không sẵn sàng → heuristic bảo thủ, nhãn `usedFallback=true`; không gọi đó là độ chính xác AI.
- ETA tới lượt giới hạn 240 phút và chỉ dùng throughput QR 15 phút gần nhất hoặc
  fallback bảo thủ do partner cấu hình. Arrival p50/p90 là dự báo nhu cầu, không
  được dùng như tốc độ phục vụ cổng.
- Optimizer bounded local-search tách theo `dayIndex`, dùng múi giờ Việt Nam, buffer di chuyển và bảo vệ item có booking. `totalShiftMinutes` chỉ mô tả độ dịch lịch; hệ thống không bịa “phút tiết kiệm”.

## Acceptance checklist

1. `npx prisma validate --schema prisma/schema.prisma`
2. `npm test` (backend)
3. `npm run lint`, `npm test` và `npm run build` (frontend)
4. `ml-service\.venv\Scripts\python.exe -m unittest discover -s tests -v`
5. Apply migrations `20260723100000_live_autopilot_operations`,
   `20260723123000_harden_live_autopilot_business_rules`,
   `20260724100000_add_live_trip_item_skipped_event`,
   `20260726190000_harden_smart_queue_identity` và
   `20260726210000_live_prediction_quality_metrics`,
   `20260727120000_smart_queue_operational_opt_in`,
   `20260727143000_persist_smart_queue_readiness`,
   `20260727150000_smart_queue_ready_guest_capacity` trong môi trường
   staging/local trước demo. Migration identity có preflight và sẽ dừng với
   booking trùng cụ thể thay vì tạo unique index nửa chừng.
6. `npm run demo:prepare` chỉ chạy với DB localhost; `npm run demo:check` phải có
   288 observation có nhãn, prediction ML không fallback còn mới, một proposal
   pending và một queue WAITING.
7. Demo flow: partner lưu policy → staff mở Control Tower → customer join queue → staff call/no-show hoặc QR admit → customer chạy simulation → chấp nhận proposal.

## API chính

- Staff: `/api/staff/smart-queue/attractions`, `/overview`, `/policy/:attractionId`, `/entries/:entryId/call`, `/entries/:entryId/no-show`.
- Partner: `/api/partners/attractions/:id/smart-queue-policy`.
- Customer: `/api/live/trips/:tripId/autopilot/simulate`, `/api/live/attractions/:attractionId/predict-arrivals`, `/predict-wait`.
- ML nội bộ: `POST /live/predict-arrivals`, `POST /live/predict-wait`, `POST /live/optimize`.
