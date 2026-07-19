"""
data_gen.py — Sinh dữ liệu synthetic cho VietTicket Revenue Forecast (v2)

MỤC TIÊU CỦA BẢN v2 NÀY (khác bản Colab cũ):
Bản cũ để lộ vấn đề: XGBoost dồn ~60% importance vào `min_ticket_price`, RF thì
`default_capacity` + `min_ticket_price` chiếm > 35%. Nguyên nhân là do công thức
sinh dữ liệu cũ gần như: revenue ≈ price × capacity × noise nhỏ — một quan hệ
gần tuyến tính, dễ học, khiến model "ăn gian" thay vì học pattern thời gian thực.

Bản v2 phá vỡ quan hệ tuyến tính đó bằng cách:
  1. Thêm biến tiềm ẩn (latent) "popularity" độc lập với price/capacity/rating.
  2. Price ảnh hưởng đến NHU CẦU qua hệ số co giãn (elasticity) ngẫu nhiên theo
     từng attraction, không phải tỉ lệ thuận trực tiếp với doanh thu.
  3. Capacity chỉ là một RÀO CẢN mềm (soft cap qua sigmoid bão hoà gần full),
     không phải hệ số nhân tuyến tính.
  4. Mỗi attraction có một "kiểu mùa vụ" (seasonality archetype) khác nhau,
     ngày lễ/sự kiện có biên độ ngẫu nhiên riêng — không đồng nhất.
  5. Có noise nhân (log-normal), outlier ngẫu nhiên (~2% số ngày), và một số
     ngày đóng cửa/không có khách — mô phỏng nhiễu thật của dữ liệu booking.

Kết quả: mối quan hệ feature -> revenue phi tuyến, nhiều nguồn biến thiên hơn,
nên MAE/MAPE trên tập validation sẽ "trung thực" hơn (khó đạt số đẹp giả tạo)
và feature importance sẽ dàn trải hơn — đúng như bạn muốn: dataset khách quan
và bao phủ nhiều tình huống hơn.
"""

import argparse
import numpy as np
import pandas as pd

RNG_SEED = 42
CITIES = ["Hà Nội", "Hồ Chí Minh", "Đà Nẵng", "Phú Quốc", "Đà Lạt", "Hội An", "Nha Trang", "Huế"]
CITY_WEIGHTS = [0.16, 0.20, 0.12, 0.10, 0.10, 0.10, 0.12, 0.10]
TIERS = ["BASIC", "STANDARD", "PREMIUM"]

# Ngày lễ VN cố định (giản lược, đủ để tạo hiệu ứng) — mỗi năm generate lại theo range
FIXED_HOLIDAYS_MMDD = ["01-01", "04-30", "05-01", "09-02"]

SEASON_ARCHETYPES = ["SUMMER_PEAK", "HOLIDAY_PEAK", "WEEKEND_ONLY", "FLAT_STABLE"]


def seasonality_multiplier(archetype, date, rng_local):
    doy = date.dayofyear
    month = date.month
    if archetype == "SUMMER_PEAK":
        # đỉnh quanh tháng 6-8
        base = 1.0 + 0.6 * np.exp(-((month - 7) ** 2) / 8)
    elif archetype == "HOLIDAY_PEAK":
        # đỉnh quanh Tết (tháng 1-2) và nghỉ lễ tháng 4-5
        base = 1.0 + 0.5 * np.exp(-((month - 2) ** 2) / 3) + 0.35 * np.exp(-((month - 4.5) ** 2) / 2)
    elif archetype == "WEEKEND_ONLY":
        base = 1.0
    else:  # FLAT_STABLE
        base = 1.0 + 0.08 * np.sin(2 * np.pi * doy / 365)
    return base


def is_holiday(date):
    mmdd = date.strftime("%m-%d")
    return mmdd in FIXED_HOLIDAYS_MMDD


