import os
import uuid
from datetime import datetime, timedelta, timezone

os.environ.setdefault("DATABASE_URL", "sqlite://:memory:")
os.environ.setdefault("APP_ENV", "development")

import pytest
from fastapi.testclient import TestClient
from tortoise import Tortoise

from app.auth import create_token
from app.credits import charge_credits
from app.routers import credits as credits_router
from app.main import app
from app.models import (
    MetricEvent,
    AppSetting,
    CreditLedger,
    GenerationJob,
    Member,
    MemberKind,
    SourceImage,
    Style,
)


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        test_client.portal.call(Tortoise.generate_schemas)
        yield test_client


async def _create_member(kind: MemberKind, balance: int = 0) -> str:
    member = await Member.create(kind=kind, credit_balance=balance)
    return str(member.id)


def _session(client: TestClient, kind: MemberKind, balance: int = 0) -> tuple[str, dict[str, str]]:
    member_id = client.portal.call(_create_member, kind, balance)
    token = create_token(uuid.UUID(member_id), kind.value, 0)
    return member_id, {"Authorization": f"Bearer {token}"}


async def _set_credit_amounts():
    await AppSetting.create(key="order_reward_amount", value=30)
    await AppSetting.create(key="link_account_amount", value=5)
    await AppSetting.create(key="follow_ig_amount", value=7)
    await AppSetting.create(key="daily_free_amount", value=4)


async def _set_custom_prompt_credit_cost():
    await AppSetting.create(key="custom_prompt_credit_cost", value="3")


async def _opened_instagram(member_id: str, seconds_ago: int = 20) -> None:
    """「팔로우하러 가기」를 눌러 follow_ig_open 이벤트가 남은 상태를 만든다(기본 20초 전)."""
    event = await MetricEvent.create(member_id=member_id, event_type="follow_ig_open", meta={})
    event.created_at = datetime.now(timezone.utc) - timedelta(seconds=seconds_ago)
    await event.save(update_fields=["created_at"])


async def _member_and_entries(member_id: str):
    member = await Member.get(id=member_id)
    entries = await CreditLedger.filter(member_id=member_id).order_by("id")
    return member, entries


def test_earn_actions_and_claims_transition_states(client: TestClient):
    member_id, headers = _session(client, MemberKind.MEMBER, balance=5)
    client.portal.call(_set_credit_amounts)

    before = client.get("/v1/credits", headers=headers)

    assert before.status_code == 200
    assert before.json() == {
        "balance": 5,
        "custom_prompt_credit_cost": 2,
        "earn_actions": [
            {"action": "order", "amount": 30, "status": "available", "cta": "쇼핑몰 →"},
            {"action": "link_account", "amount": 5, "status": "available", "cta": "연동하기"},
            {"action": "follow_ig", "amount": 7, "status": "available", "cta": "받기"},
            {"action": "daily", "amount": 4, "status": "available", "cta": "받기"},
        ],
    }

    client.portal.call(_opened_instagram, member_id)
    follow = client.post(
        "/v1/credits/claim", headers=headers, json={"action": "follow_ig", "instagram_username": "@Kong.Mom"}
    )
    daily = client.post("/v1/credits/claim", headers=headers, json={"action": "daily"})
    after = client.get("/v1/credits", headers=headers)

    assert follow.status_code == daily.status_code == 200
    assert follow.json() == {"balance": 12, "amount_granted": 7}
    assert daily.json() == {"balance": 16, "amount_granted": 4}
    assert after.json()["balance"] == 16
    assert after.json()["earn_actions"][2] == {
        "action": "follow_ig",
        "amount": 7,
        "status": "done",
        "cta": None,
    }
    assert after.json()["earn_actions"][3] == {
        "action": "daily",
        "amount": 4,
        "status": "tomorrow",
        "cta": "내일 다시",
    }
    _, entries = client.portal.call(_member_and_entries, member_id)
    assert next(e.ref_id for e in entries if e.dedupe_key == "follow_ig") == "ig:kong.mom"  # 소문자·@ 제거
    today_kst = datetime.now(timezone(timedelta(hours=9))).date().isoformat()
    assert {entry.dedupe_key for entry in entries} == {"follow_ig", f"daily:{today_kst}"}


