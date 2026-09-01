import hashlib
import hmac
import json
import os
import uuid
from datetime import datetime, timedelta, timezone

os.environ.setdefault("DATABASE_URL", "sqlite://:memory:")
os.environ.setdefault("APP_ENV", "development")

import pytest
from fastapi.testclient import TestClient
from tortoise import Tortoise

from app import instagram
from app.auth import create_token
from app.main import app
from app.models import InstagramDmCode, InstagramToken, Member, MemberKind
from app.settings import settings

SECRET = "ig-app-secret"
VERIFY = "verify-me"
OUR_IG_ID = "17841400000000001"


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "instagram_app_secret", SECRET)
    monkeypatch.setattr(settings, "instagram_webhook_verify_token", VERIFY)
    monkeypatch.setattr(settings, "instagram_comment_keywords", "놀이터, 크레딧")
    monkeypatch.setattr(settings, "instagram_landing_url", "https://play.nutti.co.kr")
    with TestClient(app) as test_client:
        test_client.portal.call(Tortoise.generate_schemas)
        test_client.portal.call(_our_token)
        yield test_client


@pytest.fixture
def graph(monkeypatch: pytest.MonkeyPatch) -> dict:
    """Graph 호출 대역 — 보낸 DM·비공개 답장을 잡아 두고, 프로필의 팔로우 여부는 테스트가 정한다."""
    calls: dict = {"private": [], "dm": [], "follows": {}}

    async def send_private_reply(comment_id: str, text: str) -> None:
        calls["private"].append((comment_id, text))

    async def send_message(igsid: str, text: str) -> None:
        calls["dm"].append((igsid, text))

    async def get_user_profile(igsid: str) -> dict:
        return {"username": f"user_{igsid}", "is_user_follow_business": calls["follows"].get(igsid, False)}

    monkeypatch.setattr(instagram, "send_private_reply", send_private_reply)
    monkeypatch.setattr(instagram, "send_message", send_message)
    monkeypatch.setattr(instagram, "get_user_profile", get_user_profile)
    return calls


async def _our_token() -> None:
    await InstagramToken.create(
        ig_user_id=OUR_IG_ID,
        username="nutti_official",
        access_token="long-lived",
        expires_at=datetime.now(timezone.utc) + timedelta(days=50),
    )


def _signed(payload: dict) -> tuple[bytes, dict]:
    raw = json.dumps(payload).encode()
    signature = hmac.new(SECRET.encode(), raw, hashlib.sha256).hexdigest()
    return raw, {"X-Hub-Signature-256": f"sha256={signature}", "Content-Type": "application/json"}


def _comment_event(text: str, author: str = "555", comment_id: str = "c1") -> dict:
    return {
        "object": "instagram",
        "entry": [
            {
                "id": OUR_IG_ID,
                "time": 1,
                "changes": [
                    {
                        "field": "comments",
                        "value": {"id": comment_id, "text": text, "from": {"id": author, "username": "someone"}, "media": {"id": "m1"}},
                    }
                ],
            }
        ],
    }


def _message_event(sender: str = "555", text: str = "완료", echo: bool = False) -> dict:
    message = {"mid": "m", "text": text}
    if echo:
        message["is_echo"] = True
    return {
        "object": "instagram",
        "entry": [
            {
                "id": OUR_IG_ID,
                "time": 1,
                "messaging": [{"sender": {"id": sender}, "recipient": {"id": OUR_IG_ID}, "timestamp": 1, "message": message}],
            }
        ],
    }


def _member_headers(client: TestClient, kind: MemberKind = MemberKind.MEMBER) -> tuple[str, dict]:
    async def create() -> str:
        return str((await Member.create(kind=kind, credit_balance=1)).id)

    member_id = client.portal.call(create)
    return member_id, {"Authorization": f"Bearer {create_token(uuid.UUID(member_id), kind.value, 0)}"}


async def _codes(igsid: str) -> list[InstagramDmCode]:
    return await InstagramDmCode.filter(igsid=igsid).order_by("id")


# ---------------------------------------------------------------- 구독 확인 · 서명


