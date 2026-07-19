"""
synthetic_data.py
------------------------------------------------------------
Sinh dữ liệu doanh thu giả lập theo attraction-day để train model khi
chưa có đủ dữ liệu booking thật (VietTicket còn mới, lịch sử booking
thực tế còn ngắn). Mô phỏng các đặc điểm doanh thu du lịch VN:

  - Hiệu ứng cuối tuần (thứ 7, CN doanh thu cao hơn ngày thường)
  - Mùa cao điểm hè (tháng 6-8) và Tết (spike hoặc dip tùy loại hình)
  - Tier giá vé ảnh hưởng tới doanh thu trung bình/ngày
  - Nhiễu ngẫu nhiên lệch phải (right-skew) ở các ngày cao điểm, để
    log1p transform trong features.py/train.py có tác dụng thực sự
  - Attraction mới (published gần đây) có doanh thu biến động hơn

Dữ liệu này KHÔNG thay thế dữ liệu thật — chỉ dùng để bootstrap model
ban đầu. Khi có đủ booking thật, nên retrain bằng dữ liệu thật (Node
backend tổng hợp từ bảng Booking rồi gọi POST /train với dataset thật).
"""

import random
from datetime import date, timedelta

import numpy as np
import pandas as pd

from .holidays import is_holiday, is_tet_peak

CITIES = [
    ("Đà Nẵng", 0.22),
    ("Hà Nội", 0.20),
    ("TP. Hồ Chí Minh", 0.20),
    ("Huế", 0.10),
    ("Hội An", 0.10),
    ("Nha Trang", 0.10),
    ("Đà Lạt", 0.08),
]

TIER_BASE_REVENUE = {
    # Doanh thu trung bình/ngày (VND) khi mọi thứ ở mức trung bình
    "BUDGET": 2_500_000,
    "STANDARD": 6_000_000,
    "PREMIUM": 14_000_000,
    "LUXURY": 30_000_000,
}
TIER_WEIGHTS = {"BUDGET": 0.30, "STANDARD": 0.40, "PREMIUM": 0.22, "LUXURY": 0.08}
TIER_TICKET_PRICE = {"BUDGET": 80_000, "STANDARD": 200_000, "PREMIUM": 450_000, "LUXURY": 900_000}


def _weighted_choice(rng: random.Random, options_with_weight):
    options, weights = zip(*options_with_weight)
    return rng.choices(options, weights=weights, k=1)[0]


def generate_attractions(num_attractions: int, seed: int = 42) -> pd.DataFrame:
    rng = random.Random(seed)
    rows = []
    for i in range(num_attractions):
        tier = _weighted_choice(rng, list(TIER_WEIGHTS.items()))
        city = _weighted_choice(rng, CITIES)
        rows.append(
            {
                "attraction_id": f"synth-{i:04d}",
                "tier": tier,
                "city": city,
                "capacity": rng.randint(50, 500),
                "avg_ticket_price": TIER_TICKET_PRICE[tier] * rng.uniform(0.85, 1.2),
                "rating": round(rng.uniform(3.2, 5.0), 1),
                "num_reviews": rng.randint(0, 800),
                "published_days_ago": rng.randint(30, 900),
            }
        )
    return pd.DataFrame(rows)


def generate_daily_revenue(
    attractions: pd.DataFrame, num_days: int, end_date: date = None, seed: int = 42
) -> pd.DataFrame:
    """Trả về DataFrame long-format: 1 dòng / (attraction, date)."""
    rng = np.random.default_rng(seed)
    end_date = end_date or date.today()
    dates = [end_date - timedelta(days=offset) for offset in range(num_days - 1, -1, -1)]

    records = []
    for _, attraction in attractions.iterrows():
        base = TIER_BASE_REVENUE[attraction["tier"]]
        # Hệ số riêng của attraction (một số điểm "hot" hơn mức trung bình tier)
        popularity = rng.lognormal(mean=0.0, sigma=0.35)
        rating_boost = 0.6 + 0.4 * (attraction["rating"] / 5.0)
        new_attraction_volatility = 1.5 if attraction["published_days_ago"] < 90 else 1.0

        rev_history = []
        for day_index, d in enumerate(dates):
            weekend_mult = 1.55 if d.weekday() >= 5 else 1.0
            summer_mult = 1.25 if d.month in (6, 7, 8) else 1.0
            holiday_mult = 1.8 if is_holiday(d) else 1.0
            tet_mult = 2.4 if is_tet_peak(d) else 1.0

            # Xu hướng tăng trưởng nhẹ theo thời gian (traction tăng dần)
            growth_mult = 1.0 + 0.0004 * day_index

            expected = (
                base
                * popularity
                * rating_boost
                * weekend_mult
                * summer_mult
                * holiday_mult
                * tet_mult
                * growth_mult
            )

            # Nhiễu lệch phải: dùng lognormal noise, biên độ lớn hơn ở ngày cao điểm
            noise_sigma = 0.25 * new_attraction_volatility
            if holiday_mult > 1 or tet_mult > 1 or weekend_mult > 1:
                noise_sigma *= 1.4
            noise = rng.lognormal(mean=0.0, sigma=noise_sigma)

            revenue = max(0.0, expected * noise)
            tickets = max(0, int(round(revenue / max(attraction["avg_ticket_price"], 1.0))))

            rev_history.append(revenue)
            records.append(
                {
                    "attraction_id": attraction["attraction_id"],
                    "date": d,
                    "revenue": round(revenue, 2),
                    "tickets": tickets,
                }
            )

    return pd.DataFrame.from_records(records).sort_values(["attraction_id", "date"]).reset_index(drop=True)


def generate_synthetic_dataset(num_attractions: int = 200, num_days: int = 365, seed: int = 42):
    attractions = generate_attractions(num_attractions, seed=seed)
    revenue = generate_daily_revenue(attractions, num_days, seed=seed)
    return attractions, revenue
