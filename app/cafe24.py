"""카페24 Admin API 토큰 관리 + 주문 보상 동기화 배치 — 06-architecture §6, ADR-09, Q3.

- 토큰: `cafe24_oauth_token` 단일 행. 만료 임박 시 FOR UPDATE 잠금 아래에서만 refresh.
  실패는 `last_refresh_error`에 남기고 Slack(ADMIN_ALERT_SLACK_WEBHOOK_URL)으로 알린다.
- 배치: 워터마크(`last_synced_at`) − 룩백 구간의 주문을 조회해 결제 완료 주문에 +보상,
  취소 주문에 전액 회수. 멱등성은 credit_ledger UNIQUE(member, dedupe_key)가 보장한다.
"""

import logging
from datetime import datetime, timedelta, timezone

import httpx
from tortoise.transactions import in_transaction

from app.common import KST
from app.credits import grant_credits
from app.models import Cafe24OauthToken, CreditLedger, CreditReason, Member
from app.routers.credits import _amounts
from app.settings import settings

logger = logging.getLogger(__name__)

REFRESH_MARGIN = timedelta(minutes=5)
# ponytail: 취소는 주문일 이후 언제든 올 수 있어 워터마크 뒤 30일을 매번 다시 훑는다.
# updated_date 필터로 좁히는 건 재조회 비용이 문제될 때.
LOOKBACK = timedelta(days=30)
CHUNK = timedelta(days=90)  # 카페24 주문 조회 기간 상한(3개월)
PAGE_SIZE = 100


def _base_url() -> str:
    return f"https://{settings.cafe24_mall_id}.cafe24api.com/api/v2"


def _parse_dt(value: str) -> datetime:
    """카페24 시각 문자열 → aware datetime (tz 없으면 KST)."""
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=KST)


async def alert_admin(text: str) -> None:
    if not settings.admin_alert_slack_webhook_url:
        return
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(settings.admin_alert_slack_webhook_url, json={"text": text})
    except httpx.HTTPError:
        logger.exception("Slack alert failed")


async def _post_token(data: dict) -> dict:
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.post(
            f"{_base_url()}/oauth/token",
            auth=(settings.cafe24_client_id, settings.cafe24_client_secret),
            data=data,
        )
        response.raise_for_status()
        return response.json()


async def store_token(token_data: dict) -> Cafe24OauthToken:
    """OAuth 토큰 응답을 단일 행에 upsert."""
    fields = {
        "access_token": token_data["access_token"],
        "refresh_token": token_data["refresh_token"],
        "expires_at": _parse_dt(token_data["expires_at"]),
        "last_refresh_error": None,
    }
    token = await Cafe24OauthToken.get_or_none(mall_id=settings.cafe24_mall_id)
    if token is None:
        return await Cafe24OauthToken.create(mall_id=settings.cafe24_mall_id, **fields)
    await token.update_from_dict(fields).save()
    return token


async def exchange_code(code: str) -> Cafe24OauthToken:
    """운영자가 authorize 화면에서 받은 code → 토큰 저장 (scripts/cafe24_token.py)."""
    data = await _post_token(
        {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": settings.cafe24_redirect_uri,
        }
    )
    return await store_token(data)


async def get_access_token(now: datetime | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    try:
        async with in_transaction() as connection:
            token = await Cafe24OauthToken.select_for_update().using_db(connection).first()
            if token is None:
                raise RuntimeError("cafe24 token missing — run scripts/cafe24_token.py first")
            if token.expires_at - REFRESH_MARGIN > now:
                return token.access_token
            data = await _post_token(
                {"grant_type": "refresh_token", "refresh_token": token.refresh_token}
            )
            token.access_token = data["access_token"]
            token.refresh_token = data["refresh_token"]
            token.expires_at = _parse_dt(data["expires_at"])
            token.last_refresh_error = None
            await token.save(
                update_fields=["access_token", "refresh_token", "expires_at", "last_refresh_error"],
                using_db=connection,
            )
            return token.access_token
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        # 트랜잭션 밖에서 기록 — 안에서 저장하면 예외 전파로 롤백된다. KeyError/ValueError = 응답 형식 오류.
        error = f"{type(exc).__name__}: {exc}"[:500]
        await Cafe24OauthToken.filter(id=token.id).update(last_refresh_error=error)
        # ponytail: 배치가 30분 주기면 자연히 30분 재알림 — 별도 dedup 타이머 없음
        await alert_admin(f":rotating_light: 카페24 토큰 갱신 실패 — {error}")
        raise


async def find_customers(*, member_id: str | None = None, cellphone: str | None = None) -> list[str]:
    """Admin API로 쇼핑몰 회원 아이디 조회(scope mall.read_customer) — 아이디 또는 휴대폰 번호로.
    개인정보 필드는 마스킹돼 돌아오므로 member_id만 쓴다. 한 번호에 계정이 여러 개일 수 있다(실측 3개)."""
    params = {"member_id": member_id} if member_id else {"cellphone": cellphone}
    token = await get_access_token()
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.get(
            f"{_base_url()}/admin/customers",
            headers={"Authorization": f"Bearer {token}"},
            params={**params, "fields": "member_id"},
        )
        response.raise_for_status()
        return [row["member_id"] for row in response.json().get("customers", [])]


async def send_sms(shop_member_id: str, content: str) -> None:
    """카페24 SMS로 쇼핑몰 회원에게 발송 — 수신자를 `member_id`로 지정하므로 전화번호를 몰라도 된다
    (`recipients`는 전화번호 전용이라 아이디를 넣으면 422). scope mall.write_notification + 몰 SMS 서비스 사용 설정 +
    잔액 + `sender_no`=**발신번호 등록 ID**(`GET /admin/sms/senders`의 sender_no — 전화번호를 넣으면 422 "There is no sender",
    실호출로 확인 2026-09-01) 필요. API 한도 1req/s. 실패는 httpx.HTTPError로 전파."""
    token = await get_access_token()
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.post(
            f"{_base_url()}/admin/sms",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "shop_no": 1,
                "request": {
                    "sender_no": settings.cafe24_sms_sender_no,
                    "content": content,
                    "member_id": [shop_member_id],
                    "type": "SMS",
                },
            },
        )
        response.raise_for_status()


