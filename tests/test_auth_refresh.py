import hashlib
import os
import time
from collections import deque
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

os.environ.setdefault("DATABASE_URL", "sqlite://:memory:")
os.environ.setdefault("APP_ENV", "development")

import pytest
from fastapi.testclient import TestClient
from tortoise import Tortoise

from app.main import app
from app.models import Member
from app.routers import auth as auth_router


@pytest.fixture
def client():
    for buckets in (
        auth_router._guest_requests,
        auth_router._login_requests,
        auth_router._register_requests,
        auth_router._refresh_requests,
    ):
        buckets.clear()
    with TestClient(app) as test_client:
        test_client.portal.call(Tortoise.generate_schemas)
        yield test_client


def _guest(client: TestClient) -> dict:
    response = client.post("/v1/auth/guest")
    assert response.status_code == 201
    return response.json()


def _register(client: TestClient, email: str = "member@example.com") -> dict:
    guest = _guest(client)
    response = client.post(
        "/v1/auth/register",
        headers={"Authorization": f"Bearer {guest['token']}"},
        json={"email": email, "password": "password-123"},
    )
    assert response.status_code == 201
    return response.json()


async def _refresh_fields(member_id: str) -> tuple[str | None, datetime | None]:
    member = await Member.get(id=member_id)
    return member.refresh_token_hash, member.refresh_expires_at


async def _expire_refresh(member_id: str) -> None:
    member = await Member.get(id=member_id)
    member.refresh_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    await member.save(update_fields=["refresh_expires_at"])


def _social_session(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, provider: str
) -> dict:
    guest = _guest(client)
    authorize = client.get(
        f"/v1/auth/{provider}/authorize",
        headers={"Authorization": f"Bearer {guest['token']}"},
    )
    state = parse_qs(urlparse(authorize.json()["authorize_url"]).query)["state"][0]

    if provider == "kakao":
        async def exchange(code: str) -> dict:
            return {"access_token": "access"}

        async def fetch(access_token: str) -> dict:
            return {"id": 123}

        monkeypatch.setattr(auth_router, "_exchange_kakao_code", exchange)
        monkeypatch.setattr(auth_router, "_fetch_kakao_member", fetch)
    else:
        async def exchange(code: str, callback_state: str) -> dict:
            return {"access_token": "access"}

        async def fetch(access_token: str) -> dict:
            return {"response": {"id": "naver-123"}}

        monkeypatch.setattr(auth_router, "_exchange_naver_code", exchange)
        monkeypatch.setattr(auth_router, "_fetch_naver_member", fetch)

    response = client.get(
        f"/v1/auth/{provider}/callback",
        params={"code": "code", "state": state},
    )
    assert response.status_code == 200
    return response.json()


@pytest.mark.parametrize("source", ["register", "login", "kakao", "naver"])
def test_member_session_responses_include_refresh_token(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, source: str
):
    if source == "register":
        session = _register(client)
    elif source == "login":
        _register(client)
        guest = _guest(client)
        response = client.post(
            "/v1/auth/login",
            headers={"Authorization": f"Bearer {guest['token']}"},
            json={"email": "member@example.com", "password": "password-123"},
        )
        assert response.status_code == 200
        session = response.json()
    else:
        session = _social_session(client, monkeypatch, source)

    refresh_hash, refresh_expires_at = client.portal.call(
        _refresh_fields, session["member_id"]
    )
    assert session["refresh_token"]
    assert refresh_hash == hashlib.sha256(session["refresh_token"].encode()).hexdigest()
    assert refresh_expires_at is not None


def test_refresh_rotates_token_and_new_access_token_works(client: TestClient):
    session = _register(client)

    response = client.post(
        "/v1/auth/refresh",
        json={"refresh_token": session["refresh_token"]},
    )

    assert response.status_code == 200
    refreshed = response.json()
    assert set(refreshed) == {"token", "refresh_token"}
    assert refreshed["refresh_token"] != session["refresh_token"]
    assert client.get(
        "/v1/auth/me",
        headers={"Authorization": f"Bearer {refreshed['token']}"},
    ).status_code == 200
    replay = client.post(
        "/v1/auth/refresh",
        json={"refresh_token": session["refresh_token"]},
    )
    assert replay.status_code == 401
    assert replay.json()["error"]["code"] == "UNAUTHORIZED"


