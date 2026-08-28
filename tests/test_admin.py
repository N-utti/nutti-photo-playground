import os
import uuid

os.environ.setdefault("DATABASE_URL", "sqlite://:memory:")
os.environ.setdefault("APP_ENV", "development")

import pytest
from fastapi.testclient import TestClient
from tortoise import Tortoise

from app.auth import create_admin_token, create_token, hash_password
from app.main import app
from app.models import (
    AdminUser,
    GenerationJob,
    Member,
    MemberKind,
    MetricEvent,
    SourceImage,
    Style,
    StyleStatus,
)
from app.routers import admin as admin_router
from app.routers import auth as auth_router


@pytest.fixture
def client():
    for buckets in (
        auth_router._guest_requests,
        auth_router._login_requests,
        auth_router._register_requests,
        admin_router._admin_login_requests,
    ):
        buckets.clear()
    with TestClient(app) as test_client:
        test_client.portal.call(Tortoise.generate_schemas)
        yield test_client


async def _create_member(kind: MemberKind) -> str:
    return str((await Member.create(kind=kind)).id)


def _session(
    client: TestClient, kind: MemberKind = MemberKind.MEMBER
) -> tuple[str, dict[str, str]]:
    member_id = client.portal.call(_create_member, kind)
    token = create_token(uuid.UUID(member_id), kind.value, 0)
    return member_id, {"Authorization": f"Bearer {token}"}


async def _create_job(member_id: str, style_id: int | None = None) -> str:
    source = await SourceImage.create(
        member_id=member_id,
        storage_key=f"uploads/{uuid.uuid4()}.jpg",
        quality_check={},
    )
    job = await GenerationJob.create(
        member_id=member_id,
        source_image=source,
        style_id=style_id,
        idempotency_key=uuid.uuid4(),
        credit_cost=1,
    )
    return str(job.id)


async def _create_admin(email: str = "admin@nutti.test", password: str = "secret") -> int:
    admin = await AdminUser.create(email=email, password_hash=hash_password(password))
    return admin.id


def _admin_headers(client: TestClient) -> dict[str, str]:
    admin_id = client.portal.call(_create_admin)
    return {"Authorization": f"Bearer {create_admin_token(admin_id)}"}


def test_admin_login_success(client: TestClient):
    admin_id = client.portal.call(_create_admin)

    response = client.post(
        "/v1/admin/login",
        json={"email": "admin@nutti.test", "password": "secret"},
    )

    assert response.status_code == 200
    assert response.json()["admin_id"] == admin_id
    assert response.json()["email"] == "admin@nutti.test"
    assert isinstance(response.json()["token"], str)


@pytest.mark.parametrize(
    ("email", "password"),
    [
        ("admin@nutti.test", "wrong"),
        ("missing@nutti.test", "secret"),
    ],
)
def test_admin_login_rejects_invalid_credentials(
    client: TestClient, email: str, password: str
):
    client.portal.call(_create_admin)

    response = client.post(
        "/v1/admin/login", json={"email": email, "password": password}
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_admin_styles_requires_admin_token(client: TestClient):
    without_token = client.get("/v1/admin/styles")
    _, member_headers = _session(client)
    with_member_token = client.get("/v1/admin/styles", headers=member_headers)
    with_admin_token = client.get("/v1/admin/styles", headers=_admin_headers(client))

    assert without_token.status_code == 401
    assert with_member_token.status_code == 401
    assert with_admin_token.status_code == 200


def test_admin_token_cannot_access_member_endpoint(client: TestClient):
    response = client.get("/v1/credits", headers=_admin_headers(client))

    assert response.status_code == 401


async def _create_styles() -> tuple[int, int]:
    style_a = await Style.create(
        id=1,
        code="admin-a",
        name="Admin A",
        section="admin-test",
        status=StyleStatus.DRAFT,
        sort_order=1,
    )
    style_b = await Style.create(
        id=2,
        code="admin-b",
        name="Admin B",
        section="admin-test",
        status=StyleStatus.PUBLIC,
        sort_order=2,
    )
    return style_a.id, style_b.id


async def _create_events(member_id: str, style_id: int):
    for event_type in (
        "result_view",
        "result_view",
        "share_click",
        "shop_exit_click",
    ):
        await MetricEvent.create(
            event_type=event_type,
            member_id=member_id,
            style_id=style_id,
        )


def test_admin_styles_returns_ordered_aggregates(client: TestClient):
    member_id, _ = _session(client)
    style_a_id, style_b_id = client.portal.call(_create_styles)
    client.portal.call(_create_job, member_id, style_a_id)
    client.portal.call(_create_job, member_id, style_a_id)
    client.portal.call(_create_job, member_id, style_b_id)
    client.portal.call(_create_events, member_id, style_a_id)

    response = client.get("/v1/admin/styles", headers=_admin_headers(client))

    assert response.status_code == 200
    items = response.json()["items"]
    assert [item["id"] for item in items] == [style_a_id, style_b_id]
    assert items[0]["status"] == "draft"
    assert items[0]["selection_rate"] == 0.667
    assert items[0]["share_rate"] == 0.5
    assert items[0]["shop_click_rate"] == 0.5
    assert items[1]["selection_rate"] == 0.333
    assert items[1]["share_rate"] == 0.0
    assert items[1]["shop_click_rate"] == 0.0


def test_admin_login_locks_email_after_failures_and_normalizes_case(client: TestClient):
    client.portal.call(_create_admin)
    for _ in range(5):
        response = client.post(
            "/v1/admin/login", json={"email": " Admin@Nutti.Test ", "password": "wrong"}
        )
        assert response.status_code == 401

    response = client.post(
        "/v1/admin/login", json={"email": "admin@nutti.test", "password": "secret"}
    )

    assert response.status_code == 429
    assert response.json()["error"]["code"] == "RATE_LIMITED"
