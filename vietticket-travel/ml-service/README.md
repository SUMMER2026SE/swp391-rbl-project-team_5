# ml-service — VietTicket Revenue Forecast (v2)

## Chạy nhanh

```bash
cd ml-service
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env

# 1. Sinh dữ liệu synthetic đa dạng hơn (60 attractions x 540 ngày mặc định)
python data_gen.py --attractions 60 --days 540 --out data/booking_history.csv

# 2. Train (time-based split, regularized, có cảnh báo feature dominance)
python train.py --data data/booking_history.csv --version v1

# 3. Chạy service
uvicorn app.main:app --reload --port 8001
curl http://localhost:8001/health
```

## Khi có dữ liệu booking thật

```bash
node backend/scripts/export_booking_history.js
cd ml-service
python train.py --data data/booking_history.csv --version v$(date +%Y%m%d)
```

Nếu dữ liệu thật còn ít (script sẽ tự cảnh báo nếu < 500 dòng), có thể nối
CSV thật với một phần synthetic để tránh model overfit vào vài attraction có
nhiều đơn nhất — nhưng đây là giải pháp tạm, nên ưu tiên đợi đủ dữ liệu thật.

## Những gì đã thay đổi so với bản Colab cũ (xử lý phản hồi "bias")

| Vấn đề bản cũ | Xử lý ở bản v2 |
|---|---|
| `min_ticket_price` chiếm ~60% importance (XGBoost) | Giá ảnh hưởng demand qua hệ số co giãn (elasticity) ngẫu nhiên theo attraction, không tỉ lệ thuận trực tiếp với revenue |
| `default_capacity` + `min_ticket_price` chiếm > 35% (RF) | Capacity chỉ là rào cản mềm (soft cap), thêm biến "popularity" độc lập |
| Random split → có thể leak thông tin tương lai | Time-based split: 15% ngày cuối mỗi attraction làm validation |
| `min_samples_leaf=1` (RF) → overfit | Ép `min_samples_leaf >= 3`, giới hạn `max_depth` |
| Không cảnh báo khi lệch | `train.py` tự in cảnh báo nếu 1 feature > 40% importance |

## Cấu trúc

```
ml-service/
  data_gen.py          # sinh synthetic data (v2, chống bias)
  train.py              # train + regularize + time-based split + cảnh báo dominance
  app/
    main.py             # FastAPI: GET /health, POST /predict
    schemas.py          # Pydantic request/response
    features.py         # feature engineering khớp train.py
    model.py            # load model, recursive ensemble predict + confidence interval
  models/               # rf_model.pkl, xgb_model.pkl, metadata.json (sinh ra sau khi train)
  requirements.txt
  .env.example
```
