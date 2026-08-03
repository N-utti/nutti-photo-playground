import os
import uuid
from datetime import datetime, timedelta, timezone

os.environ.setdefault("DATABASE_URL", "sqlite://:memory:")

import jwt
import pytest
from fastapi.testclient import TestClient
from tortoise import Tortoise

from app.credits import grant_credits
from app.main import app
from app.models import (
    CreditLedger,
    CreditReason,
    GenerationJob,
    Member,
    MemberKind,
    PetProfile,
    SourceImage,
    Style,
)
from app.routers import auth as auth_router
from app.settings import settings


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        test_client.portal.call(Tortoise.generate_schemas)
        yield test_client


async def _member_and_ledger(member_id: str):
    member = await Member.get(id=member_id)
    ledger = await CreditLedger.filter(member=member).all()
    return member, ledger


async def _member(member_id: str):
    return await Member.get(id=member_id)


async def _prepare_existing_merge(guest_id: str):
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
    existing = await Member.create(kind=MemberKind.MEMBER, cafe24_member_id="existing-123")
    assert await grant_credits(existing.id, 3, CreditReason.LINK_ACCOUNT, "link_account") is True
    await existing.refresh_from_db()
    return str(existing.id), str(pet.id), str(job.id), existing.credit_balance


async def _merge_result(guest_id: str, existing_id: str, pet_id: str, job_id: str):
    guest = await Member.get(id=guest_id)
    existing = await Member.get(id=existing_id)
    pet = await PetProfile.get(id=pet_id)
    job = await GenerationJob.get(id=job_id)
    link_entries = await CreditLedger.filter(member_id=existing.id, dedupe_key="link_account").count()
    return guest, existing, pet, job, link_entries


async def _credit_dedupe_result():
    member = await Member.create(kind=MemberKind.MEMBER)
    first = await grant_credits(member.id, 3, CreditReason.LINK_ACCOUNT, "link_account")
    second = await grant_credits(member.id, 3, CreditReason.LINK_ACCOUNT, "link_account")
    member = await Member.get(id=member.id)
    entries = await CreditLedger.filter(member=member, dedupe_key="link_account").all()
    return first, second, member, entries


def _patch_cafe24(monkeypatch: pytest.MonkeyPatch, member_id: str) -> None:
    async def exchange(code: str) -> dict:
        assert code == "test-code"
        return {"access_token": "test-access-token"}

    async def fetch(access_token: str) -> dict:
        assert access_token == "test-access-token"
        return {"cafe24_member_id": member_id}

    monkeypatch.setattr(auth_router, "_exchange_cafe24_code", exchange)
    monkeypatch.setattr(auth_router, "_fetch_cafe24_member", fetch)


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


def test_cafe24_callback_promotes_new_guest_in_place(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    guest = client.post("/v1/auth/guest").json()
    _patch_cafe24(monkeypatch, "new-123")

    response = client.get(
        "/v1/auth/cafe24/callback",
        params={"code": "test-code"},
        headers={"Authorization": f"Bearer {guest['token']}"},
    )

    assert response.status_code == 200
    assert response.json()["member_id"] == guest["member_id"]
    assert response.json()["kind"] == "member"
    assert response.json()["merged"] is False
    assert response.json()["credit_balance"] == 4
    member = client.portal.call(_member, guest["member_id"])
    assert member.kind == MemberKind.MEMBER
    assert member.cafe24_member_id == "new-123"
    assert member.guest_expires_at is None


def test_cafe24_callback_merges_assets_into_existing_member(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    guest = client.post("/v1/auth/guest").json()
    existing_id, pet_id, job_id, initial_balance = client.portal.call(_prepare_existing_merge, guest["member_id"])
    _patch_cafe24(monkeypatch, "existing-123")

    response = client.get(
        "/v1/auth/cafe24/callback",
        params={"code": "test-code"},
        headers={"Authorization": f"Bearer {guest['token']}"},
    )

    assert response.status_code == 200
    assert response.json()["merged"] is True
    assert response.json()["member_id"] == existing_id
    guest_row, existing, pet, job, link_entries = client.portal.call(
        _merge_result,
        guest["member_id"],
        existing_id,
        pet_id,
        job_id,
    )
    assert pet.member_id == existing.id
    assert job.member_id == existing.id
    assert guest_row.merged_into_id == existing.id
    assert existing.credit_balance == initial_balance
    assert response.json()["credit_balance"] == initial_balance
    assert link_entries == 1


def test_grant_credits_is_atomic_and_deduplicated(client: TestClient):
    first, second, member, entries = client.portal.call(_credit_dedupe_result)

    assert first is True
    assert second is False
    assert len(entries) == 1
    assert entries[0].balance_after == member.credit_balance == 3
