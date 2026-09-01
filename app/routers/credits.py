import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from tortoise.expressions import Q

from app.auth import get_current_member
from app.common import KST, api_error, member_only, validation_error
from app.credits import custom_prompt_credit_cost, grant_credits
from app.instagram import CODE_TTL as INSTAGRAM_CODE_TTL
from app.models import (
    AppSetting,
    CreditLedger,
    CreditReason,
    GenerationJob,
    InstagramDmCode,
    Member,
    MemberKind,
    MetricEvent,
)

router = APIRouter(prefix="/credits", tags=["credits"])

_AMOUNT_DEFAULTS = {
    "order_reward_amount": 20,
    "link_account_amount": 3,
    "follow_ig_amount": 2,
    "daily_free_amount": 1,
}
_JOB_REASONS = {
    CreditReason.GENERATION_CHARGE,
    CreditReason.GENERATION_REFUND,
    CreditReason.SAFETY_BLOCK_REFUND,
}


class EarnActionResponse(BaseModel):
    action: str
    amount: int
    status: str
    cta: str | None = None


class CreditsResponse(BaseModel):
    balance: int
    earn_actions: list[EarnActionResponse]
    custom_prompt_credit_cost: int


class ClaimCreditRequest(BaseModel):
    action: str
    # follow_ig 전용 — 인스타 아이디(선행 @ 허용). 인스타는 팔로우 여부 조회 API를 제3자에게 열지 않으므로
    # (Basic Display 폐지, Graph API는 본인 계정 한정) 검증 대신 "아이디 실명 + 전역 1회 + 열어본 직후"로 어뷰징을 막는다.
    instagram_username: str | None = Field(default=None, max_length=31, pattern=r"^@?[A-Za-z0-9._]{1,30}$")


# 팔로우 받기는 "누띠 계정을 열어본 뒤" FOLLOW_IG_MIN_DELAY~FOLLOW_IG_MAX_AGE 사이에만 — 열지도 않고 누르는 봇/연타 차단
FOLLOW_IG_OPEN_EVENT = "follow_ig_open"
FOLLOW_IG_MIN_DELAY = timedelta(seconds=10)
FOLLOW_IG_MAX_AGE = timedelta(minutes=30)


class ClaimCreditResponse(BaseModel):
    balance: int
    amount_granted: int


class LedgerItemResponse(BaseModel):
    reason: str
    ref_label: str | None = None
    occurred_on: date
    amount: int


class LedgerResponse(BaseModel):
    items: list[LedgerItemResponse]
    next_cursor: str | None = None


def _kst_today() -> date:
    return datetime.now(KST).date()


async def _verify_follow_ig(member: Member, instagram_username: str | None) -> str:
    """팔로우 +2 조건 검사 → 원장 ref_id("ig:<아이디>") 반환. 검증 불가한 팔로우 대신 세 겹의 마찰:
    ① 아이디 실명(관리자가 실제 팔로워와 대조·회수 가능) ② 같은 아이디는 전 회원 통틀어 1회 ③ 누띠 계정을 연 뒤에만."""
    if not instagram_username:
        raise validation_error("instagram_username이 필요합니다", {"action": "follow_ig"})
    username = instagram_username.lstrip("@").lower()
    ref_id = f"ig:{username}"
    now = datetime.now(timezone.utc)
    opened = await MetricEvent.filter(
        member_id=member.id,
        event_type=FOLLOW_IG_OPEN_EVENT,
        created_at__gte=now - FOLLOW_IG_MAX_AGE,
        created_at__lte=now - FOLLOW_IG_MIN_DELAY,
    ).exists()
    if not opened:
        raise api_error(
            400, "FOLLOW_IG_NOT_OPENED", "먼저 「팔로우하러 가기」로 누띠 인스타그램을 열어 주세요", {"action": "follow_ig"}
        )
    # 아이디 중복 검사는 열기 검사 **뒤** — 열지도 않은 채 남의 아이디를 넣어 "이미 썼는지" 캐묻는 열거를 막는다(보안 리뷰).
    # ponytail: 존재 검사 후 지급 — 동시 요청 경합은 원장 UNIQUE(member, dedupe_key)가 회원당 1회는 막고,
    # 아이디 전역 1회의 경합 창은 관리자 목록 대조로 흡수. ref_id UNIQUE 인덱스는 어뷰징 실측 후.
    if await CreditLedger.filter(reason=CreditReason.FOLLOW_IG.value, ref_id=ref_id).exists():
        raise api_error(409, "INSTAGRAM_ALREADY_USED", "이미 다른 계정에서 사용한 인스타그램 아이디예요", {"instagram_username": username})
    return ref_id


