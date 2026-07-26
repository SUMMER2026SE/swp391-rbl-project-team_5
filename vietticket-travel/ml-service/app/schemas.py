"""
schemas.py
------------------------------------------------------------
Pydantic models cho request/response của ml-service.

Thiết kế: ml-service KHÔNG có quyền truy cập trực tiếp PostgreSQL của
Node backend (tách biệt service, dễ triển khai/scale riêng). Vì vậy
Node backend (forecastService.js) chịu trách nhiệm tổng hợp lịch sử
doanh thu theo ngày cho từng attraction rồi gửi kèm trong request.
ml-service chỉ làm feature engineering + inference/training thuần túy.
"""

from datetime import date, datetime
from typing import Any, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

Tier = Literal["BUDGET", "STANDARD", "PREMIUM", "LUXURY"]


class HistoryPoint(BaseModel):
    date: date
    revenue: float = Field(ge=0)
    tickets: int = Field(ge=0, default=0)


class ForecastRequest(BaseModel):
    attraction_id: str
    tier: Tier = "STANDARD"
    city: str = "Khác"
    capacity: int = Field(gt=0, default=100)
    avg_ticket_price: float = Field(ge=0, default=0)
    rating: float = Field(ge=0, le=5, default=0)
    num_reviews: int = Field(ge=0, default=0)
    # Lịch sử doanh thu theo ngày, SẮP XẾP TĂNG DẦN theo date.
    # Nên cung cấp tối thiểu ~35 ngày gần nhất để tính đủ lag/rolling features;
    # nếu ít hơn, model vẫn chạy được nhưng độ chính xác sẽ thấp hơn.
    history: List[HistoryPoint] = Field(default_factory=list)
    forecast_days: int = Field(ge=1, le=90, default=7)


class ForecastPoint(BaseModel):
    date: date
    predicted_revenue: float
    predicted_tickets: int
    confidence_lower: float
    confidence_upper: float


class ForecastResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    attraction_id: str
    model_version: str
    training_source: str
    generated_at: datetime
    forecast: List[ForecastPoint]
    warning: Optional[str] = None


class HealthResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    status: str
    model_loaded: bool
    model_version: Optional[str] = None
    training_source: Optional[str] = None
    trained_at: Optional[datetime] = None


class LiveObservation(BaseModel):
    timestamp: datetime
    data_source: str = Field(default="LIVE_OPERATIONAL", max_length=80)
    capacity: int = Field(ge=0, default=0)
    booked_guests: int = Field(ge=0, default=0)
    held_guests: int = Field(ge=0, default=0)
    queue_guests: int = Field(ge=0, default=0)
    checkins_last_15m: int = Field(ge=0, default=0)
    pressure_score: int = Field(ge=0, le=100, default=0)
    show_rate: float = Field(ge=0, le=1, default=0.9)
    actual_arrivals_next_15m: Optional[int] = Field(default=None, ge=0)


class LivePredictionRequest(BaseModel):
    attraction_id: str = Field(min_length=1, max_length=120)
    observations: List[LiveObservation] = Field(default_factory=list, max_length=2000)
    current: LiveObservation
    horizon_minutes: int = Field(ge=5, le=60, default=15)


class LivePredictionResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    attraction_id: str
    prediction_type: str
    horizon_minutes: int
    predicted_p50: float
    predicted_p90: float
    confidence: str
    model_version: str
    training_source: str
    used_fallback: bool
    feature_contributions: dict[str, float] = Field(default_factory=dict)
    metrics: dict[str, Any] = Field(default_factory=dict)
    generated_at: datetime


class WaitPredictionRequest(LivePredictionRequest):
    guests_ahead: int = Field(ge=0, le=10000, default=0)
    party_size: int = Field(ge=1, le=100, default=1)


class WaitPredictionResponse(LivePredictionResponse):
    prediction_type: str = "WAIT_TIME"


class OptimizerItem(BaseModel):
    id: str = Field(min_length=1, max_length=120)
    day_index: int = Field(ge=0, le=13, default=0)
    start_minute: int = Field(ge=0, le=24 * 60)
    end_minute: int = Field(ge=1, le=24 * 60)
    locked: bool = False
    risk_score: float = Field(ge=0, le=100, default=0)
    flexibility_minutes: int = Field(ge=0, le=180, default=30)
    priority: int = Field(ge=0, le=100, default=50)


class OptimizeRequest(BaseModel):
    live_trip_id: str = Field(min_length=1, max_length=120)
    items: List[OptimizerItem] = Field(min_length=1, max_length=30)
    max_shift_minutes: int = Field(ge=0, le=180, default=45)
    travel_buffer_minutes: int = Field(ge=0, le=180, default=30)
    timezone: str = Field(default="Asia/Ho_Chi_Minh", max_length=80)


class OptimizeResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    live_trip_id: str
    algorithm_version: str
    baseline_score: float
    optimized_score: float
    predicted_minutes_saved: int
    total_shift_minutes: int
    protected_booking_count: int
    proposals: List[dict[str, Any]]
    constraints: dict[str, Any]
    generated_at: datetime
