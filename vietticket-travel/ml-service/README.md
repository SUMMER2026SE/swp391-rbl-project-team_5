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
`ML_SERVICE_API_KEY`, giá trị phải giống nhau ở hai service. Trong production,
`ENVIRONMENT=production` và API key tối thiểu 32 ký tự là bắt buộc; service sẽ
fail-fast và tắt Swagger/OpenAPI nếu cấu hình bảo mật chưa đạt.

## Định nghĩa dữ liệu

Backend chỉ đưa vào lịch sử:

- booking `COMPLETED` hoặc `NO_SHOW`;
- chỉ booking thật (`isForecastTrainingSample=false`); các dòng demo được giữ
  trong local DB nhưng bị loại khỏi export production;
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

Bộ dữ liệu demo (`npm run demo:prepare`) sinh 90 ngày lịch sử theo một mô hình
nhu cầu xác định: `backend/scripts/lib/demandHistoryModel.js`. Vì mô hình đó
xác định hoàn toàn, dataset huấn luyện sinh lại được **không cần kết nối CSDL**,
và không thể lệch khỏi dữ liệu mà seed đã ghi:

```bash
cd backend
node scripts/export_demo_training_csv.js

cd ../ml-service
python -m app.train \
  --data data/demo_booking_history.csv \
  --training-source demo_booking_history \
  --model-version demo-booking-v2
```

Lệnh train in ra bảng so sánh model với baseline; đọc dòng `KẾT LUẬN` trước khi
dùng artifact.

> `scripts/export_booking_history.js` là đường xuất dữ liệu **thật** cho
> production. Nó cố tình loại mọi booking `isForecastTrainingSample=true`, nên
> không xuất được lịch sử demo — đó là chủ ý, không phải thiếu sót.

Đặt `ALLOW_DEMO_AI=true` trong `backend/.env`, rồi restart backend và ML service.
Kết quả được trả bằng phương pháp `AI_DEMO_ENSEMBLE` và giao diện luôn hiển thị
cảnh báo.

Script cũ `npm run db:seed:forecast-demo` (marker `FORECAST_DEMO_V1`) vẫn còn
cho môi trường dev không dùng bộ demo bảo vệ; nó dùng bộ sinh nhu cầu đời đầu
với vài vé mỗi ngày, **không phù hợp để huấn luyện model đem trình bày**.

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
- **Hai target, hai model riêng**: `log1p(revenue)` và `log1p(tickets)`.
  Trước đây số vé được suy ra bằng `predicted_revenue / avg_ticket_price`. Phép
  chia đó chỉ đúng khi mọi vé cùng một giá — một điểm có vé người lớn 520k và
  vé trẻ em 360k thì thương số ấy không phải số vé của ngày nào cả, và sai số
  của model doanh thu còn bị khuếch đại thêm một lần. Số vé lại chính là đại
  lượng tầng giá động cần (để so với sức chứa), nên nó được dự báo trực tiếp.
  Trên bộ demo, cách cũ sai 39.31% còn model số vé sai 6.41% (WAPE).
- Feature lịch: thứ, tháng, cuối tuần, ngày lễ Việt Nam và giai đoạn Tết.
- Feature động: lag 1/7/14 ngày, rolling mean 7/28 ngày, rolling standard
  deviation 7 ngày. Model số vé dùng cùng bộ feature nhưng lag/rolling tính
  trên chuỗi số vé, không phải chuỗi doanh thu.
- Không dùng tuổi xuất bản của điểm tham quan làm feature vì catalog cũ có thể
  thiếu `publishedAt`; điều này tránh lệch train-serving và tương quan giả.
- Chia train/validation theo thời gian, không random split.
- Khoảng dự báo nới rộng theo horizon.
- Backend chặn kết quả âm và không cho doanh thu/số vé dự kiến vượt sức chứa.
- Artifact cũ (chỉ có model doanh thu) vẫn nạp được; khi đó service trả
  `tickets_source=derived_from_revenue` để phía gọi biết con số kém tin cậy hơn.

## Đánh giá: luôn kèm baseline

`train.py` luôn tính và lưu vào metadata chỉ số của một **baseline trung bình
theo (điểm tham quan, thứ trong tuần)** — thứ mà bất kỳ ai cũng làm được bằng
một câu `GROUP BY`. Không có mốc so sánh này thì con số MAPE của ensemble không
nói lên điều gì.

`GET /health` và `POST /forecast` trả kèm cả hai nhóm chỉ số, nên giao diện đối
tác không thể hiển thị độ chính xác của model mà giấu mất baseline.

Kết quả trên bộ dữ liệu demo hiện tại (`demo-booking-v2`):

| Chỉ số | Model | Baseline |
|---|---|---|
| Doanh thu — MAPE | 8.46% | 10.11% |
| Doanh thu — WAPE | 8.62% | 10.53% |
| Số vé — WAPE | 6.41% | 8.76% |

Ngoài ra backend có `runForecastBacktest()` chạy **walk-forward**: đi ngược N
ngày gần nhất, mỗi ngày gọi model bằng lịch sử cắt tới trước ngày đó rồi so với
doanh thu thực. Đây là phép đo vận hành (không phải holdout lúc train) và là
nguồn số cho panel "Độ chính xác của dự báo" ở trang giá động.

## API nội bộ

- `GET /health`
- `POST /forecast` — yêu cầu header `x-ml-api-key` nếu đã cấu hình key.
- `POST /live/predict-arrivals` — dự báo số khách đến trong horizon, p10/p50/p90
  đã calibration, time-split metrics, data-quality diagnostics và feature contributions.
- `POST /live/predict-wait` — suy ra ETA theo throughput rate p10/p50 và party phía trước.
- `POST /live/optimize` — constrained local search; bảo vệ item đã khóa, giới hạn shift và cấm overlap.

Live endpoints nhận observations từ Node backend, không tự truy cập PostgreSQL.
Model v3 loại timestamp tương lai/trùng, clip target bất khả thi, dùng feature tỷ lệ
theo capacity, chu kỳ giờ/ngày, recency weighting và split-conformal calibration.
Khi ít hơn 32 observation có actual target, service trả heuristic fallback với
`used_fallback=true` và `training_source=operational_heuristic`. Dữ liệu demo,
lịch sử quá cũ hoặc coverage/MAE không đạt luôn bị hạ confidence và không được
SmartQueue/Autopilot dùng để ra quyết định live.

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
