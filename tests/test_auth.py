import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

os.environ.setdefault("DATABASE_URL", "sqlite://:memory:")
os.environ.setdefault("APP_ENV", "development")

import httpx
import jwt
import pytest
from fastapi.testclient import TestClient
from tortoise import Tortoise

from app.auth import hash_password, verify_password
from app.credits import grant_credits
from app.main import app
from app.models import (
    CreditLedger,
    CreditReason,
    CustomPromptLog,
    GenerationJob,
    Member,
    MemberKind,
    MetricEvent,
    PetProfile,
    SourceImage,
    Style,
)
from app.routers import auth as auth_router
from app.settings import Settings, settings


@pytest.fixture
def client():
    for buckets in (
        auth_router._guest_requests,
        auth_router._login_requests,
        auth_router._register_requests,
    ):
        buckets.clear()
    with TestClient(app) as test_client:
        test_client.portal.call(Tortoise.generate_schemas)
        yield test_client


async def _member_and_ledger(member_id: str):
    member = await Member.get(id=member_id)
    ledger = await CreditLedger.filter(member=member).all()
    return member, ledger


async def _member(member_id: str):
    return await Member.get(id=member_id)


async def _create_passwordless_member(email: str):
    return await Member.create(kind=MemberKind.MEMBER, email=email)


async def _replace_oauth_nonce(member_id: str, nonce: str):
    member = await Member.get(id=member_id)
    member.oauth_state_nonce = nonce
    member.oauth_state_expires_at = datetime.now(timezone.utc) + timedelta(minutes=5)
    await member.save(update_fields=["oauth_state_nonce", "oauth_state_expires_at"])


async def _prepare_existing_merge(guest_id: str, nickname: str | None = None):
    guest = await Member.get(id=guest_id)
    pet = await PetProfile.create(member=guest, name="Nutti")
    source = await SourceImage.create(
        member=guest,
        pet_profile=pet,
        storage_key=f"source/{uuid.uuid4()}",
        quality_check={},
    )
    style = await Style.create(id=1, code="merge-test", section="test", name="Merge test")
    job = await GenerationJob.create(
        member=guest,
        source_image=source,
        style=style,
        idempotency_key=uuid.uuid4(),
        credit_cost=1,
    )
    prompt = await CustomPromptLog.create(
        member=guest,
        raw_text="raw",
        normalized_text="normalized",
        moderation={},
        job=job,
    )
    event = await MetricEvent.create(event_type="merge_test", member=guest, job=job)
    existing = await Member.create(
        kind=MemberKind.MEMBER,
        kakao_id="123",
        nickname=nickname,
        credit_balance=7,
        oauth_state_nonce="stale-nonce",
        oauth_state_expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
    )
    return {
        "existing_id": str(existing.id),
        "pet_id": str(pet.id),
        "source_id": str(source.id),
        "job_id": str(job.id),
        "prompt_id": str(prompt.id),
        "event_id": event.id,
    }


async def _merge_result(guest_id: str, assets: dict):
    return (
        await Member.get(id=guest_id),
        await Member.get(id=assets["existing_id"]),
        await PetProfile.get(id=assets["pet_id"]),
        await SourceImage.get(id=assets["source_id"]),
        await GenerationJob.get(id=assets["job_id"]),
        await CustomPromptLog.get(id=assets["prompt_id"]),
        await MetricEvent.get(id=assets["event_id"]),
    )


async def _credit_dedupe_result():
    member = await Member.create(kind=MemberKind.MEMBER)
    first = await grant_credits(member.id, 3, CreditReason.LINK_ACCOUNT, "link_account")
    second = await grant_credits(member.id, 3, CreditReason.LINK_ACCOUNT, "link_account")
    member = await Member.get(id=member.id)
    entries = await CreditLedger.filter(member=member, dedupe_key="link_account").all()
    return first, second, member, entries


