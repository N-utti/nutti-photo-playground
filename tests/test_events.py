import os
import uuid

os.environ.setdefault("DATABASE_URL", "sqlite://:memory:")
os.environ.setdefault("APP_ENV", "development")

import pytest
from fastapi.testclient import TestClient
from tortoise import Tortoise

from app.auth import create_token
from app.main import app
from app.models import GenerationJob, Member, MemberKind, MetricEvent, SourceImage, Style
from app.routers import auth as auth_router


@pytest.fixture
def client():
    for buckets in (
        auth_router._guest_requests,
        auth_router._login_requests,
        auth_router._register_requests,
    ):
        buckets.clear()
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


async def _create_job(member_id: str, style_id: int | None = None) -> str:
    source = await SourceImage.create(
        member_id=member_id,
        storage_key=f"uploads/{uuid.uuid4()}.jpg",
        quality_check={},
    )
    job = await GenerationJob.create(
        member_id=member_id,
        source_image=source,
        style_id=style_id,
        idempotency_key=uuid.uuid4(),
        credit_cost=1,
    )
    return str(job.id)


async def _create_style() -> int:
    return (await Style.create(id=1, code="event-test", section="test", name="Event test")).id


async def _event_for(member_id: str) -> dict:
    event = await MetricEvent.get(member_id=member_id)
    return {
        "member_id": str(event.member_id),
        "job_id": str(event.job_id) if event.job_id is not None else None,
        "style_id": event.style_id,
        "meta": event.meta,
    }


def test_track_event_requires_token(client: TestClient):
    response = client.post("/v1/events", json={"event_type": "result_view"})

    assert response.status_code == 401


def test_guest_event_links_owned_job_and_style(client: TestClient):
    member_id, headers = _session(client, MemberKind.GUEST)
    style_id = client.portal.call(_create_style)
    job_id = client.portal.call(_create_job, member_id, style_id)
    properties = {"job_id": job_id}

    response = client.post(
        "/v1/events",
        headers=headers,
        json={"event_type": "result_view", "properties": properties},
    )
    event = client.portal.call(_event_for, member_id)

    assert response.status_code == 204
    assert event == {
        "member_id": member_id,
        "job_id": job_id,
        "style_id": style_id,
        "meta": properties,
    }


@pytest.mark.parametrize("job_id_kind", ["foreign", "invalid"])
def test_event_ignores_unlinkable_job_id(client: TestClient, job_id_kind: str):
    member_id, headers = _session(client, MemberKind.GUEST)
    if job_id_kind == "foreign":
        other_id, _ = _session(client)
        job_id = client.portal.call(_create_job, other_id)
    else:
        job_id = "not-a-uuid"

    response = client.post(
        "/v1/events",
        headers=headers,
        json={"event_type": "result_view", "properties": {"job_id": job_id}},
    )
    event = client.portal.call(_event_for, member_id)

    assert response.status_code == 204
    assert event["job_id"] is None
    assert event["style_id"] is None


def test_event_type_must_not_be_empty(client: TestClient):
    _, headers = _session(client, MemberKind.GUEST)

    response = client.post(
        "/v1/events", headers=headers, json={"event_type": "", "properties": {}}
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
