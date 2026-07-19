"""
config.py
------------------------------------------------------------
Cấu hình tập trung cho ml-service, đọc từ biến môi trường (.env).
Dùng pydantic-settings để có validation + default rõ ràng.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    port: int = 8000
    ml_service_api_key: str = ""
    model_dir: str = "./models"
    model_version: str = "rf_xgb_ensemble_v1"


settings = Settings()
