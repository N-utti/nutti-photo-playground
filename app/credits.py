"""크레딧 원장과 잔액 캐시를 함께 갱신한다."""

import logging
import uuid

from tortoise.exceptions import IntegrityError
from tortoise.transactions import in_transaction

from app.models import AppSetting, CreditLedger, Member

logger = logging.getLogger(__name__)

# L5(#11): 지급 사유별 delta 부호 — 역부호 지급 버그를 원장에 쓰기 전에 차단. 0 = 양방향 허용.
_REASON_SIGN = {
    "generation_charge": -1,
    "generation_refund": 1,
    "safety_block_refund": 1,
    "guest_trial": 1,
    "link_account": 1,
    "follow_ig": 1,
    "daily_free": 1,
    "order_reward": 1,
    "order_clawback": -1,
    "withdrawal_forfeit": -1,
    "guest_merge": 1,
    "cs_adjustment": 0,  # 운영 조정만 양방향
}


def _validate_delta(delta: int, reason) -> None:
    sign = _REASON_SIGN.get(str(getattr(reason, "value", reason)))
    if sign is None:
        raise ValueError(f"unknown credit reason: {reason!r}")
    # 0은 거부하지 않는다 — 관리자가 보상액을 0으로 두는 건 정상 운영(무료 프로모션)이고,
    # 0 거부는 claim 500·워커 사망으로 번진다(보안 리뷰 #235). L5의 목적은 역부호 차단뿐.
    if sign != 0 and delta * sign < 0:
        raise ValueError(f"credit delta {delta} inconsistent with reason {reason!r}")


async def grant_credits(
    member_id: uuid.UUID,
    delta: int,
    reason: str,
    dedupe_key: str,
    ref_id: str | None = None,
    connection=None,
) -> bool:
    _validate_delta(delta, reason)
    if connection is None:
        try:
            async with in_transaction() as connection:
                return await grant_credits(
                    member_id,
                    delta,
                    reason,
                    dedupe_key,
                    ref_id=ref_id,
                    connection=connection,
                )
        except IntegrityError:
            if await CreditLedger.filter(
                member_id=member_id, dedupe_key=dedupe_key
            ).exists():
                return False
            logger.exception("Failed to grant credits to member %s", member_id)
            raise

    member = await Member.select_for_update().using_db(connection).get(id=member_id)
    balance_after = member.credit_balance + delta
    await CreditLedger.create(
        member=member,
        amount=delta,
        reason=reason,
        dedupe_key=dedupe_key,
        ref_id=ref_id,
        balance_after=balance_after,
        using_db=connection,
    )
    member.credit_balance = balance_after
    await member.save(update_fields=["credit_balance"], using_db=connection)
    return True


async def charge_credits(
    member_id: uuid.UUID,
    cost: int,
    reason: str,
    dedupe_key: str,
    ref_id: str | None = None,
    connection=None,
) -> tuple[bool, int]:
    if cost <= 0:
        query = Member.get(id=member_id)
        member = await (query.using_db(connection) if connection is not None else query)
        return False, member.credit_balance
    if connection is None:
        try:
            async with in_transaction() as connection:
                return await charge_credits(
                    member_id,
                    cost,
                    reason,
                    dedupe_key,
                    ref_id=ref_id,
                    connection=connection,
                )
        except IntegrityError:
            if not await CreditLedger.filter(
                member_id=member_id, dedupe_key=dedupe_key
            ).exists():
                raise
            member = await Member.get(id=member_id)
            return True, member.credit_balance

    member = await Member.select_for_update().using_db(connection).get(id=member_id)
    if await CreditLedger.filter(member_id=member_id, dedupe_key=dedupe_key).using_db(
        connection
    ).exists():
        return True, member.credit_balance
    if member.credit_balance < cost:
        return False, member.credit_balance
    balance_after = member.credit_balance - cost
    await CreditLedger.create(
        member=member,
        amount=-cost,
        reason=reason,
        dedupe_key=dedupe_key,
        ref_id=ref_id,
        balance_after=balance_after,
        using_db=connection,
    )
    member.credit_balance = balance_after
    await member.save(update_fields=["credit_balance"], using_db=connection)
    return True, balance_after


async def custom_prompt_credit_cost() -> int:
    setting = await AppSetting.get_or_none(key="custom_prompt_credit_cost")
    return int(setting.value) if setting is not None else 2
