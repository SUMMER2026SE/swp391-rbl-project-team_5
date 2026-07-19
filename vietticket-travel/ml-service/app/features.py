"""
features.py
------------------------------------------------------------
Feature engineering dùng chung cho cả training (train.py) và
inference (model.py) — bắt buộc phải giống hệt nhau ở 2 chỗ này,
nếu không model sẽ dự báo sai lệch (train/serving skew).

Feature list (per attraction-day):
  - dow (0=Mon..6=Sun), month, is_weekend
  - is_holiday, is_tet_peak, days_to_holiday
  - tier_encoded (BUDGET=0..LUXURY=3, thứ tự hạng vé)
  - city_encoded (frequency encoding trên tập train, xem model.py)
  - capacity, avg_ticket_price, rating, num_reviews
  - published_days_ago (attraction càng mới, biến động doanh thu càng lớn)
  - lag_1, lag_7, lag_14 (doanh thu ngày trước đó / 7 / 14 ngày trước)
  - roll_mean_7, roll_mean_28, roll_std_7 (trung bình/độ lệch trượt)

Target: log1p(revenue) — dữ liệu doanh thu lệch phải mạnh vào các
ngày cao điểm (lễ Tết, cuối tuần), log1p giúp giảm ảnh hưởng của các
giá trị cực đại lên loss, ổn định huấn luyện hơn so với train trực tiếp
trên revenue thô.
"""

from datetime import date, timedelta
from typing import List, Sequence

import numpy as np
import pandas as pd

from .holidays import days_to_nearest_holiday, is_holiday, is_tet_peak

TIER_ORDER = {"BUDGET": 0, "STANDARD": 1, "PREMIUM": 2, "LUXURY": 3}

FEATURE_COLUMNS = [
    "dow",
    "month",
    "is_weekend",
    "is_holiday",
    "is_tet_peak",
    "days_to_holiday",
    "tier_encoded",
    "city_encoded",
    "capacity",
    "avg_ticket_price",
    "rating",
    "num_reviews",
    "published_days_ago",
    "lag_1",
    "lag_7",
    "lag_14",
    "roll_mean_7",
    "roll_mean_28",
    "roll_std_7",
]


def calendar_features(d: date) -> dict:
    return {
        "dow": d.weekday(),
        "month": d.month,
        "is_weekend": int(d.weekday() >= 5),
        "is_holiday": int(is_holiday(d)),
        "is_tet_peak": int(is_tet_peak(d)),
        "days_to_holiday": days_to_nearest_holiday(d),
    }


def lag_and_rolling_features(history_revenue: Sequence[float]) -> dict:
    """history_revenue: doanh thu các ngày TRƯỚC ngày cần dự báo, sắp xếp
    tăng dần theo thời gian (phần tử cuối = ngày ngay trước target).
    Nếu lịch sử ngắn hơn window cần thiết, dùng mean của phần có sẵn
    (hoặc 0 nếu rỗng hoàn toàn) để tránh NaN.
    """
    arr = np.asarray(history_revenue, dtype=float)

    def lag(n):
        return float(arr[-n]) if len(arr) >= n else (float(arr.mean()) if len(arr) else 0.0)

    def roll_mean(window):
        tail = arr[-window:] if len(arr) else arr
        return float(tail.mean()) if len(tail) else 0.0

    def roll_std(window):
        tail = arr[-window:] if len(arr) else arr
        return float(tail.std()) if len(tail) > 1 else 0.0

    return {
        "lag_1": lag(1),
        "lag_7": lag(7),
        "lag_14": lag(14),
        "roll_mean_7": roll_mean(7),
        "roll_mean_28": roll_mean(28),
        "roll_std_7": roll_std(7),
    }


def static_attraction_features(
    tier: str,
    city_encoded: float,
    capacity: int,
    avg_ticket_price: float,
    rating: float,
    num_reviews: int,
    published_days_ago: int,
) -> dict:
    return {
        "tier_encoded": TIER_ORDER.get(tier, 1),
        "city_encoded": city_encoded,
        "capacity": capacity,
        "avg_ticket_price": avg_ticket_price,
        "rating": rating,
        "num_reviews": num_reviews,
        "published_days_ago": published_days_ago,
    }


def build_feature_row(
    target_date: date,
    history_revenue: Sequence[float],
    tier: str,
    city_encoded: float,
    capacity: int,
    avg_ticket_price: float,
    rating: float,
    num_reviews: int,
    published_days_ago: int,
) -> dict:
    row = {}
    row.update(calendar_features(target_date))
    row.update(lag_and_rolling_features(history_revenue))
    row.update(
        static_attraction_features(
            tier, city_encoded, capacity, avg_ticket_price, rating, num_reviews, published_days_ago
        )
    )
    return row


def rows_to_dataframe(rows: List[dict]) -> pd.DataFrame:
    df = pd.DataFrame(rows)
    # Đảm bảo đúng thứ tự cột đã dùng khi train, tránh lệch cột khi predict.
    for col in FEATURE_COLUMNS:
        if col not in df.columns:
            df[col] = 0.0
    return df[FEATURE_COLUMNS]