async def _amounts() -> dict[str, int]:
    rows = await AppSetting.filter(key__in=_AMOUNT_DEFAULTS).all()
    return {**_AMOUNT_DEFAULTS, **{row.key: int(row.value) for row in rows}}


@router.get("", response_model=CreditsResponse)
async def get_credits(member: Member = Depends(get_current_member)):
    if member.cafe24_member_id is not None:
        # 주문하고 돌아온 회원에게 30분 크론을 기다리게 하지 않는다 — 이 회원 주문만 즉석 동기화(60초 1회, 실패 무시)
        from app import cafe24  # cafe24 → credits._amounts 순환 import 회피

        if await cafe24.sync_member_orders(member) is not None:
            await member.refresh_from_db(fields=["credit_balance"])
    amounts = await _amounts()
    daily_key = f"daily:{_kst_today().isoformat()}"
    claimed = set(
        await CreditLedger.filter(
            member=member, dedupe_key__in=["link_account", "follow_ig", daily_key]
        ).values_list("dedupe_key", flat=True)
    )
    earn_actions = [
        {
            "action": "order",
            "amount": amounts["order_reward_amount"],
            "status": "available",
            "cta": "쇼핑몰 →",
        },
        {
            "action": "link_account",
            "amount": amounts["link_account_amount"],
            "status": "done" if "link_account" in claimed else "available",
            "cta": None if "link_account" in claimed else "연동하기",
        },
        {
            "action": "follow_ig",
            "amount": amounts["follow_ig_amount"],
            "status": "done" if "follow_ig" in claimed else "available",
            "cta": None if "follow_ig" in claimed else "받기",
        },
        {
            "action": "daily",
            "amount": amounts["daily_free_amount"],
            "status": "tomorrow" if daily_key in claimed else "available",
            "cta": "내일 다시" if daily_key in claimed else "받기",
        },
    ]
    if member.kind == MemberKind.GUEST:
        for action in earn_actions:
            action.update(status="login_required", cta="로그인")
    # ponytail: API는 원장 캐시의 실제 값을 전달하고 화면용 0 클램프는 프론트에 맡긴다.
    return {
        "balance": member.credit_balance,
        "earn_actions": earn_actions,
        "custom_prompt_credit_cost": await custom_prompt_credit_cost(),
    }


@router.post("/claim", response_model=ClaimCreditResponse)
async def claim_credit(body: ClaimCreditRequest, member: Member = Depends(get_current_member)):
    if member.kind == MemberKind.GUEST:
        raise member_only()
    if body.action not in {"follow_ig", "daily"}:
        raise validation_error()

    amounts = await _amounts()
    ref_id = None
    if body.action == "follow_ig":
        amount = amounts["follow_ig_amount"]
        dedupe_key = reason = "follow_ig"
        ref_id = await _verify_follow_ig(member, body.instagram_username)
    else:
        amount = amounts["daily_free_amount"]
        dedupe_key = f"daily:{_kst_today().isoformat()}"
        reason = "daily_free"

    if not await grant_credits(member.id, amount, reason, dedupe_key, ref_id=ref_id):
        raise api_error(
            409,
            "ALREADY_CLAIMED",
            "이미 받은 크레딧이에요",
            {"action": body.action},
        )
    await member.refresh_from_db(fields=["credit_balance"])
    return {"balance": member.credit_balance, "amount_granted": amount}


class RedeemInstagramRequest(BaseModel):
    code: str = Field(min_length=6, max_length=16, pattern=r"^[A-Za-z0-9]+$")