def _patch_kakao(
    monkeypatch: pytest.MonkeyPatch, kakao_id: int, nickname: str | None = None
) -> None:
    async def exchange(code: str) -> dict:
        assert code == "test-code"
        return {"access_token": "test-access-token"}

    async def fetch(access_token: str) -> dict:
        assert access_token == "test-access-token"
        return {"id": kakao_id, "properties": {"nickname": nickname}}

    monkeypatch.setattr(auth_router, "_exchange_kakao_code", exchange)
    monkeypatch.setattr(auth_router, "_fetch_kakao_member", fetch)


def _patch_naver(
    monkeypatch: pytest.MonkeyPatch, naver_id: str, nickname: str | None = None
) -> None:
    async def exchange(code: str, state: str) -> dict:
        assert code == "test-code"
        assert state
        return {"access_token": "test-access-token"}

    async def fetch(access_token: str) -> dict:
        assert access_token == "test-access-token"
        return {"response": {"id": naver_id, "nickname": nickname}}

    monkeypatch.setattr(auth_router, "_exchange_naver_code", exchange)
    monkeypatch.setattr(auth_router, "_fetch_naver_member", fetch)


def _patch_cafe24(monkeypatch: pytest.MonkeyPatch, member_id: str) -> None:
    async def exchange(code: str) -> dict:
        assert code == "test-code"
        return {"access_token": "test-access-token"}

    async def fetch(access_token: str) -> dict:
        assert access_token == "test-access-token"
        return {"cafe24_member_id": member_id}

    monkeypatch.setattr(auth_router, "_exchange_cafe24_code", exchange)
    monkeypatch.setattr(auth_router, "_fetch_cafe24_member", fetch)


