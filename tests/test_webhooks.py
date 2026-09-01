import os
from datetime import datetime, timezone

os.environ.setdefault("DATABASE_URL", "sqlite://:memory:")
os.environ.setdefault("APP_ENV", "development")

import pytest
from fastapi.testclient import TestClient
from tortoise import Tortoise

from app import cafe24
from app.main import app
from app.models import Member, MemberKind
from app.settings import settings

KEY = "11111111-2222-3333-4444-555555555555"


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "cafe24_webhook_api_key", KEY)
    monkeypatch.setattr(settings, "cafe24_mall_id", "tjddns98")
    with TestClient(app) as test_client:
        test_client.portal.call(Tortoise.generate_schemas)
        yield test_client


@pytest.fixture
def synced(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, bool]]:
    calls: list[tuple[str, bool]] = []

    async def fake_sync(member: Member, now=None, *, force: bool = False):
        calls.append((member.cafe24_member_id, force))
        return {"rewarded": 1}

    monkeypatch.setattr(cafe24, "sync_member_orders", fake_sync)
    return calls


async def _linked(shop_member_id: str) -> None:
    await Member.create(
        kind=MemberKind.MEMBER,
        cafe24_member_id=shop_member_id,
        order_reward_cutoff=datetime.now(timezone.utc),
    )


def _event(event_no: int = 90025, member_id: str | None = "kongmom", mall_id: str = "tjddns98") -> dict:
    return {
        "event_no": event_no,
        "resource": {"mall_id": mall_id, "event_shop_no": "1", "order_id": "20260901-0000015", "member_id": member_id},
    }


def test_webhook_rejects_missing_or_wrong_key(client: TestClient, synced):
    assert client.post("/v1/webhooks/cafe24", json=_event()).status_code == 401
    assert client.post("/v1/webhooks/cafe24", json=_event(), headers={"X-API-Key": "nope"}).status_code == 401
    assert synced == []


def test_webhook_resyncs_linked_member_bypassing_throttle(client: TestClient, synced):
    """페이로드의 paid/canceled는 안 믿는다 — 그 회원 주문을 API로 다시 보는 트리거일 뿐(force=True)."""
    client.portal.call(_linked, "kongmom")

    response = client.post("/v1/webhooks/cafe24", json=_event(90025), headers={"X-API-Key": KEY})

    assert response.status_code == 202
    assert response.json() == {"accepted": True}
    assert synced == [("kongmom", True)]


def test_webhook_ignores_other_mall_unlinked_member_and_uninteresting_events(client: TestClient, synced):
    client.portal.call(_linked, "kongmom")
    headers = {"X-API-Key": KEY}

    other_mall = client.post("/v1/webhooks/cafe24", json=_event(mall_id="someone-else"), headers=headers)
    unlinked = client.post("/v1/webhooks/cafe24", json=_event(member_id="stranger"), headers=headers)
    guest_order = client.post("/v1/webhooks/cafe24", json=_event(member_id=None), headers=headers)
    product = client.post("/v1/webhooks/cafe24", json=_event(event_no=90001), headers=headers)

    assert [r.status_code for r in (other_mall, unlinked, guest_order, product)] == [202, 202, 202, 202]
    assert all(r.json() == {"accepted": False} for r in (other_mall, unlinked, guest_order, product))
    assert synced == []


def test_webhook_rejects_malformed_payload(client: TestClient, synced):
    assert client.post("/v1/webhooks/cafe24", json={"hello": 1}, headers={"X-API-Key": KEY}).status_code == 400
    assert synced == []


def test_webhook_disabled_when_key_unset(client: TestClient, synced, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "cafe24_webhook_api_key", "")
    assert client.post("/v1/webhooks/cafe24", json=_event(), headers={"X-API-Key": ""}).status_code == 401