@router.post("/redeem-instagram", response_model=ClaimCreditResponse)
async def redeem_instagram_code(body: RedeemInstagramRequest, member: Member = Depends(get_current_member)):
    """인스타 DM으로 받은 1회용 코드 → follow_ig 크레딧. 코드는 팔로우가 **API로 확인된** 사용자에게만 발급되므로
    (app/instagram.handle_message) 아이디 입력·열기 이벤트 없이 바로 지급한다. 인스타 계정(igsid)당 1회."""
    if member.kind == MemberKind.GUEST:
        raise member_only()
    now = datetime.now(timezone.utc)
    dm_code = await InstagramDmCode.get_or_none(code=body.code.upper())
    if dm_code is None or dm_code.follow_verified_at is None or dm_code.created_at < now - INSTAGRAM_CODE_TTL:
        raise api_error(404, "INSTAGRAM_CODE_INVALID", "코드가 올바르지 않거나 만료됐어요")
    if dm_code.redeemed_member_id is not None and dm_code.redeemed_member_id != member.id:
        raise api_error(409, "INSTAGRAM_ALREADY_USED", "이미 다른 계정에서 사용한 코드예요")
    if await InstagramDmCode.filter(igsid=dm_code.igsid, redeemed_member_id__isnull=False).exclude(
        redeemed_member_id=member.id
    ).exists():
        raise api_error(409, "INSTAGRAM_ALREADY_USED", "이 인스타그램 계정으로는 이미 크레딧을 받았어요")
    amounts = await _amounts()
    amount = amounts["follow_ig_amount"]
    granted = await grant_credits(
        member.id, amount, "follow_ig", "follow_ig", ref_id=f"ig:{dm_code.ig_username or dm_code.igsid}"
    )
    if not granted:
        raise api_error(409, "ALREADY_CLAIMED", "이미 받은 크레딧이에요", {"action": "follow_ig"})
    dm_code.redeemed_member_id = member.id
    dm_code.redeemed_at = now
    await dm_code.save(update_fields=["redeemed_member_id", "redeemed_at"])
    await member.refresh_from_db(fields=["credit_balance"])
    return {"balance": member.credit_balance, "amount_granted": amount}


@router.get("/ledger", response_model=LedgerResponse)
async def get_credit_ledger(
    cursor: str | None = None, member: Member = Depends(get_current_member)
):
    query = CreditLedger.filter(member=member)
    if cursor is not None:
        try:
            cursor_id = int(cursor)
            if not 0 < cursor_id < 2**63:
                raise ValueError
        except ValueError as exc:
            raise validation_error() from exc
        cursor_entry = await CreditLedger.get_or_none(member=member, id=cursor_id)
        if cursor_entry is None:
            raise validation_error()
        query = query.filter(
            Q(created_at__lt=cursor_entry.created_at)
            | Q(created_at=cursor_entry.created_at, id__lt=cursor_entry.id)
        )

    entries = await query.order_by("-created_at", "-id").limit(21)
    page = entries[:20]
    job_ids = []
    for entry in page:
        if entry.reason in _JOB_REASONS and entry.ref_id:
            try:
                job_ids.append(uuid.UUID(entry.ref_id))
            except ValueError:
                pass
    jobs = await GenerationJob.filter(id__in=job_ids).prefetch_related("style") if job_ids else []
    style_names = {str(job.id): job.style.name if job.style else None for job in jobs}

    items = []
    for entry in page:
        if entry.reason in _JOB_REASONS:
            ref_label = style_names.get(entry.ref_id)
        elif entry.reason == CreditReason.ORDER_REWARD:
            ref_label = f"#{entry.ref_id}" if entry.ref_id is not None else None
        else:
            ref_label = None
        items.append(
            {
                "reason": entry.reason.value,
                "ref_label": ref_label,
                "occurred_on": entry.created_at.astimezone(KST).date(),
                "amount": entry.amount,
            }
        )
    return {"items": items, "next_cursor": str(page[-1].id) if len(entries) > 20 else None}