def _authorize_state(client: TestClient, token: str, provider: str) -> str:
    response = client.get(
        f"/v1/auth/{provider}/authorize",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    assert set(response.json()) == {"authorize_url"}
    query = parse_qs(urlparse(response.json()["authorize_url"]).query, keep_blank_values=True)
    assert query["response_type"] == ["code"]
    assert query["state"]
    if provider == "cafe24":
        assert query["scope"] == [settings.cafe24_scope]
    return query["state"][0]


def _register_member(client: TestClient, email: str, password: str = "password-123") -> dict:
    guest = client.post("/v1/auth/guest").json()
    response = client.post(
        "/v1/auth/register",
        headers={"Authorization": f"Bearer {guest['token']}"},
        json={"email": email, "password": password},
    )
    assert response.status_code == 201
    return response.json()


def test_guest_issuance_creates_token_credit_and_ledger(client: TestClient):
    response = client.post("/v1/auth/guest")

    assert response.status_code == 201
    body = response.json()
    payload = jwt.decode(body["token"], settings.jwt_signing_key, algorithms=["HS256"])
    assert payload["sub"] == body["member_id"]
    assert payload["kind"] == "guest"

    member, ledger = client.portal.call(_member_and_ledger, body["member_id"])
    assert member.kind == MemberKind.GUEST
    assert member.credit_balance == 1
    assert len(ledger) == 1
    assert ledger[0].reason == CreditReason.GUEST_TRIAL
    assert ledger[0].dedupe_key == "guest_trial"
    assert ledger[0].balance_after == 1


def test_me_accepts_guest_and_rejects_missing_invalid_and_expired_tokens(client: TestClient):
    guest = client.post("/v1/auth/guest").json()

    response = client.get("/v1/auth/me", headers={"Authorization": f"Bearer {guest['token']}"})
    assert response.status_code == 200
    assert response.json() == {
        "member_id": guest["member_id"],
        "kind": "guest",
        "credit_balance": 1,
        "email": None,
        "nickname": None,
        "providers": [],
        "cafe24_linked": False,
    }

    missing = client.get("/v1/auth/me")
    assert missing.status_code == 401
    assert missing.json()["error"]["code"] == "UNAUTHORIZED"

    invalid = client.get("/v1/auth/me", headers={"Authorization": "Bearer forged.token.value"})
    assert invalid.status_code == 401
    assert invalid.json()["error"]["code"] == "UNAUTHORIZED"

    expired_token = jwt.encode(
        {
            "sub": guest["member_id"],
            "kind": "guest",
            "exp": datetime.now(timezone.utc) - timedelta(seconds=1),
        },
        settings.jwt_signing_key,
        algorithm="HS256",
    )
    expired = client.get("/v1/auth/me", headers={"Authorization": f"Bearer {expired_token}"})
    assert expired.status_code == 401
    assert expired.json()["error"]["code"] == "TOKEN_EXPIRED"


def test_me_rejects_token_signed_with_another_key(client: TestClient):
    guest = client.post("/v1/auth/guest").json()
    forged_token = jwt.encode(
        {
            "sub": guest["member_id"],
            "kind": "guest",
            "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
        },
        secrets.token_urlsafe(32),
        algorithm="HS256",
    )

    response = client.get("/v1/auth/me", headers={"Authorization": f"Bearer {forged_token}"})

    assert response.status_code == 401


def test_kakao_callback_promotes_new_guest_in_place(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    guest = client.post("/v1/auth/guest").json()
    state = _authorize_state(client, guest["token"], "kakao")
    _patch_kakao(monkeypatch, 123456)

    response = client.get(
        "/v1/auth/kakao/callback",
        params={"code": "test-code", "state": state},
    )

    assert response.status_code == 200
    assert response.json()["member_id"] == guest["member_id"]
    assert response.json()["kind"] == "member"
    assert response.json()["merged"] is False
    assert response.json()["credit_balance"] == 1
    member = client.portal.call(_member, guest["member_id"])
    assert member.kind == MemberKind.MEMBER
    assert member.kakao_id == "123456"
    assert member.guest_expires_at is None


def test_kakao_callback_merges_all_assets_into_existing_member(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    guest = client.post("/v1/auth/guest").json()
    assets = client.portal.call(_prepare_existing_merge, guest["member_id"])
    state = _authorize_state(client, guest["token"], "kakao")
    _patch_kakao(monkeypatch, 123)

    response = client.get(
        "/v1/auth/kakao/callback",
        params={"code": "test-code", "state": state},
    )

    assert response.status_code == 200
    assert response.json()["merged"] is True
    assert response.json()["member_id"] == assets["existing_id"]
    guest_row, existing, pet, source, job, prompt, event = client.portal.call(
        _merge_result, guest["member_id"], assets
    )
    assert {pet.member_id, source.member_id, job.member_id, prompt.member_id, event.member_id} == {existing.id}
    assert guest_row.merged_into_id == existing.id
    assert existing.credit_balance == response.json()["credit_balance"] == 7
    assert existing.oauth_state_nonce is None
    assert existing.oauth_state_expires_at is None


def test_merged_guest_cannot_callback_again(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    guest = client.post("/v1/auth/guest").json()
    client.portal.call(_prepare_existing_merge, guest["member_id"])
    state = _authorize_state(client, guest["token"], "kakao")
    _patch_kakao(monkeypatch, 123)
    assert client.get(
        "/v1/auth/kakao/callback",
        params={"code": "test-code", "state": state},
    ).status_code == 200

    nonce = secrets.token_urlsafe(32)
    client.portal.call(_replace_oauth_nonce, guest["member_id"], nonce)
    replay_state = jwt.encode(
        {
            "sub": guest["member_id"],
            "kind": "state",
            "nonce": nonce,
            "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
        },
        settings.jwt_signing_key,
        algorithm="HS256",
    )

    response = client.get(
        "/v1/auth/kakao/callback",
        params={"code": "test-code", "state": replay_state},
    )

    assert response.status_code == 401


def test_naver_callback_promotes_guest_and_reads_nested_profile(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    guest = client.post("/v1/auth/guest").json()
    state = _authorize_state(client, guest["token"], "naver")
    _patch_naver(monkeypatch, "naver-user-1")

    response = client.get(
        "/v1/auth/naver/callback",
        params={"code": "test-code", "state": state},
    )

    assert response.status_code == 200
    assert response.json()["member_id"] == guest["member_id"]
    assert response.json()["merged"] is False
    member = client.portal.call(_member, guest["member_id"])
    assert member.naver_id == "naver-user-1"


def test_kakao_callback_saves_nickname_and_exposes_it_in_me(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    guest = client.post("/v1/auth/guest").json()
    state = _authorize_state(client, guest["token"], "kakao")
    _patch_kakao(monkeypatch, 456, "콩이엄마")

    session = client.get(
        "/v1/auth/kakao/callback",
        params={"code": "test-code", "state": state},
    ).json()
    response = client.get(
        "/v1/auth/me",
        headers={"Authorization": f"Bearer {session['token']}"},
    )

    assert response.status_code == 200
    assert response.json()["nickname"] == "콩이엄마"
    assert client.portal.call(_member, guest["member_id"]).nickname == "콩이엄마"


def test_naver_callback_saves_nickname(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    guest = client.post("/v1/auth/guest").json()
    state = _authorize_state(client, guest["token"], "naver")
    _patch_naver(monkeypatch, "naver-user-2", "네이버닉")

    response = client.get(
        "/v1/auth/naver/callback",
        params={"code": "test-code", "state": state},
    )

    assert response.status_code == 200
    assert client.portal.call(_member, guest["member_id"]).nickname == "네이버닉"


@pytest.mark.parametrize(
    ("existing_nickname", "expected_nickname"),
    [("기존닉", "기존닉"), (None, "카카오닉")],
)
def test_kakao_merge_preserves_or_fills_existing_nickname(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    existing_nickname: str | None,
    expected_nickname: str,
):
    guest = client.post("/v1/auth/guest").json()
    assets = client.portal.call(
        _prepare_existing_merge, guest["member_id"], existing_nickname
    )
    state = _authorize_state(client, guest["token"], "kakao")
    _patch_kakao(monkeypatch, 123, "카카오닉")

    response = client.get(
        "/v1/auth/kakao/callback",
        params={"code": "test-code", "state": state},
    )

    assert response.status_code == 200
    assert client.portal.call(_member, assets["existing_id"]).nickname == expected_nickname


@pytest.mark.parametrize("provider", ["kakao", "naver"])
def test_social_callback_rejects_missing_provider_id(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, provider: str
):
    guest = client.post("/v1/auth/guest").json()
    state = _authorize_state(client, guest["token"], provider)
    if provider == "kakao":
        _patch_kakao(monkeypatch, None)
    else:
        _patch_naver(monkeypatch, None)

    response = client.get(
        f"/v1/auth/{provider}/callback",
        params={"code": "test-code", "state": state},
    )

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "BAD_GATEWAY"
    assert client.portal.call(_member, guest["member_id"]).kind == MemberKind.GUEST


def test_kakao_state_is_single_use(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    guest = client.post("/v1/auth/guest").json()
    state = _authorize_state(client, guest["token"], "kakao")
    _patch_kakao(monkeypatch, 789)

    first = client.get("/v1/auth/kakao/callback", params={"code": "test-code", "state": state})
    second = client.get("/v1/auth/kakao/callback", params={"code": "test-code", "state": state})

    assert first.status_code == 200
    assert second.status_code == 401


def test_kakao_state_nonce_must_match_guest(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    guest = client.post("/v1/auth/guest").json()
    old_state = _authorize_state(client, guest["token"], "kakao")
    _authorize_state(client, guest["token"], "kakao")
    _patch_kakao(monkeypatch, 321)

    response = client.get("/v1/auth/kakao/callback", params={"code": "test-code", "state": old_state})

    assert response.status_code == 401


def test_register_success_normalizes_email_and_hashes_password(client: TestClient):
    guest = client.post("/v1/auth/guest").json()

    response = client.post(
        "/v1/auth/register",
        headers={"Authorization": f"Bearer {guest['token']}"},
        json={"email": " User@Example.COM ", "password": "password-123"},
    )

    assert response.status_code == 201
    assert response.json() == {
        "token": response.json()["token"],
        "member_id": guest["member_id"],
        "kind": "member",
        "merged": False,
        "credit_balance": 1,
    }
    member = client.portal.call(_member, guest["member_id"])
    assert member.email == "user@example.com"
    assert member.password_hash is not None
    assert verify_password("password-123", member.password_hash) is True


def test_register_rejects_duplicate_email(client: TestClient):
    _register_member(client, "taken@example.com")
    guest = client.post("/v1/auth/guest").json()

    response = client.post(
        "/v1/auth/register",
        headers={"Authorization": f"Bearer {guest['token']}"},
        json={"email": "TAKEN@example.com", "password": "password-456"},
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "EMAIL_TAKEN"


def test_register_rejects_email_raced_in_after_duplicate_check(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    guest = client.post("/v1/auth/guest").json()
    real_merge = auth_router._merge_or_promote_guest
    victim_hash = hash_password("victim-real-password")
    race = {}

    async def racing_merge(connection, guest_id, *, id_field, id_value):
        victim = await Member.create(
            kind=MemberKind.MEMBER,
            email=id_value,
            password_hash=victim_hash,
        )
        target, merged = await real_merge(
            connection, guest_id, id_field=id_field, id_value=id_value
        )
        race.update(victim=victim, target=target, merged=merged)
        return target, merged

    monkeypatch.setattr(auth_router, "_merge_or_promote_guest", racing_merge)
    response = client.post(
        "/v1/auth/register",
        headers={"Authorization": f"Bearer {guest['token']}"},
        json={"email": "victim@example.com", "password": "attacker-owns-you"},
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "EMAIL_TAKEN"
    assert race["merged"] is True
    assert race["target"].id == race["victim"].id
    assert verify_password("victim-real-password", race["target"].password_hash) is True
    assert verify_password("attacker-owns-you", race["target"].password_hash) is False
    assert client.portal.call(_member, guest["member_id"]).merged_into_id is None


def test_register_requires_guest_token(client: TestClient):
    response = client.post(
        "/v1/auth/register",
        json={"email": "user@example.com", "password": "password-123"},
    )

    assert response.status_code == 401


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        (
            "post",
            "/v1/auth/register",
            {"email": "other@example.com", "password": "password-123"},
        ),
        (
            "post",
            "/v1/auth/login",
            {"email": "member@example.com", "password": "password-123"},
        ),
        ("get", "/v1/auth/kakao/authorize", None),
    ],
)
def test_member_token_rejects_guest_auth_flows_as_already_member(
    client: TestClient, method: str, path: str, body: dict | None
):
    session = _register_member(client, "member@example.com")

    response = client.request(
        method,
        path,
        headers={"Authorization": f"Bearer {session['token']}"},
        json=body,
    )

    assert response.status_code == 409
    assert response.json()["error"] == {
        "code": "ALREADY_MEMBER",
        "message": "Already signed in as a member",
        "detail": {},
    }


@pytest.mark.parametrize(
    "body",
    [
        {"email": "not-an-email", "password": "password-123"},
        {"email": "user@example.com", "password": "short"},
        {"email": "a" * 243 + "@example.com", "password": "password-123"},
        {"email": "user@example.com", "password": "p" * 129},
    ],
)
def test_register_validates_email_and_password(client: TestClient, body: dict):
    guest = client.post("/v1/auth/guest").json()

    response = client.post(
        "/v1/auth/register",
        headers={"Authorization": f"Bearer {guest['token']}"},
        json=body,
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_login_merges_guest_into_existing_local_member(client: TestClient):
    registered = _register_member(client, "user@example.com")
    guest = client.post("/v1/auth/guest").json()

    response = client.post(
        "/v1/auth/login",
        headers={"Authorization": f"Bearer {guest['token']}"},
        json={"email": "USER@example.com", "password": "password-123"},
    )

    assert response.status_code == 200
    assert response.json()["member_id"] == registered["member_id"]
    assert response.json()["merged"] is True
    assert response.json()["credit_balance"] == 1
    guest_row = client.portal.call(_member, guest["member_id"])
    assert str(guest_row.merged_into_id) == registered["member_id"]


def test_login_wrong_password_returns_invalid_credentials(client: TestClient):
    _register_member(client, "user@example.com")
    guest = client.post("/v1/auth/guest").json()

    response = client.post(
        "/v1/auth/login",
        headers={"Authorization": f"Bearer {guest['token']}"},
        json={"email": "user@example.com", "password": "wrong"},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_login_unknown_email_uses_dummy_hash_and_same_error(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    guest = client.post("/v1/auth/guest").json()
    calls = []

    def verify(password: str, stored_hash: str) -> bool:
        calls.append((password, stored_hash))
        return False

    monkeypatch.setattr(auth_router, "verify_password", verify)
    response = client.post(
        "/v1/auth/login",
        headers={"Authorization": f"Bearer {guest['token']}"},
        json={"email": "missing@example.com", "password": "wrong-password"},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "INVALID_CREDENTIALS"
    assert calls and calls[0][0] == "wrong-password"


def test_login_passwordless_email_returns_invalid_credentials(client: TestClient):
    client.portal.call(_create_passwordless_member, "passwordless@example.com")
    guest = client.post("/v1/auth/guest").json()

    response = client.post(
        "/v1/auth/login",
        headers={"Authorization": f"Bearer {guest['token']}"},
        json={"email": "passwordless@example.com", "password": "password-123"},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_login_rate_limits_same_email(client: TestClient):
    _register_member(client, "rate-limit@example.com")
    guest = client.post("/v1/auth/guest").json()
    headers = {"Authorization": f"Bearer {guest['token']}"}
    body = {"email": "rate-limit@example.com", "password": "wrong-password"}

    for _ in range(10):
        assert client.post("/v1/auth/login", headers=headers, json=body).status_code == 401
    response = client.post("/v1/auth/login", headers=headers, json=body)

    assert response.status_code == 429
    assert response.json()["error"]["code"] == "RATE_LIMITED"
    assert int(response.headers["Retry-After"]) > 0


def test_login_email_budget_counts_failures_only_and_clears_on_success(client: TestClient):
    # N1: 성공 로그인은 이메일 예산을 태우지 않고, 성공 시 실패 카운터가 초기화된다
    _register_member(client, "victim@example.com")
    wrong = {"email": "victim@example.com", "password": "wrong-password"}
    right = {"email": "victim@example.com", "password": "password-123"}

    attacker = client.post("/v1/auth/guest").json()
    attacker_headers = {"Authorization": f"Bearer {attacker['token']}"}
    for _ in range(9):
        assert client.post("/v1/auth/login", headers=attacker_headers, json=wrong).status_code == 401

    # 실패 9회(한도 10 미만) 상태에서 정상 소유자는 로그인 가능해야 한다
    victim = client.post("/v1/auth/guest").json()
    victim_headers = {"Authorization": f"Bearer {victim['token']}"}
    response = client.post("/v1/auth/login", headers=victim_headers, json=right)
    assert response.status_code == 200

    # 성공이 카운터를 비웠으므로, 이후 실패 9회가 다시 401(429 아님)로 통과해야 한다
    for _ in range(9):
        assert client.post("/v1/auth/login", headers=attacker_headers, json=wrong).status_code == 401


def test_login_email_rate_limit_spans_client_ips(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    _register_member(client, "distributed@example.com")
    guest = client.post("/v1/auth/guest").json()
    monkeypatch.setattr(settings, "trust_proxy", True)
    body = {"email": "distributed@example.com", "password": "wrong-password"}

    for index in range(10):
        headers = {
            "Authorization": f"Bearer {guest['token']}",
            "X-Forwarded-For": f"203.0.113.{index}",
        }
        assert client.post("/v1/auth/login", headers=headers, json=body).status_code == 401
    response = client.post(
        "/v1/auth/login",
        headers={
            "Authorization": f"Bearer {guest['token']}",
            "X-Forwarded-For": "198.51.100.1",
        },
        json=body,
    )

    assert response.status_code == 429
    assert response.json()["error"]["code"] == "RATE_LIMITED"
    assert int(response.headers["Retry-After"]) > 0


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("/v1/auth/register", {"email": "expired@example.com", "password": "password-123"}),
        ("/v1/auth/login", {"email": "expired@example.com", "password": "password-123"}),
    ],
)
def test_register_and_login_report_expired_guest_token(
    client: TestClient, path: str, body: dict
):
    guest = client.post("/v1/auth/guest").json()
    token = jwt.encode(
        {
            "sub": guest["member_id"],
            "kind": "guest",
            "exp": datetime.now(timezone.utc) - timedelta(minutes=1),
        },
        settings.jwt_signing_key,
        algorithm="HS256",
    )

    response = client.post(
        path,
        headers={"Authorization": f"Bearer {token}"},
        json=body,
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "TOKEN_EXPIRED"


def test_register_reports_expired_member_token(client: TestClient):
    session = _register_member(client, "expired-member@example.com")
    token = jwt.encode(
        {
            "sub": session["member_id"],
            "kind": "member",
            "exp": datetime.now(timezone.utc) - timedelta(minutes=1),
        },
        settings.jwt_signing_key,
        algorithm="HS256",
    )

    response = client.post(
        "/v1/auth/register",
        headers={"Authorization": f"Bearer {token}"},
        json={"email": "other@example.com", "password": "password-123"},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "TOKEN_EXPIRED"


def test_cafe24_authorize_rejects_guest_token(client: TestClient):
    guest = client.post("/v1/auth/guest").json()

    response = client.get(
        "/v1/auth/cafe24/authorize",
        headers={"Authorization": f"Bearer {guest['token']}"},
    )

    assert response.status_code == 401


def test_cafe24_callback_links_member_and_grants_three_credits(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    member_session = _register_member(client, "cafe@example.com")
    state = _authorize_state(client, member_session["token"], "cafe24")
    _patch_cafe24(monkeypatch, "cafe-user-1")

    response = client.get(
        "/v1/auth/cafe24/callback",
        params={"code": "test-code", "state": state},
    )

    assert response.status_code == 200
    assert response.json() == {"cafe24_linked": True, "credit_balance": 4}
    member, ledger = client.portal.call(_member_and_ledger, member_session["member_id"])
    assert member.cafe24_member_id == "cafe-user-1"
    assert member.order_reward_cutoff is not None
    assert len([entry for entry in ledger if entry.dedupe_key == "link_account"]) == 1


def test_cafe24_relink_does_not_grant_credits_twice(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    member_session = _register_member(client, "relink@example.com")
    _patch_cafe24(monkeypatch, "cafe-user-2")

    first_state = _authorize_state(client, member_session["token"], "cafe24")
    first = client.get(
        "/v1/auth/cafe24/callback",
        params={"code": "test-code", "state": first_state},
    )
    first_cutoff = client.portal.call(_member, member_session["member_id"]).order_reward_cutoff
    second_state = _authorize_state(client, member_session["token"], "cafe24")
    second = client.get(
        "/v1/auth/cafe24/callback",
        params={"code": "test-code", "state": second_state},
    )

    assert first.status_code == second.status_code == 200
    assert first.json()["credit_balance"] == second.json()["credit_balance"] == 4
    member, ledger = client.portal.call(_member_and_ledger, member_session["member_id"])
    assert member.order_reward_cutoff == first_cutoff
    assert len([entry for entry in ledger if entry.dedupe_key == "link_account"]) == 1


def test_cafe24_rejects_rebinding_member_to_another_account(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    member_session = _register_member(client, "cafe-rebind@example.com")
    _patch_cafe24(monkeypatch, "cafe-user-a")
    first_state = _authorize_state(client, member_session["token"], "cafe24")
    assert client.get(
        "/v1/auth/cafe24/callback",
        params={"code": "test-code", "state": first_state},
    ).status_code == 200

    _patch_cafe24(monkeypatch, "cafe-user-b")
    second_state = _authorize_state(client, member_session["token"], "cafe24")
    response = client.get(
        "/v1/auth/cafe24/callback",
        params={"code": "test-code", "state": second_state},
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "CAFE24_ALREADY_LINKED"
    member = client.portal.call(_member, member_session["member_id"])
    assert member.cafe24_member_id == "cafe-user-a"


def test_cafe24_rejects_account_already_linked_to_another_member(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    first = _register_member(client, "first@example.com")
    second = _register_member(client, "second@example.com")
    _patch_cafe24(monkeypatch, "shared-cafe-user")
    first_state = _authorize_state(client, first["token"], "cafe24")
    assert client.get(
        "/v1/auth/cafe24/callback",
        params={"code": "test-code", "state": first_state},
    ).status_code == 200

    second_state = _authorize_state(client, second["token"], "cafe24")
    response = client.get(
        "/v1/auth/cafe24/callback",
        params={"code": "test-code", "state": second_state},
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "CAFE24_ALREADY_LINKED"
    second_member = client.portal.call(_member, second["member_id"])
    assert second_member.cafe24_member_id is None
    assert second_member.order_reward_cutoff is None
    assert second_member.credit_balance == 1


def test_cafe24_callback_requires_state(client: TestClient):
    response = client.get("/v1/auth/cafe24/callback", params={"code": "test-code"})

    assert 400 <= response.status_code < 500


def test_cafe24_state_stays_consumed_after_upstream_failure(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    member_session = _register_member(client, "failure@example.com")
    state = _authorize_state(client, member_session["token"], "cafe24")
    calls = 0

    async def exchange(code: str) -> dict:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise httpx.HTTPError("upstream failed")
        return {"access_token": "test-access-token"}

    async def fetch(access_token: str) -> dict:
        return {"cafe24_member_id": "retry-123"}

    monkeypatch.setattr(auth_router, "_exchange_cafe24_code", exchange)
    monkeypatch.setattr(auth_router, "_fetch_cafe24_member", fetch)

    first = client.get("/v1/auth/cafe24/callback", params={"code": "test-code", "state": state})
    second = client.get("/v1/auth/cafe24/callback", params={"code": "test-code", "state": state})

    assert first.status_code == 502
    assert second.status_code == 401
    assert calls == 1


def test_me_lists_kakao_and_local_providers(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    guest = client.post("/v1/auth/guest").json()
    state = _authorize_state(client, guest["token"], "kakao")
    _patch_kakao(monkeypatch, 555)
    kakao_session = client.get(
        "/v1/auth/kakao/callback",
        params={"code": "test-code", "state": state},
    ).json()

    kakao_me = client.get(
        "/v1/auth/me",
        headers={"Authorization": f"Bearer {kakao_session['token']}"},
    )
    local_session = _register_member(client, "Local@Example.COM")
    local_me = client.get(
        "/v1/auth/me",
        headers={"Authorization": f"Bearer {local_session['token']}"},
    )

    assert kakao_me.json()["email"] is None
    assert kakao_me.json()["providers"] == ["kakao"]
    assert local_me.json()["email"] == "local@example.com"
    assert local_me.json()["providers"] == ["local"]


def test_guest_issuance_is_rate_limited_by_forwarded_ip(client: TestClient):
    assert settings.trust_proxy is False

    for index in range(settings.guest_rate_limit_per_hour):
        headers = {"X-Forwarded-For": f"203.0.113.{index}"}
        assert client.post("/v1/auth/guest", headers=headers).status_code == 201
    response = client.post("/v1/auth/guest", headers={"X-Forwarded-For": "198.51.100.1"})

    assert response.status_code == 429
    assert response.json()["error"]["code"] == "RATE_LIMITED"
    retry_after = response.headers.get("Retry-After")
    assert retry_after is not None
    assert int(retry_after) > 0

    auth_router._guest_requests.clear()

    for _ in range(settings.guest_rate_limit_per_hour):
        assert client.post("/v1/auth/guest").status_code == 201
    response = client.post("/v1/auth/guest")

    assert response.status_code == 429
    assert response.json()["error"]["code"] == "RATE_LIMITED"


def test_empty_jwt_signing_key_is_rejected_in_development():
    with pytest.raises(ValueError, match="JWT_SIGNING_KEY"):
        Settings(app_env="development", jwt_signing_key="")


def test_grant_credits_is_atomic_and_deduplicated(client: TestClient):
    first, second, member, entries = client.portal.call(_credit_dedupe_result)

    assert first is True
    assert second is False
    assert len(entries) == 1
    assert entries[0].balance_after == member.credit_balance == 3
