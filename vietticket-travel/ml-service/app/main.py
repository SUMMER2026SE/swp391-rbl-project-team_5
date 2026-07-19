"""
main.py
------------------------------------------------------------
FastAPI app cho ml-service (AI Revenue Forecasting).

Endpoints:
  GET  /health   - kiểm tra model đã load chưa (dùng cho readiness probe)
  POST /forecast - dự báo doanh thu N ngày tới cho 1 attraction

Node backend (forecastService.js) là caller duy nhất trong kiến trúc
hiện tại - service này KHÔNG public trực tiếp ra internet.

Training không chạy trong HTTP request vì có thể kéo dài nhiều phút và thay
model đang phục vụ giữa chừng. Quản trị viên export dữ liệu thực rồi chạy
`python -m app.train --data ...`; model mới chỉ được nạp sau khi service restart.
"""

from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, Header, HTTPException

from .config import settings
from .model import EnsembleForecastModel, forecast_recursive
from .schemas import (
    ForecastRequest,
    ForecastResponse,
    HealthResponse,
)

_model: EnsembleForecastModel | None = None


def _load_model_if_available():
    global _model
    if EnsembleForecastModel.exists(settings.model_dir):
        try:
            _model = EnsembleForecastModel.load(settings.model_dir)
        except Exception as exc:  # noqa: BLE001 - log và tiếp tục chạy không model
            print(f"[ml-service] Không load được model có sẵn: {exc}")
            _model = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _load_model_if_available()
    yield


app = FastAPI(
    title="VietTicket Travel — AI Revenue Forecasting Service",
    version="1.0.0",
    description="Ensemble RandomForest + XGBoost cho dự báo doanh thu theo điểm tham quan.",
    lifespan=lifespan,
)


def require_api_key(x_ml_api_key: str = Header(default="")):
    if settings.ml_service_api_key and x_ml_api_key != settings.ml_service_api_key:
        raise HTTPException(status_code=401, detail="x-ml-api-key không hợp lệ.")
    return True


@app.get("/health", response_model=HealthResponse)
def health():
    return HealthResponse(
        status="ok",
        model_loaded=_model is not None,
        model_version=_model.model_version if _model else None,
        training_source=(
            str(_model.metrics.get("training_source", "unknown"))
            if _model
            else None
        ),
        trained_at=_model.trained_at if _model else None,
    )


@app.post("/forecast", response_model=ForecastResponse)
def forecast(payload: ForecastRequest, _auth: bool = Depends(require_api_key)):
    global _model
    if _model is None:
        raise HTTPException(
            status_code=503,
            detail="Model chưa được train. Hãy chạy CLI `python -m app.train` rồi khởi động lại service.",
        )

    warning = None
    if len(payload.history) < 14:
        warning = (
            "Lịch sử doanh thu cung cấp ít hơn 14 ngày — độ chính xác dự báo có thể thấp hơn bình thường."
        )

    history = [{"date": h.date, "revenue": h.revenue, "tickets": h.tickets} for h in payload.history]

    results = forecast_recursive(
        model=_model,
        attraction_id=payload.attraction_id,
        tier=payload.tier,
        city=payload.city,
        capacity=payload.capacity,
        avg_ticket_price=payload.avg_ticket_price,
        rating=payload.rating,
        num_reviews=payload.num_reviews,
        published_days_ago=payload.published_days_ago,
        history=history,
        forecast_days=payload.forecast_days,
    )

    return ForecastResponse(
        attraction_id=payload.attraction_id,
        model_version=_model.model_version,
        training_source=str(_model.metrics.get("training_source", "unknown")),
        generated_at=datetime.now(timezone.utc),
        forecast=[
            {
                "date": r.date,
                "predicted_revenue": r.predicted_revenue,
                "predicted_tickets": r.predicted_tickets,
                "confidence_lower": r.confidence_lower,
                "confidence_upper": r.confidence_upper,
            }
            for r in results
        ],
        warning=warning,
    )
