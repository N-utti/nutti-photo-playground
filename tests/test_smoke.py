"""유일한 검증 게이트: 13개 모델 스키마 생성 + /healthz 200 + 라우터 등록 확인.

sqlite in-memory로 Tortoise를 초기화해 실제 Postgres 없이도 스키마 생성이 가능한지 검증한다.
"""

import os

os.environ.setdefault("DATABASE_URL", "sqlite://:memory:")

from fastapi.testclient import TestClient
from tortoise import Tortoise

from app.main import app

EXPECTED_MODEL_COUNT = 13
EXPECTED_ROUTER_TAGS = {
    "auth",
    "styles",
    "uploads",
    "pets",
    "jobs",
    "results",
    "library",
    "credits",
    "events",
    "admin",
}


async def test_all_13_models_create_schema_on_sqlite():
    await Tortoise.init(db_url="sqlite://:memory:", modules={"models": ["app.models"]})
    try:
        await Tortoise.generate_schemas()
        model_count = len(Tortoise.apps["models"])
        assert model_count == EXPECTED_MODEL_COUNT
    finally:
        await Tortoise.close_connections()


def test_healthz_ok():
    with TestClient(app) as client:
        resp = client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_all_resource_routers_registered():
    # ponytail: app.routes doesn't flatten include_router()'d routes in this FastAPI
    # version (they show up as opaque _IncludedRouter entries) — app.openapi() resolves
    # the real path/tag list the same way FastAPI does internally, so use that instead.
    schema = app.openapi()
    tags = {tag for methods in schema["paths"].values() for op in methods.values() for tag in op.get("tags", [])}
    assert EXPECTED_ROUTER_TAGS <= tags
    assert "/v1/auth/guest" in schema["paths"]
    assert "/v1/admin/settings" in schema["paths"]


def test_error_format_on_404():
    with TestClient(app) as client:
        resp = client.get("/v1/does-not-exist")
    assert resp.status_code == 404
    assert "error" in resp.json()
    assert "code" in resp.json()["error"]
