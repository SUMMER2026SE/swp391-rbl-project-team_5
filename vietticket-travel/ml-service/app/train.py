"""
train.py
------------------------------------------------------------
Pipeline huấn luyện model dự báo doanh thu.

Chạy độc lập (bootstrap với dữ liệu synthetic):
    python -m app.train

Hoặc gọi train_and_save(...) từ FastAPI endpoint POST /train, hoặc từ
Node backend khi đã có đủ dữ liệu Booking thật (truyền vào DataFrame
attractions + revenue theo đúng format của generate_synthetic_dataset).

Time-based split: KHÔNG random-split, vì đây là bài toán time series -
random split sẽ để lộ tương lai vào tập train (leakage), làm MAPE trên
test set trông tốt hơn thực tế khi deploy. Thay vào đó, cắt theo mốc
thời gian: 80% ngày đầu -> train, 20% ngày cuối -> test, áp dụng đồng
loạt cho mọi attraction.
"""

import argparse
from datetime import datetime
from typing import Tuple

import numpy as np
import pandas as pd

from . import features as feat
from .model import EnsembleForecastModel, default_city_freq_map
from .synthetic_data import generate_synthetic_dataset

TIME_SPLIT_TRAIN_RATIO = 0.8


def _add_calendar_and_static_features(merged: pd.DataFrame) -> pd.DataFrame:
    calendar_rows = merged["date"].apply(lambda d: feat.calendar_features(d))
    calendar_df = pd.DataFrame(list(calendar_rows), index=merged.index)

    static_rows = merged.apply(
        lambda r: feat.static_attraction_features(
            tier=r["tier"],
            city_encoded=r["city_encoded"],
            capacity=r["capacity"],
            avg_ticket_price=r["avg_ticket_price"],
            rating=r["rating"],
            num_reviews=r["num_reviews"],
            published_days_ago=r["published_days_ago"] + r["day_offset"],
        ),
        axis=1,
    )
    static_df = pd.DataFrame(list(static_rows), index=merged.index)

    # static_df recompute (tier_encoded, city_encoded, capacity, avg_ticket_price,
    # rating, num_reviews, published_days_ago) từ các cột thô cùng tên trong
    # merged - phải drop bản thô trước khi concat để tránh trùng tên cột
    # (pandas sẽ âm thầm bỏ cột trùng khi to_dict("records"), gây lệch feature).
    overlap = [c for c in static_df.columns if c in merged.columns]
    merged = merged.drop(columns=overlap)

    return pd.concat([merged, calendar_df, static_df], axis=1)


def _add_lag_and_rolling_features(revenue_df: pd.DataFrame) -> pd.DataFrame:
    """Tính lag/rolling PER ATTRACTION dùng groupby + shift, chỉ dựa trên
    doanh thu thực tế các ngày trước đó (không rò rỉ ngày hiện tại/tương lai,
    và không rò rỉ dữ liệu giữa các attraction khác nhau).
    """
    df = revenue_df.sort_values(["attraction_id", "date"]).reset_index(drop=True).copy()
    grouped_revenue = df.groupby("attraction_id")["revenue"]

    df["lag_1"] = grouped_revenue.shift(1)
    df["lag_7"] = grouped_revenue.shift(7)
    df["lag_14"] = grouped_revenue.shift(14)

    # Rolling phải chạy TRÊN TỪNG GROUP riêng biệt: nhóm lại theo attraction_id
    # sau khi shift(1) để không tính rolling window vắt qua ranh giới 2 attraction.
    shifted = grouped_revenue.shift(1)
    df["_shifted_revenue"] = shifted
    grouped_shifted = df.groupby("attraction_id")["_shifted_revenue"]
    df["roll_mean_7"] = grouped_shifted.rolling(7, min_periods=1).mean().reset_index(level=0, drop=True)
    df["roll_mean_28"] = grouped_shifted.rolling(28, min_periods=1).mean().reset_index(level=0, drop=True)
    df["roll_std_7"] = (
        grouped_shifted.rolling(7, min_periods=1).std().reset_index(level=0, drop=True).fillna(0.0)
    )
    df.drop(columns=["_shifted_revenue"], inplace=True)

    for col in ["lag_1", "lag_7", "lag_14", "roll_mean_7", "roll_mean_28"]:
        df[col] = df[col].fillna(df.groupby("attraction_id")["revenue"].transform("mean"))

    df["day_offset"] = df.groupby("attraction_id").cumcount()
    return df


