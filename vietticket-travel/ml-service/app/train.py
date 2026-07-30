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
import sys
from datetime import date, datetime, timezone
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
        ),
        axis=1,
    )
    static_df = pd.DataFrame(list(static_rows), index=merged.index)

    # static_df recompute (tier_encoded, city_encoded, capacity, avg_ticket_price,
    # rating, num_reviews) từ các cột thô cùng tên trong
    # merged - phải drop bản thô trước khi concat để tránh trùng tên cột
    # (pandas sẽ âm thầm bỏ cột trùng khi to_dict("records"), gây lệch feature).
    overlap = [c for c in static_df.columns if c in merged.columns]
    merged = merged.drop(columns=overlap)

    return pd.concat([merged, calendar_df, static_df], axis=1)


LAG_COLUMNS = ["lag_1", "lag_7", "lag_14", "roll_mean_7", "roll_mean_28", "roll_std_7"]
TICKET_PREFIX = "tk_"


def _add_lag_and_rolling_features(
    revenue_df: pd.DataFrame,
    value_column: str = "revenue",
    prefix: str = "",
) -> pd.DataFrame:
    """Tính lag/rolling PER ATTRACTION dùng groupby + shift, chỉ dựa trên giá
    trị thực tế các ngày trước đó (không rò rỉ ngày hiện tại/tương lai, và
    không rò rỉ dữ liệu giữa các attraction khác nhau).

    `value_column` cho phép dùng lại đúng pipeline này cho cả hai target: doanh
    thu và số vé. Hai model phải nhìn thấy feature được tính theo cùng một
    cách, nếu không sai lệch giữa chúng sẽ đến từ pipeline chứ không phải từ
    dữ liệu.
    """
    df = revenue_df.sort_values(["attraction_id", "date"]).reset_index(drop=True).copy()
    grouped_values = df.groupby("attraction_id")[value_column]

    df[f"{prefix}lag_1"] = grouped_values.shift(1)
    df[f"{prefix}lag_7"] = grouped_values.shift(7)
    df[f"{prefix}lag_14"] = grouped_values.shift(14)

    # Rolling phải chạy TRÊN TỪNG GROUP riêng biệt: nhóm lại theo attraction_id
    # sau khi shift(1) để không tính rolling window vắt qua ranh giới 2 attraction.
    shifted = grouped_values.shift(1)
    df["_shifted_value"] = shifted
    grouped_shifted = df.groupby("attraction_id")["_shifted_value"]
    df[f"{prefix}roll_mean_7"] = grouped_shifted.rolling(7, min_periods=1).mean().reset_index(level=0, drop=True)
    df[f"{prefix}roll_mean_28"] = grouped_shifted.rolling(28, min_periods=1).mean().reset_index(level=0, drop=True)
    df[f"{prefix}roll_std_7"] = (
        grouped_shifted.rolling(7, min_periods=1).std().reset_index(level=0, drop=True).fillna(0.0)
    )
    df.drop(columns=["_shifted_value"], inplace=True)

    # Missing early lags must use only information available before the target
    # row. Filling from the full attraction mean would leak future revenue into
    # training and make the holdout metrics look falsely strong.
    shifted_values = df.groupby("attraction_id")[value_column].shift(1)
    past_mean = shifted_values.groupby(df["attraction_id"]).transform(
        lambda values: values.expanding().mean()
    ).fillna(0.0)
    for col in LAG_COLUMNS[:-1]:
        df[f"{prefix}{col}"] = df[f"{prefix}{col}"].fillna(past_mean)

    df["day_offset"] = df.groupby("attraction_id").cumcount()
    return df