def test_guest_earn_actions_require_login(client: TestClient):
    _, headers = _session(client, MemberKind.GUEST, balance=3)

    response = client.get("/v1/credits", headers=headers)

    assert response.status_code == 200
    assert response.json() == {
        "balance": 3,
        "custom_prompt_credit_cost": 2,
        "earn_actions": [
            {"action": "order", "amount": 20, "status": "login_required", "cta": "로그인"},
            {
                "action": "link_account",
                "amount": 3,
                "status": "login_required",
                "cta": "로그인",
            },
            {
                "action": "follow_ig",
                "amount": 2,
                "status": "login_required",
                "cta": "로그인",
            },
            {"action": "daily", "amount": 1, "status": "login_required", "cta": "로그인"},
        ],
    }


def test_custom_prompt_credit_cost_uses_app_setting(client: TestClient):
    _, headers = _session(client, MemberKind.MEMBER)
    client.portal.call(_set_custom_prompt_credit_cost)

    response = client.get("/v1/credits", headers=headers)

    assert response.status_code == 200
    assert response.json()["custom_prompt_credit_cost"] == 3


def test_claim_rejects_duplicate_invalid_action_and_guest(client: TestClient):
    _, member_headers = _session(client, MemberKind.MEMBER)
    _, guest_headers = _session(client, MemberKind.GUEST)

    assert client.post(
        "/v1/credits/claim", headers=member_headers, json={"action": "daily"}
    ).status_code == 200
    duplicate = client.post(
        "/v1/credits/claim", headers=member_headers, json={"action": "daily"}
    )
    invalid = client.post(
        "/v1/credits/claim", headers=member_headers, json={"action": "survey"}
    )
    guest = client.post(
        "/v1/credits/claim", headers=guest_headers, json={"action": "daily"}
    )

    assert duplicate.status_code == 409
    assert duplicate.json()["error"] == {
        "code": "ALREADY_CLAIMED",
        "message": "이미 받은 크레딧이에요",
        "detail": {"action": "daily"},
    }
    assert invalid.status_code == 400
    assert invalid.json()["error"]["code"] == "VALIDATION_ERROR"
    assert guest.status_code == 403
    assert guest.json()["error"] == {
        "code": "MEMBER_ONLY",
        "message": "로그인이 필요합니다",
        "detail": {},
    }


async def _charge_scenarios():
    enough = await Member.create(kind=MemberKind.MEMBER, credit_balance=2)
    first = await charge_credits(
        enough.id, 2, "generation_charge", "job:enough", ref_id=str(uuid.uuid4())
    )
    second = await charge_credits(
        enough.id, 2, "generation_charge", "job:enough", ref_id=str(uuid.uuid4())
    )
    enough_member = await Member.get(id=enough.id)
    enough_entries = await CreditLedger.filter(member=enough).all()

    insufficient = await Member.create(kind=MemberKind.MEMBER, credit_balance=1)
    insufficient_result = await charge_credits(
        insufficient.id, 2, "generation_charge", "job:insufficient"
    )
    insufficient_entries = await CreditLedger.filter(member=insufficient).count()

    negative = await Member.create(kind=MemberKind.MEMBER, credit_balance=-1)
    negative_result = await charge_credits(negative.id, 1, "generation_charge", "job:negative")
    negative_entries = await CreditLedger.filter(member=negative).count()
    return {
        "first": first,
        "second": second,
        "enough_balance": enough_member.credit_balance,
        "enough_entries": enough_entries,
        "insufficient": insufficient_result,
        "insufficient_entries": insufficient_entries,
        "negative": negative_result,
        "negative_entries": negative_entries,
    }


def test_charge_credits_idempotent_on_same_dedupe_key(client: TestClient):
    # sqlite in-memory는 SELECT FOR UPDATE를 무시하므로(잠금 미지원) 이 테스트는 동시성이 아니라 순차 재호출의 멱등성만 검증합니다
    result = client.portal.call(_charge_scenarios)

    assert result["first"] == result["second"] == (True, 0)
    assert result["enough_balance"] == 0
    assert len(result["enough_entries"]) == 1
    assert result["enough_entries"][0].amount == -2
    assert result["enough_entries"][0].balance_after == 0
    assert result["insufficient"] == (False, 1)
    assert result["insufficient_entries"] == 0
    assert result["negative"] == (False, -1)
    assert result["negative_entries"] == 0


async def _charge_non_positive_costs():
    member = await Member.create(kind=MemberKind.MEMBER, credit_balance=5)
    zero = await charge_credits(member.id, 0, "generation_charge", "job:zero")
    negative = await charge_credits(member.id, -2, "generation_charge", "job:negative-cost")
    return zero, negative, await CreditLedger.filter(member=member).count()


