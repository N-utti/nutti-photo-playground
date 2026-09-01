import os
from datetime import datetime, timedelta, timezone

os.environ.setdefault("DATABASE_URL", "sqlite://:memory:")
os.environ.setdefault("APP_ENV", "development")

import httpx
import pytest
from tortoise import Tortoise

from app import cafe24
from app.models import AppSetting, Cafe24OauthToken, CreditLedger, Member, MemberKind
from app.settings import settings

pytestmark = pytest.mark.anyio

NOW = datetime(2026, 9, 1, 3, 0, tzinfo=timezone.utc)  # 12:00 KST
CUTOFF = NOW - timedelta(days=10)


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture(autouse=True)
async def database(monkeypatch: pytest.MonkeyPatch):
    await Tortoise.init(
        db_url="sqlite://:memory:",
        modules={"models": ["app.models"]},
        _enable_global_fallback=True,
    )
    await Tortoise.generate_schemas()
    monkeypatch.setattr(settings, "cafe24_mall_id", "nutti")
    monkeypatch.setattr(settings, "admin_alert_slack_webhook_url", "")
    yield
    await Tortoise.close_connections()


FETCH_CALLS: list[str | None] = []  # orders 대역이 받은 member_id 필터 기록


@pytest.fixture
def orders(monkeypatch: pytest.MonkeyPatch) -> list[dict]:
    """카페24 주문 API 대역 — 목록을 그대로 돌려준다."""
    store: list[dict] = []

    async def fake_fetch(
        access_token: str, start: datetime, end: datetime, member_id: str | None = None
    ) -> list[dict]:
        assert access_token == "access"
        FETCH_CALLS.append(member_id)
        return [o for o in store if member_id is None or o.get("member_id") == member_id]

    FETCH_CALLS.clear()
    monkeypatch.setattr(cafe24, "_fetch_orders", fake_fetch)
    monkeypatch.setattr(cafe24, "_member_synced_at", {})
    return store


async def _token(expires_in: timedelta = timedelta(hours=1), synced: datetime | None = None):
    return await Cafe24OauthToken.create(
        mall_id="nutti",
        access_token="access",
        refresh_token="refresh",
        expires_at=NOW + expires_in,
        last_synced_at=synced,
    )


async def _linked_member(cafe24_id: str = "c1", cutoff: datetime = CUTOFF) -> Member:
    return await Member.create(
        kind=MemberKind.MEMBER, cafe24_member_id=cafe24_id, order_reward_cutoff=cutoff
    )


def _order(order_id: str, member: str = "c1", days_ago: int = 1, **extra) -> dict:
    return {
        "order_id": order_id,
        "member_id": member,
        "order_date": (NOW - timedelta(days=days_ago)).isoformat(),
        "paid": "T",
        "canceled": "F",
        **extra,
    }


async def test_sync_rewards_eligible_orders_and_skips_rest(orders: list[dict]):
    await _token()
    member = await _linked_member()
    await Member.create(kind=MemberKind.MEMBER, cafe24_member_id="c2")  # 연동 안 됨(컷오프 없음)
    orders.extend(
        [
            _order("o-ok"),
            _order("o-before-cutoff", days_ago=20),
            _order("o-unlinked", member="c2"),
            _order("o-unknown", member="nobody"),
            _order("o-unpaid", paid="F"),
            _order("o-guest", member=None),  # 비회원 주문 — NULL 매칭 크래시 회귀 방지
            {"order_id": "o-broken", "member_id": "c1", "order_date": "not-a-date"},
            {"member_id": "c1"},
        ]
    )

    summary = await cafe24.sync_orders(NOW)

    await member.refresh_from_db()
    assert member.credit_balance == 20
    assert summary["rewarded"] == 1
    assert summary["skipped_before_cutoff"] == 1
    assert summary["skipped_unlinked"] == 3
    assert summary["skipped_unpaid"] == 1
    assert summary["skipped_malformed"] == 2
    ledger = await CreditLedger.get(member_id=member.id)
    assert (ledger.dedupe_key, ledger.reason.value, ledger.ref_id) == ("order:o-ok", "order_reward", "o-ok")
    token = await Cafe24OauthToken.get(mall_id="nutti")
    assert token.last_synced_at == NOW


async def test_sync_is_idempotent_and_uses_configured_amount(orders: list[dict]):
    await _token()
    await AppSetting.create(key="order_reward_amount", value=30)
    member = await _linked_member()
    orders.append(_order("o-1"))

    first = await cafe24.sync_orders(NOW)
    second = await cafe24.sync_orders(NOW + timedelta(minutes=30))

    await member.refresh_from_db()
    assert member.credit_balance == 30
    assert (first["rewarded"], second["rewarded"]) == (1, 0)
    assert await CreditLedger.filter(member_id=member.id).count() == 1


async def test_cancel_claws_back_original_amount_once(orders: list[dict]):
    await _token(expires_in=timedelta(days=5))
    member = await _linked_member()
    orders.append(_order("o-1"))
    await cafe24.sync_orders(NOW)
    await AppSetting.create(key="order_reward_amount", value=50)  # 회수는 지급 당시 금액 기준
    await member.refresh_from_db()
    await Member.filter(id=member.id).update(credit_balance=5)  # 이미 써버린 상태

    orders[0]["canceled"] = "T"
    summary = await cafe24.sync_orders(NOW + timedelta(days=1))
    again = await cafe24.sync_orders(NOW + timedelta(days=2))

    await member.refresh_from_db()
    assert member.credit_balance == -15  # 음수 잔액 허용(ADR-02)
    assert (summary["clawed_back"], again["clawed_back"]) == (1, 0)
    clawback = await CreditLedger.get(member_id=member.id, dedupe_key="clawback:o-1")
    assert clawback.amount == -20 and clawback.reason.value == "order_clawback"


