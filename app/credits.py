"""크레딧 원장과 잔액 캐시를 함께 갱신한다."""

import logging
import uuid

from tortoise.exceptions import IntegrityError
from tortoise.transactions import in_transaction

from app.models import AppSetting, CreditLedger, Member

logger = logging.getLogger(__name__)


async def grant_credits(
    member_id: uuid.UUID,
    delta: int,
    reason: str,
    dedupe_key: str,
    ref_id: str | None = None,
    connection=None,
) -> bool:
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
