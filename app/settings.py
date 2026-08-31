"""환경 변수 전건 (docs/06-architecture-deployment.md §7).

ponytail: 스캐폴딩 편의를 위해 전 필드에 기본값을 둡니다(.env 없이도 `uv run pytest`,
`uvicorn app.main:app`이 뜰 수 있게). 실제 배포는 .env(.env.example 참고)로 덮어씁니다.
"""

from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgres://nutti:nutti@localhost:5432/nutti"
    jwt_signing_key: str = "dev-secret-change-me"
    jwt_expires_in: int = 3600
    # ponytail: 게스트 JWT는 30일 — 게스트 자산 보존(guest_expires_at)과 정렬 (07-decisions#Q7, 이슈 #5)
    jwt_guest_expires_in: int = 2592000
    jwt_refresh_expires_in: int = 2592000

    openai_api_key: str = ""
    openai_base_url: str | None = None
    openai_vision_model: str = "gpt-4o-mini"
    openai_image_model: str = "gpt-image-2"
    # ponytail: 비용 확정값(2026-08 medium ≈ $0.053/장). auto 로 두면 high 급 과금 위험.
    openai_image_quality: str = "medium"
    fal_key: str = ""
    # gpt-image-2 전면 채택(2026-08-18 사용자 확정) — 브랜드 텍스트(NUTTi 워드마크) 안정성 우선.
    fal_image_endpoint: str = "openai/gpt-image-2/edit"

    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket_name: str = ""
    r2_endpoint_url: str = ""
    cdn_base_url: str = ""

    cafe24_client_id: str = ""
    cafe24_client_secret: str = ""
    cafe24_mall_id: str = ""
    cafe24_redirect_uri: str = ""
    cafe24_scope: str = "mall.read_customer,mall.read_order"

    kakao_rest_api_key: str = ""
    kakao_redirect_uri: str = ""
    kakao_client_secret: str = ""
    naver_client_id: str = ""
    naver_client_secret: str = ""
    naver_redirect_uri: str = ""

    admin_alert_slack_webhook_url: str = ""
    sentry_dsn: str = ""
    ga4_measurement_id: str = ""

    backup_r2_bucket_name: str = ""

    app_env: str = "staging"
    trust_proxy: bool = False
    guest_rate_limit_per_hour: int = 30
    cors_allowed_origins: str = ""
    log_level: str = "INFO"

    @model_validator(mode="after")
    def validate_jwt_signing_key(self) -> "Settings":
        if not self.jwt_signing_key or (
            self.app_env != "development"
            and (self.jwt_signing_key == "dev-secret-change-me" or len(self.jwt_signing_key) < 32)
        ):
            raise ValueError("JWT_SIGNING_KEY must be changed and contain at least 32 characters")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

TORTOISE_ORM = {
    "connections": {"default": settings.database_url},
    "apps": {
        "models": {
            "models": ["app.models", "aerich.models"],
            "default_connection": "default",
        }
    },
}
