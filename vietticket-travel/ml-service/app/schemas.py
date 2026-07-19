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
from typing import List, Literal, Optional

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
