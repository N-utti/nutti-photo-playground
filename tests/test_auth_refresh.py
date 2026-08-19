import hashlib
import os
import time
import uuid
from collections import deque
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

os.environ.setdefault("DATABASE_URL", "sqlite://:memory:")
os.environ.setdefault("APP_ENV", "development")

import pytest
from fastapi.testclient import TestClient
from tortoise import Tortoise

from app.main import app
from app.models import (
    CreditLedger,
    CustomPromptLog,
    GenerationJob,
    GenerationResult,
    Member,
    PetProfile,
    SourceImage,
)
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


async def _seed_withdrawal_assets(member_id: str) -> dict:
    member = await Member.get(id=member_id)
    member.credit_balance = 3
    await member.save(update_fields=["credit_balance"])
    pet = await PetProfile.create(member=member, name="몽이")
    source = await SourceImage.create(
        member=member, pet_profile=pet, storage_key="uploads/w.jpg", quality_check={}
    )
    job = await GenerationJob.create(
        member=member,
        source_image=source,
        idempotency_key=uuid.uuid4(),
        credit_cost=1,
        input_values={"반려견 이름": "몽이"},
    )
    log = await CustomPromptLog.create(
        member=member, raw_text="우주복 입혀줘", normalized_text="우주복 입혀줘", moderation={}, job=None
    )
    result = await GenerationResult.create(job=job, seq=1, storage_key="results/w.jpg")
    return {"source_id": source.id, "result_id": result.id, "job_id": job.id, "log_id": log.id}


async def _withdrawal_state(member_id: str, ids: dict) -> dict:
    member = await Member.get(id=member_id)
    source = await SourceImage.get(id=ids["source_id"])
    result = await GenerationResult.get(id=ids["result_id"])
    forfeit = await CreditLedger.filter(
        member_id=member_id, reason="withdrawal_forfeit"
    ).first()
    job = await GenerationJob.get(id=ids["job_id"])
    log = await CustomPromptLog.get(id=ids["log_id"])
    return {
        "job_status": job.status.value,
        "job_error": job.error_code,
        "job_inputs": job.input_values,
        "log_text": log.raw_text,
        "email": member.email,
        "nickname": member.nickname,
        "withdrawn_at": member.withdrawn_at,
        "balance": member.credit_balance,
        "pet_count": await PetProfile.filter(member_id=member_id).count(),
        "source_deleted": source.deleted_at,
        "result_deleted": result.deleted_at,
        "forfeit_amount": forfeit.amount if forfeit else None,
        "forfeit_balance_after": forfeit.balance_after if forfeit else None,
    }


def test_withdraw_purges_assets_and_anonymizes_member(client: TestClient):
    session = _register(client)
    headers = {"Authorization": f"Bearer {session['token']}"}
    ids = client.portal.call(_seed_withdrawal_assets, session["member_id"])

    response = client.delete("/v1/auth/me", headers=headers)

    assert response.status_code == 204
    state = client.portal.call(_withdrawal_state, session["member_id"], ids)
    assert state["withdrawn_at"] is not None
    assert state["email"] is None and state["nickname"] is None
    assert state["balance"] == 0
    assert state["pet_count"] == 0
    assert state["source_deleted"] is not None
    assert state["result_deleted"] is not None
    # 잔액 3 소멸이 원장에 남는다(감사 보존)
    assert state["forfeit_amount"] == -3
    assert state["forfeit_balance_after"] == 0
    # 대기 중 job 취소 + 자유 입력 텍스트 파기
    assert state["job_status"] == "failed"
    assert state["job_error"] == "WITHDRAWN"
    assert state["job_inputs"] is None
    assert state["log_text"] == ""
    # 탈퇴 후 기존 토큰 즉시 무효
    assert client.get("/v1/auth/me", headers=headers).status_code == 401


def test_withdraw_rejects_guest_and_allows_rejoin(client: TestClient):
    guest = _guest(client)
    forbidden = client.delete(
        "/v1/auth/me", headers={"Authorization": f"Bearer {guest['token']}"}
    )
    assert forbidden.status_code == 403
    assert forbidden.json()["error"]["code"] == "MEMBER_ONLY"

    session = _register(client, email="rejoin@example.com")
    client.delete(
        "/v1/auth/me", headers={"Authorization": f"Bearer {session['token']}"}
    )

    # 동일 이메일 재가입 = 완전 신규(익명화로 unique 충돌 없음)
    rejoined = _register(client, email="rejoin@example.com")
    assert rejoined["member_id"] != session["member_id"]
