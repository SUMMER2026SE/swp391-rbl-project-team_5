"""
train.py
------------------------------------------------------------
Pipeline huấn luyện model dự báo doanh thu.

Train bằng dữ liệu thật đã export từ Node backend:
    python -m app.train --data data/booking_history.csv

Chỉ khi bootstrap môi trường demo chưa có lịch sử, phải bật cờ tường minh:
    python -m app.train --bootstrap-synthetic

Time-based split: KHÔNG random-split, vì đây là bài toán time series -
random split sẽ để lộ tương lai vào tập train (leakage), làm MAPE trên
test set trông tốt hơn thực tế khi deploy. Thay vào đó, cắt theo mốc
thời gian: 80% ngày đầu -> train, 20% ngày cuối -> test, áp dụng đồng
loạt cho mọi attraction.
"""

import argparse
from datetime import datetime, timezone
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


def mape_on_observed_days(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    """MAPE chỉ trên ngày có doanh thu; ngày 0 VND được đánh giá bằng WAPE.

    Dùng epsilon=1 VND cho ngày không bán vé sẽ thổi MAPE lên vô hạn và tạo
    một metric đẹp/xấu không có ý nghĩa nghiệp vụ.
    """
    observed = np.abs(y_true) > 0
    if not np.any(observed):
        return 0.0
    return float(np.mean(np.abs(
        (y_true[observed] - y_pred[observed]) / y_true[observed]
    )) * 100)


def wape(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    denominator = float(np.sum(np.abs(y_true)))
    if denominator <= 0:
        return 0.0
    return float(np.sum(np.abs(y_true - y_pred)) / denominator * 100)


def load_training_csv(path: str) -> Tuple[pd.DataFrame, pd.DataFrame]:
    required = {
        "attraction_id",
        "date",
        "tier",
        "city",
        "capacity",
        "avg_ticket_price",
        "rating",
        "num_reviews",
        "published_days_ago",
        "revenue",
        "tickets",
    }
    raw = pd.read_csv(path)
    missing = sorted(required - set(raw.columns))
    if missing:
        raise ValueError(f"Dataset thiếu cột bắt buộc: {', '.join(missing)}")

    raw = raw[list(required)].copy()
    raw["date"] = pd.to_datetime(raw["date"], errors="raise").dt.date
    raw = raw.sort_values(["attraction_id", "date"]).reset_index(drop=True)

    attraction_columns = [
        "attraction_id",
        "tier",
        "city",
        "capacity",
        "avg_ticket_price",
        "rating",
        "num_reviews",
        "published_days_ago",
    ]
    attractions = raw[attraction_columns].drop_duplicates("attraction_id", keep="first")
    revenue = raw[["attraction_id", "date", "revenue", "tickets"]].copy()

    if attractions["attraction_id"].nunique() < 3:
        raise ValueError("Cần dữ liệu của ít nhất 3 điểm tham quan để train model dùng chung.")
    if revenue["date"].nunique() < 90:
        raise ValueError("Cần ít nhất 90 ngày lịch sử thực trước khi retrain.")
    if (revenue["revenue"] < 0).any() or (revenue["tickets"] < 0).any():
        raise ValueError("Doanh thu và số vé trong dataset không được âm.")

    return attractions, revenue


def train_and_save(
    model_dir: str,
    model_version: str,
    num_attractions: int = 200,
    num_days: int = 365,
    attractions: pd.DataFrame = None,
    revenue: pd.DataFrame = None,
    training_source: str = "real_booking_history",
) -> dict:
    if attractions is None or revenue is None:
        raise ValueError("Phải truyền dữ liệu training thực hoặc bật bootstrap synthetic ở CLI.")

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

    test_mape = mape_on_observed_days(y_test_actual, pred_revenue_test)
    test_wape = wape(y_test_actual, pred_revenue_test)
    test_mae = float(np.mean(np.abs(y_test_actual - pred_revenue_test)))

    model.city_freq_map = city_freq_map
    model.residual_std = max(residual_std, 0.05)
    model.trained_at = datetime.now(timezone.utc)
    model.metrics = {
        "mape_observed_days": test_mape,
        "wape": test_wape,
        "mae": test_mae,
        "num_train_samples": int(len(train_df)),
        "num_test_samples": int(len(test_df)),
        "training_source": training_source,
    }
    model.save(model_dir)
    train_percent = round(TIME_SPLIT_TRAIN_RATIO * 100)

    return {
        "model_version": model_version,
        "trained_at": model.trained_at,
        "num_samples": int(len(merged)),
        "mape": test_mape,
        "wape": test_wape,
        "mae": test_mae,
        "notes": (
            f"Time-based split ({train_percent}/{100 - train_percent}), "
            f"train={len(train_df)} test={len(test_df)} rows."
        ),
    }


def main():
    parser = argparse.ArgumentParser(description="Train ensemble revenue forecast model")
    parser.add_argument("--model-dir", default="./models")
    parser.add_argument("--model-version", default="rf_xgb_ensemble_v1")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--data", help="CSV lịch sử thực do backend export")
    source.add_argument(
        "--bootstrap-synthetic",
        action="store_true",
        help="Chỉ dùng để bootstrap demo khi chưa có dữ liệu thật",
    )
    parser.add_argument("--num-attractions", type=int, default=200)
    parser.add_argument("--num-days", type=int, default=365)
    args = parser.parse_args()

    if args.data:
        attractions, revenue = load_training_csv(args.data)
        training_source = "real_booking_history"
    else:
        attractions, revenue = generate_synthetic_dataset(
            num_attractions=args.num_attractions,
            num_days=args.num_days,
        )
        training_source = "synthetic_bootstrap"

    result = train_and_save(
        model_dir=args.model_dir,
        model_version=args.model_version,
        attractions=attractions,
        revenue=revenue,
        training_source=training_source,
    )
    print(f"Trained model {result['model_version']}")
    print(f"  MAPE (observed days): {result['mape']:.2f}%")
    print(f"  WAPE (all days):      {result['wape']:.2f}%")
    print(f"  MAE:  {result['mae']:,.0f} VND")
    print(f"  {result['notes']}")
    print(f"  Model saved to: {args.model_dir}")


if __name__ == "__main__":
    main()