async def _fetch_orders(access_token: str, start: datetime, end: datetime) -> list[dict]:
    """[start, end] 구간 주문 전부(페이지네이션 포함). 날짜는 KST 일 단위."""
    orders: list[dict] = []
    offset = 0
    async with httpx.AsyncClient(timeout=30) as client:
        while True:
            response = await client.get(
                f"{_base_url()}/admin/orders",
                headers={"Authorization": f"Bearer {access_token}"},
                params={
                    "start_date": start.astimezone(KST).date().isoformat(),
                    "end_date": end.astimezone(KST).date().isoformat(),
                    "limit": PAGE_SIZE,
                    "offset": offset,
                },
            )
            response.raise_for_status()
            page = response.json().get("orders", [])
            orders.extend(page)
            if len(page) < PAGE_SIZE:
                return orders
            offset += PAGE_SIZE


async def _apply_order(order: dict, amount: int, summary: dict[str, int]) -> None:
    order_id = str(order["order_id"])
    cafe24_member_id = order.get("member_id")
    if not cafe24_member_id:  # 비회원 주문 — NULL 매칭으로 미연동 회원과 충돌 방지
        summary["skipped_unlinked"] += 1
        return
    member = await Member.get_or_none(
        cafe24_member_id=cafe24_member_id, withdrawn_at=None, merged_into_id__isnull=True
    )
    if member is None or member.order_reward_cutoff is None:
        summary["skipped_unlinked"] += 1
        return
    if _parse_dt(order["order_date"]) < member.order_reward_cutoff:
        summary["skipped_before_cutoff"] += 1
        return

    if order.get("canceled") == "T":
        reward = await CreditLedger.get_or_none(member_id=member.id, dedupe_key=f"order:{order_id}")
        if reward is not None and await grant_credits(
            member.id, -reward.amount, CreditReason.ORDER_CLAWBACK.value,
            f"clawback:{order_id}", ref_id=order_id,
        ):
            summary["clawed_back"] += 1
        return
    if order.get("paid") != "T":
        summary["skipped_unpaid"] += 1
        return
    if await grant_credits(
        member.id, amount, CreditReason.ORDER_REWARD.value, f"order:{order_id}", ref_id=order_id
    ):
        summary["rewarded"] += 1


async def sync_orders(now: datetime | None = None) -> dict[str, int]:
    now = now or datetime.now(timezone.utc)
    summary = {
        "fetched": 0, "rewarded": 0, "clawed_back": 0,
        "skipped_unlinked": 0, "skipped_before_cutoff": 0, "skipped_unpaid": 0,
        "skipped_malformed": 0,
    }
    token = await Cafe24OauthToken.first()
    if token is None:
        logger.warning("cafe24 order sync skipped: no token")
        return summary
    earliest_cutoff = (
        await Member.filter(order_reward_cutoff__isnull=False, withdrawn_at=None)
        .order_by("order_reward_cutoff")
        .values_list("order_reward_cutoff", flat=True)
    )
    if not earliest_cutoff:
        return summary  # 연동 회원 없음 — 조회할 이유 없음
    start = (token.last_synced_at or now) - LOOKBACK
    start = max(start, earliest_cutoff[0])

    access_token = await get_access_token(now)
    amount = (await _amounts())["order_reward_amount"]
    cursor = start
    while cursor < now:
        chunk_end = min(cursor + CHUNK, now)
        for order in await _fetch_orders(access_token, cursor, chunk_end):
            summary["fetched"] += 1
            try:
                await _apply_order(order, amount, summary)
            except (KeyError, ValueError):  # 형식 오류 주문 하나가 배치를 죽이지 않게 건별 스킵
                logger.exception("cafe24 order skipped: malformed %r", order.get("order_id"))
                summary["skipped_malformed"] += 1
        cursor = chunk_end

    token.last_synced_at = now
    await token.save(update_fields=["last_synced_at"])
    return summary