def tickets_feature_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Frame feature cho model số vé: giống hệt frame doanh thu, chỉ thay 6 cột
    lag/rolling bằng phiên bản tính trên chuỗi số vé."""
    renamed = df.copy()
    for col in LAG_COLUMNS:
        renamed[col] = renamed[f"{TICKET_PREFIX}{col}"]
    return feat.rows_to_dataframe(renamed.to_dict("records"))


def weekday_mean_baseline(train_df: pd.DataFrame, test_df: pd.DataFrame, target: str) -> np.ndarray:
    """Baseline trung bình theo (điểm tham quan, thứ trong tuần).

    Đây là thứ mà bất kỳ ai cũng làm được bằng một câu GROUP BY, nên nó là
    ngưỡng tối thiểu mà model học máy phải vượt qua. Không so với nó thì con số
    MAPE của ensemble không nói lên điều gì cả.
    """
    lookup = train_df.groupby(["attraction_id", "dow"])[target].mean()
    attraction_mean = train_df.groupby("attraction_id")[target].mean()
    global_mean = float(train_df[target].mean()) if len(train_df) else 0.0

    def predict(row):
        key = (row["attraction_id"], row["dow"])
        if key in lookup.index:
            return float(lookup.loc[key])
        if row["attraction_id"] in attraction_mean.index:
            return float(attraction_mean.loc[row["attraction_id"]])
        return global_mean

    return test_df.apply(predict, axis=1).to_numpy()


def build_training_frame(attractions: pd.DataFrame, revenue: pd.DataFrame) -> pd.DataFrame:
    revenue_with_lags = _add_lag_and_rolling_features(revenue)
    revenue_with_lags = _add_lag_and_rolling_features(
        revenue_with_lags, value_column="tickets", prefix=TICKET_PREFIX,
    )
    merged = revenue_with_lags.merge(attractions, on="attraction_id", how="left")

    city_freq_map = default_city_freq_map(attractions)
    merged["city_encoded"] = merged["city"].map(city_freq_map).fillna(np.median(list(city_freq_map.values())))

    merged = _add_calendar_and_static_features(merged)
    merged["target_log"] = np.log1p(merged["revenue"].clip(lower=0))
    merged["target_tickets_log"] = np.log1p(merged["tickets"].clip(lower=0))
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
        "revenue",
        "tickets",
    }
    raw = pd.read_csv(path)
    missing = sorted(required - set(raw.columns))
    if missing:
        raise ValueError(f"Dataset thiếu cột bắt buộc: {', '.join(missing)}")

    raw = raw[list(required)].copy()
    if raw.empty:
        raise ValueError(
            "Dataset không có dòng dữ liệu thật đủ điều kiện để train. "
            "Hãy export thêm booking đã chốt, không dùng dataset demo cho production."
        )
    if raw.isna().any().any():
        missing_values = sorted(raw.columns[raw.isna().any()].tolist())
        raise ValueError(
            f"Dataset có giá trị rỗng ở cột bắt buộc: {', '.join(missing_values)}"
        )
    raw["date"] = pd.to_datetime(raw["date"], errors="raise").dt.date
    raw = raw.sort_values(["attraction_id", "date"]).reset_index(drop=True)
    if raw.duplicated(["attraction_id", "date"]).any():
        raise ValueError("Dataset không được có hai dòng cùng attraction_id và date.")
    if raw["date"].max() >= date.today():
        raise ValueError("Dataset chỉ được chứa ngày đã chốt, không gồm hôm nay hoặc tương lai.")

    attraction_columns = [
        "attraction_id",
        "tier",
        "city",
        "capacity",
        "avg_ticket_price",
        "rating",
        "num_reviews",
    ]
    attractions = raw[attraction_columns].drop_duplicates("attraction_id", keep="first")
    revenue = raw[["attraction_id", "date", "revenue", "tickets"]].copy()

    static_columns = [
        "tier",
        "city",
        "capacity",
        "avg_ticket_price",
        "rating",
        "num_reviews",
    ]
    inconsistent = (
        raw.groupby("attraction_id", dropna=False)[static_columns]
        .nunique(dropna=False)
        .gt(1)
    )
    if inconsistent.any().any():
        columns = sorted(inconsistent.columns[inconsistent.any()].tolist())
        raise ValueError(
            "Thông tin tĩnh của attraction thay đổi giữa các ngày: "
            + ", ".join(columns)
            + ". Hãy dùng snapshot catalog nhất quán trước khi train."
        )

    if attractions["attraction_id"].nunique() < 3:
        raise ValueError("Cần dữ liệu của ít nhất 3 điểm tham quan để train model dùng chung.")
    if revenue["date"].nunique() < 90:
        raise ValueError("Cần ít nhất 90 ngày lịch sử thực trước khi retrain.")
    if (
        (revenue["revenue"] < 0).any()
        or (revenue["tickets"] < 0).any()
        or (attractions["capacity"] <= 0).any()
        or (attractions["avg_ticket_price"] < 0).any()
        or (attractions["rating"] < 0).any()
        or (attractions["rating"] > 5).any()
    ):
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

    # ---- Model số vé: cùng feature, target khác ----
    X_train_tickets = tickets_feature_frame(train_df)
    X_test_tickets = tickets_feature_frame(test_df)
    y_train_tickets = train_df["target_tickets_log"].to_numpy()
    y_test_tickets_log = test_df["target_tickets_log"].to_numpy()
    y_test_tickets_actual = test_df["tickets"].to_numpy()

    model.fit_tickets(X_train_tickets, y_train_tickets)
    pred_tickets_log = model.predict_tickets_log(X_test_tickets)
    tickets_residual_std = (
        float(np.std(y_test_tickets_log - pred_tickets_log)) if len(y_test_tickets_log) else 0.3
    )
    pred_tickets_test = np.expm1(pred_tickets_log)
    tickets_mape = mape_on_observed_days(y_test_tickets_actual, pred_tickets_test)
    tickets_wape = wape(y_test_tickets_actual, pred_tickets_test)

    # Cách cũ để đối chứng: suy số vé từ doanh thu dự báo chia giá vé trung
    # bình. Con số này chỉ có ý nghĩa khi đặt cạnh model số vé.
    avg_price_test = test_df["avg_ticket_price"].to_numpy()
    derived_tickets = np.where(avg_price_test > 0, pred_revenue_test / np.maximum(avg_price_test, 1), 0)
    derived_tickets_wape = wape(y_test_tickets_actual, derived_tickets)

    # ---- Baseline: ai cũng làm được bằng một câu GROUP BY ----
    baseline_revenue = weekday_mean_baseline(train_df, test_df, "revenue")
    baseline_tickets = weekday_mean_baseline(train_df, test_df, "tickets")
    baseline_mape = mape_on_observed_days(y_test_actual, baseline_revenue)
    baseline_wape = wape(y_test_actual, baseline_revenue)
    baseline_mae = float(np.mean(np.abs(y_test_actual - baseline_revenue)))
    baseline_tickets_wape = wape(y_test_tickets_actual, baseline_tickets)

    model.city_freq_map = city_freq_map
    model.residual_std = max(residual_std, 0.05)
    model.tickets_residual_std = max(tickets_residual_std, 0.05)
    model.trained_at = datetime.now(timezone.utc)
    model.metrics = {
        "mape_observed_days": test_mape,
        "wape": test_wape,
        "mae": test_mae,
        "tickets_mape_observed_days": tickets_mape,
        "tickets_wape": tickets_wape,
        "tickets_wape_derived_from_revenue": derived_tickets_wape,
        # Baseline đi kèm model trong metadata để backend và giao diện luôn
        # trình bày hai con số cạnh nhau, không thể chỉ khoe con số đẹp.
        "baseline_method": "weekday_mean_per_attraction",
        "baseline_mape_observed_days": baseline_mape,
        "baseline_wape": baseline_wape,
        "baseline_mae": baseline_mae,
        "baseline_tickets_wape": baseline_tickets_wape,
        "beats_baseline_wape": bool(test_wape < baseline_wape),
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
        "tickets_wape": tickets_wape,
        "tickets_wape_derived_from_revenue": derived_tickets_wape,
        "baseline_mape": baseline_mape,
        "baseline_wape": baseline_wape,
        "baseline_mae": baseline_mae,
        "baseline_tickets_wape": baseline_tickets_wape,
        "beats_baseline_wape": bool(test_wape < baseline_wape),
        "notes": (
            f"Time-based split ({train_percent}/{100 - train_percent}), "
            f"train={len(train_df)} test={len(test_df)} rows."
        ),
    }


def main():
    # Console Windows mặc định là cp1252 và sẽ ném UnicodeEncodeError giữa lúc
    # in kết quả — model đã lưu xong nhưng người chạy chỉ thấy traceback.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="Train ensemble revenue forecast model")
    parser.add_argument("--model-dir", default="./models")
    parser.add_argument("--model-version", default="rf_xgb_ensemble_v1")
    parser.add_argument(
        "--training-source",
        choices=["real_booking_history", "demo_booking_history"],
        default="real_booking_history",
        help=(
            "Nguồn của CSV. Dùng demo_booking_history cho dữ liệu seed/mô phỏng; "
            "không được gắn nhãn dữ liệu demo là booking thật."
        ),
    )
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
        training_source = args.training_source
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
    verdict = "TỐT HƠN baseline" if result["beats_baseline_wape"] else "CHƯA tốt hơn baseline"
    print(f"Trained model {result['model_version']}")
    print("  Doanh thu:")
    print(f"    MAPE (ngày có doanh thu): {result['mape']:.2f}%   | baseline: {result['baseline_mape']:.2f}%")
    print(f"    WAPE (mọi ngày):          {result['wape']:.2f}%   | baseline: {result['baseline_wape']:.2f}%")
    print(f"    MAE:                      {result['mae']:,.0f} VND | baseline: {result['baseline_mae']:,.0f} VND")
    print("  Số vé:")
    print(f"    WAPE model số vé:              {result['tickets_wape']:.2f}%")
    print(f"    WAPE suy từ doanh thu (cũ):    {result['tickets_wape_derived_from_revenue']:.2f}%")
    print(f"    WAPE baseline:                 {result['baseline_tickets_wape']:.2f}%")
    print(f"  KẾT LUẬN: model {verdict} (so theo WAPE doanh thu).")
    print(f"  {result['notes']}")
    print(f"  Model saved to: {args.model_dir}")


if __name__ == "__main__":
    main()
