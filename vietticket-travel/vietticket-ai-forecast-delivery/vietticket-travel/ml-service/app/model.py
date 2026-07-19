"""
model.py
------------------------------------------------------------
Ensemble RandomForest + XGBoost cho bài toán regression dự báo doanh
thu/ngày theo attraction. Ensemble = trung bình cộng dự đoán (log1p
space) của 2 model — RF nắm tốt tương tác phi tuyến/threshold effect
(vd cuối tuần + lễ), XGBoost nắm tốt xu hướng trend/seasonality mượt
hơn nhờ boosting tuần tự; trung bình 2 model giúp giảm variance so với
dùng riêng lẻ.

Toàn bộ input feature engineering nằm ở features.py để đảm bảo
train/serving dùng chung 1 pipeline (tránh lệch train-serving).
"""

import json
import os
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from xgboost import XGBRegressor

from . import features as feat

MODEL_FILE = "ensemble_model.joblib"
METADATA_FILE = "metadata.json"

# Khoảng tin cậy ~80% (z-score một phía cho phân phối chuẩn)
CONFIDENCE_Z = 1.28


def default_city_freq_map(train_df: pd.DataFrame) -> Dict[str, float]:
    """Frequency encoding: city -> tỷ lệ xuất hiện trong tập train.
    Dùng frequency thay vì one-hot vì số lượng thành phố có thể mở rộng
    theo thời gian mà không cần train lại kiến trúc model."""
    freq = train_df["city"].value_counts(normalize=True).to_dict()
    return freq


class EnsembleForecastModel:
    def __init__(
        self,
        rf: Optional[RandomForestRegressor] = None,
        xgb: Optional[XGBRegressor] = None,
        city_freq_map: Optional[Dict[str, float]] = None,
        residual_std: float = 0.3,
        model_version: str = "rf_xgb_ensemble_v1",
        trained_at: Optional[datetime] = None,
        metrics: Optional[dict] = None,
    ):
        self.rf = rf
        self.xgb = xgb
        self.city_freq_map = city_freq_map or {}
        self.residual_std = residual_std
        self.model_version = model_version
        self.trained_at = trained_at or datetime.utcnow()
        self.metrics = metrics or {}

    # ---------- Training helpers ----------

    @staticmethod
    def new_untrained(model_version: str) -> "EnsembleForecastModel":
        rf = RandomForestRegressor(
            n_estimators=300,
            max_depth=8,
            min_samples_leaf=5,
            max_features=0.6,
            n_jobs=-1,
            random_state=42,
        )
        xgb = XGBRegressor(
            n_estimators=400,
            max_depth=5,
            learning_rate=0.03,
            subsample=0.8,
            colsample_bytree=0.8,
            reg_alpha=0.5,
            reg_lambda=1.0,
            random_state=42,
            n_jobs=-1,
        )
        return EnsembleForecastModel(rf=rf, xgb=xgb, model_version=model_version)

    def fit(self, X: pd.DataFrame, y_log: np.ndarray):
        self.rf.fit(X, y_log)
        self.xgb.fit(X, y_log)

    def predict_log(self, X: pd.DataFrame) -> np.ndarray:
        return (self.rf.predict(X) + self.xgb.predict(X)) / 2.0

    def predict_revenue(self, X: pd.DataFrame) -> np.ndarray:
        pred_log = self.predict_log(X)
        return np.clip(np.expm1(pred_log), 0, None)

    def city_encoded(self, city: str) -> float:
        # Thành phố chưa thấy trong tập train -> dùng trung vị tần suất
        # (giả định phổ biến trung bình, tránh model quá tự tin/thiếu tự tin).
        if city in self.city_freq_map:
            return self.city_freq_map[city]
        if self.city_freq_map:
            return float(np.median(list(self.city_freq_map.values())))
        return 0.1

    # ---------- Persistence ----------

    def save(self, model_dir: str):
        os.makedirs(model_dir, exist_ok=True)
        joblib.dump({"rf": self.rf, "xgb": self.xgb}, os.path.join(model_dir, MODEL_FILE))
        metadata = {
            "model_version": self.model_version,
            "trained_at": self.trained_at.isoformat(),
            "city_freq_map": self.city_freq_map,
            "residual_std": self.residual_std,
            "metrics": self.metrics,
        }
        with open(os.path.join(model_dir, METADATA_FILE), "w", encoding="utf-8") as f:
            json.dump(metadata, f, ensure_ascii=False, indent=2)

    @classmethod
    def load(cls, model_dir: str) -> "EnsembleForecastModel":
        models = joblib.load(os.path.join(model_dir, MODEL_FILE))
        with open(os.path.join(model_dir, METADATA_FILE), "r", encoding="utf-8") as f:
            metadata = json.load(f)
        return cls(
            rf=models["rf"],
            xgb=models["xgb"],
            city_freq_map=metadata.get("city_freq_map", {}),
            residual_std=metadata.get("residual_std", 0.3),
            model_version=metadata.get("model_version", "rf_xgb_ensemble_v1"),
            trained_at=datetime.fromisoformat(metadata["trained_at"]) if metadata.get("trained_at") else None,
            metrics=metadata.get("metrics", {}),
        )

    @staticmethod
    def exists(model_dir: str) -> bool:
        return os.path.exists(os.path.join(model_dir, MODEL_FILE)) and os.path.exists(
            os.path.join(model_dir, METADATA_FILE)
        )