def test_expired_refresh_token_is_rejected(client: TestClient):
    session = _register(client)
    client.portal.call(_expire_refresh, session["member_id"])

    response = client.post(
        "/v1/auth/refresh",
        json={"refresh_token": session["refresh_token"]},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"


def test_logout_revokes_member_refresh_token(client: TestClient):
    session = _register(client)

    logout = client.post(
        "/v1/auth/logout",
        headers={"Authorization": f"Bearer {session['token']}"},
    )
    refresh = client.post(
        "/v1/auth/refresh",
        json={"refresh_token": session["refresh_token"]},
    )

    assert logout.status_code == 204
    assert refresh.status_code == 401


def test_logout_invalidates_outstanding_access_tokens(client: TestClient):
    session = _register(client)
    headers = {"Authorization": f"Bearer {session['token']}"}
    assert client.get("/v1/auth/me", headers=headers).status_code == 200

    logout = client.post("/v1/auth/logout", headers=headers)

    assert logout.status_code == 204
    # 로그아웃 전 발급된 액세스 토큰은 만료 전이라도 즉시 401 (#11 M6)
    assert client.get("/v1/auth/me", headers=headers).status_code == 401


def test_relogin_after_logout_issues_working_token(client: TestClient):
    session = _register(client)
    headers = {"Authorization": f"Bearer {session['token']}"}
    client.post("/v1/auth/logout", headers=headers)

    new_guest = _guest(client)
    login = client.post(
        "/v1/auth/login",
        headers={"Authorization": f"Bearer {new_guest['token']}"},
        json={"email": "member@example.com", "password": "password-123"},
    )

    assert login.status_code == 200
    new_headers = {"Authorization": f"Bearer {login.json()['token']}"}
    assert client.get("/v1/auth/me", headers=new_headers).status_code == 200


def test_forged_refresh_token_is_rejected(client: TestClient):
    response = client.post(
        "/v1/auth/refresh",
        json={"refresh_token": "forged-refresh-token"},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"

    too_long = client.post(
        "/v1/auth/refresh",
        json={"refresh_token": "x" * 129},
    )
    assert too_long.status_code == 400
    assert too_long.json()["error"]["code"] == "VALIDATION_ERROR"


def test_guest_logout_remains_a_noop(client: TestClient):
    guest = _guest(client)

    response = client.post(
        "/v1/auth/logout",
        headers={"Authorization": f"Bearer {guest['token']}"},
    )

    assert response.status_code == 204
    assert client.get(
        "/v1/auth/me",
        headers={"Authorization": f"Bearer {guest['token']}"},
    ).status_code == 200


def test_refresh_is_rate_limited_by_ip(client: TestClient):
    session = _register(client)
    refresh_token = session["refresh_token"]
    for _ in range(21):
        success = client.post(
            "/v1/auth/refresh",
            json={"refresh_token": refresh_token},
        )
        assert success.status_code == 200
        refresh_token = success.json()["refresh_token"]

    for _ in range(20):
        assert client.post(
            "/v1/auth/refresh",
            json={"refresh_token": "forged-refresh-token"},
        ).status_code == 401

    response = client.post(
        "/v1/auth/refresh",
        json={"refresh_token": "forged-refresh-token"},
    )

    assert response.status_code == 429
    assert response.json()["error"]["code"] == "RATE_LIMITED"
    assert int(response.headers["Retry-After"]) > 0

    expired = time.monotonic() - 3601
    stale_buckets = {str(index): deque([expired]) for index in range(10_001)}
    auth_router._peek_bucket(stale_buckets, "missing", 20)
    assert stale_buckets == {}
