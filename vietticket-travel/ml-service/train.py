"""
train.py — Train RF + XGBoost ensemble cho VietTicket Revenue Forecast (v2)

Thay đổi so với bản Colab cũ (để xử lý phản hồi "parameter có vẻ bias"):

1. TIME-BASED SPLIT thay vì random split:
   Với mỗi attraction, 15% ngày CUỐI CÙNG (theo thời gian) được dùng làm
   validation. Random split cũ có nguy cơ leak thông tin tương lai vào train
   (vd rolling_mean của ngày trước đó trong cùng chuỗi), khiến MAE nhìn đẹp
   giả tạo.

2. HYPERPARAMETER GRID được giới hạn để tránh overfit:
   - RF: min_samples_leaf >= 3 (bản cũ =1 -> cây học thuộc lòng)
   - XGB: max_depth <= 6, colsample_bytree < 1.0 (ép model không dồn hết
     trọng số vào 1 feature như min_ticket_price ở bản cũ)

3. CẢNH BÁO TỰ ĐỘNG nếu 1 feature chiếm > 40% importance của bất kỳ model
   nào — in cảnh báo ra console để biết ngay nếu dataset lại bị lệch.

4. Lưu residual_std vào metadata.json để ml-service tính confidence interval
   nhất quán (thay vì hard-code hệ số ở nơi khác).
"""

import argparse
import json
import os
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_absolute_percentage_error
from sklearn.model_selection import RandomizedSearchCV, TimeSeriesSplit
from xgboost import XGBRegressor

TOP_CITIES = ["Hà Nội", "Hồ Chí Minh", "Đà Nẵng", "Phú Quốc", "Đà Lạt", "Hội An", "Nha Trang", "Huế"]
TIERS = ["BASIC", "STANDARD", "PREMIUM"]

FEATURE_COLUMNS_BASE = [
    "default_capacity", "min_ticket_price", "avg_rating", "review_count",
    "day_of_week", "is_weekend", "is_holiday", "day_of_year", "month",
    "lag_1d", "lag_7d", "rolling_mean_7d", "rolling_mean_30d", "rolling_std_7d",
]


def add_time_series_features(df):
    df = df.sort_values(["attractionId", "date"]).copy()
    grp = df.groupby("attractionId")["revenue"]
    df["lag_1d"] = grp.shift(1)
    df["lag_7d"] = grp.shift(7)
    df["rolling_mean_7d"] = grp.transform(lambda s: s.shift(1).rolling(7, min_periods=1).mean())
    df["rolling_mean_30d"] = grp.transform(lambda s: s.shift(1).rolling(30, min_periods=1).mean())
    df["rolling_std_7d"] = grp.transform(lambda s: s.shift(1).rolling(7, min_periods=2).std())
    return df


def one_hot(df):
    for c in TOP_CITIES:
        df[f"city_{c}"] = (df["city"] == c).astype(int)
    for t in TIERS:
        df[f"tier_{t}"] = (df["tier"] == t).astype(int)
    return df


def time_based_split(df, val_fraction=0.15):
    train_parts, val_parts = [], []
    for _, g in df.groupby("attractionId"):
        g = g.sort_values("date")
        cut = int(len(g) * (1 - val_fraction))
        train_parts.append(g.iloc[:cut])
        val_parts.append(g.iloc[cut:])
    return pd.concat(train_parts), pd.concat(val_parts)


def build_feature_matrix(df, feature_columns):
    return df[feature_columns].fillna(0.0)


def check_feature_dominance(model, feature_columns, model_name, threshold=0.4):
    importances = model.feature_importances_
    top_idx = int(np.argmax(importances))
    top_val = importances[top_idx]
    if top_val > threshold:
        print(f"[CẢNH BÁO] {model_name}: feature '{feature_columns[top_idx]}' chiếm "
              f"{top_val:.0%} importance (> {threshold:.0%}). Cân nhắc tăng regularization "
              f"hoặc kiểm tra lại dataset có bị lệch không.")
    else:
        print(f"[OK] {model_name}: importance dàn trải, feature cao nhất "
              f"'{feature_columns[top_idx]}' = {top_val:.0%}")