def test_charge_credits_rejects_non_positive_costs(client: TestClient):
    zero, negative, entry_count = client.portal.call(_charge_non_positive_costs)

    assert zero == negative == (False, 5)
    assert entry_count == 0


async def _create_ledger_page(member_id: str):
    member = await Member.get(id=member_id)
    style = await Style.create(id=100, code="ledger-style", section="test", name="레고")
    source = await SourceImage.create(member=member, storage_key="ledger/source", quality_check={})
    job = await GenerationJob.create(
        member=member,
        source_image=source,
        style=style,
        idempotency_key=uuid.uuid4(),
        credit_cost=1,
    )
    for index in range(18):
        await CreditLedger.create(
            member=member,
            dedupe_key=f"daily:2026-07-{index + 1:02d}",
            reason="daily_free",
            amount=1,
            balance_after=index + 1,
        )
    await CreditLedger.create(
        member=member,
        dedupe_key=f"job:{job.id}",
        reason="generation_charge",
        ref_id=str(job.id),
        amount=-1,
        balance_after=17,
    )
    await CreditLedger.create(
        member=member,
        dedupe_key="order:20260802",
        reason="order_reward",
        ref_id="20260802",
        amount=20,
        balance_after=37,
    )
    await CreditLedger.create(
        member=member,
        dedupe_key="link_account",
        reason="link_account",
        amount=3,
        balance_after=40,
    )


def test_ledger_labels_and_cursor_pagination(client: TestClient):
    member_id, headers = _session(client, MemberKind.MEMBER)
    client.portal.call(_create_ledger_page, member_id)

    first = client.get("/v1/credits/ledger", headers=headers)

    assert first.status_code == 200
    first_body = first.json()
    assert len(first_body["items"]) == 20
    assert first_body["next_cursor"] is not None
    labels = {item["reason"]: item["ref_label"] for item in first_body["items"]}
    assert labels["generation_charge"] == "레고"
    assert labels["order_reward"] == "#20260802"
    assert labels["link_account"] is None
    assert all(len(item["occurred_on"]) == 10 for item in first_body["items"])

    second = client.get(
        "/v1/credits/ledger", headers=headers, params={"cursor": first_body["next_cursor"]}
    )

    assert second.status_code == 200
    assert len(second.json()["items"]) == 1
    assert second.json()["next_cursor"] is None


async def _create_ledger_at_utc_2300(member_id: str):
    member = await Member.get(id=member_id)
    entry = await CreditLedger.create(
        member=member,
        dedupe_key="daily:2026-08-02",
        reason="daily_free",
        amount=1,
        balance_after=1,
    )
    await CreditLedger.filter(id=entry.id).update(
        created_at=datetime(2026, 8, 1, 23, tzinfo=timezone.utc)
    )


def test_ledger_occurred_on_uses_kst_date(client: TestClient):
    member_id, headers = _session(client, MemberKind.MEMBER)
    client.portal.call(_create_ledger_at_utc_2300, member_id)

    response = client.get("/v1/credits/ledger", headers=headers)

    assert response.status_code == 200
    assert response.json()["items"][0]["occurred_on"] == "2026-08-02"


