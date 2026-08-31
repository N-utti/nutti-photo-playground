"""카페24 Admin API 토큰 최초 발급(운영자 1회) — 06-architecture §6.1.

1) uv run python scripts/cafe24_token.py            → authorize URL 출력, 몰 운영자 계정으로 승인
2) uv run python scripts/cafe24_token.py <code>     → 리다이렉트 URL의 code를 토큰으로 교환·저장
이후 갱신은 배치(app.cafe24.get_access_token)가 자동으로 한다.
"""

import asyncio
import sys
from urllib.parse import urlencode

from tortoise import Tortoise

from app.cafe24 import exchange_code
from app.settings import settings


def authorize_url() -> str:
    query = urlencode(
        {
            "response_type": "code",
            "client_id": settings.cafe24_client_id,
            "redirect_uri": settings.cafe24_redirect_uri,
            "scope": settings.cafe24_scope,
            "state": "cafe24-token-bootstrap",
        }
    )
    return f"https://{settings.cafe24_mall_id}.cafe24api.com/api/v2/oauth/authorize?{query}"


async def run(code: str) -> None:
    await Tortoise.init(db_url=settings.database_url, modules={"models": ["app.models"]})
    try:
        token = await exchange_code(code)
    finally:
        await Tortoise.close_connections()
    print(f"stored: mall_id={token.mall_id} expires_at={token.expires_at.isoformat()}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(authorize_url())
    else:
        asyncio.run(run(sys.argv[1]))
