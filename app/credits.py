"""크레딧 원장과 잔액 캐시를 함께 갱신한다."""

import uuid

from tortoise.exceptions import IntegrityError
from tortoise.transactions import in_transaction

from app.models import CreditLedger, Member


async def grant_credits(
    member_id: uuid.UUID,
    delta: int,
    reason: str,
    dedupe_key: str,
    ref_id: str | None = None,
) -> bool:
    try:
        async with in_transaction() as connection:
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
    except IntegrityError:
        return False
    return True
