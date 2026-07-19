# AI Revenue Forecasting — Hướng dẫn tích hợp

Gói này chứa toàn bộ file MỚI/ĐÃ SỬA cho tính năng dự báo doanh thu, để
copy đè vào repo VietTicket Travel hiện tại của bạn (giữ nguyên đường dẫn
thư mục). Không có file nào bị xoá khỏi repo gốc.

## 1. Kiến trúc

```
ml-service (FastAPI, Python)          backend (Node/Express)
┌─────────────────────────┐           ┌──────────────────────────┐
│ ensemble RF + XGBoost     │  HTTP    │ forecastService.js        │
│ /forecast  /train  /health│◄─────────┤ aiForecastController.js   │
│ (stateless, không có DB)  │          │ forecastRoutes.js          │
└─────────────────────────┘           │  -> RevenueForecast table  │
                                       └──────────────────────────┘
                                                  ▲
                                                  │ REST (đã có auth)
                                       Frontend: RevenueForecastPanel.jsx
                                       (nhúng trong PartnerReportsPage +
                                        AdminDashboard)
```

ml-service KHÔNG kết nối trực tiếp PostgreSQL — Node backend tổng hợp lịch
sử doanh thu theo ngày (từ bảng `Booking`) rồi gửi kèm trong mỗi request
`/forecast`. Điều này giữ ml-service đơn giản, dễ scale/deploy riêng.

## 2. Các bước cài đặt

### Backend (Node)
1. Copy các file trong `backend/` đè vào repo (schema.prisma, migration,
   services/controllers/routes, app.js, .env.example, tests).
2. Chạy migration:
   ```
   cd backend
   npx prisma migrate dev
   npx prisma generate
   ```
   (Migration đã viết sẵn SQL thủ công vì môi trường sandbox không có
   quyền tải Prisma engine — bạn nên để `prisma migrate dev` tự phát hiện
   và áp dụng bình thường; nếu nó báo "schema chưa khớp migration", có
   thể xoá thư mục migration mình cung cấp và để Prisma tự generate lại.)
3. Thêm vào `backend/.env`:
   ```
   ML_SERVICE_URL="http://localhost:8000"
   ML_SERVICE_API_KEY=""
   ```
4. Chạy test mới: `npm test -- forecastService` (đã pass 6/6 trong môi
   trường build thử của mình).

### ml-service (Python)
1. Copy thư mục `ml-service/` vào root repo (ngang hàng `backend/`).
2. ```
   cd ml-service
   python3 -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   cp .env.example .env
   ```
3. Model đã được TRAIN SẴN và đóng gói kèm (`models/ensemble_model.joblib`
   + `metadata.json`), train trên dữ liệu synthetic 200 attraction x 365
   ngày, MAPE ~25% trên tập test (time-based split 80/20) — dùng được
   ngay để demo/dev. Khi có đủ dữ liệu Booking thật, nên train lại:
   ```
   python -m app.train --num-attractions 300 --num-days 400
   ```
4. Chạy service: `uvicorn app.main:app --port 8000`
   Kiểm tra: `curl http://localhost:8000/health`

### Frontend
1. Copy `src/services/forecastApi.js`, `src/components/forecast/`, và 2
   file đã sửa (`PartnerReportsPage.jsx`, `admin/AdminDashboard.jsx`).
2. Không cần thêm biến môi trường mới (dùng chung `VITE_API_URL` sẵn có).

## 3. Phân quyền

- **ADMIN**: xem dự báo mọi attraction (`/api/forecast/admin/overview`),
  và có thể train lại model (`/api/forecast/admin/retrain`).
- **PARTNER**: chỉ xem dự báo của attraction thuộc chính mình
  (`/api/forecast/partner/overview`, `/api/forecast/attractions/:id`).
- **STAFF**: không có quyền truy cập bất kỳ endpoint forecast nào.

## 4. Ghi chú kỹ thuật quan trọng

- **Time-based split khi train**: không random-split, vì đây là bài toán
  time series — cắt theo mốc thời gian (80% ngày đầu train / 20% ngày
  cuối test) để tránh rò rỉ tương lai vào tập train.
- **log1p transform**: doanh thu lệch phải mạnh (ngày lễ/cuối tuần), nên
  train trên `log1p(revenue)` thay vì revenue thô, giúp ổn định loss.
- **Ensemble**: trung bình cộng dự đoán (log space) của RandomForest +
  XGBoost — giảm variance so với dùng riêng 1 model.
- **Recursive forecasting**: dự báo N ngày tới bằng cách dự đoán từng
  ngày một, dùng lại kết quả vừa dự đoán làm lag feature cho ngày kế tiếp.
- **Cache 6 giờ**: `RevenueForecast` được upsert theo
  `(attractionId, forecastDate, modelVersion)` và có TTL 6 giờ
  (`FORECAST_CACHE_TTL_MS`) — dashboard không gọi ml-service mỗi lần mở.
- **Fallback**: nếu ml-service không phản hồi (đang khởi động, lỗi
  mạng...), Node tự chuyển sang dự báo bằng trung bình trượt 28 ngày, có
  cảnh báo rõ ràng trong response (`warning`) thay vì lỗi trắng.
- **Rate limit**: `/attractions/:id` giới hạn 30 req/phút/IP,
  `/admin/retrain` giới hạn 3 req/giờ/IP (train tốn tài nguyên).

## 5. Việc bạn cần tự làm thêm (tuỳ chọn)

- Deploy ml-service (Docker/Railway/Render/VPS riêng) — hiện chưa có
  Dockerfile kèm theo, có thể thêm nếu cần.
- Khi có đủ dữ liệu Booking thật (vài tháng), viết script export dữ liệu
  thật thành 2 DataFrame (`attractions`, `revenue`) đúng format của
  `generate_synthetic_dataset()` trong `synthetic_data.py`, rồi gọi
  `train_and_save(..., attractions=..., revenue=...)` để train trên dữ
  liệu thật thay vì synthetic.
- Cân nhắc thêm job định kỳ điền `actualRevenue` vào `RevenueForecast`
  sau khi qua `forecastDate`, để theo dõi MAPE thực tế theo thời gian.
