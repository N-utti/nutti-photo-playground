"""인스타 프로페셔널 계정(@nutti_official) 장기 토큰 최초 발급 — 운영자 1회.

1) uv run python scripts/instagram_token.py            → 인가 URL 출력, 인스타 계정으로 로그인·권한 승인
2) uv run python scripts/instagram_token.py <code>     → 리다이렉트 URL의 code를 장기 토큰(60일)으로 교환·저장
이후 갱신은 app.instagram.get_token 이 만료 7일 전부터 자동으로 한다.
"""

import asyncio
import sys
from urllib.parse import urlencode

from tortoise import Tortoise

from app.instagram import exchange_code
from app.settings import settings

SCOPE = "instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments"


def authorize_url() -> str:
    query = urlencode(
        {
            "client_id": settings.instagram_app_id,
            "redirect_uri": settings.instagram_redirect_uri,
            "response_type": "code",
            "scope": SCOPE,
        }
    )
    return f"https://www.instagram.com/oauth/authorize?{query}"


async def run(code: str) -> None:
    await Tortoise.init(db_url=settings.database_url, modules={"models": ["app.models"]})
    try:
        token = await exchange_code(code.split("#_")[0])  # 인스타는 code 뒤에 '#_'를 붙여 돌려준다
    finally:
        await Tortoise.close_connections()
    print(f"stored: @{token.username} ig_user_id={token.ig_user_id} expires_at={token.expires_at.isoformat()}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(authorize_url())
    else:
        asyncio.run(run(sys.argv[1]))