async def test_cancel_without_prior_reward_does_nothing(orders: list[dict]):
    await _token()
    member = await _linked_member()
    orders.append(_order("o-1", canceled="T"))

    summary = await cafe24.sync_orders(NOW)

    await member.refresh_from_db()
    assert member.credit_balance == 0
    assert summary["clawed_back"] == 0 and summary["rewarded"] == 0


async def test_sync_window_starts_from_watermark_lookback_but_not_before_cutoff(
    orders: list[dict], monkeypatch: pytest.MonkeyPatch
):
    calls: list[tuple[datetime, datetime]] = []

    async def fake_fetch(access_token, start, end, member_id=None):
        calls.append((start, end))
        return []

    monkeypatch.setattr(cafe24, "_fetch_orders", fake_fetch)
    await _linked_member(cutoff=NOW - timedelta(days=100))
    await _token(synced=NOW - timedelta(days=200))

    await cafe24.sync_orders(NOW)

    # 워터마크-30일 = 230일 전이지만 최초 컷오프(100일 전)보다 앞설 이유 없음 → 100일 전부터, 90일 청크 2개
    assert calls[0][0] == NOW - timedelta(days=100)
    assert calls[0][1] == NOW - timedelta(days=10)
    assert calls[1] == (NOW - timedelta(days=10), NOW)


async def test_sync_without_token_or_linked_members_is_noop(orders: list[dict]):
    assert (await cafe24.sync_orders(NOW))["fetched"] == 0
    await _token()
    assert (await cafe24.sync_orders(NOW))["fetched"] == 0
    assert (await Cafe24OauthToken.get(mall_id="nutti")).last_synced_at is None


async def test_expiring_token_is_refreshed(monkeypatch: pytest.MonkeyPatch):
    await _token(expires_in=timedelta(minutes=2))
    sent: list[dict] = []

    async def fake_post(data: dict) -> dict:
        sent.append(data)
        return {
            "access_token": "new-access",
            "refresh_token": "new-refresh",
            "expires_at": "2026-09-01T14:00:00.000",  # KST, tz 없음
        }

    monkeypatch.setattr(cafe24, "_post_token", fake_post)

    assert await cafe24.get_access_token(NOW) == "new-access"

    assert sent == [{"grant_type": "refresh_token", "refresh_token": "refresh"}]
    token = await Cafe24OauthToken.get(mall_id="nutti")
    assert token.refresh_token == "new-refresh"
    assert token.expires_at == datetime(2026, 9, 1, 5, 0, tzinfo=timezone.utc)
    # 아직 유효하면 재호출 없음
    assert await cafe24.get_access_token(NOW) == "new-access"
    assert len(sent) == 1


async def test_refresh_failure_records_error_and_alerts(monkeypatch: pytest.MonkeyPatch):
    await _token(expires_in=timedelta(0))
    alerts: list[str] = []

    async def fake_post(data: dict) -> dict:
        raise httpx.HTTPStatusError("401", request=httpx.Request("POST", "x"), response=httpx.Response(401))

    async def fake_post_malformed(data: dict) -> dict:
        return {"error": "invalid_grant"}

    async def fake_alert(text: str) -> None:
        alerts.append(text)

    monkeypatch.setattr(cafe24, "_post_token", fake_post)
    monkeypatch.setattr(cafe24, "alert_admin", fake_alert)

    with pytest.raises(httpx.HTTPError):
        await cafe24.get_access_token(NOW)

    token = await Cafe24OauthToken.get(mall_id="nutti")
    assert token.last_refresh_error.startswith("HTTPStatusError")
    assert len(alerts) == 1 and "토큰 갱신 실패" in alerts[0]

    monkeypatch.setattr(cafe24, "_post_token", fake_post_malformed)
    with pytest.raises(KeyError):
        await cafe24.get_access_token(NOW)
    token = await Cafe24OauthToken.get(mall_id="nutti")
    assert token.last_refresh_error.startswith("KeyError")
    assert len(alerts) == 2


async def test_member_sync_rewards_only_that_member_and_is_throttled(orders: list[dict]):
    """크레딧 화면 진입 즉석 동기화 — 그 회원 주문만 카페24에 묻고(member_id 필터), 60초 안 재호출은 무시."""
    await _token()
    me = await _linked_member("c1")
    other = await _linked_member("c2")
    orders.extend([_order("o1", "c1"), _order("o2", "c2")])

    first = await cafe24.sync_member_orders(me, now=NOW)
    second = await cafe24.sync_member_orders(me, now=NOW)

    assert first["rewarded"] == 1 and first["fetched"] == 1
    assert second is None
    assert FETCH_CALLS == ["c1"]
    await me.refresh_from_db()
    await other.refresh_from_db()
    assert (me.credit_balance, other.credit_balance) == (20, 0)


async def test_member_sync_swallows_upstream_failure(monkeypatch: pytest.MonkeyPatch):
    await _token()
    me = await _linked_member("c1")

    async def boom(*args, **kwargs):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(cafe24, "_fetch_orders", boom)
    monkeypatch.setattr(cafe24, "_member_synced_at", {})

    assert await cafe24.sync_member_orders(me, now=NOW) is None


async def test_member_sync_noop_for_unlinked_member():
    member = await Member.create(kind=MemberKind.MEMBER)
    assert await cafe24.sync_member_orders(member, now=NOW) is None
