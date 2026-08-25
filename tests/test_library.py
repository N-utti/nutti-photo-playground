import os
import uuid
from datetime import datetime, timezone
from functools import partial

os.environ.setdefault("DATABASE_URL", "sqlite://:memory:")
os.environ.setdefault("APP_ENV", "development")

import pytest
from fastapi.testclient import TestClient
from tortoise import Tortoise

from app.auth import create_token
from app.main import app
from app.models import (
    GenerationJob,
    GenerationResult,
    JobStatus,
    Member,
    MemberKind,
    PetProfile,
    SourceImage,
)
from app.routers import auth as auth_router
from app.settings import settings


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch):
    for buckets in (
        auth_router._guest_requests,
        auth_router._login_requests,
        auth_router._register_requests,
    ):
        buckets.clear()
    monkeypatch.setattr(settings, "cdn_base_url", "https://cdn.nutti.test")
    with TestClient(app) as test_client:
        test_client.portal.call(Tortoise.generate_schemas)
        yield test_client


async def _create_member(kind: MemberKind) -> str:
    return str((await Member.create(kind=kind)).id)


def _session(
    client: TestClient, kind: MemberKind = MemberKind.MEMBER
) -> tuple[str, dict[str, str]]:
    member_id = client.portal.call(_create_member, kind)
    token = create_token(uuid.UUID(member_id), kind.value, 0)
    return member_id, {"Authorization": f"Bearer {token}"}


async def _create_pet(member_id: str) -> str:
    pet = await PetProfile.create(member_id=member_id, name="Nutti")
    return str(pet.id)


async def _create_result(
    member_id: str,
    *,
    status: JobStatus = JobStatus.SUCCEEDED,
    pet_id: str | None = None,
    created_at: datetime | None = None,
    deleted_at: datetime | None = None,
) -> dict[str, str]:
    source = await SourceImage.create(
        member_id=member_id,
        pet_profile_id=pet_id,
        storage_key=f"uploads/{uuid.uuid4()}.jpg",
        quality_check={},
    )
    job = await GenerationJob.create(
        member_id=member_id,
        source_image=source,
        idempotency_key=uuid.uuid4(),
        status=status,
        credit_cost=1,
    )
    result = await GenerationResult.create(
        job=job,
        seq=1,
        storage_key=f"results/{uuid.uuid4()}.jpg",
        deleted_at=deleted_at,
    )
    if created_at is not None:
        await GenerationResult.filter(id=result.id).update(created_at=created_at)
    return {
        "job_id": str(job.id),
        "result_id": str(result.id),
        "storage_key": result.storage_key,
        "pet_id": pet_id,
    }


def test_library_requires_member(client: TestClient):
    _, headers = _session(client, MemberKind.GUEST)

    response = client.get("/v1/library", headers=headers)

    assert response.status_code == 403
    assert response.json()["error"] == {
        "code": "MEMBER_ONLY",
        "message": "로그인이 필요합니다",
        "detail": {},
    }


def test_library_groups_by_kst_month_and_returns_item_fields(client: TestClient):
    member_id, headers = _session(client)
    pet_id = client.portal.call(_create_pet, member_id)
    july = client.portal.call(
        partial(
            _create_result,
            member_id,
            pet_id=pet_id,
            created_at=datetime(2026, 7, 20, 3, tzinfo=timezone.utc),
        )
    )
    august_older = client.portal.call(
        partial(
            _create_result,
            member_id,
            created_at=datetime(2026, 8, 1, 1, tzinfo=timezone.utc),
        )
    )
    august_newer = client.portal.call(
        partial(
            _create_result,
            member_id,
            pet_id=pet_id,
            created_at=datetime(2026, 8, 25, 12, tzinfo=timezone.utc),
        )
    )

    response = client.get("/v1/library", headers=headers)

    assert response.status_code == 200
    body = response.json()
    assert body["next_cursor"] is None
    assert [month["label"] for month in body["months"]] == ["2026년 8월", "2026년 7월"]
    assert [item["result_id"] for item in body["months"][0]["items"]] == [
        august_newer["result_id"],
        august_older["result_id"],
    ]
    assert [item["result_id"] for item in body["months"][1]["items"]] == [
        july["result_id"]
    ]

    newer_item = body["months"][0]["items"][0]
    assert newer_item == {
        "job_id": august_newer["job_id"],
        "result_id": august_newer["result_id"],
        "image_url": f"https://cdn.nutti.test/{august_newer['storage_key']}",
        "pet_id": pet_id,
        "created_at": newer_item["created_at"],
    }
    assert datetime.fromisoformat(newer_item["created_at"]) == datetime.fromisoformat(
        "2026-08-25T21:00:00+09:00"
    )
    assert body["months"][0]["items"][1]["pet_id"] is None


