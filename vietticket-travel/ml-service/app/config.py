"""
config.py
------------------------------------------------------------
Cấu hình tập trung cho ml-service, đọc từ biến môi trường (.env).
Dùng pydantic-settings để có validation + default rõ ràng.
"""

from typing import Literal
from os import getenv

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore",
        protected_namespaces=("settings_",),
    )

    environment: Literal["development", "test", "production"] = Field(
        default_factory=lambda: getenv("ENVIRONMENT")
        or getenv("NODE_ENV")
        or "development",
    )
    port: int = 8000
    ml_service_api_key: str = Field(default="", max_length=512)
    model_dir: str = "./models"
    model_version: str = "rf_xgb_ensemble_v1"


settings = Settings()