def build_training_frame(attractions: pd.DataFrame, revenue: pd.DataFrame) -> pd.DataFrame:
    revenue_with_lags = _add_lag_and_rolling_features(revenue)
    merged = revenue_with_lags.merge(attractions, on="attraction_id", how="left")

    city_freq_map = default_city_freq_map(attractions)
    merged["city_encoded"] = merged["city"].map(city_freq_map).fillna(np.median(list(city_freq_map.values())))

    merged = _add_calendar_and_static_features(merged)
    merged["target_log"] = np.log1p(merged["revenue"].clip(lower=0))
    return merged, city_freq_map


def time_based_split(df: pd.DataFrame, train_ratio: float = TIME_SPLIT_TRAIN_RATIO) -> Tuple[pd.DataFrame, pd.DataFrame]:
    cutoff_date = df["date"].quantile(train_ratio, interpolation="nearest")
    train_df = df[df["date"] <= cutoff_date]
    test_df = df[df["date"] > cutoff_date]
    return train_df, test_df


def mape(y_true: np.ndarray, y_pred: np.ndarray, epsilon: float = 1.0) -> float:
    """MAPE với epsilon nhỏ để tránh chia cho 0 ở các ngày doanh thu = 0
    (điểm tham quan mới/ít khách) - chuẩn thực hành cho revenue forecasting."""
    denom = np.clip(np.abs(y_true), epsilon, None)
    return float(np.mean(np.abs((y_true - y_pred) / denom)) * 100)


def train_and_save(
    model_dir: str,
    model_version: str,
    num_attractions: int = 200,
    num_days: int = 365,
    attractions: pd.DataFrame = None,
    revenue: pd.DataFrame = None,
) -> dict:
    if attractions is None or revenue is None:
        attractions, revenue = generate_synthetic_dataset(num_attractions=num_attractions, num_days=num_days)

    merged, city_freq_map = build_training_frame(attractions, revenue)
    train_df, test_df = time_based_split(merged)

    X_train = feat.rows_to_dataframe(train_df.to_dict("records"))
    y_train = train_df["target_log"].to_numpy()
    X_test = feat.rows_to_dataframe(test_df.to_dict("records"))
    y_test_log = test_df["target_log"].to_numpy()
    y_test_actual = test_df["revenue"].to_numpy()

    model = EnsembleForecastModel.new_untrained(model_version=model_version)
    model.fit(X_train, y_train)

    pred_log_test = model.predict_log(X_test)
    residual_std = float(np.std(y_test_log - pred_log_test)) if len(y_test_log) else 0.3
    pred_revenue_test = np.expm1(pred_log_test)

    test_mape = mape(y_test_actual, pred_revenue_test)
    test_mae = float(np.mean(np.abs(y_test_actual - pred_revenue_test)))

    model.city_freq_map = city_freq_map
    model.residual_std = max(residual_std, 0.05)
    model.trained_at = datetime.utcnow()
    model.metrics = {
        "mape": test_mape,
        "mae": test_mae,
        "num_train_samples": int(len(train_df)),
        "num_test_samples": int(len(test_df)),
    }
    model.save(model_dir)

    return {
        "model_version": model_version,
        "trained_at": model.trained_at,
        "num_samples": int(len(merged)),
        "mape": test_mape,
        "mae": test_mae,
        "notes": (
            f"Time-based split ({int(TIME_SPLIT_TRAIN_RATIO*100)}/"
            f"{int((1-TIME_SPLIT_TRAIN_RATIO)*100)}), "
            f"train={len(train_df)} test={len(test_df)} dòng."
        ),
    }


def main():
    parser = argparse.ArgumentParser(description="Train ensemble revenue forecast model")
    parser.add_argument("--model-dir", default="./models")
    parser.add_argument("--model-version", default="rf_xgb_ensemble_v1")
    parser.add_argument("--num-attractions", type=int, default=200)
    parser.add_argument("--num-days", type=int, default=365)
    args = parser.parse_args()

    result = train_and_save(
        model_dir=args.model_dir,
        model_version=args.model_version,
        num_attractions=args.num_attractions,
        num_days=args.num_days,
    )
    print(f"Đã train xong model {result['model_version']}")
    print(f"  MAPE: {result['mape']:.2f}%")
    print(f"  MAE:  {result['mae']:,.0f} VND")
    print(f"  {result['notes']}")
    print(f"  Model đã lưu vào: {args.model_dir}")


if __name__ == "__main__":
    main()