@dataclass
class ForecastDayResult:
    date: date
    predicted_revenue: float
    predicted_bookings: int
    confidence_lower: float
    confidence_upper: float


def forecast_recursive(
    model: EnsembleForecastModel,
    attraction_id: str,
    tier: str,
    city: str,
    capacity: int,
    avg_ticket_price: float,
    rating: float,
    num_reviews: int,
    published_days_ago: int,
    history: List[dict],  # [{date, revenue, bookings}], sorted ascending
    forecast_days: int,
) -> List[ForecastDayResult]:
    """Dự báo N ngày tới theo kiểu recursive: dự đoán ngày t+1, thêm kết quả
    vào lịch sử để tính lag/rolling cho ngày t+2, v.v. Đây là cách tiêu chuẩn
    khi model không hỗ trợ multi-output trực tiếp cho time series có lag
    features phụ thuộc lẫn nhau.
    """
    history_dates = [h["date"] for h in history]
    history_revenue = [float(h["revenue"]) for h in history]

    last_date = history_dates[-1] if history_dates else date.today() - timedelta(days=1)
    city_enc = model.city_encoded(city)

    results: List[ForecastDayResult] = []
    working_revenue = list(history_revenue)
    working_published_days_ago = published_days_ago

    for step in range(1, forecast_days + 1):
        target_date = last_date + timedelta(days=step)
        row = feat.build_feature_row(
            target_date=target_date,
            history_revenue=working_revenue,
            tier=tier,
            city_encoded=city_enc,
            capacity=capacity,
            avg_ticket_price=avg_ticket_price,
            rating=rating,
            num_reviews=num_reviews,
            published_days_ago=working_published_days_ago + step,
        )
        X = feat.rows_to_dataframe([row])
        pred_log = model.predict_log(X)[0]
        pred_revenue = float(np.clip(np.expm1(pred_log), 0, None))

        # Khoảng tin cậy nới rộng dần theo sqrt(horizon) - dự báo càng xa
        # càng kém chắc chắn (chuẩn trong forecasting time series).
        widened_std = model.residual_std * np.sqrt(step)
        lower_log = pred_log - CONFIDENCE_Z * widened_std
        upper_log = pred_log + CONFIDENCE_Z * widened_std
        confidence_lower = float(np.clip(np.expm1(lower_log), 0, None))
        confidence_upper = float(np.clip(np.expm1(upper_log), 0, None))

        predicted_bookings = int(round(pred_revenue / avg_ticket_price)) if avg_ticket_price > 0 else 0

        results.append(
            ForecastDayResult(
                date=target_date,
                predicted_revenue=round(pred_revenue, 2),
                predicted_bookings=predicted_bookings,
                confidence_lower=round(confidence_lower, 2),
                confidence_upper=round(confidence_upper, 2),
            )
        )
        working_revenue.append(pred_revenue)

    return results