def train(data_path, version, models_dir):
    df = pd.read_csv(data_path, parse_dates=["date"])
    df = add_time_series_features(df)
    df = one_hot(df)

    feature_columns = FEATURE_COLUMNS_BASE + [f"city_{c}" for c in TOP_CITIES] + [f"tier_{t}" for t in TIERS]

    train_df, val_df = time_based_split(df)
    X_train = build_feature_matrix(train_df, feature_columns)
    y_train = train_df["revenue"].values
    X_val = build_feature_matrix(val_df, feature_columns)
    y_val = val_df["revenue"].values

    tscv = TimeSeriesSplit(n_splits=3)

    print("== Training RandomForest (regularized) ==")
    rf_grid = {
        "n_estimators": [200, 300, 400],
        "max_depth": [8, 12, 16],
        "min_samples_split": [4, 8, 12],
        "min_samples_leaf": [3, 5, 8],
        "max_features": ["sqrt", 0.6],
    }
    rf_search = RandomizedSearchCV(
        RandomForestRegressor(random_state=42, n_jobs=-1),
        rf_grid, n_iter=15, cv=tscv, scoring="neg_mean_absolute_error", random_state=42, n_jobs=-1,
    )
    rf_search.fit(X_train, y_train)
    rf_model = rf_search.best_estimator_

    print("== Training XGBoost (regularized) ==")
    xgb_grid = {
        "n_estimators": [200, 300],
        "max_depth": [3, 4, 5, 6],
        "reg_lambda": [1.0, 2.0, 5.0],
        "subsample": [0.7, 0.85, 1.0],
        "colsample_bytree": [0.5, 0.7, 0.9],
        "learning_rate": [0.03, 0.05, 0.1],
    }
    xgb_search = RandomizedSearchCV(
        XGBRegressor(random_state=42, n_jobs=-1, tree_method="hist"),
        xgb_grid, n_iter=15, cv=tscv, scoring="neg_mean_absolute_error", random_state=42, n_jobs=-1,
    )
    xgb_search.fit(X_train, y_train)
    xgb_model = xgb_search.best_estimator_

    check_feature_dominance(rf_model, feature_columns, "RandomForest")
    check_feature_dominance(xgb_model, feature_columns, "XGBoost")

    rf_pred_val = rf_model.predict(X_val)
    xgb_pred_val = xgb_model.predict(X_val)

    print("== Tìm trọng số ensemble tối ưu trên validation (time-based holdout) ==")
    best_w, best_mae = 0.5, float("inf")
    for w in np.arange(0.0, 1.01, 0.05):
        pred = w * rf_pred_val + (1 - w) * xgb_pred_val
        mae = mean_absolute_error(y_val, pred)
        if mae < best_mae:
            best_mae, best_w = mae, w

    ensemble_pred = best_w * rf_pred_val + (1 - best_w) * xgb_pred_val
    mae_rf = mean_absolute_error(y_val, rf_pred_val)
    mae_xgb = mean_absolute_error(y_val, xgb_pred_val)
    mae_ens = mean_absolute_error(y_val, ensemble_pred)
    mape_ens = mean_absolute_percentage_error(y_val[y_val > 0], ensemble_pred[y_val > 0])
    residual_std = float(np.std(y_val - ensemble_pred))

    print("=" * 60)
    print("  VietTicket Revenue Forecast — Kết quả pipeline (v2, time-based split)")
    print("=" * 60)
    print(f"  Trọng số ensemble : RF={best_w:.2f}, XGB={1 - best_w:.2f}")
    print(f"  MAE  (RF đơn lẻ)  : {mae_rf:,.0f} đ")
    print(f"  MAE  (XGB đơn lẻ) : {mae_xgb:,.0f} đ")
    print(f"  MAE  (Ensemble)   : {mae_ens:,.0f} đ")
    print(f"  MAPE (Ensemble)   : {mape_ens:.2%}")
    print(f"  Residual std      : {residual_std:,.0f} đ (dùng để tính confidence interval)")
    print("-" * 60)
    print(f"  RF best params : {rf_search.best_params_}")
    print(f"  XGB best params: {xgb_search.best_params_}")
    print("=" * 60)

    os.makedirs(models_dir, exist_ok=True)
    joblib.dump(rf_model, os.path.join(models_dir, "rf_model.pkl"))
    joblib.dump(xgb_model, os.path.join(models_dir, "xgb_model.pkl"))

    metadata = {
        "version": version,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "feature_columns": feature_columns,
        "top_cities": TOP_CITIES,
        "tiers": TIERS,
        "ensemble_weight_rf": best_w,
        "metrics": {
            "mae_rf": mae_rf, "mae_xgb": mae_xgb, "mae_ensemble": mae_ens,
            "mape_ensemble": mape_ens, "residual_std": residual_std,
        },
        "rf_best_params": rf_search.best_params_,
        "xgb_best_params": xgb_search.best_params_,
        "split_method": "time_based_per_attraction_15pct_holdout",
    }
    with open(os.path.join(models_dir, "metadata.json"), "w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)

    print(f"Đã lưu model + metadata.json vào {models_dir}/")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=str, default="data/booking_history.csv")
    parser.add_argument("--version", type=str, default="v1")
    parser.add_argument("--models-dir", type=str, default="models")
    args = parser.parse_args()
    train(args.data, args.version, args.models_dir)
