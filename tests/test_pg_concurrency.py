import asyncio
import os
from urllib.parse import parse_qs, urlparse

os.environ.setdefault("DATABASE_URL", os.getenv("TEST_PG_DATABASE_URL") or "sqlite://:memory:")
os.environ.setdefault("APP_ENV", "development")

import httpx
import pytest
from tortoise import Tortoise, connections

from app.auth import hash_password
from app.main import app
from app.models import Member, MemberKind
from app.routers import auth as auth_router
from conftest import reset_tortoise_executor_cache


TEST_PG_DATABASE_URL = os.getenv("TEST_PG_DATABASE_URL")


pytestmark = pytest.mark.skipif(
    not TEST_PG_DATABASE_URL,
    reason="TEST_PG_DATABASE_URL is required for PostgreSQL concurrency tests",
)


async def _truncate_members() -> None:
    await connections.get("default").execute_script(
        'TRUNCATE TABLE "member" RESTART IDENTITY CASCADE;'
    )


@pytest.fixture
async def pg_database():
    assert TEST_PG_DATABASE_URL is not None
    reset_tortoise_executor_cache()
    await Tortoise.init(
        db_url=TEST_PG_DATABASE_URL,
        modules={"models": ["app.models"]},
        _enable_global_fallback=True,
    )
    await Tortoise.generate_schemas()
    await _truncate_members()
    for buckets in (
        auth_router._guest_requests,
        auth_router._login_requests,
        auth_router._register_requests,
        auth_router._refresh_requests,
    ):
        buckets.clear()
    yield
    await _truncate_members()
    await Tortoise.close_connections()
    reset_tortoise_executor_cache()


async def test_concurrent_local_logins_do_not_return_500(pg_database):
    email = "concurrent@example.com"
    password = "password-123"
    password_hash = hash_password(password)
    statuses: list[int] = []

    for iteration in range(20):
        await _truncate_members()
        await Member.create(
            kind=MemberKind.MEMBER,
            email=email,
            password_hash=password_hash,
        )
        transport = httpx.ASGITransport(
            app=app,
            raise_app_exceptions=False,
            client=(f"198.51.100.{iteration + 1}", 123),
        )
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            guests = []
            for _ in range(2):
                response = await client.post("/v1/auth/guest")
                assert response.status_code == 201
                guests.append(response.json())

            responses = await asyncio.gather(
                *(
                    client.post(
                        "/v1/auth/login",
                        headers={"Authorization": f"Bearer {guest['token']}"},
                        json={"email": email, "password": password},
                    )
                    for guest in guests
                )
            )
            if iteration == 19:
                assert [response.status_code for response in responses] == [200, 200]
                original_refresh_tokens = [
                    response.json()["refresh_token"] for response in responses
                ]
                refresh_responses = [
                    await client.post(
                        "/v1/auth/refresh",
                        json={"refresh_token": refresh_token},
                    )
                    for refresh_token in original_refresh_tokens
                ]
                assert sorted(
                    response.status_code for response in refresh_responses
                ) == [200, 401]
                rotated = next(
                    response.json()["refresh_token"]
                    for response in refresh_responses
                    if response.status_code == 200
                )
                assert rotated not in original_refresh_tokens

                retry_guest = await client.post("/v1/auth/guest")
                assert retry_guest.status_code == 201
                retry_login = await client.post(
                    "/v1/auth/login",
                    headers={
                        "Authorization": f"Bearer {retry_guest.json()['token']}"
                    },
                    json={"email": email, "password": password},
                )
                assert retry_login.status_code == 200
        statuses.extend(response.status_code for response in responses)

    assert all(status // 100 in {2, 4} for status in statuses)
    assert statuses.count(500) == 0


async def test_concurrent_kakao_promotions_retry_and_merge(
    pg_database, monkeypatch: pytest.MonkeyPatch
):
    kakao_id = 123456
    real_merge = auth_router._merge_or_promote_guest
    retry_observed = False

    async def exchange(code: str) -> dict:
        return {"access_token": code}

    async def fetch(access_token: str) -> dict:
        return {"id": kakao_id}

    monkeypatch.setattr(auth_router, "_exchange_kakao_code", exchange)
    monkeypatch.setattr(auth_router, "_fetch_kakao_member", fetch)

    for iteration in range(20):
        await _truncate_members()
        merge_calls = 0
        initial_merges_ready = asyncio.Event()

        async def synchronized_merge(connection, guest_id, **kwargs):
            nonlocal merge_calls, retry_observed
            merge_calls += 1
            if merge_calls <= 2:
                if merge_calls == 2:
                    initial_merges_ready.set()
                await initial_merges_ready.wait()
            else:
                retry_observed = True
            return await real_merge(connection, guest_id, **kwargs)

        monkeypatch.setattr(auth_router, "_merge_or_promote_guest", synchronized_merge)
        transport = httpx.ASGITransport(
            app=app,
            raise_app_exceptions=False,
            client=(f"203.0.113.{iteration + 1}", 123),
        )
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            guests = [(await client.post("/v1/auth/guest")).json() for _ in range(2)]
            states = []
            for guest in guests:
                authorize = await client.get(
                    "/v1/auth/kakao/authorize",
                    headers={"Authorization": f"Bearer {guest['token']}"},
                )
                assert authorize.status_code == 200
                states.append(
                    parse_qs(urlparse(authorize.json()["authorize_url"]).query)["state"][0]
                )

            responses = await asyncio.gather(
                *(
                    client.get(
                        "/v1/auth/kakao/callback",
                        params={"code": f"code-{index}", "state": state},
                    )
                    for index, state in enumerate(states)
                )
            )

        assert [response.status_code for response in responses] == [200, 200]
        assert sorted(response.json()["merged"] for response in responses) == [False, True]
        assert await Member.filter(kakao_id=str(kakao_id)).count() == 1
        member = await Member.get(kakao_id=str(kakao_id))
        assert member.kind == MemberKind.MEMBER
        assert await Member.filter(merged_into_id=member.id).count() == 1

    assert retry_observed
