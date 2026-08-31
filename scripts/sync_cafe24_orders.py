"""카페24 주문 보상 동기화 배치 — 06-architecture §6.2, Q3(+20 지급 · 취소 시 전액 회수).

실행: uv run python scripts/sync_cafe24_orders.py  (cron 30분 주기 전제)
선행: scripts/cafe24_token.py 로 운영자 Admin API 토큰 1회 발급.
"""

import asyncio

from tortoise import Tortoise

from app.cafe24 import sync_orders
from app.settings import settings


async def run() -> None:
    await Tortoise.init(db_url=settings.database_url, modules={"models": ["app.models"]})
    try:
        summary = await sync_orders()
    finally:
        await Tortoise.close_connections()
    print("cafe24 sync: " + " ".join(f"{k}={v}" for k, v in summary.items()))


if __name__ == "__main__":
    asyncio.run(run())