def generate(n_attractions=60, n_days=540, start_date="2025-01-01", seed=RNG_SEED, outlier_rate=0.02,
             closed_day_rate=0.01):
    rng = np.random.default_rng(seed)
    dates = pd.date_range(start=start_date, periods=n_days, freq="D")

    rows = []
    for i in range(n_attractions):
        attraction_id = f"ATT-{i:04d}"
        city = rng.choice(CITIES, p=CITY_WEIGHTS)
        tier = rng.choice(TIERS, p=[0.45, 0.35, 0.20])

        # Capacity & price được random ĐỘC LẬP theo phân phối log-uniform,
        # không gắn cứng theo tier (tier PREMIUM không mặc định là giá cao nhất
        # 100% -> tránh model chỉ cần học tier/price là đủ)
        default_capacity = int(np.exp(rng.uniform(np.log(30), np.log(1500))))
        min_ticket_price = float(np.exp(rng.uniform(np.log(50_000), np.log(1_800_000))))

        # Rating có tương quan YẾU với popularity thật (không phải nguồn thông tin hoàn hảo)
        true_popularity = rng.uniform(0.3, 3.0)  # latent, KHÔNG đưa thẳng vào feature
        avg_rating = float(np.clip(3.2 + 0.35 * np.log(true_popularity) + rng.normal(0, 0.4), 1.0, 5.0))
        review_count = int(max(0, rng.negative_binomial(4, 0.02) * (1 + true_popularity / 3)))

        elasticity = rng.uniform(0.2, 1.3)  # độ nhạy cảm giá, random theo từng attraction
        archetype = rng.choice(SEASON_ARCHETYPES)
        weekend_boost = rng.uniform(1.1, 1.9) if archetype != "FLAT_STABLE" else rng.uniform(1.0, 1.3)
        promo_prob = rng.uniform(0.01, 0.06)  # xác suất có ngày khuyến mãi
        holiday_boost = rng.uniform(1.3, 2.6)  # biên độ tăng ngày lễ, khác nhau mỗi attraction

        # reference price dùng để tính elasticity (giá "kỳ vọng thị trường" cho mức capacity này)
        reference_price = float(np.exp(0.55 * np.log(default_capacity) + 9.2 + rng.normal(0, 0.3)))

        trend = rng.uniform(-0.15, 0.35)  # xu hướng tăng/giảm phổ biến theo năm (tính theo n_days)

        for d_idx, date in enumerate(dates):
            dow = date.dayofweek
            is_weekend = dow >= 5
            holiday = is_holiday(date)

            # đóng cửa ngẫu nhiên hiếm khi (bảo trì, thời tiết xấu...)
            if rng.random() < closed_day_rate:
                rows.append(_row(attraction_id, date, city, tier, default_capacity, min_ticket_price,
                                  avg_rating, review_count, 0, 0.0))
                continue

            promo = rng.random() < promo_prob
            effective_price = min_ticket_price * (0.7 if promo else 1.0)

            season_mult = seasonality_multiplier(archetype, date, rng)
            weekend_mult = weekend_boost if is_weekend else 1.0
            holiday_mult = holiday_boost if holiday else 1.0
            trend_mult = 1.0 + trend * (d_idx / n_days)
            price_mult = (reference_price / max(effective_price, 1.0)) ** elasticity

            base_demand = true_popularity * season_mult * weekend_mult * holiday_mult * trend_mult * price_mult
            base_demand *= (default_capacity ** 0.35)  # capacity ảnh hưởng phi tuyến, không tuyến tính

            noise = np.exp(rng.normal(0, 0.28))  # log-normal noise
            raw_demand = max(0.0, base_demand * noise)

            # soft cap: bookings bão hoà mượt khi tiệm cận capacity thay vì cắt cứng
            utilization = raw_demand / (raw_demand + default_capacity)
            bookings = int(round(utilization * default_capacity * min(1.4, raw_demand / max(default_capacity, 1) + 0.3)))
            bookings = int(np.clip(bookings, 0, default_capacity))

            # outlier ngẫu nhiên: sự kiện đột biến hoặc sự cố tụt khách
            if rng.random() < outlier_rate:
                bookings = int(np.clip(bookings * rng.choice([0.15, 2.2, 3.0]), 0, default_capacity))

            revenue = bookings * effective_price * np.exp(rng.normal(0, 0.05))

            rows.append(_row(attraction_id, date, city, tier, default_capacity, min_ticket_price,
                              avg_rating, review_count, bookings, revenue))

    df = pd.DataFrame(rows)
    return df


def _row(attraction_id, date, city, tier, default_capacity, min_ticket_price, avg_rating, review_count,
         bookings, revenue):
    return {
        "attractionId": attraction_id,
        "date": date.strftime("%Y-%m-%d"),
        "city": city,
        "tier": tier,
        "default_capacity": default_capacity,
        "min_ticket_price": round(min_ticket_price, 0),
        "avg_rating": round(avg_rating, 2),
        "review_count": review_count,
        "day_of_week": date.dayofweek,
        "is_weekend": int(date.dayofweek >= 5),
        "is_holiday": int(is_holiday(date)),
        "day_of_year": date.dayofyear,
        "month": date.month,
        "bookings": bookings,
        "revenue": round(revenue, 0),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--attractions", type=int, default=60)
    parser.add_argument("--days", type=int, default=540)
    parser.add_argument("--start-date", type=str, default="2025-01-01")
    parser.add_argument("--seed", type=int, default=RNG_SEED)
    parser.add_argument("--out", type=str, default="data/booking_history.csv")
    args = parser.parse_args()

    df = generate(n_attractions=args.attractions, n_days=args.days, start_date=args.start_date, seed=args.seed)
    import os
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    df.to_csv(args.out, index=False)
    print(f"Đã sinh {len(df):,} dòng ({args.attractions} attractions x {args.days} ngày) -> {args.out}")
    print(df.groupby('attractionId')['revenue'].mean().describe())