def test_library_filters_by_pet_and_rejects_invalid_pet_id(client: TestClient):
    member_id, headers = _session(client)
    pet_id = client.portal.call(_create_pet, member_id)
    matching = client.portal.call(partial(_create_result, member_id, pet_id=pet_id))
    client.portal.call(_create_result, member_id)

    matched = client.get("/v1/library", headers=headers, params={"pet_id": pet_id})
    empty = client.get(
        "/v1/library", headers=headers, params={"pet_id": str(uuid.uuid4())}
    )
    invalid = client.get("/v1/library", headers=headers, params={"pet_id": "bad-id"})

    assert matched.status_code == 200
    assert [
        item["result_id"]
        for month in matched.json()["months"]
        for item in month["items"]
    ] == [matching["result_id"]]
    assert empty.status_code == 200
    assert empty.json()["months"] == []
    assert invalid.status_code == 400
    assert invalid.json()["error"]["code"] == "VALIDATION_ERROR"


def test_library_hides_deleted_unsucceeded_and_other_members_results(
    client: TestClient,
):
    member_id, headers = _session(client)
    other_id, _ = _session(client)
    visible = client.portal.call(_create_result, member_id)
    client.portal.call(
        partial(
            _create_result,
            member_id,
            deleted_at=datetime.now(timezone.utc),
        )
    )
    client.portal.call(
        partial(_create_result, member_id, status=JobStatus.QUEUED)
    )
    client.portal.call(_create_result, other_id)

    response = client.get("/v1/library", headers=headers)

    assert response.status_code == 200
    assert [
        item["result_id"]
        for month in response.json()["months"]
        for item in month["items"]
    ] == [visible["result_id"]]


def test_library_cursor_pagination_and_validation(client: TestClient):
    member_id, headers = _session(client)
    created = [client.portal.call(_create_result, member_id) for _ in range(21)]
    other_id, _ = _session(client)
    foreign = client.portal.call(_create_result, other_id)

    first = client.get("/v1/library", headers=headers)

    assert first.status_code == 200
    first_items = [
        item
        for month in first.json()["months"]
        for item in month["items"]
    ]
    assert len(first_items) == 20
    assert first.json()["next_cursor"] == first_items[-1]["result_id"]

    second = client.get(
        "/v1/library",
        headers=headers,
        params={"cursor": first.json()["next_cursor"]},
    )
    second_items = [
        item
        for month in second.json()["months"]
        for item in month["items"]
    ]
    assert second.status_code == 200
    assert len(second_items) == 1
    assert second.json()["next_cursor"] is None
    assert not ({item["result_id"] for item in first_items} & {item["result_id"] for item in second_items})
    assert {item["result_id"] for item in first_items + second_items} == {
        item["result_id"] for item in created
    }

    invalid = client.get(
        "/v1/library", headers=headers, params={"cursor": "not-a-uuid"}
    )
    foreign_cursor = client.get(
        "/v1/library", headers=headers, params={"cursor": foreign["result_id"]}
    )
    assert invalid.status_code == foreign_cursor.status_code == 400
    assert invalid.json()["error"]["code"] == "VALIDATION_ERROR"
    assert foreign_cursor.json()["error"]["code"] == "VALIDATION_ERROR"
