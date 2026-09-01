import os
import uuid
from datetime import datetime, timedelta, timezone
from functools import partial

os.environ.setdefault("DATABASE_URL", "sqlite://:memory:")
os.environ.setdefault("APP_ENV", "development")

import pytest
from fastapi.testclient import TestClient
from tortoise import Tortoise

from app.auth import create_token
from app.main import app
from app.models import (
    CreditLedger,
    CustomPromptLog,
    GenerationJob,
    GenerationResult,
    Member,
    MemberKind,
    PetProfile,
    SourceImage,
    Style,
    StyleStatus,
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


async def _create_member_and_upload(
    balance: int = 3, pet_name: str | None = None
) -> tuple[str, str]:
    member = await Member.create(kind=MemberKind.GUEST, credit_balance=balance)
    pet = await PetProfile.create(member=member, name=pet_name) if pet_name else None
    source = await SourceImage.create(
        member=member,
        pet_profile=pet,
        storage_key=f"uploads/{uuid.uuid4()}.jpg",
        quality_check={},
    )
    return str(member.id), str(source.id)


def _session(
    client: TestClient, balance: int = 3, pet_name: str | None = None
) -> tuple[str, str, dict[str, str]]:
    member_id, upload_id = client.portal.call(_create_member_and_upload, balance, pet_name)
    token = create_token(uuid.UUID(member_id), MemberKind.GUEST.value, 0)
    return member_id, upload_id, {"Authorization": f"Bearer {token}"}


async def _create_style(
    style_id: int,
    status: StyleStatus = StyleStatus.PUBLIC,
    credit_cost: int = 1,
    avg_seconds: int = 24,
    progress_message: str | None = None,
    input_fields: list | None = None,
) -> Style:
    return await Style.create(
        id=style_id,
        code=f"style-{style_id}",
        section="test",
        name=f"Style {style_id}",
        status=status,
        credit_cost=credit_cost,
        avg_seconds=avg_seconds,
        progress_message=progress_message,
        input_fields=input_fields or [],
    )


def _post_job(
    client: TestClient,
    headers: dict[str, str],
    upload_id: str,
    *,
    idempotency_key: str | None = None,
    **body,
):
    return client.post(
        "/v1/jobs",
        headers={
            **headers,
            "Idempotency-Key": idempotency_key or str(uuid.uuid4()),
        },
        json={"upload_id": upload_id, **body},
    )


async def _member_job_and_generation_entries(member_id: str, job_id: str):
    member = await Member.get(id=member_id)
    job = await GenerationJob.get(id=job_id)
    entries = await CreditLedger.filter(
        member_id=member_id,
        reason="generation_charge",
    ).all()
    return member, job, entries


_INPUT_FIELDS = [
    {
        "label": "의상",
        "type": "choice",
        "allow_custom": False,
        "default": "버섯",
        "options": [{"value": "버섯"}, {"value": "옥수수"}],
    },
    {"label": "자막", "type": "text", "max_length": 4},
    {"label": "번호", "type": "text", "pattern": "^\\d{4}$", "default": "0103"},
]


async def _get_job_input_values(job_id: str):
    return (await GenerationJob.get(id=job_id)).input_values


def test_create_preset_job_resolves_and_stores_input_values(client: TestClient):
    _, upload_id, headers = _session(client, balance=3)
    client.portal.call(partial(_create_style, 1, input_fields=_INPUT_FIELDS))

    response = _post_job(
        client, headers, upload_id, style_id=1, inputs={"의상": "옥수수", "자막": "규탄"}
    )

    assert response.status_code == 202
    stored = client.portal.call(
        partial(_get_job_input_values, response.json()["job_id"])
    )
    # 미제공 필드는 default 병합, default 없는 자막은 제공값 그대로
    assert stored == {"의상": "옥수수", "자막": "규탄", "번호": "0103"}


def test_get_job_returns_stored_input_values(client: TestClient):
    _, upload_id, headers = _session(client, balance=3)
    client.portal.call(partial(_create_style, 1, input_fields=_INPUT_FIELDS))
    inputs = {"의상": "옥수수", "자막": "규탄"}

    created = _post_job(client, headers, upload_id, style_id=1, inputs=inputs)
    assert created.status_code == 202
    response = client.get(f"/v1/jobs/{created.json()['job_id']}", headers=headers)
    assert response.status_code == 200
    assert response.json()["inputs"] == {**inputs, "번호": "0103"}


def test_create_preset_job_ignores_unknown_inputs(client: TestClient):
    _, upload_id, headers = _session(client, balance=3)
    client.portal.call(partial(_create_style, 1, input_fields=_INPUT_FIELDS))

    response = _post_job(
        client,
        headers,
        upload_id,
        style_id=1,
        inputs={"자막": "규탄", "엉뚱한키": "값"},
    )

    assert response.status_code == 202
    stored = client.portal.call(
        partial(_get_job_input_values, response.json()["job_id"])
    )
    assert stored == {"의상": "버섯", "자막": "규탄", "번호": "0103"}


def test_create_preset_job_rejects_invalid_inputs(client: TestClient):
    member_id, upload_id, headers = _session(client, balance=3)
    client.portal.call(partial(_create_style, 1, input_fields=_INPUT_FIELDS))

    cases = [
        {"의상": "딸기"},
        {"자막": "네글자넘김"},
        {"번호": "12a4"},
    ]
    for inputs in cases:
        response = _post_job(client, headers, upload_id, style_id=1, inputs=inputs)
        assert response.status_code == 400, inputs
        assert response.json()["error"]["code"] == "VALIDATION_ERROR", inputs

    member = client.portal.call(partial(Member.get, id=member_id))
    assert member.credit_balance == 3


def test_create_preset_job_charges_style_cost_and_writes_ledger(client: TestClient):
    member_id, upload_id, headers = _session(client, balance=3)
    client.portal.call(_create_style, 1)

    response = _post_job(client, headers, upload_id, style_id=1)

    assert response.status_code == 202
    assert response.json() == {
        "job_id": response.json()["job_id"],
        "status": "queued",
    }
    member, job, entries = client.portal.call(
        _member_job_and_generation_entries,
        member_id,
        response.json()["job_id"],
    )
    assert member.credit_balance == 2
    assert job.style_id == 1
    assert job.credit_cost == 1
    assert len(entries) == 1
    assert entries[0].amount == -1
    assert entries[0].dedupe_key == f"job:{job.id}"
    assert entries[0].ref_id == str(job.id)


async def _mark_processing(job_id: str) -> None:
    await GenerationJob.filter(id=job_id).update(status="processing")


async def _job_and_generation_entry_counts(member_id: str) -> tuple[int, int, int]:
    member = await Member.get(id=member_id)
    jobs = await GenerationJob.filter(member_id=member_id).count()
    entries = await CreditLedger.filter(
        member_id=member_id,
        reason="generation_charge",
    ).count()
    return member.credit_balance, jobs, entries


def test_same_idempotency_key_returns_current_job_without_recharging(client: TestClient):
    member_id, upload_id, headers = _session(client, balance=3)
    client.portal.call(_create_style, 2)
    key = str(uuid.uuid4())
    first = _post_job(
        client,
        headers,
        upload_id,
        idempotency_key=key,
        style_id=2,
    )
    client.portal.call(_mark_processing, first.json()["job_id"])

    repeated = _post_job(
        client,
        headers,
        str(uuid.uuid4()),
        idempotency_key=key,
        style_id=999,
    )

    assert first.status_code == repeated.status_code == 202
    assert repeated.json() == {
        "job_id": first.json()["job_id"],
        "status": "processing",
    }
    assert client.portal.call(_job_and_generation_entry_counts, member_id) == (2, 1, 1)


def test_insufficient_credit_rolls_back_job_and_ledger(client: TestClient):
    member_id, upload_id, headers = _session(client, balance=0)
    client.portal.call(_create_style, 3)

    response = _post_job(client, headers, upload_id, style_id=3)

    assert response.status_code == 402
    assert response.json()["error"] == {
        "code": "INSUFFICIENT_CREDIT",
        "message": "크레딧이 부족합니다",
        "detail": {"required": 1, "balance": 0},
    }
    assert client.portal.call(_job_and_generation_entry_counts, member_id) == (0, 0, 0)


async def _custom_job_state(member_id: str, job_id: str):
    member = await Member.get(id=member_id)
    job = await GenerationJob.get(id=job_id)
    log = await CustomPromptLog.get(job_id=job.id)
    return member, job, log


def test_custom_prompt_uses_default_cost_and_links_log_both_ways(client: TestClient):
    member_id, upload_id, headers = _session(client, balance=5)

    response = _post_job(
        client,
        headers,
        upload_id,
        pet_id=str(uuid.uuid4()),
        custom_prompt="  우주복을 입혀줘  ",
    )

    assert response.status_code == 202
    member, job, log = client.portal.call(
        _custom_job_state,
        member_id,
        response.json()["job_id"],
    )
    assert member.credit_balance == 3
    assert job.style_id is None
    assert job.prompt_version_id is None
    assert job.credit_cost == 2
    assert job.custom_prompt_id == log.id
    assert log.job_id == job.id
    assert log.raw_text == "  우주복을 입혀줘  "
    assert log.normalized_text == "우주복을 입혀줘"
    body = client.get(f"/v1/jobs/{job.id}", headers=headers).json()
    assert body["style_id"] is None
    assert body["custom_prompt"] == "  우주복을 입혀줘  "
    assert body["credit_cost"] == 2


def test_get_custom_prompt_job_returns_null_inputs(client: TestClient):
    _, upload_id, headers = _session(client, balance=3)

    created = _post_job(
        client,
        headers,
        upload_id,
        custom_prompt="cute portrait",
    )
    assert created.status_code == 202
    response = client.get(f"/v1/jobs/{created.json()['job_id']}", headers=headers)
    assert response.status_code == 200
    assert response.json()["inputs"] is None


async def _blocked_prompt_state(member_id: str):
    member = await Member.get(id=member_id)
    logs = await CustomPromptLog.filter(member_id=member_id).all()
    jobs = await GenerationJob.filter(member_id=member_id).count()
    entries = await CreditLedger.filter(
        member_id=member_id,
        reason="generation_charge",
    ).count()
    return member, logs, jobs, entries


def test_input_filter_logs_block_without_charging_or_creating_job(client: TestClient):
    member_id, upload_id, headers = _session(client, balance=5)

    response = _post_job(
        client,
        headers,
        upload_id,
        custom_prompt="얘 털색 하얀색으로 바꿔줘",
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert response.json()["error"]["detail"] == {"reason": "input_filter_blocked"}
    member, logs, jobs, entries = client.portal.call(_blocked_prompt_state, member_id)
    assert member.credit_balance == 5
    assert jobs == entries == 0
    assert len(logs) == 1
    assert logs[0].job_id is None
    assert logs[0].normalized_text == "얘 털색 하얀색으로 바꿔줘"
    assert logs[0].moderation == {
        "input_filter_blocked": True,
        "reason": "breed_color_change",
    }


def test_create_rejects_foreign_upload_and_missing_or_retired_style(client: TestClient):
    _, owner_upload_id, owner_headers = _session(client)
    _, _, other_headers = _session(client)
    client.portal.call(_create_style, 4)
    client.portal.call(_create_style, 5, StyleStatus.RETIRED)

    responses = [
        _post_job(client, other_headers, owner_upload_id, style_id=4),
        _post_job(client, owner_headers, owner_upload_id, style_id=999),
        _post_job(client, owner_headers, owner_upload_id, style_id=5),
    ]

    assert [response.status_code for response in responses] == [404, 404, 404]
    assert all(response.json()["error"]["code"] == "NOT_FOUND" for response in responses)


async def _create_jobs_for_statuses(member_id: str, upload_id: str):
    member = await Member.get(id=member_id)
    source = await SourceImage.get(id=upload_id)
    style = await _create_style(
        6,
        avg_seconds=200,
        progress_message="사진을 꾸미고 있어요",
    )
    queued = await GenerationJob.create(
        member=member,
        source_image=source,
        style=style,
        idempotency_key=uuid.uuid4(),
        status="queued",
        credit_cost=1,
    )
    processing = await GenerationJob.create(
        member=member,
        source_image=source,
        style=style,
        idempotency_key=uuid.uuid4(),
        status="processing",
        credit_cost=1,
        started_at=datetime.now(timezone.utc) - timedelta(seconds=100),
    )
    succeeded = await GenerationJob.create(
        member=member,
        source_image=source,
        style=style,
        idempotency_key=uuid.uuid4(),
        status="succeeded",
        credit_cost=1,
    )
    await GenerationResult.create(
        job=succeeded,
        seq=1,
        storage_key="results/succeeded.jpg",
    )
    failed = await GenerationJob.create(
        member=member,
        source_image=source,
        style=None,
        idempotency_key=uuid.uuid4(),
        status="failed",
        credit_cost=2,
        error_code="PROVIDER_ERROR",
    )
    return {
        "queued": str(queued.id),
        "processing": str(processing.id),
        "succeeded": str(succeeded.id),
        "failed": str(failed.id),
    }


def test_get_job_returns_all_fields_and_status_specific_values(client: TestClient):
    member_id, upload_id, headers = _session(client)
    job_ids = client.portal.call(_create_jobs_for_statuses, member_id, upload_id)

    bodies = {
        status: client.get(f"/v1/jobs/{job_id}", headers=headers).json()
        for status, job_id in job_ids.items()
    }

    expected_keys = {
        "job_id",
        "status",
        "style_id",
        "custom_prompt",
        "inputs",
        "credit_cost",
        "upload_id",
        "pet_id",
        "breed",
        "progress",
        "eta_seconds",
        "status_message",
        "source_image_url",
        "results",
        "error_code",
        "queued_at",
        "started_at",
    }
    assert all(set(body) == expected_keys for body in bodies.values())
    assert all(body["job_id"] == job_ids[status] for status, body in bodies.items())
    assert all(body["status"] == status for status, body in bodies.items())
    assert all(body["custom_prompt"] is None for body in bodies.values())
    assert {status: body["credit_cost"] for status, body in bodies.items()} == {
        "queued": 1,
        "processing": 1,
        "succeeded": 1,
        "failed": 2,
    }
    assert all(body["upload_id"] == upload_id for body in bodies.values())
    assert all(body["pet_id"] is None for body in bodies.values())
    assert all(
        body["source_image_url"].startswith("https://cdn.nutti.test/uploads/")
        for body in bodies.values()
    )
    assert all(datetime.fromisoformat(body["queued_at"]) for body in bodies.values())

    assert bodies["queued"] | {"job_id": None, "upload_id": None, "queued_at": None} == {
        "job_id": None,
        "status": "queued",
        "style_id": 6,
        "custom_prompt": None,
        "inputs": None,
        "credit_cost": 1,
        "upload_id": None,
        "pet_id": None,
        "breed": None,
        "progress": 0,
        "eta_seconds": 200,
        "status_message": None,
        "source_image_url": bodies["queued"]["source_image_url"],
        "results": None,
        "error_code": None,
        "queued_at": None,
        "started_at": None,
    }
    processing = bodies["processing"]
    assert processing["style_id"] == 6
    assert processing["progress"] == 50
    assert 99 <= processing["eta_seconds"] <= 100
    assert processing["status_message"] == "사진을 꾸미고 있어요"
    assert processing["results"] is None
    assert processing["error_code"] is None
    assert datetime.fromisoformat(processing["started_at"])

    assert bodies["succeeded"]["progress"] == 100
    assert bodies["succeeded"]["eta_seconds"] == 0
    assert bodies["succeeded"]["status_message"] is None
    assert bodies["succeeded"]["results"] == [
        {"index": 0, "image_url": "https://cdn.nutti.test/results/succeeded.jpg"}
    ]
    assert bodies["succeeded"]["error_code"] is None

    assert bodies["failed"]["style_id"] is None
    assert bodies["failed"]["progress"] is None
    assert bodies["failed"]["eta_seconds"] is None
    assert bodies["failed"]["status_message"] is None
    assert bodies["failed"]["results"] is None
    assert bodies["failed"]["error_code"] == "PROVIDER_ERROR"


async def _create_owned_job(member_id: str, upload_id: str) -> str:
    job = await GenerationJob.create(
        member_id=member_id,
        source_image_id=upload_id,
        idempotency_key=uuid.uuid4(),
        credit_cost=1,
    )
    return str(job.id)


async def _source_pet_id(upload_id: str) -> str | None:
    source = await SourceImage.get(id=upload_id)
    return str(source.pet_profile_id) if source.pet_profile_id is not None else None


def test_get_job_returns_source_image_pet_id(client: TestClient):
    member_id, upload_id, headers = _session(client, pet_name="콩이")
    job_id = client.portal.call(_create_owned_job, member_id, upload_id)
    pet_id = client.portal.call(_source_pet_id, upload_id)

    response = client.get(f"/v1/jobs/{job_id}", headers=headers)

    assert response.status_code == 200
    assert response.json()["pet_id"] == pet_id


async def _breed_values(upload_id: str) -> tuple[dict | None, str | None]:
    source = await SourceImage.get(id=upload_id)
    pet = await PetProfile.get_or_none(id=source.pet_profile_id)
    return source.breed_estimate, pet.breed_label if pet else None


def test_create_job_stores_breed_on_upload_and_pet(client: TestClient):
    """견종은 비전 추정이 아니라 사용자가 고르거나 쓴 값 — 업로드와 저장된 강아지에 남는다."""
    member_id, upload_id, headers = _session(client, pet_name="콩이")
    client.portal.call(_create_style, 1)

    response = _post_job(client, headers, upload_id, style_id=1, breed="  시고르자브종 ")

    assert response.status_code == 202
    assert client.portal.call(_breed_values, upload_id) == ({"label": "시고르자브종"}, "시고르자브종")
    job = client.get(f"/v1/jobs/{response.json()['job_id']}", headers=headers).json()
    assert job["breed"] == "시고르자브종"

    # 빈 값은 지우지 않는다 — 같은 사진으로 다시 만들 때 견종을 다시 안 물어도 된다.
    again = _post_job(client, headers, upload_id, style_id=1, breed="")
    assert again.status_code == 202
    assert client.portal.call(_breed_values, upload_id)[0] == {"label": "시고르자브종"}


def test_get_job_hides_other_members_job_and_requires_authentication(client: TestClient):
    owner_id, upload_id, _ = _session(client)
    _, _, other_headers = _session(client)
    job_id = client.portal.call(_create_owned_job, owner_id, upload_id)

    foreign = client.get(f"/v1/jobs/{job_id}", headers=other_headers)
    anonymous = client.get(f"/v1/jobs/{job_id}")

    assert foreign.status_code == 404
    assert foreign.json()["error"]["code"] == "NOT_FOUND"
    assert anonymous.status_code == 401
    assert anonymous.json()["error"]["code"] == "UNAUTHORIZED"


def test_share_result_returns_existing_result_public_url(client: TestClient):
    member_id, upload_id, headers = _session(client)
    job_ids = client.portal.call(_create_jobs_for_statuses, member_id, upload_id)

    response = client.post(
        f"/v1/jobs/{job_ids['succeeded']}/share",
        headers=headers,
        json={"channel": "instagram"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "share_image_url": "https://cdn.nutti.test/results/succeeded.jpg"
    }


def test_share_result_hides_other_members_job(client: TestClient):
    owner_id, upload_id, _ = _session(client)
    _, _, other_headers = _session(client)
    job_ids = client.portal.call(_create_jobs_for_statuses, owner_id, upload_id)

    response = client.post(
        f"/v1/jobs/{job_ids['succeeded']}/share",
        headers=other_headers,
        json={"channel": "instagram"},
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_share_result_returns_not_found_when_job_has_no_result(client: TestClient):
    member_id, upload_id, headers = _session(client)
    job_ids = client.portal.call(_create_jobs_for_statuses, member_id, upload_id)

    responses = [
        client.post(
            f"/v1/jobs/{job_ids[status]}/share",
            headers=headers,
            json={"channel": "instagram"},
        )
        for status in ("queued", "failed")
    ]

    assert [response.status_code for response in responses] == [404, 404]
    assert all(response.json()["error"]["code"] == "NOT_FOUND" for response in responses)


def test_share_result_returns_not_found_for_missing_or_invalid_job_id(client: TestClient):
    _, _, headers = _session(client)

    responses = [
        client.post(
            f"/v1/jobs/{job_id}/share",
            headers=headers,
            json={"channel": "instagram"},
        )
        for job_id in (uuid.uuid4(), "not-a-uuid")
    ]

    assert [response.status_code for response in responses] == [404, 404]
    assert all(response.json()["error"]["code"] == "NOT_FOUND" for response in responses)
