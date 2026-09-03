from tortoise.backends.base.executor import EXECUTOR_CACHE


def reset_tortoise_executor_cache() -> None:
    EXECUTOR_CACHE.clear()


import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _monitor_off(monkeypatch: pytest.MonkeyPatch):
    # 운영 감시 루프(app/monitor.py)는 lifespan 에서 뜬다 — 테스트 앱마다 백그라운드 태스크가 남지 않게 끈다.
    # settings 는 여기서 늦게 임포트한다: 테스트 모듈이 모듈 상단에서 환경변수(DATABASE_URL 등)를 먼저 세팅한다.
    from app.settings import settings

    monkeypatch.setattr(settings, "monitor_enabled", False)
