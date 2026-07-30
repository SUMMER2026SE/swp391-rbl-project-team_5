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
import hashlib
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from hmac import compare_digest
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
        artifact_sha256: Optional[str] = None,
        artifact_integrity_verified: bool = False,
        rf_tickets: Optional[RandomForestRegressor] = None,
        xgb_tickets: Optional[XGBRegressor] = None,
        tickets_residual_std: float = 0.3,
    ):
        self.rf = rf
        self.xgb = xgb
        # Model thứ hai, cùng kiến trúc nhưng target là SỐ VÉ.
        #
        # Trước đây số vé được suy ra bằng phép chia predicted_revenue /
        # avg_ticket_price. Điều đó chỉ đúng khi mọi vé bán ra cùng một giá:
        # một điểm có vé người lớn 520k và vé trẻ em 360k thì thương số ấy
        # không phải số vé của ngày nào cả, và sai số của model doanh thu còn
        # bị khuếch đại thêm một lần nữa. Số vé lại chính là đại lượng mà tầng
        # giá động cần (để so với sức chứa), nên nó phải được dự báo trực tiếp.
        self.rf_tickets = rf_tickets
        self.xgb_tickets = xgb_tickets
        self.tickets_residual_std = tickets_residual_std
        self.city_freq_map = city_freq_map or {}
        self.residual_std = residual_std
        self.model_version = model_version
        self.trained_at = trained_at or datetime.now(timezone.utc)
        self.metrics = metrics or {}
        self.artifact_sha256 = artifact_sha256
        self.artifact_integrity_verified = artifact_integrity_verified

    @property
    def has_ticket_model(self) -> bool:
        return self.rf_tickets is not None and self.xgb_tickets is not None

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
        rf_tickets = RandomForestRegressor(
            n_estimators=300,
            max_depth=8,
            min_samples_leaf=5,
            max_features=0.6,
            n_jobs=-1,
            random_state=42,
        )
        xgb_tickets = XGBRegressor(
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
        return EnsembleForecastModel(
            rf=rf,
            xgb=xgb,
            rf_tickets=rf_tickets,
            xgb_tickets=xgb_tickets,
            model_version=model_version,
        )

    def fit(self, X: pd.DataFrame, y_log: np.ndarray):
        self.rf.fit(X, y_log)
        self.xgb.fit(X, y_log)

    def fit_tickets(self, X: pd.DataFrame, y_log: np.ndarray):
        self.rf_tickets.fit(X, y_log)
        self.xgb_tickets.fit(X, y_log)

    def predict_log(self, X: pd.DataFrame) -> np.ndarray:
        return (self.rf.predict(X) + self.xgb.predict(X)) / 2.0

    def predict_tickets_log(self, X: pd.DataFrame) -> np.ndarray:
        if not self.has_ticket_model:
            raise ValueError("Model chưa được huấn luyện cho target số vé.")
        return (self.rf_tickets.predict(X) + self.xgb_tickets.predict(X)) / 2.0

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
        model_path = os.path.join(model_dir, MODEL_FILE)
        joblib.dump(
            {
                "rf": self.rf,
                "xgb": self.xgb,
                "rf_tickets": self.rf_tickets,
                "xgb_tickets": self.xgb_tickets,
            },
            model_path,
        )
        with open(model_path, "rb") as artifact:
            artifact_sha256 = hashlib.sha256(artifact.read()).hexdigest()
        self.artifact_sha256 = artifact_sha256
        self.artifact_integrity_verified = True
        metadata = {
            "model_version": self.model_version,
            "trained_at": self.trained_at.isoformat(),
            "city_freq_map": self.city_freq_map,
            "residual_std": self.residual_std,
            "tickets_residual_std": self.tickets_residual_std,
            "metrics": self.metrics,
            "artifact_sha256": artifact_sha256,
        }
        with open(os.path.join(model_dir, METADATA_FILE), "w", encoding="utf-8") as f:
            json.dump(metadata, f, ensure_ascii=False, indent=2)

    @classmethod
    def load(cls, model_dir: str, require_integrity: bool = False) -> "EnsembleForecastModel":
        model_path = os.path.join(model_dir, MODEL_FILE)
        with open(os.path.join(model_dir, METADATA_FILE), "r", encoding="utf-8") as f:
            metadata = json.load(f)
        expected_sha256 = str(metadata.get("artifact_sha256", "")).strip().lower()
        artifact_integrity_verified = False
        if require_integrity and not expected_sha256:
            raise ValueError("Model artifact thiếu SHA-256 metadata.")
        if expected_sha256:
            with open(model_path, "rb") as artifact:
                actual_sha256 = hashlib.sha256(artifact.read()).hexdigest()
            if not compare_digest(actual_sha256, expected_sha256):
                raise ValueError("Model artifact hash không khớp metadata.")
            artifact_integrity_verified = True
        models = joblib.load(model_path)
        return cls(
            rf=models["rf"],
            xgb=models["xgb"],
            # Artifact cũ (chỉ có model doanh thu) vẫn nạp được: khi thiếu, lớp
            # serving tự quay về cách suy số vé từ doanh thu và nói rõ điều đó.
            rf_tickets=models.get("rf_tickets"),
            xgb_tickets=models.get("xgb_tickets"),
            tickets_residual_std=metadata.get("tickets_residual_std", 0.3),
            city_freq_map=metadata.get("city_freq_map", {}),
            residual_std=metadata.get("residual_std", 0.3),
            model_version=metadata.get("model_version", "rf_xgb_ensemble_v1"),
            trained_at=datetime.fromisoformat(metadata["trained_at"]) if metadata.get("trained_at") else None,
            metrics=metadata.get("metrics", {}),
            artifact_sha256=expected_sha256 or None,
            artifact_integrity_verified=artifact_integrity_verified,
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
    predicted_tickets: int
    confidence_lower: float
    confidence_upper: float
    # 'model' = số vé do model dự báo trực tiếp; 'derived_from_revenue' = suy
    # ra bằng phép chia cho giá vé trung bình (artifact cũ). Backend hiển thị
    # khác nhau cho hai trường hợp này.
    tickets_source: str = "model"


def forecast_recursive(
    model: EnsembleForecastModel,
    attraction_id: str,
    tier: str,
    city: str,
    capacity: int,
    avg_ticket_price: float,
    rating: float,
    num_reviews: int,
    history: List[dict],  # [{date, revenue, tickets}], sorted ascending
    forecast_days: int,
) -> List[ForecastDayResult]:
    """Dự báo N ngày tới theo kiểu recursive: dự đoán ngày t+1, thêm kết quả
    vào lịch sử để tính lag/rolling cho ngày t+2, v.v. Đây là cách tiêu chuẩn
    khi model không hỗ trợ multi-output trực tiếp cho time series có lag
    features phụ thuộc lẫn nhau.
    """
    history_dates = [h["date"] for h in history]
    history_revenue = [float(h["revenue"]) for h in history]
    history_tickets = [float(h.get("tickets") or 0.0) for h in history]

    last_date = history_dates[-1] if history_dates else date.today() - timedelta(days=1)
    city_enc = model.city_encoded(city)
    # Chỉ dự báo số vé trực tiếp khi vừa có model vừa có lịch sử số vé; nếu
    # phía gọi không gửi cột tickets thì lag/rolling toàn số 0 và kết quả sẽ vô
    # nghĩa — trường hợp đó phải quay về cách suy từ doanh thu.
    use_ticket_model = model.has_ticket_model and any(value > 0 for value in history_tickets)

    results: List[ForecastDayResult] = []
    working_revenue = list(history_revenue)
    working_tickets = list(history_tickets)

    static_features = dict(
        tier=tier,
        city_encoded=city_enc,
        capacity=capacity,
        avg_ticket_price=avg_ticket_price,
        rating=rating,
        num_reviews=num_reviews,
    )

    for step in range(1, forecast_days + 1):
        target_date = last_date + timedelta(days=step)
        row = feat.build_feature_row(
            target_date=target_date,
            history_values=working_revenue,
            **static_features,
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

        if use_ticket_model:
            ticket_row = feat.build_feature_row(
                target_date=target_date,
                history_values=working_tickets,
                **static_features,
            )
            pred_tickets_raw = float(
                np.clip(
                    np.expm1(model.predict_tickets_log(feat.rows_to_dataframe([ticket_row]))[0]),
                    0,
                    None,
                )
            )
            predicted_tickets = int(round(pred_tickets_raw))
            tickets_source = "model"
        else:
            pred_tickets_raw = pred_revenue / avg_ticket_price if avg_ticket_price > 0 else 0.0
            predicted_tickets = int(round(pred_tickets_raw))
            tickets_source = "derived_from_revenue"

        results.append(
            ForecastDayResult(
                date=target_date,
                predicted_revenue=round(pred_revenue, 2),
                predicted_tickets=predicted_tickets,
                confidence_lower=round(confidence_lower, 2),
                confidence_upper=round(confidence_upper, 2),
                tickets_source=tickets_source,
            )
        )
        working_revenue.append(pred_revenue)
        working_tickets.append(pred_tickets_raw)

    return results
