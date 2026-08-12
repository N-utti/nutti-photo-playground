import asyncio
import os

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