def test_webhook_verify_echoes_challenge_only_with_right_token(client: TestClient):
    ok = client.get("/v1/webhooks/instagram", params={"hub.mode": "subscribe", "hub.verify_token": VERIFY, "hub.challenge": "4242"})
    bad = client.get("/v1/webhooks/instagram", params={"hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "4242"})

    assert ok.status_code == 200 and ok.text == "4242"
    assert bad.status_code == 403


def test_webhook_rejects_bad_signature(client: TestClient, graph: dict):
    raw, headers = _signed(_comment_event("놀이터 가고 싶어요"))
    tampered = client.post("/v1/webhooks/instagram", content=raw + b" ", headers=headers)
    missing = client.post("/v1/webhooks/instagram", content=raw, headers={"Content-Type": "application/json"})

    assert tampered.status_code == 401 and missing.status_code == 401
    assert graph["private"] == []


# ---------------------------------------------------------------- 댓글 → 비공개 답장


def test_keyword_comment_gets_private_reply_but_others_do_not(client: TestClient, graph: dict):
    for event in (
        _comment_event("놀이터 링크 주세요", comment_id="c-keyword"),
        _comment_event("귀엽다", comment_id="c-plain"),
        _comment_event("놀이터", author=OUR_IG_ID, comment_id="c-ours"),  # 우리 계정의 답글
    ):
        raw, headers = _signed(event)
        assert client.post("/v1/webhooks/instagram", content=raw, headers=headers).status_code == 200

    assert [c for c, _ in graph["private"]] == ["c-keyword"]
    assert "팔로우" in graph["private"][0][1]


# ---------------------------------------------------------------- DM → 팔로우 확인 → 코드


def test_dm_from_non_follower_gets_reminder_and_no_code(client: TestClient, graph: dict):
    raw, headers = _signed(_message_event(sender="777"))

    assert client.post("/v1/webhooks/instagram", content=raw, headers=headers).status_code == 200

    assert graph["dm"] == [("777", instagram.NOT_FOLLOWING)]
    assert client.portal.call(_codes, "777") == []


def test_dm_from_follower_gets_one_code_even_when_webhook_repeats(client: TestClient, graph: dict):
    graph["follows"]["555"] = True
    raw, headers = _signed(_message_event(sender="555"))

    client.post("/v1/webhooks/instagram", content=raw, headers=headers)
    client.post("/v1/webhooks/instagram", content=raw, headers=headers)  # Meta 재전송

    codes = client.portal.call(_codes, "555")
    assert len(codes) == 1 and codes[0].follow_verified_at is not None and codes[0].ig_username == "user_555"
    assert len(graph["dm"]) == 2
    assert all(f"?ig={codes[0].code}" in text and codes[0].code in text for _, text in graph["dm"])


def test_echo_messages_are_ignored(client: TestClient, graph: dict):
    raw, headers = _signed(_message_event(sender=OUR_IG_ID, echo=True))
    response = client.post("/v1/webhooks/instagram", content=raw, headers=headers)

    assert response.status_code == 200
    assert graph["dm"] == []


# ---------------------------------------------------------------- 코드 소진 → follow_ig 크레딧


def test_redeem_grants_follow_credit_once_per_instagram_account(client: TestClient, graph: dict):
    graph["follows"]["555"] = True
    raw, headers = _signed(_message_event(sender="555"))
    client.post("/v1/webhooks/instagram", content=raw, headers=headers)
    code = client.portal.call(_codes, "555")[0].code
    _, first = _member_headers(client)
    _, second = _member_headers(client)

    ok = client.post("/v1/credits/redeem-instagram", headers=first, json={"code": code.lower()})
    again = client.post("/v1/credits/redeem-instagram", headers=first, json={"code": code})
    stolen = client.post("/v1/credits/redeem-instagram", headers=second, json={"code": code})

    assert ok.status_code == 200 and ok.json() == {"balance": 3, "amount_granted": 2}
    assert again.status_code == 409  # 같은 회원 재소진 — follow_ig dedupe
    assert stolen.status_code == 409 and stolen.json()["error"]["code"] == "INSTAGRAM_ALREADY_USED"


def test_redeem_blocks_second_code_from_same_instagram_account(client: TestClient, graph: dict):
    """코드를 다 쓴 뒤 다시 DM해 새 코드를 받아도 같은 인스타 계정이면 다른 놀이터 회원에게 못 준다."""
    graph["follows"]["555"] = True
    raw, headers = _signed(_message_event(sender="555"))
    client.post("/v1/webhooks/instagram", content=raw, headers=headers)
    first_code = client.portal.call(_codes, "555")[0].code
    _, first = _member_headers(client)
    assert client.post("/v1/credits/redeem-instagram", headers=first, json={"code": first_code}).status_code == 200

    client.post("/v1/webhooks/instagram", content=raw, headers=headers)  # 소진됐으니 새 코드 발급
    second_code = client.portal.call(_codes, "555")[1].code
    _, second = _member_headers(client)
    blocked = client.post("/v1/credits/redeem-instagram", headers=second, json={"code": second_code})

    assert second_code != first_code
    assert blocked.status_code == 409 and blocked.json()["error"]["code"] == "INSTAGRAM_ALREADY_USED"


def test_redeem_rejects_unknown_code_and_guest(client: TestClient):
    _, member = _member_headers(client)
    _, guest = _member_headers(client, MemberKind.GUEST)

    unknown = client.post("/v1/credits/redeem-instagram", headers=member, json={"code": "NOPE1234"})
    shape = client.post("/v1/credits/redeem-instagram", headers=member, json={"code": "no-good!"})
    as_guest = client.post("/v1/credits/redeem-instagram", headers=guest, json={"code": "NOPE1234"})

    assert unknown.status_code == 404 and unknown.json()["error"]["code"] == "INSTAGRAM_CODE_INVALID"
    assert shape.status_code == 400
    assert as_guest.status_code == 403
