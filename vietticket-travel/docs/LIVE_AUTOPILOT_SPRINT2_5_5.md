# VietTicket Live–AutoPilot: Sprint 2.5 → 5

## Nghiệp vụ đã chốt

- SmartQueue chỉ giữ chỗ cho booking `CONFIRMED`, đúng ngày Việt Nam, đúng hoạt động và chưa có vé `USED`.
- FIFO dựa trên `joinedAt` + `id` trong từng time slot của reservation; khách ở
  ca sau không chặn ca hiện tại. Unique `liveTripItemId` chống tham gia trùng khi
  hai request đồng thời.
- Mỗi booking chỉ đăng ký một lần cho hoạt động trong ngày; queue có `maxActiveParties` hữu hạn và join chạy ở transaction `Serializable`.
- `READY` có `readyExpiresAt`; hết grace chuyển `NO_SHOW`, không tự chuyển sang `ADMITTED`.
- Staff chỉ gọi nhóm FIFO đầu tiên của đúng khung vé, không vượt
  `maxReadyParties`, không thể gọi lặp để kéo dài grace, và chỉ ghi no-show sau
  khi hết return window.
- AUTO và staff không được gọi trước cửa sổ 15 phút tính từ `scheduledStart`.
- Check-in QR là nguồn sự thật cho `ADMITTED`; hook SmartQueue lỗi không rollback giao dịch check-in.
- Staff chỉ được vận hành attraction thuộc `StaffAttractionAssignment`; partner chỉ cấu hình attraction thuộc `PartnerProfile`; admin có quyền nền tảng.
- Policy `AUTO`/`STAFF_CONTROLLED`, pause/resume và mọi call/no-show/policy update đều có audit/event.
- Autopilot không sửa booking đã liên kết; mô phỏng không mutate lịch trình; proposal đổi giờ vẫn cần customer confirmation.

## AI / dữ liệu

- Worker ghi observation 15 phút có `observationKey` idempotent, sau đó đánh giá cả observation lẫn prediction bằng QR actual.
- ML service nhận dữ liệu từ Node (không truy cập DB), time-split theo thời gian; tối thiểu 24 mẫu mới train model arrival.
- Response lưu `modelVersion`, `trainingSource`, `confidence`, `usedFallback`, local counterfactual contributions và metric MAE/coverage.
- Thiếu dữ liệu hoặc ML service không sẵn sàng → heuristic bảo thủ, nhãn `usedFallback=true`; không gọi đó là độ chính xác AI.
- ETA dùng quantile p50/p90; giới hạn 240 phút. Chỉ prediction không fallback,
  confidence `MEDIUM/HIGH`, không nằm trong tương lai và không quá 30 phút mới
  được gắn nhãn ML; trường hợp còn lại dùng QR throughput/capacity fallback.
- Optimizer bounded local-search tách theo `dayIndex`, dùng múi giờ Việt Nam, buffer di chuyển và bảo vệ item có booking. `totalShiftMinutes` chỉ mô tả độ dịch lịch; hệ thống không bịa “phút tiết kiệm”.

## Acceptance checklist

1. `npx prisma validate --schema prisma/schema.prisma`
2. `npm test` (backend)
3. `npm run lint`, `npm test` và `npm run build` (frontend)
4. Apply migrations `20260723100000_live_autopilot_operations`,
   `20260723123000_harden_live_autopilot_business_rules` và
   `20260724100000_add_live_trip_item_skipped_event` trong môi trường
   staging/local trước demo.
5. `npm run demo:prepare` chỉ chạy với DB localhost; `npm run demo:check` phải có
   288 observation có nhãn, prediction ML không fallback còn mới, một proposal
   pending và một queue WAITING.
6. Demo flow: partner lưu policy → staff mở Control Tower → customer join queue → staff call/no-show hoặc QR admit → customer chạy simulation → chấp nhận proposal.

## API chính

- Staff: `/api/staff/smart-queue/attractions`, `/overview`, `/policy/:attractionId`, `/entries/:entryId/call`, `/entries/:entryId/no-show`.
- Partner: `/api/partners/attractions/:id/smart-queue-policy`.
- Customer: `/api/live/trips/:tripId/autopilot/simulate`, `/api/live/attractions/:attractionId/predict-arrivals`, `/predict-wait`.
- ML nội bộ: `POST /live/predict-arrivals`, `POST /live/predict-wait`, `POST /live/optimize`.
