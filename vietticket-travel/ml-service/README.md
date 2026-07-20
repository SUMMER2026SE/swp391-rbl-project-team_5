# VietTicket AI Revenue Forecast

FastAPI service dự báo **doanh thu vé thuần theo ngày sử dụng dịch vụ** cho
từng điểm tham quan. Node backend là nơi tổng hợp dữ liệu nghiệp vụ; ML service
không truy cập trực tiếp PostgreSQL.

## Chạy local

```bash
cd ml-service
python -m venv .venv

# Windows PowerShell
.\.venv\Scripts\Activate.ps1

pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Kiểm tra readiness:

```bash
curl http://127.0.0.1:8000/health
```

Backend Node cần cấu hình `ML_SERVICE_URL=http://localhost:8000`. Nếu đặt
`ML_SERVICE_API_KEY`, giá trị phải giống nhau ở hai service.

## Định nghĩa dữ liệu

Backend chỉ đưa vào lịch sử:

- booking `COMPLETED` hoặc `NO_SHOW`;
- gắn theo `snapshotVisitDate` (fallback sang ngày reservation);
- payment `SUCCESS`, bỏ payment trùng;
- trừ refund `SUCCESS`, không trừ lần nữa khoản hoàn payment trùng;
- zero-fill ngày không có doanh thu và bỏ ngày hiện tại chưa chốt.

Model không được gọi nếu một điểm chưa có ít nhất 14 ngày phát sinh doanh thu
và 30 booking hoàn tất. Nếu đã có lịch sử nhưng chưa đạt ngưỡng, backend hiển
thị rõ `HISTORICAL_BASELINE`, không gắn nhãn kết quả AI. Nếu chưa có booking
hoàn tất phát sinh doanh thu, backend trả `INSUFFICIENT_DATA`, không cộng dự báo
0 đồng vào tổng doanh thu và không tính điểm đó là dự báo thành công.

## Chạy pipeline demo local

Khi database local chưa có đủ giao dịch, tạo booking mô phỏng được đánh dấu rõ:

```bash
cd backend
npm run db:seed:forecast-demo
node scripts/export_booking_history.js

cd ../ml-service
python -m app.train \
  --data data/booking_history.csv \
  --training-source demo_booking_history \
  --model-version demo-booking-v1
```

Đặt `ALLOW_DEMO_AI=true` trong `backend/.env`, rồi restart backend và ML service.
Kết quả được trả bằng phương pháp `AI_DEMO_ENSEMBLE` và giao diện luôn hiển thị
cảnh báo. Script seed bị chặn ở production, chỉ sở hữu các booking có marker
`FORECAST_DEMO_V1`, và có thể tạo lại bằng `npm run db:seed:forecast-demo -- --reset`.

## Retrain bằng dữ liệu thật

Training không được mở thành endpoint HTTP vì tác vụ nặng, dễ bị lạm dụng và có
thể thay model giữa lúc đang phục vụ request. Quy trình vận hành:

```bash
# tại thư mục vietticket-travel
node backend/scripts/export_booking_history.js

cd ml-service
python -m app.train \
  --data data/booking_history.csv \
  --model-version real-v20260719
```

Sau khi kiểm tra metric trên time-based holdout, restart ML service để nạp model
mới. CLI từ chối dataset có dưới 3 điểm tham quan hoặc dưới 90 ngày lịch sử.

Chỉ để bootstrap môi trường demo chưa có booking thật:

```bash
python -m app.train \
  --bootstrap-synthetic \
  --num-attractions 200 \
  --num-days 365 \
  --model-version synthetic-bootstrap-v1
```

Synthetic data không phải bằng chứng về độ chính xác thực tế. Metadata của model
ghi rõ `training_source`; cần thay bằng dữ liệu thật khi lịch sử đủ dài.
Backend chỉ gắn nhãn `AI_ENSEMBLE` khi `training_source=real_booking_history`;
`demo_booking_history` chỉ được dùng ngoài production khi đã bật cờ và mang nhãn
`AI_DEMO_ENSEMBLE`; model bootstrap tổng hợp luôn chuyển sang baseline.

## Thiết kế model

- Ensemble `RandomForestRegressor` + `XGBRegressor`.
- Target `log1p(revenue)` để giảm ảnh hưởng của ngày doanh thu cực lớn.
- Feature lịch: thứ, tháng, cuối tuần, ngày lễ Việt Nam và giai đoạn Tết.
- Feature động: lag 1/7/14 ngày, rolling mean 7/28 ngày, rolling standard
  deviation 7 ngày.
- Không dùng tuổi xuất bản của điểm tham quan làm feature vì catalog cũ có thể
  thiếu `publishedAt`; điều này tránh lệch train-serving và tương quan giả.
- Chia train/validation theo thời gian, không random split.
- Khoảng dự báo nới rộng theo horizon.
- Backend chặn kết quả âm và không cho doanh thu/số vé dự kiến vượt sức chứa.

## API nội bộ

- `GET /health`
- `POST /forecast` — yêu cầu header `x-ml-api-key` nếu đã cấu hình key.

## Cấu trúc

```text
ml-service/
  app/
    main.py
    schemas.py
    features.py
    holidays.py
    model.py
    train.py
    synthetic_data.py
  models/
    ensemble_model.joblib
    metadata.json
  requirements.txt
```