def test_ledger_rejects_cursor_outside_bigint_range(client: TestClient):
    _, headers = _session(client, MemberKind.MEMBER)

    response = client.get(
        "/v1/credits/ledger", headers=headers, params={"cursor": "99999999999999999999"}
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


async def _link_member(member_id: str):
    member = await Member.get(id=member_id)
    member.cafe24_member_id = "shop-1"
    member.order_reward_cutoff = datetime.now(timezone.utc)
    await member.save(update_fields=["cafe24_member_id", "order_reward_cutoff"])


def test_get_credits_syncs_linked_member_orders_before_reading_balance(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    """주문하고 돌아온 회원이 30분 크론을 기다리지 않게 — 화면 진입 시 그 회원 주문만 즉석 동기화."""
    from app import cafe24

    member_id, headers = _session(client, MemberKind.MEMBER, balance=1)
    client.portal.call(_link_member, member_id)
    synced: list[str] = []

    async def fake_sync(member, now=None):
        synced.append(member.cafe24_member_id)
        await Member.filter(id=member.id).update(credit_balance=21)  # +20 들어온 셈
        return {"rewarded": 1}

    monkeypatch.setattr(cafe24, "sync_member_orders", fake_sync)

    response = client.get("/v1/credits", headers=headers)

    assert response.status_code == 200
    assert response.json()["balance"] == 21  # 동기화 뒤 잔액을 다시 읽는다
    assert synced == ["shop-1"]


def test_get_credits_skips_sync_for_unlinked_member(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    from app import cafe24

    _, headers = _session(client, MemberKind.MEMBER, balance=1)

    async def fake_sync(member, now=None):
        raise AssertionError("unlinked member must not trigger cafe24 calls")

    monkeypatch.setattr(cafe24, "sync_member_orders", fake_sync)

    assert client.get("/v1/credits", headers=headers).status_code == 200


def test_follow_ig_requires_username_open_event_and_unique_handle(client: TestClient):
    """인스타 팔로우 +2 — 아이디 필수 · 누띠 계정을 연 뒤 10초~30분 · 같은 아이디는 전 회원 1회."""
    first_id, first = _session(client, MemberKind.MEMBER)
    second_id, second = _session(client, MemberKind.MEMBER)

    no_username = client.post("/v1/credits/claim", headers=first, json={"action": "follow_ig"})
    bad_username = client.post(
        "/v1/credits/claim", headers=first, json={"action": "follow_ig", "instagram_username": "kong mom!"}
    )
    not_opened = client.post(
        "/v1/credits/claim", headers=first, json={"action": "follow_ig", "instagram_username": "kongmom"}
    )
    client.portal.call(_opened_instagram, first_id, 3)  # 방금 열었음 — 10초 안 지남
    too_fast = client.post(
        "/v1/credits/claim", headers=first, json={"action": "follow_ig", "instagram_username": "kongmom"}
    )
    client.portal.call(_opened_instagram, first_id, 20)
    ok = client.post(
        "/v1/credits/claim", headers=first, json={"action": "follow_ig", "instagram_username": "kongmom"}
    )
    probe_without_open = client.post(  # 열지 않고 남의 아이디를 찔러 봐도 «이미 썼다» 는 답을 주지 않는다
        "/v1/credits/claim", headers=second, json={"action": "follow_ig", "instagram_username": "kongmom"}
    )
    client.portal.call(_opened_instagram, second_id, 20)
    reused = client.post(
        "/v1/credits/claim", headers=second, json={"action": "follow_ig", "instagram_username": "@KONGMOM"}
    )

    assert no_username.status_code == 400 and no_username.json()["error"]["code"] == "VALIDATION_ERROR"
    assert bad_username.status_code == 400
    assert not_opened.status_code == 400 and not_opened.json()["error"]["code"] == "FOLLOW_IG_NOT_OPENED"
    assert too_fast.status_code == 400 and too_fast.json()["error"]["code"] == "FOLLOW_IG_NOT_OPENED"
    assert ok.status_code == 200 and ok.json()["amount_granted"] == 2
    assert probe_without_open.status_code == 400 and probe_without_open.json()["error"]["code"] == "FOLLOW_IG_NOT_OPENED"
    assert reused.status_code == 409 and reused.json()["error"]["code"] == "INSTAGRAM_ALREADY_USED"


def test_follow_ig_open_event_expires_after_30_minutes(client: TestClient):
    member_id, headers = _session(client, MemberKind.MEMBER)
    client.portal.call(_opened_instagram, member_id, 31 * 60)

    stale = client.post(
        "/v1/credits/claim", headers=headers, json={"action": "follow_ig", "instagram_username": "late"}
    )

    assert stale.status_code == 400 and stale.json()["error"]["code"] == "FOLLOW_IG_NOT_OPENED"
    assert credits_router.FOLLOW_IG_MAX_AGE == timedelta(minutes=30)


def test_grant_credits_rejects_reason_sign_mismatch(client: TestClient):
    """L5(#11): 사유와 어긋난 부호·0 지급은 원장에 닿기 전에 ValueError. cs_adjustment만 양방향."""
    from app.credits import grant_credits

    member_id = client.portal.call(_create_member, MemberKind.MEMBER, 5)

    async def _attempt(delta: int, reason: str):
        try:
            await grant_credits(uuid.UUID(member_id), delta, reason, f"sign:{reason}:{delta}")
        except ValueError:
            return "rejected"
        return "granted"

    assert client.portal.call(_attempt, -1, "daily_free") == "rejected"
    assert client.portal.call(_attempt, 1, "order_clawback") == "rejected"
    assert client.portal.call(_attempt, 1, "no_such_reason") == "rejected"
    assert client.portal.call(_attempt, -1, "cs_adjustment") == "granted"
    # 0은 거부하지 않는다 — 보상액 0 설정(무료 프로모션)이 claim 500·워커 사망으로 번지면 안 됨(보안 리뷰)
    assert client.portal.call(_attempt, 0, "daily_free") == "granted"
