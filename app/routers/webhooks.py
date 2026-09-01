"""카페24 웹훅 수신 — 주문 이벤트가 오면 그 회원의 주문만 즉시 동기화한다.

페이로드의 paid/canceled를 믿지 않는다: 이벤트는 "이 회원 주문을 다시 봐라"라는 신호일 뿐이고, 판정은 배치와
같은 코드(`cafe24.sync_member_orders` → Admin API 재조회 → `_apply_order`)가 한다. 그래서 위조·중복·순서 뒤바뀜에
안전하고, 웹훅이 누락돼도 크레딧 화면 진입·30분 크론이 보정한다(카페24 문서도 웹훅 단독 운영을 비권장).

인증: 카페24는 개발자센터 "WebHook 인증정보"를 `X-API-Key` 헤더로 그대로 보낸다 → 상수 시간 비교.
"""

import json
import logging
import secrets

from fastapi import APIRouter, BackgroundTasks, Header, Query, Request
from fastapi.responses import PlainTextResponse

from app import cafe24, instagram
from app.common import api_error
from app.models import Member, MemberKind
from app.settings import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhooks", tags=["webhooks"])

# 쇼핑몰 > 주문: 접수(90023) · 입금상태 변경(90025) · 취소상태 변경(90026, 일괄 90072) · 환불상태 변경(90029, 일괄 90073)
ORDER_EVENTS = {90023, 90025, 90026, 90072, 90029, 90073}


async def _resync(member: Member) -> None:
    summary = await cafe24.sync_member_orders(member, force=True)
    logger.info("cafe24 webhook resync member=%s summary=%s", member.id, summary)


@router.post("/cafe24", status_code=202)
async def cafe24_webhook(
    request: Request,
    background: BackgroundTasks,
    x_api_key: str | None = Header(default=None),
) -> dict:
    if not settings.cafe24_webhook_api_key or x_api_key is None or not secrets.compare_digest(
        x_api_key, settings.cafe24_webhook_api_key
    ):
        raise api_error(401, "UNAUTHORIZED", "invalid webhook key")
    try:
        payload = await request.json()
        event_no = int(payload["event_no"])
        resource = payload["resource"]
        mall_id = str(resource.get("mall_id", ""))
        shop_member_id = resource.get("member_id")
    except (ValueError, KeyError, TypeError, AttributeError):
        raise api_error(400, "VALIDATION_ERROR", "malformed webhook payload")

    # 항상 202 — 관심 없는 이벤트/다른 몰/미연동 회원은 조용히 무시(카페24 재시도·자동 미수신 처리를 피한다)
    if mall_id != settings.cafe24_mall_id or event_no not in ORDER_EVENTS or not shop_member_id:
        return {"accepted": False}
    member = await Member.get_or_none(
        kind=MemberKind.MEMBER,
        cafe24_member_id=str(shop_member_id),
        withdrawn_at=None,
        merged_into_id__isnull=True,
    )
    if member is None or member.order_reward_cutoff is None:
        return {"accepted": False}
    # 응답은 즉시, 동기화는 뒤에서 — 카페24 웹훅 타임아웃·실패율 집계에 걸리지 않게
    background.add_task(_resync, member)
    return {"accepted": True}


# ---------------------------------------------------------------- 인스타 (댓글→DM 퍼널, app/instagram.py)


@router.get("/instagram")
async def instagram_verify(
    hub_mode: str | None = Query(default=None, alias="hub.mode"),
    hub_challenge: str | None = Query(default=None, alias="hub.challenge"),
    hub_verify_token: str | None = Query(default=None, alias="hub.verify_token"),
) -> PlainTextResponse:
    """Meta 웹훅 구독 확인 — 콘솔의 «확인 토큰»이 일치하면 challenge를 그대로 돌려준다."""
    expected = settings.instagram_webhook_verify_token
    if hub_mode != "subscribe" or not expected or not secrets.compare_digest((hub_verify_token or "").encode(), expected.encode()):
        raise api_error(403, "UNAUTHORIZED", "invalid verify token")
    return PlainTextResponse(hub_challenge or "")


@router.post("/instagram")
async def instagram_webhook(
    request: Request,
    background: BackgroundTasks,
    x_hub_signature_256: str | None = Header(default=None),
) -> dict:
    """댓글·메시지 이벤트 — 서명(앱 시크릿 HMAC) 검증 후 백그라운드 처리, 응답은 즉시 200(Meta 재시도·구독 해제 회피)."""
    raw = await request.body()
    if not instagram.verify_signature(raw, x_hub_signature_256):
        raise api_error(401, "UNAUTHORIZED", "invalid signature")
    try:
        payload = json.loads(raw)
    except ValueError:
        raise api_error(400, "VALIDATION_ERROR", "malformed webhook payload")
    if not isinstance(payload, dict) or payload.get("object") != "instagram":
        return {"accepted": False}
    queued = 0
    for entry in payload.get("entry") or []:
        for change in entry.get("changes") or []:
            if change.get("field") == "comments" and isinstance(change.get("value"), dict):
                background.add_task(instagram.handle_comment, change["value"])
                queued += 1
        for event in entry.get("messaging") or []:
            if isinstance(event, dict) and "message" in event:
                background.add_task(instagram.handle_message, event)
                queued += 1
    return {"accepted": queued > 0}
