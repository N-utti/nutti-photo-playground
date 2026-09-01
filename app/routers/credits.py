import uuid
from datetime import date, datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from tortoise.expressions import Q

from app.auth import get_current_member
from app.common import KST, api_error, member_only, validation_error
from app.credits import custom_prompt_credit_cost, grant_credits
from app.models import AppSetting, CreditLedger, CreditReason, GenerationJob, Member, MemberKind

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
    if body.action == "follow_ig":
        amount = amounts["follow_ig_amount"]
        dedupe_key = reason = "follow_ig"
    else:
        amount = amounts["daily_free_amount"]
        dedupe_key = f"daily:{_kst_today().isoformat()}"
        reason = "daily_free"

    if not await grant_credits(member.id, amount, reason, dedupe_key):
        raise api_error(
            409,
            "ALREADY_CLAIMED",
            "이미 받은 크레딧이에요",
            {"action": body.action},
        )
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
